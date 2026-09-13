# Supabase + R2 + Schema v3 Migration Report

Branch: `feat/supabase-r2-schema-v3` (from `main`, commit `7be1840`)
Scope: `data_collection/backend` only. Frontend untouched.

---

## ✅ Update — Supabase project created, schema live, verified against it

After the initial pass, a dedicated Supabase project was created and linked, which
cleared the largest blocker. What changed:

- **Project created:** `dynalytix-climbing`, ref `nbqtgknayvsjkevaoeef`, org
  **Dynalytix** (`huwgfrlivqxluwsjkxln`), region East US (North Virginia).
  Dashboard: https://supabase.com/dashboard/project/nbqtgknayvsjkevaoeef
- **CLI linked** to that project. The shared `login_system` project is no longer
  referenced anywhere.
- **Migration applied for real** with `supabase db push`. Verified over psql
  against the live database: 7 tables, RLS enabled on all 7, 4 policies on each
  data table, `schema_version = 3`.
- **`.env` rewritten** for the new project: `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, and a working `DATABASE_URL`. R2 variables are
  present but still empty. A backup of the previous `.env` is in the session
  scratchpad. No secret value appears in this report or in any commit.
- **Test suite run against the live Supabase database: 61 passed.**
- **Smoke test run with real ES256 access tokens** for two throwaway users
  created through the auth admin API, against the live database: **35 passed, 0
  failed.** R2 was still stubbed locally, as no R2 credentials exist yet.
- **`.gitignore` fixed:** `.env` was not ignored and now is, along with
  `supabase/.temp/` (which holds the pooler URL with credentials).

### Three real bugs this surfaced

Running against actual infrastructure rather than a local stand-in caught three
defects that would each have broken the Railway deployment:

1. **ES256 vs HS256.** Supabase projects created from 2025 on sign user tokens
   with an asymmetric ES256 key published via JWKS, not the legacy HS256 shared
   secret. `auth.py` verified HS256 only, so it would have rejected every real
   token from this new project with a 401. It now reads the token's `alg` header
   and verifies ES256/RS256 against the project's cached JWKS, falling back to
   HS256 for legacy projects. `SUPABASE_JWT_SECRET` is now optional.
2. **Prepared statements vs the transaction pooler.** psycopg3 prepares
   statements automatically; Supabase's pooler (pgbouncer, port 6543) multiplexes
   connections per transaction, so this raised `DuplicatePreparedStatement`
   intermittently — 5 test failures. `Database._configure_connection` now sets
   `prepare_threshold = None` on every pooled connection.
3. **Missing crypto extra.** `PyJWT` cannot do ES256 without the `cryptography`
   package; every authenticated request 500'd with
   `MissingCryptographyError`. `requirements.txt` now pins `PyJWT[crypto]`.

Also worth knowing: the **direct** database host (`db.<ref>.supabase.co:5432`) is
IPv6-only and unreachable from this machine. `DATABASE_URL` uses the transaction
pooler at `aws-0-us-east-1.pooler.supabase.com:6543`. Use the pooler on Railway too.

### Still outstanding

Only R2 and Railway now:

- No R2 account/bucket/credentials — `src/storage/r2.py` is untested against the
  real service, and the CORS rule in §6 is unapplied.
- Railway still has no linked project, so no variables are set and nothing is
  deployed.

Two throwaway auth users (`smoke-test-a@dynalytix.test`,
`smoke-test-b@dynalytix.test`) now exist in the project so the smoke test can be
re-run; delete them from Authentication → Users if you would rather not keep them.
The labeling tables were truncated afterwards, so the database is empty.

---

## ⛔ Second update — R2 and Railway are still not available

A follow-up pass was requested on the premise that R2 credentials were in
`.env` and Railway was linked. Neither holds:

| Check | Command | Result |
|---|---|---|
| R2 credentials | read `.env` | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` are all present as keys but set to **empty strings**. The file has not been modified since it was written. |
| Railway linked | `railway status` | **"No linked project found."** The CLI's stored link state covers only `/Users/jolie/Downloads/Steap`, `.../Steap-semester` and a Steap scratchpad — nothing under Dynalytics. |
| `wrangler` | `which wrangler` | **Still not installed.** |

No other file on disk holds R2 credentials (searched every `.env*` in the repo).
So testing R2 against a real bucket, applying the bucket CORS rule, setting
Railway variables, deploying, and smoke-testing a deployed URL all remain
impossible.

**What was done instead**, so that none of it needs figuring out later:

- `src/storage/r2.py` gained `delete_object()`, `put_bucket_cors()` and
  `get_bucket_cors()`. R2 implements the S3 CORS API, so wrangler is not needed
  at all.
