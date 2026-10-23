import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { setPlatformFileTransportForTests, setPramaanClientForTests, uploadPlatformPart, streamPrivateStorageObject, type PramaanClient } from '../pramaan';
import { uploadFile, uploadFileFromPath, createFileReadStream, getSignedUrl } from '../storage';
import { storeMultipart, MULTIPART_PART_BYTES } from '../storage.multipart';
let root: string;
const bytes = Buffer.alloc(26_000_123, 37);
let files: Map<string, Buffer>, parts: Map<number, Buffer>, objects: Map<string, Buffer>;
let objectPath: string; let serial: number; let partFailures: number; let corrupt: boolean; let wrongSize: boolean;
const call = vi.fn(); const upload = vi.fn(); const remove = vi.fn(); const stream = vi.fn();
beforeEach(async () => {
 await fs.mkdir(path.resolve('.data/verification'), { recursive: true });
 root = await fs.mkdtemp(path.resolve('.data/verification/multipart-test-'));
 vi.stubEnv('STORAGE_FS_ROOT', root); vi.stubEnv('PRAMAAN_API_KEY', 'fake-key');
 vi.stubEnv('DOWNLOAD_SIGNING_SECRET', 'fake-signing-secret');
 files = new Map(); parts = new Map(); objects = new Map(); serial = 0; partFailures = 0; corrupt = false; wrongSize = false;
 call.mockReset().mockImplementation(async (id, input) => {
  if (id === 'storage.upload.create') { objectPath = input.path; return { ref: 'ref_owned', bucket: input.bucket, path: input.path }; }
  if (id === 'storage.upload.parts.list') return { results: [...parts].map(([partNumber, content]) => ({ partNumber, sizeBytes: content.length })) };
  if (id === 'storage.upload.part.put') {
   if (partFailures-- > 0) throw { code: 'upstream_unavailable' };
   const content = files.get(input.fileId)!; parts.set(input.partNumber, content); return { partNumber: input.partNumber, sizeBytes: content.length };
  }
  if (id === 'storage.upload.complete') {
   const content = Buffer.concat([...parts].sort(([a], [b]) => a - b).map(([, content]) => content));
   objects.set(objectPath, corrupt ? Buffer.from(content).fill(38, 100, 101) : content);
   return { bucket: 'legal-assistant', path: objectPath, sizeBytes: content.length + (wrongSize ? 1 : 0) };
  }
  if (id === 'storage.upload.abort') { parts.clear(); return { aborted: true }; }
  if (id === 'storage.object.delete') { for (const key of input.paths) objects.delete(key); return { deleted: input.paths }; }
  if (id === 'storage.object.head') return { bucket: 'legal-assistant', path: input.path, sizeBytes: objects.get(input.path)!.length };
  if (id === 'storage.object.download-url') return { downloadUrl: 'https://private.example.test/object?signature=private', expiresAt: '2030-01-01' };
  if (id === 'storage.object.put') return { path: input.path };
  throw new Error('Unexpected capability');
 });
 upload.mockReset().mockImplementation(async (data: Uint8Array, type: string, kind?: string) => {
  expect(type).toBe('application/octet-stream'); expect(kind).toBe('part'); expect(data.length).toBeLessThanOrEqual(MULTIPART_PART_BYTES);
  const id = `file_${++serial}`; files.set(id, Buffer.from(data)); return id;
 });
 remove.mockReset().mockImplementation(async (id: string) => { files.delete(id); });
 stream.mockReset().mockImplementation(async function* () { const data = objects.get(objectPath)!; for (let i = 0; i < data.length; i += 1_048_576) yield data.subarray(i, i + 1_048_576); });
 setPramaanClientForTests({ call } as PramaanClient);
 setPlatformFileTransportForTests({ upload, remove, read: async () => { throw new Error('Large reads must stream'); }, stream });
});
afterEach(async () => { setPramaanClientForTests(); setPlatformFileTransportForTests(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); if (root) await fs.rm(root, { recursive: true, force: true }); });
const source = async () => { const file = path.join(root, 'source.bin'); await fs.writeFile(file, bytes); return file; };
it('stores large files as four raw parts, frees staging space and verifies completed bytes', async () => {
 await uploadFileFromPath('documents/owned/source.bin', await source(), 'application/octet-stream');
 expect(upload).toHaveBeenCalledTimes(4); expect(remove).toHaveBeenCalledTimes(4); expect(files.size).toBe(0);
 expect(objects.get(objectPath)!.equals(bytes)).toBe(true);
 expect(call.mock.calls.some(([id]) => id === 'storage.object.put')).toBe(false);
 const meta = JSON.parse(await fs.readFile(path.join(root, '.metadata', createHash('sha256').update('documents/owned/source.bin').digest('hex') + '.json'), 'utf8'));
 expect(meta.remote).toBe(true); expect(meta.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
 expect(JSON.stringify(meta)).not.toContain('signature'); expect(await fs.readdir(path.join(root, '.multipart-state'))).toEqual([]);
 expect(await getSignedUrl('documents/owned/source.bin')).toMatch(/^\/download\//);
});
it('retries a failed part with the same staged bytes and idempotency key', async () => {
 partFailures = 1;
 await uploadFileFromPath('documents/owned/source.bin', await source(), 'application/octet-stream');
 const puts = call.mock.calls.filter(([id]) => id === 'storage.upload.part.put');
 expect(puts).toHaveLength(5); expect(puts[0]).toEqual(puts[1]); expect(upload).toHaveBeenCalledTimes(4);
});
it('aborts and removes staging files when a part cannot finish', async () => {
 partFailures = 10;
 await expect(uploadFileFromPath('documents/owned/source.bin', await source(), 'application/octet-stream')).rejects.toThrow('could not complete');
 expect(call.mock.calls.filter(([id]) => id === 'storage.upload.part.put')).toHaveLength(3);
 expect(call.mock.calls.filter(([id]) => id === 'storage.upload.abort')).toHaveLength(1); expect(files.size).toBe(0);
 expect(call.mock.calls.some(([id]) => id === 'storage.upload.complete')).toBe(false);
});
it.each(['size', 'contents'])('rejects a completion %s mismatch and never replaces a good local file', async mismatch => {
 await fs.mkdir(path.join(root, 'documents/owned'), { recursive: true }); await fs.writeFile(path.join(root, 'documents/owned/source.bin'), 'kept');
 wrongSize = mismatch === 'size'; corrupt = mismatch === 'contents';
 await expect(uploadFileFromPath('documents/owned/source.bin', await source(), 'application/octet-stream')).rejects.toThrow('does not match');
 expect(call.mock.calls.some(([id]) => id === 'storage.upload.abort')).toBe(true); expect(objects.size).toBe(0);
 expect(await fs.readFile(path.join(root, 'documents/owned/source.bin'), 'utf8')).toBe('kept');
});
it('keeps a large file local when creation is refused', async () => {
 call.mockImplementation(async () => { throw { code: 'connection_required' }; });
 await uploadFileFromPath('documents/owned/source.bin', await source(), 'application/octet-stream');
 expect((await fs.readFile(path.join(root, 'documents/owned/source.bin'))).equals(bytes)).toBe(true);
 expect(call).toHaveBeenCalledOnce(); expect(upload).not.toHaveBeenCalled();
});
it('keeps a large file local when no key is configured', async () => {
 vi.stubEnv('PRAMAAN_API_KEY', '');
 await uploadFile('documents/owned/source.bin', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, 'application/octet-stream');
 expect((await fs.readFile(path.join(root, 'documents/owned/source.bin'))).equals(bytes)).toBe(true); expect(call).not.toHaveBeenCalled();
});
it('keeps files up to 25 MB on the whole-object path', async () => {
 await uploadFile('documents/owned/small.txt', new TextEncoder().encode('small').buffer as ArrayBuffer, 'text/plain');
 expect(call).toHaveBeenCalledExactlyOnceWith('storage.object.put', expect.objectContaining({ content: 'c21hbGw=', contentType: 'text/plain' }), expect.anything());
 expect(upload).not.toHaveBeenCalled();
});
it('does not complete or reupload a committed journal after a restart before local metadata commit', async () => {
 const file = await source(); const stored = await storeMultipart('documents/owned/source.bin', file, 'application/octet-stream', 'legal-assistant', root);
 expect(stored).not.toBeNull(); call.mockClear(); upload.mockClear();
 expect(await storeMultipart('documents/owned/source.bin', file, 'application/octet-stream', 'legal-assistant', root)).toEqual(stored);
 expect(call.mock.calls.some(([id]) => id === 'storage.upload.create' || id === 'storage.upload.complete' || id === 'storage.upload.part.put')).toBe(false);
 expect(upload).not.toHaveBeenCalled();
});
it('recovers a missing local cache through a server-only verified stream', async () => {
 const key = 'documents/owned/source.bin'; await uploadFileFromPath(key, await source(), 'application/octet-stream');
 await fs.rm(path.join(root, key)); const chunks = []; for await (const chunk of createFileReadStream(key)) chunks.push(chunk);
 expect(Buffer.concat(chunks).equals(bytes)).toBe(true); expect(stream).toHaveBeenCalledTimes(2);
});
it('stages raw bytes with kind=part and no public file URL', async () => {
 setPlatformFileTransportForTests();
 const fetch = vi.fn(async (url: string, init: RequestInit) => {
  expect(new URL(url).searchParams.get('kind')).toBe('part');
  expect(new Headers(init.headers).get('Content-Type')).toBe('application/octet-stream'); expect(Buffer.from(init.body as Uint8Array)).toEqual(Buffer.from([0, 1, 255]));
  return new Response(JSON.stringify({ fileId: 'file_raw' }), { status: 201 });
 });
 vi.stubGlobal('fetch', fetch);
 expect(await uploadPlatformPart(new Uint8Array([0, 1, 255]))).toBe('file_raw'); expect(fetch).toHaveBeenCalledOnce();
});

it('resumes acknowledged parts from the saved manifest instead of uploading them again', async () => {
 const file = await source(); const key = 'documents/owned/source.bin';
 let snapshot = ''; let journalName = '';
 const handler = call.getMockImplementation()!;
 call.mockImplementation(async (...args) => {
  const result = await handler(...args);
  if (args[0] === 'storage.upload.part.put' && args[1].partNumber === 1) {
   journalName = (await fs.readdir(path.join(root, '.multipart-state'))).find(name => name.endsWith('.json'))!;
   snapshot = await fs.readFile(path.join(root, '.multipart-state', journalName), 'utf8');
  }
  return result;
 });
 await uploadFileFromPath(key, file, 'application/octet-stream');
 // Restore the private progress and fake storage to the acknowledged first-part checkpoint.
 await fs.writeFile(path.join(root, '.multipart-state', journalName), snapshot, { mode: 0o600 });
 parts = new Map([[1, Buffer.from(bytes.subarray(0, MULTIPART_PART_BYTES))]]); objects.clear();
 call.mockClear(); upload.mockClear();
 await uploadFileFromPath(key, file, 'application/octet-stream');
 expect(call.mock.calls.some(([id]) => id === 'storage.upload.create')).toBe(false);
 const uploaded = call.mock.calls.filter(([id]) => id === 'storage.upload.part.put').map(([, input]) => input.partNumber);
 expect(uploaded).toEqual([2, 3, 4]); expect(upload).toHaveBeenCalledTimes(3); expect(objects.get(objectPath)!.equals(bytes)).toBe(true);
});
it('retains failed cleanup and finishes it before starting another upload', async () => {
 partFailures = 10;
 const handler = call.getMockImplementation()!;
 call.mockImplementation(async (...args) => { if (args[0] === 'storage.upload.abort') throw { code: 'upstream_unavailable' }; return handler(...args); });
 const file = await source();
 await expect(uploadFileFromPath('documents/owned/source.bin', file, 'application/octet-stream')).rejects.toThrow('cleanup could not complete');
 const statePath = path.join(root, '.multipart-state', (await fs.readdir(path.join(root, '.multipart-state'))).find(name => name.endsWith('.json'))!);
 expect(JSON.parse(await fs.readFile(statePath, 'utf8')).phase).toBe('aborting');
 partFailures = 0; call.mockImplementation(handler); call.mockClear();
 await uploadFileFromPath('documents/owned/source.bin', file, 'application/octet-stream');
 expect(call.mock.calls[0][0]).toBe('storage.upload.abort'); expect(files.size).toBe(0); expect(objects.get(objectPath)!.equals(bytes)).toBe(true);
});

it('closes a refused private download body without leaking its signed location', async () => {
 setPlatformFileTransportForTests(); vi.stubEnv('PRAMAAN_FAKE', '0'); vi.stubEnv('PRAMAAN_BASE_URL', 'http://localhost:9999');
 call.mockResolvedValue({ downloadUrl: 'http://localhost:9999/private?signature=hidden' });
 const cancel = vi.fn(); const fetch = vi.fn(async () => new Response(new ReadableStream({ cancel }), { status: 403 }));
 vi.doMock('undici', () => ({ fetch, Agent: class {} }));
 try {
  await expect(streamPrivateStorageObject('legal-assistant', 'owned', 20, vi.fn())).rejects.toThrow('verification could not complete');
  expect(cancel).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledOnce();
 } finally { vi.doUnmock('undici'); }
});
