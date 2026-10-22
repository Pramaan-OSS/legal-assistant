import type { Requests } from '@pramaan/sdk' with { 'resolution-mode': 'import' };
import { callCapabilityAbortable, streamChatCapability, ChatStreamInterruptedError, IncompleteReplyError } from '../pramaan';
import type { StreamChatParams, StreamChatResult, UserApiKeys } from './types';

function quality(model: string): 'fast' | 'balanced' | 'best' {
  return model === 'fast' || model === 'best' ? model : 'balanced';
}
let wholeReplyUntil = 0;
export async function streamWithProvider(params: StreamChatParams): Promise<StreamChatResult> {
  const messages: Requests['llm.chat']['messages'] = [
    { role: 'system', content: params.systemPrompt }, ...params.messages,
  ];
  let fullText = '';
  const limit = Math.max(1, Math.min(32, params.maxIterations ?? 16));
  for (let round = 0; round < limit; round++) {
    params.abortSignal?.throwIfAborted();
    const input: Requests['llm.chat'] = {
      messages,
      model: quality(params.model),
      maxTokens: 8192,
      ...(params.tools?.length ? { tools: params.tools.map(t => ({ ...t.function })) } : {}),
    };
    let turn;
    const useWholeReply = Date.now() < wholeReplyUntil;
    const show = (text: string) => { fullText += text; params.callbacks?.onActivity?.(); params.callbacks?.onContentDelta?.(text); };
    try {
      if (useWholeReply) {
        turn = await callCapabilityAbortable('llm.chat', input, params.abortSignal);
        if (turn.text) show(turn.text);
      } else turn = await streamChatCapability(input, show, params.abortSignal);
    } catch (error) {
      // Later requests use whole replies briefly; the uncertain paid turn is never repeated.
      if (error instanceof IncompleteReplyError && useWholeReply && error.partialText) show(error.partialText);
      if (error instanceof ChatStreamInterruptedError) wholeReplyUntil = Date.now() + 60_000;
      throw error;
    }
    params.abortSignal?.throwIfAborted();
    params.callbacks?.onActivity?.();
    if (!turn.toolCalls.length) return { fullText };
    if (!params.runTools) throw new Error('This action requires an application tool handler.');
    const calls = turn.toolCalls.map(c => ({ id: c.id, name: c.name, input: c.arguments }));
    for (const call of calls) params.callbacks?.onToolCallStart?.(call);
    messages.push({ role: 'assistant', ...(turn.text ? { content: turn.text } : {}), toolCalls: turn.toolCalls });
    const results = await params.runTools(calls);
    for (const call of calls) {
      const matches = results.filter(r => r.tool_use_id === call.id);
      if (matches.length !== 1) throw new Error('A tool did not return exactly one result.');
      messages.push({ role: 'tool', toolCallId: call.id, content: matches[0].content });
    }
  }
  throw new Error('The assistant reached its action limit. Ask it to continue with a smaller task.');
}
export async function completeWithProvider(params: {
  model: string; systemPrompt?: string; user: string; maxTokens?: number;
  abortSignal?: AbortSignal; apiKeys?: UserApiKeys;
}): Promise<string> {
  params.abortSignal?.throwIfAborted();
  const result = await callCapabilityAbortable('llm.complete', {
    messages: [ ...(params.systemPrompt ? [{ role: 'system' as const, content: params.systemPrompt }] : []), { role: 'user', content: params.user } ],
    model: quality(params.model), maxTokens: Math.max(64, Math.min(8192, params.maxTokens ?? 8192)),
  }, params.abortSignal);
  params.abortSignal?.throwIfAborted();
  return result.text;
}
