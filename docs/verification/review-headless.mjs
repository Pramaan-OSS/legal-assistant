import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const origin = 'http://localhost:3105';
await mkdir('.data/verification', { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
 const context = await browser.newContext({ viewport: { width: 1142, height: 732 } });
 const outside = [];
 await context.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) { outside.push(url.origin); await route.abort(); }
  else await route.continue();
 });
 const page = await context.newPage();
 await page.goto(origin + '/login');
 await page.getByLabel('Email', { exact: true }).fill('verification@legal-assistant.test');
 await page.getByLabel('Password', { exact: true }).fill((await readFile('.data/verification/password', 'utf8')).trim());
 await page.getByRole('button', { name: 'Log in', exact: true }).click();
 await page.waitForURL(/onboarding|assistant|projects/, {timeout: 30000});
 const qualities = await context.request.get(origin + '/api/models/qualities');
 assert.equal(qualities.status(), 200);
 assert.deepEqual((await qualities.json()).models.map(m => m.id), ['fast', 'balanced', 'best']);
 await page.goto(origin + '/projects/8870d52b-4555-4a45-86fd-bcf5b1d19e44');
 await page.getByText('test.pdf', {exact: true}).first().waitFor();
 await page.locator('.workspace-island').waitFor();
 for (const [name, width, height, dark] of [['desktop-light',1142,732,false],['desktop-dark',1142,732,true],['mobile-light',400,800,false],['mobile-dark',400,800,true]]) {
  await page.setViewportSize({width,height});
  await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark);
  await page.waitForTimeout(400);
  assert(await page.evaluate(() => document.querySelector('.workspace-island').getBoundingClientRect().right <= innerWidth));
  assert((await page.locator('body').innerText()).includes('25 MB'));
  await page.screenshot({path:`.data/verification/review-headless-${name}.png`});
 }
 await page.setViewportSize({width:1142,height:732});
 await page.getByText('test.pdf', {exact:true}).first().click();
 await page.getByText('Test PDF Document', {exact:true}).waitFor({timeout:30000});
 await page.goto(origin + '/support?subject=Headless%20verification&message=Local%20fake%20check');
 await page.getByLabel('Subject', {exact:true}).waitFor();
 assert.equal(await page.getByLabel('Subject', {exact:true}).inputValue(), 'Headless verification');
 assert.equal(await page.getByLabel('Message', {exact:true}).inputValue(), 'Local fake check');
 await page.goto(origin + '/settings/connectors');
 for(const name of ['Files','Mail','Calendar','Team chat','Notes','Tables','Work tracking']) await page.getByRole('heading', {name,exact:true}).waitFor();
 assert.equal(outside.length, 0);
 console.log('Headless Playwright passed: local sign-in, neutral qualities, PDF preview, support prefill, seven connector cards, desktop/mobile light/dark bounds; outside browser requests: 0.');
} finally { await browser.close(); }
