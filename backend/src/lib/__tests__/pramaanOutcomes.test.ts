import { afterEach, expect, it, vi } from 'vitest';
import { estimateOutcome, getOutcome, listOutcomes, runOutcome, setPramaanClientForTests, type PramaanClient } from '../pramaan';

const report = { outcome: 'page.summarize', version: 1, plan: 'plan-1', status: 'done', completeness: 'complete', result: { summary: 'A checked page.' }, evidence: {}, missing: [], steps: [], cost: { hold_micro: 39000, charged_micro: 12000, capabilities: [] } };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
async function sdk(fetch: (url: string, init: RequestInit) => Promise<Response>) {
  const { createPramaan } = await import('../pramaan.compat.js');
  setPramaanClientForTests(await createPramaan({ apiKey: 'fake-key', baseUrl: 'http://fake.test', maxRetries: 0, fetch }) as unknown as PramaanClient);
}
afterEach(() => { setPramaanClientForTests(); vi.restoreAllMocks(); vi.useRealTimers(); });

it('lists and describes runtime availability through the single client', async () => {
  const summary = { id: 'page.summarize', available: false, mode: 'sync', effect_class: 'read_only' };
  const fetch = vi.fn(async (url: string) => json(url.endsWith('/outcomes') ? { results: [summary] } : { ...summary, steps: [], input_schema: { type: 'object' } }));
  await sdk(fetch);
  expect((await listOutcomes())[0]?.available).toBe(false);
  expect((await getOutcome('page.summarize')).available).toBe(false);
  expect(fetch.mock.calls.map(call => call[0])).toEqual(['http://fake.test/v1/outcomes', 'http://fake.test/v1/outcomes/page.summarize']);
});

it('estimates the exact input then sends its plan, without refused routing headers', async () => {
  const input = { url: 'https://example.test/page' };
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    expect(JSON.parse(String(init.body))).toEqual({ input });
    const headers = new Headers(init.headers);
    for (const key of ['Pramaan-Account', 'Pramaan-End-User', 'Pramaan-End-User-Group', 'Pramaan-Max-Price-Micro']) expect(headers.has(key)).toBe(false);
    if (url.endsWith('/estimate')) return json({ outcome: 'page.summarize', plan: 'plan-1', ready: true, can_run: true, price_max_micro: 39000, steps: [] });
    expect(headers.get('Pramaan-Plan')).toBe('plan-1');
    expect(headers.get('Idempotency-Key')).toBe('approved-1');
    return json(report);
  });
  await sdk(fetch);
  const forbidden = { account: 'a', endUser: 'u', endUserGroup: 'g', maxPriceMicro: 1 };
  const estimate = await estimateOutcome('page.summarize', input, forbidden as never);
  expect(estimate.priceMaxMicro).toBe(39000);
  expect((await runOutcome('page.summarize', input, { ...forbidden, plan: estimate.plan, idempotencyKey: 'approved-1' })).result).toEqual(report.result);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('waits for a 202 outcome job on the shared jobs route', async () => {
  vi.useFakeTimers();
  let polls = 0;
  const fetch = vi.fn(async (url: string) => url.endsWith('/page.summarize')
    ? json({ job_id: 'job-1', status: 'running' }, 202)
    : ++polls === 1 ? json({ job_id: 'job-1', status: 'running' }) : json({ job_id: 'job-1', status: 'done', result: report }));
  await sdk(fetch);
  const pending = runOutcome('page.summarize', { url: 'https://example.test' }, { plan: 'plan-1' });
  await vi.advanceTimersByTimeAsync(2000);
  expect((await pending).status).toBe('done');
  expect(fetch.mock.calls.map(call => call[0])).toEqual(['http://fake.test/v1/outcomes/page.summarize', 'http://fake.test/v1/jobs/job-1', 'http://fake.test/v1/jobs/job-1']);
});

it('returns a safe 403 when the plan header is missing', async () => {
  await sdk(async (_url, init) => {
    expect(new Headers(init.headers).has('Pramaan-Plan')).toBe(false);
    return json({ error: { code: 'forbidden', message: 'Private upstream details', reason: 'approval_required', effect: 'none' } }, 403);
  });
  await expect(runOutcome('page.summarize', { url: 'https://example.test' })).rejects.toMatchObject({ code: 'forbidden', status: 403, effectNone: true });
});

