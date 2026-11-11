/* מחיל את בחירת הבהיר/כהה ששמר המשתמש לפני שהדף מצויר, כדי שלא יהבהב. נטען בראש הדף בלי defer. */
(function () {
  try {
    var t = localStorage.getItem("hgj-theme");
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
  } catch (e) {}
})();
