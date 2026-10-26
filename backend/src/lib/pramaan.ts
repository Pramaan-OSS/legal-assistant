import { createPramaan, type OutcomeRunOptions, type OutcomeRun, type Requests } from './pramaan.compat';
import { localPramaanClient } from './pramaan.local';
import type { CapabilityId, Results, RunOptions } from '@pramaan/sdk' with { 'resolution-mode': 'import' };
import { abortable } from './abortable';
import { UserFacingError } from './userFacingError';
import { preparePramaanSchemas, prepareOutcomeSchemas, PramaanSchemaError } from './pramaan.schemas';
export { checkPramaanSchema, normalizePramaanSchema, PramaanSchemaError } from './pramaan.schemas';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { StreamEvent } from '@pramaan/sdk' with { 'resolution-mode': 'import' };
import type { OutcomeDescription, OutcomeEstimate, OutcomeSummary } from '@pramaan/sdk' with { 'resolution-mode': 'import' };

type CapabilityJob<T = unknown> = { id: string; status: 'running' | 'done' | 'failed' | 'cancelled'; result?: T; error?: { code?: string } };

export interface PramaanClient {
  call<K extends CapabilityId>(id: K, input: Requests[K], options?: RunOptions): Promise<Results[K]>;
  stream?(id: 'llm.chat', input: Requests['llm.chat'], options?: RunOptions): AsyncIterable<StreamEvent<Results['llm.chat']>>;
  run?<K extends CapabilityId>(id: K, input: Requests[K], options?: RunOptions): Promise<Results[K] | CapabilityJob<Results[K]>>;
  jobs?: { get(id: string): Promise<CapabilityJob>; cancel(id: string): Promise<CapabilityJob> };
  outcomes?: {
    list(): Promise<OutcomeSummary[]>;
    get(id: string): Promise<OutcomeDescription>;
    estimate(id: string, input: unknown, options?: OutcomeRunOptions): Promise<OutcomeEstimate>;
    run(id: string, input: unknown, options?: OutcomeRunOptions): Promise<OutcomeRun>;
  };
}

