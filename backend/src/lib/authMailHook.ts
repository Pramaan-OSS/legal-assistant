import { createHmac, timingSafeEqual } from 'node:crypto';
import { sendMail } from './mail';
import { z } from 'zod';
const payloadSchema = z.object({
 user: z.object({ email: z.string().email(), new_email: z.string().email().optional() }),
 email_data: z.object({ email_action_type: z.enum(['signup', 'recovery', 'magiclink', 'invite', 'email_change', 'reauthentication']), token_hash: z.string().min(20).max(256), token_hash_new: z.string().max(256).optional(), token: z.string().max(20).optional() }),
});
export function verifyAuthMailHook(body: Buffer, headers: { id?: string; timestamp?: string; signature?: string }): void {
 const configured = process.env.SEND_EMAIL_HOOK_SECRET;
 if (!configured || !headers.id || !headers.timestamp || !headers.signature || !/^\d+$/.test(headers.timestamp)) throw new Error('Mail hook authentication failed.');
 if (Math.abs(Date.now() / 1000 - Number(headers.timestamp)) > 300) throw new Error('Mail hook expired.');
 const secret = Buffer.from(configured.replace(/^v1,whsec_/, '').replace(/^whsec_/, ''), 'base64');
 if (secret.length < 32) throw new Error('Mail hook secret is invalid.');
 const signed = createHmac('sha256', secret).update(`${headers.id}.${headers.timestamp}.`).update(body).digest();
 const valid = headers.signature.split(' ').some(value => {
  const [version, mac] = value.split(','); if (version !== 'v1' || !mac) return false;
  const actual = Buffer.from(mac, 'base64'); return actual.length === signed.length && timingSafeEqual(actual, signed);
 });
 if (!valid) throw new Error('Mail hook authentication failed.');
}
export async function deliverAuthHookMail(body: Buffer): Promise<void> {
 const { user, email_data: email } = payloadSchema.parse(JSON.parse(body.toString()));
 const type = email.email_action_type;
 const recipients = type === 'email_change'
  ? [{ to: user.new_email, hash: email.token_hash }, ...(email.token_hash_new ? [{ to: user.email, hash: email.token_hash_new }] : [])]
  : [{ to: user.email, hash: email.token_hash }];
 for (const item of recipients) {
  if (!item.to) throw new Error('Confirmation recipient is missing.');
  const url = new URL('/auth/confirm', process.env.FRONTEND_URL ?? 'http://localhost:3000');
  url.searchParams.set('token_hash', item.hash); url.searchParams.set('type', type);
  url.searchParams.set('next', type === 'recovery' ? '/reset-password' : type === 'email_change' ? '/settings' : '/');
  await sendMail({ to: item.to, subject: 'Confirm your Legal Assistant request', text: type === 'reauthentication'
   ? `Your confirmation code is ${email.token}. If you did not request this, ignore this message.`
   : `Confirm your request using this one-time link:\n${url.href}\n\n${type === 'email_change' && email.token_hash_new ? 'Confirm the links in both mailboxes to finish changing your address.\n' : ''}If you did not request this, ignore this message.`, eventId: `auth-hook:${type}:${item.hash}` });
 }
}
