/**
 * מנוע איסוף תשובות לשאלון משוב (גרסה 2, 12.11.2026).
 * מקבל POST אחד לכל משיב, ורושם אותו בשלושה מקומות:
 *   1. "תשובות גולמיות": שורה אחת לכל משיב, כל השדות.
 *   2. גיליון נפרד לכל הרצאה: רק הציונים וההערות שלה.
 *   3. "סיכום": ממוצעים לכל הרצאה, נבנה מחדש בכל שליחה.
 *
 * התקנה, פעם אחת:
 *   1. לפתוח את הגיליון בגוגל שיטס.
 *   2. הרחבות ← Apps Script.
 *   3. למחוק את מה שיש, להדביק את כל הקובץ הזה, ולשמור.
 *   4. פריסה ← פריסה חדשה ← סוג: אפליקציית אינטרנט.
 *      "הפעלה בשם": אני.   "מי יכול לגשת": כל אחד.
 *   5. לאשר הרשאות, ולהעתיק את כתובת ה-Web app שמתקבלת.
 *   6. הכתובת נכנסת ל-endpoint בדף השאלון.
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

    // 1. הגיליון הגולמי
    var head = ['חותמת זמן', 'מזהה', 'אירוע', 'רמת ידע קודמת', 'ציון כולל (1-10)',
                'מה אנסה ליישם', 'הדבר האחד לשנות', 'נושאים להמשך',
                'פורמט מועדף', 'הערה חופשית', 'שם (רשות)'];
    sessions.forEach(function (s) {
      var k = s.sheet || s.name;
      head.push(k + ': איכות', k + ': רלוונטיות', k + ': המרצה',
                k + ': רמה', k + ': הערה');
    });
    var raw = sheet(ss, RAW, head);

    var row = [new Date(), d.id || '', d.event || '', d.prior || '', d.overall || '',
               d.tryThis || '', d.changeOne || '', (d.addTopics || []).join(', '),
               d.format || '', d.free || '', d.name || ''];
    sessions.forEach(function (s) {
      row.push(num(s.quality), num(s.relevance), num(s.speaker), s.level || '', s.note || '');
    });
    raw.appendRow(row);

    // 2. גיליון לכל הרצאה
    sessions.forEach(function (s) {
      var sh = sheet(ss, s.sheet || s.name, ['חותמת זמן', 'מזהה', 'רמת ידע קודמת',
        'איכות ההרצאה (1-5)', 'רלוונטיות (1-5)', 'המרצה (1-5)', 'הרמה', 'הערה', 'שם (רשות)']);
      sh.appendRow([new Date(), d.id || '', d.prior || '',
                    num(s.quality), num(s.relevance), num(s.speaker),
                    s.level || '', s.note || '', d.name || '']);
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

function num(v) { var n = Number(v); return v === '' || v == null || isNaN(n) ? '' : n; }

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}

/** מחזיר גיליון קיים, או יוצר אותו עם שורת כותרת */
function sheet(ss, name, head) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(head);
    sh.getRange(1, 1, 1, head.length).setFontWeight('bold').setBackground('#D9D9D9');
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
  if (!sh) { sh = ss.insertSheet(SUM, 0); sh.setRightToLeft(true); }
  sh.clear();

  var rows = [['סיכום משוב', '', '', '', ''],
              ['מספר משיבים', n, '', '', ''],
              ['ציון כולל ליום, ממוצע (1-10)', "=IFERROR(ROUND(AVERAGE('" + RAW + "'!E2:E),2),\"\")", '', '', ''],
              ['', '', '', '', ''],
              ['הרצאה', 'איכות (1-5)', 'רלוונטיות (1-5)', 'המרצה (1-5)', 'משיבים']];
  sessions.forEach(function (s) {
    var k = "'" + (s.sheet || s.name) + "'!";
    rows.push([s.sheet || s.name,
      '=IFERROR(ROUND(AVERAGE(' + k + 'D2:D),2),"")',
      '=IFERROR(ROUND(AVERAGE(' + k + 'E2:E),2),"")',
      '=IFERROR(ROUND(AVERAGE(' + k + 'F2:F),2),"")',
      '=COUNT(' + k + 'D2:D)']);
  });
  rows.push(['', '', '', '', '']);
  rows.push(['רמת ידע קודמת', 'משיבים', '', '', '']);
  ['לא הכרתי', 'שיחקתי קצת בבית', 'משתמש שוטף בעבודה'].forEach(function (k) {
    rows.push([k, "=COUNTIF('" + RAW + "'!D2:D,\"" + k + "\")", '', '', '']);
  });
  sh.getRange(1, 1, rows.length, 5).setValues(rows);
  sh.getRange(1, 1).setFontWeight('bold').setFontSize(13);
  sh.getRange(5, 1, 1, 5).setFontWeight('bold').setBackground('#D9D9D9');
  sh.setColumnWidth(1, 240);
  [2, 3, 4, 5].forEach(function (c) { sh.setColumnWidth(c, 130); });
}
