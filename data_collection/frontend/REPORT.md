# Pose Extractor v2 — Frontend Report

Branch: `feat/pose-extractor-v2`, cut from `feat/supabase-r2-schema-v3` (commit `aea9920`).
Scope: `data_collection/frontend` only. No backend file is modified — `backend/REPORT.md`
and `backend/src/web/api.py` were read only, to pin the API contract.

---

## 1. Current flow, fps assumptions, and the CSV contract

### 1.1 How extraction works today

`VideoUpload.jsx` → `PoseExtractor.js`, entirely client-side. The video never leaves
the browser; only the pose CSV is sent to the server.

1. `handleFileSelect` validates the extension (`.mov`, `.mp4`, `.avi`), makes a blob URL,
   and stores it as `videoBlobUrl` for later playback.
2. It creates a detached `<video>`, waits for `loadedmetadata`, then **hardcodes
   `const fps = 30`** (`VideoUpload.jsx:62`) and derives
   `totalFrames = Math.floor(duration * 30)`.
3. `PoseExtractor.initialize()` builds a `PoseLandmarker` — **a fresh one per upload**,
   re-downloading WASM + model each time. Model is `pose_landmarker_full` (not lite),
   `delegate: 'GPU'` with no CPU fallback, `runningMode: 'VIDEO'`.
4. `extractFromVideo()` is the bottleneck. For every frame it does:

   ```js
   videoElement.currentTime = timestampMs / 1000;
   await new Promise(resolve => { videoElement.onseeked = resolve; });
   ```

   A **discrete seek per frame**. Each seek forces the decoder to find and decode to an
   exact position; on a long-GOP phone H.264/HEVC file that can mean re-decoding from the
   preceding keyframe every time. At 30fps assumed over a 2-minute clip that is 3,600
   seeks. This is why upload takes many minutes, and it is the single thing this branch
   replaces.
5. `framesToCSV()` shapes the rows, the result goes into the Zustand store, and the CSV is
   POSTed to `/api/videos/register` as **multipart form data** with no auth header.

### 1.2 Correctness problems in the current math

- **fps is a guess.** A 60fps iPhone clip is walked at 30fps, so *every other frame is
  silently dropped* and `frame_number` in the CSV counts 30ths of a second while the
  player counts 60ths. Frame indices in saved moves and frame tags are then wrong by 2×
  against the real video.
- **`Math.floor(duration * fps)`** truncates, losing the final partial frame.
- **`onseeked` as a bare property** is overwritten each iteration and never removed; a
  seek that resolves late can settle the wrong promise.
- **No cancel path.** Navigating away mid-extraction leaves the loop running.
- **No decode-failure detection.** An HEVC file Chrome can't decode produces a silent run
  of null-landmark rows rather than an error.

### 1.3 Every place fps is assumed (the full list)

| File | Line | Assumption | Fate on this branch |
|---|---|---|---|
| `components/VideoUpload.jsx` | 62 | `const fps = 30` — the source of the bug | **Removed**; measured from frame callbacks |
| `components/VideoUpload.jsx` | 64 | `Math.floor(duration * fps)` | **Replaced** with `Math.round` |
| `services/PoseExtractor.js` | 166–193 | `fps` passed in; seek-per-frame | **Rewritten** |
| `components/VideoPlayer.jsx` | 34 | `currentVideo?.fps \|\| 30` | Fallback **removed** |
| `components/VideoPlayer.jsx` | 82 | `Math.floor(currentTime * fps)` → currentFrame | Reads store fps |
| `components/VideoPlayer.jsx` | 133 | `frame / fps` → seek time | Reads store fps |
| `components/VideoPlayer.jsx` | 193 | `(currentFrame / fps).toFixed(2)` display | Reads store fps |
| `components/TaggingMode.jsx` | 103 | `currentVideo?.fps \|\| 30` | Fallback **removed** |
| `components/TaggingMode.jsx` | 143, 155, 166, 188, 243 | frame↔time both directions | Reads store fps |
| `components/MoveForm.jsx` | 231, 238–239 | `(moveStart / fps) * 1000` → `timestamp_*_ms` sent to API | Reads store fps |
| `components/MoveForm.jsx` | 344, 346 | `currentVideo?.fps \|\| 30` duration display | Fallback **removed** |
| `components/SkeletonOverlay.jsx` | 59 | `csvData[currentFrame]` — **positional**, assumes row N is frame N | Kept; the no-gap guarantee is what makes it safe |
| `services/PoseExtractor.js` | 19 | `30: 'right_heel'` | **Not fps** — a MediaPipe landmark index. Stays. |

