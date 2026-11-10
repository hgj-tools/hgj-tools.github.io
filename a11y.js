/* תפריט נגישות של אתר הכלים. קובץ אחד, בלי תלויות ובלי שרת חיצוני.
   שימוש בכל דף: <script src="/a11y.js" defer></script>. הבחירות נשמרות במכשיר בלבד (localStorage). */
(function () {
  "use strict";
  if (window.__hgjA11y) return;
  window.__hgjA11y = true;

  var KEY = "hgj-a11y", root = document.documentElement;
  var SIZES = [100, 112, 125, 140];
  var state = { size: 0, contrast: false, links: false, font: false, nomotion: false, focus: false, headings: false };
  try { var s = JSON.parse(localStorage.getItem(KEY) || "{}"); for (var k in state) if (k in s) state[k] = s[k]; } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }

  var css = [
    "html.a11y-contrast body,html.a11y-contrast body *:not(img):not(svg):not(svg *){background:#000!important;background-image:none!important;color:#fff!important;border-color:#fff!important;box-shadow:none!important;text-shadow:none!important;-webkit-text-fill-color:currentColor!important}",
    "html.a11y-contrast a,html.a11y-contrast a *,html.a11y-contrast button{color:#ffe600!important}",
    "html.a11y-contrast body *::before,html.a11y-contrast body *::after{background:none!important}",
    "html.a11y-contrast input,html.a11y-contrast textarea,html.a11y-contrast select,html.a11y-contrast button{border:1px solid #fff!important}",
    "html.a11y-contrast ::placeholder{color:#d9d9d9!important;opacity:1}",
    "html.a11y-focus *:focus,html.a11y-focus *:focus-visible{outline:3px solid #c00000!important;outline-offset:3px!important}",
    "html.a11y-contrast.a11y-focus *:focus,html.a11y-contrast.a11y-focus *:focus-visible{outline-color:#ff5252!important}",
    "html.a11y-headings h1,html.a11y-headings h2,html.a11y-headings h3,html.a11y-headings h4{outline:2px dashed #c00000!important;outline-offset:6px!important}",
    "html.a11y-links a{text-decoration:underline!important;text-decoration-thickness:2px!important;outline:2px solid currentColor!important;outline-offset:3px!important}",
    "html.a11y-font body,html.a11y-font body *{font-family:Arial,Helvetica,sans-serif!important;letter-spacing:.02em!important;line-height:1.75!important}",
    "html.a11y-nomotion *,html.a11y-nomotion *::before,html.a11y-nomotion *::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}",
    "#hgj-a11y-btn{position:fixed;left:16px;bottom:var(--hgj-a11y-bottom,16px);z-index:2147483000;width:54px;height:54px;border-radius:50%;border:2px solid #fff;background:#014F6C;color:#fff;cursor:pointer;display:grid;place-items:center;box-shadow:0 8px 24px rgba(0,0,0,.35);padding:0}",
    "#hgj-a11y-btn:focus-visible,#hgj-a11y-panel button:focus-visible,#hgj-a11y-panel a:focus-visible{outline:3px solid #ffbf47;outline-offset:2px}",
    "#hgj-a11y-btn svg{width:30px;height:30px}",
    "#hgj-a11y-panel{position:fixed;left:16px;bottom:calc(var(--hgj-a11y-bottom,16px) + 64px);z-index:2147483000;width:min(320px,calc(100vw - 32px));max-height:calc(100vh - 100px);overflow:auto;direction:rtl;text-align:right;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.4;background:#fff;color:#111;border:2px solid #014F6C;border-radius:16px;box-shadow:0 20px 50px rgba(0,0,0,.4);padding:16px}",
    "#hgj-a11y-panel[hidden]{display:none}",
    "#hgj-a11y-panel h2{margin:0 0 12px;font-size:18px;font-weight:700;color:#111}",
    "#hgj-a11y-panel .a11y-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}",
    "#hgj-a11y-panel button{font:inherit;font-size:15px;min-height:48px;padding:8px 10px;border-radius:10px;border:2px solid #014F6C;background:#fff;color:#014F6C;cursor:pointer;font-weight:700}",
    "#hgj-a11y-panel button[aria-pressed=true]{background:#014F6C;color:#fff}",
    "#hgj-a11y-panel .a11y-wide{grid-column:1/-1}",
    "#hgj-a11y-panel .a11y-reset{border-color:#555;color:#222}",
    "#hgj-a11y-panel a{display:block;margin-top:12px;color:#014F6C;font-weight:700}",
    "#hgj-a11y-panel p{margin:0 0 10px;font-size:14px;color:#333}"
  ].join("\n");
  var st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);

  function apply() {
    root.style.fontSize = state.size ? SIZES[state.size] + "%" : "";
    root.classList.toggle("a11y-contrast", !!state.contrast);
    root.classList.toggle("a11y-links", !!state.links);
    root.classList.toggle("a11y-font", !!state.font);
    root.classList.toggle("a11y-nomotion", !!state.nomotion);
    root.classList.toggle("a11y-focus", !!state.focus);
    root.classList.toggle("a11y-headings", !!state.headings);
  }
  apply();

  function build() {
    var btn = document.createElement("button");
    btn.id = "hgj-a11y-btn"; btn.type = "button";
    btn.setAttribute("aria-label", "תפריט נגישות");
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-controls", "hgj-a11y-panel");
    var NS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("fill", "currentColor"); svg.setAttribute("aria-hidden", "true");
    var c = document.createElementNS(NS, "circle"); c.setAttribute("cx", "12"); c.setAttribute("cy", "4.2"); c.setAttribute("r", "2.1");
    var p = document.createElementNS(NS, "path");
    p.setAttribute("d", "M21 8.2c0 .6-.4 1-1 1.1l-5 .8v3.6l1.9 6.7c.2.6-.2 1.2-.8 1.4-.6.2-1.2-.2-1.4-.8L12.9 15h-1.8l-1.8 6c-.2.6-.8 1-1.4.8-.6-.2-1-.8-.8-1.4L9 13.700V10.100l-5-.8c-.6-.1-1-.6-.9-1.200.1-.6.6-1 1.200-.9 2.600.4 5.100.7 7.700.7s5.100-.3 7.700-.7c.7-.1 1.300.4 1.300 1z");
    svg.appendChild(c); svg.appendChild(p); btn.appendChild(svg);

    var panel = document.createElement("div");
    panel.id = "hgj-a11y-panel"; panel.hidden = true;
    panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "הגדרות נגישות");
    var h = document.createElement("h2"); h.textContent = "נגישות"; panel.appendChild(h);
    var note = document.createElement("p"); note.textContent = "הבחירות נשמרות במכשיר זה בלבד."; panel.appendChild(note);
    var grid = document.createElement("div"); grid.className = "a11y-grid"; panel.appendChild(grid);

    function mk(label, cls) { var b = document.createElement("button"); b.type = "button"; b.textContent = label; if (cls) b.className = cls; grid.appendChild(b); return b; }
    var bigger = mk("הגדלת טקסט"), smaller = mk("הקטנת טקסט");
    var toggles = [
      ["contrast", "ניגודיות גבוהה"], ["links", "הדגשת קישורים"],
      ["font", "גופן קריא"], ["nomotion", "עצירת אנימציות"],
      ["focus", "הדגשת מיקוד מקלדת"], ["headings", "סימון כותרות"]
    ].map(function (t) {
      var b = mk(t[1]);
      b.addEventListener("click", function () { state[t[0]] = !state[t[0]]; refresh(); });
      return [t[0], b];
    });
    var reset = mk("איפוס ההגדרות", "a11y-wide a11y-reset");
    var live = document.createElement("div");
    live.setAttribute("role", "status"); live.setAttribute("aria-live", "polite");
    live.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)";
    panel.appendChild(live);

    var a = document.createElement("a");
    var onHome = !!document.querySelector('a[href="policy/"]');
    a.href = (onHome ? "policy/" : "../policy/") + "#accessibility";
    a.textContent = "הצהרת הנגישות"; panel.appendChild(a);

    function refresh() {
      apply(); save();
      toggles.forEach(function (t) { t[1].setAttribute("aria-pressed", String(!!state[t[0]])); });
      bigger.disabled = state.size >= SIZES.length - 1;
      smaller.disabled = state.size <= 0;
      live.textContent = "גודל טקסט " + SIZES[state.size] + " אחוז";
    }
    bigger.addEventListener("click", function () { if (state.size < SIZES.length - 1) { state.size++; refresh(); } });
    smaller.addEventListener("click", function () { if (state.size > 0) { state.size--; refresh(); } });
    reset.addEventListener("click", function () { state = { size: 0, contrast: false, links: false, font: false, nomotion: false, focus: false, headings: false }; refresh(); });

    function open(v) {
      panel.hidden = !v; btn.setAttribute("aria-expanded", String(v));
      if (v) bigger.disabled ? smaller.focus() : bigger.focus(); else btn.focus();
    }
    btn.addEventListener("click", function () { open(panel.hidden); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !panel.hidden) open(false); });
    document.addEventListener("click", function (e) { if (!panel.hidden && !panel.contains(e.target) && !btn.contains(e.target)) { panel.hidden = true; btn.setAttribute("aria-expanded", "false"); } });

    document.body.appendChild(btn);
    document.body.appendChild(panel);
    refresh();
  }
  if (document.body) build(); else document.addEventListener("DOMContentLoaded", build);
})();
