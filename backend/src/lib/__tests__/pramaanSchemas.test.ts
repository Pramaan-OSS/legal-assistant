import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkedFakePramaanClient, setPramaanClientForTests, callCapability, callCapabilityAbortable, streamChatCapability, estimateOutcome, runOutcome, type PramaanClient } from '../pramaan';
import { checkPramaanSchema, normalizePramaanSchema, PramaanSchemaError, preparePramaanSchemas } from '../pramaan.schemas';
import { PRODUCT_SCHEMA_DEFINITIONS, checkProductSchemas } from '../../jobs/checkPramaanSchemas';
const object = { type: 'object', properties: { text: { type: 'string' } } };
const input = (parameters: Record<string, unknown>) => ({ messages: [{ role: 'user' as const, content: 'Check.' }], tools: [{ name: 'connected_action', parameters }], model: 'balanced' as const });
afterEach(() => setPramaanClientForTests());
describe('every product schema', () => {
  it('checks every built-in, project, tabular, legal, Word, memory and outcome definition', () => {
    expect(checkProductSchemas()).toBe(26);
    for (const { function: definition } of PRODUCT_SCHEMA_DEFINITIONS) {
      expect(() => checkPramaanSchema(normalizePramaanSchema(definition.parameters, definition.name), definition.name)).not.toThrow();
      expect(() => checkPramaanSchema(definition.parameters, definition.name)).not.toThrow();
    }
  });
  it('names a failing built-in at build time', () => {
    const definition = PRODUCT_SCHEMA_DEFINITIONS[0].function;
    const original = definition.parameters;
    definition.parameters = { ...object, pattern: 'x' } as typeof original;
    try { expect(checkProductSchemas).toThrow(new RegExp(definition.name)); } finally { definition.parameters = original; }
  });
});
describe('bounded schema contract', () => {
  it('strips dialect/format at nested schema nodes without changing property names or JSON examples', () => {
    const raw = { ...object, $schema: 'https://example.test/draft', properties: { format: { type: 'string', format: 'email' }, $schema: { type: 'string' } }, examples: [{ format: 'kept', $schema: 'kept' }] };
    const normalized = normalizePramaanSchema(raw, 'connected_action');
    expect(normalized).toEqual({ type: 'object', properties: { format: { type: 'string', description: 'Format hint: email.' }, $schema: { type: 'string' } }, examples: raw.examples });
    expect(raw.$schema).toBeDefined();
    expect(raw.properties.format.format).toBe('email');
  });
  it.each(['pattern', 'oneOf', 'allOf', 'not', 'if', 'then', 'else', 'patternProperties', 'uniqueItems', 'definitions', 'nullable'])('refuses %s without dropping its meaning', keyword => {
    const raw = { ...object, properties: { text: { type: 'string', [keyword]: true } } };
    expect(() => normalizePramaanSchema(raw, 'connected_action')).toThrow(`Schema "connected_action" at $.properties["text"]["${keyword}"]`);
  });
  it('requires an object root', () => expect(() => checkPramaanSchema({ type: 'array', items: {} }, 'reply')).toThrow('Root must be an object'));
  it('checks enum limits', () => { checkPramaanSchema({ ...object, enum: Array.from({ length: 256 }, (_, i) => i) }, 'enum'); expect(() => checkPramaanSchema({ ...object, enum: Array(257).fill('x') }, 'enum')).toThrow('256 values'); });
  it('checks branch limits', () => { checkPramaanSchema({ ...object, anyOf: Array.from({ length: 16 }, () => ({})) }, 'branches'); expect(() => checkPramaanSchema({ ...object, anyOf: Array.from({ length: 17 }, () => ({})) }, 'branches')).toThrow('16 branches'); });
  it('checks node limits', () => { const schema = (length: number) => ({ type: 'object', properties: Object.fromEntries(Array.from({ length }, (_, i) => [String(i), {}])) }); checkPramaanSchema(schema(255), 'nodes'); expect(() => checkPramaanSchema(schema(256), 'nodes')).toThrow('256 nodes'); const shared = {}; expect(() => checkPramaanSchema({ type: 'object', properties: Object.fromEntries(Array.from({ length: 256 }, (_, i) => [String(i), shared])) }, 'shared')).toThrow('256 nodes'); });
  it('checks depth limits', () => { const schema = (depth: number) => { let child: Record<string, unknown> = {}; for (let i = 1; i < depth; i++) child = { type: 'array', items: child }; return { type: 'object', properties: { nested: child } }; }; checkPramaanSchema(schema(16), 'depth'); expect(() => checkPramaanSchema(schema(17), 'depth')).toThrow('depth exceeds 16'); });
  it('checks bytes and the combined chat budget', () => { expect(() => checkPramaanSchema({ ...object, description: 'x'.repeat(65536) }, 'bytes')).toThrow('64 KB'); expect(() => preparePramaanSchemas('llm.chat', { ...input(object), tools: ['a', 'b'].map(name => ({ name, parameters: { ...object, description: 'x'.repeat(40000) } })) })).toThrow('Combined schemas'); });
  it('allows escaped local references and refuses external, missing and recursive targets', () => {
    checkPramaanSchema({ type: 'object', properties: { value: { $ref: '#/$defs/a~1b' } }, $defs: { 'a/b': { type: 'string' } } }, 'local');
    for (const ref of ['https://example.test/schema', '#', '#/missing']) expect(() => checkPramaanSchema({ ...object, $ref: ref }, 'ref')).toThrow('$ref');
    expect(() => checkPramaanSchema({ type: 'object', $defs: { cycle: { $ref: '#/$defs/cycle' } } }, 'cycle')).toThrow('Recursive');
  });
  it('rejects non-JSON, cycles, invalid bound and schema values', () => {
    const cyclic: Record<string, unknown> = { type: 'object' }; cyclic.properties = { self: cyclic };
    for (const schema of [cyclic, { ...object, description: new Date() }, { ...object, maximum: Infinity }, { ...object, minItems: -1 }, { ...object, items: [] }]) expect(() => normalizePramaanSchema(schema, 'invalid')).toThrow(PramaanSchemaError);
  });
});
describe('single client boundary and strict fake transport', () => {
  it('enforces the subset on direct fake calls, streaming, response and extraction schemas', async () => {
    const call = vi.fn(), stream = vi.fn(); const fake = checkedFakePramaanClient({ call, stream } as PramaanClient);
    expect(() => fake.call('llm.chat', input({ ...object, format: 'x' }))).toThrow('format');
    expect(() => fake.call('llm.complete', { messages: [], jsonSchema: { ...object, pattern: 'x' } })).toThrow('pattern');
    expect(() => preparePramaanSchemas('document.extract', { fileId: 'file_fake', schema: { ...object, $schema: 'x' } }, false)).toThrow('$schema');
    await expect(async () => { for await (const _ of fake.stream!('llm.chat', input({ ...object, format: 'x' }))) { /* no events */ } }).rejects.toThrow('format');
    expect(call).not.toHaveBeenCalled(); expect(stream).not.toHaveBeenCalled();
  });
  it('normalizes connected definitions on whole, async and streamed calls', async () => {
    const answer = { text: 'Ready.', toolCalls: [], finishReason: 'stop' };
    const call = vi.fn().mockResolvedValue(answer), run = vi.fn().mockResolvedValue(answer);
    const stream = vi.fn(async function* () { yield { type: 'done', result: answer }; });
    setPramaanClientForTests({ call, run, stream, jobs: { get: vi.fn(), cancel: vi.fn() } } as unknown as PramaanClient);
    const raw = input({ ...object, $schema: 'x', properties: { text: { type: 'string', format: 'date' } } });
    await callCapability('llm.chat', raw); await callCapabilityAbortable('llm.chat', raw, new AbortController().signal); await streamChatCapability(raw, vi.fn());
    for (const method of [call, run, stream]) { const wire = method.mock.calls[0][1]; expect(JSON.stringify(wire)).not.toContain('$schema'); checkPramaanSchema(wire.tools[0].parameters, 'connected'); }
  });
  it('preserves named-path failures across streaming without fallback or dispatch', async () => {
    const call = vi.fn(), stream = vi.fn(); setPramaanClientForTests({ call, stream } as PramaanClient);
    await expect(streamChatCapability(input({ ...object, pattern: 'x' }), vi.fn())).rejects.toThrow('connected_action');
    await expect(callCapabilityAbortable('llm.chat', input({ ...object, pattern: 'x' }), new AbortController().signal)).rejects.toThrow('["pattern"]');
    expect(call).not.toHaveBeenCalled(); expect(stream).not.toHaveBeenCalled();
  });
  it('gates structured completion, extraction, and schemas in outcome estimate/run inputs', async () => {
    const call = vi.fn().mockResolvedValue({}), estimate = vi.fn().mockResolvedValue({}), run = vi.fn().mockResolvedValue({});
    setPramaanClientForTests({ call, outcomes: { estimate, run, list: vi.fn(), get: vi.fn() } } as PramaanClient);
    const raw = { ...object, $schema: 'x' };
    await callCapability('llm.complete', { messages: [], jsonSchema: raw });
    expect(JSON.stringify(preparePramaanSchemas('document.extract', { fileId: 'file_fake', schema: raw }))).not.toContain('$schema');
    await estimateOutcome('document.summarize', { nested: { schema: raw } }); await runOutcome('document.summarize', { nested: { schema: raw } });
    expect(JSON.stringify(call.mock.calls)).not.toContain('$schema'); expect(JSON.stringify(estimate.mock.calls)).not.toContain('$schema'); expect(JSON.stringify(run.mock.calls)).not.toContain('$schema');
    await expect(runOutcome('document.summarize', { jsonSchema: { ...object, oneOf: [] } })).rejects.toThrow('outcome:document.summarize'); expect(run).toHaveBeenCalledOnce();
    expect(() => preparePramaanSchemas('document.extract', { fileId: 'file_fake', schema: { ...object, description: 'x'.repeat(8000) } })).toThrow('8,000');
  });
});
