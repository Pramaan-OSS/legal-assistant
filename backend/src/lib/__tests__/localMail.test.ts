import { afterEach, expect, it, vi } from 'vitest';
import { sendMail } from '../mail';
afterEach(() => {vi.unstubAllEnvs();vi.restoreAllMocks();});
it('delivers local account mail to the bundled mailbox without a remote account or API key', async () => {
 vi.stubEnv('LOCAL_MAILBOX_ENABLED','1');vi.stubEnv('SEND_EMAIL_VIA_PRAMAAN','false');vi.stubEnv('PRAMAAN_API_KEY','');
 const network=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('{}'));
 await expect(sendMail({to:'reader@example.test',subject:'Confirm account',text:'Private link',eventId:'local-test'})).resolves.toEqual({deliveredLocally:true});
 expect(network).toHaveBeenCalledWith('http://mailpit:8025/api/v1/send',expect.objectContaining({method:'POST'}));
});
it('a refused local message is an error rather than successful delivery', async () => {
 vi.stubEnv('LOCAL_MAILBOX_ENABLED','1');vi.stubEnv('SEND_EMAIL_VIA_PRAMAAN','false');
 vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('',{status:503}));
 await expect(sendMail({to:'reader@example.test',subject:'Confirm account',text:'Private link',eventId:'local-test'})).rejects.toThrow('local mailbox could not accept');
});
