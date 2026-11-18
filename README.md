# RAG backend

Express and TypeScript backend for study documents, notebooks, courses, chat sessions, flashcards, tests, and user profiles. It uses Supabase Auth, PostgreSQL with pgvector, Cloudflare R2, Redis/BullMQ, Groq, OpenRouter, and Sentry.

The HTTP server and the background workers run as separate processes. Documents are ingested on the `document-processing` queue; practice tests are generated asynchronously on the `test-generation` queue.

## Prerequisites

- Node.js 22 and npm. CI uses Node 22, and the independent API test suite relies on global `fetch`, so Node 20 or newer is required.
- A Supabase project with authentication configured.
- A PostgreSQL database with pgvector available; the Supabase project database can be used.
- Redis reachable by both the API and the workers.
- A Cloudflare R2 bucket and credentials with access to that bucket.
- Groq and OpenRouter API keys.
- A Sentry project DSN.
- Docker, if using the local Redis example or the Compose stack below.
- MinerU (`mineru-kit`) only if you ingest math PDFs; see `MINERU_*` below.

Run all commands in this README from the `backend` directory unless a command says otherwise.

## 1. Install dependencies

```sh
cd backend
npm ci
```

If your terminal is already in `backend`, skip `cd backend`.

## 2. Configure environment variables

```sh
cp .env.example .env
```

```dotenv
NODE_ENV=development

SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY=YOUR_SUPABASE_SECRET_KEY
SUPABASE_JWKS_URL=https://YOUR_PROJECT_REF.supabase.co/auth/v1/.well-known/jwks.json

DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE
FRONTEND_URL=http://localhost:5173

R2_ENDPOINT=https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=YOUR_R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY=YOUR_R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME=YOUR_R2_BUCKET_NAME

GROQ_API_KEY=YOUR_GROQ_API_KEY
GROQ_MODEL=openai/gpt-oss-120b
EMBEDDING_MODEL=YOUR_EMBEDDING_MODEL_ID
OPENROUTER_API_KEY=YOUR_OPENROUTER_API_KEY

REDIS_URL=redis://localhost:6379
PROCESS_DOCUMENT_QUEUE=process-document

SENTRY_DSN=https://YOUR_PUBLIC_KEY@YOUR_SENTRY_HOST/YOUR_PROJECT_ID
```

Replace the uppercase placeholders. `.env` is ignored by Git.

| Variable                                    | Purpose                                                                                                                                                |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NODE_ENV`                                  | `development`, `test`, or `production`; defaults to `development`.                                                                                     |
| `SUPABASE_URL`                              | Supabase project URL.                                                                                                                                  |
| `SUPABASE_PUBLISHABLE_KEY`                  | Key used by the Supabase client to verify user access tokens.                                                                                          |
| `SUPABASE_SECRET_KEY`                       | Required by environment validation; the current auth client uses the publishable key.                                                                  |
| `SUPABASE_JWKS_URL`                         | Required URL; the current middleware verifies tokens through `supabase.auth.getUser()`.                                                                |
| `DATABASE_URL`                              | PostgreSQL connection string for Drizzle and migrations. URL-encode special characters in credentials.                                                 |
| `FRONTEND_URL`                              | Allowed browser origin for API CORS; defaults to `http://localhost:5173`.                                                                              |
| `R2_ENDPOINT`                               | R2 S3 API endpoint.                                                                                                                                    |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 API credentials.                                                                                                                                    |
| `R2_BUCKET_NAME`                            | Bucket used for document uploads.                                                                                                                      |
| `GROQ_API_KEY` / `GROQ_MODEL`               | Groq credentials and model ID used for structured test generation in `groqAI.ts`.                                                                      |
| `EMBEDDING_MODEL`                           | OpenRouter embedding model ID used for document and query embeddings; it must return 2,048-dimension vectors.                                          |
| `OPENROUTER_API_KEY`                        | OpenRouter credentials for chat answers and embeddings; the chat model is hardcoded in `openRouterAI.ts`.                                              |
| `REDIS_URL`                                 | Redis connection URL for queue producers and workers.                                                                                                  |
| `PROCESS_DOCUMENT_QUEUE`                    | Name of the submitted document job, despite the variable's name. The BullMQ queue itself is hardcoded as `document-processing` in producer and worker. |
| `SENTRY_DSN`                                | Sentry error reporting and tracing destination. Must be a valid URL.                                                                                   |

`src/config/env.ts` validates environment variables when imported. All variables above except `NODE_ENV` and `FRONTEND_URL` are required, including when running migrations. Empty required values prevent startup. CI dummy values satisfy validation for mocked tests; real service operations require working credentials.

The ingestion service also reads these optional variables directly from `process.env` (they are not validated by `env.ts`):

