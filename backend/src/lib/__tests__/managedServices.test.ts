import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { prepareDatabase, prepareManagedSignIn, readManagedState } from '../managedServices';
import { setPramaanClientForTests } from '../pramaan';
let directory:string;const call=vi.fn();
beforeEach(()=>{vi.stubEnv('WORD_ADDIN_URL','');vi.stubEnv('LOCAL_JWT_SECRET','private-startup-session-secret-for-tests');mkdirSync(resolve('../.scratch'),{recursive:true});directory=mkdtempSync(resolve('../.scratch/database-'));call.mockReset();setPramaanClientForTests({call});});
afterEach(()=>rmSync(directory,{recursive:true,force:true}));
it('saves once-only addresses privately and reuses them without provisioning again',async()=>{
 call.mockResolvedValue({status:'ready',created:true,connectionString:'postgresql://app_owner:private@db.example.test/app',directConnectionString:'postgresql://app_owner:private@direct.example.test/app'});
 const log=vi.fn();expect(await prepareDatabase(directory,log)).toEqual({managed:true});
 expect(await prepareDatabase(directory,log)).toEqual({managed:true});expect(call).toHaveBeenCalledTimes(1);
 expect(statSync(resolve(directory,'managed.json')).mode&0o777).toBe(0o600);
 expect(statSync(resolve(directory,'database.env')).mode&0o777).toBe(0o600);
 expect(readFileSync(resolve(directory,'database.env'),'utf8')).toContain('APP_DATABASE_URL=postgresql:');
 expect(readFileSync(resolve(directory,'database.env'),'utf8')).toContain('search_path=auth%2Cpublic');
 expect(log).not.toHaveBeenCalled();
});
it('falls back only when the platform says unavailable and prints no credential',async()=>{
 call.mockRejectedValue({code:'upstream_unavailable',effect:'none'});const log=vi.fn();
 expect(await prepareDatabase(directory,log)).toEqual({managed:false});
 expect(log).toHaveBeenCalledWith('Managed database is not available yet; using the bundled local database.');
 expect(readManagedState(directory).database).toBeUndefined();
 expect(readFileSync(resolve(directory,'database.env'),'utf8')).toContain('GOTRUE_DB_DATABASE_URL=postgresql://supabase_auth_admin:');
});
it('a lost once-only response never creates new credentials or silently changes databases',async()=>{
 call.mockRejectedValue({code:'conflict'});await expect(prepareDatabase(directory,vi.fn())).rejects.toThrow('Managed database setup');
 const key=readManagedState(directory).databaseAttempt;
 await expect(prepareDatabase(directory,vi.fn())).rejects.toThrow();expect(readManagedState(directory).databaseAttempt).toBe(key);
 expect(call.mock.calls[0][2].idempotencyKey).toBe(call.mock.calls[1][2].idempotencyKey);
});
it('without a key starts local infrastructure without any provisioning request',async()=>{
 vi.stubEnv('PRAMAAN_API_KEY','');expect(await prepareDatabase(directory,vi.fn())).toEqual({managed:false});expect(call).not.toHaveBeenCalled();
});

