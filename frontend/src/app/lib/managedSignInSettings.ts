import 'server-only';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
export function publicManagedSettings() {
 const candidates=process.env.MANAGED_RUNTIME_DIR
  ? [resolve(process.env.MANAGED_RUNTIME_DIR,'public-auth.json')]
  : [resolve(process.cwd(),'.runtime/public-auth.json'),resolve(process.cwd(),'../.runtime/public-auth.json')];
 for(const path of candidates)try {
  const parsed=JSON.parse(readFileSync(path,'utf8')) as {authUrl?:string;recoveryEnabled?:boolean}|null;
  if(!parsed?.authUrl||new URL(parsed.authUrl).protocol!=='https:')return null;
  return {authUrl:parsed.authUrl,...(parsed.recoveryEnabled===true?{recoveryEnabled:true}:{})};
 }catch{/* Missing public settings keep the local sign-in fallback available. */}
 return null;
}