`MovesList.jsx`, `ExportService.js`, and `api/client.js` do no frame↔time conversion.

`SkeletonOverlay` deserves emphasis: it indexes the parsed CSV array *by position*. That
is only correct while the CSV has exactly one row per frame with no gaps, which is
precisely the invariant step 5 verifies.

### 1.4 The CSV column contract — recorded exactly

> **Updated by the landmark widening — see §9.** The contract is now **147 columns /
> 33 landmarks**. This section describes the *current* format; the original 15-landmark,
> 75-column layout is preserved verbatim as the first 75 columns, so everything below
> about column 75 is additive. §9 covers what changed and why.

When this branch started, the code emitted **15 landmarks and 12 angles** — not the
"33 landmarks, 10 joint angles" the original brief named. That gap is what §9 closes.
The angle count stays at **12**: the brief's "10" omitted `angle_upper_back` and
`angle_lower_back`, which the code has always emitted.

**147 columns**, in this order:

1. `frame_number` — integer, from 0
2. `timestamp_ms` — float, milliseconds
3. `speed_center_of_mass` — px/s of the hip midpoint; `0` on the first frame and whenever
   landmarks are missing
4. **12 angles**, degrees, empty string when any contributing landmark is absent:
   `angle_left_elbow`, `angle_right_elbow`, `angle_left_shoulder`, `angle_right_shoulder`,
   `angle_left_hip`, `angle_right_hip`, `angle_left_knee`, `angle_right_knee`,
   `angle_left_ankle`, `angle_right_ankle`, `angle_upper_back`, `angle_lower_back`
5. **33 landmarks × 4 fields** = 132 columns, `landmark_<name>_{x,y,z,visibility}`.
   Names are MediaPipe's canonical ones. The order is **the original 15 first**, then the
   18 added ones — *not* MediaPipe index order (§9 explains why).

   **Original 15** (columns 16–75, unchanged): `nose`, `left_shoulder`, `right_shoulder`,
   `left_elbow`, `right_elbow`, `left_wrist`, `right_wrist`, `left_hip`, `right_hip`,
   `left_knee`, `right_knee`, `left_ankle`, `right_ankle`, `left_heel`, `right_heel`

   **Added 18** (columns 76–147), in MediaPipe index order: `left_eye_inner`, `left_eye`,
   `left_eye_outer`, `right_eye_inner`, `right_eye`, `right_eye_outer`, `left_ear`,
   `right_ear`, `mouth_left`, `mouth_right`, `left_pinky`, `right_pinky`, `left_index`,
   `right_index`, `left_thumb`, `right_thumb`, `left_foot_index`, `right_foot_index`

Header line, verbatim:

