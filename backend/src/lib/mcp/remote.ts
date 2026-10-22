import { createHash, randomUUID } from 'node:crypto';
import { normalizePramaanSchema, callCapability } from '../pramaan';
import type { Db } from '../supabase';
import type { ConnectorRow, McpConnectorSummary, ToolCacheRow } from './types';
import { McpOAuthRequiredError } from './oauth';
const owner = (userId: string) => ({ kind: 'end-user' as const, endUserRef: userId });
export const remote = (row: ConnectorRow) => row.server_url === 'remote:';
export const remoteSource = 'connector.tools.list';
const links = new Map<string, { url: string; expires: number }>();
export function remoteRef(row: ConnectorRow): string {
 const ref = row.tool_policy?.connector_ref;
 if (typeof ref !== 'string' || !/^cn_[0-9a-f]{32}$/.test(ref)) throw new Error('Reconnect this remote service.');
 return ref;
}
export async function remoteState(userId: string, row: ConnectorRow) {
 const result = await callCapability('connector.connections.list', { owner: owner(userId), limit: 50 }, { endUser: userId });
 return result.results.find(item => item.connectorRef === remoteRef(row));
}
export async function remoteSummary(userId: string, row: ConnectorRow, db: Db): Promise<McpConnectorSummary> {
 const state = await remoteState(userId, row);
 const found = await db.from('user_mcp_connector_tools').select('*').eq('connector_id', row.id);
 if (found.error) throw new Error('Remote actions could not be loaded.');
 const tools = (found.data ?? []) as ToolCacheRow[];
 return { id: row.id, name: 'Remote service', serverUrl: 'remote:', transport: 'streamable_http', authType: row.auth_type, enabled: row.enabled,
 requireWriteApproval: true, readOnly: !!row.read_only, hasAuthConfig: row.auth_type !== 'none', customHeaderKeys: [], oauthConnected: state?.state === 'ready', toolPolicy: {},
 tools: tools.filter(t => t.annotations?.source === remoteSource).map(t => ({ id: t.id, toolName: t.tool_name_for_model, title: 'Remote action', description: t.description,
 enabled: t.enabled && !row.read_only, readOnly: false, destructive: true, write: true, lastSeenAt: t.last_seen_at })), toolCount: tools.length, createdAt: row.created_at, updatedAt: row.updated_at };
}
export async function registerRemote(userId: string, input: { name: string; serverUrl: string; authType?: string; bearerToken?: string | null; headers?: Record<string, unknown> }, db: Db) {
 if (Object.keys(input.headers ?? {}).length) throw new Error('Custom credential headers are not supported.');
 if (input.bearerToken) throw new Error('Token entry is disabled here. Use hosted sign-in or no sign-in.');
 const url = new URL(input.serverUrl);
 if (url.protocol !== 'https:' || url.port && url.port !== '443' || url.username || url.password || url.search || url.hash || !url.hostname.includes('.') || /^\[|^[\d.]+$/.test(url.hostname) || /(^|\.)(localhost|local|internal)$/.test(url.hostname)) throw new Error('Use a public HTTPS address on port 443 without credentials, query or fragment.');
 if (input.authType !== undefined && !['none', 'oauth'].includes(input.authType)) throw new Error('Use hosted sign-in or no sign-in.');
 const kind = input.authType === 'none' ? 'none' : 'oauth';
 const returnUrl = `${process.env.FRONTEND_URL ?? 'http://localhost:3000'}/settings/connectors`;
 if (kind === 'oauth' && new URL(returnUrl).protocol !== 'https:') throw new Error('Hosted sign-in requires a public HTTPS app address.');
 const registered = await callCapability('connector.connection.register', { owner: owner(userId), url: url.href, auth: kind === 'none' ? { kind } : { kind, returnUrl } }, { endUser: userId, idempotencyKey: randomUUID() });
 const saved = await db.from('user_mcp_connectors').insert({ user_id: userId, name: 'Remote service', server_url: 'remote:', transport: 'streamable_http', auth_type: kind,
 enabled: true, require_write_approval: true, read_only: false, tool_policy: { connector_ref: registered.connectorRef } }).select('*').single();
 if (saved.error || !saved.data) {
  await callCapability('connector.connection.disconnect', { owner: owner(userId), connectorRef: registered.connectorRef, confirm: true }, { endUser: userId, idempotencyKey: randomUUID() });
  throw new Error('The remote connection could not be saved.');
 }
 for (const [key, link] of links) if (link.expires <= Date.now()) links.delete(key);
 if (registered.connectUrl && registered.expiresAt) links.set(`${userId}:${saved.data.id}`, { url: registered.connectUrl, expires: Date.parse(registered.expiresAt) });
 return remoteSummary(userId, saved.data as ConnectorRow, db);
}
export function remoteSignIn(userId: string, row: ConnectorRow) {
 const key = `${userId}:${row.id}`, link = links.get(key);
 if (!link || link.expires <= Date.now()) { links.delete(key); throw new Error('The sign-in link expired. Remove this connection and add its address again.'); }
 return { authorizationUrl: link.url, alreadyAuthorized: false };
}
export async function updateRemote(userId: string, row: ConnectorRow) {
 // Never exempt calls from either platform approval or this application's review.
 await callCapability('connector.connection.update', { owner: owner(userId), connectorRef: remoteRef(row), label: 'Remote service', allowWithoutApproval: [] }, { endUser: userId, idempotencyKey: randomUUID() });
}
export async function disconnectRemote(userId: string, row: ConnectorRow) {
 await callCapability('connector.connection.disconnect', { owner: owner(userId), connectorRef: remoteRef(row), confirm: true }, { endUser: userId, idempotencyKey: `disconnect:${row.id}` });
 links.delete(`${userId}:${row.id}`);
}
export async function listRemoteTools(userId: string, row: ConnectorRow, db: Db, cursor?: string) {
 if (cursor && cursor.length > 8) throw new Error('The remote action page is invalid.');
 if ((await remoteState(userId, row))?.state !== 'ready') throw new McpOAuthRequiredError('Remote sign-in is pending or failed.');
 const page = await callCapability('connector.tools.list', { owner: owner(userId), connectorRef: remoteRef(row), limit: 50, ...(cursor ? { cursor } : { refresh: true }) }, { endUser: userId });
 const rows = [];
 for (const item of page.results) {
  const schema = item.inputSchema;
  if (!schema || typeof schema !== 'object' || Array.isArray(schema) || (schema as Record<string, unknown>).type !== 'object') continue;
  normalizePramaanSchema(schema, `remote:${item.toolRef}`);
  const old = await db.from('user_mcp_connector_tools').select('enabled').eq('connector_id', row.id).eq('tool_name', item.toolRef).maybeSingle();
  if (old.error) throw new Error('Remote action settings could not be loaded.');
  rows.push({ connector_id: row.id, tool_name: item.toolRef, tool_name_for_model: `mcp_${row.id.replace(/-/g, '').slice(0,12)}_${createHash('sha256').update(item.toolRef).digest('hex').slice(0,12)}`,
 title: 'Remote action', description: 'Remote action. Review the input before running.', input_schema: schema, annotations: { source: remoteSource, schema_digest: item.schemaDigest }, requires_confirmation: true, enabled: old.data?.enabled !== false, last_seen_at: new Date().toISOString() });
 }
 if (rows.length) { const saved = await db.from('user_mcp_connector_tools').upsert(rows, { onConflict: 'connector_id,tool_name' }); if (saved.error) throw new Error('Remote actions could not be saved.'); }
 return { ...await remoteSummary(userId,row,db), discovery: { query: 'Remote actions', ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) } };
}
export async function freshRemoteTool(userId: string, row: ConnectorRow, tool: ToolCacheRow) {
 let cursor: string | undefined;
 // At most 200 tools. One fresh snapshot, followed by its cached pages.
 for (let page = 0; page < 4; page++) {
  const listed = await callCapability('connector.tools.list', { owner: owner(userId), connectorRef: remoteRef(row), limit: 50, ...(cursor ? { cursor } : { refresh: true }) }, { endUser: userId });
  const found = listed.results.find(item => item.toolRef === tool.tool_name);
  if (found) return found.schemaDigest === tool.annotations?.schema_digest && JSON.stringify(found.inputSchema) === JSON.stringify(tool.input_schema);
  cursor = listed.nextCursor; if (!cursor) return false;
 }
 return false;
}
export async function callRemote(userId: string, row: ConnectorRow, tool: ToolCacheRow, args: Record<string, unknown>, approvalId: string) {
 return callCapability('connector.tool.call', { owner: owner(userId), connectorRef: remoteRef(row), toolRef: tool.tool_name, input: args }, { endUser: userId, idempotencyKey: `approval:${approvalId}` });
}
