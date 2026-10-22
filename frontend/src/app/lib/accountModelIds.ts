export const ACCOUNT_MODEL_PROVIDERS = ['capability'] as const;
export type AccountModelProvider = 'capability';
export function isSafeAccountModelId(_provider: AccountModelProvider, id: string): boolean { return ['fast', 'balanced', 'best'].includes(id); }
