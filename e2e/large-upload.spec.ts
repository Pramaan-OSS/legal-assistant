import { expect, test } from './fixtures';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

test.use({ storageState: { cookies: [], origins: [] } });
test('uploads a large document through the real storage module and fake multipart service', async ({ page }) => {
 test.setTimeout(60000);
 page.on("pageerror", error => console.error("Synthetic page error:", error.message));
 page.on("console", message => { if (message.type() === "error") console.error("Synthetic console:", message.text()); });
 const root = await fs.mkdtemp(path.resolve('.data/verification/large-browser-'));
 const base = 'http://127.0.0.1:3419';
 const fake = spawn(process.execPath, ['docs/verification/fake-pramaan.mjs'], { env: { ...process.env, FAKE_PRAMAAN_PORT: '3419' }, stdio: 'ignore' });
 const prior = { key: process.env.PRAMAAN_API_KEY, base: process.env.PRAMAAN_BASE_URL, root: process.env.STORAGE_FS_ROOT, bucket: process.env.PRAMAAN_STORAGE_BUCKET };
 process.env.PRAMAAN_API_KEY = 'fake-verification-key'; process.env.PRAMAAN_BASE_URL = base; process.env.STORAGE_FS_ROOT = root; process.env.PRAMAAN_STORAGE_BUCKET = 'legal-assistant';
 try {
  await expect.poll(async () => { try { return (await fetch(`${base}/health`)).status; } catch { return 0; } }).toBe(200);
  const storage = createRequire(path.join(process.cwd(), 'package.json'))('./backend/dist/lib/storage.js') as { uploadFileFromPath(key: string, file: string, type: string): Promise<void> };
  const origin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000').origin;
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.fallback() : route.abort());
  const document = { id: 'large-document', filename: 'large-check.pdf', file_type: 'pdf', size_bytes: 26000123, is_owner: true, access_role: 'owner', status: 'ready', created_at: '2026-10-12', active_version_number: 1 };
  let descriptor: Record<string, unknown>; let complete = false; let expectedHash = '';
  await page.route('**/api/**', async route => {
   const pathname = new URL(route.request().url()).pathname; let body: unknown = [];
   if (pathname === '/api/download/upload/ZmFrZQ') {
    const bytes = route.request().postDataBuffer()!; expect(bytes.length).toBe(26000123);
    expectedHash = createHash('sha256').update(bytes).digest('hex'); await fs.writeFile(path.join(root, 'staged.pdf'), bytes, { mode: 0o600 });
    await route.fulfill({ status: 200, body: '' }); return;
   }
   if (pathname === '/api/auth/session') body = { user: { id: 'synthetic', email: 'synthetic@example.test' } };
   if (pathname === '/api/user/profile') body = { onboardingComplete: true, displayName: 'Synthetic' };
   if (pathname === '/api/library/files' || pathname === '/api/library/templates') body = { documents: complete ? [document] : [], folders: [], documentsHasMore: false };
   if (pathname.startsWith('/api/library/') && pathname.endsWith('/levels')) body = { levels: [{ parentId: null, documents: complete ? [document] : [], folders: [], documentsHasMore: false }] };
   if (pathname.startsWith('/api/library/') && pathname.endsWith('/filter-options')) body = { fileTypes: [] };
   if (pathname === '/api/upload-sessions') {
    const input = route.request().postDataJSON(); expect(input.files[0].size_bytes).toBe(26000123);
    descriptor = { id: 'large-file', client_id: input.files[0].client_id, filename: 'large-check.pdf', status: 'pending_upload', error_code: null, result: null, upload: { method: 'PUT', url: '/download/upload/ZmFrZQ', headers: { 'Content-Type': 'application/pdf' } } };
    body = { session: { id: 'large-session', status: 'uploading' }, files: [descriptor] };
   }
   if (pathname === '/api/upload-sessions/large-session/files/large-file/complete') {
    expect(route.request().postDataJSON()).toEqual({ failed: false });
    await storage.uploadFileFromPath('documents/synthetic/large-document/source.pdf', path.join(root, 'staged.pdf'), 'application/pdf');
    complete = true; descriptor = { ...descriptor!, status: 'completed', result: document, upload: undefined };
    body = { session: { id: 'large-session', status: 'completed' }, files: [descriptor] };
   }
   if (pathname === '/api/upload-sessions/large-session') body = { session: { id: 'large-session', status: 'completed' }, files: [descriptor!] };
   await route.fulfill({ json: body });
  });
  await page.goto('/library');
  await expect(page.getByText(/Larger files upload in resumable parts/)).toBeVisible();
  const data = Buffer.alloc(26000123, 32); Buffer.from('%PDF-1.4\n%%EOF\n').copy(data);
  await page.locator('input[type=file][multiple]').first().waitFor({ state: 'attached', timeout: 10000 });
  await page.locator('input[type=file][multiple]').first().setInputFiles({ name: 'large-check.pdf', mimeType: 'application/pdf', buffer: data });
  await expect.poll(() => complete, { timeout: 30000 }).toBe(true);
  await expect(page.getByText('large-check.pdf', { exact: true }).first()).toBeVisible();
  const status = await (await fetch(`${base}/health`)).json(); expect(status.storedParts).toBe(4); expect(status.completedUploads).toBe(1); expect(status.stagedFiles).toBe(0);
  const metaFile = (await fs.readdir(path.join(root, '.metadata')))[0]; const meta = JSON.parse(await fs.readFile(path.join(root, '.metadata', metaFile), 'utf8'));
  expect(meta.remote).toBe(true); expect(meta.sha256).toBe(expectedHash);
  expect(await page.content()).not.toContain('fake-private'); expect(await page.content()).not.toContain('private-storage');
  await page.screenshot({ path: '.data/verification/large-upload.png' });
 } finally {
  fake.kill('SIGTERM'); await new Promise<void>(resolve => { if (fake.exitCode !== null) resolve(); else fake.once('exit', () => resolve()); });
  for (const [key, value] of Object.entries({ PRAMAAN_API_KEY: prior.key, PRAMAAN_BASE_URL: prior.base, STORAGE_FS_ROOT: prior.root, PRAMAAN_STORAGE_BUCKET: prior.bucket })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  await fs.rm(root, { recursive: true, force: true });
 }
});