- `scripts/verify_r2.py` implements both R2 steps as one command. It covers
  `put_object`, `object_exists` (hit and miss), `get_object_stream` (byte
  comparison, plus `FileNotFoundError` on a missing key), a real
  credential-free HTTP PUT to a presigned URL, a presigned GET, then
  `PutBucketCors` from `r2-cors.json` and `GetBucketCors` read-back asserting
  PUT, GET and `http://localhost:5173` are permitted. It cleans up after itself
  and never prints a credential.
- `r2-cors.json` allows `GET`, `PUT`, `HEAD`. `AllowedOrigins` is `["*"]`
  because that is literally what `api.py`'s CORS config is
  (`allow_origins=["*"]`) — which already subsumes `http://localhost:5173`.
  Narrow both together once the deployed frontend origin is known.

The 61-test suite still passes against the live Supabase database after these
changes.

---

## ⚠️ Blockers found at step 0 (read this first)

The brief stated the Supabase and Railway CLIs were already linked and that all
secrets were in `.env`. None of that held. Verified:

| Check | Command | Result |
|---|---|---|
| Supabase CLI linked | `supabase projects list` | **Not linked** — "Cannot find project ref." *(Resolved — see the update above.)* |
| Dedicated Supabase project | `supabase projects list` | **Did not exist.** *(Resolved — `dynalytix-climbing` created.)* Org has: login_system, login_system_STEAP, divvy, freelance-agent, Neuroplica, Aami, steap-staging, steap-sandbox. No dynalytix/climbing project. |
| Backend's `SUPABASE_URL` target | ref matched against project list | Points at the **`login_system`** project — a shared auth project (created 2026-03-16), not a project dedicated to this app. |
| Railway CLI linked | `railway status` | **Not linked** — "No linked project found. Run railway link to connect to a project." |
| `wrangler` installed | `which wrangler` | **Not installed.** |
| `DATABASE_URL` | `.env` | **Was absent.** *(Resolved — now set to the transaction pooler.)* |
| R2 credentials (`R2_ACCOUNT_ID`, access key, secret, bucket) | `.env` | **All absent.** |
| `GITHUB_TOKEN` / `DATA_REPO` | `.env` | Absent locally (they are read from the environment at runtime, so they exist only as Railway service variables). |

`.env` contains exactly four keys: `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`. (No values are reproduced
anywhere in this report.)

**Consequence:** every step that writes code was completed. Every step that
requires live infrastructure could not be executed and is documented instead.
See "What could not be verified" at the end.

**Safety hold:** step 3 asks to drop the old labeling tables and apply the
migration with `supabase db push`. The only Supabase project this repo is
configured against is `login_system`, which by its name and age serves other
applications. Running a DROP-and-recreate migration there could destroy another
app's data, so the migration file was written but **deliberately not applied**.
This is the one instruction I did not carry out autonomously.

---

## 1. Current data flow (before this change)

### Storage layout on Railway's ephemeral disk

```
backend/
  data/labels.db            <- SQLite, ALL labels
  data/<video_stem>.csv     <- raw pose CSV, one per video
  data/exports/*_labeled.csv<- joined export output
  videos/<safe_filename>    <- original video file (server-upload path only)
```

Every one of these lives on the container filesystem and is lost on redeploy.
The GitHub sync in `data_sync.py` is the only thing that survives a restart, and
it only covers export CSVs.

### `src/labeling/models.py`
Pure dataclasses, no DB dependency: `Video`, `Move`, `Environment`, `Outcome`,
`FrameTag`, plus taxonomy constants (`APPROACHES`, `SIZES`, `MOVE_TAGS`,
`TIMINGS`, `DYNO_STYLES`, `WALL_ANGLES`, `HOLD_TYPES`, `HOLD_QUALITIES`,
`RESULTS`, `REACH_DETAILS`, `CONFIDENCE_LEVELS`, `TAG_TYPES`, `SIDES`,
`TRACTION_SOURCES`, `BODY_PARTS`). No `user_id` anywhere — the system is
single-tenant. No `Hold` model; holds do not exist yet.

### `src/labeling/database.py`
`Database` class over `sqlite3`, `SCHEMA_VERSION = 3`, file at `data/labels.db`.
- `get_connection()` — contextmanager, `sqlite3.Row` factory, commit/rollback/close.
- `init()` — creates `schema_version`, compares `MAX(version)`, calls `_apply_schema` when behind.
- `_apply_schema()` — `CREATE TABLE IF NOT EXISTS videos`, then **drops and recreates**
  `frame_tags`, `outcomes`, `environments`, `moves`, then four indexes.
