import type { GoogleWorkspaceProvider } from '@legal-assistant/contracts';
import type { Db } from '../supabase';
import { startNative, nativeStatus, updateNative, disconnectNative, nativeConnection } from './nativeConnections';
import { setUserMcpToolEnabled } from '../mcp/servers';
export type GoogleProvider = GoogleWorkspaceProvider;
export const GOOGLE_PROVIDERS = { gmail: { name: 'Mail' }, 'google-calendar': { name: 'Calendar' } };
export class GoogleWorkspaceError extends Error {}
const key = (provider: GoogleProvider) => provider === 'gmail' ? 'mail' : 'calendar';
export function googleWorkspaceSetupInstructions(_provider: GoogleProvider, _redirectUri: string) { return 'Connect through Settings → Connected apps.'; }
export async function workspaceStatus(db: Db, userId: string, provider: GoogleProvider) { return nativeStatus(userId, key(provider), db); }
export async function startWorkspaceOAuth(db: Db, userId: string, provider: GoogleProvider, redirectUri: string) { return startNative(userId, key(provider), redirectUri, db); }
export async function completeWorkspaceOAuth(db: Db, userId: string, provider: GoogleProvider, _state: string, _code: string) { return workspaceStatus(db, userId, provider); }
export async function cancelWorkspaceOAuth(_db: Db, _userId: string, _provider: GoogleProvider, _state?: string): Promise<void> {}
export async function disconnectWorkspace(db: Db, userId: string, provider: GoogleProvider) { return disconnectNative(userId, key(provider), db); }
export async function updateWorkspaceSettings(db: Db, userId: string, provider: GoogleProvider, settings: { enabled?: boolean; requireWriteApproval?: boolean; readOnly?: boolean }) { return updateNative(userId, key(provider), settings, db); }
export async function setWorkspaceToolEnabled(db: Db, userId: string, provider: GoogleProvider, name: string, enabled: boolean) {
 const row = await nativeConnection(userId, key(provider), db); const tool = row?.tools.find(t => t.toolName === name);
 if (!row || !tool) throw new Error('Choose a discovered connected action.');
 return setUserMcpToolEnabled(userId, row.id, tool.id, enabled, db);
}
