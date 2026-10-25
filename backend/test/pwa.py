"""PWA test: manifest, icons, service worker, TRUE offline (the web server is shut down), updates, install prompt.
    pip install playwright && playwright install chromium
    python3 backend/test/pwa.py
"""
import json, os, re, struct, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
FRONT = os.path.join(ROOT, "frontend"); SW = os.path.join(FRONT, "sw.js")
SW_ORIGINAL = open(SW).read()
CFG_PATH = os.path.join(FRONT, "assets", "config.js"); CFG_ORIGINAL = open(CFG_PATH).read()
# A service worker serves config.js itself, and Playwright cannot intercept that, so the test writes the real file and restores it after.
open(CFG_PATH, "w").write('window.DRACOSKILL_CONFIG={BACKEND_URL:"http://localhost:8787"};\n')
env = dict(os.environ, FAKE_SNAPSHOT="1")
be = subprocess.Popen(["node", "test/serve-local.mjs"], cwd=os.path.join(ROOT, "backend"), env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
def start_front(): return subprocess.Popen([sys.executable, "-m", "http.server", "8000"], cwd=FRONT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
fe = start_front()
def wait_up():
    for _ in range(80):
        try: urllib.request.urlopen("http://localhost:8787/health", timeout=1); urllib.request.urlopen("http://localhost:8000/", timeout=1); return
        except Exception: time.sleep(.2)
wait_up()
ok = bad = 0
def check(n, c, d=""):
    global ok, bad
    if c: ok += 1; print("  PASS ", n)
    else: bad += 1; print("  FAIL ", n, str(d)[:300])
CFG = lambda r: r.fulfill(body='window.DRACOSKILL_CONFIG={BACKEND_URL:"http://localhost:8787"};', content_type="application/javascript")
def png_size(data): return struct.unpack(">II", data[16:24])

try:
    print("manifest and icons")
    m = json.load(urllib.request.urlopen("http://localhost:8000/manifest.webmanifest"))
    for k in ("name", "short_name", "start_url", "scope", "display", "background_color", "theme_color", "icons"): check(f"manifest has {k}", k in m)
    check("display is standalone", m["display"] == "standalone")
    sizes = {}
    for ic in m["icons"]:
        data = urllib.request.urlopen("http://localhost:8000/" + ic["src"]).read()
        sizes[(ic["purpose"], ic["sizes"])] = (png_size(data) == tuple(int(x) for x in ic["sizes"].split("x")))
    check("a 192px 'any' icon exists and is really 192x192", sizes.get(("any", "192x192")) is True, sizes)
    check("a 512px 'any' icon exists and is really 512x512", sizes.get(("any", "512x512")) is True, sizes)
    check("a 512px 'maskable' icon exists and is really 512x512", sizes.get(("maskable", "512x512")) is True, sizes)
    check("start_url lies inside scope", m["start_url"].startswith("./") and m["scope"] == "./")
    check("every shortcut opens a language that exists", all(re.search(r"lang=(python|javascript|java|c|cpp)\b", s["url"]) for s in m["shortcuts"]) and len(m["shortcuts"]) <= 4)

    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 1360, "height": 860}); pg = ctx.new_page(); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e))); 
        pg.goto("http://localhost:8000/"); pg.wait_for_timeout(1200)
        print("page wiring")
        check("links the manifest", pg.get_attribute('link[rel="manifest"]', "href") == "manifest.webmanifest")
        check("has an apple-touch-icon", pg.locator('link[rel="apple-touch-icon"]').count() == 1)
        th = pg.evaluate("document.documentElement.dataset.theme"); check("theme-color matches the active theme", pg.get_attribute('meta[name="theme-color"]', "content") == ("#EDEFF3" if th == "light" else "#17161A"), th)
        check("viewport covers notches", "viewport-fit=cover" in pg.get_attribute('meta[name="viewport"]', "content"))

        print("service worker")
        pg.evaluate("navigator.serviceWorker.ready.then(()=>true)"); pg.reload(); pg.wait_for_timeout(800)
        check("a service worker is active and controls the page", pg.evaluate("navigator.serviceWorker.controller !== null && navigator.serviceWorker.controller.state === 'activated'"))
        pg.click("#run-btn"); pg.wait_for_function("()=>/ran in/i.test(document.getElementById('out').innerText)", timeout=30000)
        keys = pg.evaluate("caches.keys()"); check("one versioned shell cache", keys == ["draco-shell-v1"], keys)
        urls = pg.evaluate("caches.open('draco-shell-v1').then(c=>c.keys()).then(ks=>ks.map(k=>k.url))")
        check("the app shell is cached (page, script, styles, fonts, icons)", all(any(u.endswith(x) for u in urls) for x in ("/", "compiler.js", "compiler.css", "assets/design.css", "assets/fonts/bricolage.woff2", "assets/icons/icon-192.png")), urls)
        check("backend/API responses are NEVER cached", not any("8787" in u for u in urls), [u for u in urls if "8787" in u])
        check("the run really executed on the server (a runtime error from the empty-input sample proves it ran)", "EOFError" in pg.inner_text("#out") or "Hello" in pg.inner_text("#out"), pg.inner_text("#out"))

        print("install prompt")
        pg.evaluate("""()=>{const e=new Event('beforeinstallprompt',{cancelable:true}); e.prompt=()=>{window.__prompted=true; return Promise.resolve()}; e.userChoice=Promise.resolve({outcome:'accepted'}); window.dispatchEvent(e);}""")
        check("Install button appears when the browser offers installation", pg.is_visible("#install-btn"))
        pg.click("#install-btn"); check("clicking it shows the browser's install prompt", pg.evaluate("window.__prompted === true"))
        check("button hides after use", pg.is_hidden("#install-btn"))

        print("home-screen shortcuts + theme colour")
        pg.goto("http://localhost:8000/?lang=c&source=shortcut"); pg.wait_for_timeout(800)
        check("shortcut ?lang=c opens the C tab", pg.get_attribute('.lang-tab[data-lang="c"]', "aria-selected") == "true")
        pg.click("[data-theme-toggle]"); tc = pg.get_attribute('meta[name="theme-color"]', "content"); pg.click("[data-theme-toggle]")
        check("browser/title-bar colour follows the theme", tc in ("#EDEFF3", "#17161A") and tc != pg.get_attribute('meta[name="theme-color"]', "content"), tc)

        print("keyboard accessibility")
        pg.fill("#code", ""); pg.click("#code"); pg.keyboard.press("Tab"); check("Tab indents inside the editor", pg.eval_on_selector("#code", "e=>e.value") == "    ")
        pg.keyboard.press("Escape"); pg.keyboard.press("Tab")
        check("Esc then Tab leaves the editor (no keyboard trap)", pg.evaluate("document.activeElement.id") != "code")
        check("...without inserting spaces", pg.eval_on_selector("#code", "e=>e.value") == "    ")

        print("TRUE offline: web server shut down + network cut")
        pg.goto("http://localhost:8000/"); pg.wait_for_timeout(800)
        pg.click('.lang-tab[data-lang="python"]'); pg.fill("#code", "print('written offline-ready')"); pg.wait_for_timeout(700)
        fe.terminate(); fe.wait(); ctx.set_offline(True); time.sleep(.5)
        try: urllib.request.urlopen("http://localhost:8000/", timeout=1); server_down = False
        except Exception: server_down = True
        check("(precondition) the web server really is unreachable", server_down)
        pg.reload(); pg.wait_for_timeout(1200)
        check("the page opens from the cache", "DracoSkill" in pg.title() and pg.locator(".lang-tab").count() == 5, pg.title())
        check("your autosaved code is still there", pg.eval_on_selector("#code", "e=>e.value") == "print('written offline-ready')")
        check("fonts are served from the cache", pg.evaluate("document.fonts.check('16px Bricolage') && document.fonts.check('13px JetBrains')"))
        check("status chip says Offline", "Offline" in pg.inner_text("#conn-chip"), pg.inner_text("#conn-chip"))
        pg.click("#run-btn"); pg.wait_for_timeout(300)
        check("Run explains you are offline instead of failing silently", "offline" in pg.inner_text("#out").lower(), pg.inner_text("#out"))
        pg.goto("http://localhost:8000/?lang=java"); pg.wait_for_timeout(1000)
        check("shortcut URLs also open offline", pg.get_attribute('.lang-tab[data-lang="java"]', "aria-selected") == "true")
        check("the editor still works offline (syntax colour)", pg.locator(".code-hl .tk-kw").count() > 0)

        print("coming back online")
        fe = start_front(); wait_up(); ctx.set_offline(False); pg.evaluate("window.dispatchEvent(new Event('online'))"); pg.wait_for_timeout(2500)
        check("status recovers to ready", "ready" in pg.inner_text("#conn-chip") or "of 5" in pg.inner_text("#conn-chip"), pg.inner_text("#conn-chip"))

        print("updates: only with the visitor's consent, work is never lost")
        pg.goto("http://localhost:8000/"); pg.wait_for_timeout(1000)
        check("no update prompt when nothing changed", pg.is_hidden("#update-bar"))
        open(SW, "w").write(SW_ORIGINAL.replace("const VERSION = 'v1';", "const VERSION = 'v2';"))
        pg.fill("#code", "print('typed but not yet saved')")                       # in the middle of editing when the update arrives
        pg.evaluate("window.__draco_sw.update()"); pg.wait_for_selector("#update-bar:not([hidden])", timeout=15000)
        check("a new version shows 'ready' and does NOT reload by itself", pg.is_visible("#update-bar") and pg.eval_on_selector("#code", "e=>e.value") == "print('typed but not yet saved')")
        ks = pg.evaluate("caches.keys()")
        check("the new version is prepared in the background while the old one keeps serving", "draco-shell-v1" in ks and "draco-shell-v2" in ks and pg.evaluate("window.__draco_sw.waiting !== null"), ks)
        with pg.expect_navigation(): pg.click("#update-btn")
        pg.wait_for_timeout(1200)
        check("after Reload the new cache is live and the old one is deleted", pg.evaluate("caches.keys()") == ["draco-shell-v2"], pg.evaluate("caches.keys()"))
        check("the code typed just before updating survived the reload", pg.eval_on_selector("#code", "e=>e.value") == "print('typed but not yet saved')")
        open(SW, "w").write(SW_ORIGINAL)

        print("native share sheet on phones")
        mctx = b.new_context(user_agent="Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/141 Mobile Safari/537.36", viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)
        mctx.add_init_script("navigator.share = (d) => { window.__shared = d; return Promise.resolve(); }")
        mp = mctx.new_page(); mp.goto("http://localhost:8000/"); mp.wait_for_timeout(900)
        mp.click("#share-btn"); mp.wait_for_timeout(300)
        shared = mp.evaluate("window.__shared"); check("Share opens the phone's share sheet with a code link", bool(shared) and "#lang=python&code=" in shared["url"], shared); mctx.close()
        check("no uncaught JS errors", not errs, errs)
        b.close()
finally:
    open(SW, "w").write(SW_ORIGINAL); open(CFG_PATH, "w").write(CFG_ORIGINAL)
    be.terminate(); fe.terminate()
print(f"\n{ok} passed, {bad} failed"); sys.exit(1 if bad else 0)
