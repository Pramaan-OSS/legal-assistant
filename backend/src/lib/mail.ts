import { createHash } from 'node:crypto';
import { callCapability } from './pramaan';
export async function sendMail(args: { to: string; subject: string; text: string; eventId: string; replyTo?: string }) {
  if (process.env.LOCAL_MAILBOX_ENABLED === '1' && process.env.SEND_EMAIL_VIA_PRAMAAN !== 'true') {
    const response = await fetch('http://mailpit:8025/api/v1/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ From: { Email: 'noreply@legal-assistant.local', Name: 'Legal Assistant' }, To: [{ Email: args.to }], Subject: args.subject, Text: args.text }),
    });
    if (!response.ok) throw new Error('The local mailbox could not accept the message. Try again.');
    return { deliveredLocally: true };
  }
  const from = process.env.MAIL_FROM?.trim() || 'Legal Assistant <noreply@updates.pramaan.one>';
  const replyTo = args.replyTo ?? (process.env.SUPPORT_EMAIL?.trim() || undefined);
  return callCapability('email.send', { from, to: args.to, subject: args.subject, text: args.text,
    replyTo, autoSubmitted: 'auto-generated' },
    { idempotencyKey: createHash('sha256').update(args.eventId).digest('hex') });
}
export async function sendInvitationMail(invitation: unknown) {
  const row = invitation as { id: string; email: string; expires_at: string };
  const url = new URL('/settings/organizations', process.env.FRONTEND_URL ?? 'http://localhost:3000');
  return sendMail({ to: row.email, subject: 'You have been invited to Legal Assistant',
    text: `Sign in using this email address to review your invitation:\n${url.href}\n\nExpires: ${row.expires_at}`,
    eventId: `invitation:${row.id}:${row.expires_at}` });
}