```
frame_number,timestamp_ms,speed_center_of_mass,angle_left_elbow,angle_right_elbow,angle_left_shoulder,angle_right_shoulder,angle_left_hip,angle_right_hip,angle_left_knee,angle_right_knee,angle_left_ankle,angle_right_ankle,angle_upper_back,angle_lower_back,landmark_nose_x,landmark_nose_y,landmark_nose_z,landmark_nose_visibility,landmark_left_shoulder_x,landmark_left_shoulder_y,landmark_left_shoulder_z,landmark_left_shoulder_visibility,landmark_right_shoulder_x,landmark_right_shoulder_y,landmark_right_shoulder_z,landmark_right_shoulder_visibility,landmark_left_elbow_x,landmark_left_elbow_y,landmark_left_elbow_z,landmark_left_elbow_visibility,landmark_right_elbow_x,landmark_right_elbow_y,landmark_right_elbow_z,landmark_right_elbow_visibility,landmark_left_wrist_x,landmark_left_wrist_y,landmark_left_wrist_z,landmark_left_wrist_visibility,landmark_right_wrist_x,landmark_right_wrist_y,landmark_right_wrist_z,landmark_right_wrist_visibility,landmark_left_hip_x,landmark_left_hip_y,landmark_left_hip_z,landmark_left_hip_visibility,landmark_right_hip_x,landmark_right_hip_y,landmark_right_hip_z,landmark_right_hip_visibility,landmark_left_knee_x,landmark_left_knee_y,landmark_left_knee_z,landmark_left_knee_visibility,landmark_right_knee_x,landmark_right_knee_y,landmark_right_knee_z,landmark_right_knee_visibility,landmark_left_ankle_x,landmark_left_ankle_y,landmark_left_ankle_z,landmark_left_ankle_visibility,landmark_right_ankle_x,landmark_right_ankle_y,landmark_right_ankle_z,landmark_right_ankle_visibility,landmark_left_heel_x,landmark_left_heel_y,landmark_left_heel_z,landmark_left_heel_visibility,landmark_right_heel_x,landmark_right_heel_y,landmark_right_heel_z,landmark_right_heel_visibility,landmark_left_eye_inner_x,landmark_left_eye_inner_y,landmark_left_eye_inner_z,landmark_left_eye_inner_visibility,landmark_left_eye_x,landmark_left_eye_y,landmark_left_eye_z,landmark_left_eye_visibility,landmark_left_eye_outer_x,landmark_left_eye_outer_y,landmark_left_eye_outer_z,landmark_left_eye_outer_visibility,landmark_right_eye_inner_x,landmark_right_eye_inner_y,landmark_right_eye_inner_z,landmark_right_eye_inner_visibility,landmark_right_eye_x,landmark_right_eye_y,landmark_right_eye_z,landmark_right_eye_visibility,landmark_right_eye_outer_x,landmark_right_eye_outer_y,landmark_right_eye_outer_z,landmark_right_eye_outer_visibility,landmark_left_ear_x,landmark_left_ear_y,landmark_left_ear_z,landmark_left_ear_visibility,landmark_right_ear_x,landmark_right_ear_y,landmark_right_ear_z,landmark_right_ear_visibility,landmark_mouth_left_x,landmark_mouth_left_y,landmark_mouth_left_z,landmark_mouth_left_visibility,landmark_mouth_right_x,landmark_mouth_right_y,landmark_mouth_right_z,landmark_mouth_right_visibility,landmark_left_pinky_x,landmark_left_pinky_y,landmark_left_pinky_z,landmark_left_pinky_visibility,landmark_right_pinky_x,landmark_right_pinky_y,landmark_right_pinky_z,landmark_right_pinky_visibility,landmark_left_index_x,landmark_left_index_y,landmark_left_index_z,landmark_left_index_visibility,landmark_right_index_x,landmark_right_index_y,landmark_right_index_z,landmark_right_index_visibility,landmark_left_thumb_x,landmark_left_thumb_y,landmark_left_thumb_z,landmark_left_thumb_visibility,landmark_right_thumb_x,landmark_right_thumb_y,landmark_right_thumb_z,landmark_right_thumb_visibility,landmark_left_foot_index_x,landmark_left_foot_index_y,landmark_left_foot_index_z,landmark_left_foot_index_visibility,landmark_right_foot_index_x,landmark_right_foot_index_y,landmark_right_foot_index_z,landmark_right_foot_index_visibility
```

Value rules that must survive the rewrite:

- Rows are joined with `\n`; no trailing newline; no quoting (no field can contain a comma).
- Landmark `x`/`y` are **pixel coordinates in the original video's resolution**
  (`lm.x * videoWidth`), *not* normalized. **This is the subtle part of the downscale
  work**: MediaPipe returns normalized coordinates, so the 512px inference canvas must
  *not* be used as the multiplier — the original `videoWidth`/`videoHeight` must be, or
  every coordinate silently shrinks and the overlay misaligns.
- `z` is raw MediaPipe depth, passed through unscaled. `visibility` is `lm.visibility || 0`.
- A frame with no detected pose emits `frame_number,timestamp_ms,0` then `''` for all 144
  remaining columns.
- Numbers are stringified by `Array.join`, i.e. JS default formatting.

### 1.5 Backend contract this must be written against

From `backend/src/web/api.py` (read-only). The backend on this base branch **has already
moved off the old shape**, so the current frontend is broken against it regardless of
performance:

- **Auth is now required** on every `/api` route except `/api/health`:
  `Authorization: Bearer <supabase access token>`, else `401`.
- **`POST /api/videos/register` takes JSON, not multipart**:
  `{ filename, fps: float, total_frames: int, duration_ms: float, csv_data: string }`
  → `201 { id, filename, fps, total_frames, duration_ms, r2_video_key, r2_pose_csv_key,
  r2_export_key, uploaded_at }`. `path`/`csv_path` are gone. `413` over 60 MB.
