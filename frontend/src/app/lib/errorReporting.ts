const handled = new WeakSet<object>();
export type ReportLevel = 'fatal' | 'error' | 'warning';
export type ReportContext = { tags?: Record<string, unknown>; extra?: Record<string, unknown>; level?: ReportLevel; fingerprint?: string[] };
export function markErrorHandled(error: unknown): void { if (error && typeof error === 'object') handled.add(error); }
export function isReported(error: unknown): boolean { return !!error && typeof error === 'object' && handled.has(error); }
export function reportError(error: unknown, _context?: ReportContext): null { markErrorHandled(error); return null; }
export function reportApiFailure(failure: { error?: unknown; [key: string]: unknown }): null { markErrorHandled(failure.error); return null; }
export function reportNetworkFailure(error: unknown, _context?: unknown): null { markErrorHandled(error); return null; }
export function trackPendingRequest(): () => void { return () => {}; }
export function resetApiUnreachableWindow(): void {}
export function setReportingUser(_user: { id: string } | null): void {}
export const API_UNREACHABLE_WINDOW_MS = 60_000;
