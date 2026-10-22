import type { Db } from './supabase';
import { resolveModel } from './llm/models';
export type RouterSlug = 'capability';
export const ROUTER_SLUGS: readonly RouterSlug[] = ['capability'];
export type RouterModelSelections = Record<RouterSlug, string[]>;
export const QUALITY_CHOICES = ['fast', 'balanced', 'best'] as const;
export function routerForModelId(_model: string): null { return null; }
export function isRouterModelSelected(model: string, _selections: RouterModelSelections): boolean { return (QUALITY_CHOICES as readonly string[]).includes(model); }
export async function resolveRequestedModel(requested: string | null | undefined, fallback: string, _userId: string, _db?: Db, _onOutsideSelection: 'throw' | 'fallback' = 'fallback'): Promise<string> { return resolveModel(requested, fallback); }
export async function getAllUserRouterModels(_userId: string, _db?: Db): Promise<RouterModelSelections> { return { capability: [...QUALITY_CHOICES] }; }
export async function getUserRouterModels(_userId: string, _router: string, _db?: Db): Promise<string[]> { return [...QUALITY_CHOICES]; }
export async function replaceUserRouterModels(_userId: string, _router: string, _models: string[], _db?: Db): Promise<void> { /* Quality choices are capability-owned; personal catalogs are unsupported. */ }
