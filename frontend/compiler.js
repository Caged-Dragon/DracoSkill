// DracoSkill online compiler: one page. Everything the page does is here.
(function () {
  'use strict';
  var cfg = window.DRACOSKILL_CONFIG || {};
  var base = (cfg.BACKEND_URL || '').replace(/\/$/, '');

  var LANGS = {
    python:     { label: 'Python',     file: 'main.py',   dot: '#6FB3D9' },
    javascript: { label: 'JavaScript', file: 'main.js',   dot: '#E5C14F' },
    java:       { label: 'Java',       file: 'Main.java', dot: '#E8955A' },
    c:          { label: 'C',          file: 'main.c',    dot: '#8FA4F0' },
    cpp:        { label: 'C++',        file: 'main.cpp',  dot: '#B58CF0' }
  };
  var SAMPLES = {
    python: 'name = input("What is your name? ")\nprint(f"Hello, {name or \'world\'}!")\n',
    javascript: 'const name = require("fs").readFileSync(0, "utf8").trim();\nconsole.log(`Hello, ${name || "world"}!`);\n',
    java: 'import java.util.Scanner;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner in = new Scanner(System.in);\n        String name = in.hasNextLine() ? in.nextLine().trim() : "";\n        System.out.println("Hello, " + (name.isEmpty() ? "world" : name) + "!");\n    }\n}\n',
    c: '#include <stdio.h>\n#include <string.h>\n\nint main(void) {\n    char name[100] = "";\n    if (fgets(name, sizeof name, stdin)) name[strcspn(name, "\\n")] = 0;\n    printf("Hello, %s!\\n", name[0] ? name : "world");\n    return 0;\n}\n',
    cpp: '#include <iostream>\n#include <string>\n\nint main() {\n    std::string name;\n    std::getline(std::cin, name);\n    std::cout << "Hello, " << (name.empty() ? "world" : name) << "!" << std::endl;\n    return 0;\n}\n'
  };

  var $ = function (id) { return document.getElementById(id); };
  var ta = $('code'), stdin = $('stdin'), out = $('out'), outPane = $('out-pane');
  var runBtn = $('run-btn'), runLabel = $('run-label');
  var lang = 'python';
  var lastOutput = '';

  // ---------- storage (every access guarded: private mode / blocked storage must never break the page) ----------
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function save(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }

  // ---------- editor ----------
  var ed = DracoEditor.attach(ta, {
    lang: lang,
    onCursor: function (l, c) { $('sb-pos').textContent = 'Line ' + l + ', column ' + c; },
    onChange: function () { scheduleSave(); }
  });
  var saveTimer = null;
  function scheduleSave() {
    $('sb-saved').textContent = 'Saving…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      var ok = save('draco:code:' + lang, ta.value);
      $('sb-saved').textContent = ok ? 'Saved in this browser' : 'Not saved (browser storage is blocked)';
    }, 350);
  }

  function flushSave() { clearTimeout(saveTimer); save('draco:code:' + lang, ta.value); }
  window.addEventListener('pagehide', flushSave);
  document.addEventListener('visibilitychange', function () { if (document.hidden) flushSave(); });

  function fileName() {
    if (lang === 'java') { var m = /public\s+(?:final\s+|abstract\s+)*(?:class|interface|enum|record)\s+(\w+)/.exec(ta.value); return (m ? m[1] : 'Main') + '.java'; }
    return LANGS[lang].file;
  }
  function refreshChrome() {
    $('fname').textContent = fileName();
    $('file-dot').style.background = LANGS[lang].dot;
    $('sb-lang').textContent = LANGS[lang].label;
  }
  ta.addEventListener('input', refreshChrome);

  function setLang(next, opts) {
    opts = opts || {};
    if (!LANGS[next]) next = 'python';
    if (!opts.initial) { clearTimeout(saveTimer); save('draco:code:' + lang, ta.value); }
    lang = next;
    save('draco:lang', lang);
    document.querySelectorAll('.lang-tab').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.lang === lang ? 'true' : 'false'); });
    ed.setLang(lang);
    var stored = opts.code !== undefined ? opts.code : load('draco:code:' + lang);
    ta.value = stored !== null && stored !== undefined && stored !== '' ? stored : SAMPLES[lang];
    refreshChrome();
    if (!opts.initial) setOutput('<span class="m">Run your ' + LANGS[lang].label + ' code to see its output here.</span>', '');
  }
  document.querySelectorAll('.lang-tab').forEach(function (b) { b.addEventListener('click', function () { setLang(b.dataset.lang); }); });

  // ---------- output ----------
  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  function setOutput(html, plain) { out.innerHTML = html; lastOutput = plain; }

  function render(d) {
    if (d.error) { setOutput('<span class="e">' + esc(d.error) + '</span>', d.error); return; }
    if (d.compileError) { setOutput('<span class="e">Compilation failed\n\n' + esc(d.stderr) + '</span>', 'Compilation failed\n\n' + d.stderr); return; }
    var html = '', plain = '';
    var warn = d.compile && (d.compile.stderr || d.compile.stdout);
    if (warn) { html += '<span class="m">' + esc(warn.trimEnd()) + '</span>\n\n'; plain += warn.trimEnd() + '\n\n'; }
    if (d.stdout) { html += '<span class="o">' + esc(d.stdout.replace(/\n$/, '')) + '</span>'; plain += d.stdout.replace(/\n$/, ''); }
    if (d.stderr) { html += (d.stdout ? '\n' : '') + '<span class="e">' + esc(d.stderr.replace(/\n$/, '')) + '</span>'; plain += (d.stdout ? '\n' : '') + d.stderr.replace(/\n$/, ''); }
    if (!d.stdout && !d.stderr) html += '<span class="m">The program finished and printed nothing.</span>';
    if (d.truncated) html += '\n<span class="m">Output was cut off at 20,000 characters.</span>';
    var bits = [];
    if (d.compile) bits.push('Compiled in ' + d.compile.timeMs + ' ms');
    bits.push((bits.length ? 'ran' : 'Ran') + ' in ' + d.timeMs + ' ms');
    if (typeof d.exitCode === 'number' && d.exitCode !== 0) bits.push('exited with code ' + d.exitCode);
    html += '\n\n<span class="m">' + esc(bits.join(', ')) + '.</span>';
    setOutput(html, plain);
  }

  // ---------- run ----------
  function run() {
    if (runBtn.disabled) return;
    if (!base) { setOutput('<span class="e">No backend address is configured, so nothing can run. Set BACKEND_URL in assets/config.js.</span>', ''); return; }
    if (!navigator.onLine) { setOutput('<span class="e">You are offline. Your code is saved on this device. Reconnect to run it.</span>', ''); return; }
    runBtn.disabled = true; runLabel.textContent = 'Running';
    outPane.classList.add('is-running');
    setOutput('<span class="m">' + (lang === 'java' || lang === 'c' || lang === 'cpp' ? 'Compiling and running…' : 'Running…') + '</span>', '');
    fetch(base + '/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: lang, code: ta.value, stdin: stdin.value }) })
      .then(function (r) { return r.json(); })
      .then(render)
      .catch(function () { setOutput('<span class="e">The code-running server did not answer. Check your connection and try again.</span>', ''); })
      .then(function () { runBtn.disabled = false; runLabel.textContent = 'Run'; outPane.classList.remove('is-running'); });
  }
  runBtn.addEventListener('click', run);
  document.addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); } });
  var mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
  $('run-kbd').textContent = mac ? '\u2318\u21B5' : 'Ctrl+Enter';
  runBtn.title = 'Run (' + (mac ? 'Cmd' : 'Ctrl') + '+Enter)';

  $('clear-out').addEventListener('click', function () { setOutput('', ''); });
  function toast(msg) { var t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { t.hidden = true; }, 2200); }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var x = document.createElement('textarea'); x.value = text; x.style.position = 'fixed'; x.style.opacity = '0'; document.body.appendChild(x); x.select();
      try { document.execCommand('copy') ? resolve() : reject(); } catch (e) { reject(e); } document.body.removeChild(x);
    });
  }
  $('copy-out').addEventListener('click', function () {
    if (!lastOutput) { toast('There is no output to copy yet'); return; }
    copyText(lastOutput).then(function () { toast('Output copied'); }, function () { toast('Could not copy. Select the text and copy it.'); });
  });

  // ---------- download / share / reset ----------
  $('download-btn').addEventListener('click', function () {
    var blob = new Blob([ta.value], { type: 'text/plain;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fileName(); document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  });

  function b64enc(str) { var bytes = new TextEncoder().encode(str), bin = ''; bytes.forEach(function (b) { bin += String.fromCharCode(b); }); return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function b64dec(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; var bin = atob(s), bytes = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new TextDecoder().decode(bytes); }
  $('share-btn').addEventListener('click', function () {
    var link = location.origin + location.pathname + '#lang=' + lang + '&code=' + b64enc(ta.value);
    if (link.length > 8000) { toast('This program is too long for a link. Use Download instead.'); return; }
    history.replaceState(null, '', link.slice(location.origin.length));
    if (navigator.share && /Android|iPhone|iPad|Mobi/i.test(navigator.userAgent)) {
      navigator.share({ title: 'DracoSkill ' + LANGS[lang].label + ' code', url: link }).catch(function () { /* cancelled */ });
      return;
    }
    copyText(link).then(function () { toast('Link copied. Anyone with it sees this code.'); }, function () { toast('Link is in the address bar. Copy it from there.'); });
  });

  var resetTimer = null;
  $('reset-btn').addEventListener('click', function () {
    var label = $('reset-label');
    if (ta.value === SAMPLES[lang]) { toast('Already the sample program'); return; }
    if (!resetTimer) {                                   // two-step instead of a browser confirm() dialog
      label.textContent = 'Sure?';
      resetTimer = setTimeout(function () { label.textContent = 'Reset'; resetTimer = null; }, 3000);
      return;
    }
    clearTimeout(resetTimer); resetTimer = null; label.textContent = 'Reset';
    ta.value = SAMPLES[lang]; refreshChrome(); scheduleSave(); toast('Back to the sample program');
  });

  // ---------- resizable split (desktop) ----------
  (function () {
    var work = $('work'), sp = $('split');
    var w = load('draco:io-w'); if (w) work.style.setProperty('--io-w', w + 'px');
    function setW(px) { px = Math.max(300, Math.min(px, work.clientWidth - 420)); work.style.setProperty('--io-w', px + 'px'); save('draco:io-w', String(Math.round(px))); }
    sp.addEventListener('pointerdown', function (e) {
      sp.setPointerCapture(e.pointerId); sp.classList.add('drag');
      var x0 = e.clientX, w0 = document.querySelector('.io').getBoundingClientRect().width;
      var mv = function (ev) { setW(w0 + (x0 - ev.clientX)); };
      var up = function () { sp.classList.remove('drag'); sp.removeEventListener('pointermove', mv); sp.removeEventListener('pointerup', up); };
      sp.addEventListener('pointermove', mv); sp.addEventListener('pointerup', up);
    });
    sp.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault(); setW(document.querySelector('.io').getBoundingClientRect().width + (e.key === 'ArrowLeft' ? 32 : -32));
    });
  })();

  // ---------- what can this server run? ----------
  var chip = $('conn-chip'), notice = $('notice');
  function setChip(kind, text) { chip.className = 'chip ' + kind; chip.textContent = text; }
  function checkBackend() {
    if (!base) { setChip('down', 'No backend'); return; }
    if (!navigator.onLine) { setChip('down', 'Offline'); notice.hidden = true; return; }
    fetch(base + '/sandboxes').then(function (r) { return r.json(); }).then(function (d) {
      var list = d.sandboxes || [], ready = list.filter(function (s) { return s.available; }).length;
      var inferred = d.isolation && d.isolation.inferred;
      list.forEach(function (s) {
        var tab = document.querySelector('.lang-tab[data-lang="' + s.id + '"]'); if (!tab) return;
        var state = s.available ? 'ready' : (s.verified === false ? 'setup' : 'off');
        tab.classList.remove('ready', 'setup', 'off'); tab.classList.add(state);
        tab.title = s.label + (s.version ? ', ' + s.version : '') + (s.available ? ', ready' : (s.verified === false ? ', needs one-time setup' : ', not installed on this server'));
      });
      setChip(ready === list.length ? 'ready' : 'partial', ready + ' of ' + list.length + ' languages ready');
      var missing = list.filter(function (s) { return !s.available; });
      if (missing.length && d.isolation && d.isolation.driver === 'vercel-sandbox') {
        notice.hidden = false;
        notice.innerHTML = esc(missing.map(function (m) { return m.label; }).join(', ')) + ' need a one-time setup on this server. <a href="' + esc(base) + '/setup" target="_blank" rel="noopener">Open the setup page</a>';
      } else if (missing.length) {
        notice.hidden = false; notice.textContent = missing.map(function (m) { return m.label; }).join(', ') + ' are not installed on this server.';
      } else { notice.hidden = true; }
    }).catch(function () { setChip('down', navigator.onLine ? 'Server unreachable' : 'Offline'); });
  }

  // ---------- start: shared link > last session > sample ----------
  var h = (location.hash || '').replace(/^#/, ''), params = {};
  h.split('&').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) params[kv.slice(0, i)] = kv.slice(i + 1); });
  var sharedCode;
  if (params.code) { try { sharedCode = b64dec(params.code); } catch (e) { sharedCode = undefined; } }
  var qLang = ''; try { qLang = new URLSearchParams(location.search).get('lang') || ''; } catch (e) { qLang = ''; }
  var first = LANGS[params.lang] ? params.lang : (LANGS[qLang] ? qLang : (LANGS[load('draco:lang')] ? load('draco:lang') : 'python'));
  setLang(first, { initial: true, code: sharedCode });
  if (sharedCode !== undefined) toast('Loaded the shared code. Press Run to run it.');
  checkBackend();

  // ---------- keyboard help shown only while the editor has focus ----------
  ta.addEventListener('focus', function () { $('sb-hint').hidden = false; });
  ta.addEventListener('blur', function () { $('sb-hint').hidden = true; });

  // ---------- online / offline ----------
  window.addEventListener('offline', function () { setChip('down', 'Offline'); notice.hidden = true; toast('You are offline. You can keep editing; your code is saved.'); });
  window.addEventListener('online', function () { setChip('', 'Reconnecting'); checkBackend(); });

  // ---------- installable app ----------
  var installEvent = null, installBtn = $('install-btn');
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); installEvent = e; installBtn.hidden = false; });
  installBtn.addEventListener('click', function () {
    if (!installEvent) return;
    var ev = installEvent; installEvent = null; installBtn.hidden = true;
    ev.prompt();
  });
  window.addEventListener('appinstalled', function () { installBtn.hidden = true; installEvent = null; toast('DracoSkill is installed'); });

  // ---------- service worker: offline shell + updates only when the visitor agrees ----------
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    var hadController = !!navigator.serviceWorker.controller, reloading = false;
    var bar = $('update-bar'), updateBtn = $('update-btn');
    var showUpdate = function (worker) {
      bar.hidden = false;
      updateBtn.onclick = function () { flushSave(); updateBtn.disabled = true; worker.postMessage('SKIP_WAITING'); };
    };
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController || reloading) return;      // the very first install also "changes" the controller: do not reload then
      reloading = true; location.reload();
    });
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').then(function (reg) {
        if (reg.waiting && navigator.serviceWorker.controller) showUpdate(reg.waiting);
        reg.addEventListener('updatefound', function () {
          var w = reg.installing; if (!w) return;
          w.addEventListener('statechange', function () { if (w.state === 'installed' && navigator.serviceWorker.controller) showUpdate(w); });
        });
        document.addEventListener('visibilitychange', function () { if (!document.hidden) reg.update().catch(function () {}); });
        setInterval(function () { reg.update().catch(function () {}); }, 60 * 60 * 1000);
        window.__draco_sw = reg;                      // exposed so tests can ask for an update check
      }).catch(function () { /* the site works without it */ });
    });
  }
})();
