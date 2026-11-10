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

  var parts = location.pathname.replace(/index\.html$/, "").split("/").filter(Boolean);
  var slug = parts[parts.length - 1];

  // 0א. בכותרת הכלי: אריח אייקון, אותו אייקון כמו בכרטיס בדף הבית, במקום האימוג'י
  var ICONS = {
    "privacy-survey": '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
    "data-masking": '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
    "pii-redactor": '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20C5 20 1 12 1 12a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>',
    "financial-statement-proofreader": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 15l2 2 4-4"/>',
    "audit-standards-toolkit": '<path d="M12 3v18"/><path d="M5 7h14"/><path d="M8 7l-3 6h6z"/><path d="M16 7l3 6h-6z"/><path d="M8 21h8"/>',
    "dictation": '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/>',
    "dictation-desktop": '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/><path d="M12 6.5a1.6 1.6 0 0 0-1.6 1.6v3a1.6 1.6 0 0 0 3.2 0v-3A1.6 1.6 0 0 0 12 6.5z"/><path d="M15.5 11.2a3.5 3.5 0 0 1-7 0"/>'
  };
  var title = document.querySelector("header .title");
  if (title && ICONS[slug] && !title.querySelector(".hgj-title-ico")) {
    // מסיר אימוג'י וסימני וריאציה בתחילת הכותרת, גם כשהם בתוך תג פנימי
    var walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
    var first = walker.nextNode();
    while (first && !first.nodeValue.trim()) first = walker.nextNode();
    if (first) first.nodeValue = first.nodeValue.replace(/^[\s\p{Extended_Pictographic}☀-➿️‍]+/u, "");
    var tile = document.createElement("span");
    tile.className = "hgj-title-ico";
    tile.setAttribute("aria-hidden", "true");
    tile.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ICONS[slug] + "</svg>";
    title.insertBefore(tile, title.firstChild);
  }

  var page = document.querySelector(".page");
  if (!page) return;

  // אפקט כניסה בגלילה (reveal.js). נטען אחרי שהסקריפט הזה סיים לסדר את הדף.
  var rv = document.createElement("script");
  rv.src = "../reveal.js";
  document.head.appendChild(rv);

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

  var cfg = PAGES[slug] || {};

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