- CRUD per entity. Lists/dicts are persisted as `json.dumps` into `TEXT`
  columns (`move_tags`, `contextual_data`, `tags`, `hold_quality`, `locations`)
  and revived with `json.loads` in the `_row_to_*` helpers.
- Datetimes stored as ISO `TEXT`, parsed back with `datetime.fromisoformat`.
- `foot_cut` stored as `INTEGER` 0/1.
- Placeholders are `?`; ids come from `cursor.lastrowid`.

### `src/labeling/exporter.py`
`Exporter.export_video(video_id, delete_video=False)`:
1. `db.get_video` → `db.get_moves_for_video`.
2. Per move, fetch environment, outcome, frame tags; expand into a
   `frame -> labels` dict covering `frame_start..frame_end` inclusive.
3. Read `video.csv_path` from local disk with `csv.DictReader`.
4. Append 23 label columns to the raw pose header, pipe-joining multi-valued
   frame-tag fields.
5. Write to `data/exports/<raw_stem>_labeled.csv`.
6. If `delete_video`, `unlink()` the original video file.

### `src/labeling/data_sync.py`
`push_csv_to_github(csv_path, repo=None, branch="main", folder="collected_data/climbing")`.
Reads `GITHUB_TOKEN` and `DATA_REPO` from the environment, base64-encodes the
file and PUTs it to the GitHub contents API at
`collected_data/climbing/<timestamp>_<name>.csv`. Silently no-ops when the env
vars are missing. Called only from the export endpoint, wrapped in a
try/except so failures are non-blocking.

### `src/web/api.py`
FastAPI app, version 2.0.0. **`allow_origins=["*"]`, `allow_credentials=False`**
— there is no specific frontend origin configured anywhere. Module-level
singletons: `db = Database('data/labels.db')`, `db.init()`, `exporter = Exporter(db)`.
Mounts `videos/` as static files. **No authentication of any kind** — every
endpoint is open and unscoped.

Endpoints:
- `GET /` — health-ish, returns `{"status":"ok", ...}`. There is no `/api/health`.
- `GET /api/config` — returns the whole taxonomy from the `models.py` constants.
- `POST /api/videos/upload` — multipart video; saves to `videos/`, shells out to
  `main.py` for pose extraction via `subprocess`, writes CSV to `data/`.
- `POST /api/videos/register` — form fields `filename, fps, total_frames,
  duration_ms, csv_data`; client-side pose path. Writes `csv_data` to local disk.
- `GET /api/videos`, `GET /api/videos/{id}`, `GET /api/videos/{id}/csv`.
- `POST /api/videos/{id}/export?delete_video=bool` — runs the exporter, then
  fires the GitHub sync. Returns `{path, video_deleted}`.
- `GET /api/videos/{id}/export/download` — `FileResponse` off local disk.
- Moves: `POST /api/moves`, `GET /api/videos/{id}/moves`, `GET /api/moves/{id}`,
  `PUT /api/moves/{id}`, `DELETE /api/moves/{id}`.
- Environments: `POST /api/environments`, `GET /api/moves/{id}/environment`,
  `PUT /api/environments/{id}`.
- Outcomes: `POST /api/outcomes`, `GET /api/moves/{id}/outcome`, `PUT /api/outcomes/{id}`.
- Frame tags: `POST /api/frame-tags`, `GET /api/moves/{id}/frame-tags`,
  `DELETE /api/frame-tags/{id}`.

Validation is hand-rolled: each handler checks values against the `models.py`
constants and raises `HTTPException` 400/404/409.

### Flow summary

```
browser --(pose CSV as form field)--> /api/videos/register --> data/*.csv  (ephemeral)
browser --(labels)-----------------> /api/moves|environments|outcomes|frame-tags --> labels.db (ephemeral)
browser --(export)-----------------> /api/videos/{id}/export --> data/exports/*.csv (ephemeral)
                                                              \-> GitHub contents API (only durable copy)
```

---

## 2. Per-file changes