| Variable            | Purpose                                                           |
| ------------------- | ----------------------------------------------------------------- |
| `MINERU_COMMAND`    | MinerU executable; defaults to `mineru-kit`.                      |
| `MINERU_TIER`       | `basic`, `standard`, or `advanced`; defaults to `advanced`.       |
| `MINERU_TIMEOUT_MS` | Positive integer timeout in milliseconds; defaults to 30 minutes. |

They only matter for PDFs uploaded with `hasMathFormula: true`.

## 3. Set up PostgreSQL and run migrations

Set `DATABASE_URL` to the target database connection string. The runtime disables prepared statements for compatibility with Supabase's transaction pooler. Use the connection details supplied by your database provider, including any required SSL parameters.

Apply the committed migration history:

```sh
npx drizzle-kit migrate
```

The migrations create the application tables and include `CREATE EXTENSION IF NOT EXISTS vector`. The database must have pgvector installed and the migration user must be able to enable it. The current schema and latest migration use 2,048-dimensional chunk embeddings.

If extension creation fails due to permissions, enable `vector` with an administrative account in the target database before retrying:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

For subsequent schema changes, edit `src/db/schema.ts`, generate a migration, review its SQL, then apply it:

```sh
npx drizzle-kit generate
npx drizzle-kit migrate
```

`src/db/authUsers.ts` declares a read-only reference to Supabase's `auth.users` table for joins; the physical table is owned by Supabase Auth.

Optional database browser:

```sh
npx drizzle-kit studio
```

## 4. Start Redis

Use an existing Redis service or start a local instance with Docker:

```sh
docker run --name rag-redis -p 6379:6379 -d redis:7-alpine
docker exec rag-redis redis-cli ping
```

The ping should return `PONG`. For later sessions, restart the existing container with `docker start rag-redis`. Set `REDIS_URL` to match your instance.

## 5. Configure Supabase, profiles, and R2

Enable your intended Supabase sign-in method and configure the frontend to authenticate against the same project. Protected API routes expect the signed-in user's access token:

```http
Authorization: Bearer <SUPABASE_ACCESS_TOKEN>
```

The middleware verifies the token with Supabase and attaches the user to the request. A Supabase API key is not a substitute for the user's access token.

`GET /api/profile` returns the caller's profile and creates the `profiles` row on first access, deriving the display name from Supabase user metadata (falling back to the email local part). `PATCH /api/profile` accepts `{ "preferredName": string | null }`; `null` or an empty value resets the name to `Student`.

Create an R2 bucket and configure its credentials in `.env`. For browser uploads, configure bucket CORS to allow your `FRONTEND_URL`, the `PUT` method, and the `Content-Type` header used by the upload. API CORS and bucket CORS are separate settings.

The document upload flow is:

1. Request a URL from `POST /api/documents/presign` with `fileName`, `contentType`, and `size`.
2. Upload the file bytes to the returned `uploadUrl` with an HTTP `PUT`, using the same content type.
3. Call `POST /api/documents/confirm` with the upload metadata, including the returned key as `r2Key`.
4. The backend stores document metadata and submits a BullMQ job, returning HTTP 202 with `{ documentId, status: "queued" }`.
5. Poll `GET /api/documents/:id` for processing status until `ready` or `failed`.

Presigned URLs expire after one hour. The presign handler rejects files larger than 20 MiB. The confirm handler requires the key to be namespaced under the caller's user ID, checks that the object exists in R2, inserts the document metadata, and queues ingestion; `hasMathFormula` is optional and defaults to `false`.

Ingestion downloads the object from R2, then extracts, chunks, embeds, and stores it:

- Extraction supports PDF, DOCX, and plain text. PDFs use `unpdf` with a 200-page limit; PDFs flagged with `hasMathFormula` are parsed by MinerU instead. DOCX text and Office Math markup are read from `word/document.xml`; equations become readable text such as `[[equation: ...]]`.
- Extracted text is capped at 2,000,000 characters, split into roughly 2,000-character chunks with 200-character overlap, and labelled with `--- Page N ---` markers when the source exposes page boundaries.
- Each chunk is embedded with the configured OpenRouter embedding model and stored with a 2,048-dimension vector.

## 6. Run the API and workers

In one terminal:

```sh
npm run dev
```

In a second terminal, start the worker process:

```sh
npm run worker
```

`npm run worker` runs `src/workers/document.worker.ts`, which imports `src/workers/test.worker.ts`. That single process therefore consumes both the `document-processing` and `test-generation` queues, and each worker uses concurrency 2. Start it once per deployment. Starting `tsx watch src/workers/test.worker.ts` separately would add a second consumer, not start a missing queue.

The API listens on `http://localhost:3000`. Port 3000 is currently hardcoded in `src/server.ts`; setting `PORT` does not change it.

