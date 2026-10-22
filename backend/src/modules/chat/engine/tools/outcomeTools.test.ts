import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ConnectorApprovalItem } from '@legal-assistant/contracts';
import { setPramaanClientForTests, type PramaanClient } from '../../../../lib/pramaan';
import { planOutcomeToolCall, executeApprovedOutcome } from './outcomeTools';
import type { Db } from '../../../../lib/supabase';
import { runPublicResearch } from './publicResearchTools';

const sources = vi.hoisted(() => ({ version: vi.fn(), download: vi.fn(), access: vi.fn() }));
vi.mock('../../../../lib/documentVersions', () => ({ loadActiveVersion: sources.version }));
vi.mock('../../../../lib/storage', () => ({ downloadFile: sources.download }));
vi.mock('../../../../lib/access', () => ({ ensureDocAccess: sources.access }));
const get = vi.fn(), estimate = vi.fn(), run = vi.fn(), call = vi.fn();
const context = { db: {} as Db, userId: 'user-1', docStore: new Map() };
const steps = [{ id: 'read', label: 'Read the page', capability: 'web.read', status: 'will_run' }, { id: 'summarize', label: 'Summarize its text', capability: 'llm.complete', status: 'will_run' }];
beforeEach(() => {
  vi.resetAllMocks();
  get.mockResolvedValue({ id: 'page.summarize', available: true });
  estimate.mockResolvedValue({ outcome: 'page.summarize', ready: true, canRun: true, plan: 'plan-1', priceMaxMicro: 39000, steps });
  run.mockResolvedValue({ status: 'done', completeness: 'complete', result: { summary: 'Checked summary' }, evidence: { summary: { sources: ['read'] } }, missing: [] });
  setPramaanClientForTests({ call, outcomes: { get, estimate, run, list: vi.fn() } } as PramaanClient);
});
afterEach(() => { setPramaanClientForTests(); vi.useRealTimers(); });
async function approval() {
  const plan = await planOutcomeToolCall('summarize_public_page', { url: 'https://example.test/page' }, context);
  expect(plan.type).toBe('approval');
  if (plan.type !== 'approval') throw new Error('Missing approval');
  return { ...plan.item, id: 'approved-1' };
}

it('shows the estimate, input and expiry without running or leaking private bytes', async () => {
  const item = await approval();
  expect(item.arguments).toEqual({ url: 'https://example.test/page' });
  expect(item.estimate).toMatchObject({ maximum_cost_usd: '0.039000', steps: ['Read the page', 'Summarize its text'] });
  expect(estimate).toHaveBeenCalledWith('page.summarize', { url: 'https://example.test/page' }, {});
  expect(run).not.toHaveBeenCalled(); expect(call).not.toHaveBeenCalled();
});

it('runs the persisted input and plan after approval, preserving missing evidence', async () => {
  const item = await approval();
  const result = await executeApprovedOutcome(item, context);
  expect(run).toHaveBeenCalledWith('page.summarize', item.arguments, { plan: 'plan-1', idempotencyKey: 'outcome-approved-1' });
  expect(get).toHaveBeenCalledTimes(2);
  expect(result.event.status).toBe('ok');
  expect(JSON.parse(result.content)).toMatchObject({ verifiedLegalAuthority: false, completeness: 'complete', result: { summary: 'Checked summary' } });
});

it('retains the existing capability path when available is false', async () => {
  get.mockResolvedValue({ available: false });
  const result = await planOutcomeToolCall('summarize_public_page', { url: 'https://example.test/page' }, context);
  expect(result.type).toBe('result');
  expect(result).toMatchObject({ content: expect.stringContaining('capability_fallback') });
  expect(estimate).not.toHaveBeenCalled(); expect(run).not.toHaveBeenCalled();
  // The existing agent loop follows the returned read instruction, unchanged.
  call.mockResolvedValue({ text: 'Original source', url: 'https://example.test/page' });
  await runPublicResearch('read_public_source', { url: 'https://example.test/page' });
  expect(call).toHaveBeenCalledWith('web.read', { url: 'https://example.test/page' }, undefined);
});

it('uses the capability fallback for a 502 availability race between check and run', async () => {
  const item = await approval();
  run.mockRejectedValue({ code: 'upstream_unavailable', status: 502 });
  expect((await executeApprovedOutcome(item, context)).content).toContain('capability_fallback');
  expect(run).toHaveBeenCalledTimes(1);
});

it.each(['forbidden', 'conflict'])('asks for a fresh estimate after %s; never bypasses approval', async code => {
  const item = await approval(); run.mockRejectedValue({ code, effect: 'none' });
  const result = await executeApprovedOutcome(item, context);
  expect(result.content).toContain('fresh estimate'); expect(result.content).not.toContain('capability_fallback');
  expect(call).not.toHaveBeenCalled();
});

