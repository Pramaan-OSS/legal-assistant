import { afterEach, expect, it, vi } from 'vitest';
import { pramaan, callCapability, setPramaanClientForTests } from '../pramaan';
afterEach(() => vi.unstubAllEnvs());
it('explicit offline mode gives a demonstration reply and never executes an external action', async () => {
  setPramaanClientForTests(undefined);
  vi.stubEnv('PRAMAAN_FAKE','1');
  vi.stubEnv('PRAMAAN_API_KEY','dummy-not-a-real-key');
  const network=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('Network must not run'));
  try {
    const client=await pramaan();
    const reply=await client.call('llm.chat',{messages:[{role:'user',content:'Hello'}],maxTokens:256});
    expect(reply.text).toContain('local demonstration');
    await expect(callCapability('email.send',{from:'local@example.test',to:'test@example.test',subject:'Test',text:'Test'},{idempotencyKey:'offline-message-one'})).rejects.toMatchObject({ code: 'upstream_unavailable' });
    expect(network).not.toHaveBeenCalled();
  } finally {network.mockRestore();}
});