Document jobs (`process-document`) and test jobs (`generate-test`) are enqueued with up to three attempts and a one-second exponential backoff. Test jobs use the test ID as the BullMQ job ID. Test jobs move a test through `queued` → `processing` → `ready` or `failed`; the final failure reason is stored in `tests.errorMessage`. If the worker process is not running, tests stay `queued` indefinitely.

`POST /api/tests/generate` accepts `{ title, notebookId, mode, referenceFileId?, referenceUrl? }` with `mode` set to `notebook` or `reference`. The notebook must be owned by the caller and contain at least one ready document, otherwise the endpoint returns `409`. In `reference` mode, `referenceFileId` must identify a ready document in the same notebook; `referenceUrl` is validated as an HTTP(S) URL but is not fetched. The endpoint inserts a queued test, enqueues generation, and returns `202` with the test metadata. Generation uses only the notebook's study chunks as the factual source; a reference document informs format and difficulty only. `GET /api/tests/:id` reports the current status, and `GET /api/tests/:id/content` returns `409` until the test is `ready`. Every generated test has ten questions: six multiple-choice (four distinct options, answer matching an option) and four constructed-response.

Chat sessions are created from one or more ready, owned documents. `POST /api/chat/sessions/:id/messages` verifies session ownership, embeds the question with OpenRouter, retrieves the six most similar chunks from the session's ready documents, and generates a grounded answer with the OpenRouter chat model. The exchange and its cited chunks are stored in one transaction. Missing and unowned sessions both return `404`.

Check that the HTTP server responds:

```sh
curl http://localhost:3000/
```

Expected response:

```json
{ "message": "Server is running" }
```

This verifies the HTTP server only; it does not check database, Redis, storage, or AI connectivity.

Example authenticated request:

```sh
curl http://localhost:3000/api/courses \
  -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>"
```

## API surface

| Group      | Endpoints                                                                                                                                                                                                                                            |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Courses    | `GET/POST /api/courses`, `GET/PATCH/DELETE /api/courses/:id`                                                                                                                                                                                         |
| Notebooks  | `GET/POST /api/notebooks` (optional `?courseId=`), `PATCH/DELETE /api/notebooks/:id`                                                                                                                                                                 |
| Documents  | `POST /api/documents/presign`, `POST /api/documents/confirm`, `GET /api/documents` (optional `?notebookId=`), `GET /api/documents/:id`, `GET /api/documents/:id/file`, `PATCH/DELETE /api/documents/:id`                                             |
| Chat       | `GET/POST /api/chat/sessions`, `GET/PATCH/DELETE /api/chat/sessions/:id`, `POST /api/chat/sessions/:id/messages`                                                                                                                                     |
| Tests      | `POST /api/tests/generate`, `GET /api/tests`, `GET /api/tests/:id`, `GET /api/tests/:id/content`, `DELETE /api/tests/:id`                                                                                                                            |
| Profile    | `GET /api/profile`, `PATCH /api/profile`                                                                                                                                                                                                             |
| Flashcards | Registered but not implemented: `GET/POST /api/flashcards`, `POST /api/flashcards/generate`, `GET /api/flashcards/:setId`, `POST /api/flashcards/:setId/cards`, `PATCH/DELETE /api/flashcards/:setId/cards/:cardId`, `DELETE /api/flashcards/:setId` |

Every route group is mounted behind `protectRoute` at the application level, so all endpoints—including the `/api/chat/health` probe—require a Bearer token. The flashcards handlers are empty placeholders: they never send a response, so flashcard requests hang until the handlers are implemented.

## Tests and validation

```sh
npm run typecheck
npm test
npm run lint
npm run build
```

`npm test` runs the Jest unit suites under `src` and `tests` and excludes the separate API suite and compiled tests in `dist`. Its relative `.js` import mapping resolves TypeScript source files. Unit tests mock Supabase authentication and the database but still need valid environment configuration for other imported modules. `npm run lint` checks `src` and `tests`; `npm run lint-fix` applies autofixes. The ESLint configuration enforces the project's style rules, including 120-column lines, blank lines around control flow, braces, and JSDoc on public APIs.

Independent HTTP acceptance tests live under `tests/`. See [tests/README.md](tests/README.md) for the test server, user-token, and fixture setup, then run `npm run test:api`. This suite includes real uploads and async ingestion polling and imports no backend implementation.

Run the OpenRouter integration script separately:

```sh
npx tsx tests/unit/openRouter.integration.ts
```

This script makes a real API request and requires working OpenRouter credentials and an available model. It is not a Jest unit test.

`npm run commit` runs lint, unit tests, type checking, and a build; it does not create a Git commit.

### Export API contracts

