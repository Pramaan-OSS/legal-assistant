import type { ConnectorApprovalItem } from '@legal-assistant/contracts';
import type { Db } from '../supabase';
import { workspaceStatus, type GoogleProvider } from './googleWorkspaceAuth';
import { planMcpToolCall, executeMcpToolCall, executeApprovedMcpToolCall } from '../mcp/servers';
export function isGoogleWorkspaceTool(name: string) { return name.startsWith('gmail_') || name.startsWith('google_calendar_'); }
export async function workspaceConnectorStatus(db: Db, userId: string, provider: GoogleProvider) { return workspaceStatus(db, userId, provider); }
export async function buildGoogleWorkspaceTools(_userId: string, _db: Db): Promise<never[]> { return []; }
export async function planGoogleWorkspaceCall(userId: string, name: string, input: Record<string, unknown>, db: Db) { return planMcpToolCall(userId, name, input, db); }
export async function executeGoogleWorkspaceToolCall(userId: string, name: string, input: Record<string, unknown>, db: Db) { return executeMcpToolCall(userId, name, input, db); }
export async function executeApprovedGoogleWorkspaceCall(userId: string, item: ConnectorApprovalItem, db: Db) { return executeApprovedMcpToolCall(userId, item, db); }

export function workspaceToolList(_provider: GoogleProvider, _grant: unknown): { name: string }[] { return []; }
