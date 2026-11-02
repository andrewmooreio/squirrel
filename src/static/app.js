// Small behaviours for Squirrel. Everything else is HTMX.

// Re-fetch the stock list when the user returns to the app, so counts that
// another person changed appear without a manual reload.
document.addEventListener("visibilitychange", function () {
  if (document.visibilityState !== "visible") return;
  var stock = document.getElementById("stock");
  var filters = document.getElementById("filters");
  if (!stock || !filters || !window.htmx) return;
  // Do not replace the list while someone types a count.
  if (stock.contains(document.activeElement) && document.activeElement.tagName === "INPUT") return;
  var params = new URLSearchParams(new FormData(filters));
  for (var pair of Array.from(params)) {
    if (pair[1] === "") params.delete(pair[0]);
  }
  var qs = params.toString();
  htmx.ajax("GET", "/" + (qs ? "?" + qs : ""), { target: "#stock", swap: "outerHTML" });
});

// Show history times in the viewer's own time zone.
function localiseTimes() {
  document.querySelectorAll("time[data-local]").forEach(function (el) {
    var d = new Date(el.getAttribute("datetime"));
    if (!isNaN(d)) el.textContent = d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  });
}
document.addEventListener("DOMContentLoaded", localiseTimes);
document.addEventListener("htmx:after:swap", localiseTimes);

// Keep the colour theme in step with the system setting (Basecoat uses html.dark).
(function () {
  var mq = window.matchMedia("(prefers-color-scheme: dark)");
  function apply() {
    document.documentElement.classList.toggle("dark", mq.matches);
  }
  apply();
  mq.addEventListener("change", apply);
})();
