import { afterEach, expect, it, vi } from 'vitest';
import { callCapability, callCapabilityAbortable, streamChatCapability, setPramaanClientForTests, IncompleteReplyError, ReplyLimitConfigurationError, type PramaanClient } from '../pramaan';
import { streamWithProvider, completeWithProvider } from '../llm/providers';
import { queryTabularCell, queryTabularAllColumns, generateChatTitle } from '../../modules/tabular/tabular.extract';
import { generateAssistantChatTitle } from '../../modules/chat/chat.title';
import { MEMORY_CURATOR_WRITE_TOOL } from '../../modules/memory/memory.curator';
const input = { messages: [{ role: 'user' as const, content: 'Review.' }] };
const partial = { text: '{"summary":"partial"}\n', finishReason: 'length', toolCalls: [{ id: 'tc_partial', name: 'write_memory_file', arguments: { markdown: 'partial', expectedRevision: 1, changeSummary: 'partial' } }], usage: { inputTokens: 10, outputTokens: 8192 } };
const params = { model: 'balanced', systemPrompt: 'Review.', messages: input.messages };
afterEach(() => setPramaanClientForTests());
it('shows a streamed cut-off free reply as incomplete and never repeats its charged call', async () => {
 const call = vi.fn(); const stream = vi.fn(async function* () { yield { type: 'text_delta', text: partial.text }; yield { type: 'done', result: partial }; });
 setPramaanClientForTests({ call, stream } as unknown as PramaanClient); const onText = vi.fn();
 await expect(streamChatCapability(input, onText)).rejects.toBeInstanceOf(IncompleteReplyError);
 expect(onText).toHaveBeenCalledExactlyOnceWith(partial.text); expect(call).not.toHaveBeenCalled(); expect(stream).toHaveBeenCalledOnce();
});
it('shows a whole-reply chat fallback as incomplete without another call', async () => {
 const call = vi.fn().mockResolvedValue(partial); setPramaanClientForTests({ call } as PramaanClient); const onText = vi.fn();
 await expect(streamChatCapability(input, onText)).rejects.toThrow('incomplete');
 expect(onText).toHaveBeenCalledExactlyOnceWith(partial.text); expect(call).toHaveBeenCalledOnce();
});
it('refuses partial structured chat output without showing or returning JSON', async () => {
 const stream = vi.fn(async function* () { yield { type: 'text_delta', text: partial.text }; yield { type: 'done', result: partial }; });
 setPramaanClientForTests({ call: vi.fn(), stream } as unknown as PramaanClient); const onText = vi.fn();
 await expect(streamChatCapability({ ...input, jsonSchema: { type: 'object', properties: { summary: { type: 'string' } } } }, onText)).rejects.toThrow('incomplete');
 expect(onText).not.toHaveBeenCalled();
});
it('never dispatches a cut-off action reply, including memory writes', async () => {
 const call = vi.fn().mockResolvedValue(partial), runTools = vi.fn(); setPramaanClientForTests({ call } as PramaanClient);
 await expect(streamWithProvider({ ...params, tools: [MEMORY_CURATOR_WRITE_TOOL], runTools })).rejects.toThrow('incomplete');
 expect(runTools).not.toHaveBeenCalled(); expect(call).toHaveBeenCalledOnce();
});
it('rejects cut-off plain and schema-guided completions at the single client', async () => {
 const call = vi.fn().mockResolvedValue(partial); setPramaanClientForTests({ call } as PramaanClient);
 await expect(completeWithProvider({ model: 'balanced', user: 'Review.' })).rejects.toThrow('incomplete');
 await expect(callCapability('llm.complete', { ...input, jsonSchema: { type: 'object', properties: {} } })).rejects.toThrow('incomplete');
 expect(call).toHaveBeenCalledTimes(2);
});
it('rejects cut-off async generation jobs rather than returning their result', async () => {
 const run = vi.fn().mockResolvedValue({ id: 'job-one', status: 'running' }), get = vi.fn().mockResolvedValue({ id: 'job-one', status: 'done', result: partial });
 setPramaanClientForTests({ call: vi.fn(), run, jobs: { get, cancel: vi.fn() } } as PramaanClient);
 await expect(callCapabilityAbortable('llm.complete', input, new AbortController().signal)).rejects.toThrow('incomplete');
 expect(run).toHaveBeenCalledOnce(); expect(get).toHaveBeenCalledOnce();
});
it('does not parse or deliver any partial tabular JSON lines', async () => {
 const stream = vi.fn(async function* () { yield { type: 'text_delta', text: '{"column_index":0,"summary":"partial","flag":"grey"}\n' }; yield { type: 'done', result: { ...partial, text: '{"column_index":0,"summary":"partial","flag":"grey"}\n' } }; });
 setPramaanClientForTests({ call: vi.fn(), stream } as unknown as PramaanClient); const onResult = vi.fn();
 await expect(queryTabularAllColumns('balanced', 'Synthetic.txt', 'Text.', [{ index: 0, name: 'Clause', prompt: 'Clause' }], onResult)).rejects.toThrow('incomplete');
 expect(onResult).not.toHaveBeenCalled(); expect(stream).toHaveBeenCalledOnce();
});
it('never returns partial single-cell extraction and never accepts a cut-off title', async () => {
 const call = vi.fn().mockResolvedValue(partial); setPramaanClientForTests({ call } as PramaanClient);
 await expect(queryTabularCell('balanced', 'Synthetic.txt', 'Text.', 'Clause')).rejects.toThrow('incomplete');
 await expect(generateAssistantChatTitle({ model: 'balanced', message: 'Review this contract.', apiKeys: {} })).rejects.toThrow('incomplete');
 expect(call.mock.calls[1][1].maxTokens).toBe(256);
 await expect(generateChatTitle('balanced', 'Review this contract.')).resolves.toBeNull();
 expect(call.mock.calls[2][1].maxTokens).toBe(256); expect(call).toHaveBeenCalledTimes(3);
});
it.each(['llm.chat', 'llm.complete'] as const)('treats empty %s maxTokens failures as configuration errors without retry', async id => {
 const call = vi.fn().mockRejectedValue(Object.assign(new Error('maxTokens was reached before any text. Private diagnostic.'), { code: 'invalid_request', status: 400, effect: 'none' }));
 setPramaanClientForTests({ call } as PramaanClient);
 await expect(callCapability(id, input)).rejects.toBeInstanceOf(ReplyLimitConfigurationError);
 expect(call).toHaveBeenCalledOnce();
});
it('does not invoke whole-reply fallback for an uncharged streamed maxTokens configuration error', async () => {
 const call = vi.fn(), stream = vi.fn(async function* () { throw Object.assign(new Error('maxTokens exhausted before output'), { code: 'invalid_request', status: 400, effect: 'none' }); yield { type: 'done', result: partial }; });
 setPramaanClientForTests({ call, stream } as unknown as PramaanClient);
 await expect(streamChatCapability(input, vi.fn())).rejects.toThrow('reply limit is too small'); expect(call).not.toHaveBeenCalled(); expect(stream).toHaveBeenCalledOnce();
});
it('handles the final HTTP 400 through the SDK without retry or leaking upstream details', async () => {
 const { Pramaan } = await import('@pramaan/sdk');
 const fetch = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'invalid_request', message: 'maxTokens exhausted. Private diagnostic.', effect: 'none' } }), { status: 400 }));
 setPramaanClientForTests(new Pramaan({ apiKey: 'fake-key', maxRetries: 0, fetch }) as unknown as PramaanClient);
 await expect(callCapability('llm.complete', { ...input, maxTokens: 256 })).rejects.toMatchObject({ message: expect.stringContaining('reply limit is too small') });
 expect(fetch).toHaveBeenCalledOnce();
});

it.each(['llm.chat', 'llm.complete'] as const)('handles a charged HTTP 200 %s cut-off through the SDK without repeating it', async id => {
 const { Pramaan } = await import('@pramaan/sdk');
 const fetch = vi.fn(async () => new Response(JSON.stringify({ ...partial, toolCalls: [] }), { headers: { 'Content-Type': 'application/json' } }));
 setPramaanClientForTests(new Pramaan({ apiKey: 'fake-key', maxRetries: 0, fetch }) as unknown as PramaanClient);
 await expect(callCapability(id, { ...input, maxTokens: 256 })).rejects.toBeInstanceOf(IncompleteReplyError);
 expect(fetch).toHaveBeenCalledOnce();
});
