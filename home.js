/* דף הבית של אתר הכלים: ספירת כלים, סינון לפי תחום, הטיית כרטיסים והסצנה התלת ממדית. בלי תלויות. */
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

  // סינון
  var buttons = Array.prototype.slice.call(document.querySelectorAll(".filters button"));
  buttons.forEach(function (b) {
    b.addEventListener("click", function () {
      var f = b.dataset.filter;
      buttons.forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      groups.forEach(function (g) {
        var show = f === "all" || g.dataset.cat === f;
        g.hidden = !show;
      });
    });
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
