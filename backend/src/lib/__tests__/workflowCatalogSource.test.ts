import { describe, expect, it, vi } from 'vitest';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { prepareWorkflowCatalog, removePreparedWorkflowCatalog, validateWorkflowCatalogDocument } from '../workflowCatalogSource';
describe('bundled workflow catalogue', () => {
 it('loads local starter workflows without fetching an upstream catalogue', async () => {
  const directory = await mkdtemp(path.resolve('.catalog-test-')); const fetchImpl = vi.fn(() => { throw new Error('No network allowed.'); });
  try {
   const prepared = await prepareWorkflowCatalog({ temporaryRoot: directory, fetchImpl });
   const catalogue = validateWorkflowCatalogDocument(JSON.parse(await readFile(prepared.catalogPath,'utf8')));
   expect(catalogue.workflows.map(w => w.workflow_key)).toEqual(['proofread','compare-documents','extract-key-terms','draft-from-template']);
   expect(fetchImpl).not.toHaveBeenCalled();
   await removePreparedWorkflowCatalog(prepared); expect(await readdir(directory)).toEqual([]);
  } finally { await rm(directory,{recursive:true,force:true}); }
 });
 it('rejects malformed source metadata before database replacement', () => {
  expect(() => validateWorkflowCatalogDocument({source_repository:'local/workflows',source_ref:'bundled',source_commit:'bad',workflows:[]})).toThrow();
 });
 it('rejects repeated workflow keys', async () => {
  const prepared = await prepareWorkflowCatalog({ temporaryRoot: path.resolve('.') });
  try { const document = JSON.parse(await readFile(prepared.catalogPath,'utf8')); document.workflows.push(document.workflows[0]); expect(() => validateWorkflowCatalogDocument(document)).toThrow(); }
  finally { await removePreparedWorkflowCatalog(prepared); }
 });
});
