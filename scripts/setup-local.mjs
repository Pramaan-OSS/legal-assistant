import { randomBytes, createHmac } from 'node:crypto';
import { readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function setupLocal(root) {
  const path = resolve(root, '.env');
  let text = readFileSync(existsSync(path) ? path : resolve(root, '.env.example'), 'utf8');
  const values = new Map();
  for (const line of text.split('\n')) {
    const match = line.match(/^([A-Z_][A-Z_0-9]*)=(.*)$/);
    if (match) values.set(match[1], match[2].trim());
  }
  const put = (key, value) => {
    if (values.get(key)) return;
    const entry = `${key}=${value}`;
    const regex = new RegExp(`^${key}=.*$`, 'm');
    text = regex.test(text) ? text.replace(regex, () => entry) : `${text.trimEnd()}\n${entry}\n`;
    values.set(key, value);
  };
  for (const key of ['AUTH_HANDOFF_ENCRYPTION_SECRET', 'DOWNLOAD_SIGNING_SECRET', 'LOCAL_JWT_SECRET']) put(key, randomBytes(48).toString('hex'));
  put('SEND_EMAIL_HOOK_SECRET', `v1,whsec_${randomBytes(32).toString('base64')}`);
  const jwt = role => {
    const head = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ role, iss: 'local', iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+10*365*86400 })).toString('base64url');
    return `${head}.${body}.${createHmac('sha256', values.get('LOCAL_JWT_SECRET')).update(`${head}.${body}`).digest('base64url')}`;
  };
  put('SUPABASE_PUBLISHABLE_KEY', jwt('anon'));
  put('SUPABASE_SECRET_KEY', jwt('service_role'));
  writeFileSync(path, text, { mode: 0o600 });
  chmodSync(path, 0o600);
  if (!values.get('PRAMAAN_API_KEY')) console.log('Add PRAMAAN_API_KEY to .env');
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) setupLocal(process.argv[2] ?? process.cwd());