- **`POST /api/videos/upload` was removed.** The original video now goes up directly:
  `POST /api/videos/{id}/upload-url` `{content_type}` → `{url, key, expires_in}`, then a
  credential-free `PUT` to that URL with a **matching `Content-Type`** (or the signature
  fails), then `POST /api/videos/{id}/confirm-upload` `{key}`.

**The frontend currently has no Supabase client at all** — `@supabase/supabase-js` is not
in `package.json` and nothing reads `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`, though
both are present in `.env`. Resolving that is recorded under the defaults in §3.

---

## 2. What changed, file by file

| File | Change |
|---|---|
| `src/services/poseMath.js` | **New.** All pure math: `detectFps`, `frameIndexFor`, `totalFramesFor`, `computeResult`, `buildRows`, `framesToCSV`, `csvHeaders`, plus the angle geometry and `LANDMARK_MAP`/`ANGLE_DEFINITIONS`. No MediaPipe or DOM import, so it is testable in Node. |
| `src/services/PoseExtractor.js` | **Rewritten.** Play-through capture loop, module-level landmarker singleton, fps detection, typed errors, cancel, visibility handling. Re-exports the pure helpers so existing importers keep working. |
| `src/utils/frames.js` | **New.** `fpsOf` / `timeToFrame` / `frameToTime` / `frameToMs` / `totalFrames`. One rounding rule for the whole app. |
| `src/components/VideoUpload.jsx` | **Rewritten.** Time-based progress, cancel, tab notice, typed error rendering, desktop hint, register with retry, presigned video upload. |
| `src/api/client.js` | Auth interceptor; `registerVideo` (JSON + backoff), `getUploadUrl`, `putVideoToR2`, `confirmUpload`, `uploadOriginalVideo`. Removed `uploadVideo` (endpoint no longer exists). |
| `src/api/auth.js` | **New.** Supabase client + `getAccessToken` / `requireAccessToken` / `authHeader`. |
| `src/components/VideoPlayer.jsx` | `|| 30` removed; conversions via `utils/frames`. Frame-from-time now **rounds** instead of flooring, matching the extractor. |
| `src/components/TaggingMode.jsx` | `|| 30` removed; 5 conversion sites via `utils/frames`. |
| `src/components/MoveForm.jsx` | `|| 30` removed; `timestamp_start_ms`/`timestamp_end_ms` via `frameToMs`. |
| `src/App.css` | Added `.cancel-button`. |
| `scripts/make_test_video.sh` | **New.** ffmpeg clip generator (installs ffmpeg if missing). |
| `scripts/test_pose_math.mjs` | **New.** 25 tests. |
| `scripts/fixtures/frame_times_{30,60}fps.json` | **New.** Real presentation times from the generated clips. |
| `package.json` | Added `@supabase/supabase-js`; `npm test`, `npm run make-test-videos`. |
| `.gitignore` | `.env` (was **not** ignored before) and `test-videos/`. |

`MovesList.jsx`, `SkeletonOverlay.jsx`, `ExportService.js`, `useStore.js`, `App.jsx` are unchanged.

### Why it should be fast now

The old loop set `currentTime` and waited for `seeked` once per frame. On long-GOP
phone footage each seek can re-decode from the preceding keyframe, so cost grows with
GOP length rather than frame count — thousands of seeks for a 2-minute clip.

The new loop decodes each frame exactly once, in presentation order, which is the
same work the video element does during ordinary playback. The floor is therefore the
clip's own duration, and the ceiling is set by whether inference keeps up. Pausing on
every frame callback means that when inference is slower than realtime the clip simply
takes longer — it never silently skips a frame, which a plain "detect on every
callback while playing" loop would do.

## 3. Defaults taken

Per instruction, decisions were made without asking and are recorded here.

1. **Every frame processed**, no fps sampling, as specified.
2. **512px long-edge** inference canvas. Landmarks are denormalized against the
   **original** resolution, so the CSV's pixel coordinates are unchanged by this.
