import type { ModelToggleOption } from "../ui/ModelToggleUI";
export type ModelOption = ModelToggleOption;
export const MODELS: readonly ModelOption[] = [
 { id: 'fast', label: 'Fast', group: 'Quality' },
 { id: 'balanced', label: 'Balanced', group: 'Quality' },
 { id: 'best', label: 'Best', group: 'Quality' },
];
export const SETTINGS_MODELS = MODELS;
export const DEFAULT_MODEL_ID = 'balanced';
export const ALLOWED_MODEL_IDS = new Set(MODELS.map(m => m.id));
export const LEGACY_MODEL_IDS: Readonly<Record<string, string>> = {};
export function canonicalModelId(id: string): string { return ALLOWED_MODEL_IDS.has(id) ? id : 'balanced'; }
export const ROUTER_SLUGS = ["capability"] as const;
export type RouterSlug = (typeof ROUTER_SLUGS)[number];
export function isRouterSlug(value: string): value is RouterSlug { return value === 'capability'; }
export const ROUTER_PROFILE_FIELDS = { capability: 'qualityModels' } as const;
export type RouterProfileField =
  (typeof ROUTER_PROFILE_FIELDS)[RouterSlug];

/** Every router's saved Model Selections, as profile fields. */
export type RouterProfileLists = Record<RouterProfileField, string[]>;

/** Every router's saved Model Selections, keyed by router slug. */
export type RouterSelections = Record<RouterSlug, string[]>;

export function routerSelections(_profile: Partial<Record<RouterProfileField, unknown>>): RouterSelections { return Object.fromEntries(ROUTER_SLUGS.map(s => [s, [] as string[]])) as RouterSelections; }
export function routerProfileLists(_profile: Partial<Record<RouterProfileField, unknown>>): RouterProfileLists { return Object.fromEntries(Object.values(ROUTER_PROFILE_FIELDS).map(s => [s, [] as string[]])) as RouterProfileLists; }
export function routerForModelId(_id: string): RouterSlug | null { return null; }
export function isRouterModelSelected(_id: string, _selections: RouterSelections): boolean { return true; }
export function isAllowedModelId(id: string, _configured: readonly string[] = []): boolean { return ALLOWED_MODEL_IDS.has(id); }
export function modelDisplayName(id: string): string { return MODELS.find(m => m.id === canonicalModelId(id))!.label; }
export function underlyingProviderGroup(_id: string, _router: RouterSlug): string { return 'Quality'; }
export function withoutExplicitProtocol(id: string): string { return canonicalModelId(id); }
export function routerModelOptions(_router: RouterSlug, _models: readonly string[]): ModelOption[] { return []; }
export function allRouterModelOptions(_selections: Partial<RouterSelections>): ModelOption[] { return []; }
export type ModelProvider = string;
export interface ProviderKeyState { configured: boolean; enabled?: boolean }
export type ProviderKeyStates = Partial<Record<string, ProviderKeyState | undefined>>;
export function modelGroupToProvider(_group: ModelOption['group']): ModelProvider { return 'capability'; }
export function getModelProvider(id: string): ModelProvider | null { return ALLOWED_MODEL_IDS.has(id) ? 'capability' : null; }
export function isProviderAvailable(_provider: ModelProvider, keys: ProviderKeyStates): boolean { return keys.capability?.configured === true && keys.capability.enabled !== false; }
export function isModelAvailable(id: string, keys: ProviderKeyStates, _configured: readonly string[] = []): boolean { return ALLOWED_MODEL_IDS.has(id) && isProviderAvailable('capability', keys); }
export function providerLabel(_provider: ModelProvider, _options?: { withProduct?: boolean }): string { return 'Connected capabilities'; }
export function unavailableModelMessage(_id: string, _keys: ProviderKeyStates): string { return 'Ask the owner to configure capability access.'; }
export type NoModelsReason = 'api-keys' | 'router-models' | 'providers-disabled';
export function noModelsReason(_keys: ProviderKeyStates | null | undefined, _selections: Partial<RouterSelections>): NoModelsReason { return 'api-keys'; }
export const NO_MODELS_MESSAGES: Record<NoModelsReason, string> = { 'api-keys': 'Ask the owner to configure capability access.', 'router-models': 'Choose a quality level.', 'providers-disabled': 'Capability access is unavailable.' };
