import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {setPramaanClientForTests,type PramaanClient} from '../pramaan';
import {createEnterpriseConnection,listEnterpriseConnections,deleteEnterpriseConnection,startEnterpriseSignIn,redeemEnterpriseSignIn} from '../enterpriseSignIn';
const org='org-one',ref='ref_enterprise_fake';
let tables:Record<string,Record<string,unknown>[]>;const call=vi.fn(),getUserById=vi.fn(),generateLink=vi.fn();
function db(){return {auth:{admin:{getUserById,generateLink}},from(table:string){let filters:((r:Record<string,unknown>)=>boolean)[]=[],action='select',input:Record<string,unknown>={},ran=false,result:{data:Record<string,unknown>[];error:null|{message:string}};
 const run=()=>{if(ran)return result;ran=true;tables[table]??=[];let rows=tables[table].filter(r=>filters.every(f=>f(r)));
 if(action==='insert'){if(table==='enterprise_sign_in_identities'&&tables[table].some(r=>r.connection_id===input.connection_id&&(r.subject_hash===input.subject_hash||r.user_id===input.user_id)))return result={data:[],error:{message:'duplicate'}};const row={id:randomUUID(),consumed:false,...input};tables[table].push(row);rows=[row];}
 if(action==='update')for(const row of rows)Object.assign(row,input);
 if(action==='delete')tables[table]=tables[table].filter(r=>!rows.includes(r));
 return result={data:rows.map(r=>({...r})),error:null};};
 const chain={select:()=>chain,eq:(key:string,value:unknown)=>{filters.push(r=>r[key]===value);return chain;},gt:(key:string,value:string)=>{filters.push(r=>String(r[key])>value);return chain;},insert:(value:Record<string,unknown>)=>{action='insert';input=value;return chain;},update:(value:Record<string,unknown>)=>{action='update';input=value;return chain;},delete:()=>{action='delete';return chain;},single:async()=>{const r=run();return {data:r.data[0]??null,error:r.error};},maybeSingle:async()=>{const r=run();return {data:r.data[0]??null,error:r.error};},then:(done:(r:ReturnType<typeof run>)=>unknown)=>Promise.resolve(run()).then(done)};return chain;}} as never;}
