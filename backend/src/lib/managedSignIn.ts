import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Db } from './supabase';
import { callCapability } from './pramaan';
import { appOrigin, managedSignInConfiguration } from './managedServices';
export class ManagedSignInError extends Error {
  constructor(){super('Managed sign-in could not be verified. Start sign-in again.');}
}
const pending=new Map<string,number>();
const COOKIE='legal-assistant-managed';
export function startManagedFlow() {
  if(!managedSignInConfiguration())throw new ManagedSignInError();
  for(const [key,expiry] of pending)if(expiry<Date.now())pending.delete(key);
  if(pending.size>=1000)throw new ManagedSignInError();
  const state=randomBytes(32).toString('base64url');pending.set(state,Date.now()+10*60_000);
  return {state,cookie:COOKIE};
}
export function consumeManagedFlow(state:unknown,cookies:string) {
  if(typeof state!=='string'||state.length>100)throw new ManagedSignInError();
  const cookie=cookies.split(';').map(v=>v.trim()).find(v=>v.startsWith(COOKIE+'='))?.slice(COOKIE.length+1)??'';
  const expiry=pending.get(state);pending.delete(state);
  const a=Buffer.from(state),b=Buffer.from(cookie);
  if(!expiry||expiry<Date.now()||a.length!==b.length||!timingSafeEqual(a,b))throw new ManagedSignInError();
}
export async function redeemManagedToken(db:Db,token:string,authorizedParty=appOrigin()) {
  const configuration=managedSignInConfiguration();
  if(!configuration||!token||token.length>8192)throw new ManagedSignInError();
  let proof;
  try {proof=await callCapability('auth.token.verify',{token,audience:new URL(configuration.authUrl).origin,authorizedParties:[authorizedParty]});}catch{throw new ManagedSignInError();}
  if(!proof.valid||!proof.userId)throw new ManagedSignInError();
  // Claims are read only after signature, issuer and audience verification by the platform.
  let claims:Record<string,unknown>={};
  try {claims=JSON.parse(Buffer.from(token.split('.')[1]??'','base64url').toString()) as Record<string,unknown>;}catch{throw new ManagedSignInError();}
  const origin=new URL(configuration.authUrl).origin;
  if(claims.sub!==proof.userId||claims.iss!==origin||!(claims.aud===origin||Array.isArray(claims.aud)&&claims.aud.includes(origin)))throw new ManagedSignInError();
  const signedEmail=typeof claims.email==='string'?claims.email.trim().toLowerCase():undefined;
  const verifiedEmail=(claims.email_verified===true||claims.emailVerified===true)&&typeof claims.email==='string' ? claims.email.trim().toLowerCase():undefined;
  const allowed=(process.env.ALLOWED_SIGN_IN??'').split(',').map(v=>v.trim()).filter(Boolean);
  if(allowed.length&&!allowed.includes(proof.userId)&&(!verifiedEmail||!allowed.some(value=>value.toLowerCase()===verifiedEmail)))throw new ManagedSignInError();
  const hash=createHash('sha256').update(new URL(configuration.authUrl).origin+'\n'+proof.userId).digest('hex');
  const id=`${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
  const account=await db.auth.admin.getUserById(id);
  let user=account.data?.user;
  if(account.error&&account.error.status!==404)throw new ManagedSignInError();
  if(!user) {
    const created=await db.auth.admin.createUser({id,email:`${hash}@managed.invalid`,password:randomBytes(48).toString('base64url'),email_confirm:true,app_metadata:{managed_subject_hash:hash,managed_subject_id:proof.userId,managed_email:signedEmail??'',connected_sign_in:true}});
    if(created.error||!created.data.user)throw new ManagedSignInError();user=created.data.user;
  }
  // Never bind a managed subject to an existing account merely because its email matches.
  if(user.id!==id||user.app_metadata?.managed_subject_hash!==hash||!user.email)throw new ManagedSignInError();
  const generated=await db.auth.admin.generateLink({type:'magiclink',email:user.email});
  if(generated.error||generated.data.user?.id!==id||!generated.data.properties?.hashed_token)throw new ManagedSignInError();
  return generated.data.properties.hashed_token;
}

export async function removeManagedAccount(db:Db,userId:string,operation:string) {
 const account=await db.auth.admin.getUserById(userId);
 if(account.error&&account.error.status!==404)throw new ManagedSignInError();
 const subject=account.data?.user?.app_metadata?.managed_subject_id;
 if(typeof subject!=='string')return;
 await callCapability('auth.user.delete',{userId:subject,confirm:true},{idempotencyKey:`managed-account-delete:${operation}`});
}
