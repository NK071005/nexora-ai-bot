# NEXORA AI

A full-stack, multimodal AI workspace with persistent chat, a document library, live-web research, scheduled automations, and **InternFlow** — an intern assignment and evaluation workflow.

NEXORA is designed around one rule: **never fake a result**. Demo AI, skipped email delivery, missing web search, and unavailable Google Meet links are surfaced explicitly in the UI and API. Unconfigured integrations never invent quotes, citations, email sends, meeting URLs, or success states.

---

## What is included

### Workspace

- Persistent, streamed conversations with attachments, stop/regenerate, pin, archive, rename, and delete
- Markdown answers with citations and visible tool activity
- Document library with folders, tags, favourites, uploads, extraction, inspectable chunks, and lexical (TF-based) retrieval
- Web, conversation, and library research with explicit provider states
- Scheduled automations backed by a database scheduler with unique run slots, retries with backoff, pause/resume, run-now, and run history
- Team and organization switching with tenant-scoped data
- Profile, security, integrations, organization, notification, and audit settings
- Super-admin organization and user management view

### InternFlow

- Versioned task templates with deterministic, weighted evaluation criteria
- Spreadsheet import with preview, row-level validation, confirmation, and duplicate-safe reruns
- Intern profiles, assignments, deadlines, onboarding, and progress
- Streaming-grounded intern assistant
- Deterministic submission evaluation with mandatory-criterion failures and human review
- Corrections loop and reviewer decisions with audit trail
- Meetings with `.ics` fallback and real Google Calendar/Meet only when configured
- Delivery log and workflow audit
- Intern self-service "My Work" area with submissions, feedback, meetings, and assistant

### Authentication and security

- Register, login, logout, email verification, password reset, activation, and Google OAuth
- Argon2 password hashing
- Opaque, hashed server-side sessions in `HttpOnly` cookies
- CSRF double-submit tokens bound to the session
- Role and organization isolation enforced in the API
- Rate limiting on credential endpoints
- Configurable email verification
- No secrets committed — see `.env.example`

---

## Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.12+, FastAPI, SQLAlchemy 2.x, Alembic, Pydantic 2 |
| Database | SQLite for local development, PostgreSQL for production |
| Frontend | React 19, TypeScript, Vite 6, Tailwind CSS 3, React Router |
| AI | OpenAI SDK, with a labelled extractive Demo Intelligence fallback |
| Documents | pandas, openpyxl, PyMuPDF, python-docx, Pillow |
| Media | FFmpeg (optional for video frame extraction) |
| Auth | Argon2, server-side sessions, CSRF, Google OAuth |

---

## Quick start

### Prerequisites

- Python 3.12+
- Node.js 20+ and npm
- Optional: FFmpeg for video analysis
- Optional: PostgreSQL for production

### 1. Install backend dependencies

```powershell
cd C:\Users\navee\Documents\nexora-ai
python -m pip install -r backend\requirements.txt
```

A virtual environment is recommended:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r backend\requirements.txt
```

### 2. Seed the demo workspace

```powershell
cd C:\Users\navee\Documents\nexora-ai\backend
python scripts\seed.py
```

The seed is idempotent. It creates the **Nexora Labs** organization, users, interns, templates, evaluations, a meeting, library items, notifications, chats, and scheduled tasks.

### 3. Start the API

```powershell
cd C:\Users\navee\Documents\nexora-ai\backend
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

- API: <http://127.0.0.1:8000/api>
- Swagger UI: <http://127.0.0.1:8000/api/docs>
- Health: <http://127.0.0.1:8000/api/health>

### 4. Start the frontend

In a second terminal:

```powershell
cd C:\Users\navee\Documents\nexora-ai\frontend
npm install
npm run dev
```

Open <http://127.0.0.1:5173>. Vite proxies `/api` to the backend.

### Single-server mode

FastAPI serves the built SPA from `frontend/dist`:

```powershell
cd C:\Users\navee\Documents\nexora-ai\frontend
npm install
npm run build

cd C:\Users\navee\Documents\nexora-ai\backend
python scripts\seed.py
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Open <http://127.0.0.1:8000>.

---

## Demo accounts

Demo accounts appear on the sign-in page when demo login is enabled outside production.

| Role | Email | Password |
|---|---|---|
| Super Admin | `super@nexora.demo` | `NexoraSuper!2026` |
| Organization Admin | `admin@nexora.demo` | `NexoraDemo!2026` |
| Intern | `intern@nexora.demo` | `NexoraDemo!2026` |
| Standard user | `priya@nexora.demo` | `NexoraDemo!2026` |
| Standard user | `maya@nexora.demo` | `NexoraDemo!2026` |

---

## Configuration

Copy `.env.example` to `.env` at the repository root and set only what you need.

```powershell
Copy-Item .env.example .env
```

If you set `DATABASE_URL=sqlite:///./nexora.db`, run backend commands from the `backend` directory so the relative path resolves correctly. When no `.env` exists, the application defaults to `backend/nexora.db`.

