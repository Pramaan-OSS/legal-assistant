import { afterEach, expect, it, vi } from 'vitest';
import { checkedFakePramaanClient, callCapability, setPramaanClientForTests, type PramaanClient } from '../pramaan';
afterEach(()=>setPramaanClientForTests());
it('every catalogued external action refuses a missing or blank key before the fake transport runs',async()=>{
 const {CATALOG}=await import('@pramaan/sdk');const call=vi.fn();const fake=checkedFakePramaanClient({call});
 const actions=Object.values(CATALOG).filter(row=>row.effectClass.startsWith('external_'));
 expect(actions.length).toBeGreaterThan(10);
 for(const action of actions){
  await expect(fake.call(action.id as never,{} as never)).rejects.toMatchObject({code:'invalid_request',status:400,message:'Idempotency-Key header is required for this capability.'});
  await expect(fake.call(action.id as never,{} as never,{idempotencyKey:' '})).rejects.toMatchObject({code:'invalid_request'});
 }
 expect(call).not.toHaveBeenCalled();
});
it('the SDK sends the action key as the production HTTP header',async()=>{
 const {Pramaan}=await import('@pramaan/sdk');const fetch=vi.fn(async(_url:string,init:RequestInit)=>{
  expect(new Headers(init.headers).get('Idempotency-Key')).toBe('saved-installation-action');
  return new Response(JSON.stringify({status:'ready',authUrl:'https://signin.example.test',jwksUrl:'https://signin.example.test/keys'}),{status:200,headers:{'Content-Type':'application/json'}});
 });
 setPramaanClientForTests(new Pramaan({apiKey:'fake-key',maxRetries:0,fetch}) as unknown as PramaanClient);
 await callCapability('auth.backend.provision',{}, {idempotencyKey:'saved-installation-action'});expect(fetch).toHaveBeenCalledOnce();
});
it('a missing action key is reported plainly without returning transport diagnostics',async()=>{
 setPramaanClientForTests({call:vi.fn()});
 await expect(callCapability('auth.backend.provision',{})).rejects.toMatchObject({code:'invalid_request',message:'The request is missing its required action key. Check the server setup before trying again.'});
});

it('starting an asynchronous action also refuses a missing key before transport',async()=>{
 const run=vi.fn();const fake=checkedFakePramaanClient({call:vi.fn(),run});
 await expect(fake.run!('auth.backend.provision',{})).rejects.toMatchObject({code:'invalid_request',status:400});
 expect(run).not.toHaveBeenCalled();
});
