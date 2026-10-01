/**
 * OPTIONAL — Google Apps Script backend (Web App) for Saily Weaving.
 * Use when the page is published and you want short, strictly serial
 * Beam IDs across ALL devices (BM-261001-0001, BM-261001-0002, ...).
 *
 * LockService makes allocation atomic: if two users press
 * "Scan New Beam" in the same millisecond, one waits a few ms
 * and gets the next number. No duplicates, no mix-up.
 *
 * Deploy: Extensions > Apps Script > paste > Deploy > Web app
 *         (Execute as: Me, Access: Anyone with link).
 */
var SHEET_NAME = 'BEAM_SCANS';

function doPost(e) {
  var body = JSON.parse(e.postData.contents || '{}');
  var out;
  if (body.action === 'newBeam') out = { beamId: allocateBeamId_() };
  else if (body.action === 'saveBeam') out = saveBeam_(body.payload);
  else out = { error: 'unknown action' };
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

function allocateBeamId_() {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var tz = Session.getScriptTimeZone();
    var day = Utilities.formatDate(new Date(), tz, 'yyMMdd');
    var props = PropertiesService.getScriptProperties();
    var key = 'BEAM_SEQ_' + day;
    var n = Number(props.getProperty(key) || 0) + 1;
    props.setProperty(key, String(n));
    return 'BM-' + day + '-' + ('000' + n).slice(-4);
  } finally {
    lock.releaseLock();
  }
}

function saveBeam_(p) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
    if (sh.getLastRow() === 0) {
      sh.appendRow(['ROW KEY', 'BEAM ID', 'SEQ', 'USER', 'LOOM', 'ORDER', 'SCANNED AT', 'BEAM STARTED', 'BEAM FINISHED']);
    }
    // Idempotent: skip rows already saved (e.g. user pressed Save twice).
    var existing = {};
    if (sh.getLastRow() > 1) {
      sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues()
        .forEach(function (r) { existing[r[0]] = true; });
    }
    var rows = p.rows.filter(function (r) { return !existing[r.rowKey]; }).map(function (r) {
      return [r.rowKey, p.beamId, r.seq, p.userId, r.loom || '', r.order || '', r.scannedAt, p.startedAt, p.finishedAt];
    });
    if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    return { ok: true, saved: rows.length };
  } finally {
    lock.releaseLock();
  }
}
