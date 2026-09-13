# Round C — Labeling UX, Definitions, and Holds

Branch `feat/ux-round-holds`, cut from `feat/pose-extractor-v2` (which itself sits on
the Supabase/R2 backend work). Sections below are appended as each step lands; the
Pose Extractor v2 report follows unchanged from §"Pose Extractor v2" onward.

---

## C0. The current UX flow, as found

Read from `App.jsx`, `store/useStore.js`, `api/client.js`, `api/auth.js`,
`components/{VideoUpload,VideoPlayer,MoveForm,MovesList,TaggingMode}.jsx`.

### The path a labeler walks today

1. **App boot.** `App.jsx` calls `getConfig()` once on mount. Until it resolves the
   whole app renders `<h2>Loading Dynalytix...</h2>`.
2. **No sign-in exists.** `api/auth.js` is a token *reader* only — `getSupabase()`,
   `getAccessToken()`, `requireAccessToken()`. There is no UI anywhere that calls
   `signInWithPassword`, so in practice there is never a session.
3. **Upload.** `currentVideo === null` → `VideoUpload`. Picking a file runs MediaPipe
   pose extraction in the browser (play-through capture loop), then
   `registerVideo()` (JSON) → `uploadOriginalVideo()` (presign → `PUT` to R2 →
   confirm). The CSV string and parsed rows land in the store.
4. **Define mode.** `VideoPlayer` and `MovesList` sit side by side. The player shows
   the video with a `SkeletonOverlay` drawn from the CSV, transport buttons, a
   timeline slider, and `[` / `]` to mark start and end frames. With both marked, a
   **Create Move** button appears and sets `showMoveForm`.
5. **Labeling.** `MoveForm` renders as a **full-screen modal overlay**
   (`.move-form-overlay` / `.move-form-modal`) covering the player. Three lens
   sections — Environment, Strategy, Outcome — then Save, which POSTs move →
   environment → outcome, with a rollback `deleteMove` if a later call fails.
6. **Tagging mode.** Choosing a move from `MovesList` switches `mode` to `tagging`.
   `TaggingMode` replays only that move's frame range, looping at the end, and adds
   sensation tags at the current frame.
7. **Finish.** `DoneButton` → `exportVideo()` → `ThankYouModal`.

### What is wrong with it — the motivation for this round

| # | Problem | Addressed by |
|---|---|---|
| 1 | **No way to sign in.** `/api/config` now requires a bearer token, so a fresh user 401s and sits on "Loading Dynalytix..." forever with no error and no route forward. | C1 |
| 2 | **No definitions.** Every option renders through `formatLabel()` — `horizontal_edge` → "Horizontal Edge" — and nothing says what any of them *mean*. Only four `move_tags` have a `title` tooltip, hardcoded in JSX rather than served by config. | C2 |
| 3 | **No onboarding.** Nothing tells a first-time labeler that `[` and `]` set the move boundaries, or that tagging mode wants the scrub bar. The shortcuts are discoverable only by reading the source. | C3 |
| 4 | **The form hides the video.** `MoveForm` is a modal overlay, so the labeler cannot see the movement, the skeleton, or scrub while deciding what to call it — exactly when they most need to look. | C4 |
| 5 | **No sense of progress.** Nothing shows how many moves are defined, labeled, or tagged, and "Done" is a single button with no indication of what remains. | C5 |
| 6 | **Two-hold model, stale schema.** The form still asks for `hold_type_reaching` / `hold_type_non_reaching` and posts `timing`, `dyno_style`, `tags`, `foot_cut` — all **removed** in schema v3. `previousEnvironment` in the store carries the same dead shape. The backend now wants four named slots. | C6 |
| 7 | **Holds are invisible.** The backend has had `holds` since v3 and the frontend has never touched them: no overlay, no picking, no detection. Nothing connects a label to a place on the wall. | C7 |
| 8 | **Reach wording is baked into the enum.** `reached_not_controlled` renders straight through `formatLabel()`, so changing the wording means changing the stored value. | C8 |
| 9 | **`TaggingMode` reads removed config keys.** It requires `traction_sources` in `REQUIRED_CONFIG_KEYS` and posts `traction_source` / `traction_direction`, all dropped in v3 — it will fail its own config validation against the live backend. | C6 |
| 10 | **Stale export/download client.** `exportVideo()` still sends `?delete_video=`, and `downloadExport()` expects a streamed blob where the backend now answers `307` to a presigned URL. `VideoPlayer`'s CSV fallback `fetch` sends no auth header at all. | C1, C5 |

