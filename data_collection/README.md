# Dynalytics - Data Collection UI

Web interface for labeling climbing movement data.

## Overview

This UI allows you to:
1. Upload climbing videos (automatically processed for pose data)
2. Define move boundaries (e.g., frames 150-200)
3. Label moves with type, quality, and effort level
4. Tag specific frames with sensations (pain, instability, weakness)
5. Export labeled training data as CSV

## Current Status

### Working
- Video upload with automatic pose extraction
- Video player with frame-by-frame controls
- Keyboard shortcuts (←/→, Space, [, ])
- Timeline with move markers
- Backend API connection
- MovesList- Display completed moves
- MoveForm - Two-step form with contextual questions per move type
- TaggingMode - Cropped video with frame tagging (P/I/W shortcuts)

### To build
- **Undo/Redo** - For tagging actions
- **skeleton diagram accuracy** - Improve pose overlay precision
- **Export** - Download labeled CSV

### Setup

**Start Backend:**
```bash
cd data_collection/backend
source ../../venv/bin/activate
uvicorn src.web.api:app --reload
```

**Start Frontend:**
```bash
cd data_collection/frontend
npm run dev
```

Backend: `http://localhost:8000`  
Frontend: `http://localhost:5173`

---

## UI Prototype

### Main View (Define Moves)
```
┌─────────────────────────────────────────────────────────────────────┐
│  Dynalytics - Data Collection                    [Upload Video] [?] │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  VIDEO: climb_gym_session.mov (45s, 1350 frames)                   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                                                             │   │
│  │                    [Video Player]                           │   │
│  │                                                             │   │
│  │                  (Current Frame: 425)                       │   │
│  │                                                             │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                    │
│  Timeline:                                                         │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │░░░░░[===M1===]░░░░░░░[====M2====]░░░░░[==M3==]░░░░░░░░░░░░  │   │
│  │    150    200      350      420     600   650               │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                    │
│  [◀◀] [◀] [▶] [▶▶]  Frame: 425/1350 (14.17s)  Speed: [1x ▼]        │
│                                                                    │
│  Selection: None                                                   │
│  [Mark Start '[']  [Mark End ']']  [Clear Selection]               │
│                                                                    │ 
├─────────────────────────────────────────────────────────────────────┤
│  COMPLETED MOVES                                   [Export All CSV] │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ ✓ Move 1: Dyno (frames 150-200, 1.67s)                     │   │
│  │   Quality: ●●●●○  Effort: 7/10  Tags: 2 frames             │   │
│  │   [View Details] [Edit Move] [Add Frame Tags]              │   │
│  ├─────────────────────────────────────────────────────────────┤   │
│  │ ✓ Move 2: Static (frames 350-420, 2.33s)                   │   │
│  │   Quality: ●●●○○  Effort: 5/10  Tags: 1 frame              │   │
│  │   [View Details] [Edit Move] [Add Frame Tags]              │   │
│  ├─────────────────────────────────────────────────────────────┤   │
│  │ ✓ Move 3: Drop knee (frames 600-650, 1.67s)                │   │
│  │   Quality: ●●●●●  Effort: 9/10  Tags: 3 frames             │   │
│  │   [View Details] [Edit Move] [Add Frame Tags]              │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  [+ New Move]                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

### Move Form (After marking boundaries)

#### Step 1: Select Move Type
```
┌─────────────────────────────────────────────────────────────────────┐
│  Define Move: Frames 150-200 (1.67s)                    [X] Close  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Move Type:                                                         │
│  ┌─────────────────────────────────────────────┐                   │
│  │ Dyno                                    ▼   │                   │
│  └─────────────────────────────────────────────┘                   │
│  Options:  Lock-off, Dyno, Deadpoint, Mantle, Drop knee,           │
│                                                                     │
│                                              [Next: Move Details]   │
└─────────────────────────────────────────────────────────────────────┘
```

#### Step 2: Move-Specific Questions (Example: Dyno selected)
```
┌─────────────────────────────────────────────────────────────────────┐
│  Move: Dyno (Frames 150-200)                         [← Back] [X]   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Which hand caught the target hold?                                 │
│  ○ Left hand    ●Right hand    ○ Both hands    ○ Missed             │
│                                                                     │
│  Which foot pushed off?                                             │
│  ●Left foot     ○ Right foot   ○ Both feet                          │
│                                                                     │
│  Contact points at launch:                                          │
│  [✓] Left hand   [✓] Right hand                                     │
│  [✓] Left foot   [ ] Right foot                                     │
│                                                                     │
│  Body position:                                                     │
│  ○ Square to wall    ●turned in left    ○ Turned in right           │
│                                                                     │
│  Form Quality:                                                      │
│  [ 1 ]  [ 2 ]  [ 3 ]  [●4●]  [ 5 ]                                  │
│  Poor                      Excellent                                │
│                                                                     │
│  Overall Effort Level:                                              │
│  0 ━━━━━━━●━━━ 10                                                   │
│     Easy        (7)        Maximal                                  │
│                                                                     │
│  Quick Tags:                                                        │
│  [✓] Tweaky feeling      [ ] Flash pump       [ ] Mental block      │
│  [ ] Good technique      [✓] Controlled       [ ] Scary             │
│                                                                     │
│  Description (500 chars):                                           │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ Big move from left foot, pushed hard through left leg.        │  │
│  │ Right hand catch felt solid. Hip position was good but        │  │
│  │ left knee felt a bit tweaky on the push. Might need to        │  │
│  │ work on hip external rotation strength.                       │  │
│  │                                                               │  │
│  │ Characters: 187/500                                           │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│                          [Cancel]  [Save Move]                      │
└─────────────────────────────────────────────────────────────────────┘
```

#### Move-Specific Questions Examples

**Lock-off:**
```
│  Which arm was the lock-off on?                                     │
│  ●Left arm      ○ Right arm    ○ Both arms                          │
│                                                                     │
│  Contact points during lock-off:                                    │
│  [✓] Left hand   [✓] Right hand                                     │
│  [✓] Left foot   [✓] Right foot                                     │
│                                                                     │
│  How long held (estimate):                                          │
│  ○ <1 sec    ●1-3 sec    ○ 3-5 sec    ○ >5 sec                      │
```

**Drop Knee:**
```
│  Which knee dropped?                                                │
│  ●Left knee     ○ Right knee                                        │
│                                                                     │
│  Hip rotation:                                                      │
│  ○ Internal    ●External    ○ Neutral                               │
│                                                                     │
│  Contact points:                                                    │
│  [✓] Left hand   [✓] Right hand                                     │
│  [✓] Left foot   [✓] Right foot (dropped)                           │
```

**Static:**
```
│  Which hand reached?                                                │
│  ○ Left hand    ●Right hand    ○ Both hands                         │
│                                                                     │
│  Supporting leg:                                                    │
│  ●Left foot     ○ Right foot   ○ Both feet                          │
│                                                                     │
│  Other leg position:                                                │
│  ○ On hold    ●Flagged left    ○ Flagged right    ○ Dangling        │
│                                                                     │
│  Contact points:                                                    │
│  [✓] Left hand   [✓] Right hand                                     │
│  [✓] Left foot   [ ] Right foot (flagged)                           │
```

**Deadpoint:**
```
│  Which hand reached?                                                │
│  ○ Left hand    ●Right hand    ○ Both hands                         │
│                                                                     │
│  Push foot:                                                         │
│  ●Left foot     ○ Right foot   ○ Both feet                          │
│                                                                     │
│  Contact at peak:                                                   │
│  [ ] Left hand   [✓] Right hand (reaching)                          │
│  [ ] Left foot   [ ] Right foot (both off at peak)                  │
```

**Mantle:**
```
│  Which side mantled first?                                          │
│  ○ Left side    ●Right side    ○ Both together                      │
│                                                                     │
│  Starting position:                                                 │
│  ○ Below hold    ●Level with hold    ○ Above hold                   │
│                                                                     │
│  Contact points at top:                                             │
│  [✓] Left hand   [✓] Right hand                                     │
│  [✓] Left knee   [ ] Right knee                                     │
```

### Frame Tagging Mode (After clicking "Add Frame Tags")
```
┌─────────────────────────────────────────────────────────────────────┐
│  Frame Tagging: Move 1 - Lock-off to dyno               [← Back]    │
│  Frames 150-200 (1.67s) - Video loops this section                  │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                                                             │   │
│  │                    [Video Player]                           │   │
│  │                  (Cropped to Move 1)                        │   │
│  │                  (Auto-looping 150-200)                     │   │
│  │                                                             │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                    │
│  Timeline (Move 1 only):                                           │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │░░P░░░░░░I░░░░░░░░░T░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│  │   |
│  │  155    165     178                                         │   │
│  │  Pain   Weak    Inst                                        |   |
│  │  (6)    (4)     (8)                                         │   │
│  └─────────────────────────────────────────────────────────────┘   │
│  150                                                           200 │
│                                                                    │
│  [◀] [▶]  Frame: 165/200 (relative: 15/50)  [Space] to play        │
│                                                                    │
│  Quick Tag Shortcuts:                                              │
│  [P] Pain  [I] Instability  [W] Weakness  [T] Technique  [F] Slip  │
│                                                                    │
│  ┌─ Tagged Frames in This Move ─────────────────────────────────┐  │
│  │ • Frame 155 (5.17s): Pain - Level 6/10                       │  │
│  │   Location: Left knee                      [Edit] [Delete]   │  │
│  │                                                              │  │
│  │ • Frame 165 (5.50s): Weakness - Level 4/10                   │  │
│  │   Location: Left shoulder, Forearms        [Edit] [Delete]   │  │
│  │                                                              │  │
│  │ • Frame 178 (5.93s): Instability - Level 8/10                │  │
│  │   Location: Left ankle                     [Edit] [Delete]   │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                    |
│                                              [Done Tagging]        │
└────────────────────────────────────────────────────────────────────
```

### Frame Tag Popup (When pressing 'P' for Pain)
```
┌────────────────────────────────────┐
│  Pain Tag - Frame 155              │
├────────────────────────────────────┤
│                                    │
│  Pain Level:                       │
│  0 ━━━━━━●━━━ 10                   │
│     None    (6)    Severe          │
│                                    │
│  Location (select all that apply): │
│  [✓] Left knee    [ ] Right knee   │
│  [ ] Left ankle   [ ] Right ankle  │
│  [ ] Left hip     [ ] Right hip    │
│  [ ] Lower back   [ ] Upper back   │
│  [ ] Left shoulder [ ] Right shoulder │
│  [ ] Core         [ ] Other: _____ │
│                                    │
│  Optional note:                    │
│  ┌──────────────────────────────┐  │
│  │ Sharp pain when knee         │  │
│  │ collapsed inward             │  │
│  └──────────────────────────────┘  │
│                                    │
│      [Cancel]  [Save Tag]          │
└────────────────────────────────────┘
```

## Setup

### Prerequisites
- Node.js 18+ and npm
- Backend API running on `http://localhost:8000`

