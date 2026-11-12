/**
 * מנוע איסוף תשובות לשאלון משוב.
 * מקבל POST אחד לכל משיב, ורושם אותו בשלושה מקומות:
 *   1. „תשובות גולמיות” - שורה אחת לכל משיב, כל השדות.
 *   2. גיליון נפרד לכל מרצה - רק הציונים והתגובות שלו.
 *   3. „סיכום” - נבנה מחדש בכל שליחה.
 *
 * התקנה, פעם אחת:
 *   1. drive.google.com  ←  חדש  ←  Google Sheets  ←  לתת שם לקובץ.
 *   2. בתוך הגיליון: הרחבות  ←  Apps Script.
 *   3. למחוק את מה שיש, להדביק את כל הקובץ הזה, ולשמור.
 *   4. פריסה  ←  פריסה חדשה  ←  סוג: אפליקציית אינטרנט.
 *      „הפעלה בשם”: אני.   „מי יכול לגשת”: כל אחד.
 *   5. לאשר הרשאות, ולהעתיק את כתובת ה-Web app שמתקבלת.
 *   6. לשלוח לי את הכתובת. היא נכנסת לדף השאלון.
 */

var SECRET = 'hgj-ai-2026';           // חייב להיות זהה למה שבדף השאלון
var RAW    = 'תשובות גולמיות';
var SUM    = 'סיכום';

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var d = JSON.parse(e.postData.contents);
    if (d.secret !== SECRET) return out({ ok: false, err: 'bad secret' });

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sessions = d.sessions || [];

    // ── 1. הגיליון הגולמי ──
    var head = ['חותמת זמן', 'מזהה', 'אירוע', 'רמת ידע קודמת', 'ציון כולל',
                'מה אנסה השבוע', 'הדבר האחד לשנות', 'נושאים להוספה',
                'פורמט מועדף', 'שם (רשות)'];
    sessions.forEach(function (s) {
      head.push(s.name + ' · תועלת', s.name + ' · רמה',
                s.name + ' · חלוקת זמן', s.name + ' · הערה');
    });
    var raw = sheet(ss, RAW, head);

    var row = [new Date(), d.id || '', d.event || '', d.prior || '', d.overall || '',
               d.tryThis || '', d.changeOne || '', (d.addTopics || []).join(', '),
               d.format || '', d.name || ''];
    sessions.forEach(function (s) {
      row.push(s.useful || '', s.level || '', s.pace || '', s.note || '');
    });
    raw.appendRow(row);

    // ── 2. גיליון לכל מרצה ──
    sessions.forEach(function (s) {
      var sh = sheet(ss, s.name, ['חותמת זמן', 'מזהה', 'רמת ידע קודמת',
                                  'תועלת (1-5)', 'הרמה', 'חלוקת הזמן', 'הערה']);
      sh.appendRow([new Date(), d.id || '', d.prior || '',
                    s.useful || '', s.level || '', s.pace || '', s.note || '']);
    });

    buildSummary(ss, sessions);
    return out({ ok: true });
  } catch (err) {
    return out({ ok: false, err: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet() { return out({ ok: true, msg: 'survey endpoint alive' }); }

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}

/** מחזיר גיליון קיים, או יוצר אותו עם שורת כותרת מעוצבת */
function sheet(ss, name, head) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(head);
    var h = sh.getRange(1, 1, 1, head.length);
    h.setFontWeight('bold').setBackground('#051C2C').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
    sh.setRightToLeft(true);
  }
  return sh;
}

/** גיליון הסיכום נבנה מחדש בכל שליחה, כך שהוא תמיד מעודכן */
function buildSummary(ss, sessions) {
  var raw = ss.getSheetByName(RAW);
  var n = Math.max(0, raw.getLastRow() - 1);
  var sh = ss.getSheetByName(SUM);
  if (!sh) { sh = ss.insertSheet(SUM); sh.setRightToLeft(true); }
  sh.clear();

  var rows = [['סיכום משוב', ''], ['מספר משיבים', n], ['', '']];
  rows.push(['ציון כולל, ממוצע', n ? '=ROUND(AVERAGE(\'' + RAW + '\'!E2:E),2)' : 0]);
  rows.push(['', '']);
  rows.push(['לפי מושב', 'תועלת ממוצעת (1-5)']);
  sessions.forEach(function (s) {
    rows.push([s.name, n ? "=IFERROR(ROUND(AVERAGE('" + s.name + "'!D2:D),2),\"\")" : 0]);
  });
  rows.push(['', '']);
  rows.push(['התפלגות רמת ידע קודמת', '']);
  ['לא הכרתי', 'שיחקתי קצת בבית', 'משתמש שוטף בעבודה'].forEach(function (k) {
    rows.push([k, '=COUNTIF(\'' + RAW + '\'!D2:D,"' + k + '")']);
  });
  sh.getRange(1, 1, rows.length, 2).setValues(rows);
  sh.getRange(1, 1, 1, 2).setFontWeight('bold').setFontSize(13);
  sh.setColumnWidth(1, 260); sh.setColumnWidth(2, 180);
}
