// The theme before first paint: the visitor's stored choice on this site (shared with the landing page),
// else the system's. A separate file, not inline, so the page's CSP can forbid inline scripts.
try {
  var t = localStorage.getItem("parva-lp-theme");
  if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
} catch (e) {}