| File | Change |
|---|---|
| `src/labeling/models.py` | Rewritten. `user_id` on every entity. New `Hold` dataclass (normalized bbox + `source`). `Environment` replaced by four optional slots (`start_left`, `start_right`, `end`, `foot`), each with `_hold_id`, `_hold_type`, `_hold_quality`. `Move` drops `timing`, `dyno_style`, `contextual_data`, `tags`; gains `confidence`. `Outcome` drops `foot_cut`. `FrameTag` drops `traction_source`, `traction_direction`. `MOVE_TAGS` gains `technical`, `tension`. `TIMINGS`, `DYNO_STYLES`, `TRACTION_SOURCES` removed. New `HOLD_SLOTS`, `HOLD_SOURCES`. |
| `src/labeling/database.py` | Rewritten for psycopg v3. `ConnectionPool(min_size=1, max_size=5)` over `DATABASE_URL`, `dict_row` factory. `?` → `%s`, `cursor.lastrowid` → `RETURNING id`, `json.dumps`/`json.loads` into TEXT → `Jsonb` into `jsonb`, ISO-string datetimes → native `timestamptz`. `init()`/`_apply_schema()` replaced by `check_schema()` (verifies version, raises `SchemaNotApplied`) and `apply_schema_sql()` (runs the migration file, for tests). Every read/update/delete takes `user_id` and filters on it. New: `set_video_r2_keys()`, `get_videos_with_exports()`, hold CRUD. |
| `src/labeling/exporter.py` | Rewritten. `export_video(video_id, user_id)` streams the pose CSV from R2, joins labels, writes the result back to R2 and records `r2_export_key`. `delete_video` removed. Emits per-slot hold columns including a denormalized `{slot}_hold_bbox` so the export stands alone as a dataset. |
| `src/labeling/data_sync.py` | **Deleted.** GitHub sync retired. |
| `src/labeling/__init__.py` | Exports updated for the new models and constants. |
| `src/storage/r2.py` | **New.** boto3 against `https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com` (region `auto`, SigV4). `put_object`, `get_object_stream`, `object_exists`, `presigned_put_url`, `presigned_get_url`, plus `video_key`/`pose_csv_key`/`export_key`. Client built lazily and cached so the module imports without credentials. `R2_ENDPOINT_URL` overrides the endpoint for local MinIO/stub work. |
| `src/storage/__init__.py` | **New.** Re-exports the R2 surface. |
| `src/web/auth.py` | **New.** `get_current_user_id` FastAPI dependency: verifies the bearer token against `SUPABASE_JWT_SECRET` (HS256, `aud=authenticated`, requires `exp` and `sub`) and returns `sub`. Distinct 401s for missing / expired / invalid; 500 when the secret is unset. |
| `src/web/api.py` | Rewritten, version 3.0.0. See §7 for the endpoint-by-endpoint contract. Removed `POST /api/videos/upload`, the `/videos` static mount, `process_video()` and the `subprocess` call into `main.py` — all of which used the ephemeral disk. Added health, exports listing and hold endpoints. Lazy `get_db()`/`get_exporter()`; lifespan handler closes the pool only when this module opened it. |
| `supabase/migrations/<ts>_schema_v3.sql` | **New.** Full v3 DDL + RLS. |
| `tests/conftest.py`, `tests/test_database_v3.py`, `tests/test_api_scoping.py` | **New.** 61 tests. |
| `scripts/smoke_test.py` | **New.** End-to-end check against a base URL. |
| `test_backend.py` | **Deleted.** Imported `TRACTION_SOURCES` and the SQLite `Database` signature; both gone. Superseded by `tests/`. |
| `requirements.txt` | Added `psycopg[binary]`, `psycopg-pool`, `boto3`, `PyJWT`. |
| `README.md` (backend) | Rewritten for v3. The previous version was stale well before this change — it still documented `move_type`, `contextual_data` and SQLite. |
| `../../README.md` (root) | Data-pipeline section now describes Supabase + R2; `GITHUB_TOKEN`/`DATA_REPO` and the SQLite tree removed. |
| `.env.example` | **New.** |

---

## 3. Every default taken

Decisions made without asking, per the brief's instruction to use defaults and continue:

