import type { Db } from '../supabase';
import { createUserMcpConnector, listUserMcpConnectors, startUserMcpConnectorOAuth, updateUserMcpConnector, deleteUserMcpConnector } from '../mcp/servers';
export async function nativeConnection(userId: string, key: string, db: Db, create = false) {
 const items = await listUserMcpConnectors(userId, db);
 const found = items.find(c => c.serverUrl === `app:${key}`);
 return found ?? (create ? await createUserMcpConnector(userId, { name: key, serverUrl: `app:${key}` }, db) : null);
}
export async function startNative(userId: string, key: string, redirectUri: string, db: Db) {
 const row = await nativeConnection(userId, key, db, true);
 const result = await startUserMcpConnectorOAuth(userId, row!.id, redirectUri, db);
 return { authorizationUrl: result.authorizationUrl! };
}
export async function nativeStatus(userId: string, key: string, db: Db) {
 const row = await nativeConnection(userId, key, db);
 return { configured: !!process.env.PRAMAAN_API_KEY, schemaReady: true, scope: null, connected: !!row?.oauthConnected,
   writeEnabled: !!row?.oauthConnected && !row.readOnly, enabled: row?.enabled ?? true, requireWriteApproval: true,
   readOnly: row?.readOnly ?? false, grantId: row?.id, tools: (row?.tools ?? []).map(t => ({ name: t.toolName, title: t.title ?? 'Connected action', description: t.description ?? '', write: t.write, enabled: t.enabled })) };
}
export async function updateNative(userId: string, key: string, settings: { enabled?: boolean; requireWriteApproval?: boolean; readOnly?: boolean }, db: Db) {
 const row = await nativeConnection(userId, key, db);
 if (!row) throw new Error('Connect this account first.');
 await updateUserMcpConnector(userId, row.id, settings, db);
}
export async function disconnectNative(userId: string, key: string, db: Db) {
 const row = await nativeConnection(userId, key, db);
 if (row) await deleteUserMcpConnector(userId, row.id, db);
}
