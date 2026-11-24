import puppeteer from 'puppeteer-core';
import { randomUUID } from 'node:crypto';

const BASE = 'http://localhost:5173';
const RUN = randomUUID().slice(0, 6);
const TENANT = `ui-${RUN}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };
const waitFor = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(100); } return false; };

async function login(browser, role, userId, width = 1400, height = 900) {
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  await page.goto(BASE);
  await page.waitForSelector('.login');
  const inputs = await page.$$('.login input');
  for (const [i, v] of [[0, TENANT], [1, 'UI Corp'], [2, userId]]) {
    await inputs[i].focus(); await page.keyboard.press('End');
    for (let k = 0; k < 60; k++) await page.keyboard.press('Backspace');
    await inputs[i].type(v);
  }
  await page.select('.login select', role);
  await page.evaluate(() => [...document.querySelectorAll('button.primary')].find((b) => b.textContent === 'Sign in').click());
  await page.waitForSelector('.app');
  await waitFor(async () => (await page.$eval('.conn', (e) => e.textContent)).startsWith('Live'));
  return page;
}

const geom = (page) => page.evaluate(() => {
  const card = document.querySelector('.assistant').getBoundingClientRect();
  const msgs = document.querySelector('.assistant .msgs');
  return { cardBottom: Math.round(card.bottom), cardHeight: Math.round(card.height), vh: window.innerHeight,
    msgsScrollTop: Math.round(msgs.scrollTop), msgsClient: msgs.clientHeight, msgsScrollHeight: msgs.scrollHeight,
    docScrollable: document.documentElement.scrollHeight > window.innerHeight + 2 };
});
const chips = (page) => page.$$eval('.suggestions .chip', (els) => els.map((e) => e.textContent.trim()));
const ask = async (page, q) => {
  const n0 = (await page.$$('.assistant .msg.assistant')).length;
  await page.type('.assistant input', q);
  await page.click('.assistant button.primary');
  await waitFor(async () => (await page.$$('.assistant .msg.assistant')).length > n0);
  await waitFor(async () => !(await page.$eval('.assistant input', (i) => i.disabled)));
  await sleep(200);
};

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox'] });
try {
  // ---------- learner
  const lrn = await login(browser, 'learner', 'learner-1');
  const lc = await chips(lrn);
  console.log('learner chips:', lc);
  check('starter questions are about the lab guide (none off-topic)', lc.length >= 4 && !lc.some((c) => /france|capital/i.test(c)));
  check('learner also gets the "why did my step fail" example', lc.includes('Why did my deployment step fail?'));
  const g0 = await geom(lrn);
  console.log('learner geometry:', g0);
  check('learner: assistant fills down to the bottom of the screen', g0.vh - g0.cardBottom <= 40, `card bottom ${g0.cardBottom}px of ${g0.vh}px`);
  check('learner: page itself does not scroll', !g0.docScrollable);
  await lrn.screenshot({ path: '/tmp/pdfx/ui-learner-empty.png' });

  // clicking a chip asks that question
  await lrn.evaluate(() => document.querySelector('.suggestions .chip').click());
  await waitFor(async () => (await lrn.$$('.assistant .msg.assistant')).length === 1);
  await waitFor(async () => !(await lrn.$eval('.assistant input', (i) => i.disabled)));
  const first = await lrn.$$eval('.assistant .msg.assistant .bubble', (b) => b[0].textContent);
  check('clicking a starter question returns a real answer', first.length > 40 && first !== 'That is not covered in the lab guide.', first.slice(0, 80));

  // enough questions that the list must overflow, then check it followed the newest text
  for (const q of ['What is a symbolic name in Bicep?', 'What are the naming rules for a storage account name?', 'How do I restrict a parameter to specific allowed values?', 'What Azure CLI command deploys a Bicep file to a resource group?']) await ask(lrn, q);
  const g1 = await geom(lrn);
  console.log('after 5 questions:', g1);
  check('conversation overflows the box (scrollbar in play)', g1.msgsScrollHeight > g1.msgsClient + 20, `${g1.msgsScrollHeight} > ${g1.msgsClient}`);
  check('auto-scroll: newest message is in view', g1.msgsScrollHeight - g1.msgsScrollTop - g1.msgsClient <= 4, `gap ${g1.msgsScrollHeight - g1.msgsScrollTop - g1.msgsClient}px`);
  check('learner: box height unchanged as messages grow (no page growth)', g1.cardBottom === g0.cardBottom && !g1.docScrollable);
  const overlaps = await lrn.evaluate(() => {
    const r = [...document.querySelectorAll('.assistant .msgs > .msg')].map((e) => e.getBoundingClientRect());
    const bad = [];
    for (let i = 1; i < r.length; i++) if (r[i].top < r[i - 1].bottom - 1) bad.push(i);
    return { count: r.length, bad };
  });
  check('messages never overlap each other', overlaps.count >= 8 && overlaps.bad.length === 0, `${overlaps.count} messages, overlapping at: ${overlaps.bad.join(',') || 'none'}`);
  const textClipped = await lrn.evaluate(() => [...document.querySelectorAll('.assistant .msg')].filter((m) => m.scrollHeight > m.clientHeight + 2).length);
  check('no message has its text spilling out of its box', textClipped === 0, `${textClipped} clipped`);
  await lrn.screenshot({ path: '/tmp/pdfx/ui-learner-chat.png' });

  // reader scrolls up -> a new answer must not yank them back down mid-read... but a NEW question does scroll to bottom
  await lrn.evaluate(() => { document.querySelector('.assistant .msgs').scrollTop = 0; });
  await sleep(150);
  await ask(lrn, 'What is a symbolic name in Bicep?');
  const g2 = await geom(lrn);
  check('asking a new question scrolls back to the newest answer', g2.msgsScrollHeight - g2.msgsScrollTop - g2.msgsClient <= 4);

  // ---------- instructor
  const inst = await login(browser, 'instructor', 'inst-1');
  const ic = await chips(inst);
  check('instructor chips are guide questions and exclude the personal-errors one', ic.length === 4 && !ic.includes('Why did my deployment step fail?'), ic.length + ' chips');
  const gi = await geom(inst);
  console.log('instructor geometry:', gi);
  check('instructor: assistant fills to the bottom, alerts card above it', gi.vh - gi.cardBottom <= 40 && (await inst.$('.alerts')) !== null, `card bottom ${gi.cardBottom}/${gi.vh}`);
  await inst.screenshot({ path: '/tmp/pdfx/ui-instructor.png' });

  // ---------- narrow screen: must not collapse
  const narrow = await login(browser, 'learner', 'learner-1', 800, 900);
  const gn = await geom(narrow);
  console.log('narrow geometry:', gn);
  check('narrow screen: assistant not collapsed', gn.cardHeight > 200, `${gn.cardHeight}px`);
  await narrow.screenshot({ path: '/tmp/pdfx/ui-narrow.png', fullPage: true });
} finally {
  await browser.close();
}
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
