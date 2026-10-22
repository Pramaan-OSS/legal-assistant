import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
const fixture = vi.hoisted(() => ({ owner: 'owner', expires: '', status: 'pending_upload' }));
vi.mock('../../lib/supabase', () => ({ createServerSupabase: () => ({ from(table: string) {
 const filters: Record<string, unknown> = {};
 const chain = { select: () => chain, eq: (key: string, value: unknown) => { filters[key] = value; return chain; }, maybeSingle: async () => {
  const row: Record<string, unknown> = table === 'upload_session_files'
   ? { staging_storage_path: 'upload-sessions/s/f.pdf', session_id: 'session', content_type: 'application/pdf', expected_size_bytes: 3, status: fixture.status }
   : { id: 'session', user_id: fixture.owner, status: fixture.status, expires_at: fixture.expires };
  return { data: Object.entries(filters).every(([key,value]) => row[key] === value) ? row : null, error: null };
 } }; return chain;
 } }) }));
import { blobUploadHandler } from '../../modules/downloads/downloads.routes';
import { downloadFile, uploadFile } from '../../lib/storage';
let root: string;
const token = () => Buffer.from(JSON.stringify({ p: 'upload-sessions/s/f.pdf', t: 'application/pdf', s: 3 })).toString('base64url');
function app() {
 const app = express();
 app.put('/download/upload/:token', (req,res,next) => { const userId = req.get('x-test-user'); if (!userId) { res.sendStatus(401); return; } res.locals.userId = userId; next(); }, blobUploadHandler);
 app.use(express.json()); return app;
}
beforeEach(async () => { root = await mkdtemp(path.resolve('.upload-test-')); vi.stubEnv('STORAGE_FS_ROOT', root); vi.stubEnv('PRAMAAN_API_KEY', ''); fixture.owner = 'owner'; fixture.expires = new Date(Date.now() + 60000).toISOString(); fixture.status = 'pending_upload'; });
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });
it('requires an app session before reading upload descriptors', async () => {
 expect((await request(app()).put('/download/upload/'+token()).set('Content-Type','application/pdf').send(Buffer.from('abc'))).status).toBe(401);
});
it('streams exact owned bytes before the JSON parser runs', async () => {
 const response = await request(app()).put('/download/upload/'+token()).set('x-test-user','owner').set('Content-Type','application/pdf').send(Buffer.from('abc'));
 expect(response.status).toBe(200); expect(Buffer.from((await downloadFile('upload-sessions/s/f.pdf'))!).toString()).toBe('abc');
});
it('denies another user even when they possess the same descriptor', async () => {
 expect((await request(app()).put('/download/upload/'+token()).set('x-test-user','other-user').set('Content-Type','application/pdf').send(Buffer.from('abc'))).status).toBe(403);
 expect(await downloadFile('upload-sessions/s/f.pdf')).toBeNull();
});
it('rejects expired and completed upload sessions', async () => {
 fixture.expires = new Date(Date.now()-1000).toISOString();
 expect((await request(app()).put('/download/upload/'+token()).set('x-test-user','owner').send('abc')).status).toBe(403);
 fixture.expires = new Date(Date.now()+60000).toISOString(); fixture.status = 'ready';
 expect((await request(app()).put('/download/upload/'+token()).set('x-test-user','owner').send('abc')).status).toBe(403);
});
it('checks immutable media type and expected size before writing', async () => {
 const changed = Buffer.from(JSON.stringify({ p: 'upload-sessions/s/f.pdf', t: 'application/pdf', s: 4 })).toString('base64url');
 expect((await request(app()).put('/download/upload/'+changed).set('x-test-user','owner').send('abcd')).status).toBe(403);
 expect((await request(app()).put('/download/upload/'+token()).set('x-test-user','owner').set('Content-Type','text/plain').send('abc')).status).toBe(400);
});
it('rejects short bodies without replacing existing bytes', async () => {
 await uploadFile('upload-sessions/s/f.pdf', new TextEncoder().encode('old').buffer, 'application/pdf');
 expect((await request(app()).put('/download/upload/'+token()).set('x-test-user','owner').set('Content-Type','application/pdf').send(Buffer.from('ab'))).status).toBe(400);
 expect(Buffer.from((await downloadFile('upload-sessions/s/f.pdf'))!).toString()).toBe('old');
});
