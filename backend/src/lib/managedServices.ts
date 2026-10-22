import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHmac, randomUUID } from 'node:crypto';
import { callCapability, CapabilityCallError } from './pramaan';
import { UserFacingError } from './userFacingError';
export type ManagedState = {
  databaseAttempt?: string;
  signInAttempt?: string;
  domainAttempt?: { origin: string; key: string };
  authAvailable?: boolean;
  database?: { connectionString: string; directConnectionString: string };
  auth?: { authUrl: string; jwksUrl: string; origin?: string; domains?: string[] };
};
export const runtimeDirectory = () => process.env.MANAGED_RUNTIME_DIR || '/app/.runtime';
export function readManagedState(directory = runtimeDirectory()): ManagedState {
  const path=resolve(directory,'managed.json');
  if(!existsSync(path)) return {};
  chmodSync(path,0o600);return JSON.parse(readFileSync(path,'utf8')) as ManagedState;
}
export function saveManagedState(directory: string, state: ManagedState) {
  mkdirSync(directory,{recursive:true,mode:0o700}); chmodSync(directory,0o700);
  const path=resolve(directory,'managed.json'); const staging=path+'.'+randomUUID();
  writeFileSync(staging,JSON.stringify(state),{mode:0o600,flag:'wx'});
  renameSync(staging,path);
}
function databaseAddress(value: unknown): value is string {
  if(typeof value!=='string'||/\s/.test(value))return false;
  try {const url=new URL(value);return url.protocol==='postgresql:'&&!!url.hostname&&!!url.username&&!!url.password&&url.pathname.length>1&&!url.hash;} catch{return false;}
}
function setupRefusal(error: unknown): string {
  if (error instanceof CapabilityCallError) {
    if (error.message.includes('required action key')) return 'The request is missing its required action key.';
    if (error.code === 'invalid_request') return 'The service refused the setup request as invalid.';
    if (error.code === 'unauthorized' || error.code === 'forbidden') return 'The service refused permission for setup.';
    if (error.code === 'conflict') return 'The earlier setup request needs checking before retrying.';
    if (error.code === 'rate_limited') return 'The service is busy. Try again later.';
  }
  return 'Check the app address and private runtime configuration before trying again.';
}
export async function prepareDatabase(directory: string, log: (message:string)=>void=console.log) {
  const state=readManagedState(directory);
  if(!state.database && process.env.PRAMAAN_API_KEY?.trim()) {
    state.databaseAttempt ??= randomUUID(); saveManagedState(directory,state);
    try {
      const result=await callCapability('db.postgres.provision',{}, {idempotencyKey:state.databaseAttempt});
      if(result.created===false && (!databaseAddress(result.connectionString)||!databaseAddress(result.directConnectionString)))throw new UserFacingError('Managed database setup could not finish. This project already has a database. Restore its saved private runtime settings before starting.');
      if(!databaseAddress(result.connectionString)||!databaseAddress(result.directConnectionString)) {
        throw new Error('Managed database credentials are unavailable. Restore the saved private runtime file, or arrange approved credential recovery.');
      }
      state.database={connectionString:result.connectionString,directConnectionString:result.directConnectionString};
      saveManagedState(directory,state);
      if(result.status!=='ready')throw new Error('Resume the managed database before starting the app.');
    } catch(error) {
      if(error instanceof UserFacingError)throw error;
      if(!(error&&typeof error==='object'&&'code' in error&&error.code==='upstream_unavailable')) throw new UserFacingError('Managed database setup could not finish. ' + setupRefusal(error));
      log('Managed database is not available yet; using the bundled local database.');
    }
  }
  if(state.database && (!databaseAddress(state.database.connectionString)||!databaseAddress(state.database.directConnectionString))) throw new Error('The saved managed database credentials are invalid.');
  const local='postgresql://postgres:postgres@db:5432/postgres';
  const pooled=state.database?.connectionString ?? local;
  const direct=state.database?.directConnectionString ?? local;
  const authAddress=new URL(state.database?.directConnectionString ?? 'postgresql://supabase_auth_admin:postgres@db:5432/postgres');
  authAddress.searchParams.set('search_path','auth,public');
  const authDatabase=authAddress.href;
  mkdirSync(directory,{recursive:true,mode:0o700});chmodSync(directory,0o700);
  const secret=process.env.LOCAL_JWT_SECRET;
  if(!secret)throw new Error('Local session signing is not configured. Run the start command.');
  const encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const head=encode({alg:'HS256',typ:'JWT'});const body=encode({role:state.database?'app_owner':'service_role',iss:'local',exp:Math.floor(Date.now()/1000)+10*365*86400});
  const adminToken=`${head}.${body}.${createHmac('sha256',secret).update(`${head}.${body}`).digest('base64url')}`;
  const file=resolve(directory,'database.env');
  writeFileSync(file,`APP_DATABASE_URL=${pooled}\nAPP_DATABASE_DIRECT_URL=${direct}\nGOTRUE_DB_DATABASE_URL=${authDatabase}\nPGRST_DB_URI=${pooled}\nDATABASE_URL=${direct}\nDB=${direct}\nSUPABASE_SECRET_KEY=${adminToken}\n`,{mode:0o600});chmodSync(file,0o600);
  return {managed:Boolean(state.database)};
}

