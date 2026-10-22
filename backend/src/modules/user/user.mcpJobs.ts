import type { Db, DbJob } from '../../lib/dbq/types';
export const MCP_TOKEN_REFRESH_WINDOW_MS = 15 * 60 * 1000;
/** Connection credential refresh is owned by the capability service. Old queued jobs are safe to consume. */
export async function handleMcpRefreshToken(_db: Db, _job: DbJob): Promise<void> {}