3. **MediaPipe Tasks PoseLandmarker, lite model, GPU→CPU fallback, `runningMode: 'VIDEO'`**,
   as specified. The project was already on `@mediapipe/tasks-vision` (0.10.32), so
   **no legacy `@mediapipe/pose` migration was needed** — but the model changed from
   `pose_landmarker_full` to `pose_landmarker_lite` per the brief. Expect slightly
   lower landmark accuracy in exchange for the speed.
4. **CDN pinned to 0.10.32** rather than `@latest`, matching `package-lock.json`. The
   WASM glue and JS wrapper must agree, and `@latest` defeats CDN caching.
5. **`requestVideoFrameCallback` required**; no seek fallback. A browser without it
   gets a message naming Chrome, Edge and Safari in place of the upload panel.
6. **CSV contract initially kept as shipped** (75 columns, 15 landmarks, 12 angles)
   rather than the 33-landmark shape named in the brief, since the brief and the code
   disagreed. **Superseded:** the widening in §9 takes it to 147 columns / 33 landmarks,
   additively. Angles stay at 12.
7. **`REPORT.md` lives in `data_collection/frontend/`**, since the backend has its own.
8. **Holes are filled, not skipped.** A missing frame index produces a pose-less row
   rather than a gap, because `SkeletonOverlay` indexes the CSV positionally.
9. **`Math.round`, not `Math.floor`**, for both `frame_index` and `total_frames`.
   The old floor dropped the last partial frame and disagreed with the player.
10. **Fallback fps of 30** survives in `PoseExtractor.js` for clips with fewer than 3
    presented frames, where detection is impossible. Justified in §5.
11. **`@supabase/supabase-js` added** to mint the bearer token the backend now requires.
    This is the token *reader* only — **no sign-in UI**. See §7 for the handoff.
12. **Original-video upload is best-effort.** It runs after `register`, so a failure
    there logs a warning rather than discarding a successful extraction.
13. **Register retries only transport errors and 5xx.** A 401 or 413 will not become
    true on a retry, so those fail immediately.
14. **`.env` copied** from the original checkout and **added to `.gitignore`**. It was
    not ignored before, which was a live risk of committing keys. It is not committed.

## 4. Verification

`npm test` — **25 tests, all passing.**

```
✔ detectFps recovers each supported rate from ideal timings
✔ detectFps snaps NTSC rates to their nominal neighbour
✔ detectFps survives a stalled interval
✔ detectFps tolerates jitter within a rate
✔ detectFps returns null when there is too little to measure
✔ detectFps identifies the real recorded clips
✔ frameIndexFor rounds to the nearest frame
✔ totalFramesFor rounds rather than truncating
✔ every recorded presentation time maps to its own frame index
✔ rows are contiguous from 0 with no gaps, for both clips
✔ row count matches duration x fps for both clips
✔ timestamp equals frame_index / fps to within 1ms
✔ timestamps increase strictly
✔ duplicate presentation times collapse to one row
✔ a missing frame is filled rather than left as a gap
✔ out-of-order samples are sorted before indexing
✔ buildRows on no samples yields no rows
✔ the header is byte-identical to the shipped contract
✔ every row carries exactly 75 fields
✔ a pose-less frame is encoded as zero speed and empty columns
✔ the CSV has no trailing newline and one header line
✔ no field can contain a comma, so unquoted CSV stays parseable
✔ landmarks denormalize against the source resolution, not the canvas
✔ centre-of-mass speed is zero on the first frame and measured after
✔ a 60fps clip read as 30fps loses half the frames — the original bug
```

The three checks the brief asked for, confirmed for **both** clips:

- **Row count ≈ duration × fps** — 300 rows for the 30fps clip, 600 for the 60fps clip,
  against ffprobe's exact counts of 300 and 600.
- **`frame_index` monotonic with no gaps** — asserted index-by-index from 0.
- **`timestamp = frame_index / fps` within 1ms** — exact, since `timestamp_ms` is
  derived from the index rather than measured independently.

**Byte-identical output confirmed separately.** The new `framesToCSV` was diffed
against the old implementation (recovered from `aea9920`) over 200 synthetic frames
including pose-less frames and null angles: **243,156 bytes from both, identical.**

`npm run build` succeeds. ESLint reports **zero problems in every new or changed file**;
the 10 errors and 2 warnings that remain in `MovesList`, `SkeletonOverlay`, `VideoPlayer`
and `useStore` are all pre-existing — verified by linting `VideoPlayer.jsx` at `aea9920`,
which produces the same 3 errors and 1 warning, only shifted a line by the added import.

