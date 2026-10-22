import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { CapabilityCallError, setPramaanClientForTests, setPlatformFileTransportForTests, type PramaanClient } from '../pramaan';
import { uploadFile, downloadFile, REMOTE_FILE_LIMIT, getSignedUrl, writeBlobFromStream } from '../storage';
let root: string;
const call = vi.fn(); const upload = vi.fn(); const remove = vi.fn();
beforeEach(async () => {
 root = await mkdtemp(path.resolve('.storage-test-')); vi.stubEnv('STORAGE_FS_ROOT', root); vi.stubEnv('PRAMAAN_API_KEY', 'fake-key');
 call.mockReset().mockResolvedValue({}); upload.mockReset().mockResolvedValue('file_test'); remove.mockReset().mockResolvedValue(undefined);
 setPramaanClientForTests({ call } as PramaanClient);
 setPlatformFileTransportForTests({ upload, remove, read: vi.fn() });
});
afterEach(async () => { setPramaanClientForTests(); setPlatformFileTransportForTests(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });
it('stores whole small bytes with their real media type and stable action key', async () => {
 const bytes = new Uint8Array([1, 2, 3]);
 await uploadFile('documents/u/d/source.pdf', bytes.buffer, 'application/pdf');
 await uploadFile('documents/u/d/source.pdf', bytes.buffer, 'application/pdf');
 expect(call.mock.calls[0][0]).toBe('storage.object.put');
 expect(call.mock.calls[0][1]).toMatchObject({ content: 'AQID', contentType: 'application/pdf' });
 expect(call.mock.calls[0][2]).toEqual(call.mock.calls[1][2]); expect(upload).not.toHaveBeenCalled();
});
it('stages the whole file at exactly 25 MB and falls back locally when larger storage is refused', async () => {
 await uploadFile('documents/u/d/source.pdf', new ArrayBuffer(REMOTE_FILE_LIMIT), 'application/pdf');
 expect(upload).toHaveBeenCalledOnce(); expect(upload.mock.calls[0][0].length).toBe(REMOTE_FILE_LIMIT);
 expect(call.mock.calls[0][1]).toMatchObject({ fileId: 'file_test', contentType: 'application/pdf' }); expect(remove).toHaveBeenCalledWith('file_test');
 call.mockClear(); upload.mockClear(); call.mockRejectedValueOnce({ code: 'connection_required' });
 await uploadFile('documents/u/d/large.pdf', new ArrayBuffer(REMOTE_FILE_LIMIT + 1), 'application/pdf');
 expect(call).toHaveBeenCalledExactlyOnceWith('storage.upload.create', expect.anything(), expect.anything()); expect(upload).not.toHaveBeenCalled();
 expect((await downloadFile('documents/u/d/large.pdf'))?.byteLength).toBe(REMOTE_FILE_LIMIT + 1);
});
it('returns an app-owned download descriptor, without a signed or vendor URL', async () => {
 expect(await getSignedUrl('documents/u/d/source.pdf')).toMatch(/^\/download\/[A-Za-z0-9_-]+$/);
});
it('rejects oversized request bytes while leaving the request readable for an HTTP error', async () => {
 const body = new PassThrough({ autoDestroy: false }); body.end(Buffer.alloc(4));
 await expect(writeBlobFromStream('upload-sessions/u/source.pdf', body, 3)).rejects.toThrow('expected file');
 expect(body.destroyed).toBe(false);
 expect(await downloadFile('upload-sessions/u/source.pdf')).toBeNull();
});

it.each(['upstream_unavailable','connection_required','forbidden','spend_cap_reached'])('keeps a refused small upload on private disk: %s',async code=>{
 call.mockRejectedValueOnce({code});const bytes=new Uint8Array([1,2,3]);
 await uploadFile('documents/u/refused/source.pdf',bytes.buffer,'application/pdf');
 expect(await downloadFile('documents/u/refused/source.pdf')).toEqual(bytes.buffer);
 expect(call).toHaveBeenCalledOnce();
});
it('keeps a staged small upload on private disk when file staging is unavailable',async()=>{
 upload.mockRejectedValueOnce(new CapabilityCallError('upstream_unavailable'));
 await uploadFile('documents/u/staged/source.pdf',new ArrayBuffer(2_000_000),'application/pdf');
 expect((await downloadFile('documents/u/staged/source.pdf'))?.byteLength).toBe(2_000_000);expect(call).not.toHaveBeenCalled();
});
it('keeps an invalid storage contract failed rather than pretending it used connected storage',async()=>{
 call.mockRejectedValueOnce({code:'invalid_request'});
 await expect(uploadFile('documents/u/invalid/source.pdf',new ArrayBuffer(3),'application/pdf')).rejects.toMatchObject({code:'invalid_request'});
 expect(await downloadFile('documents/u/invalid/source.pdf')).toBeNull();
});
