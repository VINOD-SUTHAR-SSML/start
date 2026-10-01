/*
 * beam-scan-session.js — concurrency-safe "SCAN NEW BEAM" sessions
 * for the Saily Weaving HTML page.
 *
 * Problem solved:
 *   Two users open "Scan New Beam" at the same moment (even the same
 *   millisecond). Each must get their OWN Beam ID and their OWN
 *   sequence (USER1: 1,2,3,4 / USER2: 1,2,3,4,5) with no mix-up.
 *
 * How:
 *   1. Every form instance owns a BeamScanSession object. Beam ID, sequence
 *      counter and scanned rows live INSIDE that object, never in shared
 *      global variables, so two forms can never touch each other's counter.
 *   2. The Beam ID is never derived from the timestamp alone. It is
 *      date-time + user code + tab id + cryptographic random suffix
 *      (or a server-allocated serial when a backend is configured), so
 *      two beams started in the same millisecond still get different IDs.
 *   3. Every scanned row carries { beamId, seq }. Rows are grouped/ordered
 *      by beamId + seq, never by timestamp, so identical timestamps can't
 *      re-order or merge rows.
 *   4. Drafts are saved in sessionStorage (per browser tab) keyed by beamId,
 *      so two tabs on the same PC don't overwrite each other either.
 */
(function (global) {
  'use strict';

  var ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // no I, L, O, U

  function randomCode(len) {
    var bytes = new Uint8Array(len);
    (global.crypto || global.msCrypto).getRandomValues(bytes);
    var out = '';
    for (var i = 0; i < len; i++) out += ALPHABET[bytes[i] & 31];
    return out;
  }

  function pad(n, w) { return String(n).padStart(w || 2, '0'); }

  function safeStorage() {
    try {
      var k = '__sw_test__';
      global.sessionStorage.setItem(k, '1');
      global.sessionStorage.removeItem(k);
      return global.sessionStorage;
    } catch (e) { return null; }
  }

  // One id per browser tab, so two tabs of the same user stay separate.
  var TAB_ID = (function () {
    var s = safeStorage();
    var id = s && s.getItem('sw_tab_id');
    if (!id) {
      id = randomCode(3);
      if (s) s.setItem('sw_tab_id', id);
    }
    return id;
  })();

  function cleanUser(userId) {
    return String(userId || 'USER').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || 'USER';
  }

  /** Locally unique Beam ID, e.g. BM-261001-104512-USER1-7KQ-X2M9 */
  function makeLocalBeamId(userId, now) {
    var d = now || new Date();
    var date = pad(d.getFullYear() % 100) + pad(d.getMonth() + 1) + pad(d.getDate());
    var time = pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
    return 'BM-' + date + '-' + time + '-' + cleanUser(userId) + '-' + TAB_ID + '-' + randomCode(4);
  }

  // Beam IDs issued in this page, to rule out even a 1-in-a-million clash.
  var issued = new Set();

  function BeamScanSession(opts) {
    this.beamId = opts.beamId;
    this.userId = opts.userId;
    this.startedAt = opts.startedAt;
    this.meta = opts.meta || {};
    this._seq = opts._seq || 0;
    this._rows = opts._rows || [];
    this._closed = false;
    issued.add(this.beamId);
  }

  /**
   * Start a new beam for one user / one form.
   * @param {Object} opts
   * @param {string} opts.userId    logged-in user / operator code
   * @param {Object} [opts.meta]    anything extra (shift, beam type, ...)
   * @param {Date}   [opts.now]     override clock (testing)
   * @param {Function} [opts.allocate] optional async fn({userId}) -> beamId
   *        from a server (see apps-script/BeamId.gs). Falls back to a
   *        local ID if it fails.
   * @returns {Promise<BeamScanSession>}
   */
  BeamScanSession.start = async function (opts) {
    opts = opts || {};
    var now = opts.now || new Date();
    var beamId = null;
    if (typeof opts.allocate === 'function') {
      try { beamId = await opts.allocate({ userId: opts.userId }); } catch (e) { beamId = null; }
    }
    if (!beamId) {
      do { beamId = makeLocalBeamId(opts.userId, now); } while (issued.has(beamId));
    }
    var s = new BeamScanSession({
      beamId: beamId,
      userId: opts.userId,
      startedAt: now.toISOString(),
      meta: opts.meta
    });
    s._save();
    return s;
  };

  /** Restore an unfinished beam of THIS tab after a page refresh (or null). */
  BeamScanSession.resume = function (beamId) {
    var st = safeStorage();
    var raw = st && st.getItem('sw_beam_draft_' + beamId);
    if (!raw) return null;
    try { return new BeamScanSession(JSON.parse(raw)); } catch (e) { return null; }
  };

  /** Beam IDs of unfinished drafts in THIS tab. */
  BeamScanSession.drafts = function () {
    var st = safeStorage(), out = [];
    if (!st) return out;
    for (var i = 0; i < st.length; i++) {
      var k = st.key(i);
      if (k && k.indexOf('sw_beam_draft_') === 0) out.push(k.slice('sw_beam_draft_'.length));
    }
    return out;
  };

  /** Order rows from any number of beams without ever mixing them. */
  BeamScanSession.sortRows = function (rows) {
    return rows.slice().sort(function (a, b) {
      if (a.beamId !== b.beamId) return a.beamId < b.beamId ? -1 : 1;
      return a.seq - b.seq;
    });
  };

  BeamScanSession.prototype = {
    constructor: BeamScanSession,

    /**
     * Record one loom/order scan. Sequence is per-beam: 1, 2, 3 ...
     * @param {Object} data e.g. { loom: 'L-12', order: 'SO-4471' }
     * @returns {Object} the stored row
     */
    addScan: function (data) {
      if (this._closed) throw new Error('Beam ' + this.beamId + ' is already finished.');
      var row = Object.assign({}, data, {
        beamId: this.beamId,
        seq: ++this._seq,
        userId: this.userId,
        scannedAt: new Date().toISOString(),
        rowKey: this.beamId + '#' + this._seq // globally unique row key
      });
      this._rows.push(row);
      this._save();
      return Object.assign({}, row);
    },

    /** Remove the last scan of THIS beam only. */
    undoLast: function () {
      if (this._closed || !this._rows.length) return null;
      var row = this._rows.pop();
      this._seq = this._rows.length ? this._rows[this._rows.length - 1].seq : 0;
      this._save();
      return row;
    },

    /** Copy of this beam's rows in sequence order. */
    rows: function () { return this._rows.map(function (r) { return Object.assign({}, r); }); },

    count: function () { return this._rows.length; },

    /** Close the beam; returns the payload to submit/save. */
    finish: function () {
      this._closed = true;
      var st = safeStorage();
      if (st) st.removeItem('sw_beam_draft_' + this.beamId);
      return {
        beamId: this.beamId,
        userId: this.userId,
        startedAt: this.startedAt,
        finishedAt: new Date().toISOString(),
        meta: this.meta,
        rows: this.rows()
      };
    },

    /** Drop the beam without saving. */
    cancel: function () {
      this._closed = true;
      var st = safeStorage();
      if (st) st.removeItem('sw_beam_draft_' + this.beamId);
    },

    _save: function () {
      var st = safeStorage();
      if (!st || this._closed) return;
      st.setItem('sw_beam_draft_' + this.beamId, JSON.stringify({
        beamId: this.beamId, userId: this.userId, startedAt: this.startedAt,
        meta: this.meta, _seq: this._seq, _rows: this._rows
      }));
    }
  };

  global.BeamScanSession = BeamScanSession;
})(typeof window !== 'undefined' ? window : globalThis);
