import type { ConfiguredModel, UserApiKeys } from './types';
export function loadModelRegistry() { return { models: [] as ConfiguredModel[] }; }
export function resetModelRegistryCache(): void {}
export function getConfiguredModel(_id: string): ConfiguredModel | null { return null; }
export function configuredModelSummaries(_keys?: UserApiKeys): never[] { return []; }
export function configuredEndpointSummaries(_keys?: UserApiKeys): never[] { return []; }
export function apiKeyForConfiguredModel(_model: ConfiguredModel, _keys?: UserApiKeys): null { return null; }
export function configuredModelRequiresApiKey(_model: ConfiguredModel): boolean { return true; }
export function tolerateTextToolCalls(_model: ConfiguredModel): boolean { return false; }
export function replaysReasoning(_id: string): boolean { return false; }
