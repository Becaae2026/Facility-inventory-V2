/**
 * BEC / AAE — Facility Department Inventory
 * Apps Script Web App backend (rebuild, Aug 2026)
 *
 * Sheet tabs used (must exist): Item Master, Stock IN, Stock OUT, Branches, Vendors, Lists
 * Created automatically if missing: Audit Log
 *
 * Conventions:
 *  - Transactions are never deleted. Cancellation = Status set to VOID.
 *  - Every write is recorded in the Audit Log tab.
 *  - dailyBackup() copies the spreadsheet to Drive folder "Facility Inventory Backups"
 *    and keeps 5 years (1825 days) of copies. Attach a daily time-driven trigger to it.
 */

// Leave blank when the script lives inside the sheet (Extensions > Apps Script):
// the bound spreadsheet is used automatically. Only fill this in for a standalone script.
var SPREADSHEET_ID = '';

var TAB = {
  ITEMS: 'Item Master',
  IN: 'Stock IN',
  OUT: 'Stock OUT',
  BRANCHES: 'Branches',
  VENDORS: 'Vendors',
  LISTS: 'Lists',
  AUDIT: 'Audit Log'
};

// First data row per tab (rows above are titles / headers)
var DATA_ROW = { ITEMS: 3, IN: 3, OUT: 3, BRANCHES: 5, VENDORS: 4, LISTS: 4 };

var BACKUP_FOLDER = 'Facility Inventory Backups';
var BACKUP_RETENTION_DAYS = 1825; // 5 years

/* ============================= HTTP entry points ============================ */

