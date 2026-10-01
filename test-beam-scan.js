// node test-beam-scan.js — simulates two users starting at the exact same instant.
const assert = require('assert');
globalThis.crypto = globalThis.crypto || require('crypto').webcrypto;
require('./beam-scan-session.js');
const B = globalThis.BeamScanSession;

(async () => {
  const now = new Date('2026-10-01T10:45:12.000Z');
  const [u1, u2] = await Promise.all([B.start({ userId: 'USER1', now }), B.start({ userId: 'USER2', now })]);
  assert.notStrictEqual(u1.beamId, u2.beamId, 'beam IDs must differ');

  // interleaved scans, as happens on the floor
  for (let i = 1; i <= 5; i++) {
    if (i <= 4) u1.addScan({ loom: 'L' + i, order: 'A' + i });
    u2.addScan({ loom: 'M' + i, order: 'B' + i });
  }
  assert.deepStrictEqual(u1.rows().map(r => r.seq), [1, 2, 3, 4]);
  assert.deepStrictEqual(u2.rows().map(r => r.seq), [1, 2, 3, 4, 5]);
  assert.ok(u1.rows().every(r => r.beamId === u1.beamId && r.userId === 'USER1'));
  assert.ok(u2.rows().every(r => r.beamId === u2.beamId && r.userId === 'USER2'));

  u2.undoLast();
  assert.deepStrictEqual(u2.rows().map(r => r.seq), [1, 2, 3, 4]);
  assert.strictEqual(u1.count(), 4, 'undo in USER2 must not touch USER1');
  u2.addScan({ loom: 'M5', order: 'B5' });

  // 10,000 beams in the same millisecond, same user: all unique
  const ids = new Set();
  for (let i = 0; i < 10000; i++) ids.add((await B.start({ userId: 'USER1', now })).beamId);
  assert.strictEqual(ids.size, 10000);

  const merged = B.sortRows([...u2.finish().rows, ...u1.finish().rows]);
  console.log(merged.map(r => `${r.userId} ${r.beamId} #${r.seq}`).join('\n'));
  console.log('\nALL TESTS PASSED');
})().catch(e => { console.error(e); process.exit(1); });
