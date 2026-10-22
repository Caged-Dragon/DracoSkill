
  const demoFiles = {
    'main.py': {
      lang: 'python',
      content: `def fibonacci(n):
    a, b = 0, 1
    for _ in range(n):
        yield a
        a, b = b, a + b

print("First 10 Fibonacci numbers:")
print(list(fibonacci(10)))
`
    },
    'app.js': {
      lang: 'javascript',
      content: `function isPrime(n) {
  if (n < 2) return false;
  for (let i = 2; i * i <= n; i++) {
    if (n % i === 0) return false;
  }
  return true;
}

const primes = [];
for (let i = 2; i <= 50; i++) {
  if (isPrime(i)) primes.push(i);
}
console.log("Primes up to 50:", primes.join(", "));
`
    },
    'Main.java': {
      lang: 'java',
      content: `public class Main {
    static boolean isPerfect(int n) {
        int sum = 0;
        for (int i = 1; i < n; i++) if (n % i == 0) sum += i;
        return n > 1 && sum == n;
    }

    public static void main(String[] args) {
        System.out.print("Perfect numbers up to 10000:");
        for (int n = 2; n <= 10000; n++) if (isPerfect(n)) System.out.print(" " + n);
        System.out.println();
    }
}
`
    },
    'main.c': {
      lang: 'c',
      content: `#include <stdio.h>

int main(void) {
    printf("Powers of two:");
    for (int i = 0; i < 10; i++) printf(" %d", 1 << i);
    printf("\\n");
    return 0;
}
`
    },
    'main.cpp': {
      lang: 'cpp',
      content: `#include <iostream>
#include <vector>
#include <algorithm>

int main() {
    std::vector<int> v{5, 3, 9, 1, 7};
    std::sort(v.begin(), v.end());
    std::cout << "Sorted:";
    for (int x : v) std::cout << " " << x;
    std::cout << std::endl;
    return 0;
}
`
    },
    'README.md': {
      lang: 'text',
      content: `# DracoSkill sample project

Runnable files in five languages: main.py, app.js, Main.java, main.c, main.cpp.
Each one compiles/runs on the server — nothing is installed on your computer.

Sign in (top right) to save your own projects and to use the Terminal tab,
where you can install packages (pip, npm, jar, clib) for a project or your
whole account.
`
    }
  };

  let currentFile = 'main.py';
  let savedContent = {};      // last content known to be on the server, per file (for auto-save before Run)
  let backendUrl = (window.DRACOSKILL_CONFIG && window.DRACOSKILL_CONFIG.BACKEND_URL) || '';
  let authToken = null;
  let currentUsername = null;

  let activeFiles = demoFiles;   // whichever file set is currently shown -- demo, or a real project's
  let currentProjectId = null;   // null while in demo mode
  let currentProjectName = '';
  let myProjects = [];

  const editor = document.getElementById('editor');
  const fname = document.getElementById('editor-fname');
  const output = document.getElementById('output');
  const runBtn = document.getElementById('run-btn');
  const runLabel = document.getElementById('run-label');
  const connectRow = document.getElementById('connect-row');
  const saveBtn = document.getElementById('save-btn');

  function showEmptyProjectState() {
    currentFile = null;
    activeFiles = {};
    savedContent = {};
    editor.value = '';
    fname.textContent = '(no file selected)';
    output.innerHTML = '<span class="hint">Add a file on the left to get started.</span>';
    connectRow.style.display = 'none';
    runBtn.style.visibility = 'hidden';
    renderFileTree();
  }

  // 'text' = not runnable on its own (README, headers, data files)
  function langFromFilename(name) {
    const n = name.toLowerCase();
    if (n.endsWith('.py')) return 'python';
    if (/\.(js|mjs|cjs)$/.test(n)) return 'javascript';
    if (n.endsWith('.java')) return 'java';
    if (n.endsWith('.c')) return 'c';
    if (/\.(cpp|cc|cxx)$/.test(n)) return 'cpp';
    return 'text';
  }
  const LANG_DOT = { python: 'dot-py', javascript: 'dot-js', java: 'dot-java', c: 'dot-c', cpp: 'dot-cpp', text: 'dot-md' };
  const LANG_LABEL = { python: 'Python', javascript: 'JavaScript', java: 'Java', c: 'C', cpp: 'C++' };

  function renderFileTree() {
    const list = document.getElementById('file-list');
    list.innerHTML = '';
    Object.keys(activeFiles).forEach(name => {
      const div = document.createElement('div');
      div.className = 'ft-item' + (name === currentFile ? ' active' : '');
      div.dataset.file = name;
      const lang = activeFiles[name].lang;
      const dotClass = LANG_DOT[lang] || 'dot-md';
      div.innerHTML = '<span class="ft-dot ' + dotClass + '"></span>' + escapeHtml(name) +
        (currentProjectId ? '<span class="ft-del" data-file="' + escapeHtml(name) + '">×</span>' : '');
      div.addEventListener('click', (e) => {
        if (e.target.classList.contains('ft-del')) return;
        loadFile(name);
      });
      list.appendChild(div);
    });
    if (currentProjectId) {
      list.querySelectorAll('.ft-del').forEach(el => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteFileFromProject(el.dataset.file);
        });
      });
    }
  }

  function loadFile(name) {
    currentFile = name;
    fname.textContent = name;
    editor.value = activeFiles[name].content;
    savedContent[name] = activeFiles[name].content;
    renderFileTree();
    const lang = activeFiles[name].lang;
    connectRow.style.display = (lang !== 'text') ? 'flex' : 'none';
    output.innerHTML = lang === 'text'
      ? '<span class="hint">This file isn\'t runnable on its own' + (/\.(h|hpp|hh)$/i.test(name) ? ' — it\'s included by your .c/.cpp files.' : '.') + '</span>'
      : 'Press Run to execute ' + escapeHtml(name) + ' for real (' + LANG_LABEL[lang] + (currentProjectId ? ', whole project' : '') + ').';
    runBtn.style.visibility = lang === 'text' ? 'hidden' : 'visible';
  }

  // ---- projects: switching between demo mode and a real signed-in account ----

  function enterDemoMode() {
    currentProjectId = null;
    currentProjectName = '';
    resetTerminal();
    activeFiles = demoFiles;
    document.getElementById('project-bar').style.display = 'none';
    document.getElementById('ft-add-row').style.display = 'none';
    document.getElementById('ft-label').textContent = 'Project (sign in to save your own)';
    saveBtn.style.display = 'none';
    loadFile('main.py');
  }

  async function loadMyProjects() {
    if (!backendUrl || !authToken) return;
    document.getElementById('ft-label').textContent = 'Files';
    document.getElementById('project-bar').style.display = 'flex';
    document.getElementById('ft-add-row').style.display = 'flex';
    saveBtn.style.display = 'inline-block';
    try {
      const res = await fetch(backendUrl.replace(/\/$/, '') + '/projects', {
        headers: { 'X-Session-Token': authToken }
      });
      const data = await res.json();
      myProjects = data.projects || [];
      const sel = document.getElementById('project-select');
      sel.innerHTML = myProjects.length
        ? myProjects.map(p => '<option value="' + p.id + '">' + escapeHtml(p.name) + '</option>').join('')
        : '<option value="">No projects yet — click +</option>';
      if (myProjects.length) {
        sel.value = String(myProjects[0].id);
        await selectProject(myProjects[0].id);
      } else {
        currentProjectId = null;
        showEmptyProjectState();
        document.getElementById('file-list').innerHTML = '<div class="ft-label">Create a project to start.</div>';
      }
    } catch (err) {
      document.getElementById('file-list').innerHTML = '<div class="ft-label">Could not load projects.</div>';
    }
  }

  async function selectProject(id) {
    try {
      const res = await fetch(backendUrl.replace(/\/$/, '') + '/projects/' + id, {
        headers: { 'X-Session-Token': authToken }
      });
      const data = await res.json();
      if (!res.ok) { output.innerHTML = '<span class="err-line">' + escapeHtml(data.error || 'Could not load project') + '</span>'; return; }
      currentProjectId = id;
      currentProjectName = data.name || ('project ' + id);
      activeFiles = {};
      savedContent = {};
      (data.files || []).forEach(f => {
        activeFiles[f.filename] = { lang: langFromFilename(f.filename), content: f.content };
      });
      resetTerminal();
      const firstFile = Object.keys(activeFiles)[0];
      if (firstFile) loadFile(firstFile);
      else showEmptyProjectState();
    } catch (err) {
      output.innerHTML = '<span class="err-line">Could not reach backend to load the project.</span>';
    }
  }

  document.getElementById('project-select').addEventListener('change', (e) => {
    if (e.target.value) selectProject(Number(e.target.value));
  });

  document.getElementById('new-project-btn').addEventListener('click', async () => {
    const name = prompt('Project name:');
    if (!name) return;
    const res = await fetch(backendUrl.replace(/\/$/, '') + '/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Session-Token': authToken },
      body: JSON.stringify({ name: name })
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Could not create project'); return; }
    await loadMyProjects();
    document.getElementById('project-select').value = String(data.id);
    await selectProject(data.id);
  });

  document.getElementById('add-file-btn').addEventListener('click', async () => {
    const input = document.getElementById('new-file-name');
    const filename = input.value.trim();
    if (!filename || !currentProjectId) return;
    const res = await fetch(backendUrl.replace(/\/$/, '') + '/projects/' + currentProjectId + '/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Session-Token': authToken },
      body: JSON.stringify({ action: 'create', filename: filename, content: '' })
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Could not create file'); return; }
    input.value = '';
    activeFiles[filename] = { lang: langFromFilename(filename), content: '' };
    loadFile(filename);
  });

  async function deleteFileFromProject(filename) {
    if (!confirm('Delete ' + filename + '? This cannot be undone.')) return;
    const res = await fetch(backendUrl.replace(/\/$/, '') + '/projects/' + currentProjectId + '/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Session-Token': authToken },
      body: JSON.stringify({ action: 'delete', filename: filename })
    });
    if (!res.ok) { const d = await res.json(); alert(d.error || 'Could not delete file'); return; }
    delete activeFiles[filename];
    const remaining = Object.keys(activeFiles);
    if (currentFile === filename && remaining.length) loadFile(remaining[0]);
    else renderFileTree();
  }

  // Saves the open file to the account. Returns true on success. Used by the Save button and, silently, before every Run.
  async function saveCurrentFile(silent) {
    if (!currentProjectId || !currentFile || !activeFiles[currentFile]) return false;
    activeFiles[currentFile].content = editor.value;
    try {
      const res = await fetch(api('/projects/' + currentProjectId + '/files'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Session-Token': authToken },
        body: JSON.stringify({ action: 'save', filename: currentFile, content: editor.value })
      });
      const data = await res.json();
      if (!res.ok) { if (!silent) alert(data.error || 'Save failed'); return false; }
      savedContent[currentFile] = editor.value;
      return true;
    } catch (err) {
      if (!silent) alert('Could not reach backend to save.');
      return false;
    }
  }

  saveBtn.addEventListener('click', async () => {
    if (!currentProjectId) { alert('Create or select a project first.'); return; }
    if (!currentFile || !activeFiles[currentFile]) { alert('No file selected — add a file first.'); return; }
    saveBtn.textContent = 'Saving…';
    const ok = await saveCurrentFile(false);
    saveBtn.textContent = ok ? 'Saved ✓' : 'Save';
    if (ok) {
      saveBtn.classList.add('saved');
      setTimeout(() => { saveBtn.textContent = 'Save'; saveBtn.classList.remove('saved'); }, 1500);
    }
  });

  document.querySelectorAll('.tab[data-view]').forEach(el => {
    el.addEventListener('click', () => switchView(el.dataset.view));
  });
  function switchView(name) {
    const target = document.getElementById('view-' + name);
    if (!target) return;  // defensive: never crash on a click that isn't a real tab
    document.querySelectorAll('.tab[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === name));
    document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
    target.classList.add('active');
    if (name === 'problems') { loadProblems(); loadSubmissionHistory(); }
    if (name === 'certs') loadCertState();
  }

  // ---- real, sandboxed JavaScript execution via a terminable Worker ----
  const WORKER_SRC = `
    self.onmessage = function(e) {
      const code = e.data;
      const logs = [];
      const origLog = console.log;
      console.log = function(...args) {
        logs.push(args.map(a => {
          try { return typeof a === 'object' ? JSON.stringify(a) : String(a); }
          catch (_) { return String(a); }
        }).join(' '));
      };
      let error = null;
      try {
        const fn = new Function(code);
        fn();
      } catch (err) {
        error = (err && err.name) ? (err.name + ': ' + err.message) : String(err);
      }
      console.log = origLog;
      postMessage({ logs: logs, error: error });
    };
  `;

  function runJavaScriptSandboxed(code, timeoutMs) {
    return new Promise((resolve) => {
      const blob = new Blob([WORKER_SRC], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      const worker = new Worker(url);
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        worker.terminate();
        URL.revokeObjectURL(url);
        resolve({ logs: [], error: null, timedOut: true });
      }, timeoutMs);
      worker.onmessage = (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.terminate();
        URL.revokeObjectURL(url);
        resolve(Object.assign({ timedOut: false }, e.data));
      };
      worker.onerror = (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.terminate();
        URL.revokeObjectURL(url);
        resolve({ logs: [], error: e.message || 'Worker error', timedOut: false });
      };
      worker.postMessage(code);
    });
  }

  function api(path) { return backendUrl.replace(/\/$/, '') + path; }

  function escapeHtml(s) {
    return (s || '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
  }

  // One run = one request to the cloud sandbox for that language.
  //  - signed in + a project open  -> POST /projects/{id}/run   (the WHOLE project: every .java / .c / .cpp file is built together)
  //  - otherwise                   -> POST /execute             (just this file)
  async function runOnServer(lang, code) {
    const stdin = document.getElementById('stdin-input').value;
    let res;
    if (currentProjectId && authToken) {
      await saveCurrentFile(true);   // run what's in the editor, not what was last saved
      res = await fetch(api('/projects/' + currentProjectId + '/run'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Session-Token': authToken },
        body: JSON.stringify({ entry: currentFile, stdin: stdin })
      });
    } else {
      res = await fetch(api('/execute'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: lang, code: code, stdin: stdin })
      });
    }
    return res.json();
  }

  runBtn.addEventListener('click', runCurrentFile);
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && document.getElementById('view-ide').classList.contains('active')) {
      e.preventDefault(); runCurrentFile();
    }
  });
  // Tab inserts spaces in the editor instead of moving focus away
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const st = editor.selectionStart, en = editor.selectionEnd;
      editor.value = editor.value.slice(0, st) + '    ' + editor.value.slice(en);
      editor.selectionStart = editor.selectionEnd = st + 4;
    }
  });

  async function runCurrentFile() {
    if (!currentFile || !activeFiles[currentFile]) {
      output.innerHTML = '<span class="hint">No file selected — add or pick a file first.</span>';
      return;
    }
    const lang = activeFiles[currentFile].lang;
    if (lang === 'text') return;
    showConsoleTab('output');
    const code = editor.value;

    runBtn.classList.remove('heating');
    void runBtn.offsetWidth;
    runBtn.classList.add('heating');
    runLabel.textContent = 'Running…';
    output.innerHTML = '<span class="hint">' + (lang === 'java' || lang === 'c' || lang === 'cpp' ? 'Compiling and running…' : 'Executing…') + '</span>';

    await new Promise(r => setTimeout(r, 200));

    try {
      if (!backendUrl) {
        if (lang === 'javascript') {
          renderResult(await runJavaScriptSandboxed(code, 5000), 'Ran in a browser worker — connect a backend for stdin, require() and packages.');
        } else {
          output.innerHTML = '<span class="hint">' + LANG_LABEL[lang] + ' runs on the DracoSkill server, not in your browser.<br>Start <code>server.py</code> (or use your deployed backend), paste its URL below and hit Connect.</span>';
          connectRow.style.display = 'flex';
        }
      } else {
        const data = await runOnServer(lang, code);
        if (data.error) output.innerHTML = '<span class="err-line">' + escapeHtml(data.error) + '</span>';
        else renderServerResult(data);
      }
    } catch (err) {
      if (lang === 'javascript') {
        renderResult(await runJavaScriptSandboxed(code, 5000), 'Backend unreachable — ran in a browser worker instead.');
      } else {
        output.innerHTML = '<span class="err-line">Could not reach ' + escapeHtml(backendUrl) + ' (' + escapeHtml(err.message || String(err)) + '). If the page is hosted on https, the backend must be https too.</span>';
      }
    }
    runLabel.textContent = '▶ Run';
  }

  function renderServerResult(r) {
    let html = '';
    const comp = r.compile;
    if (r.compileError) {
      html += '<span class="err-line">Compilation failed\n\n' + escapeHtml(r.stderr) + '</span>';
    } else {
      if (comp && (comp.stderr || comp.stdout)) html += '<span class="compile-line">' + escapeHtml((comp.stderr || comp.stdout).trimEnd()) + '</span>\n\n';
      if (r.stdout) html += '<span class="ok-line">' + escapeHtml(r.stdout.replace(/\n$/, '')) + '</span>';
      if (r.stderr) html += (r.stdout ? '\n' : '') + '<span class="err-line">' + escapeHtml(r.stderr.replace(/\n$/, '')) + '</span>';
      if (!r.stdout && !r.stderr) html += '<span class="hint">(no output)</span>';
      if (r.truncated) html += '\n<span class="hint">(output truncated)</span>';
    }
    const bits = [];
    if (comp && !r.compileError) bits.push('compiled in ' + comp.timeMs + ' ms');
    if (!r.compileError) bits.push('ran in ' + r.timeMs + ' ms');
    if (typeof r.exitCode === 'number' && r.exitCode !== 0 && !r.compileError) bits.push('exit code ' + r.exitCode);
    if (r.skippedFiles && r.skippedFiles.length) bits.push('skipped unsafe file names: ' + r.skippedFiles.join(', '));
    if (bits.length) html += '\n\n<span class="meta-line">' + escapeHtml(bits.join(' · ')) + '</span>';
    output.innerHTML = html;
  }

  function renderResult(result, note) {
    if (result.timedOut) {
      output.innerHTML = '<span class="err-line">Execution timed out.</span>';
      return;
    }
    let html = '';
    if (result.logs && result.logs.length) {
      html += '<span class="ok-line">' + escapeHtml(result.logs.join('\n')) + '</span>';
    }
    if (result.error) {
      html += (html ? '\n\n' : '') + '<span class="err-line">' + escapeHtml(result.error) + '</span>';
    }
    if (!html) {
      html = '<span class="hint">(no output)</span>';
    }
    if (note) html += '\n\n<span class="meta-line">' + escapeHtml(note) + '</span>';
    output.innerHTML = html;
  }

  document.getElementById('connect-btn').addEventListener('click', () => {
    const val = document.getElementById('backend-url').value.trim();
    backendUrl = val;
    output.innerHTML = val
      ? '<span class="hint">Backend set to ' + escapeHtml(val) + ' — press Run to try it.</span>'
      : '<span class="hint">Backend cleared.</span>';
    if (val && authToken) loadMyProjects();
    loadSandboxes();
  });

  // ---- Problems / judge ----
  let problemsData = {};
  let currentProblemId = null;
  let problemLang = 'python';

  async function loadProblems() {
    const list = document.getElementById('problem-list');
    if (!backendUrl) {
      list.innerHTML = '<div class="ft-label">Connect a backend from the IDE tab first</div>';
      return;
    }
    list.innerHTML = '<div class="ft-label">Loading…</div>';
    try {
      const res = await fetch(backendUrl.replace(/\/$/, '') + '/problems');
      const data = await res.json();
      problemsData = {};
      (data.problems || []).forEach(p => { problemsData[p.id] = p; });
      renderProblemList();
    } catch (err) {
      list.innerHTML = '<div class="ft-label">Could not reach the backend (' + escapeHtml(err.message || String(err)) + ')</div>';
    }
  }

  function renderProblemList() {
    const list = document.getElementById('problem-list');
    list.innerHTML = '<div class="ft-label">Problems</div>';
    Object.values(problemsData).forEach(p => {
      const div = document.createElement('div');
      div.className = 'problem-item' + (p.id === currentProblemId ? ' active' : '');
      div.innerHTML = '<div class="pt">' + escapeHtml(p.title) + '<span class="diff-pill diff-' + p.difficulty + '">' + escapeHtml(p.difficulty) + '</span></div>';
      div.addEventListener('click', () => selectProblem(p.id));
      list.appendChild(div);
    });
  }

  function selectProblem(id) {
    currentProblemId = id;
    const p = problemsData[id];
    document.getElementById('problem-desc').innerHTML = '<h3>' + escapeHtml(p.title) + '</h3><span class="diff-pill diff-' + p.difficulty + '">' + escapeHtml(p.difficulty) + '</span><br><br>' + escapeHtml(p.description);
    document.getElementById('problem-editor').value = p.starter[problemLang] || '';
    document.getElementById('problem-output').innerHTML = '<span class="hint">Press Submit to run this against the test cases.</span>';
    renderProblemList();
  }

  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      problemLang = btn.dataset.lang;
      document.querySelectorAll('.lang-btn').forEach(b => b.classList.toggle('active', b === btn));
      if (currentProblemId) {
        document.getElementById('problem-editor').value = problemsData[currentProblemId].starter[problemLang] || '';
      }
    });
  });

  document.getElementById('submit-btn').addEventListener('click', async () => {
    const out = document.getElementById('problem-output');
    if (!currentProblemId) { out.innerHTML = '<span class="hint">Pick a problem first.</span>'; return; }
    if (!backendUrl) { out.innerHTML = '<span class="hint">Connect a backend from the IDE tab first.</span>'; return; }
    const code = document.getElementById('problem-editor').value;
    out.innerHTML = '<span class="hint">Judging…</span>';
    try {
      const res = await fetch(backendUrl.replace(/\/$/, '') + '/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Session-Token': authToken || '' },
        body: JSON.stringify({ problemId: currentProblemId, language: problemLang, code: code })
      });
      const data = await res.json();
      renderVerdict(data);
      if (currentUsername) loadSubmissionHistory();
    } catch (err) {
      out.innerHTML = '<span class="err-line">Could not reach backend: ' + escapeHtml(err.message || String(err)) + '</span>';
    }
  });

  function renderVerdict(data) {
    const out = document.getElementById('problem-output');
    if (data.error) {
      out.innerHTML = '<span class="err-line">' + escapeHtml(data.error) + '</span>';
      return;
    }
    const okClass = data.verdict === 'Accepted' ? 'verdict-Accepted' : 'verdict-bad';
    let html = '<div class="verdict-banner ' + okClass + '">' + escapeHtml(data.verdict) + '</div>';
    (data.results || []).forEach((r, i) => {
      const icon = r.pass ? '<span class="tp">pass</span>' : '<span class="tf">fail</span>';
      if (r.hidden) {
        html += '<div class="test-row">' + icon + ' — hidden test ' + (i + 1) + '</div>';
      } else {
        html += '<div class="test-row">' + icon + ' — test ' + (i + 1) + ': input <code>' + escapeHtml(r.input) + '</code> expected <code>' + escapeHtml(r.expected) + '</code> got <code>' + escapeHtml(r.actual !== undefined ? r.actual : '') + '</code></div>';
      }
      if (r.stderr) {
        html += '<div class="test-row err-line">' + escapeHtml(r.stderr.split('\n')[0]) + '</div>';
      }
    });
    if (data.saved === false) {
      html += '<div class="test-row hint">Log in to save this to your history.</div>';
    } else if (data.saved === true) {
      html += '<div class="test-row hint">Saved to your history.</div>';
    }
    out.innerHTML = html;
  }

  // ---- auth ----
  function wireAuthPanel() {
    document.getElementById('auth-toggle-btn').addEventListener('click', () => {
      const panel = document.getElementById('auth-panel');
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });
    document.getElementById('auth-login-btn').addEventListener('click', () => submitAuth('/auth/login'));
    document.getElementById('auth-register-btn').addEventListener('click', () => submitAuth('/auth/register'));
  }

  async function submitAuth(path) {
    const errEl = document.getElementById('auth-error');
    errEl.textContent = '';
    if (!backendUrl) { errEl.textContent = 'Connect a backend from the IDE tab first.'; return; }
    const username = document.getElementById('auth-username').value.trim();
    const password = document.getElementById('auth-password').value;
    try {
      const res = await fetch(backendUrl.replace(/\/$/, '') + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username, password: password })
      });
      const data = await res.json();
      if (!res.ok) { errEl.textContent = data.error || 'Something went wrong.'; return; }
      authToken = data.token;
      currentUsername = data.username;
      renderAuthArea();
      if (backendUrl) loadMyProjects();
      resetTerminal();
      if (document.getElementById('view-problems').classList.contains('active')) loadSubmissionHistory();
    } catch (err) {
      errEl.textContent = 'Could not reach backend: ' + (err.message || err);
    }
  }

  function renderAuthArea() {
    const area = document.getElementById('auth-area');
    if (currentUsername) {
      area.innerHTML = '<div class="auth-username-display">' + escapeHtml(currentUsername) + '<button id="auth-logout-btn">Log out</button></div>';
      document.getElementById('auth-logout-btn').addEventListener('click', doLogout);
    } else {
      area.innerHTML =
        '<button class="tab" id="auth-toggle-btn">Log in</button>' +
        '<div class="auth-panel" id="auth-panel" style="display:none;">' +
        '<input type="text" id="auth-username" placeholder="username" autocomplete="username" />' +
        '<input type="password" id="auth-password" placeholder="password" autocomplete="current-password" />' +
        '<div class="auth-panel-actions"><button id="auth-login-btn">Log in</button><button id="auth-register-btn" class="secondary">Register</button></div>' +
        '<div class="auth-error" id="auth-error"></div></div>';
      wireAuthPanel();
    }
  }

  async function doLogout() {
    if (backendUrl && authToken) {
      try {
        await fetch(backendUrl.replace(/\/$/, '') + '/auth/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Session-Token': authToken },
          body: '{}'
        });
      } catch (_) { /* logging out locally still proceeds even if the request fails */ }
    }
    authToken = null;
    currentUsername = null;
    renderAuthArea();
    document.getElementById('history-box').style.display = 'none';
    enterDemoMode();
  }

  async function loadSubmissionHistory() {
    const box = document.getElementById('history-box');
    const list = document.getElementById('history-list');
    if (!currentUsername || !backendUrl) { box.style.display = 'none'; return; }
    box.style.display = 'block';
    try {
      const res = await fetch(backendUrl.replace(/\/$/, '') + '/submissions', {
        headers: { 'X-Session-Token': authToken || '' }
      });
      const data = await res.json();
      if (!data.submissions || !data.submissions.length) {
        list.innerHTML = '<div class="history-row hp">No submissions yet.</div>';
        return;
      }
      list.innerHTML = data.submissions.map(s =>
        '<div class="history-row"><span class="hp">' + escapeHtml(s.problem_id) + '</span><span class="' + (s.verdict === 'Accepted' ? 'tp' : 'tf') + '">' + escapeHtml(s.verdict) + '</span></div>'
      ).join('');
    } catch (err) {
      list.innerHTML = '<div class="history-row hp">Could not load history.</div>';
    }
  }

  wireAuthPanel();
  if (backendUrl) document.getElementById('backend-url').value = backendUrl;
  loadFile('main.py');

  // ---- Certificates ----
  async function loadCertState() {
    const el = document.getElementById('cert-content');
    if (!backendUrl) {
      el.innerHTML = '<span class="hint">Connect a backend from the IDE tab first.</span>';
      return;
    }
    if (!currentUsername) {
      el.innerHTML = '<span class="hint">Sign in (top right) to track your progress toward a certificate.</span>';
      return;
    }
    el.innerHTML = '<span class="hint">Loading…</span>';
    try {
      const mineRes = await fetch(backendUrl.replace(/\/$/, '') + '/certificates/mine', {
        headers: { 'X-Session-Token': authToken }
      });
      const mine = await mineRes.json();
      if (mine.issued) {
        renderCertificateCard(mine);
        return;
      }
      const progRes = await fetch(backendUrl.replace(/\/$/, '') + '/certificates/progress', {
        headers: { 'X-Session-Token': authToken }
      });
      const prog = await progRes.json();
      renderCertProgress(prog);
    } catch (err) {
      el.innerHTML = '<span class="err-line">Could not reach backend: ' + escapeHtml(err.message || String(err)) + '</span>';
    }
  }

  function renderCertProgress(prog) {
    const el = document.getElementById('cert-content');
    const pct = prog.problems_total ? Math.round((prog.problems_solved / prog.problems_total) * 100) : 0;
    let html = '<div class="cert-progress">';
    html += '<div><strong>' + prog.problems_solved + ' / ' + prog.problems_total + '</strong> problems solved</div>';
    html += '<div class="cert-progress-bar"><div class="cert-progress-fill" style="width:' + pct + '%;"></div></div>';
    if (prog.eligible) {
      html += '<button class="cert-issue-btn" id="issue-cert-btn">Issue my certificate</button>';
    } else {
      html += '<span class="hint">Solve every problem on the Problems tab to unlock it.</span>';
    }
    html += '</div>';
    el.innerHTML = html;
    if (prog.eligible) {
      document.getElementById('issue-cert-btn').addEventListener('click', async () => {
        const res = await fetch(backendUrl.replace(/\/$/, '') + '/certificates/issue', {
          method: 'POST',
          headers: { 'X-Session-Token': authToken }
        });
        const data = await res.json();
        if (!res.ok) { alert(data.error || 'Could not issue certificate'); return; }
        renderCertificateCard(Object.assign({ issued: true }, data));
      });
    }
  }

  function renderCertificateCard(cert) {
    const el = document.getElementById('cert-content');
    const verifyUrl = cert.confirmation_url;
    const issuedDate = new Date(cert.issued_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    el.innerHTML =
      '<div class="cert-card"><div class="cert-card-inner">' +
        '<div class="cert-watermark">DRACOSKILL</div>' +
        '<div class="cert-top">' +
          '<img src="../assets/dracoskill-mark.png" alt="DracoSkill" />' +
          '<div class="cert-title">PROBLEM SOLVING CERTIFICATE</div>' +
          '<div class="cert-qr-top"><div id="cert-qr" class="cert-qr"></div></div>' +
        '</div>' +
        '<div class="cert-body">' +
          '<div class="cert-presented">This certifies that</div>' +
          '<div class="cert-name">' + escapeHtml(cert.username) + '</div>' +
          '<div class="cert-for">has successfully solved every problem in the</div>' +
          '<div class="cert-track">' + escapeHtml(cert.track_name).toUpperCase() + '</div>' +
          '<div class="cert-date">Issued on ' + issuedDate + '</div>' +
        '</div>' +
        '<div class="cert-stats">' +
          '<div class="cert-stat"><div class="cs-label">PROBLEMS SOLVED</div><div class="cs-value">' + cert.problems_solved + ' / ' + cert.problems_total + '</div></div>' +
          '<div class="cert-stat"><div class="cs-label">ACCURACY</div><div class="cs-value">' + cert.accuracy_pct + '%</div></div>' +
          '<div class="cert-stat"><div class="cs-label">SUBMISSIONS</div><div class="cs-value">' + cert.total_submissions + '</div></div>' +
        '</div>' +
        '<div class="cert-bottom">' +
          '<div class="cert-verify-text">Verify: ' + escapeHtml(verifyUrl) + '</div>' +
          '<img src="../assets/cageddragons-mark.png" alt="CagedDragons" style="width:44px;height:44px;border-radius:8px;" />' +
        '</div>' +
        '<div class="cert-footer-bar">Certificate ID: ' + escapeHtml(cert.certificate_code) + '</div>' +
      '</div></div>' +
      '<div class="cert-actions">' +
        '<a href="' + escapeHtml(verifyUrl) + '" target="_blank">Open verification page →</a>' +
      '</div>';

    const qrEl = document.getElementById('cert-qr');
    if (window.QRCode) {
      try { new QRCode(qrEl, { text: verifyUrl, width: 48, height: 48 }); }
      catch (e) { qrEl.textContent = '(QR unavailable)'; }
    } else {
      qrEl.textContent = '(QR unavailable)';
      qrEl.style.cssText = 'width:48px;height:48px;font-size:7px;color:#374151;padding:2px;';
    }
  }


  // ---- console tabs (Output | Terminal) ----
  function showConsoleTab(name) {
    document.querySelectorAll('.ctab').forEach(b => b.classList.toggle('active', b.dataset.ctab === name));
    document.querySelectorAll('.cpane').forEach(p => p.classList.toggle('active', p.id === 'cpane-' + name));
    if (name === 'terminal') setTimeout(() => termInput.focus(), 0);
  }
  document.querySelectorAll('.ctab').forEach(b => b.addEventListener('click', () => showConsoleTab(b.dataset.ctab)));
  function openTerminal() { switchView('ide'); showConsoleTab('terminal'); }

  // ---- sandboxes: what the server can actually run right now ----
  async function loadSandboxes() {
    if (!backendUrl) return;
    try {
      const res = await fetch(api('/sandboxes'));
      renderSandboxes(await res.json());
    } catch (err) {
      renderSandboxes(null);
    }
  }

  let backendFeatures = null;   // null = unknown (full Python backend reports nothing -> assume everything works)

  function renderSandboxes(d) {
    backendFeatures = (d && d.features) || null;
    applyFeatureNotes();
    const strip = document.getElementById('sandbox-strip');
    const langPills = document.getElementById('dash-lang-pills');
    const sbPills = document.getElementById('dash-sandbox-pills');
    if (!d || !d.sandboxes) {
      strip.innerHTML = '';
      langPills.innerHTML = '<span class="pill needs">Backend not reachable</span>';
      sbPills.innerHTML = '<span class="pill needs">Backend not reachable</span>';
      return;
    }
    const tip = sb => sb.label + (sb.version ? ' — ' + sb.version : '') + (sb.available ? '' : ' — not installed on this server');
    strip.innerHTML = d.sandboxes.map(sb =>
      '<span class="sb-chip ' + (sb.available ? 'up' : 'down') + '" title="' + escapeHtml(tip(sb)) + '">' + escapeHtml(sb.label) + '</span>').join('');
    sbPills.innerHTML = d.sandboxes.map(sb =>
      '<span class="pill ' + (sb.available ? 'live' : 'needs') + '" title="' + escapeHtml(tip(sb)) + '">' + escapeHtml(sb.label) + (sb.available ? '' : ' ✕') + '</span>').join('');
    langPills.innerHTML = d.sandboxes.filter(sb => sb.id !== 'terminal').map(sb =>
      '<span class="pill ' + (sb.available ? 'live' : 'needs') + '">' + escapeHtml(sb.label) + (sb.available ? ': live' : ': not installed') + '</span>').join('');
  }

  // The Vercel backend runs code but has no accounts/terminal. Say so up front instead of failing on login.
  function applyFeatureNotes() {
    const limited = backendFeatures && backendFeatures.accounts === false;
    const authBtn = document.getElementById('auth-toggle-btn');
    if (authBtn) authBtn.title = limited ? 'This backend runs code only: no accounts, projects or terminal' : '';
    const card = document.querySelector('#dash-sandbox-pills')?.closest('.dash-card');
    document.querySelectorAll('.dash-card').forEach(c => {
      if (c.querySelector('h3') && /Terminal/.test(c.querySelector('h3').textContent)) {
        const row = c.querySelector('.status-row');
        if (row) row.innerHTML = limited
          ? '<span class="pill needs">Not on this backend</span>'
          : '<span class="pill live">Cloud terminal</span><span class="pill needs">Log in to use</span>';
      }
    });
    if (typeof resetTerminal === 'function' && termScreen && !authToken) resetTerminal();
  }

  // ---- terminal ----
  const termScreen = document.getElementById('term-screen');
  const termInput = document.getElementById('term-input');
  const termPrompt = document.getElementById('term-prompt');
  let termCwd = '';
  let termHistory = [];
  let termHistIdx = 0;
  let termBusy = false;

  function termPrint(text, cls) {
    const el = document.createElement('div');
    el.className = cls || 't-out';
    el.textContent = text;
    termScreen.appendChild(el);
    termScreen.scrollTop = termScreen.scrollHeight;
    return el;
  }

  function promptText() {
    return (currentUsername || 'guest') + '@' + (currentProjectId ? currentProjectName : 'account') + ':/' + termCwd + '$';
  }

  function resetTerminal() {
    termCwd = '';
    termScreen.innerHTML = '';
    termPrompt.textContent = promptText();
    if (!backendUrl) {
      termPrint('Connect a backend first (Output tab → Connect).', 't-dim');
    } else if (backendFeatures && backendFeatures.terminal === false) {
      termPrint('This backend (Vercel) runs code only: no accounts, projects or terminal. Use the Python backend (Render or self-hosted) for pip/npm/jar/clib installs.', 't-dim');
    } else if (!authToken) {
      termPrint('Log in (top right) to use the terminal. Packages you install are saved to your account in the cloud — never on your computer.', 't-dim');
    } else {
      termPrint('DracoSkill cloud terminal. Type "help" for commands.', 't-dim');
      termPrint(currentProjectId
        ? 'Project "' + currentProjectName + '" is open: installs go to this project. Add --account to make a library available to all your projects.'
        : 'No project open: installs go to your account (available to every project). Create a project with + in the file panel for per-project installs.', 't-dim');
    }
  }

  async function runTerminalCommand(raw) {
    const cmd = raw.trim();
    termPrint(promptText() + ' ' + raw, 't-cmd');
    if (!cmd) return;
    if (termHistory[termHistory.length - 1] !== cmd) termHistory.push(cmd);
    termHistIdx = termHistory.length;
    if (cmd === 'clear') { termScreen.innerHTML = ''; return; }
    if (!backendUrl) { termPrint('No backend connected.', 't-err'); return; }
    if (!authToken) { termPrint('Log in to use the terminal.', 't-err'); return; }

    termBusy = true;
    termInput.disabled = true;
    const started = Date.now();
    const waiting = termPrint('running…', 't-dim');
    const tick = setInterval(() => { waiting.textContent = 'running… ' + Math.round((Date.now() - started) / 1000) + 's'; }, 1000);
    try {
      if (currentProjectId && currentFile && activeFiles[currentFile] && editor.value !== savedContent[currentFile]) {
        await saveCurrentFile(true);   // so `run`, `cat` and compilers see what's in the editor
      }
      const res = await fetch(api('/terminal'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Session-Token': authToken },
        body: JSON.stringify({ command: cmd, cwd: termCwd, projectId: currentProjectId })
      });
      const data = await res.json();
      clearInterval(tick);
      waiting.remove();
      if (!res.ok) {
        termPrint(data.error || ('Request failed (' + res.status + ')'), 't-err');
      } else {
        if (data.clear) termScreen.innerHTML = '';
        if (data.output) termPrint(data.output.replace(/\n$/, ''), data.exitCode ? 't-err' : 't-out');
        termCwd = data.cwd || '';
        if (/^(touch|rm|mv|cp|echo)\b/.test(cmd)) await refreshProjectFiles();
      }
    } catch (err) {
      clearInterval(tick);
      waiting.remove();
      termPrint('Could not reach the backend: ' + (err.message || err), 't-err');
    }
    termBusy = false;
    termInput.disabled = false;
    termPrompt.textContent = promptText();
    termInput.focus();
  }

  // After the terminal creates/removes files, reflect that in the file tree without losing unsaved edits.
  async function refreshProjectFiles() {
    if (!currentProjectId || !authToken) return;
    try {
      const res = await fetch(api('/projects/' + currentProjectId), { headers: { 'X-Session-Token': authToken } });
      const data = await res.json();
      if (!res.ok) return;
      const keep = currentFile, keepText = editor.value;
      const fresh = {};
      (data.files || []).forEach(f => { fresh[f.filename] = { lang: langFromFilename(f.filename), content: f.content }; savedContent[f.filename] = f.content; });
      activeFiles = fresh;
      if (keep && fresh[keep]) { fresh[keep].content = keepText; renderFileTree(); }
      else { const first = Object.keys(fresh)[0]; if (first) loadFile(first); else showEmptyProjectState(); }
    } catch (err) { /* the file tree just stays as it was */ }
  }

  termInput.addEventListener('keydown', (e) => {
    if (termBusy) return;
    if (e.key === 'Enter') {
      const v = termInput.value;
      termInput.value = '';
      runTerminalCommand(v);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (termHistIdx > 0) termInput.value = termHistory[--termHistIdx];
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      termHistIdx = Math.min(termHistIdx + 1, termHistory.length);
      termInput.value = termHistory[termHistIdx] || '';
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      termScreen.innerHTML = '';
    }
  });
  document.getElementById('term-screen').addEventListener('click', () => { if (!window.getSelection().toString()) termInput.focus(); });
  document.querySelectorAll('#term-chips button').forEach(b => b.addEventListener('click', () => {
    const c = b.dataset.cmd;
    if (c.endsWith(' ')) { termInput.value = c; termInput.focus(); }
    else runTerminalCommand(c);
  }));

  resetTerminal();
  loadSandboxes();