it('rejects changed input locally before any run', async () => {
  const item = await approval(); item.arguments.url = 'https://example.test/changed';
  expect((await executeApprovedOutcome(item, context)).content).toContain('input changed');
  expect(run).not.toHaveBeenCalled();
});

it('expires plans conservatively after 15 minutes', async () => {
  vi.useFakeTimers(); const item = await approval(); vi.advanceTimersByTime(15 * 60_000);
  expect((await executeApprovedOutcome(item, context)).content).toContain('expired'); expect(run).not.toHaveBeenCalled();
});

it('does not start a fallback after a partial or failed report that may have charged', async () => {
  const item = await approval(); run.mockResolvedValue({ status: 'failed', evidence: {}, missing: ['summary'], result: undefined });
  const result = await executeApprovedOutcome(item, context);
  expect(JSON.parse(result.content).status).toBe('failed'); expect(result.content).not.toContain('capability_fallback');
  expect(call).not.toHaveBeenCalled(); expect(run).toHaveBeenCalledTimes(1);
});

it('does not retry an uncertain transport failure', async () => {
  const item = await approval(); run.mockRejectedValue({ code: 'upstream_timeout' });
  expect((await executeApprovedOutcome(item, context)).content).toContain('uncertain'); expect(call).not.toHaveBeenCalled();
});

it('checks availability again after approval and skips execution if it changed', async () => {
  const item = await approval(); get.mockResolvedValue({ available: false });
  expect((await executeApprovedOutcome(item, context)).content).toContain('capability_fallback'); expect(run).not.toHaveBeenCalled();
});

it('uses the existing public claim feature with the fact.check recipe', async () => {
  const plan = await planOutcomeToolCall('check_public_claim', { claim: 'A public factual claim.' }, context);
  if (plan.type !== 'approval') throw new Error('Expected claim estimate');
  expect(estimate).toHaveBeenCalledWith('fact.check', { claim: 'A public factual claim.' }, {});
  await executeApprovedOutcome({ ...plan.item, id: 'claim-1' }, context);
  expect(run).toHaveBeenCalledWith('fact.check', { claim: 'A public factual claim.' }, { plan: 'plan-1', idempotencyKey: 'outcome-claim-1' });
});

it('keeps inline and unsupported document sources on the existing document path', async () => {
  const result = await planOutcomeToolCall('summarize_selected_document', { doc_id: 'D1' }, { ...context, docStore: new Map([['D1', { filename: 'inline.txt', file_type: 'txt', storage_path: '', inline_text: 'Private text' }]]) });
  expect(result).toMatchObject({ content: expect.stringContaining('capability_fallback') });
  expect(sources.download).not.toHaveBeenCalled(); expect(estimate).not.toHaveBeenCalled();
});

it('binds document version bytes server-side and rechecks access on approval', async () => {
  const chain = { select: vi.fn(), eq: vi.fn(), single: vi.fn(async () => ({ data: { id: 'doc-1', user_id: 'user-1' } })) };
  chain.select.mockReturnValue(chain); chain.eq.mockReturnValue(chain);
  const ctx = { ...context, db: { from: vi.fn(() => chain) } as unknown as Db, docStore: new Map([['D1', { filename: 'contract.pdf', file_type: 'pdf', storage_path: 'private/file.pdf' }]]), docIndex: { D1: { document_id: 'doc-1', filename: 'contract.pdf' } } };
  sources.version.mockResolvedValue({ id: 'version-1', file_type: 'pdf', size_bytes: 3, storage_path: 'private/file.pdf' });
  sources.access.mockResolvedValue({ ok: true }); sources.download.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
  const plan = await planOutcomeToolCall('summarize_selected_document', { doc_id: 'D1' }, ctx);
  if (plan.type !== 'approval') throw new Error('Expected document estimate');
  expect(estimate).toHaveBeenCalledWith('document.summarize', { content: 'AQID', extension: 'pdf' }, {});
  expect(JSON.stringify(plan.item)).not.toContain('AQID'); expect(JSON.stringify(plan.item)).not.toContain('private/file.pdf');
  sources.access.mockResolvedValue({ ok: false });
  await executeApprovedOutcome({ ...plan.item, id: 'approval-1' } as ConnectorApprovalItem, ctx);
  expect(run).not.toHaveBeenCalled();
});

