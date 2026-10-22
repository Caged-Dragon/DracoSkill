# DracoSkill — version map

Version 1 is everything already working. Each version after that adds
exactly one capability on top of the last, so Version N is always
"everything in Version N-1, plus one more thing." Execution input/output
limits are intentionally left out — not something to build toward.

## Version 1 — Foundation (done)

Cloud IDE with real Python and JavaScript execution. Coding problems with
a real judge. Accounts — register, login, logout, hashed passwords,
sessions, submission history. Landing page and app in light and dark
mode. DracoSkill/CagedDragons branding throughout. A modular codebase —
separated frontend markup/styles/behavior, separated backend
database/auth/execution/judge modules.

## Version 2 — Project persistence (done)

Multi-file projects actually saved to an account: create, rename,
duplicate, delete, and set visibility (private/unlisted/public), each
with ownership enforced server-side rather than trusted from the client.
Files can be created, saved, and deleted within a project, and every save
appends to a real version-history log instead of only overwriting. Wired
into the IDE itself — signed-in users get a live project switcher and a
Save button in place of the fixed three-file demo; signed-out users still
get the original no-login-required demo experience.

## Version 3 — Certificates, finished (done)

A real certificate module, not the earlier one-off script. Eligibility,
issuance, and every number on the certificate come from the real
submissions table. "Course completion" doesn't exist yet — that's
Version 6 — so eligibility is currently "solved every problem in the
current set"; swapping that for a real course-completion check later
doesn't require touching anything else. A real QR code and a public
verification page reachable with no login back it, and issuing twice
returns the same certificate rather than a second one from
possibly-different later data.

The app's Certificates tab shows this as an HTML card. The actual
certificate document is generated differently: `generate_certificates.py`
mail-merges real data into your actual uploaded `.pptx` template — name,
scores, date, certificate ID, and QR code get edited into the real file;
every color, font, border, and logo position is untouched, because
nothing is being redrawn. Verified against two real accounts with
genuinely different results (100%/3 submissions vs. 60%/5 submissions)
to confirm the merge output actually tracks the data, not just the name.

**Revised again**: verification now lives at a real path —
`/confirmation/{code}` — instead of a query string, served directly by
the backend as an actual HTML page rather than JSON a frontend page has
to fetch and render. Certificate codes changed from `DS-2026-XXXXXXXX`
to two hyphenated lowercase hex segments, long enough not to guess. The
domain is one config value (`DRACOSKILL_BASE_URL`), defaulted to
`http://localhost:8787` because that's what's actually real right now —
not hardcoded to a domain that doesn't exist yet, which would have meant
shipping QR codes that resolve nowhere.

## Version 4 — More languages (done, Kotlin and SQL still open)

Java, C and C++ now run alongside Python and JavaScript, as whole projects:
Java compiles every `.java` file and runs the class with `main`; C and C++
compile every source file into one binary. Each language is verified against
the real toolchain by `backend/selftest.py`. Compile errors are reported as
such (and the judge returns "Compilation Error"). Kotlin and SQL are not done.

## Version 5 — Package and library support (done)

A cloud terminal (managed command set, not a raw shell) installs libraries
inside the sandbox, never on the user's machine: `pip`, `npm`, Maven `jar`s
and header-only C/C++ libraries (`clib`). Scopes: per project, or `--account`
for every project the user owns. Allowlisted sources, per-user storage quota,
install concurrency limits. Known limits: no transitive resolution for jars,
no compiled C/C++ libraries, npm install scripts disabled.

## Version 6 — Courses and learning tracks

Structured lessons — explanation, example, embedded editor, assignment,
test — organized into tracks: Programming, Data Structures & Algorithms,
Web Development, Backend Development, Data Science, AI/ML, App
Development, Database Development, Software Engineering. Progress
auto-saves, and a recommendation engine suggests what's next.

## Version 7 — AI tutor

Explains concepts, code, and compiler errors. Debugs, reviews, and
suggests improvements. Leads with guidance and hints before handing over
a full answer, personalized from real course and problem history. The
rest of the platform keeps working if this is ever down.

## Version 8 — Gamification

XP, levels, streaks, badges, daily and weekly challenges, and
leaderboards — global, per-language, and per-course — all tied to real
activity from problems, courses, and projects.

## Version 9 — Social and community

Profiles, followers, posts, shared code snippets, questions and answers,
likes, comments, bookmarks, topic communities, direct messaging, and
notifications — with report/block/mute and a moderation queue built in
from the start rather than added after.

## Version 10 — Real-time layer

WebSockets for live execution status, notifications, and community
activity, replacing request/response polling wherever it actually
matters.

## Version 11 — Admin platform

A separate application with role-based access — Super Admin,
Administrator, Course Manager, Instructor, Moderator, Support, Content
Reviewer — to manage users, courses, problems, certificates, and
community reports, plus a system-health dashboard and audit logs.

## Version 12 — Account hardening

Google, GitHub, Microsoft, and Apple OAuth. Password reset and email
verification. Session and device management. Rate limiting on auth
endpoints.

## Version 13 — Analytics and observability

Real product analytics — active users, completion rates, execution
volume, retention. Structured logs, error tracking, and infrastructure
alerts.

## Version 14 — Cross-platform

PWA packaging first, then Android and iOS, then Windows, macOS, and
Linux — all sharing the same backend and as much frontend code as
possible rather than parallel rebuilds.

## Version 15 — Production hardening

Move off SQLite to PostgreSQL. Add Redis for caching and queues.
Containerize execution per language. Set up CI/CD with separated
environments. Full security review and load testing before anything here
is called production-ready.
