import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { callCapability, streamChatCapability, checkedFakePramaanClient, setPramaanClientForTests, CAPABILITY_NOT_AVAILABLE_MESSAGE, type PramaanClient } from '../pramaan';
import { completeWithProvider } from '../llm/providers';
import { verifyCaseLawCitations, searchCaseLawCaseLaw, getCaseLawCaseOpinions } from '../caseLaw';
import { rememberLawHandle } from '../lawHandles';
import { runToolCalls } from '../../modules/chat/engine/tools/toolDispatcher';
import { CASE_LAW_TOOL_NAMES } from '../../modules/chat/engine/tools/caseLawTools';
import { sanitizeAssistantSseChunk } from '../../modules/chat/engine/streaming';
import { chatTurnAuditEvents } from '../audit';
const call = vi.fn(); let root: string;
const refusal = () => Object.assign(new Error('Synthetic internal upstream detail and stack must stay private.'), { code: 'upstream_unavailable' });
beforeEach(async () => { root = await mkdtemp(path.resolve('../.data/verification/law-unavailable-')); vi.stubEnv('LEGAL_HANDLE_ROOT', root); call.mockReset(); setPramaanClientForTests({ call } as PramaanClient); });
afterEach(async () => { setPramaanClientForTests(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });
it('uses messages and clamps tiny reply limits in the adapter and direct client', async () => {
 call.mockResolvedValue({ text: 'Ready.' });
 await completeWithProvider({ model: 'fast', user: 'Check.', maxTokens: 8 });
 expect(call.mock.calls[0][1]).toMatchObject({ messages: [{ role: 'user', content: 'Check.' }], maxTokens: 64 });
 expect(call.mock.calls[0][1]).not.toHaveProperty('prompt');
 await callCapability('llm.complete', { messages: [{ role: 'user', content: 'Check.' }], maxTokens: 1 });
 expect(call.mock.calls[1][1].maxTokens).toBe(64);
 const stream = vi.fn(async function* (_id: unknown, _input: unknown) { yield { type: 'done', result: { text: 'Ready.', toolCalls: [], finishReason: 'stop' } }; });
 setPramaanClientForTests({ call, stream } as unknown as PramaanClient);
 await streamChatCapability({ messages: [{ role: 'user', content: 'Check.' }], maxTokens: 8 }, vi.fn());
 expect(stream.mock.calls[0][1]).toMatchObject({ maxTokens: 64 });
 const fake = checkedFakePramaanClient({ call } as PramaanClient);
 expect(() => fake.call('llm.chat', { messages: [], maxTokens: 8 })).toThrow('at least 64');
});
it.each(['law.citations.lookup', 'law.cases.search', 'law.case.get', 'law.opinion.get'] as const)('keeps a refused %s failed with a safe not-yet message', async id => {
 call.mockRejectedValue(refusal());
 await expect(callCapability(id, {} as never)).rejects.toMatchObject({ code: 'upstream_unavailable', message: CAPABILITY_NOT_AVAILABLE_MESSAGE });
 expect(call).toHaveBeenCalledOnce();
});
it('never turns refused citation checks or searches into empty successful results', async () => {
 call.mockRejectedValue(refusal());
 await expect(verifyCaseLawCitations({ citations: ['12 Example 34'] })).rejects.toThrow('not available yet');
 await expect(searchCaseLawCaseLaw({ query: 'contract' })).rejects.toThrow('not available yet');
});
it('does not pretend a fetched case succeeded when reading its opinion is unavailable', async () => {
 const clusterId = await rememberLawHandle('case-synthetic');
 call.mockImplementation(async id => { if (id === 'law.case.get') return { caseName: 'Synthetic case', citations: [], opinions: [{ ref: 'opinion-synthetic' }] }; throw refusal(); });
 await expect(getCaseLawCaseOpinions({ clusterId })).rejects.toThrow('not available yet');
 expect(call.mock.calls.map(c => c[0])).toEqual(['law.case.get', 'law.opinion.get']);
});
it.each([CASE_LAW_TOOL_NAMES.verifyCitations, CASE_LAW_TOOL_NAMES.searchCaseLaw, CASE_LAW_TOOL_NAMES.getCases])('keeps %s errors safe through dispatch, stream, persistence and history', async name => {
 const clusterId = await rememberLawHandle('case-synthetic');
 call.mockRejectedValue(refusal()); const frames: string[] = [];
 const result = await runToolCalls([{ id: 'call-one', function: { name, arguments: JSON.stringify({ citations: ['12 Example 34'], query: 'contract', clusterIds: [clusterId] }) } }], new Map(), 'synthetic', {} as never, chunk => frames.push(chunk));
 expect(result.caseLawEvents).toHaveLength(1);
 expect(result.caseLawEvents[0].error).toBe(CAPABILITY_NOT_AVAILABLE_MESSAGE);
 expect(JSON.stringify(result)).not.toContain('Synthetic internal');
 expect(JSON.stringify(result.toolResults)).toContain('not available yet');
 expect(frames.map(sanitizeAssistantSseChunk).join('')).toContain(CAPABILITY_NOT_AVAILABLE_MESSAGE);
 const row = chatTurnAuditEvents({ userId: 'synthetic', chatId: 'chat' }, result.caseLawEvents)[0];
 expect(row.status).toBe('failed'); expect(row.detail?.reason).toBe(CAPABILITY_NOT_AVAILABLE_MESSAGE);
 expect(call).toHaveBeenCalledOnce();
});
it('retains generic filtering for arbitrary upstream details', () => {
 const frame = sanitizeAssistantSseChunk('data: '+JSON.stringify({ type: 'case_law_verify_citations', citation_count: 1, match_count: 0, error: 'Synthetic internal stack detail.' })+'\n\n');
 expect(frame).not.toContain('Synthetic internal'); expect(frame).not.toContain('not available yet');
});
