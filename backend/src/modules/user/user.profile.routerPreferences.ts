import type { RouterSlug } from '../../lib/routerModels';
import { QUALITY_CHOICES } from '../../lib/routerModels';
export const ROUTER_PROFILE_FIELDS: Record<RouterSlug, string> = { capability: 'qualityModels' };
export function normalizeRouterModels(value: unknown, _provider: RouterSlug): string[] {
 if (!Array.isArray(value)) return [];
 return [...new Set(value.filter((item): item is string => typeof item === 'string' && (QUALITY_CHOICES as readonly string[]).includes(item)))];
}
