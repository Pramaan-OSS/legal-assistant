import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setPramaanClientForTests, type PramaanClient } from '../../../lib/pramaan';
const { generateLink, updateUserById, redeem } = vi.hoisted(() => ({ generateLink: vi.fn(), updateUserById: vi.fn(), redeem: vi.fn() }));
vi.mock('../../../lib/supabase', () => ({ createServerSupabase: () => ({ auth: { admin: { generateLink, updateUserById } } }) }));
vi.mock('../../../lib/enterpriseSignIn',()=>({redeemEnterpriseSignIn:redeem}));
import { startSocialSignIn, exchangeSocialSignIn } from '../auth.social';
import { sendMail } from '../../../lib/mail';
const call = vi.fn();
beforeEach(() => {
 vi.stubEnv('SOCIAL_PROVIDER_KEY', 'test-social'); vi.stubEnv('SOCIAL_SIGN_IN_URL', 'https://authorization.example.test/authorize'); vi.stubEnv('DOWNLOAD_SIGNING_SECRET', 'test-only-signing-key');
 call.mockReset(); generateLink.mockReset().mockResolvedValue({ data: { user: { id: 'local-user', app_metadata: { provider: 'email' } }, properties: { hashed_token: 'local-otp' } } }); updateUserById.mockReset().mockResolvedValue({ error: null });
 setPramaanClientForTests({ call } as PramaanClient);
});
afterEach(() => { setPramaanClientForTests(); vi.unstubAllEnvs(); });
function flow() {
 const cookie = vi.fn(); const clearCookie = vi.fn();
 const url = new URL(startSocialSignIn({ cookie, clearCookie }, 'http://localhost:3000/auth/callback'));
 const req = { get: () => `${cookie.mock.calls[0][0]}=${cookie.mock.calls[0][1]}`, body: { state: url.searchParams.get('state') } };
 return { req, res: { cookie, clearCookie }, url };
}
it('checks state before exchanging any authorization code', async () => {
 const { req, res } = flow(); req.body.state = 'wrong-state';
 await expect(exchangeSocialSignIn(req, res, {} as never, 'code')).rejects.toThrow('Start sign-in again');
 expect(call).not.toHaveBeenCalled(); expect(generateLink).not.toHaveBeenCalled();
});
it('never creates a local session for an unverified address', async () => {
 const { req, res } = flow(); call.mockResolvedValue({ email: 'person@example.test', emailVerified: false });
 await expect(exchangeSocialSignIn(req, res, {} as never, 'code')).rejects.toThrow('verified email');
 expect(generateLink).not.toHaveBeenCalled();
});
it('exchanges proof with Pramaan and then verifies a local one-time session', async () => {
 const { req, res, url } = flow(); const verifyOtp = vi.fn().mockResolvedValue({ data: { user: { id: 'local-user' } } });
 call.mockResolvedValue({ email: 'person@example.test', emailVerified: true });
 await exchangeSocialSignIn(req, res, { auth: { verifyOtp } } as never, 'code');
 expect(call.mock.calls[0][0]).toBe('auth.social.exchange');
 expect(call.mock.calls[0][1]).toMatchObject({ expectedNonce: url.searchParams.get('nonce'), code: 'code' });
 expect(verifyOtp).toHaveBeenCalledWith({ type: 'magiclink', token_hash: 'local-otp' });
 expect(res.clearCookie).toHaveBeenCalledOnce();
 expect(updateUserById).toHaveBeenCalledWith('local-user', { app_metadata: { provider: 'email', connected_sign_in: true } });
});
it('uses email.send with stable keys for the same delivery event', async () => {
 call.mockResolvedValue({ id: 'sent' });
 const message = { to: 'person@example.test', subject: 'Invitation', text: 'Test message', eventId: 'invite:one' };
 await sendMail(message); await sendMail(message);
 expect(call.mock.calls[0][0]).toBe('email.send');
 expect(call.mock.calls[0][2]).toEqual(call.mock.calls[1][2]);
});

it('redeems an enterprise callback with state and creates only the existing local session',async()=>{
 redeem.mockReset().mockResolvedValue('enterprise-local-proof');const verifyOtp=vi.fn().mockResolvedValue({data:{user:{id:'local-user'}}});const clearCookie=vi.fn();
 await exchangeSocialSignIn({get:()=> 'legal-assistant-enterprise=owned-ticket',body:{state:'same-state',enterprise:true}},{cookie:vi.fn(),clearCookie},{auth:{getUser:vi.fn().mockResolvedValue({data:{user:{id:'local-user'}}}),verifyOtp}} as never,'enterprise-code');
 expect(redeem.mock.calls[0].slice(1)).toEqual(['owned-ticket','same-state','enterprise-code','local-user']);expect(verifyOtp).toHaveBeenCalledWith({type:'magiclink',token_hash:'enterprise-local-proof'});expect(clearCookie.mock.calls[0][0]).toBe('legal-assistant-enterprise');
});
it('refuses an enterprise callback without its local started-flow cookie',async()=>{
 redeem.mockReset();await expect(exchangeSocialSignIn({get:()=>undefined,body:{enterprise:true,state:'unstarted-state'}},{cookie:vi.fn(),clearCookie:vi.fn()},{} as never,'enterprise-code')).rejects.toThrow('Start organization');expect(redeem).not.toHaveBeenCalled();expect(generateLink).not.toHaveBeenCalled();
});

it('keeps an unrelated local email callback separate from a pending enterprise cookie',async()=>{
 const exchangeCodeForSession=vi.fn().mockResolvedValue({data:{user:{id:'local-user'}}});redeem.mockReset();
 await exchangeSocialSignIn({get:()=> 'legal-assistant-enterprise=pending-ticket',body:{}},{cookie:vi.fn(),clearCookie:vi.fn()},{auth:{exchangeCodeForSession}} as never,'local-email-code');expect(exchangeCodeForSession).toHaveBeenCalledWith('local-email-code');expect(redeem).not.toHaveBeenCalled();
});
