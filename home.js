/* דף הבית של אתר הכלים: ספירת כלים, חיפוש וסינון לפי תחום, הטיית כרטיסים וסרטון הכדור. בלי תלויות. */
(function () {
  "use strict";
  var root = document.documentElement;
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  function still() { return reduce.matches || root.classList.contains("a11y-nomotion"); }

  function countLabel(n) { return n === 1 ? "כלי אחד" : n === 2 ? "שני כלים" : n + " כלים"; }

  // ספירה: מתעדכנת לבד כשמוסיפים כרטיס
  var groups = Array.prototype.slice.call(document.querySelectorAll(".group"));
  var total = 0;
  groups.forEach(function (g) {
    var cards = g.querySelectorAll(".card");
    total += cards.length;
    var c = g.querySelector(".group-count");
    if (c) c.textContent = countLabel(cards.length);
    var n = document.querySelector('[data-count="' + g.dataset.cat + '"]');
    if (n) n.textContent = cards.length;
    Array.prototype.forEach.call(cards, function (card, i) { card.style.setProperty("--i", i); });
  });
  var all = document.querySelector('[data-count="all"]');
  if (all) all.textContent = total;

  // סינון לפי תחום וחיפוש חופשי, יחד
  var buttons = Array.prototype.slice.call(document.querySelectorAll(".filters button"));
  var q = document.getElementById("q"), status = document.getElementById("q-status"), empty = document.getElementById("empty");
  var filter = "all";
  function norm(t) { return (t || "").toLowerCase().replace(/[֑-ׇ"'׳״.,:\-()]/g, " ").replace(/\s+/g, " ").trim(); }
  Array.prototype.forEach.call(document.querySelectorAll(".card"), function (c) { c.dataset.text = norm(c.textContent); });
  function apply() {
    var words = norm(q ? q.value : "").split(" ").filter(Boolean), shown = 0;
    groups.forEach(function (g) {
      var inCat = filter === "all" || g.dataset.cat === filter, n = 0;
      Array.prototype.forEach.call(g.querySelectorAll(".card"), function (c) {
        var ok = inCat && words.every(function (w) { return c.dataset.text.indexOf(w) > -1; });
        c.hidden = !ok; if (ok) n++;
      });
      g.hidden = n === 0; shown += n;
    });
    if (empty) empty.hidden = shown > 0;
    if (status) status.textContent = words.length || filter !== "all" ? (shown ? "מוצגים " + countLabel(shown) : "לא נמצא כלי מתאים") : "";
  }
  buttons.forEach(function (b) {
    b.addEventListener("click", function () {
      filter = b.dataset.filter;
      buttons.forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      apply();
    });
  });
  if (q) q.addEventListener("input", apply);
  var resetBtn = document.getElementById("empty-reset");
  if (resetBtn) resetBtn.addEventListener("click", function () {
    if (q) q.value = ""; filter = "all";
    buttons.forEach(function (x) { x.setAttribute("aria-pressed", String(x.dataset.filter === "all")); });
    apply(); if (q) q.focus();
  });
  function focusSearch() { if (!q) return; q.scrollIntoView({ block: "center", behavior: still() ? "auto" : "smooth" }); q.focus({ preventScroll: true }); }
  var jump = document.getElementById("search-jump");
  if (jump) jump.addEventListener("click", focusSearch);
  document.addEventListener("keydown", function (e) {
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target; if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    e.preventDefault(); focusSearch();
  });

  // הטיית כרטיס לכיוון העכבר
  var fine = window.matchMedia("(hover: hover) and (pointer: fine)");
  Array.prototype.forEach.call(document.querySelectorAll(".card"), function (card) {
    card.addEventListener("pointermove", function (e) {
      if (!fine.matches || still()) return;
      var r = card.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      card.style.setProperty("--ry", ((x - 0.5) * 10).toFixed(2) + "deg");
      card.style.setProperty("--rx", ((0.5 - y) * 8).toFixed(2) + "deg");
      card.style.setProperty("--mx", (x * 100).toFixed(1) + "%");
      card.style.setProperty("--my", (y * 100).toFixed(1) + "%");
    });
    card.addEventListener("pointerleave", function () {
      card.style.setProperty("--rx", "0deg");
      card.style.setProperty("--ry", "0deg");
    });
  });

  // מתג בהיר/כהה: נשמר במכשיר (hgj-theme) וחל על כל דפי האתר
  var tb = document.getElementById("theme-btn"), tc = document.querySelector('meta[name="theme-color"]');
  if (tb) {
    var paintTheme = function () {
      var dark = root.getAttribute("data-theme") === "dark";
      tb.setAttribute("aria-pressed", String(dark));
      tb.setAttribute("aria-label", dark ? "מעבר למצב בהיר" : "מעבר למצב כהה");
      if (tc) tc.setAttribute("content", dark ? "#0A2236" : "#EAF4FA");
    };
    tb.addEventListener("click", function () {
      var next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("hgj-theme", next); } catch (e) {}
    });
    new MutationObserver(paintTheme).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    paintTheme();
  }

  // סרטון הכדור: מתנגן רק כשאין העדפה להפחתת תנועה, ונעצר בכפתור או ב"עצירת אנימציות" בתפריט הנגישות
  var video = document.getElementById("hero-video"), mbtn = document.getElementById("motion-btn");
  if (video && mbtn) {
    var choice = null; // null = לפי העדפות התנועה; true/false = המשתמש לחץ על הכפתור
    var sync = function () {
      var stop = choice !== null ? choice : still();
      if (stop) video.pause();
      else { var pr = video.play(); if (pr && pr.catch) pr.catch(function () {}); }
      mbtn.setAttribute("aria-pressed", String(stop));
      mbtn.setAttribute("aria-label", stop ? "הפעלת ההנפשה" : "עצירת ההנפשה");
    };
    var reset = function () { choice = null; sync(); };
    mbtn.addEventListener("click", function () { choice = mbtn.getAttribute("aria-pressed") !== "true"; sync(); });
    if (reduce.addEventListener) reduce.addEventListener("change", reset);
    new MutationObserver(reset).observe(root, { attributes: true, attributeFilter: ["class"] });
    document.addEventListener("visibilitychange", function () { if (document.hidden) video.pause(); else sync(); });
    sync();
  }

  // הסצנה זזה מעט עם העכבר
  var hero = document.querySelector(".hero"), scene = document.getElementById("scene");
  if (hero && scene) {
    hero.addEventListener("pointermove", function (e) {
      if (!fine.matches || still()) return;
      var r = hero.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      scene.style.setProperty("--px", (x * 14).toFixed(2) + "deg");
      scene.style.setProperty("--py", (-y * 8).toFixed(2) + "deg");
    });
    hero.addEventListener("pointerleave", function () {
      scene.style.setProperty("--px", "0deg");
      scene.style.setProperty("--py", "0deg");
    });
  }
})();