### Why not Playwright

MediaPipe needs a GPU-backed browser; in a headless container it either falls back to a
CPU path that measures nothing useful or fails outright. A Node test over recorded
frame timings covers exactly the logic that was wrong before, and the parts it cannot
reach are listed as manual checks in §6.

## 5. Justification for every remaining `30` in `src`

```
src/utils/frames.js:6            — the string "|| 30" inside a comment explaining the bug
src/components/TaggingMode.jsx:28 — unstable: '#eab308'  (a colour, not a rate)
src/services/PoseExtractor.js:53  — FALLBACK_FPS = 30
src/services/poseMath.js:30       — 30: 'right_heel'   (a MediaPipe landmark index)
src/services/poseMath.js:44       — KNOWN_FPS = [24, 25, 30, ...]  (a candidate, not a default)
src/services/PoseExtractor.js     — detectFps(...) ?? FALLBACK_FPS   (x2)
```

Only `FALLBACK_FPS` is a real fps default, and it is materially different from the old
`const fps = 30`. The old one was an **assumption applied to every video**. This one is
reached only when a clip presents fewer than three frames, so no interval exists to
measure. Every real clip measures its own rate. **No hardcoded 30 is on the path of a
normal upload.**

## 6. Step 6 — dev server and browser run

The dev server runs clean (`VITE v7.3.1 ready in 727 ms`, `http://localhost:5173/`) and
`npm run build` succeeds.

**No end-to-end browser timing was captured, and the automated attempt is worth
describing so it isn't repeated.** The app shell stops at `Loading Dynalytix…` without a
backend, so the extractor was driven directly in the page instead — the module imported
from the dev server, the 60fps clip fetched as a `File`. That part worked:
`requestVideoFrameCallback` present, clip served, module loaded.

The run never finished. The automation tab reports `document.hidden === true` and could
not be foregrounded (a screenshot, and `osascript … activate`, both left it hidden), and
Chrome throttles a background tab hard enough that a 10-second clip had not completed
after roughly two minutes. Forcing `document.hidden` to `false` and dispatching
`visibilitychange` resumed the loop but not the throttling; a bounded 300-call inference
benchmark, which needs no frame presentation at all, also failed to finish in 85s. At
that point the renderer stopped answering CDP for 45s. **These numbers measure Chrome's
background-tab throttling, not the extractor, so none of them are reported as timings.**

Two things this did establish, both real:

- The **`visibilitychange` pause works in a real browser** — the loop stopped precisely
  when the tab was backgrounded, which is what stalled the benchmark.
- The module **loads and runs under Vite** with no import or resolution errors.

**Before/after timing is therefore unmeasured.** The reasoning for the expected
improvement is in §2; the number itself has to come from the manual test below.

## 7. The manual test to run on your laptop

Do this in a **foreground** Chrome window with a real 60fps iPhone clip.

```bash
cd data_collection/frontend
npm install
npm run dev                       # http://localhost:5173
# and, in another shell, the backend, or register will 401
```

You must be **signed in** — the backend rejects every `/api` call without a Supabase
bearer token, and this branch adds no login screen (§8). With no session you should see
*"You are not signed in…"*, which is itself a valid check of the error path.

1. **Timing.** Open DevTools → Console, upload a 2-minute 60fps clip, and read the line
   `[PoseExtractor] N frames in Xs (clip Ys at 60fps, Zx realtime)`.
   **Expect `Z` around 1.0 or below.** Anything above ~2 means inference is the
   bottleneck — check the same console for
   `GPU delegate unavailable, falling back to CPU`, which would explain it.
2. **fps.** The progress line should read **`60 fps`**, not 30. This is the core fix.
3. **Frame count.** `N` should be within a frame or two of `duration × 60`
   (~7,200 for 2 minutes). Roughly half that means fps detection regressed.
4. **Progress + cancel.** The bar should track video time smoothly. Hit **Cancel**
   mid-run: it should return to the picker immediately with no error, and the same file
   should be selectable again.
5. **Tab notice.** While extracting, confirm *"Keep this tab open"*. Switch to another
   tab for a few seconds and come back — it should say it paused, then resume and finish
   with the **correct total frame count**. (This is the behaviour that blocked automation
   in §6, so it is worth confirming by hand.)
