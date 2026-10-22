import { beforeEach, vi } from 'vitest';
import { setPramaanClientForTests, type PramaanClient } from './src/lib/pramaan';
// Tests must configure their own fake responses. An unconfigured capability
// fails locally; neither an inherited key nor a default base can reach live API.
beforeEach(() => {
 vi.stubEnv('NODE_ENV', 'test');
 vi.stubEnv('PRAMAAN_API_KEY', 'fake-verification-key');
 vi.stubEnv('PRAMAAN_BASE_URL', 'http://127.0.0.1:1');
 setPramaanClientForTests({ call: async () => { throw new Error('Configure this test’s fake capability response.'); } } as PramaanClient);
});
