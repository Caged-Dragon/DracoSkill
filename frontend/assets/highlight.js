// Small, dependency-free syntax highlighter for the five languages DracoSkill runs.
// highlight(code, lang) -> HTML string (already escaped) with <span class="tk-*"> tokens.
(function () {
  var S = {
    pyCom: /#[^\n]*/, cCom: /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/,
    dq: /"(?:\\.|[^"\\\n])*"?/, sq: /'(?:\\.|[^'\\\n])*'?/,
    pyTri: /"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)/, bt: /`(?:\\[\s\S]|[^`\\])*`?/,
    pp: /^[ \t]*#[ \t]*include[ \t]*<[^>\n]*>|^[ \t]*#[ \t]*\w+/,
    num: /\b(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)[fFlLuU]*\b/,
    call: /\b[A-Za-z_]\w*(?=\s*\()/, cap: /\b[A-Z][A-Za-z0-9_]*\b/
  };
  var C_KW = 'auto break case const continue default do else enum extern for goto if inline register restrict return sizeof static struct switch typedef union volatile while NULL true false';
  var KW = {
    python: 'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield',
    javascript: 'async await break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new of return static super switch this throw try typeof var void while with yield null true false undefined',
    java: 'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while var record true false null',
    c: C_KW,
    cpp: C_KW + ' bool class namespace template typename public private protected virtual override new delete this using try catch throw nullptr operator constexpr noexcept explicit friend mutable'
  };
  var TY = {
    c: 'int char short long float double void unsigned signed size_t FILE uint8_t uint16_t uint32_t uint64_t int8_t int16_t int32_t int64_t',
    cpp: 'int char short long float double void unsigned signed size_t string vector map set unordered_map unordered_set pair array queue stack deque list std'
  };
  var cache = {};

  function words(s) { return '\\b(?:' + s.split(' ').join('|') + ')\\b'; }

  function build(lang) {
    if (!KW[lang]) return null;
    var parts = [];
    var add = function (type, re) { parts.push({ t: type, s: (re.source || re) }); };
    add('com', lang === 'python' ? S.pyCom : S.cCom);
    var str = S.dq.source + '|' + S.sq.source;
    if (lang === 'python') str = S.pyTri.source + '|' + str;
    if (lang === 'javascript') str = S.bt.source + '|' + str;
    add('str', str);
    if (lang === 'c' || lang === 'cpp') add('pp', S.pp);
    add('num', S.num);
    add('kw', words(KW[lang]));
    if (TY[lang]) add('ty', words(TY[lang]));
    if (lang === 'java' || lang === 'javascript') add('ty', S.cap);
    add('fn', S.call);
    return { types: parts.map(function (p) { return p.t; }), re: new RegExp(parts.map(function (p) { return '(' + p.s + ')'; }).join('|'), 'gm') };
  }

  function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function highlight(code, lang) {
    var R = cache[lang] === undefined ? (cache[lang] = build(lang)) : cache[lang];
    if (!R) return esc(code) + '\n';
    var re = R.re, out = '', last = 0, m;
    re.lastIndex = 0;
    while ((m = re.exec(code))) {
      if (m[0] === '') { re.lastIndex++; continue; }
      var gi = 1;
      while (gi < m.length && m[gi] === undefined) gi++;
      out += esc(code.slice(last, m.index)) + '<span class="tk-' + R.types[gi - 1] + '">' + esc(m[0]) + '</span>';
      last = m.index + m[0].length;
    }
    return out + esc(code.slice(last)) + '\n'; // trailing newline keeps the last empty line's height
  }
  window.DracoHL = { highlight: highlight };
})();
