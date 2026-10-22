# DracoSkill — Architecture blueprint (Phase 1)

Condensed from the original DracoSkill master prompt into a buildable, phased plan — the Phase 1 deliverable its own "Build order" section calls for before any implementation starts.

## Scope note

The original brief describes a platform for a large engineering org. This blueprint keeps the same ambition but sequences it as a vertical slice built incrementally, so there's a real, working product at every stage instead of a big-bang rewrite that never ships.

## 1. Recommended stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js (React + TypeScript) | SSR for course/marketing pages, PWA-ready, one codebase to reuse via Capacitor/Tauri |
| Editor | Monaco Editor | Same engine as VS Code — don't build an editor from scratch |
| Backend API | NestJS (Node/TypeScript) | Shares types with the frontend; mature module/DI system for auth, courses, social, certificates |
| Execution workers | One container image per language runtime | Isolation per job; each runtime owns its own image and dependency set |
| Job queue | Redis + BullMQ | Simple, well-understood, gives visibility into queue depth and job state |
| Database | PostgreSQL | Relational integrity for users, courses, submissions, certificates |
| Cache | Redis | Session cache, rate limiting, hot course content |
| Object storage | S3-compatible (S3, R2, or MinIO) | Project files, generated certificate PDFs, avatars |
| AI tutor | Claude API | Explanation, hints, code review, recommendations |
| Realtime | WebSockets (Socket.IO) | Execution status, notifications, live queue position |
| Mobile | Capacitor wrapping the web app | One UI codebase instead of a parallel React Native build |
| Desktop | Tauri wrapping the web app | Small footprint, reuses the same frontend |

## 2. High-level architecture

```
Client apps (web, mobile, desktop)
              │
              ▼
   API gateway  (auth, routing, rate limits)
              │
      ┌───────┴────────┐
      ▼                 ▼
Core services      Execution pipeline
(courses,          (queue → scheduler →
problems, social,   isolated sandboxes:
certificates,       python, node, java,
AI tutor)            c/c++, kotlin, sql)
      │                 │
      └───────┬─────────┘
              ▼
Data layer — PostgreSQL · Redis · object storage
```

## 3. Repository structure

```
dracoskill/
├── apps/
│   ├── web/                      # Next.js web app (PWA-capable)
│   ├── mobile/                    # Capacitor wrapper around web
│   └── desktop/                    # Tauri wrapper around web
├── services/
│   ├── api/                          # NestJS core API — auth, courses, problems, projects, social, certificates
│   ├── execution-orchestrator/        # Queues jobs, tracks state, talks to workers
│   └── ai-tutor/                       # Wraps Claude API calls for hints, review, recommendations
├── workers/
│   ├── python-runner/
│   ├── node-runner/
│   ├── java-runner/
│   ├── c-cpp-runner/
│   ├── kotlin-runner/
│   └── sql-runner/
├── packages/
│   ├── ui/                           # shared design-system components
│   ├── types/                         # shared TypeScript contracts
│   └── config/                         # shared eslint/tsconfig/tailwind config
├── infra/
│   ├── docker/
│   └── migrations/
└── docs/
```

## 4. Core data model (grouped)

- **Identity** — users, profiles, sessions, oauth_accounts, roles
- **Learning** — tracks, courses, modules, lessons, lesson_progress, assignments, assignment_submissions
- **Problems and judging** — problems, test_cases, submissions, topics
- **Projects** — projects, project_files, project_versions, dependencies
- **Execution** — execution_jobs, execution_results, resource_usage
- **Certification** — certificates, certificate_verifications
- **Social** — posts, comments, likes, follows, communities, messages, notifications
- **Gamification** — xp_events, badges, achievements, streaks
- **AI** — ai_conversations, recommendations

## 5. Execution and security model

- Submitted code never runs on the API server — only inside dedicated worker containers.
- One ephemeral container per execution job: no network access, read-only root filesystem except a scratch `/tmp`, non-root user, and hard CPU, memory, process-count, and wall-clock limits.
- Output is capped in size; the container is destroyed immediately after the job completes or times out.
- Upgrade path once past prototype: swap plain container isolation for gVisor or Firecracker microVMs for stronger kernel-level isolation, the way most production code-execution platforms do.
- Local prototype note: this chat sandbox doesn't expose a container daemon to me, so early demos built here will approximate isolation with OS-level limits (`ulimit`, `timeout`, restricted subprocess calls) — clearly a prototype stand-in, not the container isolation described above.

## 6. Certificate module

- The SkillBuild certificate you uploaded becomes the template for a Certificates module: logo, layout, and color scheme preserved, with name, course, scores, date, certificate ID, and QR code rendered from real database records at generation time — exactly what the master prompt's own certificate section asks for.
- Verification page: enter or scan a certificate ID and see validity, student name, course, issue date, and status, without exposing anything else about the student.
- Boundary: the module will generate accurate certificates from real stored results, including reissuing or restyling this one — it won't alter the actual recorded score or outcome to misrepresent someone's results.

## 7. Phased build order — vertical-slice-first

0. **Foundations** — monorepo scaffold, design-system tokens, email/password auth, Postgres schema v1.
1. **Vertical slice** — one course, one lesson, embedded Monaco editor, real execution for Python and JavaScript, completion tracking.
2. **Certificates** — generator and verification page, built on the SkillBuild template.
3. **Problems platform** — problem list, submission, judge, verdicts (reuses the execution service).
4. **Projects** — multi-file projects, file tree, save and run.
5. **AI tutor** — Claude-powered hints, explanations, and code review wired into lessons and problems.
6. **Social layer** — profiles, follows, posts, comments.
7. **Gamification** — XP, streaks, badges, leaderboards.
8. **Admin console** — role-based access, content management, moderation.
9. **Remaining languages** — Java, C, C++, Kotlin, SQL, plus package-manager support.
10. **Mobile and desktop shells** — Capacitor and Tauri wrapping the same frontend.
11. **Hardening** — security review, load testing, real cloud deployment.

## 8. Division of labor

**What I can build here:** application code, database schemas and migrations, container configs, API routes, UI components, the design system, documentation, and runnable prototypes and demos inside this sandbox — including a working Python/JavaScript execution demo and the certificate generator.

**What needs your action outside this chat:** registering OAuth apps with Google, GitHub, Microsoft, and Apple for real client IDs and secrets; provisioning real cloud hosting plus a production Postgres/Redis instance, object storage, a domain, and SSL; and app-store developer accounts if you want to publish the mobile or desktop builds. Everything built here will be set up so those are plug-in-the-credentials steps, not rewrites.

## 9. Suggested next step

The natural next piece is the vertical slice from step 1 — a dashboard and IDE shell using the design system, wired to real Python and JavaScript execution, plus the certificate generator running on your SkillBuild template.
