# DracoSkill

*Forge your skills.* A product by **CagedDragons**.

## Short description

DracoSkill is a free platform for writing, running, and getting honestly
judged on real code. Open the cloud IDE and press Run — the code actually
executes, in a real sandboxed process, with a real timeout. Submit a
solution to a coding problem and the verdict comes from genuinely running
your code against test cases, not a pattern match. Create an account and
that history is really saved, behind properly hashed passwords, in a real
database.

## Full description

DracoSkill is built around one non-negotiable rule: nothing on the
platform pretends. Where most learn-to-code demos fake the parts that are
hard to build — a compiler that isn't really compiling, a judge that
isn't really judging, an account system that forgets you on refresh —
DracoSkill's foundation is the opposite bet: build the real thing first,
even if that means the surface area is smaller than the eventual vision.

That foundation is a cloud IDE with genuine Python, Java, JavaScript, C and C++
execution, a coding-problem judge that runs submissions against real test
cases (including hidden ones) and returns an honest verdict, and an
account system with salted, properly-hashed passwords and a submission
history that survives a browser refresh because it lives in an actual
database, not local page state. A marketing site and the product itself
are separated as their own pages, both with real light and dark themes
built on one shared design system.

It's the first working slice of a larger platform CagedDragons is
building toward: structured courses, an AI tutor that leads with hints
before answers, a developer community, gamification that tracks real
consistency, verifiable certificates tied to real course records, and
execution support for more languages on the same architecture Python and
JavaScript already run on today.

## What's built and working

- **Cloud IDE** — real file tree, code editor, and a Run button that means
  it. Python executes through a backend execution service; JavaScript
  executes live in a sandboxed browser worker. Both are genuinely
  sandboxed with enforced timeouts, not just UI dressed around a fake
  response.
- **Coding problems & judge** — real problems, each with a judge that
  actually runs submitted code against every test case (including one
  hidden case per problem) and returns Accepted, Wrong Answer, Runtime
  Error, or Time Limit Exceeded based on what really happened, with real
  output shown when something fails.
- **Accounts & persistence** — username/password accounts, PBKDF2
  password hashing (200,000 iterations, salted, never stored plain),
  session tokens, and a genuine submission history stored in SQLite.
- **A real, modular codebase** — the frontend is split into markup,
  styles, and behavior per page instead of one inlined file; the backend
  is split into single-purpose modules (database, auth, execution engine,
  judge, HTTP routing) with a one-way dependency graph.

## Where it's headed

- **Certificates** — the visual template exists and a generation pipeline
  was proven against a real course record, but the DracoSkill-branded
  version isn't wired into the current backend yet. Next up when
  revisited: a real `/certificates` module driven by the same database
  the judge already writes to.
- **AI tutor, structured courses, developer community, gamification** —
  designed into the platform's architecture, not yet built. Each is
  scoped to reuse the execution and account systems already in place
  rather than standing up parallel infrastructure.
- **More languages** — Java, C, C++, Kotlin, and SQL, added the same way
  Python and JavaScript were: one entry in the execution engine's runner
  table, verified against the real interpreter before shipping.

## Built by

**CagedDragons** — Unleash Possibilities.
