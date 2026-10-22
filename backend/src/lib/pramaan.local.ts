import type { PramaanClient } from './pramaan';
/** Explicit offline demonstration; unsupported actions never contact a remote service. */
export function localPramaanClient(): PramaanClient {
  return {
    async call(id, input) {
      if (process.env.PRAMAAN_FAKE_AUTH === '1') {
        if(id==='auth.backend.provision')return {status:'ready',authUrl:'https://signin.example.test/api/auth',jwksUrl:'https://signin.example.test/keys'} as never;
        if(id==='auth.backend.domains.set')return {allowedDomains:[]} as never;
        if(id==='auth.user.delete')return {deleted:true} as never;
        if(id==='auth.token.verify') {
          const expected=`offline.${Buffer.from(JSON.stringify({sub:'offline-managed-reader',iss:'https://signin.example.test',aud:'https://signin.example.test'})).toString('base64url')}.offline`;
          return {valid:'token' in input && input.token===expected,...('token' in input && input.token===expected?{userId:'offline-managed-reader'}:{})} as never;
        }
      }
      if (id === 'llm.chat' || id === 'llm.complete') {
        return { text: 'This is a local demonstration reply. Your workspace is ready.', finishReason: 'stop', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 } } as never;
      }
      throw Object.assign(new Error('This service is not available yet.'), { code: 'upstream_unavailable', effect: 'none' });
    },
  };
}