### Store shape, as found

`useStore.js` holds: video (`currentVideo`, `videos`, `videoBlobUrl`, `csvData`,
`csvString`), moves (`moves`, `currentMove`), `frameTags`, player
(`currentFrame`, `isPlaying`), selection (`moveStart`, `moveEnd`), UI (`mode`,
`showMoveForm`, `showTagPopup`, `tagPopupType`), `config`, and
`previousEnvironment` — still the old two-hold shape.

---

---

## C1. Per-file changes

### New files

| File | What it is |
|---|---|
| `src/components/AuthGate.jsx` | Email + password sign-up / sign-in screen, shown whenever there is no session. One toggle between modes, client-side validation before any API call, and Supabase's terse errors translated into plain language. |
| `src/components/InfoTip.jsx` | The "i" beside an option. Hover and focus reveal the definition; a click pins it for touch devices. Renders nothing when config has no definition, rather than an empty bubble. |
| `src/components/OnboardingBanner.jsx` | The define / tagging one-liners. Dismissal goes to the store, session-only. |
| `src/components/ProgressStrip.jsx` | Persistent "{n} defined · {m} labeled · {k} tagged" header with Save & Next Move and Finish & Export. |
| `src/components/HoldOverlay.jsx` | Hold boxes over the video: drag to add, click to delete, and a pick mode for assigning a box to a form slot. |
| `src/services/holdDetector.js` | YOLOv8n / onnxruntime-web detection. **Off by default, no weights bundled** — see §C4. |
| `src/services/holdAssignment.js` | Pure nearest-box suggestion from the pose CSV. |
| `src/utils/taxonomy.js` | `optionLabel` / `optionDescription` — reads `display_label` and definitions out of config. |
| `src/utils/progress.js` | `progressCounts`, the defined/labeled/tagged arithmetic. |
| `src/test/setup.js`, `vitest.config.js` | DOM test environment. |
| 5 × `*.test.js(x)` | 66 tests — see §C5. |

### Changed files

| File | Change |
|---|---|
| `src/App.jsx` | **Rewritten.** Reads the persisted session at boot and follows it; renders `AuthGate` when there is none. Config now loads *after* a session exists — it requires a bearer token in v3, and loading it first was why a signed-out user hung on "Loading Dynalytix…". Header gains the account email and Sign out. Define mode gains the progress strip, the banner, and a side-panel layout. Finish & Export resolves the presigned link. |
| `src/api/auth.js` | Added `signUp`, `signIn`, `signOut`, `getSession`, `onAuthChange`, `refreshSession`, and `readableAuthError`. The token reader it already had is unchanged. |
| `src/api/client.js` | Response interceptor refreshes once on 401 and replays the request. Holds CRUD added (`getHolds`, `createHoldsBulk`, `createHold`, `updateHold`, `deleteHold`). `exportVideo` no longer sends `?delete_video`. `getExportDownloadUrl` reads the 307 `Location` instead of expecting a body. `getVideoCsvText` fetches the CSV with auth. |
| `src/api/ExportService.js` | Reduced to a re-export of the client's implementations, so the two existing import sites keep working. |
| `src/components/MoveForm.jsx` | **Rewritten.** A right-side `<aside>` panel instead of a full-screen modal. Four hold slots, each with its own hold type, hold qualities, and "pick on video". Auto-suggest on open. Every option carries its definition. `timing`, `dyno_style`, `tags` and `foot_cut` removed; `confidence` added. Config comes from the store rather than a second fetch. |
| `src/components/VideoPlayer.jsx` | **Rewritten.** Hold overlay wired in, toggled with `H`. CSV fallback now sends the token and follows the 307 (it previously sent no auth and expected a body). **Keyboard guard narrowed** to genuine text entry, so `[` and `]` keep working while the panel is open and a radio has focus. `csvData` derived rather than mirrored into state. |
| `src/components/TaggingMode.jsx` | `traction_sources` / `traction_source` / `traction_direction` removed — all dropped in v3, and the component would have failed its own config validation against the live backend. Config from the store. Banner and tag-type definitions added. |
| `src/components/ThankYouModal.jsx` | Shows the presigned download link, says it expires, and distinguishes a failed export from a failed link. |
| `src/components/VideoUpload.jsx` | After register + upload, runs detection on the first frame (when enabled), posts the boxes in bulk, and loads holds into the store. Entirely best-effort. |
| `src/store/useStore.js` | `previousEnvironment` moved to the four-slot v3 shape (`hold_id` deliberately never carries over). Added holds, overlay toggle, pick slot, `dismissedBanners`, `session`, and `resetForSignOut`. |
| `src/App.css` | ~290 lines for the auth screen, progress strip, banners, tooltips, panel layout, hold overlay, and a narrow-screen stack. |
| `vite.config.js` | Marks `onnxruntime-web` external when detection is off — see §C4. |
| `package.json` | Added `onnxruntime-web`; vitest + testing-library + jsdom. `npm test` now runs both suites. |

