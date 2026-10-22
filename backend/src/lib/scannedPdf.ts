import { callCapability, uploadPlatformFile, removePlatformFile } from './pramaan';
import { bestEffort } from './observability/diagnostics';
export async function readScannedPdf(bytes: ArrayBuffer): Promise<string | null> {
 if (!process.env.PRAMAAN_API_KEY || bytes.byteLength > 25_000_000) return null;
 let fileId: string | undefined;
 try {
  const source = bytes.byteLength <= 10_485_760 ? { content: Buffer.from(bytes).toString('base64') } : { fileId: fileId = await uploadPlatformFile(new Uint8Array(bytes), 'application/pdf') };
  const result = await callCapability('document.parse', { ...source, extension: 'pdf', ocr: true });
  if (!result.text.trim()) return null;
  return `[Text read from scanned pages. Check quotations against the original document.${result.truncated ? ' Text is incomplete because extraction reached its limit.' : ''}]\n\n${result.text}`;
 } catch { return null; }
 finally { if (fileId) await bestEffort(removePlatformFile(fileId), { what: 'scan-stage-cleanup' }); }
}
