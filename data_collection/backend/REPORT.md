# Supabase + R2 + Schema v3 Migration Report

Branch: `feat/supabase-r2-schema-v3` (from `main`, commit `7be1840`)
Scope: `data_collection/backend` only. Frontend untouched.

---

## ⚠️ Blockers found at step 0 (read this first)

The brief stated the Supabase and Railway CLIs were already linked and that all
secrets were in `.env`. None of that held. Verified:

| Check | Command | Result |
|---|---|---|
| Supabase CLI linked | `supabase projects list` | **Not linked** — "Cannot find project ref. Have you run supabase link?" |
| Dedicated Supabase project | `supabase projects list` | **Does not exist.** Org has: login_system, login_system_STEAP, divvy, freelance-agent, Neuroplica, Aami, steap-staging, steap-sandbox. No dynalytix/climbing project. |
| Backend's `SUPABASE_URL` target | ref matched against project list | Points at the **`login_system`** project — a shared auth project (created 2026-03-16), not a project dedicated to this app. |
| Railway CLI linked | `railway status` | **Not linked** — "No linked project found. Run railway link to connect to a project." |
| `wrangler` installed | `which wrangler` | **Not installed.** |
| `DATABASE_URL` | `.env` | **Absent.** |
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
