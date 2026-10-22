import { createHash, randomUUID } from 'node:crypto';
import fs, { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { CapabilityCallError, callCapability, uploadPlatformFile, removePlatformFile, readPlatformFile } from './pramaan';
import { storeMultipart, verifyMultipartObject, finishMultipart } from './storage.multipart';
import { bestEffort } from './observability/diagnostics';
import { buildDownloadUrl } from './downloadTokens';
export * from './storage.paths';
export const REMOTE_FILE_LIMIT = 25_000_000;
export const storageEnabled = true;
const bucket = () => process.env.PRAMAAN_STORAGE_BUCKET ?? 'legal-assistant';
const root = () => path.resolve(process.env.STORAGE_FS_ROOT ?? '.data/storage');
function localPath(key: string): string {
 const dir = root(); const resolved = path.resolve(dir, key);
 if (!resolved.startsWith(dir + path.sep) || key.startsWith('.') || key.includes('\\') || path.isAbsolute(key) || key.split('/').some(segment => segment === '.' || segment === '..')) throw new Error('Storage key escapes STORAGE_FS_ROOT.');
 return resolved;
}
const metaPath = (key: string) => path.join(root(), '.metadata', createHash('sha256').update(key).digest('hex') + '.json');
type Metadata = { contentType: string; remote: boolean; size: number; remotePath?: string; sha256?: string; deleted?: boolean };
async function metadata(key: string): Promise<Metadata | null> { try { return JSON.parse(await fs.readFile(metaPath(key), 'utf8')); } catch { return null; } }
async function saveMetadata(key: string, meta: Metadata) { await fs.mkdir(path.dirname(metaPath(key)), { recursive: true }); await fs.writeFile(metaPath(key), JSON.stringify(meta), { mode: 0o600 }); }
export function assertStorageConfigured(): void {}
export class StorageOperationError extends Error { constructor(readonly operation: string, options?: { cause?: unknown }) { super(`File ${operation} could not complete.`, options); } }
export class BlobUploadSizeError extends Error { constructor() { super('Upload size does not match the expected file.'); } }
export type StoredObjectMetadata = { size: number; etag: string | null; contentType: string | null };
const isStaging = (key: string) => key.startsWith('upload-sessions/');
async function storeRemote(key: string, bytes: Buffer, contentType: string): Promise<boolean> {
 if (isStaging(key) || bytes.length > REMOTE_FILE_LIMIT || !process.env.PRAMAAN_API_KEY) return false;
 try {
 const options = { idempotencyKey: createHash('sha256').update(key).update(bytes).digest('hex') };
 if (bytes.length <= 1_048_576) {
  await callCapability('storage.object.put', { bucket: bucket(), path: key, content: bytes.toString('base64'), contentType, overwrite: true }, options);
 } else {
  // Spreadsheet files are whole ZIP containers. Only staging labels them as ZIP;
  // the stored object keeps its real spreadsheet media type and unchanged bytes.
  const stagingType = (contentType.startsWith('application/vnd.openxmlformats-officedocument.') && !contentType.includes('wordprocessingml')) || contentType === 'application/vnd.ms-excel.sheet.macroEnabled.12' ? 'application/zip' : contentType;
  const fileId = await uploadPlatformFile(bytes, stagingType);
  try { await callCapability('storage.object.put', { bucket: bucket(), path: key, fileId, contentType, overwrite: true }, options); }
  finally { await bestEffort(removePlatformFile(fileId), { what: 'private-stage-cleanup' }); }
 }
 return true;
 } catch (error) {
  if(error instanceof CapabilityCallError && ['upstream_unavailable','connection_required','forbidden','unauthorized','spend_cap_reached','rate_limited','not_found'].includes(error.code)) return false;
  throw error;
 }
}
export async function uploadFile(key: string, content: ArrayBuffer, contentType: string): Promise<void> {
 const bytes = Buffer.from(content); const target = localPath(key); await fs.mkdir(path.dirname(target), { recursive: true });
 const temp = `${target}.${randomUUID()}.part`;
 try { await fs.writeFile(temp, bytes, { mode: 0o600 }); const multipart = bytes.length > REMOTE_FILE_LIMIT ? await storeMultipart(key, temp, contentType, bucket(), root()) : null; const remote = multipart ? true : await storeRemote(key, bytes, contentType); await fs.rename(temp, target); await saveMetadata(key, { contentType, remote, size: bytes.length, ...(multipart ?? {}) }); if (multipart) await finishMultipart(root(), multipart); }
 finally { await fs.rm(temp, { force: true }); }
}
export async function uploadFileFromPath(key: string, filePath: string, contentType: string): Promise<void> {
 const info = await stat(filePath);
 if (info.size <= REMOTE_FILE_LIMIT) { const bytes = await fs.readFile(filePath); return uploadFile(key, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, contentType); }
 const target = localPath(key); await fs.mkdir(path.dirname(target), { recursive: true });
 const temp = `${target}.${randomUUID()}.part`;
 try { await fs.copyFile(filePath, temp); await fs.chmod(temp, 0o600); const multipart = await storeMultipart(key, temp, contentType, bucket(), root()); await fs.rename(temp, target); await saveMetadata(key, { contentType, remote: !!multipart, size: info.size, ...(multipart ?? {}) }); if (multipart) await finishMultipart(root(), multipart); }
 finally { await fs.rm(temp, { force: true }); }
}
export async function headFile(key: string): Promise<StoredObjectMetadata | null> {
 const stored = await metadata(key);
 if (stored?.deleted) return null;
 try { const info = await stat(localPath(key)); return { size: info.size, etag: null, contentType: stored?.contentType ?? null }; }
 catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
 if (isStaging(key) || !process.env.PRAMAAN_API_KEY) return null;
 try { const info = await callCapability('storage.object.head', { bucket: bucket(), path: stored?.remotePath ?? key }); return { size: info.sizeBytes, etag: null, contentType: info.contentType ?? null }; }
 catch (error) { if (error instanceof CapabilityCallError && error.code === 'not_found') return null; throw error; }
}
export async function downloadFile(key: string): Promise<ArrayBuffer | null> {
 if ((await metadata(key))?.deleted) return null;
 let bytes: Buffer;
 try { bytes = await fs.readFile(localPath(key)); }
 catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  if (isStaging(key) || !process.env.PRAMAAN_API_KEY) return null;
  const meta = await metadata(key);
  if (meta?.remotePath && meta.sha256) { await hydrateMultipart(key, meta); bytes = await fs.readFile(localPath(key)); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer; }
  const result = await callCapability('storage.object.get', { bucket: bucket(), path: key }) as { content?: string; file?: { url: string; contentType?: string }; contentType?: string };
  if (result.content !== undefined) bytes = Buffer.from(result.content, 'base64');
  else if (result.file?.url) bytes = Buffer.from(await readPlatformFile(result.file.url));
  else return null;
  if (bytes.length > REMOTE_FILE_LIMIT) throw new Error('File exceeds the remote download limit.');
  await fs.mkdir(path.dirname(localPath(key)), { recursive: true }); await fs.writeFile(localPath(key), bytes, { mode: 0o600 });
  await saveMetadata(key, { contentType: result.contentType ?? result.file?.contentType ?? 'application/octet-stream', remote: true, size: bytes.length });
 }
 return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
export function createFileReadStream(key: string): Readable {
 return Readable.from((async function* () { try { await stat(localPath(key)); } catch { const meta = await metadata(key); if (meta?.remotePath && meta.sha256) await hydrateMultipart(key, meta); else if (!await downloadFile(key)) throw new Error('File not found.'); }
  for await (const chunk of createReadStream(localPath(key))) yield chunk; })());
}
export async function copyFile(sourceKey: string, destinationKey: string): Promise<void> {
 try { await stat(localPath(sourceKey)); } catch { if (!await downloadFile(sourceKey)) throw new Error('File not found.'); }
 const meta = await metadata(sourceKey);
 await uploadFileFromPath(destinationKey, localPath(sourceKey), meta?.contentType ?? mediaTypeFor(sourceKey));
}
function mediaTypeFor(key: string): string {
 return key.endsWith('.pdf') ? 'application/pdf' : key.endsWith('.docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : key.endsWith('.xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : key.endsWith('.json') ? 'application/json' : key.endsWith('.txt') ? 'text/plain' : 'application/octet-stream';
}
export async function listFiles(prefix: string): Promise<string[]> {
 localPath(prefix || '_'); const files = new Set<string>();
 async function walk(dir: string) { let entries; try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) { if (e.name.startsWith('.')) continue; const full = path.join(dir, e.name); if (e.isDirectory()) await walk(full); else { const key = path.relative(root(), full).split(path.sep).join('/'); if (key.startsWith(prefix)) files.add(key); } } }
 await walk(root());
 if (process.env.PRAMAAN_API_KEY && !isStaging(prefix)) {
  let cursor: string | undefined;
  do { const page = await callCapability('storage.objects.list', { bucket: bucket(), prefix, limit: 1000, cursor });
   for (const item of page.results) if (!item.isFolder && !item.path.startsWith('.multipart/')) files.add(item.path); cursor = page.nextCursor;
  } while (cursor);
 }
 return [...files];
}
export async function deleteFile(key: string): Promise<void> {
 const meta = await metadata(key);
 if (!isStaging(key) && process.env.PRAMAAN_API_KEY && (meta?.remote || !meta)) await callCapability('storage.object.delete', { bucket: bucket(), paths: [meta?.remotePath ?? key] }, { idempotencyKey: randomUUID() });
 await fs.rm(localPath(key), { force: true });
 // Retain a private deletion marker so a repeated local cleanup never guesses
 // that a now-missing metadata file represents an untracked remote object.
 await saveMetadata(key, { contentType: meta?.contentType ?? mediaTypeFor(key), remote: false, size: 0, deleted: true });
}
export function deleteFileBestEffort(key: string, what: string, extra?: Record<string, unknown>) { return bestEffort(deleteFile(key), { what, extra }); }
export function deleteFilesBestEffort(keys: string[], what: string, extra?: Record<string, unknown>) { return Promise.all(keys.map(k => deleteFileBestEffort(k, what, extra))); }
export async function getSignedUrl(key: string, _expiresIn = 3600, filename = path.basename(key)): Promise<string> { return buildDownloadUrl(key, filename); }
export async function getSignedUploadUrl(key: string, contentType: string, expectedSizeBytes: number, _expiresIn = 900): Promise<string> {
 localPath(key);
 const descriptor = Buffer.from(JSON.stringify({ p: key, t: contentType, s: expectedSizeBytes })).toString('base64url');
 return `/download/upload/${descriptor}`;
}
export async function writeBlobFromStream(key: string, body: Readable, maxBytes: number, contentType = 'application/octet-stream'): Promise<number> {
 if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new BlobUploadSizeError();
 const target = localPath(key); await fs.mkdir(path.dirname(target), { recursive: true }); const temp = `${target}.${randomUUID()}.part`;
 let written = 0; const handle = await fs.open(temp, 'wx', 0o600);
 const bounded = new Transform({ transform(chunk: Buffer, _encoding, callback) { if (chunk.length > maxBytes - written) return callback(new BlobUploadSizeError()); written += chunk.length; callback(null, chunk); } });
 const abort = (error: Error) => bounded.destroy(error);
 const aborted = () => bounded.destroy(new Error('Upload aborted.'));
 const closed = () => { if (!body.readableEnded) aborted(); };
 body.once('error', abort); body.once('aborted', aborted); body.once('close', closed);
 try {
  if (body.destroyed) throw new Error('Upload aborted.');
  const completed = pipeline(bounded, handle.createWriteStream()); body.pipe(bounded); await completed;
  if (written !== maxBytes) throw new BlobUploadSizeError(); await fs.rename(temp, target);
  await saveMetadata(key, { contentType, remote: false, size: written }); return written;
 } finally {
  body.unpipe(bounded); body.off('error', abort); body.off('aborted', aborted); body.off('close', closed);
  if (!body.readableEnded && !body.destroyed) body.resume();
  await handle.close().catch(() => {}); await fs.rm(temp, { force: true });
 }
}
export async function discardBlob(key: string): Promise<void> { return deleteFile(key); }

async function hydrateMultipart(key: string, meta: Metadata): Promise<void> {
 const target = localPath(key); await fs.mkdir(path.dirname(target), { recursive: true });
 const temp = `${target}.${randomUUID()}.part`; const file = await fs.open(temp, 'wx', 0o600);
 try {
  await verifyMultipartObject(bucket(), meta.remotePath!, meta.size, meta.sha256!, async bytes => { let offset = 0; while (offset < bytes.length) { const result = await file.write(bytes, offset, bytes.length - offset); offset += result.bytesWritten; } });
  await file.close(); await fs.rename(temp, target);
 } finally { await file.close().catch(() => {}); await fs.rm(temp, { force: true }); }
}
