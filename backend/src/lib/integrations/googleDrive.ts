import { createServerSupabase, type Db } from '../supabase';
import type { ConnectorApprovalItem, GoogleDriveStatus as Status } from '@legal-assistant/contracts';
import { startNative, nativeStatus, updateNative, disconnectNative, nativeConnection } from './nativeConnections';
import { planMcpToolCall, executeMcpToolCall, executeApprovedMcpToolCall, setUserMcpToolEnabled } from '../mcp/servers';
export class GoogleDriveUserError extends Error {}
export class GoogleDriveAuthRequiredError extends GoogleDriveUserError {}
export type GoogleDriveStatus = Status & { schemaReady: boolean };
export const GOOGLE_DRIVE_TOOL_PREFIX = 'google_drive_';
export function googleDriveSetupInstructions(_redirectUri: string): string { return 'Connect through Settings → Connected apps.'; }
export async function startGoogleDriveOAuth(userId: string, redirectUri: string, db: Db = createServerSupabase()) { return startNative(userId, 'files', redirectUri, db); }
export async function completeGoogleDriveOAuth(userId: string, _state: string, _code: string, db: Db = createServerSupabase()) { return getGoogleDriveStatus(userId, db); }
export async function getGoogleDriveStatus(userId: string, db: Db = createServerSupabase()): Promise<GoogleDriveStatus> { return nativeStatus(userId, 'files', db); }
export async function updateGoogleDriveSettings(userId: string, settings: { enabled?: boolean; requireWriteApproval?: boolean; readOnly?: boolean }, db: Db = createServerSupabase()) { return updateNative(userId, 'files', settings, db); }
export async function setGoogleDriveToolEnabled(userId: string, toolName: string, enabled: boolean, db: Db = createServerSupabase()) {
 const row = await nativeConnection(userId, 'files', db); const tool = row?.tools.find(t => t.toolName === toolName);
 if (!row || !tool) throw new Error('Choose a discovered connected action.');
 return setUserMcpToolEnabled(userId, row.id, tool.id, enabled, db);
}
export async function disconnectGoogleDrive(userId: string, db: Db = createServerSupabase()) { return disconnectNative(userId, 'files', db); }
export async function cancelGoogleDriveOAuth(_userId: string, _state: string, _db: Db = createServerSupabase()): Promise<void> {}
export async function buildGoogleDriveTools(_userId: string, _db: Db): Promise<never[]> { return []; }
export async function planGoogleDriveCall(userId: string, name: string, input: Record<string, unknown>, db: Db) { return planMcpToolCall(userId, name, input, db); }
export async function executeGoogleDriveToolCall(userId: string, name: string, input: Record<string, unknown>, db: Db) { return executeMcpToolCall(userId, name, input, db); }
export async function executeApprovedGoogleDriveCall(userId: string, item: ConnectorApprovalItem, db: Db) { return executeApprovedMcpToolCall(userId, item, db); }
