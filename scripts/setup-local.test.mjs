import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { setupLocal } from './setup-local.mjs';
const scratch=join(process.cwd(),'.scratch');mkdirSync(scratch,{recursive:true});
test('first start creates private matching session keys and preserves them on restart', () => {
  const dir = mkdtempSync(join(scratch, 'legal-setup-'));
  try {
    writeFileSync(join(dir,'.env.example'), 'PRAMAAN_API_KEY=dummy\nDOWNLOAD_SIGNING_SECRET=\n');
    setupLocal(dir);
    const text = readFileSync(join(dir,'.env'),'utf8');
    const env = Object.fromEntries(text.trim().split('\n').map(line => {const i=line.indexOf('='); return [line.slice(0,i),line.slice(i+1)];}));
    assert.equal(statSync(join(dir,'.env')).mode & 0o777, 0o600);
    assert.ok(env.AUTH_HANDOFF_ENCRYPTION_SECRET.length >= 32);
    assert.notEqual(env.AUTH_HANDOFF_ENCRYPTION_SECRET, env.DOWNLOAD_SIGNING_SECRET);
    for (const [key,role] of [['SUPABASE_PUBLISHABLE_KEY','anon'],['SUPABASE_SECRET_KEY','service_role']]) {
      const [head,body,signature]=env[key].split('.');
      assert.equal(JSON.parse(Buffer.from(body,'base64url')).role,role);
      assert.equal(signature,createHmac('sha256',env.LOCAL_JWT_SECRET).update(`${head}.${body}`).digest('base64url'));
    }
    setupLocal(dir);
    assert.equal(readFileSync(join(dir,'.env'),'utf8'),text);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('existing overrides remain and absent key gives a plain instruction without secrets', () => {
  const dir=mkdtempSync(join(scratch,'legal-setup-'));
  const original=console.log; const output=[];
  try {
    writeFileSync(join(dir,'.env'),'PRAMAAN_API_KEY=\nDOWNLOAD_SIGNING_SECRET=keep-this-private-value\n');
    console.log=value=>output.push(value);
    setupLocal(dir);
    assert.deepEqual(output,['Add PRAMAAN_API_KEY to .env']);
    assert.match(readFileSync(join(dir,'.env'),'utf8'), /DOWNLOAD_SIGNING_SECRET=keep-this-private-value/);
  } finally {console.log=original;rmSync(dir,{recursive:true,force:true});}
});
