export type ReportLevel = 'fatal' | 'error' | 'warning';
export type ReportContext = { tags?: Record<string, unknown>; extra?: Record<string, unknown>; level?: ReportLevel; fingerprint?: string[] };
export function reportError(_error: unknown, _context: ReportContext = {}): null { return null; }
export function reportMessage(_message: string, _context: ReportContext = {}): null { return null; }
export function tagCurrentRequest(_id: string): void {}
export function setCurrentUser(_id: string | null): void {}
export async function flushDiagnostics(_timeout = 2000): Promise<void> {}
export function requestRoutePattern(req?: { baseUrl?: string; route?: { path?: unknown }; originalUrl?: string }): string | undefined {
  const route = typeof req?.route?.path === 'string' ? (req.baseUrl ?? '') + req.route.path : req?.originalUrl?.split('?')[0];
  return route === undefined ? undefined : route.replace(/\/+$/, '') || '/';
}
export function bestEffort<T>(work: Promise<T>, _context: { what: string; tags?: ReportContext['tags']; extra?: ReportContext['extra'] }): Promise<T | undefined> {
  return work.catch(() => { console.warn('A background cleanup operation could not complete.'); return undefined; });
}