1. **`Database` interface is not byte-for-byte identical.** Step 2 asked to keep it identical; step 6 required every query to filter by `user_id`. Those conflict. Method names, return types and call style are unchanged, but reads/updates/deletes take an extra `user_id` argument. This is the minimum change that satisfies step 6.
2. **`init()` → `check_schema()`.** The app no longer creates tables; the migration is the single source of truth. `apply_schema_sql()` exists so tests can build a fresh schema without the Supabase CLI.
3. **"Remove `timing`" read as the `timings` config key.** `MOVE_TAGS` never contained a `timing` entry — `timing` was a separate `Move` column with its own `TIMINGS` list. Since the v3 `moves` table specified in step 3 has no `timing` column, the `timing` field, the `TIMINGS` constant and the `timings` key in `/api/config` were all removed. `technical` and `tension` were added to `MOVE_TAGS` as asked.
4. **`dyno_style`, `contextual_data`, `tags` (on moves), `foot_cut`, `traction_source`, `traction_direction` dropped.** None appear in the step 3 column lists. They are gone from the models, the API and the export.
5. **`confidence` exists on both `moves` and `outcomes`.** The step 3 spec lists it on both. Implemented as specified; exported as `move_confidence` and `outcome_confidence` to keep the two distinguishable. Flagging in case only one was intended.
6. **`r2_video_key` is nullable.** Only `r2_export_key` was marked nullable in the brief, but the direct-upload flow means no video key exists at register time. `r2_pose_csv_key` is likewise nullable for the window between the row insert and the R2 put.
7. **Hold endpoints added.** `environments` references `holds`, but no endpoint existed to create one, which would have made the slots unusable. Added `POST /api/holds`, `GET /api/videos/{id}/holds`, `DELETE /api/holds/{id}`.
8. **`POST /api/videos/upload` removed.** It saved the video to local disk and shelled out to `main.py` for pose extraction — exactly the ephemeral-disk dependency this work removes. The client-side path (`register` + presigned upload) replaces it. **This is a breaking removal; see §7.**
9. **`/api/health` and `/` are unauthenticated.** Step 6 says every endpoint requires a JWT, but a health check Railway cannot call is useless. Only these two are open, and neither touches user data. `/api/config` does require a token, as instructed.
10. **404, not 403, for another user's resource.** Prevents id enumeration.
11. **60MB limit enforced twice** — in middleware on `Content-Length` (before the body is buffered) and again on the decoded CSV, since `Content-Length` is client-supplied.
12. **`register` takes JSON, not multipart form.** The old endpoint used `Form(...)` fields. The body is now a single JSON document. **Breaking; see §7.**
13. **Foreign keys use `ON DELETE CASCADE`** (from `videos`/`moves`) and `ON DELETE SET NULL` (hold references from `environments`), so deleting a hold blanks the slot rather than failing.
14. **R2 CORS origin is `*`.** Step 4 said to use the frontend origins "found in the existing CORS config in api.py" — that config is `allow_origins=["*"]`. No specific origin exists anywhere in the repo. See §6 for the JSON and a recommendation to narrow it.
15. **Tests ran against a local Postgres 16.** No `DATABASE_URL` exists, so "the real DATABASE_URL" was unavailable. The same migration file was applied to a local scratch database with `auth.uid()`/`auth.role()` stubbed.
16. **The smoke test ran against a local instance of the real app**, not the deployment, for the same reason. See §5.
17. **Root `README.md` was edited** despite "work only in `data_collection/backend`", because step 5 explicitly said to remove `GITHUB_TOKEN`/`DATA_REPO` from docs and those references lived there. The frontend was not touched.

---

## 4. Test output

`pytest tests/ -q`, against Postgres 16 with `TEST_DATABASE_URL` pointed at a local scratch database:

```
.............................................................            [100%]
61 passed in 1.76s
```

- `tests/test_database_v3.py` — 33 tests: schema version, table presence, RLS enabled everywhere, four policies per data table, identity keys, jsonb round-trips (verified with a `@>` containment query, so a JSON-string-in-text column would fail), bbox and `source` CHECK constraints, all four hold slots, the optional foot slot, one-environment-per-move uniqueness, cascade on move delete, and user scoping on every read/update/delete.
- `tests/test_api_scoping.py` — 28 tests: unauthenticated health, 401 on missing/garbage/wrong-secret/expired tokens, register writing the pose CSV to R2, 413 on oversized bodies, presigned upload-url and confirm-upload (including refusal of a foreign key prefix), export contents, the 307 redirect, `/api/exports/mine`, and a second user getting 404 on every resource.

**One real bug was found by the suite and fixed:** the app's shutdown hook closed whatever `Database` was on the module global, including one injected by a caller. It now tracks whether it opened the pool itself (`_db_owned`).

---

## 5. Smoke test output

Could not be run against the deployment — Railway has no linked project (§1). Run instead against the real application started locally (`uvicorn src.web.api:app`) on Postgres 16 with a local S3 stub standing in for R2 via `R2_ENDPOINT_URL`. Tokens minted from a local `SUPABASE_JWT_SECRET` for two fixed throwaway uuids.

