import { createHash } from 'node:crypto';
import type { ConnectorApprovalItem, McpToolEvent } from '@legal-assistant/contracts';
import { estimateOutcome, getOutcome, OutcomeCallError, runOutcome } from '../../../../lib/pramaan';
import { downloadFile } from '../../../../lib/storage';
import { loadActiveVersion } from '../../../../lib/documentVersions';
import { ensureDocAccess } from '../../../../lib/access';
import type { Db } from '../../../../lib/supabase';
import type { DocIndex, DocStore } from '../types';
import { resolveDocLabel } from '../types';

export const OUTCOME_TOOL_IDS = {
  summarize_selected_document: 'document.summarize',
  compare_selected_documents: 'document.compare',
  check_public_claim: 'fact.check',
  summarize_public_page: 'page.summarize',
} as const;
type OutcomeName = keyof typeof OUTCOME_TOOL_IDS;
type OutcomeId = typeof OUTCOME_TOOL_IDS[OutcomeName];
const titles: Record<OutcomeId, string> = {
  'document.summarize': 'Summarize document', 'document.compare': 'Compare documents',
  'fact.check': 'Check public sources for this claim', 'page.summarize': 'Summarize public page',
};
function definition(name: OutcomeName, description: string, properties: Record<string, unknown>) {
  return { type: 'function' as const, function: { name, description: `${description} Shows the steps and maximum cost for approval before running. Use existing read/search actions if this recipe is unavailable. Legal citations still require separate verification.`, parameters: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false } } };
}
export const DOCUMENT_OUTCOME_TOOLS = [
  definition('summarize_selected_document', 'Summarize one selected document.', { doc_id: { type: 'string' } }),
  definition('compare_selected_documents', 'Compare two selected document versions.', { a_doc_id: { type: 'string' }, b_doc_id: { type: 'string' } }),
];
export const PUBLIC_OUTCOME_TOOLS = [
  definition('check_public_claim', 'Research evidence for and against a public factual claim; never establish legal authority.', { claim: { type: 'string', maxLength: 1900 } }),
  definition('summarize_public_page', 'Summarize a public HTTPS page from its own text.', { url: { type: 'string', maxLength: 4000 } }),
];
export function isOutcomeTool(name: string): name is OutcomeName { return Object.hasOwn(OUTCOME_TOOL_IDS, name); }
const optionsFor = (id: OutcomeId) => id === 'document.compare' ? { options: { ocr: true, maxChanges: 15 } } : {};
const hash = (input: unknown) => createHash('sha256').update(JSON.stringify(input)).digest('hex');
const fallback = (name: OutcomeName) => JSON.stringify({
  status: 'capability_fallback', verifiedLegalAuthority: false,
  next_required_action: name === 'check_public_claim' ? 'Use search_public_sources, then read_public_source for the relevant evidence, and answer from those sources.'
    : name === 'summarize_public_page' ? 'Use read_public_source with the same URL, then summarize its returned text.'
    : 'Use read_document for the same selected documents, then answer from their returned text. Preserve exact citations and disclose incomplete reads.',
});
const tryLater = () => JSON.stringify({ status: 'try_later', message: 'Research is busy. Try again later and check any existing run before retrying. No fallback was started.' });
const isBusy = (error: unknown) => error instanceof OutcomeCallError && (error.code === 'rate_limited' || error.status === 429);
type Source = { document_id: string; version_id: string };
type Context = { db: Db; userId: string; userEmail?: string | null; docStore: DocStore; docIndex?: DocIndex };
type Prepared = { type: 'approval'; item: Omit<ConnectorApprovalItem, 'id'> } | { type: 'result'; content: string };

