import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { verifyAuthMailHook, deliverAuthHookMail } from '../authMailHook';
import { setPramaanClientForTests, type PramaanClient } from '../pramaan';
const secret = Buffer.alloc(32, 7); const call = vi.fn();
beforeEach(() => { vi.stubEnv('SEND_EMAIL_HOOK_SECRET', 'v1,whsec_' + secret.toString('base64')); vi.stubEnv('FRONTEND_URL', 'http://localhost:3000'); call.mockReset().mockResolvedValue({}); setPramaanClientForTests({ call } as PramaanClient); });
afterEach(() => { setPramaanClientForTests(); vi.unstubAllEnvs(); });
function headers(body: Buffer, timestamp = String(Math.floor(Date.now() / 1000))) {
 const id = 'event-one'; return { id, timestamp, signature: 'v1,' + createHmac('sha256', secret).update(`${id}.${timestamp}.`).update(body).digest('base64') };
}
it('checks the signed raw body and rejects changed bytes or old requests', () => {
 const body = Buffer.from('{"test":true}'); expect(() => verifyAuthMailHook(body, headers(body))).not.toThrow();
 expect(() => verifyAuthMailHook(Buffer.from('{"test":false}'), headers(body))).toThrow('authentication');
 expect(() => verifyAuthMailHook(body, headers(body, '1'))).toThrow('expired');
});
it('sends each email-change proof to the correct mailbox through email.send', async () => {
 const currentHash = 'current-proof-hash-1234567890'; const newHash = 'new-proof-hash-1234567890';
 const payload = Buffer.from(JSON.stringify({ user: { email: 'old@example.test', new_email: 'new@example.test' }, email_data: { email_action_type: 'email_change', token_hash: newHash, token_hash_new: currentHash } }));
 await deliverAuthHookMail(payload);
 expect(call.mock.calls.map(c => c[0])).toEqual(['email.send','email.send']);
 const current = call.mock.calls.find(c => c[1].to === 'old@example.test'); const next = call.mock.calls.find(c => c[1].to === 'new@example.test');
 expect(current?.[1].text).toContain(currentHash); expect(next?.[1].text).toContain(newHash);
 expect(current?.[1].text).toContain('http://localhost:3000/auth/confirm');
});
it('reuses each delivery key when the auth server retries the same event', async () => {
 const body = Buffer.from(JSON.stringify({ user: { email: 'person@example.test' }, email_data: { email_action_type: 'recovery', token_hash: 'recovery-proof-hash-1234567890' } }));
 await deliverAuthHookMail(body); await deliverAuthHookMail(body);
 expect(call.mock.calls[0][2]).toEqual(call.mock.calls[1][2]);
});
