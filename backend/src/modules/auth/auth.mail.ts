import { createServerSupabase } from '../../lib/supabase';
import { sendMail } from '../../lib/mail';
export async function deliverAuthLink(type: 'signup' | 'recovery', email: string, redirectTo: string, password?: string) {
  const generated = await createServerSupabase().auth.admin.generateLink(type === 'signup'
    ? { type, email, password: password!, options: { redirectTo } }
    : { type, email, options: { redirectTo } });
  if (generated.error || !generated.data.properties) return generated;
  const { hashed_token } = generated.data.properties;
  const url = new URL('/auth/confirm', new URL(redirectTo).origin);
  url.searchParams.set('token_hash', hashed_token); url.searchParams.set('type', type);
  const callback = new URL(redirectTo);
  url.searchParams.set('next', type === 'recovery' ? '/reset-password' : callback.searchParams.get('next') ?? '/onboarding/profile');
  await sendMail({ to: email, subject: type === 'signup' ? 'Confirm your Legal Assistant account' : 'Reset your Legal Assistant password',
    text: `Open this one-time link to ${type === 'signup' ? 'confirm your email' : 'reset your password'}:\n${url.href}\n\nIf you did not request this, ignore this message.`, eventId: `auth:${type}:${hashed_token}` });
  return generated;
}
