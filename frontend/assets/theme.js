// Theme: follow the system until the person chooses; remember the choice. Runs in <head> so there is no flash.
(function () {
  var KEY = 'draco-theme', root = document.documentElement;
  function stored() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function apply(t) {
    root.setAttribute('data-theme', t);
    var m = document.querySelector('meta[name="theme-color"]');       // installed apps tint their title bar with this
    if (m) m.setAttribute('content', t === 'light' ? '#EDEFF3' : '#17161A');
  }
  var t = stored();
  if (t !== 'light' && t !== 'dark') t = (window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
  apply(t);
  function toggle() {
    var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    apply(next);
    try { localStorage.setItem(KEY, next); } catch (e) { /* private mode: the choice just isn't remembered */ }
    document.querySelectorAll('[data-theme-toggle]').forEach(label);
  }
  function label(b) { b.setAttribute('aria-label', root.getAttribute('data-theme') === 'light' ? 'Switch to dark theme' : 'Switch to light theme'); }
  document.addEventListener('DOMContentLoaded', function () {
    apply(root.getAttribute('data-theme'));
    document.querySelectorAll('[data-theme-toggle]').forEach(function (b) { label(b); b.addEventListener('click', toggle); });
  });
  window.DracoTheme = { toggle: toggle };
})();