6. **HEVC path.** Set iPhone Camera → Formats → **High Efficiency**, record a short
   clip, and upload it. Expect *"This video format can't be decoded in this browser…"*
   within about 5 seconds — not a hang and not a CSV full of empty rows. Then switch to
   **Most Compatible** and confirm the same shot works.
7. **Overlay alignment.** After extraction, scrub the player and check the skeleton sits
   on the climber. Misalignment would mean the 512px downscale leaked into the stored
   coordinates — the one regression the row-level tests cannot see.
8. **Frame accuracy.** Mark a move at a distinctive instant, then confirm the frame
   number in the player matches the moment on screen. On a 60fps clip the old build was
   off by 2×; this is the user-visible version of that check.
9. **Synthetic clips.** `npm run make-test-videos`, then upload `test_30fps.mp4` and
   `test_60fps.mp4`. Expect exactly 30/60 fps detected and ~300/~600 frames.

## 8. What the backend and the next frontend pass must know

**Nothing in this branch requires a backend change.** It was written against
`api.py` as it stands on `feat/supabase-r2-schema-v3`. Three things to be aware of:

1. **Sign-in is still missing, and it blocks uploads.** This branch adds
   `src/api/auth.js` — the token reader — and the bearer header on every request, but
   no login UI. **`register` will 401 for any user who has not signed in by some other
   means.** That screen is the single highest-priority follow-up; `.env` already has
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
2. **The rest of the frontend is still on the old API contract.** §7 of the backend
   report lists breaking changes this branch did **not** touch, because they are outside
   pose extraction: `moves` lost `timing`/`dyno_style`/`contextual_data`/`tags` and
   gained `confidence`; `environments` was restructured into four named slots;
   `export` and `csv` now return `307` redirects to presigned URLs rather than bodies;
   `/api/holds` is new. `MoveForm`, `TaggingMode` and `ExportService` will need that pass.
   **`ExportService.js` still sends `?delete_video=true`, which the new endpoint ignores.**
3. **Store and API shapes.**
   - `currentVideo` is now the new register response: `path` and `csv_path` are **gone**,
     replaced by `r2_video_key` / `r2_pose_csv_key` / `r2_export_key`. Anything reading
     `currentVideo.path` will get `undefined`.
   - **`currentVideo.fps` is now a measured float and is authoritative.** No component
     may reintroduce a default; use `fpsOf` from `src/utils/frames.js`, which returns
     `null` rather than guessing.
   - `total_frames` is now `round(duration × fps)`, so it may be one higher than the old
     floored value for the same clip.
   - The store itself is unchanged — no new fields, no renames.

### Known limitations

- Extraction is **single-threaded on the main thread**. A Web Worker with
  `OffscreenCanvas` would keep the UI responsive on slow machines; not done here, as it
  would have meant restructuring the capture loop around a second MediaPipe context.
- **Switching tabs pauses extraction.** Deliberate — background throttling makes the
  capture loop unreliable — but it does mean a long clip needs the tab left open.
- The **lite** model is less accurate than the `full` model this replaces. If landmark
  quality regresses noticeably on real climbing footage, `MODEL_URL` in
  `PoseExtractor.js` is a one-line change back to `pose_landmarker_full`, at a cost in
  speed.
- **No end-to-end timing has been measured** (§6). The headline performance claim is
  reasoned, not observed.

---

## 9. Landmark widening — 15 → 33 landmarks (follow-up)

The CSV now carries **all 33 MediaPipe Pose landmarks**, `x`/`y`/`z`/`visibility` each,
alongside the unchanged 12 angles. **147 columns**, up from 75.

MediaPipe always returned all 33; the old `LANDMARK_MAP` simply discarded 18 of them
before they reached the CSV. So this costs nothing at inference time — the landmarks were
already computed and thrown away. The only real cost is file size (below).

### Column order: additive, not canonical

The 18 new landmarks are **appended after** the original 15 rather than interleaved into
MediaPipe index order. Index order would have been tidier, but it would push
`left_shoulder` from column 19 to column 23 and shift every column after it.

Appending keeps the change **purely additive**: the first 75 columns are byte-for-byte
what they were. A positional reader of the old format keeps working unchanged, and a
name-based reader is unaffected either way. Within the appended block the 18 are in
MediaPipe index order, so there is still a rule, just applied to the new columns only.

New names are MediaPipe's canonical ones. The original 15 already used canonical names,
so **no existing column name changed**:

