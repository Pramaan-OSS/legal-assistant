import type { ReasoningLevel, Provider } from "./types";
export const QUALITY_CHOICES = ["fast", "balanced", "best"] as const;
export const LEGACY_MODEL_IDS: Record<string, string> = {};
export function resolveModel(id?: string | null, fallback = 'balanced'): string { return id === 'fast' || id === 'balanced' || id === 'best' ? id : fallback; }
export function providerForModel(_model: string): Provider { return 'capability'; }
export function reasoningLevelsForModel(_model: string): readonly ReasoningLevel[] { return []; }
export function normalizeReasoningLevelForModel(_model: string, _reasoning?: ReasoningLevel): ReasoningLevel | undefined { return undefined; }
export function isSafeAccountModelId(_id: string, _prefix?: string): boolean { return false; }
export function isSafeAccountModel(_id: string): boolean { return false; }
export function accountModelPrefix(_id: string): null { return null; }

export type AccountModelPrefix = "capability";
export const ACCOUNT_MODEL_LABELS = { capability: "Quality" };