### Installation

```bash
cd frontend
npm install
```

### Development

```bash
npm run dev
```

Then open http://localhost:5173

**Important:** The backend must be running for the UI to work:
```bash
# In the root directory
uvicorn src.web.api:app --reload --port 8000
```

## Tech Stack

- **React 18** - UI framework
- **Vite** - Build tool and dev server
- **Tailwind CSS** - Styling
- **react-player** - Video playback
- **axios** - API calls

## Project Structure

```
frontend/
├── src/
│   ├── components/
│   │   ├── VideoPlayer.jsx      # Video playback with frame scrubbing
│   │   ├── MoveForm.jsx          # Form for move-level labels
│   │   ├── FrameTagPopup.jsx     # Quick popup for tagging frames
│   │   ├── Timeline.jsx          # Visual timeline with markers
│   │   ├── MovesList.jsx         # List of completed moves
│   │   └── FrameTagsList.jsx     # Tags within current move
│   ├── App.jsx                   # Main app component
│   ├── main.jsx                  # Entry point
│   └── api.js                    # API client functions
├── public/
├── package.json
├── vite.config.js
└── README.md
```

## Usage Workflow

### Step 1: Upload Video
1. Click "Upload Video"
2. Select a `.mov` or `.mp4` file
3. Wait for pose extraction to complete (progress bar shown)
4. Video appears in the player with full timeline

