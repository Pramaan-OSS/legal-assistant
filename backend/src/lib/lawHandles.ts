import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
/** Stable app-owned numeric handles preserve existing case annotations without exposing upstream ids. */
const root = () => path.resolve(process.env.LEGAL_HANDLE_ROOT ?? '.data/law-handles');
export async function rememberLawHandle(ref: string): Promise<number> {
  const id = Number.parseInt(createHash('sha256').update(ref).digest('hex').slice(0, 12), 16);
  await fs.mkdir(root(), { recursive: true, mode: 0o700 });
  const file = path.join(root(), String(id));
  try { await fs.writeFile(file, ref, { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    if (await fs.readFile(file, 'utf8') !== ref) throw new Error('Legal reference conflict.');
  }
  return id;
}
export async function resolveLawHandle(id: number): Promise<string> {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Choose a case returned by legal search.');
  try { return await fs.readFile(path.join(root(), String(id)), 'utf8'); }
  catch { throw new Error('Search or verify this case again before opening it.'); }
}
