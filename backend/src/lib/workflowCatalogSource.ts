import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const WORKFLOW_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_WORKFLOWS = 1000, MAX_ASSETS_PER_WORKFLOW = 50, MAX_FILE_BYTES = 5 * 1024 * 1024;
type UnknownRecord = Record<string, unknown>;
function asRecord(value: unknown, label: string): UnknownRecord { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`); return value as UnknownRecord; }
function requiredString(value: unknown, label: string): string { if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`); return value; }
export type WorkflowCatalogAssetSource = {
  filename: string;
  file_type: string;
  size_bytes: number;
  content_hash: string;
  temporary_path: string;
};

export type WorkflowCatalogSourceWorkflow = {
  workflow_key: string;
  distribution: "default" | "addon";
  version: string | null;
  title: string;
  description: string | null;
  type: "assistant" | "tabular";
  prompt_md: string;
  columns_config: unknown[] | null;
  contributors: Array<{
    name: string;
    organisation: string | null;
    role: string | null;
    linkedin: string | null;
  }>;
  language: string | null;
  practice: string | null;
  jurisdictions: string[] | null;
  pack_key: string | null;
  pack_title: string | null;
  pack_description: string | null;
  pack_version: string | null;
  default_sort_order: number | null;
  quick_action_name: string | null;
  quick_action_prompt: string | null;
  document_upload: boolean;
  word_quick_action: boolean;
  word_quick_action_prompt: string | null;
  assets: WorkflowCatalogAssetSource[];
  content_hash: string;
};

export type WorkflowCatalogSourceDocument = {
  source_repository: string;
  source_ref: string;
  source_commit: string;
  workflows: WorkflowCatalogSourceWorkflow[];
};

export type PreparedWorkflowCatalog = {
  directory: string;
  catalogPath: string;
  archivePath: string;
  sourceCommit: string;
};

export type WorkflowCatalogSourceOptions = {
  repository?: string;
  ref?: string;
  githubToken?: string;
  fetchImpl?: typeof fetch;
  temporaryRoot?: string;
};

export function validateWorkflowCatalogDocument(
  value: unknown,
): WorkflowCatalogSourceDocument {
  const document = asRecord(value, "Workflow catalog");
  const repository = requiredString(
    document.source_repository,
    "Workflow catalog source_repository",
  );
  if (!REPOSITORY_PATTERN.test(repository)) {
    throw new Error("Workflow catalog source_repository is invalid");
  }
  requiredString(document.source_ref, "Workflow catalog source_ref");
  const commit = requiredString(
    document.source_commit,
    "Workflow catalog source_commit",
  );
  if (!COMMIT_PATTERN.test(commit)) {
    throw new Error("Workflow catalog source_commit is invalid");
  }
  if (!Array.isArray(document.workflows) || !document.workflows.length) {
    throw new Error("Workflow catalog contains no workflows");
  }
  if (document.workflows.length > MAX_WORKFLOWS) {
    throw new Error("Workflow catalog exceeds the 1,000 workflow limit");
  }
  const keys = new Set<string>();
  for (const item of document.workflows) {
    const workflow = asRecord(item, "Workflow catalog entry");
    const key = requiredString(workflow.workflow_key, "Workflow key");
    if (!WORKFLOW_KEY_PATTERN.test(key) || keys.has(key)) {
      throw new Error(
        `Workflow catalog contains invalid or duplicate key '${key}'`,
      );
    }
    keys.add(key);
    if (
      workflow.distribution !== "default" &&
      workflow.distribution !== "addon"
    ) {
      throw new Error(`Workflow '${key}' has an invalid distribution`);
    }
    if (workflow.type !== "assistant" && workflow.type !== "tabular") {
      throw new Error(`Workflow '${key}' has an invalid type`);
    }
    requiredString(workflow.title, `Workflow '${key}' title`);
    requiredString(workflow.prompt_md, `Workflow '${key}' prompt`);
    if (
      typeof workflow.content_hash !== "string" ||
      !/^[0-9a-f]{64}$/.test(workflow.content_hash)
    ) {
      throw new Error(`Workflow '${key}' has an invalid content hash`);
    }
    if (!Array.isArray(workflow.assets)) {
      throw new Error(`Workflow '${key}' has invalid assets`);
    }
    if (workflow.assets.length > MAX_ASSETS_PER_WORKFLOW) {
      throw new Error(`Workflow '${key}' exceeds the 50 asset limit`);
    }
    for (const item of workflow.assets) {
      const asset = asRecord(item, `Workflow '${key}' asset`);
      const filename = requiredString(
        asset.filename,
        `Workflow '${key}' asset filename`,
      );
      if (
        filename.startsWith(".") ||
        filename.includes("/") ||
        filename.includes("\\")
      ) {
        throw new Error(`Workflow '${key}' has an unsafe asset filename`);
      }
      requiredString(asset.file_type, `Workflow '${key}' asset file type`);
      if (
        !Number.isInteger(asset.size_bytes) ||
        (asset.size_bytes as number) < 0 ||
        (asset.size_bytes as number) > MAX_FILE_BYTES
      ) {
        throw new Error(`Workflow '${key}' has an invalid asset size`);
      }
      if (
        typeof asset.content_hash !== "string" ||
        !/^[0-9a-f]{64}$/.test(asset.content_hash)
      ) {
        throw new Error(`Workflow '${key}' has an invalid asset hash`);
      }
      requiredString(
        asset.temporary_path,
        `Workflow '${key}' asset temporary path`,
      );
    }
  }
  return value as WorkflowCatalogSourceDocument;
}


