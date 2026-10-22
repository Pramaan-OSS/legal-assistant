import { getUserApiKeyStatus, type ApiKeyStatus, type ApiKeyProvider } from './user.apiKeyStore';
import type { Db } from './user.shared';
export const REENTER_KEY_FOR_ENDPOINT = 'Personal keys are not supported.';
export function getApiKeyStatus(db: Db, userId: string) { return getUserApiKeyStatus(userId, db); }
type SaveResult = { ok: true; status: ApiKeyStatus } | { ok: false; kind: 'invalid_key' | 'invalid_settings' | 'no_saved_key' | 'key_required'; detail: string } | { ok: false; kind: 'save_failed'; error: unknown };
export async function saveApiKey(_db: Db, _params: { userId: string; provider: ApiKeyProvider; apiKey: string | null; settings?: unknown }): Promise<SaveResult> {
 return { ok: false as const, kind: 'invalid_key' as const, detail: 'The owner configures one server-side capability key.' };
}
