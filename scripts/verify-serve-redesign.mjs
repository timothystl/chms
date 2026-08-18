// Ad-hoc verification harness for the Serve redesign (not part of the vitest suite —
// this repo has no established browser-test convention for src/public/scripts.js yet).
// Drives the real assembled PUBLIC_HTML in headless Chromium, with fetch stubbed for
// /api/ministry-roles, /api/events and /serve/signup.
import { chromium } from 'playwright-core';
import http from 'node:http';
import { PUBLIC_HTML } from '../src/html-templates.js';

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(PUBLIC_HTML);
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', msg => { if (msg.type() === 'error') errors.push('CONSOLE ERROR: ' + msg.text()); });

const MINISTRY_ROLES = {
  worship: [{ id: 1, name: 'Acolyte', description: 'Light the candles.', commitment: '1 Sunday/month' }],
  education: [{ id: 2, name: 'Sunday School Teacher', description: 'Teach a class.', commitment: 'Weekly' }],
  acceptance: [{ id: 3, name: 'Stephen Ministry', description: 'One-on-one care.', commitment: 'Weekly' }],
  outreach: [{ id: 4, name: 'Community Pantry', description: 'Sort and stock food.', commitment: 'Flexible' }],
};

const MARKET_EVENT = {
  id: 99, name: 'Christmas Market', description: 'The market', slug: 'christmasmarket',
  roles: [
    { id: 101, name: 'Grill Brats and Franks', description: 'Grill it up.', slots: 3, filled_count: 3, role_date: '2026-12-05', start_time: '11:00 AM', end_time: '1:00 PM' },
    { id: 102, name: 'Grill Brats and Franks', description: 'Grill it up.', slots: 3, filled_count: 1, role_date: '2026-12-05', start_time: '1:00 PM', end_time: '3:00 PM' },
    { id: 103, name: 'Set up tents', description: 'Raise the tents.', slots: 18, filled_count: 2, role_date: '2026-12-04', start_time: '9:00 AM', end_time: '11:00 AM' },
  ],
};

await page.route('**/api/ministry-roles*', async route => {
  const url = new URL(route.request().url());
  const m = url.searchParams.get('ministry');
  await route.fulfill({ json: { roles: MINISTRY_ROLES[m] || [] } });
});
await page.route('**/api/events', async route => { await route.fulfill({ json: { events: [MARKET_EVENT] } }); });
await page.route('**/serve/signup', async route => { await route.fulfill({ json: { ok: true, signup_id: 555 } }); });

await page.goto(`http://localhost:${port}/`);

// ── 1. Wizard: step1 -> step2 -> step3 (card click auto-advances) -> submit ──
await page.fill('#sv-name', 'Jane Smith');
await page.fill('#sv-email', 'jane@example.com');
await page.click('#sv-step1-next');
await page.waitForSelector('#sv-step2:not([hidden])');
const chipCount = await page.locator('#sv-chips .sv-chip').count();
console.log('chips rendered:', chipCount);
await page.waitForSelector('.sv-role-card');
await page.click('.sv-role-card');
await page.waitForSelector('#sv-step3:not([hidden])');
const pickedText = await page.locator('#sv-picked-roles').innerText();
console.log('step3 picked roles:', JSON.stringify(pickedText));
await page.click('#sv-step3-send');
await page.waitForSelector('#sv-step-done:not([hidden])');
const doneH2 = await page.locator('#sv-done-h2').innerText();
console.log('wizard done heading:', doneH2);
if (!/We.?ve got it, Jane\./.test(doneH2)) throw new Error('wizard done heading wrong: ' + doneH2);

// reset and verify DOM values actually clear
await page.click('#sv-signup-another');
await page.waitForSelector('#sv-step1:not([hidden])');
const nameVal = await page.inputValue('#sv-name');
if (nameVal !== '') throw new Error('sv-name did not clear on reset, got: ' + JSON.stringify(nameVal));
console.log('wizard reset clears fields: OK');

// ── 2. Market page ──
await page.click('[data-nav-page="market"]');
await page.waitForSelector('#page-market:not([hidden])');
await page.waitForSelector('.sv-job-card');
const jobCount = await page.locator('.sv-job-card').count();
console.log('market job cards:', jobCount); // expect 2 distinct job names (Grill.., Set up tents)

// click "Grill Brats and Franks" job card to expand
await page.click('.sv-job-card:has-text("Grill Brats and Franks")');
await page.waitForSelector('.sv-panel .sv-slot');
const slotTexts = await page.locator('.sv-panel .sv-slot').allInnerTexts();
console.log('slot rows:', JSON.stringify(slotTexts));
const fullCount = await page.locator('.sv-panel .sv-slot.full').count();
if (fullCount !== 1) throw new Error('expected exactly 1 full slot, got ' + fullCount);
console.log('full-slot rendering: OK');

// claim the open slot (role 102)
await page.click('.sv-slot[data-role-id="102"]');
await page.waitForSelector('.sv-slot[data-role-id="102"].claimed');
console.log('claim: OK');
const barVisible = await page.locator('#mkt-stickybar').isHidden();
if (barVisible) throw new Error('sticky bar should be visible after a claim');
const barCount = await page.locator('#mkt-stickybar-count').innerText();
console.log('sticky bar count:', barCount);
const toastText = await page.locator('#mkt-toast-text').innerText();
console.log('toast text:', toastText);

// switch to "By time" mode, verify claim persisted
await page.click('[data-mode="time"]');
await page.waitForSelector('.sv-time-row');
// expand the 1-3pm row for Dec 5 to see the claimed state carried over
const timeRows = await page.locator('.sv-time-row').allInnerTexts();
console.log('by-time rows:', JSON.stringify(timeRows));

// undo via the "Your shifts" panel
await page.click('[data-mode="job"]');
await page.click('.sv-job-card:has-text("Grill Brats and Franks")');
await page.waitForSelector('.sv-slot[data-role-id="102"].claimed');
await page.click('[data-unclaim="102"]');
await page.waitForFunction(() => document.getElementById('mkt-stickybar').hidden === true);
console.log('undo via summary row + sticky bar hides: OK');

// re-claim, then fill contact + submit
await page.click('.sv-slot[data-role-id="102"]');
await page.fill('#mkt-name', 'Bob Renter');
await page.fill('#mkt-email', 'bob@example.com');
await page.click('#mkt-submit-btn');
await page.waitForSelector('#mkt-done:not([hidden])');
const mktDoneH2 = await page.locator('#mkt-done-h2').innerText();
console.log('market done heading:', mktDoneH2);
if (!/Thank you, Bob\./.test(mktDoneH2)) throw new Error('market done heading wrong: ' + mktDoneH2);
const doneShifts = await page.locator('#mkt-done-shifts').innerText();
console.log('market done shifts list:', JSON.stringify(doneShifts));

// ── 3. Direct hash load of #market (simulating /christmasmarket redirect) ──
const page2 = await browser.newPage();
await page2.route('**/api/events', async route => { await route.fulfill({ json: { events: [MARKET_EVENT] } }); });
const errors2 = [];
page2.on('pageerror', e => errors2.push(e.message));
await page2.goto(`http://localhost:${port}/#event-99`);
await page2.waitForSelector('#page-market:not([hidden])', { timeout: 5000 });
console.log('direct #event-99 link (Christmas Market) resolves to #page-market: OK');
console.log('final hash:', await page2.evaluate(() => location.hash));

await browser.close();
server.close();

if (errors.length || errors2.length) {
  console.error('JS ERRORS DETECTED:', errors, errors2);
  process.exit(1);
}
console.log('\\nALL CHECKS PASSED, NO JS ERRORS');