it('preserves a 409 changed-input refusal and never leaks the upstream error', async () => {
  await sdk(async (_url, init) => {
    expect(JSON.parse(String(init.body)).input.url).toBe('https://example.test/changed');
    expect(new Headers(init.headers).get('Pramaan-Plan')).toBe('original-plan');
    return json({ error: { code: 'conflict', message: 'Private provider detail', effect: 'none' } }, 409);
  });
  const result = runOutcome('page.summarize', { url: 'https://example.test/changed' }, { plan: 'original-plan' });
  await expect(result).rejects.toMatchObject({ code: 'conflict', status: 409 });
  await expect(result).rejects.not.toThrow('Private provider detail');
});

it('allows a capability-only fake to keep the original path', async () => {
  setPramaanClientForTests({ call: vi.fn() } as PramaanClient);
  await expect(getOutcome('page.summarize')).rejects.toMatchObject({ code: 'not_found', effectNone: true });
});

it('cancels an outcome job on Stop, keeps completed steps and sends no second run', async () => {
 vi.useFakeTimers(); const controller=new AbortController(); let started=false;
 const partial={...report,status:'failed',completeness:'partial',steps:[{id:'send',effect:'unknown',status:'failed',errors:[{code:'upstream_timeout',effect:'unknown'}]}]};
 const fetch=vi.fn(async (url:string,init:RequestInit)=>{
  if(url.endsWith('/page.summarize')) {started=true; return json({job_id:'job-stop',status:'running'},202);}
  if(url.endsWith('/cancel')) {expect(init.method).toBe('POST'); return json({job_id:'job-stop',status:'cancelled',result:partial});}
  return json({job_id:'job-stop',status:'running'});
 });
 await sdk(fetch); const pending=runOutcome('page.summarize',{url:'https://example.test'},{plan:'plan-1',idempotencyKey:'one-run',signal:controller.signal});
 await vi.advanceTimersByTimeAsync(0); expect(started).toBe(true); controller.abort();
 const result=await pending; expect(result.steps[0]?.effect).toBe('unknown'); expect(result.completeness).toBe('partial');
 expect(fetch.mock.calls.filter(c=>c[0].endsWith('/page.summarize'))).toHaveLength(1);
 expect(fetch.mock.calls.filter(c=>c[0].endsWith('/cancel'))).toHaveLength(1);
});
it('waits through the 35-minute deadline and preserves the failed run report without replay', async () => {
 vi.useFakeTimers(); const began=Date.now();
 const partial={...report,status:'failed',completeness:'partial',steps:[{id:'external',effect:'unknown',status:'failed'}],error:{step:'external',code:'upstream_timeout',effect:'unknown'}};
 const fetch=vi.fn(async (url:string)=>url.endsWith('/page.summarize')?json({job_id:'job-long',status:'running'},202):Date.now()-began>=35*60_000?json({job_id:'job-long',status:'failed',error:{code:'upstream_timeout',effect:'unknown'},result:partial}):json({job_id:'job-long',status:'running'}));
 await sdk(fetch); const pending=runOutcome('page.summarize',{url:'https://example.test'},{plan:'plan-1'});
 await vi.advanceTimersByTimeAsync(35*60_000+30_000);
 expect((await pending).steps[0]?.effect).toBe('unknown');
 expect(fetch.mock.calls.filter(c=>c[0].endsWith('/page.summarize'))).toHaveLength(1);
});
it('returns a busy 429 without retrying the outcome start', async () => {
 const fetch=vi.fn(async()=>json({error:{code:'rate_limited',effect:'none'}},429)); await sdk(fetch);
 await expect(runOutcome('page.summarize',{url:'https://example.test'})).rejects.toMatchObject({status:429,code:'rate_limited'});
 expect(fetch).toHaveBeenCalledTimes(1);
});

it('preserves unknown effect on a refused-looking response without allowing a safe retry', async () => {
 const fetch=vi.fn(async()=>json({error:{code:'upstream_unavailable',effect:'unknown'}},502)); await sdk(fetch);
 await expect(runOutcome('page.summarize',{url:'https://example.test'})).rejects.toMatchObject({effectUnknown:true,effectNone:false,status:502});
 expect(fetch).toHaveBeenCalledTimes(1);
});
it.each([undefined,0,12000])('preserves typical estimate %s through fake SDK transport',async(priceTypicalMicro)=>{
 await sdk(async()=>json({price_max_micro:39000,...(priceTypicalMicro===undefined?{}:{price_typical_micro:priceTypicalMicro}),ready:true,can_run:true,steps:[]}));
 const estimate=await estimateOutcome('page.summarize',{});expect(estimate.priceMaxMicro).toBe(39000);expect(estimate.priceTypicalMicro).toBe(priceTypicalMicro);if(priceTypicalMicro===undefined)expect(estimate).not.toHaveProperty('priceTypicalMicro');
});
