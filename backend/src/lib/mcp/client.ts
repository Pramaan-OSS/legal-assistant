export function mcpOAuthCallbackUrl(): string { return `${process.env.FRONTEND_URL ?? 'http://localhost:3000'}/settings/connectors`; }
