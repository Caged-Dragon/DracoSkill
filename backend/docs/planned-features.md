# DracoSkill — planned features

Everything specified in the original master prompt, organized by area.

## Code execution platform

- Cloud IDE — write code in the browser, no local install
- Real execution on Run, never simulated compiler output
- Python, Java, JavaScript, C, C++, Kotlin, SQL
- HTML/CSS as web-development technologies
- Capture stdout, stderr, exit code, execution time
- Timeout enforcement
- Memory and resource limits per execution
- Output-size limits
- Job queue / execution scheduler for concurrent load
- Warm environments and runtime caching for cold-start speed
- Queueing with clear status during high demand
- Package/library installation — automatic and manual
- Dependency caching, version management, install logs

## Projects

- Multiple files and folders per project
- File create, delete, rename, upload, download
- File tree
- Multiple editor tabs
- Terminal access
- Standard input / output / error output panels
- Cloud project storage — create, rename, delete, duplicate, save, auto-save
- Project version history
- Project sharing — private, unlisted, public — with a viewer

## Courses & learning

- Structured courses, beginner to advanced
- Lessons combining explanation, examples, and an embedded interactive editor
- Assignments and quizzes with defined completion criteria
- Learning tracks: Programming, Data Structures & Algorithms, Web
  Development, Backend Development, Data Science, Artificial
  Intelligence/Machine Learning, App Development, Database Development,
  Software Engineering
- Auto-saved progress through a lesson
- Recommendation engine based on completed content, performance, and
  weak areas

## Coding problems

- Problem platform — title, description, difficulty, topics, constraints,
  examples, test cases
- Starter code per language
- Hints and editorial/solution
- Automated judge — Accepted, Wrong Answer, Compilation Error, Runtime
  Error, Time Limit Exceeded, Memory Limit Exceeded
- Hidden test cases, not exposed to the user
- Acceptance statistics
- User-created problems — authoring, draft/private/shared/public,
  moderation, versioning

## AI assistant

- Explain concepts, explain code, explain compiler errors
- Debugging help, code review, improvement suggestions
- Guidance → hints → explanation → full solution, escalating on request
- Generate practice questions and quizzes
- Personalized recommendations from a learner's progress and weak spots
- Platform stays usable if the AI service is unavailable

## Social / community

- User profiles — bio, skills, languages, projects, achievements
- Followers, following, friends
- Posts, code snippets, questions and answers
- Likes, comments, bookmarks
- Communities (topic-based groups)
- Direct messaging
- Notifications
- Moderation — report, block, mute, moderation queue, audit log

## Gamification

- XP and levels
- Daily streaks
- Badges and achievements
- Daily and weekly challenges
- Leaderboards — global, per-language, per-course

## Certification

- Certificate design preserved from the supplied template
- Dynamic generation from real user and course data
- Unique certificate ID per issued certificate
- QR verification
- Public verification page — certificate validity, student name, course,
  issue date, status

## Accounts & authentication

- Email/password registration and login
- Google, GitHub, Microsoft, and Apple OAuth
- Secure password hashing, never stored plain
- Password reset, email verification
- Session management, device/session list
- Rate limiting on auth endpoints
- Account linking, logout

## Admin platform

- Separate administrative application from the user-facing app
- Role-based access control — Super Admin, Administrator, Course
  Manager, Instructor, Moderator, Support, Content Reviewer
- Manage users, courses, lessons, problems, projects, languages,
  packages, certificates, communities, posts, reports
- System-health and analytics dashboard
- Audit logs

## Analytics & observability

- Product analytics — active users, course enrollment/completion,
  problem attempts/acceptance, execution volume, AI usage, retention
- Structured logs, error tracking, metrics
- Infrastructure alerts
- Backups and disaster-recovery plan

## Design system & UX

- Distinctive visual identity, not a generic template
- Dark mode and light mode
- Responsive layout across desktop, laptop, tablet, and mobile
- Accessibility — keyboard navigation, screen readers, contrast, focus
  states, reduced motion
- Global search across courses, lessons, problems, projects, users,
  communities
- Personalized dashboard reflecting real activity
- Animation — page transitions, progress and achievement reveals,
  respecting reduced-motion preferences

## Cross-platform

- Web
- PWA
- Android and iOS
- Windows, macOS, and Linux desktop applications
- Maximum code reuse across platforms rather than separate parallel apps

## Architecture & infrastructure

- Versioned REST API
- Normalized database covering users, courses, problems, projects,
  certificates, social, gamification, execution, and audit data
- Redis cache and job queue
- WebSockets for live execution status and notifications
- Containerized, isolated execution runtimes per language
- CI/CD and separated development/staging/production environments
- Security review, load testing, and full test coverage (unit,
  integration, end-to-end)

## Business model

- Completely free to users
- No paywall on core functionality
- No advertisements
