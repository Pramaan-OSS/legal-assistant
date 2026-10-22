import { expect, test } from './fixtures';
test.use({ storageState: { cookies: [], origins: [] } });
test('failed extraction shows its reason and opens the existing retry action', async ({ page }) => {
 const origin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000').origin;
 await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.fallback() : route.abort());
 await page.addInitScript(() => {
  const original = window.fetch.bind(window);
  const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } }));
  window.fetch = (input, init) => {
   const path = new URL(input instanceof Request ? input.url : String(input), location.href).pathname;
   if (!path.startsWith('/api/')) return original(input, init);
   if (path === '/api/auth/session') return json({ user: { id: 'synthetic', email: 'synthetic@example.test' } });
   if (path === '/api/user/profile') return json({ onboardingComplete: true, displayName: 'Synthetic', lastSelectedChatModel: 'balanced' });
   if (path === '/api/user/api-keys') return json({ capability: true });
   if (path.startsWith('/api/models/')) return json({ models: [{ id: 'balanced', label: 'Balanced' }] });
   if (path === '/api/tabular-review/schema-check') return json({
    review: { id: 'schema-check', title: 'Request check', user_id: 'synthetic', model: 'balanced', is_owner: true, access_role: 'owner', document_grouping: 'document', columns_config: [{ index: 0, name: 'Clause', prompt: 'Read clause' }] },
    rows: [{ id: 'row-one', review_id: 'schema-check', row_type: 'document', label: 'Contract.txt', document_id: 'doc-one', source_document_ids: ['doc-one'], sort_index: 0 }],
    documents: [{ id: 'doc-one', filename: 'Contract.txt', file_type: 'txt', status: 'ready' }],
    cells: [{ id: 'failed-cell', row_id: 'row-one', document_id: 'doc-one', review_id: 'schema-check', column_index: 0, status: 'error', content: { summary: '', reasoning: 'The connected service refused this request.' } }],
   });
   return json([]);
  };
 });
 await page.goto('/tabular-reviews/schema-check');
 await expect(page.getByRole('alert').filter({ hasText: 'The connected service refused' })).toBeVisible();
 await page.getByRole('button', { name: 'Review and retry' }).click();
 await expect(page.getByRole('button', { name: /Regenerate/i })).toBeVisible();
 await page.screenshot({ path: '.data/verification/schema-failed-cell.png' });
});
