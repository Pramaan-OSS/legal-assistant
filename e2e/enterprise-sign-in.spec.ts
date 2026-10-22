import {expect,test} from './fixtures';
test.use({storageState:{cookies:[],origins:[]}});
test('an administrator configures organization sign-in and a member starts the hosted flow',async({page})=>{
 const origin=new URL(process.env.PLAYWRIGHT_BASE_URL??'http://localhost:3000').origin;
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.fallback():route.abort());
 await page.route('**/enterprise-consent-fixture',route=>route.fulfill({contentType:'text/html',body:'<h1>Synthetic organization consent</h1>'}));
 let created=false,listed=false,started=false;
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;let body:unknown=[];
  if(path==='/api/auth/session')body={user:{id:'synthetic-user',email:'synthetic@example.test'}};
  if(path==='/api/user/profile')body={onboardingComplete:true,displayName:'Synthetic',lastSelectedChatModel:'balanced'};
  if(path.includes('assurance'))body={currentLevel:'aal1',nextLevel:'aal1'};
  if(path==='/api/orgs/org-one')body={id:'org-one',name:'Synthetic organization',role:'admin'};
  if(path==='/api/orgs/org-one/sign-in-connections'){
   if(route.request().method()==='POST'){expect(route.request().postDataJSON()).toEqual({issuer:'https://identity.example.test',clientId:'public-client',tokenAuthMethod:'none'});created=true;body={id:'connection-one',organizationId:'org-one'};}
   else{listed=true;body={results:created?[{id:'connection-one',name:'Organization sign-in'}]:[]};}
  }
  if(path==='/api/auth/enterprise/start'){
   expect(route.request().postDataJSON()).toEqual({organizationId:'org-one',connectionId:'connection-one'});started=true;body={url:`${origin}/enterprise-consent-fixture`};
  }
  await route.fulfill({json:body});
 });
 await page.goto('/organizations/org-one/sign-in');
 await expect(page.getByText(/SAML is not covered/)).toBeVisible();
 await page.getByLabel('Issuer address').fill('https://identity.example.test');await page.getByLabel('Client identifier').fill('public-client');
 await page.getByRole('button',{name:'Save connection'}).click();await expect(page.getByText('Connection code: connection-one',{exact:true})).toBeVisible();expect(created&&listed).toBe(true);
 await page.goto('/login/sso');await expect(page.getByText(/Your email address does not link accounts/)).toBeVisible();await page.getByLabel('Organization code').fill('org-one');await page.getByLabel('Connection code',{exact:true}).fill('connection-one');
 await page.screenshot({path:'.data/verification/enterprise-sign-in.png',fullPage:true});
 await page.getByRole('button',{name:'Continue organization sign-in'}).click();await expect(page.getByRole('heading',{name:'Synthetic organization consent'})).toBeVisible();expect(started).toBe(true);
});