### Backend (only the three areas the brief allowed)

| File | Change |
|---|---|
| `src/labeling/models.py` | `DEFINITIONS` — plain-language descriptions for all 11 taxonomies, plus `display_label` on `reach_details`. |
| `src/web/api.py` | `/api/config` serves `definitions`. New `POST /api/videos/{id}/holds` (bulk, capped at 200) and `PUT /api/holds/{id}`. New `HoldItem` / `HoldBulkCreate` / `HoldUpdate` schemas. |
| `src/labeling/database.py` | `create_holds_bulk` (one transaction) and `update_hold` (box and source only — `video_id`/`user_id` are fixed at creation). |

---

## C2. Definitions — the two that were being read backwards

Both are called out explicitly in the UI, not just in the config:

- **Confidence** is *the labeler's confidence in the labels they just gave* — the camera angle, the speed, the taxonomy. Not how confident the climber looked on the wall.
- **Size** is *the size of the movement*. Not the size of the hold.

`reach_details` carries `display_label` so Taylor's preferred wording can land without touching a stored enum value or migrating existing rows. **Taylor's wording is still pending**; the current labels are placeholders chosen to be unambiguous:

| Stored value | Current display | 
|---|---|
| `reached_controlled` | Reached it — in control |
| `reached_not_controlled` | Reached it — not in control |
| `didnt_reach` | Did not reach it |

---

## C3. Defaults taken

1. **Config is loaded once, in `App`, after sign-in**, and read from the store by everything else. `MoveForm` and `TaggingMode` each used to fetch it independently.
2. **401 refreshes once and replays.** A second 401 propagates and the auth listener shows the sign-in screen. Guarded against a loop by a flag on the request.
3. **Banner dismissal is session-only**, per the brief — no localStorage. A test asserts nothing is written there.
4. **`hold_id` never carries over between moves.** Hold *type* and *quality* prefill from the previous move; the id would point at the wrong box.
5. **Hold deletes are optimistic**, and roll back if the server refuses.
6. **Suggestions are marked `suggested` until touched.** Any edit to a slot clears the flag. A wrong guess is visible rather than silently adopted.
7. **A distance cap (0.15 of the frame) means no suggestion rather than a wrong one.**
8. **The `foot` slot is optional**; `start_left`, `start_right` and `end` require a hold type unless the move is tagged No Hands.
9. **Empty slots are sent as `{}`**, which is how v3 expresses no-hands, one-hand and no-feet moves.
10. **Finish & Export does not block on the download link.** A failed link is reported as such; the labels are saved either way.

---

## C4. The hold detector: source, licence, and why it ships off

**Surveyed 2026-09-13. No permissively-licensed climbing-hold model exists.**

| Model | Licence | Signal | Files |
|---|---|---|---|
| `jwlarocque/yolov8n-freeclimbs-detect-2` | **AGPL-3.0** | 0 downloads, 3 likes | fp16 + fp32 `.onnx`, `.pt` |
| `samolego/yolo-holds` | **AGPL-3.0** | 0 downloads, 0 likes | `.pt` only |
| `ricardosreichert/holds_yolo_v8` | **none declared** (= all rights reserved) | 0 downloads, 0 likes | `.pt` only |