it('provisions managed sign-in once and uses localhost development defaults without a domain call',async()=>{
vi.stubEnv('APP_URL','http://localhost:3000');
 call.mockResolvedValue({status:'ready',authUrl:'https://auth.example.com/auth',jwksUrl:'https://auth.example.com/keys'});
 const log=vi.fn();expect(await prepareManagedSignIn(directory,log)).toEqual({managed:true});
 await prepareManagedSignIn(directory,log);expect(call).toHaveBeenCalledTimes(1);
 expect(log).toHaveBeenCalledWith('Using the managed sign-in development address; no public domain update is needed.');
});
it('sets only the app public HTTPS origin and remembers it across restarts',async()=>{
vi.stubEnv('APP_URL','https://app.example.com');
 call.mockImplementation(async(id)=>id==='auth.backend.provision'?{status:'ready',authUrl:'https://auth.example.com/auth',jwksUrl:'https://auth.example.com/keys'}:{allowedDomains:['https://app.example.com']});
 await prepareManagedSignIn(directory,vi.fn());await prepareManagedSignIn(directory,vi.fn());expect(call).toHaveBeenCalledTimes(2);
 expect(call.mock.calls[1][1]).toEqual({domains:['https://app.example.com']});
});
it('refused managed sign-in leaves local sign-in available',async()=>{
call.mockRejectedValue({code:'upstream_unavailable'});
 expect(await prepareManagedSignIn(directory,vi.fn())).toEqual({managed:false});expect(readManagedState(directory).authAvailable).toBe(false);
});
it('retains once-only credentials even when the newly restored database is paused',async()=>{
 call.mockResolvedValue({status:'paused',created:true,connectionString:'postgresql://app_owner:private@db.example.test/app',directConnectionString:'postgresql://app_owner:private@direct.example.test/app'});
 await expect(prepareDatabase(directory,vi.fn())).rejects.toThrow();expect(readManagedState(directory).database).toBeDefined();
});
it('does not treat an unregistered plain HTTP public address as a development origin',async()=>{
 vi.stubEnv('APP_URL','http://app.example.com');call.mockResolvedValue({status:'ready',authUrl:'https://auth.example.com/auth',jwksUrl:'https://auth.example.com/keys'});
 await expect(prepareManagedSignIn(directory,vi.fn())).rejects.toThrow('Check the app address');
 expect(call).toHaveBeenCalledTimes(1);
});

it('a refused provisioning request retains its saved key across a process-style restart',async()=>{
 call.mockRejectedValue({code:'invalid_request',message:'Idempotency-Key header is required for this capability.'});
 await expect(prepareManagedSignIn(directory,vi.fn())).rejects.toThrow('required action key');
 const key=readManagedState(directory).signInAttempt;expect(key).toMatch(/^managed-signin-/);
 await expect(prepareManagedSignIn(directory,vi.fn())).rejects.toThrow('required action key');
 expect(call.mock.calls.map(row=>row[2].idempotencyKey)).toEqual([key,key]);
 expect(readManagedState(directory).auth).toBeUndefined();
});
it('an uncertain domain update reuses its saved key and changes it only for a different origin',async()=>{
 vi.stubEnv('APP_URL','https://first.example.com');let refused=true;
 call.mockImplementation(async(id)=>{if(id==='auth.backend.provision')return {status:'ready',authUrl:'https://auth.example.com/auth',jwksUrl:'https://auth.example.com/keys'};if(refused)throw {code:'upstream_timeout'};return {allowedDomains:[]};});
 await expect(prepareManagedSignIn(directory,vi.fn())).rejects.toThrow();
 const key=readManagedState(directory).domainAttempt!.key;refused=false;
 await prepareManagedSignIn(directory,vi.fn());
 expect(call.mock.calls.filter(row=>row[0]==='auth.backend.domains.set').map(row=>row[2].idempotencyKey)).toEqual([key,key]);
 vi.stubEnv('APP_URL','https://second.example.com');await prepareManagedSignIn(directory,vi.fn());
 expect(call.mock.calls.at(-1)![2].idempotencyKey).not.toBe(key);
 expect(readManagedState(directory).domainAttempt).toBeUndefined();
});

it('registers the app-owned document host with the managed sign-in backend and reuses the domain operation',async()=>{
 vi.stubEnv('APP_URL','https://app.example.com');vi.stubEnv('WORD_ADDIN_URL','https://word.example.com');
 call.mockImplementation(async(id)=>id==='auth.backend.provision'?{status:'ready',authUrl:'https://auth.example.com/auth',jwksUrl:'https://auth.example.com/keys'}:{allowedDomains:[]});
 await prepareManagedSignIn(directory,vi.fn());await prepareManagedSignIn(directory,vi.fn());
 expect(call).toHaveBeenCalledTimes(2);expect(call.mock.calls[1][1]).toEqual({domains:['https://app.example.com','https://word.example.com']});
});

it('explains existing credentials are needed and never silently switches an existing database to a new local one',async()=>{
 call.mockResolvedValue({status:'ready',created:false});
 await expect(prepareDatabase(directory,vi.fn())).rejects.toThrow('Restore its saved private runtime settings');
 expect(readManagedState(directory).database).toBeUndefined();expect(call.mock.calls[0][2].idempotencyKey).toEqual(expect.any(String));
});
