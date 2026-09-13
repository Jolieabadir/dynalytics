# Dynalytix - Backend API

FastAPI backend for the climbing data collection UI.

Labels live in **Supabase Postgres**. Videos, raw pose CSVs and labeled exports
live in **Cloudflare R2**. Nothing persistent is written to the container
filesystem, which Railway wipes on every deploy.

## Architecture

```
src/
├── labeling/           # Data layer (pure Python)
│   ├── models.py       # Dataclasses (Video, Hold, Move, Environment, Outcome, FrameTag)
│   ├── database.py     # Postgres operations via psycopg v3 (raw SQL, no ORM)
│   ├── exporter.py     # Joins pose CSV from R2 with labels, writes back to R2
│   └── __init__.py
├── storage/            # Object storage
│   ├── r2.py           # boto3 client for Cloudflare R2
│   └── __init__.py
└── web/                # API layer
    ├── api.py          # FastAPI routes
    ├── auth.py         # Supabase JWT verification
    └── __init__.py

supabase/migrations/    # Schema v3 SQL (single source of truth for DDL)
scripts/smoke_test.py   # End-to-end check against a deployment
tests/                  # pytest suite
```

**Key design principles:**
- **Clear encapsulation** - models know nothing about the database, the database knows nothing about the API.
- **DDL lives in migrations**, not in application code.
- **Every query is scoped by `user_id`.** Another user's row returns 404, never 403, so ids stay private.

## Setup

```bash
pip install -r requirements.txt   # PyJWT[crypto] is required for ES256
cp .env.example .env              # then fill it in

# Apply the schema (see the warning below first)
supabase link --project-ref <ref>
supabase db push

uvicorn src.web.api:app --reload --port 8000
```

> **The v3 migration DROPS and recreates the labeling tables.** Confirm
> `supabase projects list` shows the link pointing at a project dedicated to
> this app before pushing.

## Authentication

Every route under `/api` except `/api/health` requires a Supabase access token:

```
Authorization: Bearer <supabase access token>
```

The token's `sub` claim becomes the `user_id` that scopes every query.

Verification follows the token's own `alg` header, so both Supabase signing
schemes work:

- **ES256 / RS256** (the default for projects created from 2025 on) — the public
  key is fetched from `{SUPABASE_URL}/auth/v1/.well-known/jwks.json` and cached.
  Needs `SUPABASE_URL`; no shared secret.
- **HS256** (legacy projects) — verified against `SUPABASE_JWT_SECRET`.

`aud` must be `authenticated`, and `exp` and `sub` are required.

## API Documentation

- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

## API Endpoints

### Health & configuration
```
GET  /                              # Liveness (no auth)
GET  /api/health                    # Postgres + R2 readiness, schema version (no auth)
GET  /api/config                    # Full taxonomy for all three lenses
```

### Videos
```
POST /api/videos/register           # Register a client-processed video; stores pose CSV in R2
                                    # JSON body; rejects bodies over 60MB with 413
POST /api/videos/{id}/upload-url    # Presigned PUT so the browser uploads the video to R2
POST /api/videos/{id}/confirm-upload# Record the video's R2 key after a direct upload
GET  /api/videos                    # List the current user's videos
GET  /api/videos/{id}               # Get video details
GET  /api/videos/{id}/csv           # 307 to a presigned URL for the raw pose CSV
POST /api/videos/{id}/export        # Join labels with pose data, write export to R2
GET  /api/videos/{id}/export/download # 307 to a presigned URL for the export
GET  /api/exports/mine              # List the current user's exports
```

### Holds
```
POST   /api/holds                   # Mark a hold (normalized 0-1 bounding box)
GET    /api/videos/{id}/holds       # List holds on a video
DELETE /api/holds/{id}              # Delete a hold
```

### Moves (Lens 2: Strategy)
```
POST   /api/moves                   # Create move
GET    /api/moves/{id}              # Get move details
PUT    /api/moves/{id}              # Update move
DELETE /api/moves/{id}              # Delete move (+ environment, outcome, frame tags)
GET    /api/videos/{id}/moves       # Get all moves for a video
```

### Environments (Lens 1) and Outcomes (Lens 3)
```
POST /api/environments              # Create environment for a move
GET  /api/moves/{id}/environment    # Get a move's environment
PUT  /api/environments/{id}         # Update environment
POST /api/outcomes                  # Create outcome for a move
GET  /api/moves/{id}/outcome        # Get a move's outcome
PUT  /api/outcomes/{id}             # Update outcome
```

### Frame tags (Sensation)
```
POST   /api/frame-tags              # Create frame tag
GET    /api/moves/{id}/frame-tags   # Get frame tags for a move
DELETE /api/frame-tags/{id}         # Delete frame tag
```

## Upload flow

The browser runs pose extraction locally, so the video never passes through the
API:

1. `POST /api/videos/register` with the pose CSV inline. The CSV goes to R2 at
   `pose/{user_id}/{video_id}.csv` and a video row comes back.
