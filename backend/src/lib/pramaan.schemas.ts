import { UserFacingError } from './userFacingError';

type Schema = Record<string, unknown>;
const record = (v: unknown): v is Schema => !!v && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const bounds = new Set(['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'minItems', 'maxItems']);
const allowed = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'anyOf', '$defs', '$ref', 'title', 'description', 'default', 'examples', ...bounds]);
const types = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
export class PramaanSchemaError extends UserFacingError {
  readonly code = 'invalid_request';
  constructor(name: string, path: string, reason: string) { super(`Schema "${name}" at ${path}: ${reason}`); }
}
const pathKey = (path: string, key: string) => `${path}[${JSON.stringify(key)}]`;
function children(node: Schema): Array<[string, unknown]> {
  return [
    ...Object.entries(record(node.properties) ? node.properties : {}).map(([key, value]): [string, unknown] => [`properties[${JSON.stringify(key)}]`, value]),
    ...Object.entries(record(node.$defs) ? node.$defs : {}).map(([key, value]): [string, unknown] => [`$defs[${JSON.stringify(key)}]`, value]),
    ...(node.items === undefined ? [] : [['items', node.items] as [string, unknown]]),
    ...(record(node.additionalProperties) ? [['additionalProperties', node.additionalProperties] as [string, unknown]] : []),
    ...(Array.isArray(node.anyOf) ? node.anyOf.map((v, i): [string, unknown] => [`anyOf[${i}]`, v]) : []),
  ];
}
/** Check schema nodes, not property names or JSON values inside annotations. */
export function checkPramaanSchema(value: unknown, name: string): asserts value is Schema {
  const fail = (path: string, reason: string): never => { throw new PramaanSchemaError(name, path, reason); };
  const json = (v: unknown, path: string, depth = 0, seen = new Set<object>()): void => {
    if (depth > 32) fail(path, 'JSON nesting exceeds 32.');
    if (v === null || typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v)) return;
    if ((!record(v) && !Array.isArray(v)) || seen.has(v as object)) fail(path, 'Must be finite, acyclic JSON.');
    seen.add(v as object); for (const [key, item] of Object.entries(v as object)) json(item, pathKey(path, key), depth + 1, seen); seen.delete(v as object);
  };
  json(value, '$');
  if (!record(value) || value.type !== 'object') fail('$["type"]', 'Root must be an object.');
  const root = value as Schema;
  if (Buffer.byteLength(JSON.stringify(root)) > 65536) fail('$', 'Schema exceeds 64 KB.');
  const nodes = new Set<Schema>();
  let count = 0;
  const walk = (v: unknown, path: string, depth: number): void => {
    if (!record(v)) fail(path, 'Expected a schema object.'); const node = v as Schema;
    if (depth > 16) fail(path, 'Schema depth exceeds 16.');
    if (++count > 256) fail(path, 'Schema exceeds 256 nodes.'); nodes.add(node);
    for (const [key, item] of Object.entries(node)) {
      const at = pathKey(path, key);
      if (!allowed.has(key)) fail(at, `Unsupported keyword "${key}".`);
      if (key === 'type') { const list = Array.isArray(item) ? item : [item]; if (!list.length || new Set(list).size !== list.length || list.some(t => typeof t !== 'string' || !types.has(t))) fail(at, 'Invalid type.'); }
      if (['properties', '$defs', 'items'].includes(key) && !record(item)) fail(at, 'Expected a schema object.');
      if (key === 'required' && (!Array.isArray(item) || item.some(t => typeof t !== 'string') || new Set(item).size !== item.length)) fail(at, 'Expected unique property names.');
      if (key === 'additionalProperties' && typeof item !== 'boolean' && !record(item)) fail(at, 'Expected a boolean or schema object.');
      if (key === 'anyOf' && (!Array.isArray(item) || !item.length || item.length > 16)) fail(at, 'Expected 1 to 16 branches.');
      if (key === 'enum' && (!Array.isArray(item) || !item.length || item.length > 256)) fail(at, 'Expected 1 to 256 values.');
      if (['title', 'description', '$ref'].includes(key) && typeof item !== 'string') fail(at, 'Expected a string.');
      if (key === 'examples' && !Array.isArray(item)) fail(at, 'Expected an array.');
      if (bounds.has(key) && (typeof item !== 'number' || !Number.isFinite(item) || (key.includes('Length') || key.includes('Items')) && (!Number.isInteger(item) || item < 0))) fail(at, 'Invalid bound.');
    }
    for (const [key, child] of children(node)) walk(child, `${path}.${key}`, depth + 1);
  };
  walk(root, '$', 0);
  let expanded = 0;
  const refs = (node: Schema, path: string, stack: Set<Schema>, depth: number): void => {
    if (stack.has(node) || depth > 32 || ++expanded > 4096) fail(path, 'Recursive or excessive reference expansion.');
    const next = new Set(stack).add(node);
    if (typeof node.$ref === 'string') {
      const ref = node.$ref;
      if (!ref.startsWith('#/') || /~(?![01])/u.test(ref)) fail(`${path}.$ref`, 'Only local #/... references are supported.');
      let target: unknown = root;
      for (const key of ref.slice(2).split('/').map(s => s.replaceAll('~1', '/').replaceAll('~0', '~'))) {
        if (!record(target) || !Object.hasOwn(target, key)) fail(`${path}.$ref`, 'Reference target is missing.'); target = (target as Schema)[key];
      }
      if (!record(target) || !nodes.has(target)) fail(`${path}.$ref`, 'Reference must target a schema node.');
      refs(target as Schema, `${path}.$ref`, next, depth + 1);
    }
    for (const [key, child] of children(node)) refs(child as Schema, `${path}.${key}`, next, depth + 1);
  };
  refs(root, '$', new Set(), 0);
}

