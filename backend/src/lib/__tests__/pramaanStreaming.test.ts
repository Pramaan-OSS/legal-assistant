import { afterEach, expect, it, vi } from 'vitest';
import { setPramaanClientForTests, streamChatCapability, type PramaanClient } from '../pramaan';
import { streamWithProvider } from '../llm/providers';
const input = { messages: [{ role: 'user' as const, content: 'Hello' }] };
const answer = { text: 'Hello.', toolCalls: [], finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 2 } };
afterEach(() => { setPramaanClientForTests(); vi.useRealTimers(); });
const sdk = async (fetch: (input: string, init: RequestInit) => Promise<Response>) => {
 const { Pramaan } = await import('@pramaan/sdk');
 const client = new Pramaan({ apiKey: 'fake-key', fetch, maxRetries: 0 }) as unknown as PramaanClient;
 setPramaanClientForTests(client); return client;
};
const frames = (...events: Array<[string, unknown]>) => events.map(([type, data]) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`).join('');
it('requests SSE in the header, shows pieces before completion and uses the final result once', async () => {
 let finish!: () => void;
 const gate = new Promise<void>(resolve => { finish = resolve; });
 const fetch = vi.fn(async (_url: string, init: RequestInit) => {
  expect(new Headers(init.headers).get('Accept')).toBe('text/event-stream');
  expect(JSON.parse(String(init.body))).toEqual(input);
  return new Response(new ReadableStream({ async start(controller) {
   controller.enqueue(new TextEncoder().encode(': ping\n\n' + frames(['text_delta', { text: 'Hel' }])));
   await gate;
   controller.enqueue(new TextEncoder().encode(frames(['text_delta', { text: 'lo.' }], ['usage', { inputTokens: 1, outputTokens: 2 }], ['done', { result: answer, finishReason: 'stop', price_micro: 1 }])));
   controller.close();
  } }), { headers: { 'Content-Type': 'text/event-stream' } });
 });
 await sdk(fetch); const text = vi.fn(); const pending = streamChatCapability(input, text);
 await vi.waitFor(() => expect(text).toHaveBeenCalledWith('Hel'));
 expect(text).toHaveBeenCalledOnce(); finish();
 expect(await pending).toEqual(answer); expect(text.mock.calls.flat().join('')).toBe('Hello.'); expect(fetch).toHaveBeenCalledOnce();
});
it('accepts a whole JSON reply to the same request without generating again', async () => {
 const fetch = vi.fn(async () => new Response(JSON.stringify(answer), { headers: { 'Content-Type': 'application/json' } }));
 await sdk(fetch); const text = vi.fn(); expect(await streamChatCapability(input, text)).toEqual(answer);
 expect(text).toHaveBeenCalledExactlyOnceWith('Hello.'); expect(fetch).toHaveBeenCalledOnce();
});
it('falls back only after an explicitly uncharged refusal', async () => {
 const fetch = vi.fn(async (_url: string, init: RequestInit) => new Headers(init.headers).get('Accept') === 'text/event-stream'
  ? new Response(JSON.stringify({ error: { code: 'upstream_unavailable', effect: 'none', message: 'Refused' } }), { status: 503 })
  : new Response(JSON.stringify(answer), { headers: { 'Content-Type': 'application/json' } }));
 await sdk(fetch); const text = vi.fn(); expect(await streamChatCapability(input, text)).toEqual(answer);
 expect(fetch).toHaveBeenCalledTimes(2); expect(text).toHaveBeenCalledExactlyOnceWith('Hello.');
});
it('does not bill a second generation when a stream ends early', async () => {
 const fetch = vi.fn(async () => new Response(frames(['text_delta', { text: 'Hel' }], ['tool_call_start', { index: 0, id: 'tc_one', name: 'send' }], ['tool_call_delta', { index: 0, arguments: '{}' }]), { headers: { 'Content-Type': 'text/event-stream' } }));
 await sdk(fetch); const text = vi.fn(); await expect(streamChatCapability(input, text)).rejects.toThrow('incomplete');
 expect(text).toHaveBeenCalledExactlyOnceWith('Hel'); expect(fetch).toHaveBeenCalledOnce();
});
it('never treats a transport drop before an event as a free refusal', async () => {
 const fetch = vi.fn(async () => { throw new Error('Disconnected'); }); await sdk(fetch);
 await expect(streamChatCapability(input, vi.fn())).rejects.toThrow('incomplete'); expect(fetch).toHaveBeenCalledOnce();
});
it('does not replay a charged error event after pieces', async () => {
 const fetch = vi.fn(async () => new Response(frames(['text_delta', { text: 'Hel' }], ['error', { error: { code: 'upstream_unavailable', retryable: true }, price_micro: 4 }]), { headers: { 'Content-Type': 'text/event-stream' } }));
 await sdk(fetch); await expect(streamChatCapability(input, vi.fn())).rejects.toThrow('incomplete'); expect(fetch).toHaveBeenCalledOnce();
});
it('executes completed calls once and never executes partial arguments', async () => {
 vi.useFakeTimers(); vi.setSystemTime(new Date('2030-01-01'));
 const runTools = vi.fn(async () => [{ tool_use_id: 'tc_one', content: 'Sent once' }]);
 let round = 0;
 const stream = vi.fn(async function* () {
  if (round++ === 0) {
   yield { type: 'tool_call_start', index: 0, id: 'tc_one', name: 'send' };
   yield { type: 'tool_call_delta', index: 0, arguments: '{}' }; expect(runTools).not.toHaveBeenCalled();
   yield { type: 'done', result: { ...answer, text: '', toolCalls: [{ id: 'tc_one', name: 'send', arguments: {} }] } };
  } else { yield { type: 'text_delta', text: 'Hello.' }; yield { type: 'done', result: answer }; }
 });
 const call = vi.fn(); setPramaanClientForTests({ stream, call } as unknown as PramaanClient);
 expect(await streamWithProvider({ model: 'balanced', systemPrompt: 'Test', messages: [], runTools })).toEqual({ fullText: 'Hello.' });
 expect(runTools).toHaveBeenCalledOnce(); expect(stream).toHaveBeenCalledTimes(2); expect(call).not.toHaveBeenCalled();
});
it('stops on partial calls and uses whole replies for later requests without repeating the dropped turn', async () => {
 vi.useFakeTimers(); vi.setSystemTime(new Date('2040-01-01'));
 const stream = vi.fn(async function* () { yield { type: 'tool_call_start', index: 0, id: 'tc_one', name: 'send' }; });
 const call = vi.fn().mockResolvedValue(answer); const runTools = vi.fn(); setPramaanClientForTests({ stream, call } as unknown as PramaanClient);
 const params = { model: 'balanced', systemPrompt: 'Test', messages: [], runTools };
 await expect(streamWithProvider(params)).rejects.toThrow('incomplete');
 expect(call).not.toHaveBeenCalled(); expect(runTools).not.toHaveBeenCalled();
 expect(await streamWithProvider(params)).toEqual({ fullText: 'Hello.' }); expect(call).toHaveBeenCalledOnce(); expect(stream).toHaveBeenCalledOnce();
});
it('cancelled streams cannot fall back or run actions', async () => {
 const controller = new AbortController(); const stream = vi.fn(async function* () { controller.abort(); yield { type: 'text_delta', text: 'Hi' }; });
 const call = vi.fn(); setPramaanClientForTests({ stream, call } as unknown as PramaanClient);
 await expect(streamChatCapability(input, vi.fn(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' }); expect(call).not.toHaveBeenCalled();
});

it('does not repeat completed actions when the following answer stream drops', async () => {
 vi.useFakeTimers(); vi.setSystemTime(new Date('2050-01-01'));
 let round = 0;
 const stream = vi.fn(async function* () {
  if (round++ === 0) yield { type: 'done', result: { ...answer, text: '', toolCalls: [{ id: 'tc_sent', name: 'send', arguments: {} }] } };
  else yield { type: 'text_delta', text: 'The action finished, but' };
 });
 const call = vi.fn(); const runTools = vi.fn(async () => [{ tool_use_id: 'tc_sent', content: 'Sent once' }]);
 setPramaanClientForTests({ stream, call } as unknown as PramaanClient);
 await expect(streamWithProvider({ model: 'balanced', systemPrompt: 'Test', messages: [], runTools })).rejects.toThrow('incomplete');
 expect(runTools).toHaveBeenCalledOnce(); expect(stream).toHaveBeenCalledTimes(2); expect(call).not.toHaveBeenCalled();
});
it('passes Stop to the single SDK request and closes its reader', async () => {
 vi.resetModules();
 const controller = new AbortController(); const cancel = vi.fn();
 const fetch = vi.fn(async (_url: string, init: RequestInit) => {
  expect(init.signal).toBe(controller.signal);
  return new Response(new ReadableStream({ start(reader) {
   reader.enqueue(new TextEncoder().encode(frames(['text_delta', { text: 'Hi' }])));
  }, cancel }), { headers: { 'Content-Type': 'text/event-stream' } });
 });
 vi.stubGlobal('fetch', fetch); vi.stubEnv('PRAMAAN_API_KEY', 'fake-key'); vi.stubEnv('PRAMAAN_BASE_URL', 'http://example.test');
 try {
  const client = await import('../pramaan.js');
  await expect(client.streamChatCapability(input, () => controller.abort(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetch).toHaveBeenCalledOnce(); expect(cancel).toHaveBeenCalledOnce();
 } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
});
