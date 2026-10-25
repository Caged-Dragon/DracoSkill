// DracoEditor: turns a <textarea> into a code editor with a line-number gutter, syntax colour,
// current-line band, auto-indent and Tab handling. The textarea stays the source of truth, so forms,
// undo/redo, selection, IME and accessibility keep working natively.
(function () {
  var nativeValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');

  function attach(ta, opts) {
    opts = opts || {};
    var lang = opts.lang || 'text';
    var host = ta.parentElement;
    var ed = document.createElement('div');
    ed.className = 'code-ed' + (opts.className ? ' ' + opts.className : '');
    ed.innerHTML = '<div class="code-gutter" aria-hidden="true"><pre></pre></div>' +
                   '<div class="code-body"><div class="code-curline" hidden></div><pre class="code-hl" aria-hidden="true"></pre></div>';
    host.insertBefore(ed, ta);
    var body = ed.querySelector('.code-body');
    var gutter = ed.querySelector('.code-gutter pre');
    var hl = ed.querySelector('.code-hl');
    var cur = ed.querySelector('.code-curline');
    body.appendChild(ta);
    ta.classList.add('code-input');
    ta.setAttribute('wrap', 'off');
    ta.setAttribute('autocomplete', 'off');
    ta.setAttribute('autocapitalize', 'off');
    ta.setAttribute('autocorrect', 'off');
    ta.spellcheck = false;

    var lines = 0;
    function lh() { return parseFloat(getComputedStyle(ed).getPropertyValue('--lh')) || 22; }
    function pad() { return parseFloat(getComputedStyle(ed).getPropertyValue('--pad')) || 14; }

    function syncScroll() {
      hl.scrollTop = ta.scrollTop; hl.scrollLeft = ta.scrollLeft;
      gutter.style.transform = 'translateY(' + (-ta.scrollTop) + 'px)';
      placeCurline();
    }
    function caret() {
      var v = nativeValue.get.call(ta), pos = ta.selectionStart;
      var before = v.slice(0, pos);
      return { line: before.split('\n').length, col: pos - before.lastIndexOf('\n') };
    }
    function placeCurline() {
      if (document.activeElement !== ta || ta.selectionStart !== ta.selectionEnd) { cur.hidden = true; return; }
      cur.hidden = false;
      cur.style.top = (pad() + (caret().line - 1) * lh() - ta.scrollTop) + 'px';
    }
    function updateCursor() {
      placeCurline();
      if (opts.onCursor) { var c = caret(); opts.onCursor(c.line, c.col); }
    }
    function refresh() {
      var v = nativeValue.get.call(ta);
      hl.innerHTML = window.DracoHL.highlight(v, lang);
      var n = v.split('\n').length;
      if (n !== lines) {
        lines = n;
        var s = ''; for (var i = 1; i <= n; i++) s += i + '\n';
        gutter.textContent = s;
      }
      syncScroll();
    }

    // assigning ta.value from code (loading a file) must repaint too
    Object.defineProperty(ta, 'value', {
      configurable: true,
      get: function () { return nativeValue.get.call(ta); },
      set: function (v) { nativeValue.set.call(ta, v); refresh(); updateCursor(); }
    });

    function insert(text) {
      ta.focus();
      var ok = false;
      try { ok = document.execCommand('insertText', false, text); } catch (e) { ok = false; }
      if (!ok) { ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input', { bubbles: true })); }
    }
    function reindent(outdent) {
      var v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
      var ls = v.lastIndexOf('\n', s - 1) + 1;
      var block = v.slice(ls, e);
      var nb = block.split('\n').map(function (l) { return outdent ? l.replace(/^( {1,4}|\t)/, '') : '    ' + l; }).join('\n');
      ta.setSelectionRange(ls, e);
      insert(nb);
      ta.setSelectionRange(ls, ls + nb.length);
    }

    var escaped = false;   // after Esc, the next Tab moves focus instead of inserting spaces (WCAG: no keyboard trap)
    ta.addEventListener('blur', function () { escaped = false; });
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { escaped = true; return; }
      if (e.key === 'Tab' && escaped) { escaped = false; return; }
      if (e.key !== 'Shift' && e.key !== 'Tab') escaped = false;
      if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Tab') {
        e.preventDefault();
        var multi = ta.value.slice(ta.selectionStart, ta.selectionEnd).indexOf('\n') !== -1;
        if (e.shiftKey || multi) reindent(e.shiftKey); else insert('    ');
      } else if (e.key === 'Enter' && !e.shiftKey && ta.selectionStart === ta.selectionEnd) {
        var v = ta.value, pos = ta.selectionStart;
        var ls = v.lastIndexOf('\n', pos - 1) + 1;
        var ind = /^[ \t]*/.exec(v.slice(ls, pos))[0];
        var prev = v[pos - 1], next = v[pos];
        var deeper = prev === '{' || prev === '(' || prev === '[' || (lang === 'python' && prev === ':');
        e.preventDefault();
        if (prev === '{' && next === '}') {
          insert('\n' + ind + '    ' + '\n' + ind);
          var p = pos + 1 + ind.length + 4;
          ta.setSelectionRange(p, p);
        } else {
          insert('\n' + ind + (deeper ? '    ' : ''));
        }
      }
    });
    ta.addEventListener('input', function () { refresh(); updateCursor(); if (opts.onChange) opts.onChange(); });
    ta.addEventListener('scroll', syncScroll);
    ['keyup', 'click', 'focus', 'blur'].forEach(function (ev) { ta.addEventListener(ev, updateCursor); });
    document.addEventListener('selectionchange', function () { if (document.activeElement === ta) updateCursor(); });

    var api = {
      refresh: refresh,
      setLang: function (l) { if (l !== lang) { lang = l; refresh(); } },
      get lang() { return lang; },
      focus: function () { ta.focus(); }
    };
    ta.__draco = api;
    refresh();
    return api;
  }
  window.DracoEditor = { attach: attach };
})();