```
Smoke test against http://127.0.0.1:8099

health
  PASS  GET /api/health is 200
  PASS  database reachable
  PASS  schema version is 3
  PASS  R2 configured

config
  PASS  GET /api/config is 200
  PASS  move_tags contains 'technical'
  PASS  move_tags contains 'tension'
  PASS  'timings' key is gone
  PASS  GET /api/config without a token is 401

register
  PASS  POST /api/videos/register is 201
  PASS  pose CSV key recorded
  PASS  fps round-tripped
  PASS  total_frames round-tripped

labels
  PASS  POST /api/holds is 201
  PASS  POST /api/moves is 201
  PASS  POST /api/environments is 201
  PASS  foot slot left empty
  PASS  POST /api/outcomes is 201
  PASS  POST /api/frame-tags is 201

export
  PASS  POST export is 200
  PASS  export key returned
  PASS  GET /api/exports/mine is 200
  PASS  export appears in /api/exports/mine
  PASS  export download redirects (307)
  PASS  presigned URL returned
  PASS  export object fetched from R2
  PASS  export header carries raw pose columns
  PASS  export header carries label columns
  PASS  labels joined onto frames

isolation (second user)
  PASS  other user GET video is 404
  PASS  other user GET moves is 404
  PASS  other user GET move is 404
  PASS  other user export is 404
  PASS  other user download is 404
  PASS  other user's export list excludes it

35 passed, 0 failed
```

The export object produced, fetched back out of storage:

```
frame_number,timestamp_ms,left_elbow_angle,right_elbow_angle,move_id,approach,size,move_tags,
form_quality,effort_level,move_confidence,wall_angle,start_left_hold_id,start_left_hold_type,
start_left_hold_quality,start_left_hold_bbox,...,foot_hold_bbox,result,reach_detail,
outcome_confidence,tag_types,tag_levels,tag_locations,tag_sides,tag_notes

2,66,140.1,139.9,2,dynamic,large,dyno|tension,4,8,high,steep,1,jug,incut,"0.42,0.33,0.06,0.05",
,,,,1,jug,incut,"0.42,0.33,0.06,0.05",,,,,success,reached_controlled,high,sharp_pain,6,
left_shoulder,left,smoke test tag
```

---

## 6. R2 bucket and CORS — for you to apply

`wrangler` is not installed and no R2 credentials exist, so neither the bucket nor the CORS rule could be created. Two options:

**With wrangler:**
```bash
npm install -g wrangler
wrangler login
wrangler r2 bucket create <bucket-name>
wrangler r2 bucket cors put <bucket-name> --file r2-cors.json
```

**Or paste this in the Cloudflare dashboard** (R2 → your bucket → Settings → CORS Policy). This is `r2-cors.json`:

```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["Content-Type", "Content-Length"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

`AllowedOrigins` is `*` because that is what `api.py`'s CORS config says and no
specific frontend origin appears anywhere in the repo. **Narrow it** to the
deployed frontend origin once you know it, e.g.:

```json
"AllowedOrigins": ["https://your-frontend.vercel.app", "http://localhost:5173"]
```

The browser PUTs with a `Content-Type` header that must match the one passed to
`/api/videos/{id}/upload-url`, or the presigned signature will not validate.

---

## 7. Frontend API contract changes (for Terminal C)

**Every** `/api` request except `/api/health` now needs:

```
Authorization: Bearer <supabase access token>
```

Get it from the existing Supabase client: `(await supabase.auth.getSession()).data.session.access_token`. Without it: `401`.

### `POST /api/videos/register` — changed shape

*Old* — multipart form:
```
FormData: filename, fps, total_frames, duration_ms, csv_data
→ 201 { id, filename, path, csv_path, fps, total_frames, duration_ms, uploaded_at }
```

*New* — JSON body:
```jsonc
POST /api/videos/register
{ "filename": "climb.mp4", "fps": 30.0, "total_frames": 900,
  "duration_ms": 30000.0, "csv_data": "<pose csv text>" }

→ 201 { "id": 1, "filename": "climb.mp4", "fps": 30.0, "total_frames": 900,
        "duration_ms": 30000.0, "r2_video_key": null,
        "r2_pose_csv_key": "pose/<user_id>/1.csv", "r2_export_key": null,
        "uploaded_at": "..." }
→ 413 if the body exceeds 60MB
```
`path` and `csv_path` are **gone**; `r2_*` keys replace them.

### `POST /api/videos/upload` — **removed**

The server no longer accepts video files or runs pose extraction. Use the
three-step flow below.

### Direct video upload — new

```jsonc
POST /api/videos/{id}/upload-url
{ "content_type": "video/mp4" }
→ 200 { "url": "<presigned PUT>", "key": "videos/<user_id>/<id>/climb.mp4",
        "expires_in": 3600 }

// then, from the browser, straight to R2:
PUT <url>   with header Content-Type: video/mp4   body = the file

