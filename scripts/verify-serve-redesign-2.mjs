import { chromium } from 'playwright-core';
import http from 'node:http';
import { PUBLIC_HTML } from '../src/html-templates.js';

const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(PUBLIC_HTML); });
await new Promise(r => server.listen(0, r));
const port = server.address().port;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage();

const MARKET_EVENT = {
  id: 99, name: 'Christmas Market',
  roles: [
    { id: 101, name: 'Cashiers', description: '', slots: 2, filled_count: 0, role_date: '2026-12-05', start_time: '10:30 AM', end_time: '12:30 PM' },
    { id: 102, name: 'Trash', description: '', slots: 1, filled_count: 0, role_date: '2026-12-05', start_time: '11:00 AM', end_time: '1:00 PM' },
  ],
};
await page.route('**/api/events', r => r.fulfill({ json: { events: [MARKET_EVENT] } }));
await page.route('**/api/ministry-roles*', r => r.fulfill({ json: { roles: [] } }));

await page.goto(`http://localhost:${port}/`);

// header CTA starts as "Start"
console.log('cta label on landing:', await page.locator('#sv-header-cta').innerText());

// step1 validation: empty name/email should NOT advance and should show error
await page.click('#sv-step1-next');
const err = await page.locator('#sv-step1-error').innerText();
console.log('step1 empty validation error:', JSON.stringify(err));
const stillStep1 = await page.locator('#sv-step1').isHidden();
if (stillStep1) throw new Error('step1 should still be visible after failed validation');

// go to market, check cta swaps to "Take a shift"
await page.click('[data-nav-page="market"]');
await page.waitForSelector('#page-market:not([hidden])');
console.log('cta label on market:', await page.locator('#sv-header-cta').innerText());

// by-day mode
await page.click('[data-mode="day"]');
await page.waitForSelector('.sv-day-pill');
const pills = await page.locator('.sv-day-pill').allInnerTexts();
console.log('day pills:', JSON.stringify(pills));
const dayRows = await page.locator('#mkt-mode-body .sv-slot').count();
console.log('by-day slot rows for default day:', dayRows);

// market: submit with no shifts -> shift error, no name error
await page.click('#mkt-submit-btn');
const shiftErr = await page.locator('#mkt-shift-error').innerText();
console.log('no-shift submit error:', JSON.stringify(shiftErr));
const whoErrEmpty = await page.locator('#mkt-who-error').innerText();
console.log('who-error should be empty:', JSON.stringify(whoErrEmpty));

await browser.close();
server.close();
console.log('\\nEXTRA CHECKS DONE');
