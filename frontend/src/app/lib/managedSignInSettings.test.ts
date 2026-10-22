import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
vi.mock('server-only',()=>({}));
import {publicManagedSettings} from './managedSignInSettings';
let directory:string;
beforeEach(()=>{mkdirSync(resolve('../.scratch'),{recursive:true});directory=mkdtempSync(resolve('../.scratch/settings-'));});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();rmSync(directory,{recursive:true,force:true});});
function publish(value:unknown){mkdirSync(resolve(directory,'.runtime'),{recursive:true});writeFileSync(resolve(directory,'.runtime/public-auth.json'),JSON.stringify(value),{mode:0o600});}
it('finds the shared runtime when started from the frontend directory',()=>{
 vi.stubEnv('MANAGED_RUNTIME_DIR','');publish({authUrl:'https://signin.example.test/auth',private:'not published'});
 const cwd=vi.spyOn(process,'cwd').mockReturnValue(resolve(directory,'frontend'));
 try{expect(publicManagedSettings()).toEqual({authUrl:'https://signin.example.test/auth'});}finally{cwd.mockRestore();}
});
it('an explicit test runtime cannot fall through to another runtime',()=>{
 publish({authUrl:'https://signin.example.test/auth'});vi.stubEnv('MANAGED_RUNTIME_DIR',resolve(directory,'missing'));
 const cwd=vi.spyOn(process,'cwd').mockReturnValue(directory);
 try{expect(publicManagedSettings()).toBeNull();}finally{cwd.mockRestore();}
});
it.each([null,{authUrl:'http://signin.example.test'},{}])('keeps invalid public settings unavailable: %s',value=>{
 publish(value);vi.stubEnv('MANAGED_RUNTIME_DIR',resolve(directory,'.runtime'));expect(publicManagedSettings()).toBeNull();
});