POST /api/videos/{id}/confirm-upload
{ "key": "videos/<user_id>/<id>/climb.mp4" }   // or {} to use the default
→ 200 <video object>
→ 400 if the key is outside your own videos/{user_id}/ prefix
```

### `POST /api/videos/{id}/export` — changed

*Old:* `?delete_video=true` supported → `{ "path": "data/exports/...csv", "video_deleted": false }`
*New:* no query params → `{ "video_id": 1, "r2_export_key": "exports/<user_id>/1_labeled.csv" }`

### `GET /api/videos/{id}/export/download` — changed

*Old:* streamed the file body.
*New:* `307` redirect to a presigned R2 URL. Let the browser follow it (`fetch` follows by default; for a save-as, use `window.location = url` or an `<a>`).

### `GET /api/videos/{id}/csv` — changed

Same change: now a `307` to a presigned URL rather than a streamed body.

### `GET /api/exports/mine` — new

```jsonc
→ 200 [ { "video_id": 1, "filename": "climb.mp4",
          "r2_export_key": "exports/<user_id>/1_labeled.csv",
          "uploaded_at": "..." } ]
```

### Holds — new

```jsonc
POST /api/holds
{ "video_id": 1, "bbox_x": 0.42, "bbox_y": 0.33, "bbox_w": 0.06, "bbox_h": 0.05,
  "source": "manual" }          // "manual" | "detected"; bbox normalized 0-1
→ 201 { "id": 1, "video_id": 1, "bbox_x": 0.42, ..., "created_at": "..." }

GET    /api/videos/{id}/holds → 200 [ ... ]
DELETE /api/holds/{id}        → 204
```

### `POST /api/moves` / `PUT /api/moves/{id}` — changed fields

Removed from both request and response: `timing`, `dyno_style`, `contextual_data`, `tags`.
Added: `confidence` (`"low" | "med" | "high" | null`).
`move_tags` now accepts `technical` and `tension`.

```jsonc
{ "video_id": 1, "frame_start": 150, "frame_end": 200,
  "timestamp_start_ms": 5000.0, "timestamp_end_ms": 6666.7,
  "approach": "dynamic", "size": "large",
  "move_tags": ["dyno", "tension"],
  "form_quality": 4, "effort_level": 7,
  "confidence": "high", "description": "..." }
```

### `POST /api/environments` / `PUT /api/environments/{id}` — restructured

*Old:*
```jsonc
{ "move_id": 1, "wall_angle": "steep",
  "hold_type_reaching": "jug", "hold_type_non_reaching": "pinch",
  "hold_quality": ["incut"] }
```

*New* — four named slots, each fully optional:
```jsonc
{ "move_id": 1, "wall_angle": "steep",
  "start_left":  { "hold_id": 1, "hold_type": "jug",   "hold_quality": ["incut"] },
  "start_right": { "hold_id": 2, "hold_type": "pinch", "hold_quality": ["small"] },
  "end":         { "hold_id": 3, "hold_type": "jug",   "hold_quality": [] },
  "foot":        { "hold_id": 4, "hold_type": "jug",   "hold_quality": [] }
}
```
Omit a slot entirely, or send `{}`, to leave it empty — that is how no-hands,
one-hand and no-feet moves are expressed. `hold_id` must reference a hold you
own or the request 404s. The response echoes the same four-slot shape.

### `POST /api/outcomes` / `PUT /api/outcomes/{id}` — changed

`foot_cut` is **removed** from request and response. `confidence` is now nullable.

### `POST /api/frame-tags` — changed

`traction_source` and `traction_direction` are **removed** from request and response.

### `GET /api/config` — changed

Removed keys: `timings`, `dyno_styles`, `traction_sources`.
Added keys: `hold_slots` (`["start_left","start_right","end","foot"]`), `hold_sources` (`["detected","manual"]`).
`move_tags` gains `technical` and `tension`.
**Now requires a token.**

### New status codes to handle

`401` (no/expired token — refresh the session), `413` (pose CSV over 60MB),
`503` (object storage unavailable), `307` (follow the redirect).

---

## 8. What could not be verified, and why

| Step | Status | Why |
|---|---|---|
| 3 — `supabase db push` | **DONE** | Applied to the new dedicated project `dynalytix-climbing`. |
| 3 — verify tables via psql against `DATABASE_URL` | **DONE** | Against the live database: 7 tables, RLS on all, 4 policies each, `schema_version = 3`. |
| 4 — R2 bucket + CORS | **Still blocked** | The four `R2_*` keys in `.env` are empty strings. Implemented as `scripts/verify_r2.py` (S3 `PutBucketCors`, no wrangler needed) — one command once credentials exist. |
| 5 — `railway variables --unset GITHUB_TOKEN DATA_REPO` | **Not done** | No linked Railway project. Code and docs references removed; the service variables remain set until you unset them. |
| 7 — tests against the real `DATABASE_URL` | **DONE** | 61 passed against the live Supabase database. |
| 7 — R2 tests against the real bucket | **Substituted** | No credentials. In-memory fake used; the fixture automatically prefers the real bucket when credentials work. |
| 8 — `railway variables --set`, `railway up`, health check | **Still blocked** | `railway status`: "No linked project found". `DATABASE_URL` is now available, but the R2 values are not, and the project to link is still unknown. Deploying a breaking API change to a guessed project was not a safe autonomous call. |
| 9 — smoke test against the deployed URL | **Partly done** | No deployment URL yet. Ran against the real app locally, using real ES256 tokens and the live Supabase database: 35 passed, 0 failed. R2 stubbed. |

Nothing about the application code is unverified — every module is exercised by
the 61-test suite and the 35-check smoke run. What is unverified is the
*infrastructure wiring*: real Supabase, real R2, real Railway.

---

## 9. What you need to do manually

In order:

~~1. Decide the Supabase project.~~ **Done** — `dynalytix-climbing` created, linked, migration applied and verified.

~~2. Add `DATABASE_URL` to `.env`.~~ **Done** — points at the transaction pooler.

3. **R2 — still blocked, nothing supplied yet.** The four `R2_*` keys exist in
   `.env` but are all **empty strings**. Create a Cloudflare R2 bucket and an
   API token (R2 → Manage R2 API Tokens → Object Read & Write), fill the four
   values in, then run:
   ```bash
   cd data_collection/backend
   set -a && . ./.env && set +a
   python scripts/verify_r2.py
   ```
   That one command does both of the R2 steps: it exercises `put_object`,
   `object_exists`, `get_object_stream`, a real credential-free HTTP PUT to a
   presigned URL and a presigned GET, then applies `r2-cors.json` with
   `PutBucketCors` and reads it back with `GetBucketCors`, asserting PUT, GET
   and `http://localhost:5173` are permitted. It cleans up after itself. It
   uses the S3 API rather than wrangler, which is still not installed.
