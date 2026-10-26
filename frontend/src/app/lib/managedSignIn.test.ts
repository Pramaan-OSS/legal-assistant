import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const auth=vi.hoisted(()=>({signIn:{email:vi.fn(),social:vi.fn()},signUp:{email:vi.fn()},requestPasswordReset:vi.fn(),resetPassword:vi.fn(),$fetch:vi.fn()}));
vi.mock('better-auth/client',()=>({createAuthClient:()=>auth}));
import { finishManagedSignIn, managedAddress, managedEmail, managedSocial, requestManagedPasswordReset, resetManagedPassword } from './managedSignIn';
beforeEach(()=>{
 const script=document.createElement('script');script.id='managed-auth-config';script.type='application/json';script.textContent=JSON.stringify({authUrl:'https://signin.example.test/api/auth'});document.body.append(script);
 sessionStorage.clear();auth.signIn.email.mockReset().mockResolvedValue({data:{},error:null});auth.signUp.email.mockReset().mockResolvedValue({data:{},error:null});auth.signIn.social.mockReset().mockResolvedValue({data:{},error:null});auth.$fetch.mockReset().mockResolvedValue({data:{token:'private-session-proof'},error:null});
 vi.stubGlobal('fetch',vi.fn(async(input)=>new Response(JSON.stringify(String(input).endsWith('/start')?{state:'browser-flow'}:{user:{id:'reader'}}),{headers:{'Content-Type':'application/json'}})));
});
afterEach(()=>{document.getElementById('managed-auth-config')?.remove();sessionStorage.clear();vi.unstubAllGlobals();});
it.each([false,true])('managed email signup=%s redeems a token for the normal app session',async signup=>{
 await expect(managedEmail('reader@example.test','private-password',signup)).resolves.toMatchObject({user:{id:'reader'}});
 expect(signup?auth.signUp.email:auth.signIn.email).toHaveBeenCalledOnce();
 expect(fetch).toHaveBeenLastCalledWith('/api/auth/managed/redeem',expect.objectContaining({body:JSON.stringify({state:'browser-flow',token:'private-session-proof'})}));
});
it('never opens a local session when the sign-in client refuses a token',async()=>{
 auth.$fetch.mockResolvedValue({data:null,error:{status:401}});
 await expect(managedEmail('reader@example.test','password')).rejects.toThrow('could not be verified');
 expect(fetch).toHaveBeenCalledTimes(1);
});
it('starts social sign-in with the app-owned callback and cannot redeem the flow twice',async()=>{
 await managedSocial();expect(auth.signIn.social).toHaveBeenCalledWith({provider:'google',callbackURL:new URL('/auth/managed/return',location.origin).href});
 await finishManagedSignIn();await expect(finishManagedSignIn()).rejects.toThrow('Start sign-in again');
});
it('without published managed settings preserves optional local sign-in',()=>{
 document.getElementById('managed-auth-config')?.remove();expect(managedAddress()).toBeNull();
});

it('finishes the callback cookie before requesting a token and removes the verifier from the address',async()=>{
 const key='neon_auth_session_verifier';history.replaceState(null,'','/auth/managed/return?'+key+'=test-verifier&keep=yes');sessionStorage.setItem('managed-sign-in-state','browser-flow');
 try{await finishManagedSignIn();expect(auth.$fetch.mock.calls[0]).toEqual(['/get-session',{method:'GET',query:{[key]:'test-verifier'}}]);expect(auth.$fetch.mock.calls[1]).toEqual(['/token',{method:'GET'}]);expect(location.search).toBe('?keep=yes');}finally{history.replaceState(null,'','/');}
});
it('a refused callback cookie never requests a token or opens an app session',async()=>{
 const key='neon_auth_session_verifier';history.replaceState(null,'','/auth/managed/return?'+key+'=test-verifier');sessionStorage.setItem('managed-sign-in-state','browser-flow');auth.$fetch.mockResolvedValueOnce({error:{status:401}});
 try{await expect(finishManagedSignIn()).rejects.toThrow('could not be verified');expect(auth.$fetch).toHaveBeenCalledTimes(1);expect(fetch).not.toHaveBeenCalled();expect(location.search).toBe('');}finally{history.replaceState(null,'','/');}
});

it('managed recovery uses only the backend reset flow and requires published readiness',async()=>{
 await expect(requestManagedPasswordReset('reader@example.test')).rejects.toThrow('not available yet');
 document.getElementById('managed-auth-config')!.textContent=JSON.stringify({authUrl:'https://signin.example.test/api/auth',recoveryEnabled:true});
 auth.requestPasswordReset.mockResolvedValue({data:{},error:null});auth.resetPassword.mockResolvedValue({data:{},error:null});
 await requestManagedPasswordReset('reader@example.test');
 expect(auth.requestPasswordReset).toHaveBeenCalledWith({email:'reader@example.test',redirectTo:new URL('/reset-password?managed=1',location.origin).href});
 await resetManagedPassword('new-private-password','one-use-token');
 expect(auth.resetPassword).toHaveBeenCalledWith({newPassword:'new-private-password',token:'one-use-token'});
 expect(fetch).not.toHaveBeenCalled();
 auth.resetPassword.mockResolvedValue({error:{status:400}});
 await expect(resetManagedPassword('new-private-password','expired-token')).rejects.toThrow('invalid or expired');
 auth.requestPasswordReset.mockResolvedValue({error:{status:503}});
 await expect(requestManagedPasswordReset('reader@example.test')).rejects.toThrow('could not be confirmed');
});
