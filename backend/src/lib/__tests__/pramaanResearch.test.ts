import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setPramaanClientForTests, type PramaanClient } from '../pramaan';
import { readScannedPdf } from '../scannedPdf';
import { runPublicResearch } from '../../modules/chat/engine/tools/publicResearchTools';
const call = vi.fn();
beforeEach(() => { call.mockReset(); vi.stubEnv('PRAMAAN_API_KEY', 'fake-key'); setPramaanClientForTests({ call } as PramaanClient); });
afterEach(() => { setPramaanClientForTests(); vi.unstubAllEnvs(); });
it('keeps public research URLs while explicitly denying verified legal authority', async () => {
 call.mockResolvedValue({ results: [{ title: 'Public source', url: 'https://example.test/article', snippet: 'Text' }] });
 const result = JSON.parse(await runPublicResearch('search_public_sources', { query: 'case research' }));
 expect(result.verifiedLegalAuthority).toBe(false); expect(result.result.results[0].url).toBe('https://example.test/article');
 expect(call).toHaveBeenCalledWith('web.search', { query: 'case research' }, undefined);
});
it('rejects credential-bearing source URLs before calling a capability', async () => {
 expect(JSON.parse(await runPublicResearch('read_public_source', { url: 'https://user:secret@example.test/' })).ok).toBe(false);
 expect(call).not.toHaveBeenCalled();
});
it('marks scanned text and preserves incomplete extraction evidence', async () => {
 call.mockResolvedValue({ text: 'Recognized words', truncated: true });
 const result = await readScannedPdf(new Uint8Array([1, 2, 3]).buffer);
 expect(call).toHaveBeenCalledWith('document.parse', { content: 'AQID', extension: 'pdf', ocr: true }, undefined);
 expect(result).toContain('Text is incomplete'); expect(result).toContain('Check quotations');
});
it('keeps scans above 25 MB on local infrastructure without an outside call', async () => {
 expect(await readScannedPdf(new ArrayBuffer(25_000_001))).toBeNull(); expect(call).not.toHaveBeenCalled();
});