The first is the best technical fit: a single "hold" class, trained on home and spray walls, and it ships ONNX. Its card notes that an earlier MIT label was an error and AGPL-3.0 is binding.

The constraint is **structural, not bad luck**: Ultralytics YOLOv8 is itself AGPL-3.0, so every fine-tune of it inherits the copyleft. "A YOLOv8n-format ONNX with a permissive licence" is close to a contradiction in terms today.

Bundling AGPL-3.0 weights into a web frontend would put AGPL obligations on the served application. That is a licensing decision for the project owner, not a default to take quietly — so this takes the fallback the brief specified:

- **The manual flow is complete and is the shipped path.** Drag to add, click to delete, pick-on-video per slot, auto-suggest from the pose data. Nothing about labeling depends on the detector.
- **Detection is behind `VITE_ENABLE_HOLD_DETECTION`, default off, with no weights in the repo.**
- The full onnxruntime-web decode path is written and lazily imported. The flag is written so Rollup folds it, and `vite.config.js` marks the package external when off — the default build is 643 KB with no wasm; flipping the flag on bundles the ~28 MB runtime properly. Both paths verified.

**To enable**, once a model is chosen and its licence accepted:

```bash
# 1. put the .onnx at public/models/holds.onnx (or set VITE_HOLD_MODEL_URL)
# 2. re-check VITE_HOLD_MODEL_INPUT — freeclimbs wants 2560, the default here is 640
# 3.
VITE_ENABLE_HOLD_DETECTION=true npm run build
```

⚠️ The decode path is written against the standard YOLOv8 head (`[1, 4+nc, N]`, xywh in input-space pixels) but **has not been validated against real detector output** — there was no usable model to validate it with. Treat the first run as a bring-up, not a regression test.

---

## C5. Tests

`npm test` runs both suites: **91 tests, 0 failures.**

| Suite | Runner | Tests | Covers |
|---|---|---|---|
| `scripts/test_pose_math.mjs` | `node --test` | 25 | Pre-existing: fps detection, frame math, CSV shaping |
| `src/services/holdAssignment.test.js` | vitest | 27 | Nearest-box assignment with synthetic landmarks and boxes |
| `src/components/MoveForm.test.jsx` | vitest | 15 | Four hold slots, definitions, panel layout |
| `src/components/AuthGate.test.jsx` | vitest | 8 | Sign in / sign up / validation / errors |
| `src/components/OnboardingBanner.test.jsx` | vitest | 7 | Copy, dismissal, session-only persistence |
| `src/utils/progress.test.js` | vitest | 9 | Progress strip counts |

The assignment tests lay out a 1000×1000 frame with holds on a grid so every expectation is obvious on sight, and cover both CSV widths, the visibility floor, the distance cap, ties, and pose-less frames.

**Three bugs the tests found and fixed:**
1. `InfoTip` toggled on click while hover had already opened it — clicking the "i" made the definition vanish under the cursor. Hover and pin are now separate state.
2. The build emitted onnxruntime-web's ~28 MB wasm as an orphan asset even with detection disabled.
3. Node 22's partial built-in `localStorage` shadows jsdom's and has no `clear()`, which matters because a test asserts we never write there. The setup installs a complete one.

`npm run build` passes. New and rewritten files lint clean; `MovesList.jsx` and `SkeletonOverlay.jsx` carry pre-existing lint errors that were not in scope.

---

## C6. What is NOT done

- **Backend tests were not run.** They require a throwaway Postgres and their migration drops and recreates the labeling tables; the only `DATABASE_URL` to hand is the live Supabase project. `/api/config` touches no DB and was verified directly through `TestClient` (route table, definitions coverage, and that bad input is rejected before any DB access). **The holds endpoints have not been exercised against a real database** — run the backend suite against a scratch Postgres before merging.
- **Nothing was run in a browser.** No dev server, no manual click-through. §C10 is the checklist for that.
- **`MovesList.jsx` was not updated.** It renders moves from the list and was not part of the brief, but it reads `move.tags` in one place, which v3 removed. Worth a look during QA.
- **The detector is unvalidated** — see §C4.

---

## C7. Railway

