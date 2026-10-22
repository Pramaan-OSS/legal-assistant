const publicSegments = new Set(["api", "projects", "project", "documents", "document", "assistant", "chat", "settings", "connectors", "models", "features", "profile", "support", "auth", "login", "signup", "logout", "users", "files", "uploads", "workflows", "library", "tabular-review", "templates", "download", "upload", "sessions", "organizations", "members", "invitations", "tools", "actions", "run", "cancel", "status", "health", "search"]);
export function diagnosticRoute(path: string): string {
 let pathname: string;
 try { pathname = new URL(path, "http://local.invalid").pathname; } catch { return "/:id"; }
 return pathname.split("/").map(segment => !segment || publicSegments.has(segment) ? segment : ":id").join("/");
}
export function diagnosticErrorTags(error: unknown): { failure_code?: string } {
 const seen = new Set<unknown>(); const pending = [error];
 for (let n = 0; pending.length && n < 16; n++) { const item = pending.shift(); if (!item || typeof item !== 'object' || seen.has(item)) continue; seen.add(item);
  const row = item as { code?: unknown; cause?: unknown; errors?: unknown[] }; if (typeof row.code === 'string' && /^[A-Z_]+$/.test(row.code)) return { failure_code: row.code };
  pending.push(row.cause, ...(Array.isArray(row.errors) ? row.errors.slice(0, 8) : [])); }
 return {};
}
