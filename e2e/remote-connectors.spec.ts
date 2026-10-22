import { expect, test } from './fixtures';
test.use({ storageState: { cookies: [], origins: [] } });
test('adds a remote service, lists approved actions and shows consent before hosted sign-in', async ({ page }) => {
 const origin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000').origin;
 await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.fallback() : route.abort());
 await page.route('**/remote-consent-fixture', route => route.fulfill({contentType:'text/html',body:'<h1>Synthetic remote consent</h1>'}));
 let added=false, listed=false, signedIn=false;
 const connector = {id:'remote-owned',name:'Remote service',serverUrl:'remote:',authType:'oauth',enabled:true,readOnly:false,oauthConnected:true,tools:[] as unknown[]};
 await page.route('**/api/**', async route => {
  const path=new URL(route.request().url()).pathname; let body:unknown=[];
  if(path==='/api/auth/session') body={user:{id:'synthetic-user',email:'synthetic@example.test'}};
  if(path==='/api/user/profile') body={onboardingComplete:true,displayName:'Synthetic',lastSelectedChatModel:'balanced'};
  if(path.includes('assurance')) body={currentLevel:'aal1',nextLevel:'aal1'};
  if(path==='/api/user/mcp-connectors') {
   if(route.request().method()==='POST') { expect(route.request().postDataJSON()).toEqual({name:'Remote service',serverUrl:'https://tools.example.test/mcp',authType:'none'}); added=true; body={connector,oauthRequired:false}; }
   else body=added?[connector]:[];
  }
  if(path.endsWith('/refresh-tools')) { listed=true; connector.tools=[{id:'remote-tool',title:'Remote action',description:'Read public resources by topic.',enabled:true,write:true}]; body={...connector,discovery:{query:'Remote actions'}}; }
  if(path.includes('/oauth/start')) {
   await expect(page.getByText(/Its actions may read, change, send or delete/)).toBeVisible();
   await expect(page.getByText(/every remote action waits for your approval/)).toBeVisible();
   signedIn=true; body={authorizationUrl:`${origin}/remote-consent-fixture`};
  }
  await route.fulfill({json:body});
 });
 await page.goto('/settings/connectors');
 await expect(page.getByText(/Custom credential headers, token entry/)).toBeVisible();
 await page.getByLabel('Remote service address').fill('https://tools.example.test/mcp');
 await page.getByLabel('Remote sign-in').selectOption('none');
 await page.getByRole('button',{name:'Add remote service'}).click();
 await expect(page.getByRole('button',{name:'Load remote actions'})).toBeVisible(); expect(added).toBe(true);
 await page.getByRole('button',{name:'Load remote actions'}).click();
 await expect(page.getByText('Remote action · review required')).toBeVisible(); expect(listed).toBe(true);
 await expect(page.getByText(/Limiting to reads blocks all remote actions/)).toBeVisible();
 await page.screenshot({path:'.data/verification/remote-connectors.png',fullPage:true});
 // Change only the synthetic platform state; the query string is never used as authority.
 connector.oauthConnected=false;
 await page.reload();
 await page.getByRole('button',{name:'Continue remote sign-in'}).click();
 await expect(page.getByRole('heading',{name:'Synthetic remote consent'})).toBeVisible(); expect(signedIn).toBe(true);
});