export const appOrigin = () => new URL(process.env.APP_URL || process.env.FRONTEND_URL || 'http://localhost:3000').origin;
function publicOrigin(origin: string) {
  const url=new URL(origin);
  return url.protocol==='https:' && !url.username && !url.password && !url.hostname.includes(':') && !/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) && url.hostname.includes('.') && !/(^|\.)(localhost|local|internal|test)$/.test(url.hostname);
}
export async function prepareManagedSignIn(directory: string, log: (message:string)=>void=console.log) {
  if(process.env.LOCAL_SIGN_IN==='1'||!process.env.PRAMAAN_API_KEY?.trim())return {managed:false};
  const state=readManagedState(directory);
  try {
    if(!state.auth) {
      state.signInAttempt ??= 'managed-signin-' + randomUUID(); saveManagedState(directory,state);
      const result=await callCapability('auth.backend.provision',{}, {idempotencyKey:state.signInAttempt});
      for(const address of [result.authUrl,result.jwksUrl]) {const url=new URL(address);if(url.protocol!=='https:'||url.username||url.password)throw new Error('Invalid sign-in configuration');}
      state.auth={authUrl:result.authUrl,jwksUrl:result.jwksUrl};saveManagedState(directory,state);
    }
    const origin=appOrigin();
    const origins=[...new Set([origin,...(process.env.WORD_ADDIN_URL?.trim()?[new URL(process.env.WORD_ADDIN_URL).origin]:[])])];
    for(const address of origins)if(!publicOrigin(address)&&new URL(address).hostname!=='localhost')throw new Error('Use localhost for development or a public HTTPS app address.');
    const domains=origins.filter(publicOrigin);const operation=domains.join('|');
    const previous=state.auth.domains??(state.auth.origin?[state.auth.origin]:[]);
    if(domains.length) {
      if(JSON.stringify(previous)!==JSON.stringify(domains)||state.domainAttempt) {
        if(state.domainAttempt?.origin!==operation)state.domainAttempt={origin:operation,key:'managed-domain-'+randomUUID()};
        saveManagedState(directory,state);
        await callCapability('auth.backend.domains.set',{domains}, {idempotencyKey:state.domainAttempt.key});
        state.auth.origin=origin;state.auth.domains=domains;delete state.domainAttempt;saveManagedState(directory,state);
      }
    } else log('Using the managed sign-in development address; no public domain update is needed.');
    state.authAvailable=true;saveManagedState(directory,state);
    return {managed:true};
  } catch(error) {
    if(error&&typeof error==='object'&&'code' in error&&error.code==='upstream_unavailable') {
      state.authAvailable=false;saveManagedState(directory,state);
      log('Managed sign-in is not available yet; using local sign-in.');return {managed:false};
    }
    throw new UserFacingError('Managed sign-in setup could not finish. ' + setupRefusal(error));
  }
}
export function managedSignInConfiguration() {
  if(process.env.LOCAL_SIGN_IN==='1'||!process.env.PRAMAAN_API_KEY?.trim())return null;
  const state=readManagedState();return state.authAvailable===true ? state.auth ?? null : null;
}

export function writePublicSignInConfiguration(directory: string) {
  const state=readManagedState(directory);
  const settings=process.env.LOCAL_SIGN_IN==='1'||!process.env.PRAMAAN_API_KEY?.trim()||!state.authAvailable ? null : {authUrl:state.auth?.authUrl};
  const path=resolve(directory,'public-auth.json');
  writeFileSync(path,JSON.stringify(settings),{mode:0o600});chmodSync(path,0o600);
}
