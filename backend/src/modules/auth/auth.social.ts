import { redeemEnterpriseSignIn } from '../../lib/enterpriseSignIn';
import { createHash, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
type CookieOptions = { httpOnly: boolean; secure: boolean; sameSite: 'lax'; path: string; maxAge?: number };
type SocialResponse = { cookie(name: string, value: string, options: CookieOptions): unknown; clearCookie(name: string, options: CookieOptions): unknown };
type SocialRequest = { get(name: string): string | undefined; body?: { state?: unknown; enterprise?: unknown } };
import type { SupabaseClient } from '@supabase/supabase-js';
import { callCapability } from '../../lib/pramaan';
import { createServerSupabase } from '../../lib/supabase';
const COOKIE = 'legal-assistant-social';
const signingKey = () => process.env.AUTH_HANDOFF_ENCRYPTION_SECRET ?? process.env.DOWNLOAD_SIGNING_SECRET;
type Flow = { state: string; nonce: string; verifier: string; redirectUri: string; expires: number };
function seal(flow: Flow): string {
  const secret = signingKey(); if (!secret) throw new Error('Sign-in handoff is not configured.');
  const body = Buffer.from(JSON.stringify(flow)).toString('base64url');
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}
function unseal(value: string): Flow {
  const secret = signingKey(); if (!secret) throw new Error('Sign-in handoff is not configured.');
  const [body, mac] = value.split('.');
  const expected = createHmac('sha256', secret).update(body ?? '').digest();
  const actual = Buffer.from(mac ?? '', 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('Start sign-in again.');
  const flow = JSON.parse(Buffer.from(body, 'base64url').toString()) as Flow;
  if (flow.expires < Date.now()) throw new Error('Start sign-in again.');
  return flow;
}
export function startSocialSignIn(res: SocialResponse, redirectUri: string): string {
  const configured = process.env.SOCIAL_SIGN_IN_URL;
  if (!configured || !process.env.SOCIAL_PROVIDER_KEY?.trim()) throw new Error('Connected sign-in is not set up yet. Set SOCIAL_SIGN_IN_URL and SOCIAL_PROVIDER_KEY. Use email and password.');
  const url = new URL(configured);
  if (url.protocol !== 'https:') throw new Error('Connected sign-in requires a secure authorization page.');
  const flow = { state: randomBytes(24).toString('base64url'), nonce: randomBytes(24).toString('base64url'), verifier: randomBytes(32).toString('base64url'), redirectUri, expires: Date.now() + 10 * 60_000 };
  res.cookie(COOKIE, seal(flow), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 10 * 60_000 });
  url.searchParams.set('redirect_uri', redirectUri); url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', flow.state); url.searchParams.set('nonce', flow.nonce);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('code_challenge', createHash('sha256').update(flow.verifier).digest('base64url'));
  return url.href;
}
export async function exchangeSocialSignIn(req: SocialRequest, res: SocialResponse, client: SupabaseClient, code: string) {
  const cookies = (req.get('cookie') ?? '').split(';').map(c => c.trim());
  const enterprise = cookies.find(c => c.startsWith('legal-assistant-enterprise='))?.slice('legal-assistant-enterprise='.length);
  if (enterprise && req.body?.enterprise) {
    res.clearCookie('legal-assistant-enterprise', { path:'/',httpOnly:true,secure:true,sameSite:'lax' });
    const current = await client.auth.getUser();
    const token = await redeemEnterpriseSignIn(createServerSupabase(),decodeURIComponent(enterprise),req.body?.state,code,current.data.user?.id);
    return client.auth.verifyOtp({type:'magiclink',token_hash:token});
  }
  if (req.body?.enterprise) throw new Error('Start organization sign-in again.');
  const value = cookies.find(c => c.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
  if (!value) return client.auth.exchangeCodeForSession(code); // Own email-confirmation flow only.
  const flow = unseal(decodeURIComponent(value));
  if (req.body?.state !== flow.state) throw new Error('Start sign-in again.');
  res.clearCookie(COOKIE, { path: '/', sameSite: 'lax', secure: process.env.NODE_ENV === 'production', httpOnly: true });
  const identity = await callCapability('auth.social.exchange', { providerKey: process.env.SOCIAL_PROVIDER_KEY ?? 'google', code, redirectUri: flow.redirectUri, pkceVerifier: flow.verifier, expectedNonce: flow.nonce }, { idempotencyKey: `social:${createHash("sha256").update(code).digest("hex")}` });
  if (!identity.email || !identity.emailVerified) throw new Error('A verified email is required for connected sign-in.');
  // Mint a local session only after Pramaan verifies signed identity evidence.
  const admin = createServerSupabase();
  const generated = await admin.auth.admin.generateLink({ type: 'magiclink', email: identity.email });
  if (generated.error || !generated.data.properties?.hashed_token) throw new Error('The local sign-in session could not be created.');
  if (generated.data.user) {
    const updated = await admin.auth.admin.updateUserById(generated.data.user.id, { app_metadata: { ...generated.data.user.app_metadata, connected_sign_in: true } });
    if (updated.error) throw new Error('The local sign-in session could not be prepared.');
  }
  return client.auth.verifyOtp({ type: 'magiclink', token_hash: generated.data.properties.hashed_token });
}
