import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { setPramaanClientForTests } from '../pramaan';
import { saveManagedState } from '../managedServices';
import { consumeManagedFlow, redeemManagedToken, startManagedFlow } from '../managedSignIn';
import type { Db } from '../supabase';
let directory:string;const call=vi.fn();
const token=(claims:Record<string,unknown>)=>`header.${Buffer.from(JSON.stringify({iss:'https://auth.example.com',aud:'https://auth.example.com',...claims})).toString('base64url')}.signature`;
beforeEach(()=>{
 mkdirSync(resolve('../.scratch'),{recursive:true});directory=mkdtempSync(resolve('../.scratch/sign-in-'));
 vi.stubEnv('MANAGED_RUNTIME_DIR',directory);vi.stubEnv('APP_URL','http://localhost:3000');vi.stubEnv('LOCAL_SIGN_IN','');vi.stubEnv('ALLOWED_SIGN_IN','');
 saveManagedState(directory,{authAvailable:true,auth:{authUrl:'https://auth.example.com/auth',jwksUrl:'https://auth.example.com/keys'}});
 call.mockReset();setPramaanClientForTests({call});
});
afterEach(()=>rmSync(directory,{recursive:true,force:true}));
function database() {
 let account:Record<string,unknown>|null=null;
 const admin={getUserById:vi.fn(async()=>({data:{user:account},error:account?null:{status:404}})),
 createUser:vi.fn(async(input:Record<string,unknown>)=>{account=input;return {data:{user:input},error:null};}),
 generateLink:vi.fn(async()=>({data:{user:account,properties:{hashed_token:'private-local-session-proof'}},error:null}))};
 return {db:{auth:{admin}} as unknown as Db,admin};
}
it('checks the platform proof before opening a subject-bound local session, and reuses that identity',async()=>{
 const {db,admin}=database();const signed=token({sub:'member-one',email:'reader@example.test'});call.mockResolvedValue({valid:true,userId:'member-one',sessionId:'session-one',orgId:null,expiresAt:'2099-01-01T00:00:00.000Z'});
 expect(await redeemManagedToken(db,signed)).toBe('private-local-session-proof');
 await redeemManagedToken(db,signed);expect(admin.createUser).toHaveBeenCalledTimes(1);
 expect(call.mock.calls[0].slice(0,2)).toMatchObject(['auth.token.verify',{token:signed,authorizedParties:['http://localhost:3000']}]);
 expect(admin.createUser.mock.calls[0][0]).toMatchObject({email_confirm:true,app_metadata:{connected_sign_in:true,managed_email:'reader@example.test'}});
});
it.each([false,'refused'])('refuses %s proof without creating any local user or session',async mode=>{
 const {db,admin}=database();if(mode===false)call.mockResolvedValue({valid:false});else call.mockRejectedValue({code:'upstream_unavailable'});
 await expect(redeemManagedToken(db,token({sub:'member-one'}))).rejects.toThrow('could not be verified');
 expect(admin.createUser).not.toHaveBeenCalled();expect(admin.generateLink).not.toHaveBeenCalled();
});
it('rejects a subject mismatch and unverified allow-list email',async()=>{
 const {db,admin}=database();call.mockResolvedValue({valid:true,userId:'member-one'});
 await expect(redeemManagedToken(db,token({sub:'other-member'}))).rejects.toThrow();
 vi.stubEnv('ALLOWED_SIGN_IN','member@example.test');
 await expect(redeemManagedToken(db,token({sub:'member-one',email:'member@example.test',emailVerified:false}))).rejects.toThrow();
 expect(admin.createUser).not.toHaveBeenCalled();
});
it('accepts an exact allowed verified identity but never binds by an existing email',async()=>{
 const {db,admin}=database();call.mockResolvedValue({valid:true,userId:'member-one'});vi.stubEnv('ALLOWED_SIGN_IN','member@example.test');
 await redeemManagedToken(db,token({sub:'member-one',email:'member@example.test',emailVerified:true}));
 expect(admin.createUser.mock.calls[0][0].email).toMatch(/@managed.invalid$/);
});
it('requires and consumes the same browser flow once',()=>{
 const flow=startManagedFlow();consumeManagedFlow(flow.state,`${flow.cookie}=${flow.state}`);
 expect(()=>consumeManagedFlow(flow.state,`${flow.cookie}=${flow.state}`)).toThrow();
 const wrong=startManagedFlow();expect(()=>consumeManagedFlow(wrong.state,`${wrong.cookie}=different`)).toThrow();
});
it('the existing erasure feature deletes the managed identity through the client',async()=>{
 const {removeManagedAccount}=await import('../managedSignIn.js');const {db,admin}=database();
 call.mockResolvedValue({valid:true,userId:'member-one'});await redeemManagedToken(db,token({sub:'member-one'}));
 vi.stubEnv('LOCAL_SIGN_IN','1');call.mockResolvedValue({deleted:true});const account=(await admin.getUserById()).data.user;
 await removeManagedAccount(db,account!.id as string,'erase-one');
 expect(call.mock.calls.at(-1)?.slice(0,2)).toEqual(['auth.user.delete',{userId:'member-one',confirm:true}]);
});

it('refuses a token for a different cached backend even if another project verified its signature',async()=>{
 const {db,admin}=database();call.mockResolvedValue({valid:true,userId:'member-one'});
 await expect(redeemManagedToken(db,token({sub:'member-one',iss:'https://other.example.com'}))).rejects.toThrow();
 await expect(redeemManagedToken(db,token({sub:'member-one',aud:'https://other.example.com'}))).rejects.toThrow();
 expect(admin.createUser).not.toHaveBeenCalled();
});
