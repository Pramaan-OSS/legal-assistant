import type { UserApiKeys, ProviderSettings } from "../../lib/llm";
import { createServerSupabase, type Db } from "../../lib/supabase";
export type ApiKeyProvider = "capability";
export type ApiKeySource = "user" | "env" | null;
/** Providers whose key is only usable together with a non-secret setting. */
export type SettingsApiKeyProvider = never;
export type ApiKeyStatus = Record<ApiKeyProvider, boolean> & {
    sources: Record<ApiKeyProvider, ApiKeySource>;
    enabled: Partial<Record<ApiKeyProvider, boolean>>;

    settings: ProviderSettings;
};

const providers = ["capability"] as const;
export function isSettingsApiKeyProvider(_provider: ApiKeyProvider): _provider is SettingsApiKeyProvider { return false; }
export function normalizeProviderSettings(_provider: SettingsApiKeyProvider, _input: unknown): ProviderSettings | null { return null; }
export function hasEnvApiKey(_provider: ApiKeyProvider): boolean { return !!process.env.PRAMAAN_API_KEY; }
export function normalizeApiKeyProvider(value: string): ApiKeyProvider | null { return providers.includes(value as ApiKeyProvider) ? value as ApiKeyProvider : null; }
export async function getUserApiKeyStatus(_userId: string, _db: Db = createServerSupabase()): Promise<ApiKeyStatus> {
 const ready = !!process.env.PRAMAAN_API_KEY;
 return { capability: ready, sources: { capability: ready ? 'env' : null }, enabled: { capability: true }, settings: {} };
}
export async function getUserApiKeys(_userId: string, _db?: Db): Promise<UserApiKeys> { return {}; }
export async function saveUserApiKey(..._args: unknown[]): Promise<void> { throw new Error('Personal provider keys are no longer supported.'); }
export async function getSavedApiKeySettings(..._args: unknown[]): Promise<null> { return null; }
export async function updateUserApiKeySettings(..._args: unknown[]): Promise<void> { throw new Error('Personal provider settings are no longer supported.'); }
