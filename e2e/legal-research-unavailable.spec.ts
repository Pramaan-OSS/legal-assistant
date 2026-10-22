import { expect, test } from './fixtures';
test.use({ storageState: { cookies: [], origins: [] } });
test('unavailable legal research stays visible and another request still works', async ({ page }) => {
 const origin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000').origin;
 await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.fallback() : route.abort());
 await page.addInitScript(() => {
  const original = window.fetch.bind(window);
  const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } }));
  const chat = { id: 'availability-check', title: 'Availability check', user_id: 'synthetic', model: 'balanced', is_owner: true, access_role: 'owner' };
  const state = { runs: 0 }; Object.assign(window, { availabilityCheck: state });
  window.fetch = (input, init) => {
   const path = new URL(input instanceof Request ? input.url : String(input), location.href).pathname;
   if (!path.startsWith('/api/')) return original(input, init);
   if (path === '/api/auth/session') return json({ user: { id: 'synthetic', email: 'synthetic@example.test' } });
   if (path === '/api/user/profile') return json({ onboardingComplete: true, displayName: 'Synthetic', lastSelectedChatModel: 'balanced' });
   if (path === '/api/user/api-keys') return json({ capability: true });
   if (path.startsWith('/api/models/')) return json({ models: [] });
   if (path === '/api/chat/availability-check') return json({ chat, is_owner: true, access_role: 'owner', messages: [{ id: 'seed', role: 'assistant', content: [{ type: 'content', text: 'Ready for a request.' }] }] });
   if (path === '/api/chat' && init?.method === 'POST') {
    state.runs++;
    const events: unknown[] = [{ type: 'chat_id', chatId: chat.id, assistantMessageId: `reply-${state.runs}` }];
    if (state.runs === 1) events.push({ type: 'case_law_verify_citations_start', citation_count: 1 }, { type: 'case_law_verify_citations', citation_count: 1, match_count: 0, error: 'This service is not available yet. You can keep working on this page.' });
    events.push({ type: 'content_delta', text: state.runs === 1 ? 'Legal sources could not be checked. You can still review your document.' : 'Document review remains available.' });
    return Promise.resolve(new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('')+'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } }));
   }
   if (path === '/api/chat') return json([chat]); return json([]);
  };
 });
 await page.goto('/assistant/chat/availability-check');
 const composer = page.getByPlaceholder('How can I help?');
 await composer.fill('Check this citation.'); await composer.press('Enter');
 await expect(page.getByRole('status').filter({ hasText: 'not available yet' })).toBeVisible();
 await expect(page.getByRole('button', { name: 'Could not complete' })).toBeVisible();
 await expect(page.getByText(/Completed in/)).toHaveCount(0);
 await expect(page.getByText(/You can still review your document/)).toBeVisible();
 await composer.fill('Continue with document review.'); await composer.press('Enter');
 await expect(page.getByText('Document review remains available.', { exact: true })).toBeVisible();
 expect(await page.evaluate(() => (window as unknown as { availabilityCheck: { runs: number } }).availabilityCheck.runs)).toBe(2);
 await page.screenshot({ path: '.data/verification/legal-research-unavailable.png' });
});