| Added | MediaPipe indices |
|---|---|
| Face — `left_eye_inner`, `left_eye`, `left_eye_outer`, `right_eye_inner`, `right_eye`, `right_eye_outer`, `left_ear`, `right_ear`, `mouth_left`, `mouth_right` | 1–10 |
| Hands — `left_pinky`, `right_pinky`, `left_index`, `right_index`, `left_thumb`, `right_thumb` | 17–22 |
| Feet — `left_foot_index`, `right_foot_index` | 31, 32 |

For climbing, the hand and foot landmarks are the interesting ones: `left_index` /
`left_thumb` / `left_pinky` give hand orientation on a hold, and `left_foot_index` gives
toe position, none of which the heel-only foot model could express.

### Golden file replaces the ad-hoc diff

The previous byte-identical check compared against the old implementation recovered from
git, which stops being possible once the contract deliberately changes. It is now a
committed golden file:

- `scripts/fixtures/golden_pose.csv` — 40 rows, 147 columns, 96,744 bytes.
- `scripts/golden_frames.mjs` — the seeded, deterministic frames behind it, shared by the
  generator and the test so the two cannot drift. It deliberately includes pose-less
  frames, frames with individual landmarks missing, null angles, and the first frame's
  zero centre-of-mass speed.
- `npm run make-golden` regenerates it. **Regenerate only when the contract is meant to
  change, and read the diff.**

**33 tests pass** (was 25). The 8 new ones cover the golden bytes, the 147-column header,
all 33 canonical names at their correct indices, the original 15 names surviving, and —
the important one — *the first 75 columns of the golden file reproducing the
pre-widening format exactly*.

The golden test was checked for bite: reordering the landmarks into canonical index order
fails 5 tests, and renaming a single landmark fails 5 tests. The row-count, `frame_index`
contiguity and `timestamp = frame_index / fps` tests all still pass unchanged.

### Backend check (read-only — no backend file modified)

Both are column-agnostic; **no backend change is needed**:

- **`POST /api/videos/register`** treats `csv_data` as opaque text. It length-checks the
  UTF-8 bytes and puts the string straight to R2 (`api.py:591`, `api.py:612`). It never
  parses columns.
- **`exporter.py`** reads with `csv.DictReader` and builds its writer from
  `list(reader.fieldnames) + self.label_columns()` (`exporter.py:50–52`, `150–155`) — it
  passes whatever columns arrive straight through and appends the label columns. The only
  column name it depends on is **`frame_number`** (`exporter.py:161`), which remains
  column 1.
- No `landmark_*` or `angle_*` name appears anywhere in the backend Python. The other
  `frame_number` hits are the `frame_tags` table, unrelated to the pose CSV.

### ⚠️ Size: this doubles the CSV, against a 60 MB cap

Measured from the golden file: **1,154 → 2,330 bytes per row, a 2.02× increase.**

| Clip | Pose CSV (was) | Pose CSV (now) |
|---|---|---|
| 2 min @ 30fps | ~4.0 MB | ~8.0 MB |
| 2 min @ 60fps | ~7.9 MB | **~16.0 MB** |
| 5 min @ 60fps | ~23.8 MB | **~48.0 MB** |

`MAX_REGISTER_BYTES` in `api.py` is **60 MB**, and register returns `413` above it. The
2-minute target case is comfortable at ~16 MB, but **a 60fps clip beyond roughly 6
minutes will now be rejected where it previously fit.** Nothing here changes that cap —
it is backend, and out of scope — but it is the one operational consequence of the
widening, and worth knowing before someone uploads a long clip.

Two cheap mitigations if it bites, neither done here: round coordinates to 2–3 decimals
(most of the row is float noise well below pixel precision — likely a 30–40% saving on
its own), or gzip the body.

### One visible side effect

`SkeletonOverlay` draws a joint dot for **every** `landmark_*` column it finds, so the
overlay will now also dot the eyes, ears, mouth, fingers and toes — 33 dots instead of
15. The skeleton *lines* are unchanged, since `SKELETON_CONNECTIONS` is a fixed list.
Nothing breaks, but the overlay will look busier around the face. Left alone
deliberately: trimming it is a display decision, not a data one. Filtering
`extractLandmarks` to `LEGACY_LANDMARK_ORDER`, or giving face points a smaller radius,
would be the fix if you want the old look.
