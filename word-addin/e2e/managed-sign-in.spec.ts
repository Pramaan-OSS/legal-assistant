import { test, expect } from './support/fixtures';

for (const refused of [false,true]) test(`managed dialog email sign-in ${refused?'refuses an invalid return':'opens the existing return ticket'}`,async({page,baseURL})=>{
 const origin=new URL(baseURL!).origin;
 await page.addInitScript(()=>{Object.assign(window,{Office:{onReady:(callback:()=>void)=>callback(),context:{ui:{messageParent:(message:string,options:unknown)=>{Object.assign(window,{__SIGN_IN_RETURN__:{message,options}});}}}}});});
 await page.route('https://appsforoffice.microsoft.com/**',route=>route.fulfill({body:''}));
 await page.route('**/api/auth/options',route=>route.fulfill({json:{managed:true,authUrl:'https://managed.example.test',socialSignIn:false}}));
 await page.route('**/api/auth/managed/start',route=>route.fulfill({json:{state:'test-started-state'}}));
 await page.route('https://managed.example.test/**',route=>route.fulfill({headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Credentials':'true'},json:route.request().url().endsWith('/token')?{token:'test-signed-token'}:{user:{id:'signed-user'},session:{id:'signed-session'}}}));
 await page.route('**/api/auth/managed/redeem',route=>{expect(route.request().postDataJSON()).toEqual({state:'test-started-state',token:'test-signed-token',handoffRequestId:'request-id-123456'});return route.fulfill({status:refused?401:200,json:refused?{detail:'private upstream diagnostics'}:{handoffTicket:'a'.repeat(43)}});});
 await page.goto('/oauth-dialog.html?requestId=request-id-123456');
 await page.getByRole('textbox',{name:'Email',exact:true}).fill('reader@example.test');
 await page.getByLabel('Password',{exact:true}).fill('test-only-password');
 await page.getByRole('button',{name:'Sign in with email',exact:true}).click();
 if(refused){await expect(page.locator('#status')).toHaveText('Sign-in could not finish. Check your details and try again.');expect(await page.evaluate(()=>Object.hasOwn(window,'__SIGN_IN_RETURN__'))).toBe(false);}else{
 await expect(page.locator('#status')).toHaveText('Signed in. You can return to Word.');
 const returned=await page.evaluate(()=>Reflect.get(window,'__SIGN_IN_RETURN__') as {message:string;options:{targetOrigin:string}});
 expect(JSON.parse(returned.message)).toEqual({type:'legal-assistant-google-oauth',requestId:'request-id-123456',status:'success',handoffTicket:'a'.repeat(43)});expect(returned.options.targetOrigin).toBe(origin);expect(returned.message).not.toContain('test-signed-token');
 }
 expect(await page.evaluate(()=>sessionStorage.getItem('legal-assistant-word-managed-state'))).toBeNull();
});