it('compares two authorized version snapshots with identical estimate/run options', async () => {
  const chain = { select: vi.fn(), eq: vi.fn(), single: vi.fn(async () => ({ data: { user_id: 'user-1' } })) };
  chain.select.mockReturnValue(chain); chain.eq.mockReturnValue(chain);
  const ctx = { ...context, db: { from: vi.fn(() => chain) } as unknown as Db,
    docStore: new Map([['D1', { filename: 'before.pdf', file_type: 'pdf', storage_path: 'before.pdf' }], ['D2', { filename: 'after.pdf', file_type: 'pdf', storage_path: 'after.pdf' }]]),
    docIndex: { D1: { document_id: 'doc-1', filename: 'before.pdf' }, D2: { document_id: 'doc-2', filename: 'after.pdf' } },
  };
  sources.version.mockImplementation(async (id: string) => ({ id: `v-${id}`, file_type: 'pdf', size_bytes: 3, storage_path: `${id}.pdf` }));
  sources.access.mockResolvedValue({ ok: true }); sources.download.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
  const plan = await planOutcomeToolCall('compare_selected_documents', { a_doc_id: 'D1', b_doc_id: 'D2' }, ctx);
  if (plan.type !== 'approval') throw new Error('Expected comparison estimate');
  const input = { a: { content: 'AQID', extension: 'pdf' }, b: { content: 'AQID', extension: 'pdf' } };
  expect(estimate).toHaveBeenCalledWith('document.compare', input, { options: { ocr: true, maxChanges: 15 } });
  await executeApprovedOutcome({ ...plan.item, id: 'compare-1' }, ctx);
  expect(run).toHaveBeenCalledWith('document.compare', input, { plan: 'plan-1', idempotencyKey: 'outcome-compare-1', options: { ocr: true, maxChanges: 15 } });
  sources.download.mockResolvedValue(new Uint8Array([4, 5, 6]).buffer);
  expect((await executeApprovedOutcome({ ...plan.item, id: 'changed-file' }, ctx)).content).toContain('input changed');
  expect(run).toHaveBeenCalledTimes(1);
});

it('defers a busy outcome run instead of disabling the feature or starting a fallback', async () => {
 const item = await approval(); run.mockRejectedValue({ code: 'rate_limited', status: 429, effect: 'none' });
 const result = await executeApprovedOutcome(item, context);
 expect(JSON.parse(result.content).status).toBe('try_later'); expect(result.event.error).toBeUndefined();
 expect(call).not.toHaveBeenCalled(); expect(run).toHaveBeenCalledTimes(1);
});
it('defers a busy estimate without executing a recipe or its capability fallback', async () => {
 estimate.mockRejectedValue({ code: 'rate_limited', status: 429 });
 const plan = await planOutcomeToolCall('summarize_public_page', { url: 'https://example.test/page' }, context);
 expect(plan).toMatchObject({ type: 'result', content: expect.stringContaining('try_later') });
 expect(run).not.toHaveBeenCalled(); expect(call).not.toHaveBeenCalled();
});

it('shows check-before-retry for unknown steps and never starts a fallback', async () => {
 const item=await approval(); run.mockResolvedValue({status:'failed',result:{summary:'Partial'},steps:[{id:'external',effect:'unknown',errors:[{effect:'unknown'}]}],evidence:{},missing:[]});
 const result=await executeApprovedOutcome(item,context);
 expect(JSON.parse(result.content).retryAdvice).toContain('Check the service before retrying');
 expect(result.event.error).toContain('uncertain'); expect(run).toHaveBeenCalledTimes(1); expect(call).not.toHaveBeenCalled();
});
it('passes Stop to the running outcome and keeps cancellation distinct from fallback', async () => {
 const item=await approval(); const controller=new AbortController(); run.mockImplementation(async (_id,_input,options)=> {expect(options.signal).toBe(controller.signal); controller.abort(); throw new Error('Stopped');});
 const result=await executeApprovedOutcome(item,{...context,signal:controller.signal});
 expect(result.content).toContain('Cancellation requested'); expect(result.content).not.toContain('capability_fallback'); expect(run).toHaveBeenCalledTimes(1);
});

it('never starts capability fallback for a 502 whose effect is explicitly unknown', async () => {
 const item=await approval(); run.mockRejectedValue({code:'upstream_unavailable',status:502,effect:'unknown'});
 const result=await executeApprovedOutcome(item,context);
 expect(result.content).toContain('uncertain'); expect(result.content).not.toContain('capability_fallback');
 expect(result.event.error).toContain('Check before retrying'); expect(run).toHaveBeenCalledTimes(1); expect(call).not.toHaveBeenCalled();
});

it.each([undefined,0,19000])('passes optional typical price %s to approval without running', async(priceTypicalMicro)=>{
 estimate.mockResolvedValue({ready:true,canRun:true,plan:'p',priceMaxMicro:39000,priceTypicalMicro,steps});
 const item=await approval();expect(item.estimate?.maximum_cost_usd).toBe('0.039000');expect(item.estimate?.typical_cost_usd).toBe(priceTypicalMicro===undefined?undefined:(priceTypicalMicro/1_000_000).toFixed(6));expect(run).not.toHaveBeenCalled();
});
