# NEXORA AI — Architecture

**Tagline:** One Intelligence. Every Workflow.

NEXORA AI is a two-layer platform:

1. **Personal multimodal AI workspace** — persistent chat, file/media intelligence, personal library, web search, durable automations, notifications and settings.
2. **InternFlow** — a role-isolated intern management and evaluation agent for organizations: Excel/CSV and Google Sheets ingestion, secure onboarding, sequential task assignment, submissions, rubric evaluation, corrections, meetings, reminders and progress reporting.

Both layers share authentication, a single relational database, file storage, notifications, audit logging and integration adapters — while enforcing organization and role boundaries so a personal chat can never reach company records.

## Runtime topology (development)

```
React + TypeScript (Vite, port 5173)
        │  /api, credentials: include, X-CSRF-Token, X-Request-ID
        ▼
FastAPI (Uvicorn, port 8000)
  ├── API routers (auth, chat, files, library, search, schedule, internflow, admin)
  ├── NexoraAgent orchestrator + typed tool registry
  ├── Domain services (evaluation, workflow, scheduler, email, search, storage)
  ├── SQLAlchemy 2.0 ──► SQLite (dev) / PostgreSQL (prod)
  ├── Durable scheduler thread (15s tick, DB-backed runs, idempotent)
  └── Local isolated storage (storage/<org>/<uuid>/<safe-name>)
        │
        ├── OpenAI adapter (chat, vision, transcription, image generation) — enabled when key present
        ├── Tavily web search adapter — enabled when key present
        ├── SMTP adapter — enabled when configured
        ├── Google Calendar/Meet adapter — enabled when service credentials present
        └── Clearly-labeled demo adapters when credentials are absent
```

The frontend is a static SPA. The API is same-origin in production (the FastAPI app serves `frontend/dist`), avoiding cross-origin cookie complexity. In development Vite proxies `/api` to port 8000.

## Design principles

- **The database is the source of truth.** Chat, library, schedules, assignments, evaluations, emails and audit entries all persist. Dashboard numbers are SQL aggregates, never constants.
- **Unauthorized IDs fail closed.** Every repository query scopes by `user_id` and/or `organization_id`. Object-level access is checked on read, download, update and delete.
- **Consequential actions are validated server-side.** The LLM may propose a tool call; the backend validates argument types, permissions, idempotency and state transitions before executing.
- **Untrusted content is fenced.** Uploaded documents, web pages and transcripts are passed to models inside explicit data boundaries with an instruction hierarchy that forbids them from changing system policy. Uploaded files are never executed.
- **Deterministic evaluation first.** InternFlow checks objectively verifiable criteria (required sections, minimum evidence, forbidden placeholders, deliverable count). Mandatory failures cannot be offset by a high score. Ambiguity escalates to a human.
- **No simulated external success.** Email, calendar and search adapters return explicit `demo`, `sent`, `failed` or `not_configured` states. The UI surfaces the provider status.

## Backend modules

| Module | Responsibility |
| --- | --- |
| `app/api/*` | HTTP contracts, validation, authorization dependencies, pagination |
| `app/models/*` | SQLAlchemy entities, constraints, relationships |
| `app/schemas/*` | Pydantic request/response models; UTC serialization |
| `app/services/*` | Use cases: AI, extraction, library retrieval, evaluation, InternFlow workflow, scheduler, email, calendar, storage, audit |
| `app/agent/*` | NexoraAgent orchestration, intent routing, typed tools, prompt-injection fencing |
| `app/integrations/*` | Provider adapters with capability reporting |
| `app/security/*` | Argon2id hashing, opaque session tokens, CSRF, rate limiting |
| `app/workers/scheduler.py` | Durable scheduler loop + reminder processing |

## Request lifecycle

1. `RequestContextMiddleware` assigns/propagates `X-Request-ID`, sets security headers, and emits access logs.
2. `get_current_user` resolves the `nexora_session` cookie (SHA-256 token hash, expiry, revocation) and loads memberships.
3. For mutating requests, `require_csrf` compares the `X-CSRF-Token` header with the session record (double-submit plus server-side binding).
4. Endpoint dependencies enforce role/tenant. Services apply object-level checks.
5. Responses use `{ "data": ..., "meta": ... }` for collections and direct objects for single resources; errors use `{ "error": { "code", "message", "request_id", "details" } }`.
6. Sensitive actions append `audit_logs`; high-volume actions append `background_jobs` / `outbox_events`.

## Chat generation

- `POST /api/chats/{id}/messages` accepts text, attachment IDs, mode (`chat | document | media`) and `search` flag.
- The agent builds bounded context (last N messages + rolling summary), loads authorized attachment excerpts, optionally runs web search, and streams tokens over SSE (`text/event-stream`).
- The client can abort the stream; the assistant message is finalized as `stopped` with partial content preserved. `POST /stop` also marks an active generation record.
- Regeneration supersedes the target assistant message and re-runs from the preceding user turn.
- Provider metadata (`demo` vs `openai`) is returned and rendered in the UI.

## Media pipeline

- Image: metadata + optional vision caption/QA (OpenAI) or explicit demo analysis; generation requires an image-capable model, otherwise a configuration error.
- Audio: OpenAI transcription when configured; demo mode refuses to invent a transcript and returns a configuration notice; browser microphone recording produces a real upload.
- Video: FFmpeg required for frame extraction/audio demux; the endpoint reports `ffmpeg_unavailable` rather than pretending. When enabled, transcription is timestamped and the response labels its method.

## InternFlow state machine

```
import batch (preview) ──confirm──► intern accounts (pending activation)
      │                                   │
      └── onboarding email + first task ◄──┘
                       │
              task assignment (assigned)
                       │ submission (versioned)
                       ▼
                  evaluation (rule engine [+ LLM for judgment criteria])
                    ├── passed ──► approve ──► next task (exactly once)
                    │                        └── or complete internship
                    ├── corrections_required ──► feedback + revised due date
                    └── human_review_required ──► admin decision
```

All transitions are guarded by the current status and recorded in `audit_logs`. Assigning the next task uses an idempotency guard (`next_assignment_id` + status check) so retries cannot duplicate tasks.

## Frontend architecture

- React Router route tree with a persistent shell (`AppShell`): sidebar, topbar, contextual panel, mobile drawer.
- TanStack Query for server state (retries, invalidation, optimistic updates); local UI state in React context/stores.
- `ApiClient` centralises JSON requests, multipart uploads, CSRF headers, error normalization, and SSE streaming.
- Accessible primitives (`Dialog`, `ConfirmDialog`, `Menu`, `Tabs`, `Toast`) built on native semantics; keyboard focus management and ARIA labels.
- Light/dark themes via CSS variables with persisted preference and `prefers-color-scheme` default.

## Failure modes and mitigations

| Risk | Mitigation |
| --- | --- |
| Cross-tenant access | Dual scoping (org + user), tests for IDOR, role dependencies |
| Prompt injection in uploads | Fenced untrusted context, fixed rubric, tool allowlist, no arbitrary SQL/shell |
| Duplicate onboarding/task | Unique constraints, import batch state, idempotency records, guarded transitions |
| Scheduler double-run | Unique `(task_id, scheduled_for)` run key, `next_run_at` advance, process lock |
| Fake external success | Adapter capability flags; `demo` status surfaced in UI and email logs |
| Oversized/malicious uploads | Size/type allowlist, safe names, hash, isolated path, no execution, optional scan hook |
| Session theft | HttpOnly/SameSite cookies, token hashing at rest, expiry/revocation, CSRF header binding |
