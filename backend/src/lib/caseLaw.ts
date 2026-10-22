import { callCapability } from './pramaan';
import { rememberLawHandle, resolveLawHandle } from './lawHandles';
import type { Db } from './supabase';

type CaseRow = { ref?: string; caseName: string; citations: string[]; filedDate?: string; court?: string; snippet?: string };
async function appCase(row: CaseRow) {
  return { clusterId: row.ref ? await rememberLawHandle(row.ref) : null,
    caseName: row.caseName, citations: row.citations, citation: row.citations.join('; '),
    dateFiled: row.filedDate ?? null, court: row.court ?? null, snippet: row.snippet ?? null,
    url: null, pdfUrl: null };
}
export async function verifyCaseLawCitations(args: { citations?: string[]; db?: Db; apiToken?: string | null }) {
  const citations = (args.citations ?? []).map(c => c.trim()).filter(Boolean).slice(0, 250);
  if (!citations.length) return { error: 'Provide at least one citation.', results: [], citationLinks: [] };
  const result = await callCapability('law.citations.lookup', { text: citations.join('\n') });
  const results = await Promise.all(result.results.map(async r => ({ citation: r.citation,
    status: r.status === 'matched' ? 'ok' : r.status === 'missing' ? 'not_found' : r.status,
    normalizedCitations: r.normalizedCitations, clusters: await Promise.all(r.cases.map(appCase)),
  })));
  return { citationsSubmitted: citations.length, results, citationLinks: [], source: 'legal-capability' };
}
export async function searchCaseLawCaseLaw(args: { query?: string; court?: string; filedAfter?: string; filedBefore?: string; limit?: number; apiToken?: string | null }) {
  if (!args.query?.trim()) return { error: 'query is required.', results: [] };
  const result = await callCapability('law.cases.search', { query: args.query.trim(), court: args.court,
    after: args.filedAfter, before: args.filedBefore, limit: Math.max(1, Math.min(20, args.limit ?? 10)) });
  return { query: args.query, results: await Promise.all(result.results.map(appCase)), nextCursor: result.nextCursor };
}
export async function getCaseLawCaseOpinions(args: { clusterId?: number; includeFullText?: boolean; maxChars?: number; db?: Db; apiToken?: string | null }) {
  if (!args.clusterId) return { error: 'Choose a case first.', opinions: [] };
  const ref = await resolveLawHandle(args.clusterId);
  const row = await callCapability('law.case.get', { ref });
  const maxTextLength = Math.max(1000, Math.min(50000, args.maxChars ?? 50000));
  const opinions = [];
  for (const item of row.opinions) {
    if (!item.ref) continue;
    const opinion = await callCapability('law.opinion.get', { ref: item.ref, maxTextLength });
    opinions.push({ opinionId: await rememberLawHandle(item.ref), type: opinion.type ?? null,
      text: opinion.text, html: null, url: null, pdfUrl: null, truncated: opinion.truncated });
  }
  return { ...await appCase({ ...row, ref }), opinions, clusterId: args.clusterId };
}
export async function getCaseLawCases(args: { clusterIds?: number[]; includeFullText?: boolean; maxChars?: number; db?: Db; apiToken?: string | null }) {
  if (!args.clusterIds?.length) return { error: 'Choose at least one case.', cases: [] };
  const cases = [];
  for (const clusterId of [...new Set(args.clusterIds ?? [])].slice(0, 20)) {
    cases.push(await getCaseLawCaseOpinions({ ...args, clusterId }));
  }
  return { cases };
}
