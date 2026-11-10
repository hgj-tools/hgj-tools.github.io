/* אפקט כניסה בגלילה לאתר הכלים: רכיב מתחיל שקוף ו-40 פיקסלים מתחת למקומו, ועולה למקום
   כשהחלק העליון שלו מגיע ל-85% מגובה המסך. רכיבים שנכנסים יחד מופיעים בהפרש קצר זה מזה,
   וכשגוללים חזרה למעלה הם מתאפסים כדי להיכנס שוב. בלי ספריות.
   לא פועל אצל מי שביקש הפחתת תנועה (במחשב או ב"עצירת אנימציות" בתפריט הנגישות), ובלי JavaScript הכל גלוי. */
(function () {
  "use strict";
  if (!("IntersectionObserver" in window)) return;
  var root = document.documentElement;
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (reduce.matches || root.classList.contains("a11y-nomotion")) return;

  // דף הבית, ודפי הכלים שיש בהם .page. לא בממשק של כלי עובד (הכתבה, סיור), שם תנועה מפריעה לעבודה.
  var SELECTOR = [
    ".finder", ".group-head", ".grid > .card", "footer > .wrap",
    ".page > .hgj-glance", ".hgj-steps > li", ".page > .card", ".page > .warn", ".page > .ok",
    ".hgj-acc-bar", ".page > details.hgj-acc"
  ].join(",");

  var css = document.createElement("style");
  css.textContent =
    "html.rv-on .rv{opacity:0;translate:0 40px;transition:opacity .8s cubic-bezier(.215,.61,.355,1) var(--rv-d,0s),translate .8s cubic-bezier(.215,.61,.355,1) var(--rv-d,0s),transform .25s cubic-bezier(.2,.7,.2,1),box-shadow .25s ease,border-color .25s ease,background .2s ease}" +
    "html.rv-on .rv.in{opacity:1;translate:none}" +
    "html.a11y-nomotion .rv,html.rv-print .rv{opacity:1!important;translate:none!important;transition:none!important}";
  document.head.appendChild(css);

  function start() {
    var items = Array.prototype.slice.call(document.querySelectorAll(SELECTOR));
    if (!items.length) return;
    items.forEach(function (el) { el.classList.add("rv"); });
    root.classList.add("rv-on");

    var io = new IntersectionObserver(function (entries) {
      var entering = [];
      entries.forEach(function (e) {
        if (e.isIntersecting) entering.push(e.target);
        else if (e.boundingClientRect.top > 0) { e.target.classList.remove("in"); e.target.style.removeProperty("--rv-d"); }
      });
      // סדר לפי מיקום בדף, ומדרגה של 0.12 שנייה בין רכיבים שנכנסים יחד (עד 0.6 שנייה)
      entering.sort(function (a, b) { return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1; });
      entering.forEach(function (el, i) {
        el.style.setProperty("--rv-d", Math.min(i * 0.12, 0.6).toFixed(2) + "s");
        el.classList.add("in");
      });
    }, { rootMargin: "0px 0px -15% 0px", threshold: 0 });
    items.forEach(function (el) { io.observe(el); });

    window.addEventListener("beforeprint", function () { root.classList.add("rv-print"); });
    window.addEventListener("afterprint", function () { root.classList.remove("rv-print"); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
