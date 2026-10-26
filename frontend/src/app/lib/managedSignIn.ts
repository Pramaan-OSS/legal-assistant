'use client';
import { completeManagedReturn } from '@/shared/lib/managedReturn';
import { UserVisibleError } from './userFacingError';
import type { AuthUser } from './authApi';
export function managedAddress():string|null {
 if(typeof document==='undefined')return null;
 try {const settings=JSON.parse(document.getElementById('managed-auth-config')?.textContent??'null') as {authUrl?:string}|null;
  if(!settings?.authUrl||new URL(settings.authUrl).protocol!=='https:')return null;return settings.authUrl;
 } catch{return null;}
}
async function client() {
 const { createAuthClient } = await import('better-auth/client');
 const baseURL=managedAddress();if(!baseURL)throw new Error('Managed sign-in is not set up yet.');
 return createAuthClient({baseURL,fetchOptions:{retry:0}});
}
async function ownRequest(path:string,body:unknown) {
 const result=await fetch('/api/auth/managed/'+path,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify(body)});
 if(!result.ok)throw new Error('Managed sign-in could not finish. Start sign-in again.');
 return result.json();
}
async function start() {const {state}=await ownRequest('start',{});sessionStorage.setItem('managed-sign-in-state',state);return state as string;}
export async function finishManagedSignIn():Promise<{user:AuthUser}> {
 const state=sessionStorage.getItem('managed-sign-in-state');sessionStorage.removeItem('managed-sign-in-state');
 if(!state)throw new Error('Start sign-in again.');
 const auth=await client();
 await completeManagedReturn(query=>auth.$fetch('/get-session',{method:'GET',query}));
 const result=await auth.$fetch<{token:string}>('/token',{method:'GET'});
 const token=result.data?.token;
 if(result.error||!token)throw new Error('Managed sign-in could not be verified. Start sign-in again.');
 return ownRequest('redeem',{state,token});
}
export async function managedEmail(email:string,password:string,signup=false) {
 await start();const auth=await client();
 const response=signup?await auth.signUp.email({email,password,name:email.split('@')[0]}):await auth.signIn.email({email,password});
 if(response.error)throw new Error('Sign-in could not finish. Check your details and try again.');
 return finishManagedSignIn();
}
export async function managedSocial() {
 await start();const callbackURL=new URL('/auth/managed/return',window.location.origin).href;
 const result=await (await client()).signIn.social({provider:'google',callbackURL});
 if(result.error)throw new Error('Managed sign-in could not start. Try again.');
}

export function managedRecoveryEnabled(): boolean {
 try { return JSON.parse(document.getElementById('managed-auth-config')?.textContent ?? 'null')?.recoveryEnabled === true; } catch { return false; }
}
export async function requestManagedPasswordReset(email: string) {
 if(!managedRecoveryEnabled())throw new UserVisibleError('Password recovery is not available yet. Ask the app owner to configure its recovery sender.',{kind:'unavailable'});
 const result=await (await client()).requestPasswordReset({email,redirectTo:new URL('/reset-password?managed=1',window.location.origin).href});
 if(result.error)throw new UserVisibleError('The reset request could not be confirmed. Try again later.',{kind:'unavailable'});
}
export async function resetManagedPassword(newPassword: string, token: string) {
 if(!managedRecoveryEnabled())throw new UserVisibleError('Password recovery is not available yet.',{kind:'unavailable'});
 if(!token)throw new Error('This reset link is invalid or has expired. Request a new one.');
 const result=await (await client()).resetPassword({newPassword,token});
 if(result.error)throw new UserVisibleError('The password could not be changed. The link may be invalid or expired. Request a new one.',{kind:'validation'});
}
