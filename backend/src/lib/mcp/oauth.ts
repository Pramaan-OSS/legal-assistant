export class McpOAuthRequiredError extends Error { readonly code = 'connection_required'; }
export function mcpConnectorSetupInstructions(server: string): string | null {
 return server.startsWith('app:') || server.startsWith('https:') ? null : 'Remote services require a public HTTPS address; custom headers and other transports are unavailable.';
}
export async function loadOAuthToken(..._args: unknown[]): Promise<null> { return null; }
export async function refreshOAuthAccessToken(..._args: unknown[]): Promise<void> {}
