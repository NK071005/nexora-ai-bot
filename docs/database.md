# NEXORA AI — Database

SQLAlchemy 2.0 declarative models live in `backend/app/models/`. IDs are UUID strings except join tables. All timestamps are UTC. Production uses PostgreSQL; SQLite is supported for local development and tests.

## Conventions

- `id` — `String(36)` UUIDv4 primary key.
- `created_at` / `updated_at` — naive UTC timestamps written by `utcnow()` and serialized with a `Z` suffix.
- `deleted_at` — soft deletion for user-facing containers (chats, library items, scheduled tasks). Messages and files follow retention policy; hard deletes cascade where documented.
- Foreign keys declare `ondelete` behavior explicitly. SQLite foreign keys are enabled with a connection-level `PRAGMA foreign_keys=ON`.
- JSON columns use the portable `sa.JSON` type (JSONB-compatible on PostgreSQL via migration).
- Every organization-scoped table carries `organization_id`; every personal table carries `user_id`. Queries always filter both where applicable.

## Entity map

### Identity and organizations
| Table | Key columns | Constraints / notes |
| --- | --- | --- |
| `users` | email, password_hash, full_name, is_active, email_verified_at, is_super_admin, default_organization_id, timezone, last_login_at | `uq_users_email`; Argon2id hash only |
| `user_profiles` | user_id PK/FK, headline, bio, preferences JSON | 1:1 user |
| `oauth_accounts` | user_id, provider, subject, email | `uq_oauth_provider_subject` |
| `sessions` | user_id, token_hash, csrf_token, expires_at, revoked_at, user_agent, ip | `uq_sessions_token_hash`, index `(user_id, expires_at)` |
| `account_activation_tokens` | user_id, token_hash, expires_at, used_at | single-use, hashed |
| `password_reset_tokens` | user_id, token_hash, expires_at, used_at | single-use, hashed |
| `organizations` | name, slug, kind, settings JSON | `uq_org_slug` |
| `organization_memberships` | organization_id, user_id, role, status | `uq_membership_org_user`; roles: `owner`, `admin`, `member`, `intern` |

### Chat workspace
| Table | Notes |
| --- | --- |
| `chat_sessions` | owner + optional org, title, pinned/archived, `deleted_at`, model, `last_message_at`; index `(user_id, deleted_at, last_message_at)` |
| `chat_messages` | role, content, status (`complete/streaming/stopped/error`), provider, model, citations JSON, tool_activity JSON, error, token usage, `parent_id` |
| `chat_attachments` | chat/message linkage to `files`; unique `(message_id, file_id)` |
| `conversation_summaries` | rolling context compression with message count |
| `conversation_tags` | unique `(chat_id, tag)` |

### Files, library, media
| Table | Notes |
| --- | --- |
| `files` | owner, org scope, original/safe name, MIME, size, SHA-256, storage key, extraction status, extracted text (bounded), metadata, `deleted_at` |
| `library_folders` | owner + optional org, name, parent |
| `library_items` | owner + org, kind (`file/note/saved_answer/image/audio/video`), folder, title, description, tags, content, storage linkage, favorite, soft delete |
| `library_tags` / `library_item_tags` | user-scoped tags and many-to-many |
| `document_chunks` | bounded chunks for lexical retrieval with page/index metadata |
| `media_assets` | owner, kind, file linkage, status, metadata |
| `media_processing_jobs` | async job state, progress, result/error |
| `transcripts` | media linkage, language, text, timestamped segments, provider |
| `generated_artifacts` | generated image/audio artifacts with prompt and provider |
| `search_jobs` / `search_results` | persisted web search queries and ranked citations |

### Scheduling
| Table | Notes |
| --- | --- |
| `scheduled_tasks` | owner/org, type, schedule kind, timezone, `next_run_at`, status, counters, config JSON, notification prefs |
| `scheduled_task_runs` | one row per attempt; unique `(task_id, scheduled_for)`; output/error/attempt |
| `scheduled_task_notifications` | delivery record per run |
| `reminder_jobs` | InternFlow deadline reminders, unique `(assignment_id, kind, scheduled_for)`, status attempts |
| `background_jobs` | durable generic queue (outbox-style) with attempts/backoff |
| `outbox_events` | domain events for future async consumers |

### InternFlow
| Table | Notes |
| --- | --- |
| `intern_profiles` | org, user, batch, identity fields, dates, timezone, status, current task; unique `(organization_id, email)` |
| `import_batches` | file, counts, status (`preview/confirmed/failed`), row errors JSON; prevents duplicate onboarding |
| `task_templates` | sequenced task definition, version, methodology, deliverables, criteria JSON, rubric, threshold, attempts, escalation |
| `task_assignments` | intern + template snapshot, status, attempts, due date, next assignment guard |
| `submissions` | assignment, version, text, status; unique `(assignment_id, version)` |
| `submission_files` | immutable file metadata + SHA-256 |
| `evaluations` | structured verdict, score, confidence, human-review flag, decision metadata |
| `evaluation_criteria_results` | per-criterion status/evidence/comment |
| `meetings` | intern/assignment, proposed or scheduled, provider, Meet URL (only when real), calendar event ID |
| `email_logs` | provider, `sent/demo/failed`, body snapshot, related entity |
| `notifications` | in-app recipient, read state, link |
| `human_review_decisions` | reviewer decision + notes |

### Operations and security
| Table | Notes |
| --- | --- |
| `audit_logs` | actor/org/action/entity/metadata/IP; no secrets or document bodies |
| `integration_connections` | provider status and non-secret metadata |
| `idempotency_records` | user + key + endpoint + stored response |
| `files`, `submissions`, `email_logs` | retention/deletion covered in `security.md` |

## Migrations

Alembic configuration is in `backend/alembic.ini`; the initial migration creates the schema. Development bootstrap uses `Base.metadata.create_all()` for a frictionless start, then Alembic stamps/upgrades. Production MUST use Alembic.

```powershell
cd backend
python -m alembic upgrade head
```

## Indexing strategy

- Chat lists: `(user_id, deleted_at, is_pinned, last_message_at)`.
- Message fetch: `(chat_id, created_at)`.
- Library search: `(user_id, deleted_at, kind)`, plus SQL `LIKE` on title/extracted content; chunk lookup by item.
- InternFlow dashboards: `(organization_id, status)`, `(intern_id, status)`, `(assignment_id, version)`.
- Scheduler due scan: `(status, next_run_at)`; reminders `(status, scheduled_for)`.
- Audit: `(organization_id, created_at)`, `(actor_id, created_at)`.

Semantic retrieval is intentionally **not** claimed: retrieval is lexical (term-frequency scoring over stored chunks). A `document_chunks` table and `LibraryRetriever` interface make a vector backend a drop-in future extension.

## Data retention

- Chat/message deletion is a hard delete after ownership check (attachments unlinked, files removed if unreferenced).
- Library items are soft-deleted, recoverable for 30 days by retention job (not enabled by default in dev).
- InternFlow submissions and evaluations are retained for the internship lifecycle plus configured retention; they are never deleted by chat operations.
- `audit_logs` are append-only and contain identifiers/metadata only.
- Session tokens and activation tokens are stored only as SHA-256 hashes.