### Step 2: Define Moves
1. Watch the video to identify distinct moves
2. Scrub to where a move starts
3. Click "Mark Start" (or press `[`)
4. Scrub to where the move ends
5. Click "Mark End" (or press `]`)
6. Move form appears - fill out:
   - **Move Type**: Static, Lock-off, Dyno, Deadpoint, etc.
   - **Form Quality**: 1-5 rating
   - **Overall Effort**: 0-10 slider
   - **Tags**: Quick tags like "Tweaky feeling", "Flash pump"
   - **Description**: Detailed text about the move (500 chars)
7. Click "Save Move"
8. Move appears in the "Completed Moves" list

### Step 3: Tag Frames Within Move
1. Click "Add Frame Tags" on a move in the list
2. UI switches to **tagging mode**:
   - Video crops to just that move's frame range
   - Video loops continuously for easy review
3. Scrub through and press keyboard shortcuts when you notice sensations:
   - Press `P` for pain
   - Press `I` for instability
   - Press `W` for weakness/fatigue
4. Quick popup appears to capture:
   - Level (0-10 slider)
   - Location (body part checkboxes)
5. Tag appears on timeline
6. Repeat for all notable moments in the move
7. Click "Done Tagging" to return to main view

### Step 4: Repeat for All Moves
Continue defining moves and tagging frames until you've labeled all interesting sequences in the video.

