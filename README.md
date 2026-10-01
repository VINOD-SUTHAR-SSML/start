# Saily Weaving: Scan New Beam (multi-user safe)

When two users open **Scan New Beam** at the same time, each one gets their own Beam ID and their own sequence
(USER1: 1,2,3,4 / USER2: 1,2,3,4,5). Rows never get mixed up, even when the timestamps are identical.

| File | Purpose |
|---|---|
| `beam-scan-session.js` | Drop-in module (`BeamScanSession`): one object per form, holding its Beam ID, sequence and rows |
| `scan-new-beam-demo.html` | Two users side by side, with a "start at the same instant" button |
| `apps-script/BeamId.gs` | Optional Google Apps Script backend: serial IDs `BM-261001-0001` across all devices, using `LockService` |
| `test-beam-scan.js` | `node test-beam-scan.js` |

## Integrating into the existing page
1. `<script src="beam-scan-session.js"></script>` (or paste its contents into a `<script>` tag).
2. On **Scan New Beam**: `session = await BeamScanSession.start({ userId })` and show `session.beamId`.
3. On each loom/order scan: `session.addScan({ loom, order })`. It returns the row with its `seq`.
4. On save: `payload = session.finish()` and send `payload.rows` (each row has `beamId`, `seq`, `rowKey`).
5. Remove any global `beamId` / `seq` / `counter` variables, and any IDs made only from `Date.now()`.
   Always group and sort saved data by **Beam ID + Seq**, never by timestamp alone.

## Applied to `ssml-weaving-new.html`
- The in-progress beam is stored per **user + browser tab** (`SAILY:activeBeamSession:<user>:<tab>`), so a second user
  (other phone, same PC after switching user, or another tab) always starts their own beam with their own seq 1, 2, 3…
- Without Firebase, beam numbers are **claimed and verified**, so two users pressing Save at the same instant get
  different `SAILY-BEAM#####` numbers. With Firebase, the existing atomic counter is used as before.
- Save can't run twice at once (Enter + scanner), and never overwrites an existing beam + seq entry.
- Unfinished beams from a closed tab are listed with a **Resume** button.
- Browser test: `NODE_PATH=$(npm root -g) node tests/scan-new-beam.e2e.js`
