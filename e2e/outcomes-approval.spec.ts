import { expect, test } from './fixtures';

test.use({ storageState: { cookies: [], origins: [] } });

for (const scenario of ['approve', 'reject', 'uncertain'] as const) {
  test(`shows the outcome estimate before ${scenario} and continues the existing approval flow`, async ({ page }) => {
    const decision = scenario === 'reject' ? 'reject' : 'approve';
    const origin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000').origin;
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.fallback() : route.abort());
    await page.addInitScript((mode) => {
      const original = window.fetch.bind(window);
      const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } }));
      const chat = { id: 'outcome-review', title: 'Public source review', user_id: 'synthetic-user', project_id: null, model: 'balanced', is_owner: true, access_role: 'owner', created_at: '2026-10-12T00:00:00Z' };
      const item = {
        id: 'approve-outcome', kind: 'approval', connector_name: 'Pramaan', tool_name: 'summarize_public_page', title: 'Summarize public page', arguments: { url: 'https://example.test/page' },
        binding: { type: 'outcome', outcome_id: 'page.summarize', plan: 'plan-1', input_hash: 'a'.repeat(64), prepared_at: Date.now() },
        estimate: { maximum_cost_usd: '0.039000', steps: ['Read the page', 'Summarize its text'], expires_at: new Date(Date.now() + 900000).toISOString() },
      };
      const ask = { type: 'ask_inputs', event_id: 'ask-outcome', items: [item] };
      let messages: unknown[] = [{ id: "seed-question", role: "user", content: "Hello" }, { id: "seed-answer", role: "assistant", content: [{ type: "content", text: "Ready for your request." }] }];
      const state = { runs: 0, decision: '' };
      Object.assign(window, { outcomeVerification: state });
      window.fetch = (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        const path = new URL(url, location.href).pathname;
        if (!path.startsWith('/api/')) return original(input, init);
        if (path === '/api/auth/session') return json({ user: { id: 'synthetic-user', email: 'synthetic@example.test' } });
        if (path === '/api/user/profile') return json({ onboardingComplete: true, displayName: 'Synthetic', lastSelectedChatModel: 'balanced' });
        if (path === '/api/user/api-keys') return json({ capability: true, sources: { capability: 'env' } });
        if (path.startsWith('/api/models/')) return json({ models: [] });
        if (path === '/api/chat/outcome-review') return json({ chat, is_owner: true, access_role: 'owner', messages });
        if (path === '/api/chat' && init?.method === 'POST') {
          const body = JSON.parse(String(init.body));
          const response = body.ask_inputs_response;
          const events: unknown[] = [{ type: 'chat_id', chatId: chat.id, assistantMessageId: 'answer-1' }];
          if (response) {
            state.decision = response.responses[0].decision;
            if (state.decision === 'approve') state.runs++;
            if (mode === 'uncertain' && state.decision === 'approve') events.push({type:'mcp_tool_start',name:'summarize_public_page'}, {type:'mcp_tool_result',name:'summarize_public_page',connector_name:'Pramaan',tool_name:'summarize_public_page',tool_title:'Summarize public page',status:'error',error:'The result is uncertain. Check before retrying.'});
            events.push({ type: 'content_delta', text: mode === 'uncertain' ? 'A partial report is available. Check before retrying.' : state.decision === 'approve' ? 'The checked summary is ready.' : 'The request was declined; nothing ran.' });
          } else {
            events.push(ask);
            messages = [{ id: 'question-1', role: 'user', content: 'Summarize this public page.' }, { id: 'answer-1', role: 'assistant', content: [ask] }];
          }
          return Promise.resolve(new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } }));
        }
        if (path === '/api/chat') return json([chat]);
        return json([]);
      };
    }, scenario);
    await page.setViewportSize(decision === 'approve' ? { width: 1142, height: 732 } : { width: 400, height: 800 });
    await page.goto('/assistant/chat/outcome-review');
    await expect(page.getByText('Ready for your request.')).toBeVisible();
    const input = page.getByPlaceholder('How can I help?');
    await expect(input).toBeVisible();
    await input.fill('Summarize this public page.');
    await input.press('Enter');
    await expect(page.getByText('Maximum cost: $0.039000 USD')).toBeVisible();
    await expect(page.getByText('Read the page', { exact: true })).toBeVisible();
    await expect(page.getByText('Summarize its text', { exact: true })).toBeVisible();
    await page.screenshot({ path: `.data/verification/outcome-estimate-${decision}.png` });
    expect(await page.evaluate(() => (window as unknown as { outcomeVerification: { runs: number } }).outcomeVerification.runs)).toBe(0);
    await page.getByRole('button', { name: decision === 'approve' ? 'Approve' : 'Reject', exact: true }).click();
    await expect(page.getByText(scenario === 'uncertain' ? 'A partial report is available. Check before retrying.' : decision === 'approve' ? 'The checked summary is ready.' : 'The request was declined; nothing ran.')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { outcomeVerification: { runs: number } }).outcomeVerification.runs)).toBe(decision === 'approve' ? 1 : 0);
    if (scenario === 'uncertain') { await expect(page.getByText('The result is uncertain. Check before retrying.', {exact:true})).toBeVisible(); await page.screenshot({path:'.data/verification/outcome-uncertain.png'}); }
  });
}