### Step 5: Export
Click "Export Labeled Data" to download a CSV with:
- Original angle data from pose extraction
- Move-level labels (type, quality, effort, description)
- Frame-level sensation tags (pain, instability, weakness with precise locations)

## Keyboard Shortcuts

### Video Navigation
- `Arrow Left` - Previous frame
- `Arrow Right` - Next frame
- `Space` - Play/Pause
- `J` - Rewind 10 frames
- `L` - Forward 10 frames

### Move Definition
- `[` - Mark move start
- `]` - Mark move end
- `Escape` - Clear selection

### Frame Tagging (when in tagging mode)
- `P` - Add pain tag
- `I` - Add instability tag
- `W` - Add weakness tag
- `T` - Add "good technique" tag
- `F` - Add "foot slip" tag

### General
- `Ctrl+Z` - Undo last tag (coming soon)
- `Ctrl+S` - Save current work

## Data Model

### Move
```javascript
{
  id: 1,
  videoId: 1,
  frameStart: 150,
  frameEnd: 200,
  moveType: "lock_off_to_dyno",
  formQuality: 4,
  effortLevel: 7,
  tags: ["tweaky_feeling", "recovery_move"],
  description: "Setup felt unstable at the start..."
}
```

### Frame Tag
```javascript
{
  id: 1,
  moveId: 1,
  frameNumber: 155,
  timestampMs: 5166.7,
  tagType: "pain",
  level: 6,
  locations: ["left_knee"]
}
```

## Development Notes

### Move Type Configuration

Each move type has its own set of contextual questions defined in `src/components/MoveForm.jsx`:

