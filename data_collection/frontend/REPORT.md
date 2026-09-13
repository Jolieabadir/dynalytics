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

⚠️ **The contract differs from the one named in the task.** The task described
"33 landmarks x/y/z/visibility, 10 joint angles". The code emits **15 landmarks and 12
angles**, and the first two columns are `frame_number`/`timestamp_ms`, not
`frame_index`/`timestamp`. The **shipped format below is authoritative** and is what this
branch keeps byte-identical, since changing it would break `SkeletonOverlay`'s positional
indexing and the backend's stored CSVs. Flagging it in case the 33-landmark shape was the
actual intent — that would be a deliberate, separate migration.

**75 columns**, in this order:

1. `frame_number` — integer, from 0
2. `timestamp_ms` — float, milliseconds
3. `speed_center_of_mass` — px/s of the hip midpoint; `0` on the first frame and whenever
   landmarks are missing
4. **12 angles**, degrees, empty string when any contributing landmark is absent:
   `angle_left_elbow`, `angle_right_elbow`, `angle_left_shoulder`, `angle_right_shoulder`,
   `angle_left_hip`, `angle_right_hip`, `angle_left_knee`, `angle_right_knee`,
   `angle_left_ankle`, `angle_right_ankle`, `angle_upper_back`, `angle_lower_back`
5. **15 landmarks × 4 fields** = 60 columns, `landmark_<name>_{x,y,z,visibility}` in this
   landmark order: `nose`, `left_shoulder`, `right_shoulder`, `left_elbow`, `right_elbow`,
   `left_wrist`, `right_wrist`, `left_hip`, `right_hip`, `left_knee`, `right_knee`,
   `left_ankle`, `right_ankle`, `left_heel`, `right_heel`

Header line, verbatim:

```
frame_number,timestamp_ms,speed_center_of_mass,angle_left_elbow,angle_right_elbow,angle_left_shoulder,angle_right_shoulder,angle_left_hip,angle_right_hip,angle_left_knee,angle_right_knee,angle_left_ankle,angle_right_ankle,angle_upper_back,angle_lower_back,landmark_nose_x,landmark_nose_y,landmark_nose_z,landmark_nose_visibility,landmark_left_shoulder_x,landmark_left_shoulder_y,landmark_left_shoulder_z,landmark_left_shoulder_visibility,landmark_right_shoulder_x,landmark_right_shoulder_y,landmark_right_shoulder_z,landmark_right_shoulder_visibility,landmark_left_elbow_x,landmark_left_elbow_y,landmark_left_elbow_z,landmark_left_elbow_visibility,landmark_right_elbow_x,landmark_right_elbow_y,landmark_right_elbow_z,landmark_right_elbow_visibility,landmark_left_wrist_x,landmark_left_wrist_y,landmark_left_wrist_z,landmark_left_wrist_visibility,landmark_right_wrist_x,landmark_right_wrist_y,landmark_right_wrist_z,landmark_right_wrist_visibility,landmark_left_hip_x,landmark_left_hip_y,landmark_left_hip_z,landmark_left_hip_visibility,landmark_right_hip_x,landmark_right_hip_y,landmark_right_hip_z,landmark_right_hip_visibility,landmark_left_knee_x,landmark_left_knee_y,landmark_left_knee_z,landmark_left_knee_visibility,landmark_right_knee_x,landmark_right_knee_y,landmark_right_knee_z,landmark_right_knee_visibility,landmark_left_ankle_x,landmark_left_ankle_y,landmark_left_ankle_z,landmark_left_ankle_visibility,landmark_right_ankle_x,landmark_right_ankle_y,landmark_right_ankle_z,landmark_right_ankle_visibility,landmark_left_heel_x,landmark_left_heel_y,landmark_left_heel_z,landmark_left_heel_visibility,landmark_right_heel_x,landmark_right_heel_y,landmark_right_heel_z,landmark_right_heel_visibility
```

Value rules that must survive the rewrite:

- Rows are joined with `\n`; no trailing newline; no quoting (no field can contain a comma).
- Landmark `x`/`y` are **pixel coordinates in the original video's resolution**
  (`lm.x * videoWidth`), *not* normalized. **This is the subtle part of the downscale
  work**: MediaPipe returns normalized coordinates, so the 512px inference canvas must
  *not* be used as the multiplier — the original `videoWidth`/`videoHeight` must be, or
  every coordinate silently shrinks and the overlay misaligns.
- `z` is raw MediaPipe depth, passed through unscaled. `visibility` is `lm.visibility || 0`.
- A frame with no detected pose emits `frame_number,timestamp_ms,0` then `''` for all 72
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