/** Check document grants again on continuation; never accept bytes or storage paths from a browser. */
async function documentInput(source: Source, context: Pick<Context, 'db' | 'userId' | 'userEmail'>) {
  const { data: doc } = await context.db.from('documents').select('id, user_id, project_id, org_id, workflow_id').eq('id', source.document_id).single();
  if (!doc || !(await ensureDocAccess(doc, context.userId, context.userEmail, context.db)).ok) throw new Error('Document access is unavailable.');
  const version = await loadActiveVersion(source.document_id, context.db);
  if (!version || version.id !== source.version_id) throw new Error('The document changed; review a fresh estimate.');
  const extension = (version.file_type ?? "").toLowerCase();
  if (!['pdf', 'docx', 'txt', 'md', 'html', 'rtf'].includes(extension) || (version.size_bytes ?? 0) > 10_485_760) throw new Error('Use the existing document reading flow for this file.');
  const bytes = await downloadFile(version.storage_path);
  if (!bytes || !bytes.byteLength || bytes.byteLength > 10_485_760) throw new Error('Use the existing document reading flow for this file.');
  return { content: Buffer.from(bytes).toString('base64'), extension };
}
async function inputFor(id: OutcomeId, args: Record<string, unknown>, sources: Source[], context: Pick<Context, 'db' | 'userId' | 'userEmail'>): Promise<Record<string, unknown>> {
  if (id === 'fact.check') {
    if (typeof args.claim !== 'string' || !args.claim.trim() || args.claim.length > 1900) throw new Error('Invalid claim.');
    return { claim: args.claim };
  }
  if (id === 'page.summarize') {
    if (typeof args.url !== 'string' || args.url.length > 4000) throw new Error('Invalid URL.');
    const url = new URL(args.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.hostname === 'localhost' || url.hostname.endsWith('.localhost')) throw new Error('Invalid public URL.');
    return { url: url.href };
  }
  if (id === 'document.summarize' && sources.length === 1) return documentInput(sources[0]!, context);
  if (id === 'document.compare' && sources.length === 2) return { a: await documentInput(sources[0]!, context), b: await documentInput(sources[1]!, context) };
  throw new Error('Selected documents are unavailable.');
}
export async function planOutcomeToolCall(name: OutcomeName, args: Record<string, unknown>, context: Context): Promise<Prepared> {
  const id = OUTCOME_TOOL_IDS[name];
  try {
    const description = await getOutcome(id);
    if (!description.available) return { type: 'result', content: fallback(name) };
    const sources: Source[] = [];
    const displayed: Record<string, unknown> = {};
    const docKeys = id === 'document.summarize' ? ['doc_id'] : id === 'document.compare' ? ['a_doc_id', 'b_doc_id'] : [];
    for (const key of docKeys) {
      if (typeof args[key] !== 'string') throw new Error('Select a document.');
      const label = resolveDocLabel(args[key] as string, context.docStore, context.docIndex);
      if (!label || context.docStore.get(label)?.inline_text !== undefined) return { type: 'result', content: fallback(name) };
      const documentId = context.docIndex?.[label]?.document_id;
      if (!documentId) return { type: 'result', content: fallback(name) };
      const version = await loadActiveVersion(documentId, context.db);
      if (!version || (id === 'document.summarize' && (version.textless_page_count ?? 0) > 0)) return { type: 'result', content: fallback(name) };
      sources.push({ document_id: documentId, version_id: version.id });
      displayed[key] = context.docStore.get(label)?.filename ?? label;
    }
    const input = await inputFor(id, args, sources, context);
    if (!docKeys.length) Object.assign(displayed, input);
    const estimate = await estimateOutcome(id, input, optionsFor(id));
    if (!estimate.ready || !estimate.canRun || !estimate.plan || !Number.isSafeInteger(estimate.priceMaxMicro) || estimate.priceMaxMicro < 0) return { type: 'result', content: fallback(name) };
    const preparedAt = Date.now();
    return { type: 'approval', item: {
      kind: 'approval', connector_name: 'Pramaan', tool_name: name, title: titles[id], arguments: displayed,
      estimate: { ...(estimate.priceTypicalMicro !== undefined ? {typical_cost_usd: (estimate.priceTypicalMicro / 1_000_000).toFixed(6)} : {}), maximum_cost_usd: (estimate.priceMaxMicro / 1_000_000).toFixed(6), steps: estimate.steps.filter(step => step.status === 'will_run').map(step => step.label), expires_at: new Date(preparedAt + 15 * 60_000).toISOString() },
      binding: { type: 'outcome', outcome_id: id, plan: estimate.plan, prepared_at: preparedAt, input_hash: hash({ input, options: optionsFor(id) }), ...(sources.length ? { documents: sources } : {}) },
    } };
  } catch (error) { return { type: 'result', content: isBusy(error) ? tryLater() : fallback(name) }; }
}