### Capability matrix

| Capability | Without configuration | With configuration |
|---|---|---|
| Chat answers | Labelled extractive Demo Intelligence | OpenAI chat + vision |
| Image generation | Explicitly unavailable | OpenAI image generation |
| Transcription | Explicitly unavailable | OpenAI transcription |
| Web search | Explicit configuration error | Tavily or Serper |
| Email | Recorded with `demo` status, never sent | SMTP delivery |
| Google sign-in | "Not configured" state | Google OAuth |
| Google Meet | Meeting record + `.ics`, no invented link | Google Calendar/Meet |
| Video frames | `409 ffmpeg_unavailable` | FFmpeg extraction |
| Library retrieval | Lexical TF search, clearly labelled | Same (no vector store) |

### Key environment variables

| Variable | Purpose |
|---|---|
| `SECRET_KEY` | Signing secret; change in production |
| `DATABASE_URL` | SQLAlchemy database URL |
| `OPENAI_API_KEY` | Enables live AI providers |
| `SEARCH_PROVIDER`, `SEARCH_PROVIDER_API_KEY` | Tavily/Serper web search |
| `SMTP_HOST`, `SMTP_USERNAME`, `SMTP_PASSWORD` | Real email delivery |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_CALENDAR_ID` | Calendar/Meet |
| `SCHEDULER_ENABLED` | Enables the DB-backed scheduler |
| `STORAGE_DIR` | Upload directory |

Never commit `.env`. Production must use a strong `SECRET_KEY`, PostgreSQL, HTTPS, and real credentials.

---

## Database migrations

Development boot creates missing tables. Production should use Alembic:

```powershell
cd C:\Users\navee\Documents\nexora-ai\backend
alembic upgrade head
```

The initial migration creates the complete schema. Set `DATABASE_URL` before running it.

---

## Tests and checks

Backend:

```powershell
cd C:\Users\navee\Documents\nexora-ai\backend
python -m pytest -q
```

Frontend:

```powershell
cd C:\Users\navee\Documents\nexora-ai\frontend
npm run typecheck
npm run build
```

The backend suite covers authentication, CSRF, session isolation, chat persistence and streaming, files, library search, spreadsheet analysis, evaluation rules, InternFlow role/tenant isolation, import idempotency, prompt-injection handling, scheduler retries, capability honesty, and super-admin isolation.

---

## Sample data

- `samples/internflow_interns.xlsx` — valid import workbook
- `samples/internflow_interns_with_errors.xlsx` — validation example

On **InternFlow → Import interns**, upload the valid workbook, review the preview, and confirm the import.

---

## Project structure

```text
nexora-ai/
├── backend/
│   ├── app/
│   │   ├── routers/          # auth, chat, library, search, scheduled, internflow...
│   │   ├── services/         # AI, search, email, files, evaluation, scheduler
│   │   ├── security/         # passwords, sessions, CSRF
│   │   ├── models.py         # SQLAlchemy entities
│   │   ├── schemas.py        # Pydantic contracts
│   │   └── main.py           # FastAPI app and SPA serving
│   ├── alembic/              # migrations
│   ├── scripts/seed.py       # idempotent demo seed
│   └── tests/                # pytest suite
├── frontend/
│   ├── src/
│   │   ├── app/              # shell, routes, auth/theme/toast contexts
│   │   ├── components/       # UI kit, layout, InternFlow components
│   │   ├── pages/            # workspace and InternFlow pages
│   │   ├── services/api.ts   # typed API client
│   │   └── types/api.ts      # API contracts
│   └── dist/                 # build output (generated)
├── samples/
├── docs/
├── .env.example
└── README.md
```

More detail: `docs/architecture.md` and `docs/database.md`.

---

## Honest limitations

- Library retrieval is lexical, not semantic/vector search.
- Demo Intelligence is extractive and labelled; it is not a language model.
- Real Google Meet links require Google credentials and libraries; otherwise `.ics` is provided.
- Video frame extraction requires FFmpeg.
- The scheduler is a single-process database-backed thread. Multi-instance production deployments should externalize scheduling.
- The in-memory auth rate limiter is per process. Use a shared store such as Redis for multi-instance deployments.

---

## License

No license has been declared for this repository. Add one before redistribution.
