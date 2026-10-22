import { CapabilityCallError } from '../pramaan';
export function providerFailureStatus(error: unknown): number | null {
 const seen = new Set<object>(); let current = error;
 for (let depth = 0; depth < 8; depth++) {
  if (!current || typeof current !== 'object' || seen.has(current)) break;
  seen.add(current);
  if (current instanceof CapabilityCallError) return current.code === 'rate_limited' ? 429 : current.code === 'unauthorized' ? 401 : 502;
  const wrapped = current as { statusCode?: unknown; lastError?: unknown; cause?: unknown };
  const status = wrapped.statusCode; if (typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599) return status;
  current = wrapped.lastError ?? wrapped.cause;
 }
 return null;
}
export function streamErrorMessage(_error: unknown): string { return 'The assistant could not complete this request.'; }
