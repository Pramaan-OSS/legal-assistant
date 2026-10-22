import { expect, test } from './fixtures';
test.use({ storageState: { cookies: [], origins: [] } });
for (const mode of ['complete', 'interrupted', 'length', 'configuration'] as const) {
 const interrupted = mode !== 'complete';
 test(`shows progressive assistant text and ${mode === 'complete' ? 'finishes once' : `handles ${mode} without repeating the request`}`, async ({ page }) => {
  const origin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000').origin;
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.fallback() : route.abort());
  await page.addInitScript(({ interrupted, mode }) => {
   const original = window.fetch.bind(window);
   const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } }));
   const chat = { id: 'reply-stream', title: 'Synthetic reply', user_id: 'synthetic', model: 'balanced', is_owner: true, access_role: 'owner', created_at: '2026-10-12' };
   const state = { runs: 0, finish: () => {} }; Object.assign(window, { replyCheck: state });
   window.fetch = (input, init) => {
    const path = new URL(input instanceof Request ? input.url : String(input), location.href).pathname;
    if (!path.startsWith('/api/')) return original(input, init);
    if (path === '/api/auth/session') return json({ user: { id: 'synthetic', email: 'synthetic@example.test' } });
    if (path === '/api/user/profile') return json({ onboardingComplete: true, displayName: 'Synthetic', lastSelectedChatModel: 'balanced' });
    if (path === '/api/user/api-keys') return json({ capability: true, sources: { capability: 'env' } });
    if (path.startsWith('/api/models/')) return json({ models: [] });
    if (path === '/api/chat/reply-stream') return json({ chat, is_owner: true, access_role: 'owner', messages: [{ id: 'seed', role: 'assistant', content: [{ type: 'content', text: 'Ready for a request.' }] }] });
    if (path === '/api/chat' && init?.method === 'POST') {
     state.runs++;
     return Promise.resolve(new Response(new ReadableStream({ start(controller) {
      const emit = (event: unknown) => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
      emit({ type: 'chat_id', chatId: chat.id, assistantMessageId: 'answer' });
      if (mode !== 'configuration') emit({ type: 'content_delta', text: 'First part of the reply.' });
      state.finish = () => {
       if (interrupted) emit({ type: 'error', message: mode === 'length' ? 'The reply reached its limit and is incomplete. Ask for a shorter reply and try again. No unfinished action was run.' : mode === 'configuration' ? 'The reply limit is too small. Ask for a shorter reply or increase the server reply limit before trying again.' : 'The reply stopped before it finished. The text shown is incomplete; no unfinished action was run.', safe_to_display: true });
       else emit({ type: 'content_delta', text: ' The reply is now complete.' });
       controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n')); controller.close();
      };
     } }), { headers: { 'Content-Type': 'text/event-stream' } }));
    }
    if (path === '/api/chat') return json([chat]); return json([]);
   };
  }, { interrupted, mode });
  await page.goto('/assistant/chat/reply-stream');
  await expect(page.getByText('Ready for a request.')).toBeVisible();
  await page.getByPlaceholder('How can I help?').fill('Review this.');
  await page.getByPlaceholder('How can I help?').press('Enter');
  await page.waitForFunction(() => (window as unknown as { replyCheck: { runs: number } }).replyCheck.runs === 1);
  if (mode !== 'configuration') await expect(page.getByText('First part of the reply.', { exact: true })).toBeVisible();
  await expect(page.getByText(/now complete/)).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { replyCheck: { finish(): void } }).replyCheck.finish());
  if (interrupted) {
   await expect(page.getByRole('main').getByText(mode === 'length' ? /reached its limit and is incomplete/ : mode === 'configuration' ? /reply limit is too small/ : /The text shown is incomplete/)).toBeVisible();
   if (mode !== 'configuration') await expect(page.getByText('First part of the reply.', { exact: true })).toBeVisible();
  } else await expect(page.getByText('First part of the reply. The reply is now complete.', { exact: true })).toBeVisible();
  await page.screenshot({ path: `.data/verification/assistant-stream-${mode}.png` });
  expect(await page.evaluate(() => (window as unknown as { replyCheck: { runs: number } }).replyCheck.runs)).toBe(1);
 });
}
