import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PramaanClient } from '../pramaan';
import { setPramaanClientForTests } from '../pramaan';
import { streamWithProvider, completeWithProvider } from '../llm/providers';
import { verifyCaseLawCitations, getCaseLawCaseOpinions } from '../caseLaw';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';

let directory: string;
const call = vi.fn();
beforeEach(async () => {
  directory = await mkdtemp(path.resolve('.law-test-'));
  process.env.LEGAL_HANDLE_ROOT = directory;
  call.mockReset();
  setPramaanClientForTests({ call } as PramaanClient);
});
afterEach(async () => {
  setPramaanClientForTests();
  delete process.env.LEGAL_HANDLE_ROOT;
  await rm(directory, { recursive: true, force: true });
});
describe('Pramaan application adapters', () => {
  it('executes tools in the application and carries exactly matching results to the next turn', async () => {
    call.mockResolvedValueOnce({ text: '', toolCalls: [{ id: 'call-1', name: 'read_document', arguments: { document: 'owned' } }], finishReason: 'tool_calls' });
    call.mockResolvedValueOnce({ text: 'Reviewed.', toolCalls: [], finishReason: 'stop' });
    const runTools = vi.fn(async () => [{ tool_use_id: 'call-1', content: 'The document text.' }]);
    const result = await streamWithProvider({ model: 'balanced', systemPrompt: 'Review the document.', messages: [{ role: 'user', content: 'Review it.' }], runTools });
    expect(result.fullText).toBe('Reviewed.');
    expect(runTools).toHaveBeenCalledOnce();
    expect(call.mock.calls[1][1].messages.at(-1)).toEqual({ role: 'tool', toolCallId: 'call-1', content: 'The document text.' });
    expect(call.mock.calls.map(c => c[0])).toEqual(['llm.chat', 'llm.chat']);
  });
  it('refuses a tool round when a result is missing', async () => {
    call.mockResolvedValue({ toolCalls: [{ id: 'c', name: 'read', arguments: {} }] });
    await expect(streamWithProvider({ model: 'balanced', systemPrompt: '', messages: [], runTools: async () => [] })).rejects.toThrow('exactly one result');
    expect(call).toHaveBeenCalledOnce();
  });
  it('does not dispatch after cancellation', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(completeWithProvider({ model: 'fast', user: 'test', abortSignal: controller.signal })).rejects.toThrow();
    expect(call).not.toHaveBeenCalled();
  });
  it('keeps ambiguous citation outcomes and opens the exact returned opinion handle', async () => {
    call.mockResolvedValueOnce({ results: [{ citation: '12 Example 34', normalizedCitations: [], status: 'ambiguous', cases: [{ caseName: 'Example', citations: ['12 Example 34'], ref: 'case-owned-ref' }] }] });
    const verified = await verifyCaseLawCitations({ citations: ['12 Example 34'] });
    expect(verified.results[0].status).toBe('ambiguous');
    const id = verified.results[0].clusters[0].clusterId!;
    call.mockResolvedValueOnce({ caseName: 'Example', citations: ['12 Example 34'], opinions: [{ ref: 'opinion-owned-ref' }] });
    call.mockResolvedValueOnce({ text: 'The published opinion.', truncated: false });
    const opinion = await getCaseLawCaseOpinions({ clusterId: id });
    expect(opinion.opinions[0].text).toBe('The published opinion.');
    expect(call.mock.calls[1]).toEqual(['law.case.get', { ref: 'case-owned-ref' }, undefined]);
    expect(call.mock.calls[2][0]).toBe('law.opinion.get');
    expect(call.mock.calls[2][1].ref).toBe('opinion-owned-ref');
  });
  it('marks only matched citations as successful', async () => {
    call.mockResolvedValue({ results: [ { citation: '12 Example 34', normalizedCitations: [], status: 'matched', cases: [] }, { citation: 'bad', normalizedCitations: [], status: 'invalid', cases: [] } ] });
    const result = await verifyCaseLawCitations({ citations: ['12 Example 34', 'bad'] });
    expect(result.results.map(r => r.status)).toEqual(['ok', 'invalid']);
  });
  it('does not fetch a case for an invented app handle', async () => {
    await expect(getCaseLawCaseOpinions({ clusterId: 123 })).rejects.toThrow('again');
    expect(call).not.toHaveBeenCalled();
  });
});
