import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
const origin = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
mkdirSync('.scratch/verification', { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.route('**/*', route => ['localhost','127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
try {
 await page.goto(`${origin}/login`);
 if (process.argv.includes('--no-key')) {
   await page.getByRole('status').filter({hasText:'Add PRAMAAN_API_KEY to .env'}).waitFor();
   await page.screenshot({path:'.scratch/verification/zero-no-key.png'});
   console.log('PASS: no-key instruction and local login render.');
 } else {
   await page.goto(`${origin}/signup`);
   await page.getByText(/Connected sign-in is not set up yet/).waitFor();
   const email=`reader-${Date.now()}@example.test`;
   await page.getByLabel('Email',{exact:true}).fill(email);
   await page.getByLabel('Password',{exact:true}).fill('Local-check-passphrase-123!');
   await page.getByLabel('Confirm Password',{exact:true}).fill('Local-check-passphrase-123!');
   const responsePromise=page.waitForResponse(r=>r.url().endsWith('/api/auth/signup'));
   await page.getByRole('button',{name:'Sign up',exact:true}).click();
   const response=await responsePromise;
   assert.ok(response.ok(),`Signup failed: ${response.status()} ${await response.text()}`);
   let link;
   for(let attempt=0;attempt<20&&!link;attempt++) {
     const mailbox=await (await fetch('http://localhost:8025/api/v1/messages')).json();
     for(const message of mailbox.messages ?? []) {
       if(!(message.To ?? []).some(to=>to.Address===email)) continue;
       const detail=await (await fetch(`http://localhost:8025/api/v1/message/${message.ID}`)).json();
       link=detail.Text?.match(/http:\/\/localhost:3000\/auth\/confirm\?[^\s<]+/)?.[0];
     }
     if(!link) await new Promise(resolve=>setTimeout(resolve,500));
   }
   assert.ok(link,'Local confirmation mail was not delivered');
   await page.goto(link);
   await page.getByLabel('Name',{exact:true}).fill('Local reader');
   await page.getByRole('button',{name:'Continue',exact:true}).click();
   await page.getByRole('button',{name:'Skip',exact:true}).click();
   await page.goto(`${origin}/assistant`);
   const input=page.getByPlaceholder('How can I help?');
   await input.fill('Review my workspace.');
   await input.press('Enter');
   await page.getByText('This is a local demonstration reply. Your workspace is ready.',{exact:true}).waitFor({timeout:30000});
   await page.screenshot({path:'.scratch/verification/zero-reply.png'});
   console.log('PASS: local signup, mailbox confirmation, onboarding and offline reply.');
 }
} finally {await browser.close();}
