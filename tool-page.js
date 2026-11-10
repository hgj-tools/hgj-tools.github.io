/* סידור התוכן בדפי הכלים של hgj-tools.github.io, בלי לשנות את הנוסח שלהם.
   שימוש: <script src="../tool-page.js" defer></script> (יחד עם theme.css).
   מה הוא עושה בדף שיש בו .page:
   1. מוסיף מתחת לראש הדף שורת "במבט אחד" ושלושה צעדים (הנתונים בטבלה PAGES למטה).
   2. משאיר גלוי את הכרטיס הראשון (ההורדה), ומקפל כל כרטיס אחר שיש לו כותרת h2,
      יחד עם תיבות האזהרה וההערה שבאות אחריו. הטקסט עצמו לא משתנה ולא נמחק.
   בלי JavaScript הדף מוצג כמו שנכתב. */
(function () {
  "use strict";

  // 0. הסרגל העליון, בכל דפי הכלים: הלוגו מוביל לדף הבית, והחץ של "כל הכלים" פונה ימינה (חזרה, בעברית)
  var bar = document.querySelector(".logo-wrap, .logobar");
  if (bar) {
    var back = bar.querySelector("a");
    var home = back ? back.getAttribute("href") : "../";
    if (back) back.textContent = back.textContent.replace(/^\s*[←→]\s*/, "→ ");
    var img = bar.querySelector("img");
    if (img && !img.closest("a")) {
      var link = document.createElement("a");
      link.href = home;
      link.setAttribute("aria-label", "לדף הבית של אתר הכלים");
      link.style.display = "inline-flex";
      img.parentNode.insertBefore(link, img);
      link.appendChild(img);
      img.alt = "";
    }
  }

  var page = document.querySelector(".page");
  if (!page) return;

  // 🔴 כשמשנים עובדה בדף של כלי (דרישות, פורמטים, אופן ההפעלה) לעדכן גם כאן.
  var PAGES = {
    "data-masking": {
      chips: ["קובצי Excel בלבד", "רץ על המחשב, בלי רשת", "נדרש Python 3"],
      steps: ["מחלצים את התיקייה ומריצים את הפעלה.bat", "בוחרים אילו עמודות למסך וקובעים סיסמה", "משתפים את הקובץ הממוסך, ובסוף משחזרים את המזהים"]
    },
    "pii-redactor": {
      chips: ["PDF, Word, Excel ותמונות", "בלי התקנה ובלי Python", "שום קובץ לא נשלח לרשת"],
      steps: ["מחלצים את התיקייה ולוחצים על הפעלת הכלי.bat", "גוררים את הקבצים ומדביקים את השמות להסתרה", "מאשרים את הממצאים ומקבלים קובץ נקי שנבדק"]
    },
    "financial-statement-proofreader": {
      chips: ["סקיל של Claude", "עובד גם על דוח סרוק", "הפלט: קובץ Excel"],
      steps: ["מעלים את קובץ ה-ZIP ל-Skills בהגדרות של Claude", "מצרפים לשיחה את ה-PDF של הדוח", "מקבלים דוח ממצאים לבדיקה לפני שליחה ללקוח"]
    },
    "audit-standards-toolkit": {
      chips: ["סקיל של Claude", "בלי Python ובלי התקנת תוכנה", "עובד על נתוני לקוח"],
      steps: ["מפעילים יצירת קבצים ב-Claude ומעלים את הסקיל", "פותחים שיחה נפרדת לכל לקוח ומצרפים את הדוחות", "מקבלים ניירות עבודה, ובודקים אותם לפני הסתמכות"]
    },
    "dictation-desktop": {
      chips: ["Windows 10 / 11", "התמלול נעשה על המחשב", "בלי חשבון ובלי שרת"],
      collapse: false
    }
  };

  var parts = location.pathname.replace(/index\.html$/, "").split("/").filter(Boolean);
  var cfg = PAGES[parts[parts.length - 1]] || {};

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // 1. במבט אחד
  var header = page.querySelector(":scope > header");
  if (header && (cfg.chips || cfg.steps)) {
    var glance = el("section", "hgj-glance");
    glance.setAttribute("aria-label", "הכלי במבט אחד");
    if (cfg.chips) {
      var ul = el("ul", "hgj-chips");
      cfg.chips.forEach(function (t) { ul.appendChild(el("li", null, t)); });
      glance.appendChild(ul);
    }
    if (cfg.steps) {
      glance.appendChild(el("h2", "hgj-h", "איך זה עובד"));
      var ol = el("ol", "hgj-steps");
      cfg.steps.forEach(function (t) { ol.appendChild(el("li", null, t)); });
      glance.appendChild(ol);
    }
    header.insertAdjacentElement("afterend", glance);
  }

  // 2. קיפול הפירוט המשני
  if (cfg.collapse === false) return;
  var groups = [], cur = null;
  Array.prototype.forEach.call(page.children, function (node) {
    if (node.matches(".logo-wrap, header, footer, script, .hgj-glance")) return;
    if (node.matches(".card")) { cur = { card: node, rest: [] }; groups.push(cur); }
    else if (cur) cur.rest.push(node);
  });
  var made = [];
  groups.slice(1).forEach(function (g) {
    var h2 = g.card.querySelector(":scope > h2");
    if (!h2) return;
    var d = el("details", "hgj-acc"), s = el("summary"), body = el("div", "hgj-acc-body");
    page.insertBefore(d, g.card);
    s.appendChild(h2);
    d.appendChild(s);
    body.appendChild(g.card);
    g.rest.forEach(function (n) { body.appendChild(n); });
    d.appendChild(body);
    made.push(d);
  });
  if (!made.length) return;

  var bar = el("div", "hgj-acc-bar");
  bar.appendChild(el("h2", "hgj-h", "פירוט מלא"));
  var all = el("button", "hgj-acc-all", "פתיחת הכל");
  all.type = "button";
  all.setAttribute("aria-expanded", "false");
  all.addEventListener("click", function () {
    var open = all.getAttribute("aria-expanded") !== "true";
    made.forEach(function (d) { d.open = open; });
    all.setAttribute("aria-expanded", String(open));
    all.textContent = open ? "סגירת הכל" : "פתיחת הכל";
  });
  bar.appendChild(all);
  page.insertBefore(bar, made[0]);

  function openForHash() {
    if (location.hash.length < 2) return;
    var t;
    try { t = document.getElementById(decodeURIComponent(location.hash.slice(1))); } catch (e) { return; }
    var d = t && t.closest("details.hgj-acc");
    if (d) { d.open = true; t.scrollIntoView(); }
  }
  openForHash();
  window.addEventListener("hashchange", openForHash);
  window.addEventListener("beforeprint", function () { made.forEach(function (d) { d.open = true; }); });
})();
