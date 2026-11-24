import puppeteer from 'puppeteer-core';
import { randomUUID } from 'node:crypto';

const BASE = 'http://localhost:5173';
const API = 'http://localhost:8080';
const RUN = randomUUID().slice(0, 6);
const T1 = `e2e-${RUN}`, T2 = `e2e-other-${RUN}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };

const post = (tenantId, learnerId, type, step, message, labId = 'lab-bicep-basics') =>
  fetch(`${API}/events`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': 'dev-ingest-key' },
    body: JSON.stringify({ type, tenantId, labId, learnerId, step, message, occurredAt: new Date().toISOString(), idempotencyKey: randomUUID() }) }).then((r) => r.json());

const text = (page, sel) => page.$$eval(sel, (els) => els.map((e) => e.textContent.trim()));
const waitFor = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(100); } return false; };

async function login(browser, { tenantId, tenantName, userId, role }) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(BASE);
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await page.waitForSelector('.login');
  const inputs = await page.$$('.login input');
  for (const [i, v] of [[0, tenantId], [1, tenantName], [2, userId]]) {
    await inputs[i].focus(); await page.keyboard.press('End');
    for (let k = 0; k < 60; k++) await page.keyboard.press('Backspace');
    await inputs[i].type(v);
  }
  await page.select('.login select', role);
  await page.evaluate(() => [...document.querySelectorAll('button.primary')].find((b) => b.textContent === 'Sign in').click());
  await page.waitForSelector('.app');
  page.errors = errors;
  return page;
}

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox'] });
try {
  const inst = await login(browser, { tenantId: T1, tenantName: 'E2E Corp', userId: 'inst-1', role: 'instructor' });
  check('tenant name from the token is shown', (await text(inst, '.tenant'))[0] === 'E2E Corp');
  check('connection indicator reaches Live', await waitFor(async () => (await text(inst, '.conn'))[0]?.startsWith('Live')), (await text(inst, '.conn'))[0]);

  await post(T1, 'learner-1', 'lab.started', 'Create main.bicep', 'Lab started');
  await post(T1, 'learner-1', 'step.completed', 'Create main.bicep', 'done');
  await post(T1, 'learner-2', 'lab.started', 'Create main.bicep', 'Lab started', 'lab-bicep-modules');
  check('live grid renders learners', await waitFor(async () => (await text(inst, 'tbody tr')).length === 2), `${(await text(inst, 'tbody tr')).length} rows`);
  await post(T2, 'other-tenant-learner', 'lab.started', 'x', 'other tenant event');
  await sleep(600);
  check("another tenant's event never appears", !(await text(inst, 'tbody')).join().includes('other-tenant-learner'));

  for (let i = 0; i < 3; i++) await post(T1, 'learner-1', 'lab.error', 'Deploy the Bicep file', `InvalidTemplate attempt ${i}`);
  check('alert appears in the feed', await waitFor(async () => (await text(inst, '.alerts li')).length === 1), (await text(inst, '.alerts li'))[0]?.slice(0, 80));
  check('unread badge = 1 and tab title shows it', (await text(inst, '.bell .badge'))[0] === '1' && (await inst.title()) === '(1) LabPulse', await inst.title());
  const status = await inst.$$eval('tbody tr', (rows) => rows.map((r) => r.children[0].textContent + ':' + r.children[1].textContent));
  check('learner-1 status is Error', status.includes('learner-1:Error'), status.join(' '));
  await inst.click('.bell');
  check('mark-read clears the badge', await waitFor(async () => (await inst.$('.bell .badge')) === null) && (await inst.title()) === 'LabPulse');

  await inst.select('.toolbar select', 'lab-bicep-modules');
  const filtered = await text(inst, 'tbody tr');
  check('lab filter works', filtered.length === 1 && filtered[0].startsWith('learner-2'), filtered.join('|'));
  await inst.select('.toolbar select', 'all');

  const evBefore = Number((await text(inst, '.toolbar .muted'))[0].match(/(\d+) events/)[1]);
  await inst.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Simulate drop').click());
  const leftLive = await waitFor(async () => !(await text(inst, '.conn'))[0].startsWith('Live'), 3000);
  for (let i = 0; i < 4; i++) await post(T1, `late-${i}`, 'lab.started', 'Create main.bicep', 'while offline');
  check('indicator showed the drop (left "Live")', leftLive, (await text(inst, '.conn'))[0]);
  check('reconnects and is Live again', await waitFor(async () => (await text(inst, '.conn'))[0].startsWith('Live'), 12000));
  check('missed learners caught up (6 rows)', await waitFor(async () => (await text(inst, 'tbody tr')).length === 6, 8000), `${(await text(inst, 'tbody tr')).length} rows`);
  await sleep(500);
  const evAfter = Number((await text(inst, '.toolbar .muted'))[0].match(/(\d+) events/)[1]);
  check('exactly +4 events after catch-up (no duplicates)', evAfter - evBefore === 4, `${evBefore} -> ${evAfter}`);
  await inst.screenshot({ path: '/tmp/pdfx/dashboard.png' });

  const ask = async (page, q) => {
    const n0 = (await page.$$('.assistant .msg.assistant')).length;
    await page.type('.assistant input', q);
    await page.click('.assistant button.primary');
    await waitFor(async () => (await page.$$('.assistant .msg.assistant')).length > n0);
    await sleep(300);
    await waitFor(async () => !(await page.$eval('.assistant input', (i) => i.disabled)), 20000);
    return page.$$eval('.assistant .msg.assistant', (m) => { const l = m[m.length - 1]; return { text: l.querySelector('.bubble').textContent, tag: l.querySelector('.tag')?.textContent, cites: [...l.querySelectorAll('.cites li')].map((x) => x.textContent) }; });
  };
  const a1 = await ask(inst, 'How do I restrict a parameter to allowed values?');
  check('assistant answers with a section citation', a1.text.length > 20 && a1.cites.length > 0, a1.cites[0]);
  const a2 = await ask(inst, 'What is the capital of France?');
  check('assistant refuses an out-of-scope question', a2.text === 'That is not covered in the lab guide.', a2.text);

  const lrn = await login(browser, { tenantId: T1, tenantName: 'E2E Corp', userId: 'learner-1', role: 'learner' });
  check('learner connects live', await waitFor(async () => (await text(lrn, '.conn'))[0]?.startsWith('Live')));
  await waitFor(async () => (await text(lrn, 'tbody tr')).length > 0);
  const rows = await lrn.$$eval('tbody tr', (rs) => rs.map((r) => r.children[0].textContent));
  check('learner sees only their own row', rows.length === 1 && rows[0] === 'learner-1', rows.join(','));
  check('learner has no alerts panel', (await lrn.$('.alerts')) === null);
  const a3 = await ask(lrn, 'Why did my deployment step fail?');
  check("assistant used the learner's own errors (tool call)", a3.tag === 'used your lab events' && a3.text.includes('InvalidTemplate'), a3.text.slice(0, 110));
  await lrn.screenshot({ path: '/tmp/pdfx/learner.png' });
  check('no browser console / page errors', inst.errors.length + lrn.errors.length === 0, [...inst.errors, ...lrn.errors].join(' | '));
} finally {
  await browser.close();
}
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
