import { expect, test } from './fixtures';
test.use({ storageState: { cookies: [], origins: [] } });
test('shows account access before the hosted redirect and searches by keyword', async ({ page }) => {
 const origin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000').origin;
 await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.fallback() : route.abort());
 await page.route('**/consent-fixture', route => route.fulfill({ contentType: 'text/html', body: '<h1>Synthetic consent screen</h1>' }));
 let searched = false, connected = false, searchCount = 0;
 await page.route('**/api/**', async route => {
  const path = new URL(route.request().url()).pathname;
  let body: unknown = [];
  const connector = { id: 'owned', name: 'Mail', serverUrl: 'app:mail', enabled: true, readOnly: false, oauthConnected: true, tools: [] };
  if (path === '/api/auth/session') body = { user: { id: 'synthetic-user', email: 'synthetic@example.test' } };
  if (path === '/api/user/profile') body = { onboardingComplete: true, displayName: 'Synthetic', lastSelectedChatModel: 'balanced' };
  if (path.includes('assurance')) body = { currentLevel: 'aal1', nextLevel: 'aal1' };
  if (path === '/api/user/mcp-connectors') body = [connector];
  if (path.endsWith('/refresh-tools')) {
   searchCount++;
   expect(route.request().postDataJSON()).toEqual(searchCount === 1 ? { query: 'fetch emails' } : { query: 'fetch emails', cursor: 'page-two' });
   expect(route.request().headers()['content-type']).toContain('application/json'); searched = true; body = { ...connector, discovery: { query: 'fetch emails', ...(searchCount === 1 ? { nextCursor: 'page-two' } : {}) } };
  }
  if (path.includes('/oauth/start')) {
   const card = page.getByRole('heading', { name: 'Mail', exact: true }).locator('..');
   await expect(card.getByText(/full access to your Gmail/)).toBeVisible();
   await expect(card.getByText(/read your profile and contacts/)).toBeVisible();
   await expect(card.getByText(/fetch mail and labels through enabled actions/)).toBeVisible();
   connected = true; body = { authorizationUrl: `${origin}/consent-fixture` };
  }
  await route.fulfill({ json: body });
 });
 await page.goto('/settings/connectors');
 await expect(page.getByText(/about 10 minutes/)).toBeVisible();
 await expect(page.getByText(/may give this app full access to your Airtable/)).toBeVisible();
 await page.getByLabel('Search actions for Mail').fill('fetch emails');
 await page.getByRole('button', { name: 'Search actions', exact: true }).click();
 await expect.poll(() => searched).toBe(true);
 await expect(page.getByText(/New search pages use paid requests/)).toBeVisible();
 await expect(page.getByRole('button', { name: 'Load more actions' })).toBeVisible();
 expect(searchCount).toBe(1);
 await page.getByRole('button', { name: 'Load more actions' }).click();
 await expect(page.getByText('All results for this search are loaded.')).toBeVisible();
 expect(searchCount).toBe(2);
 await page.getByRole('button', { name: 'Search actions', exact: true }).click();
 await expect(page.getByText('All results for this search are loaded.')).toBeVisible();
 expect(searchCount).toBe(2);
 await page.screenshot({ path: '.data/verification/connected-app-access.png', fullPage: true });
 const card = page.getByRole('heading', { name: 'Mail', exact: true }).locator('..');
 await card.getByRole('button', { name: 'Reconnect', exact: true }).click();
 await expect(page.getByRole('heading', { name: 'Synthetic consent screen' })).toBeVisible();
 expect(connected).toBe(true);
});
