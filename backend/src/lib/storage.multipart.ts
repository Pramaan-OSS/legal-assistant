import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { CapabilityCallError, callCapability, removePlatformFile, streamPrivateStorageObject, uploadPlatformPart } from './pramaan';

export const MULTIPART_PART_BYTES = 8 * 1024 * 1024;
export const MULTIPART_MAX_BYTES = 1024 * 1024 * 1024;
export type MultipartObject = { remotePath: string; sha256: string };
type Journal = MultipartObject & { bucket: string; size: number; contentType: string; ref?: string; nonce: string; phase: 'uploading' | 'completing' | 'completed' | 'aborting'; files: string[] };
const refused = (error: unknown) => error instanceof CapabilityCallError && ['forbidden', 'unauthorized', 'connection_required', 'not_found', 'invalid_request', 'spend_cap_reached'].includes(error.code);
const transient = (error: unknown) => error instanceof CapabilityCallError && ['upstream_unavailable', 'upstream_timeout', 'rate_limited', 'conflict'].includes(error.code);
async function fileHash(filePath: string): Promise<string> {
 const hash = createHash('sha256'); for await (const chunk of createReadStream(filePath)) hash.update(chunk); return hash.digest('hex');
}
/** Verify actual remote bytes, not just the completion receipt or a locally supplied checksum. */
export async function verifyMultipartObject(bucket: string, remotePath: string, size: number, sha256: string, onChunk?: (bytes: Uint8Array) => Promise<void>): Promise<void> {
 const head = await callCapability('storage.object.head', { bucket, path: remotePath });
 if (head.sizeBytes !== size) throw new Error('The completed file does not match its expected size.');
 const hash = createHash('sha256');
 const read = await streamPrivateStorageObject(bucket, remotePath, size, async bytes => { hash.update(bytes); await onChunk?.(bytes); });
 if (read !== size || hash.digest('hex') !== sha256) throw new Error('The completed file does not match its expected contents.');
}
async function acquire(lockPath: string): Promise<() => Promise<void>> {
 try {
  const lock = await fs.open(lockPath, 'wx', 0o600);
  await lock.writeFile(JSON.stringify({ pid: process.pid })); await lock.close();
  return async () => { await fs.rm(lockPath, { force: true }); };
 } catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  const owner = JSON.parse(await fs.readFile(lockPath, 'utf8')) as { pid: number };
  if (!Number.isSafeInteger(owner.pid) || owner.pid < 1) throw new Error('An upload is already in progress.');
  try { process.kill(owner.pid, 0); }
  catch (check) {
   if ((check as NodeJS.ErrnoException).code === 'ESRCH') { await fs.rm(lockPath, { force: true }); return acquire(lockPath); }
   throw new Error('An upload is already in progress.');
  }
  throw new Error('An upload is already in progress.');
 }
}
/** Immutable private objects keep a failed replacement from corrupting the currently stored file. */
export async function storeMultipart(key: string, filePath: string, contentType: string, bucket: string, root: string): Promise<MultipartObject | null> {
 const { size } = await fs.stat(filePath);
 if (!process.env.PRAMAAN_API_KEY || key.startsWith('upload-sessions/')) return null;
 if (size > MULTIPART_MAX_BYTES) throw new Error('Connected multipart storage supports files up to 1 GiB.');
 const sha256 = await fileHash(filePath);
 const id = createHash('sha256').update(JSON.stringify([bucket, key, sha256, size, contentType])).digest('hex');
 const dir = path.join(root, '.multipart-state'); await fs.mkdir(dir, { recursive: true });
 const journalPath = path.join(dir, `${id}.json`);
 const release = await acquire(`${journalPath}.lock`);
 let journal: Journal | undefined;
 const save = async () => {
  const temp = `${journalPath}.${randomUUID()}.tmp`;
  try { await fs.writeFile(temp, JSON.stringify(journal), { mode: 0o600 }); await fs.rename(temp, journalPath); }
  finally { await fs.rm(temp, { force: true }); }
 };
 const discard = async () => {
  if (!journal) return;
  journal.phase = 'aborting'; await save();
  if (journal.ref) { try { await callCapability('storage.upload.abort', { ref: journal.ref, confirm: true }, { idempotencyKey: `abort:${journal.nonce}` }); } catch (error) { if (!(error instanceof CapabilityCallError && error.code === 'not_found')) throw error; } }
  for (const fileId of journal.files) await removePlatformFile(fileId);
  // This destination is unique to this upload; never delete a prior document object.
  if (journal.ref) await callCapability('storage.object.delete', { bucket, paths: [journal.remotePath] }, { idempotencyKey: `discard:${journal.nonce}` });
  await fs.rm(journalPath, { force: true });
 };
 try {
  try { journal = JSON.parse(await fs.readFile(journalPath, 'utf8')) as Journal; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (journal && (journal.sha256 !== sha256 || journal.size !== size || journal.bucket !== bucket || journal.contentType !== contentType || !journal.remotePath.startsWith(`.multipart/${id}/`))) throw new Error('The saved upload does not match this file.');
  if (journal?.phase === 'aborting') { await discard(); journal = undefined; }
  if (!journal) {
   const nonce = randomUUID(); journal = { remotePath: `.multipart/${id}/${nonce}`, sha256, bucket, size, contentType, nonce, phase: 'uploading', files: [] }; await save();
  }
  if (!journal.ref) {
   const started = await callCapability('storage.upload.create', { bucket, path: journal.remotePath, contentType }, { idempotencyKey: `create:${journal.nonce}` });
   journal.ref = started.ref; await save();
  }
  if (typeof journal.ref !== 'string' || !journal.ref) throw new Error('The upload returned no resumable reference.');
  const ref = journal.ref;
  const parts = async () => {
   const result = new Map<number, number>(); let cursor: string | undefined;
   do {
    const page = await callCapability('storage.upload.parts.list', { ref, limit: 1000, ...(cursor ? { cursor } : {}) });
    for (const part of page.results) {
     if (result.has(part.partNumber)) throw new Error('The saved upload contains duplicate parts.');
     result.set(part.partNumber, part.sizeBytes);
    }
    if (page.nextCursor === cursor && cursor !== undefined) throw new Error('The upload part list did not advance.');
    cursor = page.nextCursor;
   } while (cursor);
   return result;
  };
  if (journal.phase === 'uploading') {
   const stored = await parts();
   for (const fileId of journal.files) await removePlatformFile(fileId);
   journal.files = []; await save();
   const source = await fs.open(filePath, 'r');
   try {
    let partNumber = 0;
    for (let offset = 0; offset < size; offset += MULTIPART_PART_BYTES) {
     partNumber++;
     const length = Math.min(MULTIPART_PART_BYTES, size - offset);
     if (stored.get(partNumber) === length) continue;
     const bytes = Buffer.allocUnsafe(length); let read = 0;
     while (read < length) { const next = await source.read(bytes, read, length - read, offset + read); if (!next.bytesRead) throw new Error('The source file changed during upload.'); read += next.bytesRead; }
     const fileId = await uploadPlatformPart(bytes); journal.files.push(fileId); await save();
     const checksum = createHash('sha256').update(bytes).digest('hex');
     const partKey = createHash('sha256').update(JSON.stringify([fileId, checksum])).digest('hex');
     for (let attempt = 0; ; attempt++) {
      try {
       const saved = await callCapability('storage.upload.part.put', { ref, partNumber, fileId }, { idempotencyKey: `part:${journal.nonce}:${partNumber}:${partKey}` });
       if (saved.partNumber !== partNumber || saved.sizeBytes !== length) throw new Error('The stored upload part does not match its expected size.');
       break;
      } catch (error) {
       if (!transient(error)) throw error;
       if ((await parts()).get(partNumber) === length) break;
       if (attempt >= 2) throw error;
       await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
      }
     }
     // Free the platform staging allowance as soon as storage confirms this part.
     await removePlatformFile(fileId); journal.files = journal.files.filter(id => id !== fileId); await save();
    }
   } finally { await source.close(); }
   const ready = await parts(); const expectedCount = Math.ceil(size / MULTIPART_PART_BYTES);
   if (ready.size !== expectedCount) throw new Error('The upload part count does not match the file.');
   for (let number = 1; number <= expectedCount; number++) if (ready.get(number) !== Math.min(MULTIPART_PART_BYTES, size - (number - 1) * MULTIPART_PART_BYTES)) throw new Error('The upload parts do not match the file.');
   journal.phase = 'completing'; await save();
  }
  if (journal.phase !== 'completed') {
   const completed = await callCapability('storage.upload.complete', { ref }, { idempotencyKey: `complete:${journal.nonce}` });
   if (completed.bucket !== bucket || completed.path !== journal.remotePath || completed.sizeBytes !== size) throw new Error('The completed file does not match its upload.');
   journal.phase = 'completed'; await save();
  }
  await verifyMultipartObject(bucket, journal.remotePath, size, sha256);
  return { remotePath: journal.remotePath, sha256 };
 } catch (error) {
  try { await discard(); }
  catch { throw new Error('Upload cleanup could not complete. Retry to resume cleanup before another upload.'); }
  if (refused(error)) return null;
  throw error instanceof CapabilityCallError ? new Error('The file upload could not complete.') : error;
 } finally { await release(); }
}

/** Clear progress only after the local file and its verified remote pointer are committed. */
export async function finishMultipart(root: string, object: MultipartObject): Promise<void> {
 const id = object.remotePath.split('/')[1];
 if (!id || !/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid private upload journal.');
 const journalPath = path.join(root, '.multipart-state', `${id}.json`);
 let release: (() => Promise<void>) | undefined;
 try {
  release = await acquire(`${journalPath}.lock`);
  const journal = JSON.parse(await fs.readFile(journalPath, 'utf8')) as Journal;
  if (journal.remotePath === object.remotePath && journal.phase === 'completed') await fs.rm(journalPath, { force: true });
 } catch {
  // Metadata is already committed. Keep any newer/concurrent journal for its owner.
 } finally { await release?.(); }
}
