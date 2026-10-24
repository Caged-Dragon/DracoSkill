# DracoSkill UI: design plan

SUBJECT  DracoSkill (CagedDragons): free cloud IDE for people learning to code. Runs real code in 5 languages,
         judges problems against real tests, issues certificates. Audience: students / early developers.
         Primary job: blank file -> running code in seconds, nothing to install.

CONCEPT  "Forge". Code goes in cold, comes out hot.
         THE memorable thing (only one): a LIVE editor in the landing hero that really runs, plus an "ember seam":
         a 2px hot line that exists only while something executes (sweeps, then cools to steel). Everything else is quiet.

COLOR (semantic, not decorative)           dark "forge"        light "steel"
  ground  (page)                           soot    #17161A     #EEF0F3
  panel                                    anvil   #1F1E24     #FFFFFF
  raised                                   slab    #2A2930     #F6F7F9
  seam (borders)                           #38363F             #D5D9E0
  ink / dim / faint                        #ECE8E1 #A9A39B #77716A     #1B1A20 #555B66 #7C838F
  ember = running / primary action ONLY    #FF6A3D             #D8431A
  quench = focus, links, info              #7CC4D6             #0E7490
  moss = ready/success   brass = certificates   error
TYPE     Bricolage Grotesque (UI + display, 400-800, tight tracking on headings), JetBrains Mono (code, versions, terminal).
         Self-hosted woff2. Sentence case everywhere. No all-caps labels, no eyebrows, no single-word accent in headlines.
LAYOUT   Left-aligned. Landing: copy left (5/12), live editor right (7/12), then a real sequence (write, run, solve, prove),
         certificate panel, honest roadmap list. App: slim top bar, workbench dashboard (launch bar of 5 languages with LIVE
         versions from the backend, resume/problems/certificate as differently-shaped regions, not 4 identical cards),
         IDE with gutter + syntax colour + status bar + draggable console.
MOTION   Only responses to actions: ember seam while running, button press, theme swap. No scroll fade-ups, no hover-lift cards.
HONESTY  Remove claims the product can't back (static "real output" text, AI tutor / community / XP presented as shipped).

## Review against generic defaults
- near-black + one vermilion accent: partly guilty (brand mark is red). Mitigation: ember is reserved for "something is running",
  three semantic accents, and the light theme is a cool steel (NOT cream/terracotta) so both modes are first-class.
- identical rounded-card grid: dashboard + landing use different shapes per role (launch bar, lists, one panel), varied radii.
- tracked ALL-CAPS eyebrows, "A · B · C" meta strings, "→" on every link, mono for every small label: all dropped.
- gradient blobs / fade-ups: dropped.

## Where things live
- assets/design.css: tokens (dark "forge" + light "steel"), buttons, chips, the ember seam, editor styles. Change colour here once.
- assets/highlight.js + editor.js: the shared code editor (line numbers, syntax colour, auto-indent). No dependencies.
- assets/theme.js: follows the system theme until the person picks one; remembers the choice.
- assets/fonts/: Bricolage Grotesque and JetBrains Mono, self-hosted (no Google Fonts request).
- landing/: marketing page with the live, runnable editor. app/: the product.