export async function resolveWorkflowSourceCommit(_options: WorkflowCatalogSourceOptions = {}) { return { repository: 'local/legal-assistant-workflows', ref: 'bundled', commit: '0000000000000000000000000000000000000000' }; }
export async function prepareWorkflowCatalog(options: WorkflowCatalogSourceOptions = {}): Promise<PreparedWorkflowCatalog> {
 const directory = await mkdtemp(path.join(options.temporaryRoot ?? tmpdir(), 'legal-assistant-workflows-'));
 const prompts = [ ['proofread', 'Proofread', 'Review the selected documents for spelling, grammar, internal inconsistencies and ambiguous wording. Quote the relevant passage and propose a change.'], ['compare-documents', 'Compare documents', 'Compare the selected documents and explain substantive differences with exact citations.'], ['extract-key-terms', 'Extract key terms', 'Extract parties, effective dates, obligations, termination provisions and governing law from the selected documents. Cite each finding.'], ['draft-from-template', 'Draft from template', 'Use the chosen template and supplied facts to draft a document. Ask for missing facts; do not invent them.'] ];
 const workflows = prompts.map(([key, title, prompt], index) => ({ workflow_key: key, title, prompt_md: prompt, distribution: 'default' as const, type: 'assistant' as const,
 version: '1', description: title, columns_config: null, contributors: [], language: 'English', practice: null, jurisdictions: null, pack_key: null, pack_title: null, pack_description: null, pack_version: null,
 default_sort_order: index, quick_action_name: title, quick_action_prompt: prompt, document_upload: true, word_quick_action: key !== 'compare-documents', word_quick_action_prompt: prompt,
 assets: [], content_hash: createHash('sha256').update(prompt).digest('hex') }));
 const source = await resolveWorkflowSourceCommit(options);
 const document = validateWorkflowCatalogDocument({ source_repository: source.repository, source_ref: source.ref, source_commit: source.commit, workflows });
 const catalogPath = path.join(directory, 'workflow-catalog.json'); await writeFile(catalogPath, JSON.stringify(document), { mode: 0o600 });
 validateWorkflowCatalogDocument(JSON.parse(await readFile(catalogPath, 'utf8')));
 return { directory, catalogPath, archivePath: '', sourceCommit: source.commit };
}
export async function removePreparedWorkflowCatalog(prepared: Pick<PreparedWorkflowCatalog, 'directory'>): Promise<void> { await rm(prepared.directory, { recursive: true, force: true }); }