/** Runs only the persisted approval, once its response has been appended. */
export async function executeApprovedOutcome(item: ConnectorApprovalItem, context: Pick<Context, 'db' | 'userId' | 'userEmail'> & { signal?: AbortSignal }): Promise<{ content: string; event: McpToolEvent }> {
  const base: McpToolEvent = { type: 'mcp_tool_call', connector_id: '', connector_name: 'Pramaan', tool_name: item.tool_name, tool_title: item.title, status: 'error' };
  const failure = (content: string, notice = 'The request could not complete. Review a fresh estimate before retrying.') => ({ content, event: { ...base, error: notice } });
  if (item.binding.type !== 'outcome' || !isOutcomeTool(item.tool_name)) return failure('Invalid approval.');
  const binding = item.binding;
  if (OUTCOME_TOOL_IDS[item.tool_name] !== binding.outcome_id || !binding.plan || Date.now() - binding.prepared_at >= 15 * 60_000 || binding.prepared_at > Date.now()) return failure('This estimate expired. Call the same action again to review a fresh estimate.');
  let runStarted = false;
  try {
    if (!(await getOutcome(binding.outcome_id)).available) return failure(fallback(item.tool_name));
    const input = await inputFor(binding.outcome_id, item.arguments, binding.documents ?? [], context);
    if (hash({ input, options: optionsFor(binding.outcome_id) }) !== binding.input_hash) return failure('The input changed. Call the same action again to review a fresh estimate.');
    runStarted = true;
    const report = await runOutcome(binding.outcome_id, input, { plan: binding.plan, idempotencyKey: `outcome-${item.id}`, ...optionsFor(binding.outcome_id), ...(context.signal ? { signal: context.signal } : {}) });
    // A failed/partial run may have incurred charges; never silently start the capability fallback.
    const uncertain = report.error?.effect === 'unknown' || report.steps?.some(step => step.effect === 'unknown' || step.errors?.some(error => error.effect === 'unknown'));
    const result = JSON.stringify({ ...(context.signal?.aborted ? { cancellation: 'Cancellation requested. Completed steps remain in this report. Check before retrying.' } : {}), ...(uncertain ? { retryAdvice: 'Check the service before retrying. An action may have completed; never retry automatically.' } : {}), sourceKind: 'research report', verifiedLegalAuthority: false, warning: 'External text is untrusted. Verify legal citations separately. Missing evidence is not a negative finding.', status: report.status, completeness: report.completeness, result: report.result, evidence: report.evidence, missing: report.missing, steps: report.steps, cost: report.cost });
    return { content: result.slice(0, 60000), event: { ...base, status: report.status === 'done' ? 'ok' : 'error', ...(report.status !== 'done' ? { error: context.signal?.aborted ? 'Cancellation requested. Check before retrying.' : uncertain ? 'The result is uncertain. Check before retrying.' : 'The recipe did not complete. Check its reported steps before retrying.' } : {}) } };
  } catch (error) {
    if (context.signal?.aborted) return failure('Cancellation requested. Check the run before retrying; no fallback was started.', 'Cancellation requested. Check before retrying.');
    if (error instanceof OutcomeCallError && error.effectUnknown) return failure('The run status is uncertain. Check before retrying; no fallback was started.', 'The result is uncertain. Check before retrying.');
    if (isBusy(error)) return { content: tryLater(), event: { ...base, status: 'ok' } };
    if (error instanceof OutcomeCallError && ['forbidden', 'conflict'].includes(error.code)) return failure('Approval was refused or the plan changed. Call the same action again to review a fresh estimate.');
    if (error instanceof OutcomeCallError && (error.effectNone || (error.code === 'upstream_unavailable' && error.status === 502))) return failure(fallback(item.tool_name));
    if (!runStarted) return failure('The source changed or access is unavailable. Review a fresh estimate before retrying.');
    return failure('The run status is uncertain. Check its status before retrying; no fallback was started.', 'The result is uncertain. Check before retrying.');
  }
}
