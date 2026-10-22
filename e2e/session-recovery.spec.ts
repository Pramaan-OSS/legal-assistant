import {test,expect} from './fixtures';
test.use({storageState:{cookies:[],origins:[]}});
test('a busy session check stays retryable without redirecting to login',async({page})=>{
 let checks=0;
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/api/auth/session')return ++checks===1?route.fulfill({status:429,json:{code:'rate_limited',detail:'Try again later.'}}):route.fulfill({json:{user:{id:'session-fixture',email:'session@example.test'}}});
  if(path==='/api/user/profile')return route.fulfill({json:{onboardingComplete:true,displayName:'Session fixture'}});
  return route.fulfill({json:[]});
 });
 await page.goto('/projects');
 await expect(page.getByRole('button',{name:'Retry session check'})).toBeVisible();
 await expect(page).toHaveURL(/\/projects$/);
 await page.getByRole('button',{name:'Retry session check'}).click();
 await expect(page.getByRole('heading',{name:'Projects',exact:true})).toBeVisible();
 expect(checks).toBeGreaterThanOrEqual(2);
});
