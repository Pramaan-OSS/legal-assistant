export type McpErrorDiagnostic = { message: string; httpStatus?: number; mcpCode?: number | string; serverError?: { code?: number | string; status?: string; message: string } };
export function formatMcpErrorForAgent(_error: unknown): McpErrorDiagnostic { return { message: 'The connected action could not complete.' }; }
export function conciseMcpErrorMessage(_error: unknown, _server?: string): string { return 'The connected action could not complete.'; }
export function mcpToolResultErrorMessage(result: unknown): string | null { return result && typeof result === 'object' && 'isError' in result && result.isError ? 'The connected action could not complete.' : null; }
export function sanitizeMcpToolErrorResult(_result: unknown): Record<string, unknown> { return { isError: true, message: 'The connected action could not complete.' }; }
export class ConnectorSetupError extends Error { readonly code = 'connector_setup_required'; }
