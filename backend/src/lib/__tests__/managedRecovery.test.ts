import {afterEach,expect,it,vi} from 'vitest';
import {configureManagedRecovery,setPramaanClientForTests} from '../pramaan';
import {localPramaanClient} from '../pramaan.local';
const input={host:'smtp.example.com',port:587,username:'offline-user',password:'offline-password',senderEmail:'accounts@example.com',senderName:'Legal Assistant'};
afterEach(()=>{vi.unstubAllEnvs();});
it.each(['success','refused','unavailable'])('fake recovery transport handles %s',async mode=>{
 vi.stubEnv('PRAMAAN_FAKE_AUTH','1');vi.stubEnv('PRAMAAN_FAKE_RECOVERY',mode);setPramaanClientForTests(localPramaanClient());
 if(mode==='success')expect(await configureManagedRecovery(input,'approved-sender')).toEqual({recovery:{enabled:true,senderDomain:'example.com'}});
 else await expect(configureManagedRecovery(input,'approved-sender')).rejects.toHaveProperty('code',mode==='refused'?'invalid_request':'not_found');
});