```javascript
const MOVE_TYPE_QUESTIONS = {
  dyno: {
    catching_hand: ['left_hand', 'right_hand', 'both_hands', 'missed'],
    push_foot: ['left_foot', 'right_foot', 'both_feet'],
    contact_at_launch: ['left_hand', 'right_hand', 'left_foot', 'right_foot'],
    body_position: ['square', 'side_on', 'turned_away']
  },
  lock_off: {
    lock_off_arm: ['left_arm', 'right_arm', 'both_arms'],
    contact_points: ['left_hand', 'right_hand', 'left_foot', 'right_foot'],
    hold_duration: ['<1sec', '1-3sec', '3-5sec', '>5sec']
  },
  drop_knee: {
    dropped_knee: ['left_knee', 'right_knee'],
    hip_rotation: ['internal', 'external', 'neutral'],
    contact_points: ['left_hand', 'right_hand', 'left_foot', 'right_foot']
  },
  static: {
    reaching_hand: ['left_hand', 'right_hand', 'both_hands'],
    supporting_leg: ['left_foot', 'right_foot', 'both_feet'],
    other_leg_position: ['on_hold', 'flagged_left', 'flagged_right', 'dangling'],
    contact_points: ['left_hand', 'right_hand', 'left_foot', 'right_foot']
  },
  deadpoint: {
    reaching_hand: ['left_hand', 'right_hand', 'both_hands'],
    push_foot: ['left_foot', 'right_foot', 'both_feet'],
    contact_at_peak: ['left_hand', 'right_hand', 'left_foot', 'right_foot']
  },
  mantle: {
    mantle_side: ['left_side', 'right_side', 'both_together'],
    starting_position: ['below_hold', 'level_with_hold', 'above_hold'],
    contact_at_top: ['left_hand', 'right_hand', 'left_knee', 'right_knee']
  }
};
```

To add a new move type:
1. Add it to the `MOVE_TYPES` array
2. Define its contextual questions in `MOVE_TYPE_QUESTIONS`
3. The form will automatically render the appropriate fields

### Adding New Tag Types
Edit keyboard shortcuts in `src/components/VideoPlayer.jsx`:


### Customizing Body Part Locations
Edit the locations list in `src/components/FrameTagPopup.jsx`:

```javascript
const BODY_PARTS = [
  "left_shoulder", "right_shoulder",
  "left_elbow", "right_elbow",
  "left_knee", "right_knee",
  // Add more body parts here
];
```

## API Endpoints Used

```
POST /api/videos/upload          - Upload and process video
GET  /api/videos                 - List all videos
GET  /api/videos/{id}            - Get video details
GET  /api/videos/{id}/moves      - Get all moves for video
POST /api/moves                  - Create new move
PUT  /api/moves/{id}             - Update move
GET  /api/moves/{id}/frame-tags  - Get frame tags for move
POST /api/frame-tags             - Create frame tag
DELETE /api/frame-tags/{id}      - Delete frame tag
GET  /api/videos/{id}/export     - Export labeled CSV
```

## Troubleshooting

### Video won't play
- Check that video file is in a supported format (.mov, .mp4)
- Verify backend is serving video files from `/videos` endpoint
- Check browser console for CORS errors

### Frame scrubbing is inaccurate
- This is a known limitation of HTML5 video
- Accuracy is typically ±1 frame, which is acceptable for MVP
- For frame-perfect accuracy, consider pre-extracting frames during processing

### Tags not appearing on timeline
- Check that `moveId` is correctly set when creating frame tags
- Verify tags are being returned from `/api/moves/{id}/frame-tags`
- Check browser console for errors

### Video loops too fast in tagging mode
- Adjust the loop buffer in `src/components/VideoPlayer.jsx`
- Default is 0.1s buffer at start/end of move

## Future Enhancements

- [ ] Undo/redo functionality
- [ ] Drag to select move boundaries on timeline
- [ ] Visual body diagram for selecting pain locations
- [ ] Multi-video batch upload
- [ ] Search/filter moves by type or tags
- [ ] Analytics dashboard showing pain patterns
- [ ] Export to formats other than CSV (JSON, Parquet)

## Contributing

This is currently a solo project by [@jolieabadir](https://github.com/jolieabadir).

## License

MIT