`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set on
`steadfast-vitality` / **`Data_collection_climbing`** / `production` — the
frontend service, which serves `collect.dynalytix.net`.

- Both piped through `railway variables --set-from-stdin` with `--skip-deploys`. No value was printed at any point; verified by name and length only (40 and 208 characters, matching `backend/.env`).
- Values come from the new dedicated Supabase project (`nbqtgknayvsjkevaoeef`), not the old shared `login_system` one.
- `VITE_API_URL` was already set and needed no change.
- **Nothing was deployed**, and `adorable-integrity` was not touched — it still has zero `VITE_` variables and the same deployment id as before this session.

---

## C8. Local `.env`

`data_collection/frontend/.env` was copied from the original checkout and is **not committed** (`.gitignore` covers it). Its two Supabase values were placeholders — 19 and 24 characters, left over from an earlier project — so they were replaced with the real ones from `backend/.env`. Anyone else setting this branch up locally needs to do the same, or sign-in will fail against the wrong project.

---

## C9. ⚠️ Merge blocker: overlap with feat/pose-extractor-v2

**`feat/pose-extractor-v2` gained three commits while this branch was in flight**, after this worktree was cut from `fcd6830`:

| Commit | What it does | Why it matters here |
|---|---|---|
| `d6b8bbc` | Widens the pose CSV to all **33** MediaPipe landmarks (75 → 147 columns), adding `*_index` fingertip and `*_foot_index` toe points | The brief's "33-landmark CSV" was right about where the repo was heading. The first 75 columns are byte-identical, so nothing here breaks. |
| `cd75a9a` | Rounds CSV coordinates; overlay draws 15 joints | No conflict. |
| `4eb637d` | Adds `src/services/holdMatching.js` (**tested but explicitly NOT WIRED UP**), `normalizeLandmark` in poseMath, and a migration persisting video dimensions | **Direct overlap with this branch's step 7.** |

This branch could not merge that forward (the merge was blocked in this session), so instead `holdAssignment.js` was made correct against **both** CSV widths and deliberately converged onto their design:

- Each slot walks a preference list — fingertip before wrist, toe before heel before ankle — so the 33-landmark CSV improves suggestions for free and the 15-landmark one still works.
- `nearestHold` measures point-to-rectangle with 0 inside the box, matching their `distanceToBox`. They are right about why: with centre distance, a big hold the hand is resting *inside* loses to a small hold further away.

**Before merging, someone must reconcile the two modules into one.** They solve the same problem:

| | `holdMatching.js` (theirs) | `holdAssignment.js` (this branch) |
|---|---|---|
| Layer | Primitives: `distanceToBox`, `isInsideBox`, `nearestHold`, `nearestHoldsFor`, `CONTACT_LANDMARKS` | Slot policy: `suggestHoldSlots`, `reachingSide`, preference lists |
| Wired up | No | Yes — `MoveForm` auto-suggest |
| Units | Takes pixels + frame size, normalizes internally | Same, via `normalizedLandmark` |

Recommended: **keep their primitives, keep this branch's policy layer, delete the duplicated distance code here.** The convergence above was done specifically to make that a deletion rather than a rewrite. Their `nearestHold` returns `{hold, distance, inside, index}` where this one returns the hold, so the policy layer needs a one-line adaptation.

Also worth taking from their side: the **video-dimensions migration**. Auto-suggest needs the source resolution to normalize pixel landmarks, and currently bails out (suggesting nothing) when `currentVideo.width` / `.height` are absent — which is the state on this branch. **Until that migration and the field that feeds it are merged, auto-suggest will silently suggest nothing.** Manual picking is unaffected.

---

## C10. Cutover runbook — backend §9 and this branch, merged

This supersedes §9 of `backend/REPORT.md`. The governing fact is unchanged:

> `adorable-integrity` (backend) **and** `Data_collection_climbing` (frontend) both auto-deploy from **`main`**, with **Wait for CI off**. A push to `main` deploys both within seconds. There is no staging gate.

**Therefore: do not merge any of these branches alone. Merge backend + pose-extractor-v2 + this branch to `main` in one go.**

### Before the merge

- [ ] **Reconcile `holdMatching.js` and `holdAssignment.js` into one module** (§C9). Nothing else in this list matters if two modules are computing nearest-hold differently.
- [ ] **Merge the video-dimensions migration** and confirm `currentVideo` carries `width`/`height`, or auto-suggest stays silent (§C9).
- [ ] Run the **backend suite against a scratch Postgres** — `TEST_DATABASE_URL=<throwaway>`. It drops and recreates the labeling tables, so never point it at production. The holds endpoints added here have not been exercised against a real database.
- [ ] Confirm the frontend is complete against the §7 contract: bearer token on every `/api` call, JSON register, three-step presigned upload, four-slot environment, `foot_cut`/`timing`/`dyno_style`/`traction_*` gone, 307s followed. *(Done on this branch — re-verify after the merge resolves conflicts.)*
- [ ] `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` point at the **new** project `nbqtgknayvsjkevaoeef`. *(Done — §C7.)*
- [ ] Someone can sign in on the new Supabase project. **It has no users beyond the two `smoke-test-*@dynalytix.test` accounts** — decide whether sign-ups are open, or create the labelers' accounts by hand. Check whether email confirmation is on: if it is, `AuthGate` will say so and nobody gets in until they click the link.
- [ ] Decide about the old data. Nothing is migrated — schema v3 starts empty by design. Old SQLite labels on the Railway disk are already lost on every redeploy; exports live in the `dynalytix-data` GitHub repo.
- [ ] Decide on the detector (§C4): accept AGPL-3.0, find a permissive model, or leave it off. **Leaving it off is a complete product** — every hold can be placed by hand.

### The merge

- [ ] Merge all three branches to `main` in a single merge. Both services rebuild automatically; watch both in the Railway dashboard.

### Immediately after

- [ ] Unset the retired backend variables (left in place so the old build's GitHub sync kept working):
      ```bash
      cd data_collection/backend
      railway variables delete GITHUB_TOKEN --service adorable-integrity --environment production --skip-deploys
      railway variables delete DATA_REPO   --service adorable-integrity --environment production
      ```
- [ ] Backend health:
      ```bash
      curl https://adorable-integrity-production.up.railway.app/api/health
      # expect {"status":"ok","database":"ok","r2":"ok","schema_version":3}
      ```
      `r2` must read `ok`, not `not configured`. `/api/config` returning 401 without a token is correct.
- [ ] Smoke test against the deployment:
      ```bash
      set -a && . ./.env && set +a
      python scripts/smoke_test.py --url https://adorable-integrity-production.up.railway.app
      # expect 35 passed, 0 failed
      ```
- [ ] Truncate afterwards so smoke-test rows do not pollute the first real session:
      ```bash
      psql -d "$DATABASE_URL" -c "TRUNCATE frame_tags, outcomes, environments, moves, holds, videos RESTART IDENTITY CASCADE;"
      ```
- [ ] Walk §C11 end to end on `collect.dynalytix.net`.

### Worth doing soon after

- [ ] **Narrow CORS.** Both `api.py` (`allow_origins=["*"]`) and the R2 bucket rule are wide open. Tighten to `["https://collect.dynalytix.net", "http://localhost:5173"]`.
- [ ] **Consider turning off auto-deploy from `main`,** or point production at a release branch. With Wait for CI off, any push to `main` ships straight to a live service.
- [ ] Delete the two `smoke-test-*@dynalytix.test` users if you would rather not keep them.
- [ ] Retire the old storage: `data/labels.db`, `data/*.csv`, `data/exports/`, `videos/`, and the `dynalytix-data` repo.
- [ ] Rotate the R2 token if you would rather it had never passed through an agent session.
- [ ] Update `MovesList.jsx`, which still reads the removed `move.tags` (§C6).

### If it goes wrong

Railway keeps previous deployments: open the service → Deployments → pick the `7be1840` build → Redeploy. That restores the old backend. Supabase and R2 are separate and unaffected by a rollback.

---

## C11. Manual QA — your first session as a labeler

Walk this in one sitting, on a real climbing clip. Each step says what you should see, so a wrong result is obvious.

**Setup**

```bash
cd data_collection/backend && uvicorn src.web.api:app --reload   # one shell
cd data_collection/frontend && npm run dev                       # another
```

`.env` must hold the real Supabase values (§C8), or sign-in fails against the wrong project.

### 1. Sign up
- [ ] Open the app signed out. You get the **sign-in screen**, not a spinner and not a blank page.
- [ ] Choose **Sign up**, enter an email and a password under 6 characters → it refuses locally, without a network call.
- [ ] Sign up properly. Either you land in the app, or you are told to confirm your email — no silent nothing.
- [ ] **Reload the page.** You stay signed in.
- [ ] Your email and **Sign out** are in the header. Sign out, confirm you are back at the gate, sign in again.

### 2. Upload
- [ ] Pick a climbing video. Progress runs; the tab-switch warning appears.
- [ ] When it finishes you land on the player with the **skeleton drawn over the climber**. If the skeleton is offset or shrunken, stop — that is the coordinate bug, not a UI issue.
- [ ] The header strip reads **0 moves defined · 0 labeled · 0 tagged**.
- [ ] The define banner reads *"Set the start frame with [, the end frame with ], then Create Move."* Dismiss it; it stays gone. Reload; it comes back (session-only, by design).

### 3. Holds
- [ ] Press **H** or click Show Holds. Detection is off by default, so expect **zero boxes** — that is correct, not a failure.
- [ ] **Drag on the video** over a hold. A box appears and persists.
- [ ] Add three or four more, on the holds your climber actually uses.
- [ ] **Click a box.** It disappears. Reload the page — it stays gone.

### 4. Define a move
- [ ] Scrub to where a move starts, press **`[`**. Scrub to where it ends, press **`]`**. Markers appear on the timeline.
- [ ] Click **Create Move**. The form opens **beside the video, not over it**.
- [ ] **With the panel open, press `[` and `]` again, and the arrow keys.** They must still work — this is the whole point of the panel. If focus is in the Description box they correctly do not.

### 5. Label it
- [ ] All four hold slots are there: Start Left, Start Right, End, and Foot marked optional.
- [ ] Hover an **"i"** next to a hold type. The definition appears. Try one on Confidence — it should say it is *your* confidence in the labels, not the climber's. Try Size — the size of the *movement*.
- [ ] On Start Left, click **Pick on video**. The button activates and the video shows a hint. **Click a box** — it is assigned, and the button returns to normal. Press **Esc** during pick mode to confirm it cancels.
- [ ] Give each of the three required slots a hold type; tick a couple of qualities.
- [ ] Under Reach Detail the options read as sentences ("Reached it — in control"), not `Reached Not Controlled`.
- [ ] Try **Save Move** with a required slot empty → it names the missing slot rather than failing silently.
- [ ] Fill it in and save. The panel closes and the strip reads **1 move defined · 1 labeled · 0 tagged**.

*(If the slots arrive pre-filled and marked **suggested**, auto-suggest is working. On this branch it will most likely suggest nothing, because the video-dimensions migration has not merged — see §C9. That is expected, not a bug, and manual picking is unaffected.)*

### 6. Define a second move
- [ ] Mark `[` and `]` again and open the form. **Wall angle and the hold types/qualities prefill** from the previous move; the hold assignments do **not**.
- [ ] Save it. The strip reads **2 moves defined**.

### 7. Tag
- [ ] Pick a move from the list to enter tagging mode.
- [ ] The banner reads *"Use the scroll bar to find the frame, then tag it."*
- [ ] Scrub to a frame and add a sensation tag. Hover its **"i"** — the definition appears.
- [ ] The tag shows on the timeline. The strip's **tagged** count goes up.
- [ ] Confirm there is **no Traction Source or Traction Direction field** anywhere — removed in v3.

### 8. Export and download
- [ ] Click **Finish & Export**.
- [ ] The modal offers **"Download the labeled CSV"** as a link, and says the link expires.
- [ ] Click it. The CSV downloads.
- [ ] **Open it.** Confirm your moves are there with the four hold slots, and that the pose columns are intact.

### 9. The awkward cases
- [ ] Tag a move **No Hands** → the three hand slots disappear, Foot stays. Save it; it should be accepted with empty hand slots.
- [ ] Sign out mid-session, sign back in → you are returned to a clean upload screen, not a half-populated one.
- [ ] Leave the app open long enough for the access token to expire (an hour), then save a move. It should **refresh and succeed**, not throw you back to the sign-in screen.

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
6. **CSV contract kept as shipped** (75 columns, 15 landmarks, 12 angles) rather than
   the 33-landmark/10-angle shape named in the brief. See §1.4 — this is the one place
   the brief and the code disagreed, and the code won. Raise it if that was wrong.
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