`src/types/studyApi.ts` is the hand-maintained JSON contract shared with the frontend (timestamps are ISO strings). Regenerate the standalone declaration file the frontend consumes with:

```sh
npm run export:contracts
```

This writes `artifacts/study-api.d.ts`. Pass an output path to publish elsewhere: `npm run export:contracts -- ../frontend/src/types/studyApi.d.ts`. The script refuses to export a contract that imports other modules.

## Run compiled services

```sh
npm run build
```

The build emits to `dist/src`. Start the compiled API and worker in separate processes:

```sh
node dist/src/server.js
node dist/src/workers/document.worker.js
```

The document worker imports the compiled test worker, so it consumes both queues. Provide environment variables to each process, or keep `.env` in their working directory. The Compose stack below already uses these compiled paths.

Note: the `npm start` script still points at `dist/server.js`, which predates the current `rootDir` layout. Use `node dist/src/server.js` (or fix the script) until it is updated.

## Docker Compose

From the repository root, `compose.yaml` builds the frontend and backend, starts Redis, and runs the API plus a worker:

```sh
docker compose up --build
```

It reads `backend/.env` and overrides `REDIS_URL` to the Compose Redis service. The worker service runs `document.worker.js`, which also consumes `test-generation` jobs, so async test generation works in Compose without another service.

## Project layout

| Path                               | Contents                                                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| `src/server.ts`                    | Express startup, middleware, and route registration.                                                |
| `src/config/`                      | Validated environment and external service clients.                                                 |
| `src/routes/` / `src/controllers/` | HTTP routes and handlers.                                                                           |
| `src/middleware/protectRoute.ts`   | Supabase access-token verification.                                                                 |
| `src/db/`                          | Drizzle client, schema, inferred database types, and the `auth.users` reference.                    |
| `drizzle/`                         | SQL migrations and migration metadata.                                                              |
| `src/queue/` / `src/workers/`      | BullMQ producers and the document and test workers.                                                 |
| `src/services/`                    | Ingestion, retrieval, answer generation, and test-generation pipelines.                             |
| `src/lib/`                         | Shared errors, provider scheduling, and rate-limit handling.                                        |
| `src/types/`                       | Internal types and the exported API contract.                                                       |
| `scripts/`                         | Tooling such as the contract exporter.                                                              |
| `tests/`                           | Unit and API tests and the standalone OpenRouter integration script.                                |
| `.agents/skills/`                  | Repository-scoped agent skills for backend debugging, feature implementation, and RAG verification. |
| `.github/workflows/basic.yml`      | CI dependency installation, lint, type check, tests, and build with dummy environment values.       |

## Troubleshooting

| Symptom                                                             | What to check                                                                                                                               |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `Invalid environment variables`                                     | Fill every required variable in `.env`, including `GROQ_MODEL`, `EMBEDDING_MODEL`, and `SENTRY_DSN`. Run commands from `backend`.           |
| PostgreSQL connection or migration failure                          | Check the host, credentials, SSL configuration, network access, and pgvector availability.                                                  |
| Redis connection refused                                            | Start Redis and verify `REDIS_URL` from the API and every worker environment.                                                               |
| Documents stay queued                                               | Start `npm run worker` and ensure it uses the same Redis instance as the API.                                                               |
| Tests stay queued                                                   | Start the worker process (`npm run worker`) against the same Redis instance; it consumes `test-generation` too. Check `tests.errorMessage`. |
| `GET /api/tests/:id/content` returns 409                            | The test is still `queued`/`processing`; poll `GET /api/tests/:id` until `ready`.                                                           |
| Math PDF ingestion fails with a MinerU error                        | Install `mineru-kit` or set `MINERU_COMMAND`; not needed for other documents.                                                               |
| Document status becomes `failed`                                    | Read `errorMessage` and the worker logs for extraction, embedding, or provider errors.                                                      |
| Browser API request blocked by CORS                                 | Set `FRONTEND_URL` to the browser's exact origin and restart the API.                                                                       |
| Browser upload to R2 blocked by CORS                                | Configure CORS on the R2 bucket as well as on the API.                                                                                      |
| API returns 401                                                     | Supply a valid Supabase user access token in the Bearer header. Health probes under `/api` need one too.                                    |
| Flashcard request never responds                                    | Expected: `src/controllers/flashcards.controller.ts` contains unimplemented handlers.                                                       |
| `GET /api/documents/health` or `/api/flashcards/health` returns 404 | Their `/:id` routes are registered first and shadow the probes; use `/api/chat/health` instead.                                             |
| `npm start` fails after a clean build                               | The build emits `dist/src/server.js`; run `node dist/src/server.js` (the `start` script still points at `dist/server.js`).                  |
| Port 3000 is already in use                                         | Stop the conflicting service or change the hardcoded port in `src/server.ts`.                                                               |
