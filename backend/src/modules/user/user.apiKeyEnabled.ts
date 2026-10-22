import type { Db } from '../../lib/supabase';
import { failure, type ServiceResult } from '../../lib/serviceResult';
import type { ApiKeyProvider, ApiKeyStatus } from './user.apiKeyStore';
export async function setApiKeyEnabled(_db: Db, _userId: string, _provider: ApiKeyProvider, _enabled: boolean): Promise<ServiceResult<ApiKeyStatus>> {
 return failure('unavailable', 'The owner configures one server-side capability key.');
}