/** Remove dialect metadata and unsupported format hints; never drop constraints. */
export function normalizePramaanSchema(value: unknown, name: string): Schema {
  // Validate JSON before cloning, including cycles and unsupported values.
  const seen = new Set<object>();
  const copy = (v: unknown, path: string, depth: number): unknown => {
    if (depth > 32 || v && typeof v === 'object' && seen.has(v)) throw new PramaanSchemaError(name, path, 'Cyclic or excessive JSON nesting.');
    if (!v || typeof v !== 'object') return v;
    if (!Array.isArray(v) && !record(v)) throw new PramaanSchemaError(name, path, 'Must be plain JSON.');
    seen.add(v);
    const result = Array.isArray(v) ? v.map((item, i) => copy(item, `${path}[${i}]`, depth + 1)) : Object.fromEntries(Object.entries(v).map(([key, item]) => [key, copy(item, pathKey(path, key), depth + 1)]));
    seen.delete(v); return result;
  };
  const cloned = copy(value, '$', 0);
  const normalize = (node: unknown): void => {
    if (!record(node)) return;
    delete node.$schema;
    if (typeof node.format === 'string') node.description = `${typeof node.description === 'string' ? node.description + ' ' : ''}Format hint: ${node.format}.`;
    delete node.format;
    for (const [, child] of children(node)) normalize(child);
  };
  normalize(cloned); checkPramaanSchema(cloned, name); return cloned;
}

/** Exact capability fields; ordinary action input data is never treated as a schema. */
export function preparePramaanSchemas(id: string, value: unknown, normalize = true): unknown {
  if (!record(value)) return value;
  const apply = (schema: unknown, name: string) => { if (normalize) return normalizePramaanSchema(schema, name); checkPramaanSchema(schema, name); return schema; };
  const output = { ...value };
  if (id === 'llm.chat' && Array.isArray(value.tools)) output.tools = value.tools.map((entry, i) => {
    if (!record(entry)) throw new PramaanSchemaError(id, `$.tools[${i}]`, 'Expected a definition.');
    return { ...entry, parameters: apply(entry.parameters, `${id}:${typeof entry.name === 'string' ? entry.name : i}`) };
  });
  if (id === 'llm.chat' || id === 'llm.complete') {
    if (typeof value.maxTokens === 'number' && value.maxTokens < 64) {
      if (!normalize) throw new PramaanSchemaError(id, '$.maxTokens', 'Reply limit must be at least 64.');
      output.maxTokens = 64;
    }
    if (value.jsonSchema !== undefined) output.jsonSchema = apply(value.jsonSchema, `${id}:response`);
    if (id === 'llm.chat' && Buffer.byteLength(JSON.stringify([output.jsonSchema ?? {}, ...(Array.isArray(output.tools) ? output.tools.map(t => (t as Schema).parameters) : [])])) > 65536) throw new PramaanSchemaError(id, '$.tools', 'Combined schemas exceed 64 KB.');
  }
  if (id === 'document.extract' && value.schema !== undefined) { output.schema = apply(value.schema, `${id}:fields`); if (JSON.stringify(output.schema).length > 8000) throw new PramaanSchemaError(id, '$.schema', 'Extraction schema exceeds 8,000 characters.'); }
  return output;
}

/** Outcome inputs currently contain no schemas; gate future explicit schema fields too. */
export function prepareOutcomeSchemas(id: string, value: unknown, normalize = true): unknown {
  const seen = new Set<object>();
  const walk = (v: unknown, path: string, depth = 0): unknown => {
    if (depth > 32 || v && typeof v === 'object' && seen.has(v)) throw new PramaanSchemaError(`outcome:${id}`, path, 'Cyclic or excessive input nesting.');
    if (!Array.isArray(v) && !record(v)) return v;
    seen.add(v);
    if (Array.isArray(v)) { const result = v.map((item, i) => walk(item, `${path}[${i}]`, depth + 1)); seen.delete(v); return result; }
    const result = Object.fromEntries(Object.entries(v).map(([key, item]) => {
      if (['schema', 'jsonSchema'].includes(key)) { const name = `outcome:${id}:${pathKey(path, key)}`; if (normalize) return [key, normalizePramaanSchema(item, name)]; checkPramaanSchema(item, name); return [key, item]; }
      return [key, walk(item, pathKey(path, key), depth + 1)];
    }));
    seen.delete(v); return result;
  };
  return walk(value, '$');
}
