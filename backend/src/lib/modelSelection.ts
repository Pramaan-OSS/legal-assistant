import { REASONING_LEVELS, resolveModel, type UserApiKeys, type ReasoningLevel } from './llm';
import type { RouterModelSelections } from './routerModels';
import type { Db } from './supabase';
export const MODEL_REQUIRED_DETAIL = 'Choose a quality level before sending.';
export const TABULAR_MODEL_REQUIRED_DETAIL = 'Choose a quality level before running the review.';
export const DEFAULT_REASONING_LEVEL: ReasoningLevel = 'high';
export function normalizeReasoningLevel(value: unknown): ReasoningLevel | null {
  return value === 'minimal' ? 'low' : (REASONING_LEVELS as readonly unknown[]).includes(value) ? value as ReasoningLevel : null;
}
export function resolveEffectiveReasoningLevel(args: { model: string; requested?: unknown; chatReasoningLevel?: unknown; lastSelectedReasoningLevel?: unknown }): ReasoningLevel {
  return normalizeReasoningLevel(args.requested) ?? normalizeReasoningLevel(args.chatReasoningLevel) ?? normalizeReasoningLevel(args.lastSelectedReasoningLevel) ?? DEFAULT_REASONING_LEVEL;
}
export function normalizeOptionalModelPreference(value: string | null | undefined, _routerModels: RouterModelSelections): string | null { return value ? resolveModel(value) : null; }
export function hasApiKeyForModel(_model: string, _keys: UserApiKeys): boolean { return !!process.env.PRAMAAN_API_KEY; }
type EffectiveChatModelResult = { ok: true; model: string; source: 'request' | 'chat' | 'last_selected' } | { ok: false; status: 400 | 422; code: 'model_required' | 'model_unavailable' | 'missing_api_key'; detail: string };
export async function resolveEffectiveChatModel(args: { requested?: string | null; chatModel?: string | null; lastSelectedModel?: string | null; apiKeys: UserApiKeys; userId: string; db: Db }): Promise<EffectiveChatModelResult> {
  if (!process.env.PRAMAAN_API_KEY) return { ok: false, status: 422, code: 'missing_api_key', detail: 'Connected capabilities need the workspace owner’s server key.' };
  if (args.requested?.trim() && !resolveModel(args.requested, '')) return { ok: false, status: 400, code: 'model_unavailable', detail: 'Choose Fast, Balanced or Best.' };
  const model = resolveModel(args.requested ?? args.chatModel ?? args.lastSelectedModel, 'balanced');
  return { ok: true as const, model, source: args.requested ? 'request' as const : args.chatModel ? 'chat' as const : 'last_selected' as const };
}
export function titleModelForChat(_model: string, preferred?: string | null): string { return resolveModel(preferred, 'fast'); }
