import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Db } from './supabase';
import { callCapability } from './pramaan';
export const enterpriseConnectionInput = z.object({
 issuer:z.string().url().max(512).refine(value=>{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash;}),clientId:z.string().min(1).max(512),clientSecret:z.string().min(1).max(2048).optional(),
 tokenAuthMethod:z.enum(['none','client_secret_basic','client_secret_post']),endpointHosts:z.array(z.string().max(253)).max(5).optional(),
}).strict().refine(input => (input.tokenAuthMethod==='none') === (input.clientSecret===undefined));
export class EnterpriseAccessError extends Error {}
export async function requireEnterpriseMember(db:Db,userId:string,orgId:string,admin=false) {
 const member=await db.from('org_members').select('role').eq('org_id',orgId).eq('user_id',userId).maybeSingle();
 if(member.error||!member.data||admin&&member.data.role!=='admin') throw new EnterpriseAccessError('Organization sign-in access is unavailable.');
}
export const enterpriseRedirect = () => {
 const base=process.env.FRONTEND_URL; if(!base) throw new Error('Organization sign-in needs the public HTTPS app address.');
 const url=new URL('/auth/callback?enterprise=1',base);
 if(url.protocol!=='https:'||url.username||url.password) throw new Error('Organization sign-in needs the public HTTPS app address.');
 return url.href;
};
async function ownedConnection(db:Db,orgId:string,id:string) {
 const row=await db.from('organization_sign_in_connections').select('*').eq('org_id',orgId).eq('id',id).maybeSingle();
 if(row.error||!row.data) throw new Error('Organization sign-in is unavailable.'); return row.data;
}
export async function createEnterpriseConnection(db:Db,userId:string,orgId:string,input:unknown) {
 await requireEnterpriseMember(db,userId,orgId,true); const config=enterpriseConnectionInput.parse(input);
 const result=await callCapability('auth.enterprise-connection.create',{organizationRef:orgId,name:'Organization sign-in',...config,redirectUris:[enterpriseRedirect()]},{endUser:userId,idempotencyKey:randomUUID()});
 if(!result.ref) throw new Error('The connection could not be saved.');
 const saved=await db.from('organization_sign_in_connections').insert({org_id:orgId,connection_ref:result.ref}).select('id,org_id').single();
 if(saved.error||!saved.data) {
  await callCapability('auth.enterprise-connection.delete',{ref:result.ref,confirm:true},{endUser:userId,idempotencyKey:randomUUID()});
  throw new Error('The connection could not be saved.');
 }
 return {id:saved.data.id,organizationId:orgId};
}
export async function listEnterpriseConnections(db:Db,userId:string,orgId:string,cursor?:string) {
 await requireEnterpriseMember(db,userId,orgId,true);
 const current=await callCapability('auth.enterprise-connections.list',{organizationRef:orgId,limit:50,...(cursor?{cursor}:{})},{endUser:userId});
 const local=await db.from('organization_sign_in_connections').select('id,connection_ref').eq('org_id',orgId);if(local.error)throw new Error('Connections could not be loaded.');
 return {results:(local.data??[]).filter(row=>current.results.some(c=>c.ref===row.connection_ref&&c.organizationRef===orgId)).map(row=>({id:row.id,name:'Organization sign-in'})),...(current.nextCursor?{nextCursor:current.nextCursor}:{})};
}
export async function deleteEnterpriseConnection(db:Db,userId:string,orgId:string,id:string) {
 await requireEnterpriseMember(db,userId,orgId,true);const row=await ownedConnection(db,orgId,id);
 await callCapability('auth.enterprise-connection.delete',{ref:row.connection_ref,confirm:true},{endUser:userId,idempotencyKey:`enterprise-delete:${id}`});
 const deleted=await db.from('organization_sign_in_connections').delete().eq('org_id',orgId).eq('id',id);if(deleted.error)throw new Error('The connection could not be removed.');
}
export async function startEnterpriseSignIn(db:Db,orgId:string,id:string,linkUserId?:string) {
 if(linkUserId)await requireEnterpriseMember(db,linkUserId,orgId);
 const connection=await ownedConnection(db,orgId,id);
 const flow={id:randomUUID(),org_id:orgId,connection_id:id,connection_ref:connection.connection_ref,state:randomBytes(32).toString('base64url'),nonce:randomBytes(32).toString('base64url'),verifier:randomBytes(32).toString('base64url'),redirect_uri:enterpriseRedirect(),expires_at:new Date(Date.now()+10*60_000).toISOString(),link_user_id:linkUserId??null};
 // State is stored server-side, not in a readable browser handoff.
 const saved=await db.from('enterprise_sign_in_flows').insert(flow);if(saved.error)throw new Error('Sign-in could not be started.');
 try {
  const result=await callCapability('auth.enterprise.start',{connectionRef:flow.connection_ref,redirectUri:flow.redirect_uri,state:flow.state,nonce:flow.nonce,codeChallenge:createHash('sha256').update(flow.verifier).digest('base64url')});
  return {url:result.authorizationUrl,ticket:flow.id};
 } catch {await db.from('enterprise_sign_in_flows').delete().eq('id',flow.id);throw new Error('Organization sign-in is not available yet.');}
}
export async function redeemEnterpriseSignIn(db:Db,ticket:string,state:unknown,code:string,currentUserId?:string) {
 if(typeof state!=='string'||!state)throw new Error('Start organization sign-in again.');
 // Atomic one-use claim happens before redeeming the platform proof.
 const claimed=await db.from('enterprise_sign_in_flows').update({consumed:true}).eq('id',ticket).eq('state',state).eq('consumed',false).gt('expires_at',new Date().toISOString()).select('*').maybeSingle();
 if(claimed.error||!claimed.data)throw new Error('Start organization sign-in again.');const flow=claimed.data;
 const connection=await ownedConnection(db,flow.org_id,flow.connection_id);if(connection.connection_ref!==flow.connection_ref)throw new Error('Start organization sign-in again.');
 const identity=await callCapability('auth.social.exchange',{providerKey:'enterprise',connectionRef:flow.connection_ref,state,code,redirectUri:flow.redirect_uri,pkceVerifier:flow.verifier,expectedNonce:flow.nonce},{idempotencyKey:`enterprise-redeem:${flow.id}`});
 if(identity.providerKey!=='enterprise'||!identity.subjectId)throw new Error('The organization identity could not be verified.');
 const subjectHash=createHash('sha256').update(identity.subjectId).digest('hex');
 const binding=await db.from('enterprise_sign_in_identities').select('user_id').eq('connection_id',flow.connection_id).eq('subject_hash',subjectHash).maybeSingle();if(binding.error)throw new Error('The organization identity could not be loaded.');
 let userId=binding.data?.user_id;
 if(flow.link_user_id) {
  if(currentUserId!==flow.link_user_id)throw new Error('Use the same local account to link organization sign-in.');
  await requireEnterpriseMember(db,flow.link_user_id,flow.org_id);
  if(userId&&userId!==flow.link_user_id)throw new Error('This identity is already linked to another account.');
  if(!userId){const linked=await db.from('enterprise_sign_in_identities').insert({connection_id:flow.connection_id,subject_hash:subjectHash,user_id:flow.link_user_id});if(linked.error)throw new Error('This identity could not be linked.');userId=flow.link_user_id;}
 }
 if(!userId)throw new Error('Use your local account to link organization sign-in first.');
 await requireEnterpriseMember(db,userId,flow.org_id);
 // The trusted local user is identified by connection + subject, never by the claimed email.
 const account=await db.auth.admin.getUserById(userId);
 if(account.error||!account.data.user?.email)throw new Error('The local account is unavailable.');
 const generated=await db.auth.admin.generateLink({type:'magiclink',email:account.data.user.email});
 if(generated.error||!generated.data.properties?.hashed_token||generated.data.user?.id!==userId)throw new Error('The local session could not be prepared.');
 return generated.data.properties.hashed_token;
}