const streamSignals = new AsyncLocalStorage<AbortSignal | undefined>();
let injected: PramaanClient | undefined;
let instance: Promise<PramaanClient> | undefined;
export class IncompleteReplyError extends UserFacingError {
  readonly automaticRetry = false;
  readonly code = 'reply_incomplete';
  constructor(readonly partialText: string = '') { super('The reply reached its limit and is incomplete. Ask for a shorter reply and try again. No unfinished action was run.'); }
}
export class ReplyLimitConfigurationError extends UserFacingError {
  readonly automaticRetry = false;
  readonly code = 'invalid_request';
  constructor() { super('The reply limit is too small. Ask for a shorter reply or increase the server reply limit before trying again.'); }
}
/** Follow safe queue wrappers; manual retry remains available after revising input. */
export function requiresReplyRevision(error: unknown): boolean {
  const seen = new Set<object>();
  let current = error;
  for (let depth = 0; depth < 8 && current && typeof current === 'object' && !seen.has(current); depth++) {
    if ('automaticRetry' in current && current.automaticRetry === false) return true;
    seen.add(current); current = 'cause' in current ? current.cause : undefined;
  }
  return false;
}
function replyLimitError(error: unknown, id: string): boolean {
  return (id === 'llm.chat' || id === 'llm.complete') && !!error && typeof error === 'object' &&
    'code' in error && error.code === 'invalid_request' && 'message' in error && typeof error.message === 'string' && /maxTokens/i.test(error.message);
}
function checkedReply<T>(id: string, result: T): T {
  if ((id === 'llm.chat' || id === 'llm.complete') && result && typeof result === 'object' && 'finishReason' in result && result.finishReason === 'length') {
    throw new IncompleteReplyError('text' in result && typeof result.text === 'string' ? result.text : '');
  }
  return result;
}
async function requireActionKey(id: CapabilityId, options?: RunOptions) {
  const { CATALOG } = await import('@pramaan/sdk');
  const effect = CATALOG[id]?.effectClass;
  if (effect && effect !== 'read_only' && effect !== 'internal_only' && !options?.idempotencyKey?.trim()) {
    throw Object.assign(new Error('Idempotency-Key header is required for this capability.'), { code: 'invalid_request', status: 400 });
  }
}
function checkedClient(client: PramaanClient, normalize: boolean): PramaanClient {
  return {
    call: (id, input, options) => { const prepared = preparePramaanSchemas(id, input, normalize) as typeof input; const send = () => Promise.resolve(client.call(id, prepared, options)).then(result => checkedReply(id, result)); return requireActionKey(id, options).then(send); },
    ...(client.run ? { run: async (id, input, options) => { await requireActionKey(id, options); return Promise.resolve(client.run!(id, preparePramaanSchemas(id, input, normalize) as typeof input, options)).then(result => checkedReply(id, result)); } } : {}),
    ...(client.stream ? { stream: async function* (id, input, options) { yield* client.stream!(id, preparePramaanSchemas(id, input, normalize) as typeof input, options); } } : {}),
    ...(client.jobs ? { jobs: client.jobs } : {}),
    ...(client.outcomes ? { outcomes: {
      list: () => client.outcomes!.list(), get: id => client.outcomes!.get(id),
      estimate: (id, input, options) => client.outcomes!.estimate(id, prepareOutcomeSchemas(id, input, normalize), options),
      run: (id, input, options) => client.outcomes!.run(id, prepareOutcomeSchemas(id, input, normalize), options),
    } } : {}),
  };
}
/** Fake transports enforce the wire subset independently of input normalization. */
export function checkedFakePramaanClient(client: PramaanClient): PramaanClient { return checkedClient(client, false); }
/** Tests supply a fake client; production constructs exactly one server-only SDK client. */
export function setPramaanClientForTests(client?: PramaanClient): void {
  if (process.env.NODE_ENV !== 'test') throw new Error('Test client is unavailable.');
  injected = client ? checkedClient(checkedFakePramaanClient(client), true) : undefined;
}
export async function pramaan(): Promise<PramaanClient> {
  if (injected) return injected;
  if (process.env.PRAMAAN_FAKE === '1') return checkedClient(checkedFakePramaanClient(localPramaanClient()), true);
  if (!instance) {
    const apiKey = process.env.PRAMAAN_API_KEY;
    if (!apiKey) throw new Error('Set PRAMAAN_API_KEY to enable connected capabilities.');
    instance = createPramaan({ apiKey, baseUrl: process.env.PRAMAAN_BASE_URL, maxRetries: 0, fetch: (input, init) => fetch(input, { ...init, ...(streamSignals.getStore() ? { signal: streamSignals.getStore() } : {}) }) }).then(client => checkedClient(client as unknown as PramaanClient, true));
  }
  return instance;
}
export const CAPABILITY_NOT_AVAILABLE_MESSAGE = 'This service is not available yet. You can keep working on this page.';
export class CapabilityCallError extends Error {
 constructor(readonly code: string, capability?: string, missingActionKey = false) {
  super(missingActionKey ? 'The request is missing its required action key. Check the server setup before trying again.' : code === 'upstream_unavailable' && capability?.startsWith('law.') ? CAPABILITY_NOT_AVAILABLE_MESSAGE : 'The connected capability could not complete. Check its status before retrying an action.');
  if (!['not_found', 'unauthorized', 'forbidden', 'rate_limited', 'conflict', 'connection_required', 'invalid_request', 'upstream_timeout', 'upstream_unavailable', 'spend_cap_reached'].includes(code)) this.code = 'internal';
 }
}
/** Only outcome-supported options cross this boundary; routing and price headers never do. */
function outcomeOptions(options: OutcomeRunOptions = {}): OutcomeRunOptions {
  return {
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
    ...(options.options !== undefined ? { options: options.options } : {}),
    ...(options.basis !== undefined ? { basis: options.basis } : {}),
    ...(options.plan !== undefined ? { plan: options.plan } : {}),
    ...(options.idempotencyKey !== undefined ? { idempotencyKey: options.idempotencyKey } : {}),
    ...(options.member !== undefined ? { member: options.member } : {}),
    ...(options.approvedBy !== undefined ? { approvedBy: options.approvedBy } : {}),
  };
}
export class OutcomeCallError extends CapabilityCallError {
  constructor(code: string, readonly effectNone: boolean = false, readonly status?: number, readonly effectUnknown: boolean = false) { super(code); }
}
async function withOutcomes<T>(call: (client: NonNullable<PramaanClient['outcomes']>) => Promise<T>): Promise<T> {
  try {
    const outcomes = (await pramaan()).outcomes;
    if (!outcomes) throw new OutcomeCallError('not_found', true);
    return await call(outcomes);
  } catch (error) {
    if (error instanceof PramaanSchemaError) throw error;
    if (error instanceof OutcomeCallError) throw error;
    const details = error && typeof error === 'object' ? error as { code?: unknown; effect?: unknown; status?: unknown } : {};
    throw new OutcomeCallError(String(details.code ?? 'internal'), details.effect === 'none', typeof details.status === 'number' ? details.status : undefined, details.effect === 'unknown');
  }
}
export function listOutcomes(): Promise<OutcomeSummary[]> { return withOutcomes(client => client.list()); }
export function getOutcome(id: string): Promise<OutcomeDescription> { return withOutcomes(client => client.get(id)); }
export function estimateOutcome(id: string, input: unknown, options?: OutcomeRunOptions): Promise<OutcomeEstimate> {
  return withOutcomes(client => client.estimate(id, input, outcomeOptions(options)));
}
/** The SDK waits for a 202 job and returns its final report. Failed reports are never retried here. */
export function runOutcome(id: string, input: unknown, options?: OutcomeRunOptions): Promise<OutcomeRun> {
  return withOutcomes(client => client.run(id, input, outcomeOptions(options)));
}
export async function callCapability<K extends CapabilityId>(id: K, input: Requests[K], options?: RunOptions): Promise<Results[K]> {
  try { return await (await pramaan()).call(id, input, options); }
  catch (error) {
    if (error instanceof PramaanSchemaError || error instanceof IncompleteReplyError || error instanceof ReplyLimitConfigurationError) throw error;
    if (replyLimitError(error, id)) throw new ReplyLimitConfigurationError();
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'internal';
    throw new CapabilityCallError(code, id, code === 'invalid_request' && !!error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' && /Idempotency-Key.*required/i.test(error.message));
  }
}

function isJob<T>(value: T | CapabilityJob<T>): value is CapabilityJob<T> {
 return !!value && typeof value === 'object' && 'id' in value && typeof value.id === 'string' && 'status' in value && ['running', 'done', 'failed', 'cancelled'].includes(String(value.status));
}
function pollDelay(ms: number, signal: AbortSignal): Promise<void> {
 return new Promise((resolve, reject) => {
  const abort = () => { clearTimeout(timer); reject(signal.reason); };
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
  if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
 });
}
/** Stop waiting promptly and cancel an owned async job, including a late start response. */
export async function callCapabilityAbortable<K extends CapabilityId>(id: K, input: Requests[K], signal?: AbortSignal): Promise<Results[K]> {
 if (!signal) return callCapability(id, input);
 signal.throwIfAborted();
 const client = await pramaan(); signal.throwIfAborted();
 if (!client.run || !client.jobs) return abortable(callCapability(id, input), signal);
 const jobs = client.jobs; let jobId: string | undefined; let cancelSent = false;
 const cancel = () => { if (jobId && !cancelSent) { cancelSent = true; void jobs.cancel(jobId).catch(() => {}); } };
 signal.addEventListener('abort', cancel, { once: true });
 try {
  const pending = client.run(id, input).then(result => { if (isJob(result)) jobId = result.id; if (signal.aborted) cancel(); return result; });
  const started = await abortable(pending, signal);
  if (!isJob(started)) return started;
  let job: CapabilityJob = started; let interval = 2000; const deadline = Date.now() + 31 * 60_000;
  while (job.status === 'running') {
   signal.throwIfAborted(); job = await abortable(jobs.get(started.id), signal);
   if (job.status !== 'running') break;
   if (Date.now() + interval > deadline) throw new CapabilityCallError('upstream_timeout');
   await pollDelay(interval, signal); interval = Math.min(Math.ceil(interval * 1.5), 30_000);
  }
  if (job.status !== 'done' || job.result === undefined) throw new CapabilityCallError(job.error?.code ?? 'internal', id);
  return checkedReply(id, job.result as Results[K]);
 } catch (error) {
  if (signal.aborted) { cancel(); throw new DOMException('Request cancelled.', 'AbortError'); }
  if (error instanceof CapabilityCallError || error instanceof UserFacingError) throw error;
  if (replyLimitError(error, id)) throw new ReplyLimitConfigurationError();
  throw new CapabilityCallError(error && typeof error === 'object' && 'code' in error ? String(error.code) : 'internal', id);
 } finally { signal.removeEventListener('abort', cancel); }
}

export type PlatformFileTransport = {
  upload(bytes: Uint8Array, contentType: string, kind?: 'part'): Promise<string>;
  stream?(url: string): AsyncIterable<Uint8Array>;
  read(url: string): Promise<Uint8Array>;
  remove(fileId: string): Promise<void>;
};
let fileTransport: PlatformFileTransport | undefined;
export function setPlatformFileTransportForTests(transport?: PlatformFileTransport): void {
  if (process.env.NODE_ENV !== 'test') throw new Error('Test transport is unavailable.');
  fileTransport = transport;
}
async function platformBase(): Promise<string> {
  if (process.env.PRAMAAN_FAKE === '1') return 'http://127.0.0.1:9';
  return (process.env.PRAMAAN_BASE_URL ?? (await import('@pramaan/sdk')).PRAMAAN_API_URL).replace(/\/$/, '');
}
export async function uploadPlatformFile(bytes: Uint8Array, contentType: string): Promise<string> {
  const types = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'application/zip', 'text/csv', 'application/json', 'application/x-ndjson', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/flac', 'audio/mp4', 'video/mp4', 'video/webm', 'video/quicktime'];
  if (!types.includes(contentType)) throw new Error('This file format cannot use connected storage yet. Save it as PDF or a current Office format and try again.');
  if (contentType.startsWith('image/') && bytes.byteLength > 20_000_000) throw new Error('Connected image transfer supports files up to 20 MB.');
  if (fileTransport) return fileTransport.upload(bytes, contentType);
  const kind = contentType.startsWith('image/') ? 'image' : contentType.startsWith('audio/') ? 'audio' : contentType.startsWith('video/') ? 'video' : ['application/json', 'text/csv', 'application/zip', 'application/x-ndjson'].includes(contentType) ? 'data' : 'document';
  const response = await fetch(`${await platformBase()}/v1/files?kind=${kind}`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.PRAMAAN_API_KEY}`, 'Content-Type': contentType }, body: Buffer.from(bytes), redirect: 'error' });
  if (!response.ok) { const body = await response.json().catch(() => ({})) as {error?:{code?:string}}; throw new CapabilityCallError(body.error?.code ?? 'internal'); }
  const file = await response.json() as { fileId?: string };
  if (!file.fileId) throw new Error('Private file staging returned no handle.');
  return file.fileId;
}
export async function removePlatformFile(fileId: string): Promise<void> {
  if (fileTransport) return fileTransport.remove(fileId);
  if (!/^file_[A-Za-z0-9]+$/.test(fileId)) throw new Error('Invalid private file handle.');
  const response = await fetch(`${await platformBase()}/v1/files/${fileId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${process.env.PRAMAAN_API_KEY}` }, redirect: 'error' });
  if (!response.ok && response.status !== 404) throw new Error('Private file cleanup could not complete.');
}
export async function readPlatformFile(url: string): Promise<Uint8Array> {
  if (fileTransport) return fileTransport.read(url);
  const base = new URL(await platformBase()); const target = new URL(url);
  if (target.origin !== base.origin || !target.pathname.startsWith('/files/')) throw new Error('The file service returned an unsupported download location.');
  const response = await fetch(target, { redirect: 'error' });
  if (!response.ok) throw new Error('Private file download could not complete.');
  const reader = response.body?.getReader(); if (!reader) throw new Error('Private file body is missing.');
  const chunks: Buffer[] = []; let count = 0;
  try { while (true) { const next = await reader.read(); if (next.done) break; count += next.value.length;
    if (count > 25_000_000) { await reader.cancel(); throw new Error('Private download exceeds the file limit.'); } chunks.push(Buffer.from(next.value)); }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}


export class ChatStreamInterruptedError extends UserFacingError {
 constructor() { super('The reply stopped before it finished. The text shown is incomplete; no unfinished action was run.'); }
}
/** Pieces are for display; only the final checked result may authorize action execution. */
export async function streamChatCapability(input: Requests['llm.chat'], onText: (text: string) => void, signal?: AbortSignal): Promise<Results['llm.chat']> {
 signal?.throwIfAborted();
 const client = await pramaan();
 signal?.throwIfAborted();
 if (!client.stream) {
  try {
   const result = await callCapabilityAbortable('llm.chat', input, signal);
   if (result.text) onText(result.text);
   return result;
  } catch (error) { if (error instanceof IncompleteReplyError && !input.jsonSchema && error.partialText) onText(error.partialText); throw error; }
 }
 let received = false;
 let shown = '';
 return streamSignals.run(signal, async () => {
  try {
   for await (const event of client.stream!('llm.chat', input)) {
    signal?.throwIfAborted();
    received = true;
    if (event.type === 'text_delta') { shown += event.text; if (!input.jsonSchema) onText(event.text); }
    signal?.throwIfAborted();
    if (event.type === 'done') {
     const result = event.result;
     // A JSON reply/replay yields just done. Never append a completed answer twice.
     const text = result.text ?? '';
     if (result.finishReason === 'length') {
      if (!input.jsonSchema && text.startsWith(shown) && text.length > shown.length) onText(text.slice(shown.length));
      throw new IncompleteReplyError(text || shown);
     }
     if (!text.startsWith(shown)) throw new ChatStreamInterruptedError();
     if (!input.jsonSchema && text.length > shown.length) onText(text.slice(shown.length));
     checkedReply('llm.chat', result);
     if (input.jsonSchema && text) onText(text);
     return result;
    }
    // Incremental arguments are never passed to the application action runner.
   }
  } catch (error) {
   if (error instanceof PramaanSchemaError || error instanceof IncompleteReplyError || error instanceof ReplyLimitConfigurationError) throw error;
   if (replyLimitError(error, 'llm.chat')) throw new ReplyLimitConfigurationError();
   if (signal?.aborted) throw new DOMException('Request cancelled.', 'AbortError');
   // No events and explicit effect:none means no generation or charge occurred.
   // An empty/dropped connection alone is not evidence that retrying is free.
   if (!received && error && typeof error === 'object' && 'effect' in error && error.effect === 'none') {
    try { const result = await callCapabilityAbortable('llm.chat', input, signal); if (result.text) onText(result.text); return result; }
    catch (fallbackError) { if (fallbackError instanceof IncompleteReplyError && !input.jsonSchema && fallbackError.partialText) onText(fallbackError.partialText); throw fallbackError; }
   }
   throw new ChatStreamInterruptedError();
  }
  throw new ChatStreamInterruptedError();
 });
}


/** Raw staging files have no public link and are usable only by part.put. */
export async function uploadPlatformPart(bytes: Uint8Array): Promise<string> {
 if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error('The upload part is outside its size limit.');
 if (fileTransport) return fileTransport.upload(bytes, 'application/octet-stream', 'part');
 let response: Response;
 try { response = await fetch(`${await platformBase()}/v1/files?kind=part`, {
  method: 'POST', headers: { Authorization: `Bearer ${process.env.PRAMAAN_API_KEY}`, 'Content-Type': 'application/octet-stream' },
  body: Buffer.from(bytes), redirect: 'error', signal: AbortSignal.timeout(120_000),
 }); } catch { throw new CapabilityCallError('upstream_unavailable'); }
 if (!response.ok) {
  const body = await response.json().catch(() => ({})) as { error?: { code?: string } };
  throw new CapabilityCallError(body.error?.code ?? 'internal');
 }
 const result = await response.json().catch(() => { throw new CapabilityCallError('internal'); }) as { fileId?: string };
 if (!result.fileId || !/^file_[A-Za-z0-9]+$/.test(result.fileId)) throw new CapabilityCallError('internal');
 return result.fileId;
}
/** Consume the capability-issued artifact on the server; its URL is never returned to callers. */
export async function streamPrivateStorageObject(bucket: string, path: string, maxBytes: number, onChunk: (bytes: Uint8Array) => Promise<void> | void): Promise<number> {
 const { downloadUrl } = await callCapability('storage.object.download-url', { bucket, path, expiresIn: 3600 });
 let count = 0;
 const accept = async (bytes: Uint8Array) => {
  count += bytes.length; if (count > maxBytes) throw new Error('The stored file does not match its expected size.');
  await onChunk(bytes);
 };
 if (fileTransport) {
  if (fileTransport.stream) for await (const bytes of fileTransport.stream(downloadUrl)) await accept(bytes);
  else await accept(await fileTransport.read(downloadUrl));
  return count;
 }
 let target: URL; let base: URL;
 try { target = new URL(downloadUrl); base = new URL(await platformBase()); } catch { throw new Error('Private download location is unsupported.'); }
 if (target.username || target.password || (target.protocol !== 'https:' && target.origin !== base.origin)) throw new Error('Private download location is unsupported.');
 const { fetch: privateFetch, Agent } = await import('undici');
 const { lookup } = await import('node:dns/promises');
 const { isBlockedIp } = await import('./privateIp.js');
 let dispatcher: InstanceType<typeof Agent> | undefined;
 if (target.origin !== base.origin) {
  const addresses = await lookup(target.hostname, { all: true }).catch(() => { throw new Error('Private download location is unsupported.'); });
  if (!addresses.length || addresses.some(address => isBlockedIp(address.address))) throw new Error('Private download location is unsupported.');
  const address = addresses[0]!;
  dispatcher = new Agent({ connect: { lookup: (_hostname, options, callback) => {
   if (options.all) callback(null, [address]); else callback(null, address.address, address.family);
  } } });
 }
 try {
  const response = await privateFetch(target.href, { headers: { 'Accept-Encoding': 'identity' }, redirect: 'error', signal: AbortSignal.timeout(30 * 60_000), ...(dispatcher ? { dispatcher } : {}) });
  if (!response.ok || !response.body) { await response.body?.cancel().catch(() => {}); throw new Error('Private download did not complete.'); }
  const reader = response.body.getReader();
  try { while (true) { const next = await reader.read(); if (next.done) break; await accept(next.value); } }
  finally { await reader.cancel().catch(() => {}); }
 } catch { throw new Error('Private file verification could not complete.'); }
 finally { await dispatcher?.close(); }
 return count;
}

export type ManagedRecoverySender = { host: string; port: number; username: string; password: string; senderEmail: string; senderName: string };
/** New published id through the existing client's generic capability call; SDK stays pinned. */
export async function configureManagedRecovery(input: ManagedRecoverySender, idempotencyKey: string): Promise<{ recovery: { enabled: boolean; senderDomain?: string } }> {
  if (!idempotencyKey || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.senderEmail) || /(^|\.)pramaan\.(dev|one|ai|com)$/i.test(input.senderEmail.split('@')[1] ?? '')) throw new UserFacingError('Use a sender on your own verified domain.');
  try {
    const client = await pramaan();
    const call = client.call as (id: string, input: unknown, options: RunOptions) => Promise<unknown>;
    const result = await call.call(client, 'auth.backend.email.set', input, { idempotencyKey });
    const recovery = (result as { recovery?: { enabled?: boolean; senderDomain?: string } })?.recovery;
    if (typeof recovery?.enabled !== 'boolean' || recovery.enabled && recovery.senderDomain?.toLowerCase() !== input.senderEmail.split('@')[1]?.toLowerCase()) throw new Error('Unconfirmed recovery setup');
    return { recovery: { enabled: recovery.enabled, ...(recovery.senderDomain ? { senderDomain: recovery.senderDomain } : {}) } };
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'internal';
    throw new CapabilityCallError(code, 'auth.backend.email.set' as CapabilityId);
  }
}
