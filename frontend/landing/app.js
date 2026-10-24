// Landing page: a real, editable, runnable editor in the hero, plus honest degradation when the connected
// backend can't do accounts/certificates.
(function () {
  var cfg = window.DRACOSKILL_CONFIG || {};
  var base = (cfg.BACKEND_URL || '').replace(/\/$/, '');
  var LABEL = { python: 'Python', javascript: 'JavaScript', java: 'Java', c: 'C', cpp: 'C++' };

  // The same task in five languages, so switching tabs shows the same idea in a different syntax.
  var SAMPLES = {
    python: 'def fibonacci(n):\n    a, b = 0, 1\n    for _ in range(n):\n        yield a\n        a, b = b, a + b\n\nprint(list(fibonacci(10)))\n',
    javascript: 'function* fibonacci(n) {\n  let [a, b] = [0, 1];\n  for (let i = 0; i < n; i++) {\n    yield a;\n    [a, b] = [b, a + b];\n  }\n}\n\nconsole.log([...fibonacci(10)].join(", "));\n',
    java: 'public class Main {\n    public static void main(String[] args) {\n        long a = 0, b = 1;\n        StringBuilder out = new StringBuilder();\n        for (int i = 0; i < 10; i++) {\n            out.append(a).append(i < 9 ? ", " : "");\n            long next = a + b;\n            a = b;\n            b = next;\n        }\n        System.out.println(out);\n    }\n}\n',
    c: '#include <stdio.h>\n\nint main(void) {\n    long long a = 0, b = 1;\n    for (int i = 0; i < 10; i++) {\n        printf("%lld%s", a, i < 9 ? ", " : "\\n");\n        long long next = a + b;\n        a = b;\n        b = next;\n    }\n    return 0;\n}\n',
    cpp: '#include <iostream>\n\nint main() {\n    long long a = 0, b = 1;\n    for (int i = 0; i < 10; i++) {\n        std::cout << a << (i < 9 ? ", " : "\\n");\n        long long next = a + b;\n        a = b;\n        b = next;\n    }\n}\n'
  };
  var edits = {};               // keep what the visitor typed per language while they switch tabs
  var lang = 'python';
  var ta = document.getElementById('live-code');
  var out = document.getElementById('live-out');
  var runBtn = document.getElementById('live-run');
  var runLabel = document.getElementById('live-run-label');
  var result = document.getElementById('live-result');
  var ed = DracoEditor.attach(ta, { lang: lang, className: 'live-ed' });
  ta.value = SAMPLES.python;

  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  function show(html) { out.innerHTML = html; }

  document.querySelectorAll('.live-tab').forEach(function (b) {
    b.addEventListener('click', function () {
      edits[lang] = ta.value;
      lang = b.dataset.lang;
      document.querySelectorAll('.live-tab').forEach(function (x) { var on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-selected', on ? 'true' : 'false'); });
      ed.setLang(lang);
      ta.value = edits[lang] !== undefined ? edits[lang] : SAMPLES[lang];
      show('Press Run to run this ' + LABEL[lang] + ' program on a real server.');
    });
  });

  function run() {
    if (runBtn.disabled) return;
    if (!base) { show('<span class="e">No backend is configured, so nothing can run yet.</span>'); return; }
    runBtn.disabled = true; runLabel.textContent = 'Running';
    result.classList.add('is-running');
    show('<span class="m">' + (lang === 'java' || lang === 'c' || lang === 'cpp' ? 'Compiling and running…' : 'Running…') + '</span>');
    fetch(base + '/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: lang, code: ta.value, stdin: '' }) })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (x) {
        var d = x.d;
        if (d.error) { show('<span class="e">' + esc(d.error) + '</span>'); return; }
        if (d.compileError) { show('<span class="e">Compilation failed\n\n' + esc(d.stderr) + '</span>'); return; }
        var h = '';
        if (d.stdout) h += '<span class="o">' + esc(d.stdout.replace(/\n$/, '')) + '</span>';
        if (d.stderr) h += (h ? '\n' : '') + '<span class="e">' + esc(d.stderr.replace(/\n$/, '')) + '</span>';
        if (!h) h = '<span class="m">The program finished and printed nothing.</span>';
        h += '\n\n<span class="m">Ran in ' + d.timeMs + ' ms' + (typeof d.exitCode === 'number' && d.exitCode !== 0 ? ', exited with code ' + d.exitCode : '') + '.</span>';
        show(h);
      })
      .catch(function () { show('<span class="e">The code-running backend did not answer. Check your connection and try again.</span>'); })
      .then(function () { runBtn.disabled = false; runLabel.textContent = 'Run'; result.classList.remove('is-running'); });
  }
  runBtn.addEventListener('click', run);
  ta.addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); } });

  // What can this backend actually do? Adjust the page to match instead of promising more.
  var chip = document.getElementById('rt-chip');
  if (!base) { chip.textContent = 'No backend connected'; chip.className = 'chip down'; return; }
  fetch(base + '/sandboxes').then(function (r) { return r.json(); }).then(function (d) {
    var langs = (d.sandboxes || []).filter(function (s) { return s.id !== 'terminal'; });
    var ready = langs.filter(function (s) { return s.available; }).length;
    chip.textContent = ready + ' of ' + langs.length + ' languages ready';
    chip.className = 'chip ' + (ready === langs.length ? 'ready' : 'partial');
    if (d.features && d.features.accounts === false) document.body.classList.add('limited');
  }).catch(function () { chip.textContent = 'Backend unreachable'; chip.className = 'chip down'; });
})();