beforeEach(()=>{
 vi.stubEnv('FRONTEND_URL','https://app.example.test');tables={org_members:[{org_id:org,user_id:'admin',role:'admin'},{org_id:org,user_id:'member',role:'member'}],organization_sign_in_connections:[],enterprise_sign_in_flows:[],enterprise_sign_in_identities:[]};
 getUserById.mockReset().mockResolvedValue({data:{user:{id:'member',email:'local@account.example'}},error:null});generateLink.mockReset().mockResolvedValue({data:{user:{id:'member'},properties:{hashed_token:'local-proof'}},error:null});
 const starts=new Map<string,Record<string,unknown>>();call.mockReset().mockImplementation(async(id,input)=>{
 if(id==='auth.enterprise-connection.create')return {ref,organizationRef:org,status:'ready'};
 if(id==='auth.enterprise-connections.list')return {results:[{ref,organizationRef:org,name:'Organization sign-in'}]};
 if(id==='auth.enterprise-connection.delete')return {deleted:true};
 if(id==='auth.enterprise.start'){starts.set(input.state,input);return {authorizationUrl:'https://platform.example.test/connect/link/fake',expiresAt:new Date(Date.now()+600000).toISOString()};}
 if(id==='auth.social.exchange'){const started=starts.get(input.state);if(!started||started.connectionRef!==input.connectionRef||started.nonce!==input.expectedNonce||started.redirectUri!==input.redirectUri||started.codeChallenge!==createHash('sha256').update(input.pkceVerifier).digest('base64url'))throw new Error('Not started');starts.delete(input.state);return {providerKey:'enterprise',subjectId:'subject-one',email:'unrelated@issuer.example',emailVerified:false};}
 throw new Error('Unexpected capability');});setPramaanClientForTests({call} as PramaanClient);
});
afterEach(()=>{setPramaanClientForTests();vi.unstubAllEnvs();});
async function installed(){return createEnterpriseConnection(db(),'admin',org,{issuer:'https://issuer.example.test',clientId:'public-client',tokenAuthMethod:'none'});}
async function started(){const connection=await installed();const result=await startEnterpriseSignIn(db(),org,connection.id,'member');const flow=tables.enterprise_sign_in_flows.find(f=>f.id===result.ticket)!;return {connection,result,flow};}
it('creates an owned connection only for an administrator and keeps secrets out of local storage',async()=>{
 await expect(createEnterpriseConnection(db(),'member',org,{issuer:'https://issuer.example.test',clientId:'client',tokenAuthMethod:'none'})).rejects.toThrow('access');expect(call).not.toHaveBeenCalled();
 await createEnterpriseConnection(db(),'admin',org,{issuer:'https://issuer.example.test',clientId:'client',tokenAuthMethod:'client_secret_post',clientSecret:'synthetic-secret'});
 expect(call.mock.calls[0][1]).toMatchObject({organizationRef:org,redirectUris:['https://app.example.test/auth/callback?enterprise=1'],clientSecret:'synthetic-secret'});expect(JSON.stringify(tables.organization_sign_in_connections)).not.toContain('synthetic-secret');expect(JSON.stringify(tables.organization_sign_in_connections)).not.toContain('issuer');
});
it('lists only the owning organization and exposes local codes, not platform references',async()=>{
 await installed();expect((await listEnterpriseConnections(db(),'admin',org)).results).toHaveLength(1);expect(JSON.stringify(await listEnterpriseConnections(db(),'admin',org))).not.toContain(ref);
 await expect(listEnterpriseConnections(db(),'admin','other-org')).rejects.toThrow('access');
});
it('deletes an administrator-owned connection and confirms the platform deletion',async()=>{
 const connection=await installed();await expect(deleteEnterpriseConnection(db(),'member',org,connection.id)).rejects.toThrow('access');await deleteEnterpriseConnection(db(),'admin',org,connection.id);
 expect(call.mock.calls.find(c=>c[0]==='auth.enterprise-connection.delete')?.[1]).toEqual({ref,confirm:true});expect(tables.organization_sign_in_connections).toHaveLength(0);
});
it('starts through the platform with state, nonce and S256 proof retained only server-side',async()=>{
 const {result,flow}=await started();expect(result.url).toContain('/connect/link/');expect(result).not.toHaveProperty('state');expect(call.mock.calls.find(c=>c[0]==='auth.enterprise.start')?.[1]).toMatchObject({connectionRef:ref,state:flow.state,nonce:flow.nonce});expect(String(flow.verifier)).toHaveLength(43);
});
it('redeems signed identity once and prepares the existing local account without email matching',async()=>{
 const {result,flow}=await started();expect(await redeemEnterpriseSignIn(db(),result.ticket,flow.state,'code','member')).toBe('local-proof');expect(generateLink).toHaveBeenCalledWith({type:'magiclink',email:'local@account.example'});expect(call.mock.calls.find(c=>c[0]==='auth.social.exchange')?.[1]).toMatchObject({providerKey:'enterprise',connectionRef:ref,state:flow.state,expectedNonce:flow.nonce,pkceVerifier:flow.verifier});
 await expect(redeemEnterpriseSignIn(db(),result.ticket,flow.state,'code','member')).rejects.toThrow('again');expect(call.mock.calls.filter(c=>c[0]==='auth.social.exchange')).toHaveLength(1);
});
it.each([undefined,'wrong-state'])('refuses missing or wrong state before any exchange (%s)',async state=>{
 const {result}=await started();await expect(redeemEnterpriseSignIn(db(),result.ticket,state,'code','member')).rejects.toThrow('again');expect(call.mock.calls.some(c=>c[0]==='auth.social.exchange')).toBe(false);
});
it('refuses a sign-in not started here without exchange or local session minting',async()=>{
 await expect(redeemEnterpriseSignIn(db(),'unknown-ticket','not-started-state','code')).rejects.toThrow('again');expect(call).not.toHaveBeenCalled();expect(generateLink).not.toHaveBeenCalled();
});
it('refuses a locally staged flow that the platform did not start',async()=>{
 const {result,flow}=await started();call.mockImplementation(async id=>{if(id==='auth.social.exchange')throw new Error('Platform start missing');throw new Error('Unexpected');});
 await expect(redeemEnterpriseSignIn(db(),result.ticket,flow.state,'code','member')).rejects.toThrow();expect(generateLink).not.toHaveBeenCalled();
});
it('refuses linking after the local signed-in account changes',async()=>{
 const {result,flow}=await started();await expect(redeemEnterpriseSignIn(db(),result.ticket,flow.state,'code','admin')).rejects.toThrow('same local account');expect(generateLink).not.toHaveBeenCalled();
});
it('allows later signed-out sign-in only for the bound subject and a current member',async()=>{
 const {connection,result,flow}=await started();await redeemEnterpriseSignIn(db(),result.ticket,flow.state,'first','member');const again=await startEnterpriseSignIn(db(),org,connection.id);const next=tables.enterprise_sign_in_flows.find(f=>f.id===again.ticket)!;expect(await redeemEnterpriseSignIn(db(),again.ticket,next.state,'second')).toBe('local-proof');
});
it('does not enroll an unknown subject during signed-out sign-in or create members',async()=>{
 const connection=await installed();const result=await startEnterpriseSignIn(db(),org,connection.id);const flow=tables.enterprise_sign_in_flows[0];await expect(redeemEnterpriseSignIn(db(),result.ticket,flow.state,'code')).rejects.toThrow('link organization sign-in first');expect(generateLink).not.toHaveBeenCalled();expect(tables.org_members).toHaveLength(2);
});
it('refuses membership removal during sign-in',async()=>{
 const {result,flow}=await started();tables.org_members=tables.org_members.filter(r=>r.user_id!=='member');await expect(redeemEnterpriseSignIn(db(),result.ticket,flow.state,'code','member')).rejects.toThrow('access');expect(generateLink).not.toHaveBeenCalled();
});

it('refuses an expired flow before platform exchange',async()=>{
 const {result,flow}=await started();flow.expires_at='2000-01-01T00:00:00Z';await expect(redeemEnterpriseSignIn(db(),result.ticket,flow.state,'code','member')).rejects.toThrow('again');expect(call.mock.calls.some(c=>c[0]==='auth.social.exchange')).toBe(false);
});