function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || 'getData';
    if (action === 'getData') return json({ ok: true, data: getData() });
    if (action === 'ping') return json({ ok: true, message: 'Facility Inventory API is live', time: new Date().toISOString() });
    return json({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action;
    var user = String(body.user || 'Dashboard user');
    var result;

    if (action === 'stockIn')       result = postStockIn(body.payload, user);
    else if (action === 'stockOut') result = postStockOut(body.payload, user);
    else if (action === 'voidDoc')  result = voidDocument(body.payload, user);
    else throw new Error('Unknown action: ' + action);

    return json({ ok: true, data: result });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ================================= Reads =================================== */

function ss() {
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;                       // script bound to the sheet
  if (SPREADSHEET_ID) return SpreadsheetApp.openById(SPREADSHEET_ID);
  throw new Error('Open this script from inside the Google Sheet (Extensions > Apps Script), or set SPREADSHEET_ID at the top of Code.gs.');
}

function readRows(sheetName, firstRow, numCols) {
  var sh = ss().getSheetByName(sheetName);
  if (!sh) throw new Error('Missing tab: ' + sheetName);
  var last = sh.getLastRow();
  if (last < firstRow) return [];
  return sh.getRange(firstRow, 1, last - firstRow + 1, numCols).getValues();
}

function fmtDate(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var s = v ? String(v).trim() : '';
  var m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/); // dd/mm/yyyy typed as text
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return s;
}

function getData() {
  // Only real item rows: codes like FAC-0001. Skips the Total row and any notes.
  var items = readRows(TAB.ITEMS, DATA_ROW.ITEMS, 8)
    .filter(function (r) { return /^[A-Za-z]{2,6}-\d+$/.test(String(r[0]).trim()); })
    .map(function (r) {
      return {
        code: String(r[0]), name: String(r[1] || ''), category: String(r[2] || ''),
        unit: String(r[3] || ''), location: String(r[4] || ''),
        opening: Number(r[5]) || 0, reorder: Number(r[6]) || 0, cost: Number(r[7]) || 0
      };
    });

  var stockIn = readRows(TAB.IN, DATA_ROW.IN, 12)
    .filter(function (r) { return r[0]; })
    .map(function (r, i) {
      return {
        row: DATA_ROW.IN + i, doc: String(r[0]), date: fmtDate(r[1]), vendor: String(r[2] || ''),
        invoice: String(r[3] || ''), code: String(r[4] || ''), name: String(r[5] || ''),
        qty: Number(r[6]) || 0, cost: Number(r[7]) || 0, remarks: String(r[8] || ''),
        status: String(r[9] || 'ACTIVE').toUpperCase(), value: Number(r[10]) || 0
      };
    });

  var stockOut = readRows(TAB.OUT, DATA_ROW.OUT, 12)
    .filter(function (r) { return r[0]; })
    .map(function (r, i) {
      return {
        row: DATA_ROW.OUT + i, doc: String(r[0]), date: fmtDate(r[1]), branch: String(r[2] || ''),
        issuedTo: String(r[3] || ''), requestedBy: String(r[4] || ''), code: String(r[5] || ''),
        name: String(r[6] || ''), qty: Number(r[7]) || 0, remarks: String(r[8] || ''),
        status: String(r[9] || 'ACTIVE').toUpperCase(), unit: String(r[10] || '')
      };
    });

  // Departments have no code in column A — use the name as their code.
  var branches = readRows(TAB.BRANCHES, DATA_ROW.BRANCHES, 3)
    .filter(function (r) { return r[0] || r[1]; })
    .map(function (r) {
      var name = String(r[1] || r[0]);
      return { code: String(r[0] || name), name: name, type: String(r[2] || '') };
    });

  var vendors = readRows(TAB.VENDORS, DATA_ROW.VENDORS, 4)
    .filter(function (r) { return r[0]; })
    .map(function (r) { return { name: String(r[0]), contact: String(r[1] || ''), phone: String(r[2] || ''), notes: String(r[3] || '') }; });

  var lists = readRows(TAB.LISTS, DATA_ROW.LISTS, 3);
  var categories = [], units = [];
  lists.forEach(function (r) {
    if (r[0]) categories.push(String(r[0]));
    if (r[1]) units.push(String(r[1]));
  });

  return {
    items: items, stockIn: stockIn, stockOut: stockOut,
    branches: branches, vendors: vendors,
    categories: categories, units: units,
    serverTime: new Date().toISOString()
  };
}

/* ============================ Balance validation =========================== */

function currentBalances() {
  var d = getData();
  var bal = {};
  d.items.forEach(function (it) { bal[it.code] = it.opening; });
  d.stockIn.forEach(function (t) { if (t.status === 'ACTIVE' && bal.hasOwnProperty(t.code)) bal[t.code] += t.qty; });
  d.stockOut.forEach(function (t) { if (t.status === 'ACTIVE' && bal.hasOwnProperty(t.code)) bal[t.code] -= t.qty; });
  return bal;
}

/* ================================ Writes =================================== */

function nextWriteRow(sh, firstRow) {
  var last = sh.getLastRow();
  if (last < firstRow) return firstRow;
  var colA = sh.getRange(firstRow, 1, last - firstRow + 1, 1).getValues();
  var lastData = firstRow - 1;
  for (var i = 0; i < colA.length; i++) {
    var v = String(colA[i][0] || '').trim();
    if (v && v.toUpperCase() !== 'TOTAL') lastData = firstRow + i;
  }
  return lastData + 1;
}

function nextDocNo(sheetName, prefix) {
  var rows = readRows(sheetName, sheetName === TAB.IN ? DATA_ROW.IN : DATA_ROW.OUT, 1);
  var max = 0;
  rows.forEach(function (r) {
    var m = String(r[0] || '').match(new RegExp('^' + prefix + '-(\\d+)$'));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return prefix + '-' + ('00000' + (max + 1)).slice(-5);
}

/** payload: { date:'yyyy-mm-dd', vendor, invoice, remarks, lines:[{code, qty, cost}] } */
function postStockIn(p, user) {
  if (!p || !p.date || !p.vendor) throw new Error('Date and vendor are required.');
  if (!p.lines || !p.lines.length) throw new Error('Add at least one item line.');

  var itemMap = {};
  getData().items.forEach(function (it) { itemMap[it.code] = it; });

  var doc = nextDocNo(TAB.IN, 'GRN');
  var now = new Date();
  var date = new Date(p.date + 'T00:00:00');
  var rows = p.lines.map(function (ln) {
    var it = itemMap[ln.code];
    if (!it) throw new Error('Unknown item code: ' + ln.code);
    var qty = Number(ln.qty), cost = Number(ln.cost) || 0;
    if (!(qty > 0)) throw new Error('Quantity must be greater than zero (' + ln.code + ').');
    return [doc, date, p.vendor, p.invoice || '', it.code, it.name, qty, cost,
            p.remarks || '', 'ACTIVE', qty * cost, now];
  });

  var sh = ss().getSheetByName(TAB.IN);
  sh.getRange(nextWriteRow(sh, DATA_ROW.IN), 1, rows.length, 12).setValues(rows);
  audit(user, 'STOCK IN', doc, rows.length + ' line(s) from ' + p.vendor);
  return { doc: doc, lines: rows.length };
}

/** payload: { date, branch, issuedTo, requestedBy, remarks, lines:[{code, qty}] } */
function postStockOut(p, user) {
  if (!p || !p.date || !p.branch) throw new Error('Date and branch are required.');
  if (!p.lines || !p.lines.length) throw new Error('Add at least one item line.');

  var itemMap = {};
  getData().items.forEach(function (it) { itemMap[it.code] = it; });
  var bal = currentBalances();

  // Validate every line against live balance before writing anything
  var need = {};
  p.lines.forEach(function (ln) {
    var qty = Number(ln.qty);
    if (!itemMap[ln.code]) throw new Error('Unknown item code: ' + ln.code);
    if (!(qty > 0)) throw new Error('Quantity must be greater than zero (' + ln.code + ').');
    need[ln.code] = (need[ln.code] || 0) + qty;
  });
  Object.keys(need).forEach(function (code) {
    if (need[code] > (bal[code] || 0)) {
      throw new Error('Insufficient stock for ' + code + ' (' + itemMap[code].name +
        '). Available: ' + (bal[code] || 0) + ', requested: ' + need[code] + '.');
    }
  });

  var doc = nextDocNo(TAB.OUT, 'ISS');
  var now = new Date();
  var date = new Date(p.date + 'T00:00:00');
  var rows = p.lines.map(function (ln) {
    var it = itemMap[ln.code];
    return [doc, date, p.branch, p.issuedTo || '', p.requestedBy || '', it.code, it.name,
            Number(ln.qty), p.remarks || '', 'ACTIVE', it.unit, now];
  });

  var sh = ss().getSheetByName(TAB.OUT);
  sh.getRange(nextWriteRow(sh, DATA_ROW.OUT), 1, rows.length, 12).setValues(rows);
  audit(user, 'STOCK OUT', doc, rows.length + ' line(s) to ' + p.branch);
  return { doc: doc, lines: rows.length };
}

/** payload: { type:'IN'|'OUT', doc:'GRN-00001', reason } — sets Status=VOID on all lines */
function voidDocument(p, user) {
  if (!p || !p.doc || !p.type) throw new Error('Document number and type are required.');
  var sheetName = p.type === 'IN' ? TAB.IN : TAB.OUT;
  var firstRow = p.type === 'IN' ? DATA_ROW.IN : DATA_ROW.OUT;
  var sh = ss().getSheetByName(sheetName);
  var last = sh.getLastRow();
  if (last < firstRow) throw new Error('No transactions found.');

  var docs = sh.getRange(firstRow, 1, last - firstRow + 1, 1).getValues();
  var statusCol = 10; // column J on both tabs
  var count = 0;
  for (var i = 0; i < docs.length; i++) {
    if (String(docs[i][0]) === p.doc) {
      sh.getRange(firstRow + i, statusCol).setValue('VOID');
      count++;
    }
  }
  if (!count) throw new Error('Document not found: ' + p.doc);
  audit(user, 'VOID', p.doc, (p.reason || 'No reason given') + ' — ' + count + ' line(s)');
  return { doc: p.doc, voided: count };
}

/* ================================ Audit log ================================ */

function audit(user, action, doc, details) {
  var sh = ss().getSheetByName(TAB.AUDIT);
  if (!sh) {
    sh = ss().insertSheet(TAB.AUDIT);
    sh.getRange(1, 1, 1, 5).setValues([['Timestamp', 'User', 'Action', 'Document', 'Details']])
      .setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  sh.appendRow([new Date(), user, action, doc, details]);
}

/* ============================== Drive backups ============================== */

/** Attach a daily time-driven trigger to this function (see SETUP.md). */
function dailyBackup() {
  var folders = DriveApp.getFoldersByName(BACKUP_FOLDER);
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(BACKUP_FOLDER);

  var file = DriveApp.getFileById(ss().getId());
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  file.makeCopy('Facility Inventory Backup ' + stamp, folder);

  // Retention: remove copies older than 5 years
  var cutoff = new Date(Date.now() - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  var files = folder.getFiles();
  while (files.hasNext()) {
    var f = files.next();
    if (f.getDateCreated() < cutoff) f.setTrashed(true);
  }
}
