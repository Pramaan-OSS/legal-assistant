import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { sendMail } from '../mail';
import { setPramaanClientForTests } from '../pramaan';
const call = vi.fn();
const message = { to: 'reader@example.test', subject: 'Test notification', text: 'A test message.', eventId: 'test-event' };
beforeEach(() => {
 vi.stubEnv('LOCAL_MAILBOX_ENABLED', '0'); vi.stubEnv('MAIL_FROM', ''); vi.stubEnv('SUPPORT_EMAIL', 'owner@example.test');
 call.mockReset().mockImplementation(async (_id, input) => {
  if (!input.from.endsWith('@updates.pramaan.one>')) throw Object.assign(new Error('Connect an account for this capability first.'), { code: 'invalid_request' });
  return { status: 'sent' };
 });
 setPramaanClientForTests({ call });
});
afterEach(() => { setPramaanClientForTests(); vi.unstubAllEnvs(); });
it('uses the exact platform sender domain and owner reply address without extra configuration', async () => {
 await sendMail(message);
 expect(call).toHaveBeenCalledWith('email.send', expect.objectContaining({ from: 'Legal Assistant <noreply@updates.pramaan.one>', replyTo: 'owner@example.test' }), { idempotencyKey: expect.stringMatching(/^[a-f0-9]{64}$/) });
});
it('preserves a caller reply address and stable delivery key', async () => {
 await sendMail({ ...message, replyTo: 'requester@example.test' }); await sendMail({ ...message, replyTo: 'requester@example.test' });
 expect(call.mock.calls[0][1].replyTo).toBe('requester@example.test'); expect(call.mock.calls[0][2]).toEqual(call.mock.calls[1][2]);
});
it('rejects a configured different domain when no sending account is connected', async () => {
 vi.stubEnv('MAIL_FROM', 'Legal Assistant <noreply@sub.updates.pramaan.one>');
 await expect(sendMail(message)).rejects.toMatchObject({ code: 'invalid_request' }); expect(call).toHaveBeenCalledTimes(1);
});
