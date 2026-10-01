const { chromium } = require('playwright');
const assert = require('assert');
const FILE = 'file://' + require('path').resolve(__dirname, '../ssml-weaving-new.html') + '#/plant/SAILY/weaving/scan-new-beam';
const shared = new Map();
const delay = () => new Promise(r => setTimeout(r, 5 + Math.random() * 60));
const errors = [];

// Fake Claude-artifact window.storage: shared:true is common to all users,
// shared:false is private to each page (each user).
async function userPage(ctx, user) {
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(user + ': ' + e.message));
  await p.exposeFunction('__sh', async (op, k, v) => { await delay();
    if (op === 'get') return shared.has(k) ? shared.get(k) : null;
    if (op === 'set') { shared.set(k, v); return true; }
    if (op === 'del') { shared.delete(k); return true; }
    if (op === 'list') return [...shared.keys()].filter(x => x.startsWith(k)); });
  await p.addInitScript(u => {
    const local = new Map([['currentUser', u]]);
    window.storage = {
      async get(k, s) { const v = s ? await __sh('get', k) : (local.has(k) ? local.get(k) : null); return v === null ? null : { key: k, value: v, shared: s }; },
      async set(k, v, s) { s ? await __sh('set', k, v) : local.set(k, v); return { key: k, value: v, shared: s }; },
      async delete(k, s) { s ? await __sh('del', k) : local.delete(k); return { key: k, deleted: true }; },
      async list(pre, s) { return { keys: s ? await __sh('list', pre) : [...local.keys()].filter(x => x.startsWith(pre)) }; },
    };
  }, user);
  await p.goto(FILE);
  await p.waitForSelector('#greyOrder');
  return p;
}
async function scan(p, loom, grey) {
  if (loom) await p.fill('#loomNo', String(loom));
  await p.fill('#greyOrder', String(grey));
  await p.click('.btn-primary');
  await p.waitForFunction(g => !document.querySelector('#greyOrder')?.value && document.querySelector('.beam-banner'), null, { timeout: 8000 });
  await p.waitForTimeout(200);
}
const state = p => p.evaluate(() => ({ id: document.querySelector('.beam-banner .id')?.textContent, seq: document.querySelector('.seqchip')?.textContent,
  rows: [...document.querySelectorAll('#beamEntryList .entry-row .l')].map(e => e.textContent) }));

(async () => {
  const b = await chromium.launch();
  const [u1, u2] = await Promise.all([userPage(await b.newContext(), 'USER1'), userPage(await b.newContext(), 'USER2')]);

  // first scan of both users fired at the same instant
  await Promise.all([scan(u1, 201, 55000001), scan(u2, 301, 55000101)]);
  for (let i = 2; i <= 5; i++) {
    const jobs = [scan(u2, null, 55000100 + i)];
    if (i <= 4) jobs.push(scan(u1, null, 55000000 + i));
    await Promise.all(jobs);
  }
  const s1 = await state(u1), s2 = await state(u2);
  console.log('USER1', s1); console.log('USER2', s2);
  assert.notStrictEqual(s1.id, s2.id);
  assert.deepStrictEqual(s1.rows.map(r => r.split(' ·')[0]), ['Seq 1', 'Seq 2', 'Seq 3', 'Seq 4']);
  assert.deepStrictEqual(s2.rows.map(r => r.split(' ·')[0]), ['Seq 1', 'Seq 2', 'Seq 3', 'Seq 4', 'Seq 5']);

  // stress: 6 users start a new beam at the same instant
  const pages = await Promise.all([...Array(6)].map(async (_, i) => userPage(await b.newContext(), 'U' + i)));
  await Promise.all(pages.map((p, i) => scan(p, 202 + i, 55000201 + i)));
  const ids = await Promise.all(pages.map(async p => (await state(p)).id));
  console.log('6 simultaneous:', ids.join(', '));
  assert.strictEqual(new Set([...ids, s1.id, s2.id]).size, 8);

  // same device, second tab: must not continue the first tab's beam
  const ctx = await b.newContext();
  const t1 = await ctx.newPage(); t1.on('pageerror', e => errors.push('t1 ' + e.message));
  await t1.addInitScript(() => localStorage.setItem('currentUser', 'USER1'));
  await t1.goto(FILE); await t1.waitForSelector('#greyOrder');
  await scan(t1, 210, 55000301); await scan(t1, null, 55000302);
  const t2 = await ctx.newPage(); t2.on('pageerror', e => errors.push('t2 ' + e.message));
  await t2.goto(FILE); await t2.waitForSelector('#greyOrder');
  const t2s = await state(t2);
  const resume = await t2.locator('text=Your unfinished beams').count();
  console.log('tab2 banner:', t2s.id || '(none, starts fresh)', '| resume offered:', resume);
  assert.ok(!t2s.id);
  await scan(t2, 211, 55000401);
  const a = await state(t1), c = await state(t2);
  await t1.reload(); await t1.waitForSelector('#greyOrder');
  const a2 = await state(t1);
  console.log('tab1', a2, '\ntab2', c);
  assert.notStrictEqual(a2.id, c.id); assert.strictEqual(a2.rows.length, 2); assert.strictEqual(c.rows.length, 1);

  // double-fire Save (Enter + scanner) must save once
  await t2.fill('#greyOrder', '55000402');
  await t2.evaluate(() => { saveBeamEntry(); saveBeamEntry(); });
  await t2.waitForTimeout(1500);
  console.log('after double save', await state(t2));
  assert.strictEqual((await state(t2)).rows.length, 2);

  console.log('page errors:', errors);
  await b.close();
  console.log('E2E PASSED');
})().catch(e => { console.error(e, errors); process.exit(1); });