4. ~~Run the suite for real.~~ **Done** — 61 passed against the live database.
   Note for future runs: the suite re-applies the migration, which **drops and
   recreates** the labeling tables. That was safe on an empty project. Once real
   labels exist, point `TEST_DATABASE_URL` at a separate throwaway database.
5. **Railway — still blocked, not linked.** `railway status` reports "No linked
   project found"; the CLI's link state on this machine covers only three
   *Steap* directories. You are authenticated, and seven projects are visible,
   but their names are auto-generated and none identifies this backend. Picking
   one and deploying a breaking API change to it was not a safe guess to make
   unattended, so link it yourself first:
   ```bash
   cd data_collection/backend
   railway link                       # pick the project hosting this backend
   railway status                     # confirm
   railway variables --set DATABASE_URL="..." \
                     --set SUPABASE_URL="..." \
                     --set SUPABASE_ANON_KEY="..." \
                     --set SUPABASE_SERVICE_ROLE_KEY="..." \
                     --set R2_ACCOUNT_ID="..." \
                     --set R2_ACCESS_KEY_ID="..." \
                     --set R2_SECRET_ACCESS_KEY="..." \
                     --set R2_BUCKET="..."
   railway variables --unset GITHUB_TOKEN
   railway variables --unset DATA_REPO
   railway up
   ```
   Note `SUPABASE_JWT_SECRET` is deliberately absent — this project signs with
   ES256 and the key is discovered from `SUPABASE_URL`. Use the **transaction
   pooler** `DATABASE_URL` (port 6543); the direct host is IPv6-only.
6. **Verify the deployment:**
   ```bash
   curl https://<service>.up.railway.app/api/health
   # expect {"status":"ok","database":"ok","r2":"ok","schema_version":3}
   python scripts/smoke_test.py --url https://<service>.up.railway.app
   ```
7. **Hand §7 to Terminal C** for the frontend. The frontend on `main` will not work against this API until it is updated — auth headers, the register body shape, the new environment slot structure and the removal of `POST /api/videos/upload` are all breaking.
8. **Clean up the retired data** once you are satisfied: `data/labels.db`, `data/*.csv`, `data/exports/`, `videos/` are all dead weight now, as is the `dynalytix-data` GitHub repo.

One local side effect to note: `postgresql@16` was started on this machine
(`brew services start postgresql@16`) to validate the migration, and a scratch
database `dynalytix_v3_check` was created. Remove them with
`dropdb dynalytix_v3_check && brew services stop postgresql@16` if you do not
want them running.