2. `POST /api/videos/{id}/upload-url` returns a presigned PUT.
3. The browser PUTs the original video straight to R2.
4. `POST /api/videos/{id}/confirm-upload` records the key.

## Export system

```
POST /api/videos/{id}/export
```

1. Streams the raw pose CSV out of R2.
2. Fetches moves, environments, outcomes and frame tags from Postgres.
3. Merges by frame number, expanding each move across `frame_start..frame_end`.
4. Writes the result to R2 at `exports/{user_id}/{video_id}_labeled.csv` and
   records `r2_export_key` on the video row.

Columns appended to the raw pose header:

- `move_id`
- Strategy: `approach`, `size`, `move_tags`, `form_quality`, `effort_level`, `move_confidence`
- Environment: `wall_angle`, and per slot (`start_left`, `start_right`, `end`, `foot`):
  `{slot}_hold_id`, `{slot}_hold_type`, `{slot}_hold_quality`, `{slot}_hold_bbox`
- Outcome: `result`, `reach_detail`, `outcome_confidence`
- Sensation: `tag_types`, `tag_levels`, `tag_locations`, `tag_sides`, `tag_notes`
  (pipe-delimited when a frame carries several tags)

## R2 key layout

```
videos/{user_id}/{video_id}/{filename}
pose/{user_id}/{video_id}.csv
exports/{user_id}/{video_id}_labeled.csv
```

## Database

Postgres (Supabase), schema version 3. RLS is enabled on every table with
select/insert/update/delete policies scoped to `auth.uid() = user_id`.

Connect through the **transaction pooler** (port 6543). The direct database
host is IPv6-only. psycopg's automatic prepared statements are disabled in
`Database._configure_connection` because pgbouncer in transaction mode cannot
carry a prepared statement between pooled backends.

```sql
videos:       id, user_id, filename, fps, total_frames, duration_ms,
              r2_video_key, r2_pose_csv_key, r2_export_key, uploaded_at

holds:        id, video_id, user_id, bbox_x, bbox_y, bbox_w, bbox_h,
              source ('detected'|'manual'), created_at

moves:        id, video_id, user_id, frame_start, frame_end,
              timestamp_start_ms, timestamp_end_ms, approach, move_tags (jsonb),
              size, form_quality, effort_level, confidence, description, labeled_at

environments: id, move_id, user_id, wall_angle, and for each of
              start_left / start_right / end / foot:
              {slot}_hold_id, {slot}_hold_type, {slot}_hold_quality (jsonb)

outcomes:     id, move_id, user_id, result, reach_detail, confidence

frame_tags:   id, move_id, user_id, frame_number, timestamp_ms, tag_type,
              side, level, locations (jsonb), note, tagged_at
```

All four environment hold slots are optional, which covers no-hands, one-hand
and no-feet moves.

## Taxonomy

Defined in `models.py` and served by `/api/config`:

- **Approaches**: static, dynamic, coordination
- **Sizes**: small, medium, large
- **Move tags**: bump, mantle, balance, upper_body_coordination,
  lower_body_coordination, heel_hook, toe_hook, no_feet_on, deadpoint, dyno,
  foot_move, no_hands, technical, tension
- **Wall angles**: slab, vertical, gentle_overhang, steep
- **Hold types**: horizontal_edge, gaston, side_pull, undercling, jug, pinch
- **Hold qualities**: incut, sloped, small
- **Results**: success, fall
- **Reach details**: reached_controlled, reached_not_controlled, didnt_reach
- **Confidence**: low, med, high
- **Tag types**: sharp_pain, dull_pain, audible_pop, unstable, stretch, strong,
  weak, pumped, fatigue

## Tests

```bash
export TEST_DATABASE_URL=postgresql://.../dynalytix_test
pytest tests/ -q
```

> The suite applies the v3 migration, which **drops and recreates** the
> labeling tables. Point `TEST_DATABASE_URL` at a throwaway database.

R2 is exercised against the real bucket when credentials are present and the
bucket answers; otherwise an in-memory fake stands in.

## Smoke test

```bash
python scripts/smoke_test.py --url https://<service>.up.railway.app
```

Registers a video with a synthetic pose CSV, labels it across all three lenses,
exports, fetches the export back out of R2, then checks a second user gets 404
on every one of those resources.

Tokens: with `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and
`SUPABASE_ANON_KEY` set, it creates two throwaway users through the auth admin
API and signs them in, so the project's real signing keys are exercised. Pass
`--jwt` / `--other-jwt` to supply your own. It falls back to locally minted
HS256 tokens only on legacy-secret projects.

## Error handling

- `200` Success
- `201` Created
- `204` No Content (delete)
- `307` Temporary Redirect (to a presigned R2 URL)
- `400` Bad Request
- `401` Missing, malformed or expired token
- `404` Not Found (also returned for another user's resource)
- `409` Conflict (environment or outcome already exists for the move)
- `413` Body too large (register, over 60MB)
- `503` Object storage unavailable
