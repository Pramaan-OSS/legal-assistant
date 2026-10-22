import { Router } from 'express';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { asyncRoute, routerErrorHandler } from '../../middleware/asyncRoute';
import { sendMail } from '../../lib/mail';
export const supportRouter = Router();
const payload = z.object({ type: z.string().max(80), subject: z.string().trim().min(1).max(200), message: z.string().trim().min(1).max(20000), link: z.string().max(2000).optional(), email: z.string().optional() });
supportRouter.post('/', requireAuth, asyncRoute(async (req, res) => {
  const parsed = payload.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ detail: 'Provide a subject and message.' });
  const to = process.env.SUPPORT_EMAIL?.trim() || 'support@legal-assistant.local';
  const { subject, message, link, type } = parsed.data;
  const userId = res.locals.userId as string;
  const eventId = createHash('sha256').update(JSON.stringify({ userId, subject, message, link, type })).digest('hex');
  await sendMail({ to, subject: `Legal Assistant: ${subject}`, text: `${type}\n\n${message}\n${link ?? ''}`, replyTo: res.locals.userEmail, eventId: `support:${eventId}` });
  res.status(202).json({ accepted: true });
}));
supportRouter.use(routerErrorHandler('[support]'));
