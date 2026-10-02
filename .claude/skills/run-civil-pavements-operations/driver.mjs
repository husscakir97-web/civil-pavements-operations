// Usage: node .claude/skills/run-civil-pavements-operations/driver.mjs [baseUrl] [outDir]
// Signs up a fresh user (EMAIL_ENABLED=false => instant session), then screenshots key pages.
import {chromium} from 'playwright-core';
import {mkdirSync} from 'node:fs';
const base = process.argv[2] || 'http://localhost:3100';
const out = process.argv[3] || '/tmp/run-shots';
mkdirSync(out, {recursive: true});
const email = `driver-${Date.now()}@example.invalid`;
const browser = await chromium.launch({executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox']});
const page = await browser.newPage({viewport: {width: 1440, height: 900}});
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto(base + '/login');
await page.screenshot({path: `${out}/login.png`});
// Sign up through the API from the page context so the session cookie lands in the browser.
const res = await page.evaluate(async email => (await fetch('/api/auth/sign-up/email', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({name: 'Driver', email, password: 'Very-strong-test-password-42'})})).status, email);
console.log('signup status', res);
await page.goto(base + '/');
await page.getByText('Skip setup and go to the workspace').click(); // onboarding wizard
await page.waitForSelector('text=Good morning', {timeout: 15000}).catch(() => {});
// The app is a single page ('/'); sections are sidebar buttons, not routes.
for (const name of ['Home', 'CRM', 'Pipeline', 'Projects', 'Schedule', 'Resources', 'Commercial', 'IMS & HSEQ', 'Documents', 'Reports', 'Admin']) {
  await page.locator('aside').getByText(name, {exact: true}).first().click();
  await page.waitForTimeout(1500);
  console.log(name, '|', (await page.locator('main').first().innerText()).slice(0, 60).replace(/\n/g, ' '));
  await page.screenshot({path: `${out}/${name.replace(/\W+/g, '-').toLowerCase()}.png`});
}
console.log('page errors:', errors.length ? errors : 'none');
await browser.close();
