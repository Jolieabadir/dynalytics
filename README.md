# Dynalytics

AI-powered movement analysis for climbing injury prevention and rehabilitation.
## Website
https://www.dynalytics.org/

Dynalytics uses computer vision to analyze climbing movement patterns from video, identifying injury risk through joint angle and velocity analysis. The goal is to catch dangerous movement patterns before they lead to pain or injury.

## Mission

Most climbing injuries result from accumulated stress and poor movement patterns that go undetected until pain emerges. Dynalytics aims to change that by providing early detection and personalized feedback based on biomechanical analysis.

## Who is this for?

- **Athletes** looking to prevent injuries and improve movement quality
- **Physical Therapists** working with climbers in rehabilitation
- **Researchers** exploring biomechanics and injury prevention in sports

## How It Works

**Two-Stage AI Model:**

```
Stage 1: Base Model
├─ Trains on diverse climber dataset
├─ Learns general "safe" vs "risky" movement patterns
└─ Recognizes patterns from joint angles & velocity

Stage 2: Personalized Model
├─ Fine-tunes on individual user's movement data
├─ Adapts to their specific body type and style
└─ Provides accurate, personalized feedback
```

The base model provides immediate value, while personalization improves accuracy over time as it learns each user's unique biomechanics.

## Current Status

### Phase 1: Pose Extraction & Analysis ✅
- Real-time pose estimation using MediaPipe
- 12 joint angle calculations per frame
- Velocity and speed tracking (center of mass + all landmarks)
- CSV export with 40 data points per frame
- Live visualization with skeleton overlay

### Phase 2: Data Collection UI ✅
Focus: Building the foundation for quality training data

**Completed:**
- [x] Web-based data collection interface (React + FastAPI)
- [x] Video upload with automatic pose extraction
- [x] Frame-by-frame video scrubbing with keyboard shortcuts
- [x] Move selection (mark start/end frames with `[` and `]` keys)
- [x] Move labeling form (type, quality, effort, contextual details)
- [x] Frame tagging system (sensations: pain, instability, weakness, etc.)
- [x] Body part selection for each tag
- [x] Intensity levels (0-10) for tags
- [x] Skeleton overlay on video
- [x] Moves list with edit/delete functionality
- [x] Export system (merges pose CSV + labels into ML-ready format)
- [x] Auto video deletion after export (storage management)
- [x] Thank you modal on completion
- [x] SQLite database for videos, moves, and frame tags

**Move Types Supported:**
- Static, Deadpoint, Dyno, Lock-off, Gaston, Undercling
- Drop Knee, Heel Hook, Toe Hook, Flag, Mantle, Campus

**Sensation Tags:**
- 🔴 Sharp Pain, 🟠 Dull Pain, 🟣 Pop
- 🟡 Unstable, 🩷 Stretch/Awkward
- 🟢 Strong/Controlled, ⚫ Weak
- 🔵 Pumped, 🟤 Fatigue

### Phase 3: Model Training (Next)
- Base model for movement pattern recognition
- Injury risk classification
- Personalized model fine-tuning
- Real-time feedback system

## Tracked Measurements

### Joint Angles (12 per frame)
| Angle | Points | What it measures |
|-------|--------|------------------|
| Left elbow | shoulder → elbow → wrist | Arm bend |
| Right elbow | shoulder → elbow → wrist | Arm bend |
| Left shoulder | hip → shoulder → elbow | Arm raise relative to torso |
| Right shoulder | hip → shoulder → elbow | Arm raise relative to torso |
| Left hip | shoulder → hip → knee | Leg position relative to torso |
| Right hip | shoulder → hip → knee | Leg position relative to torso |
| Left knee | hip → knee → ankle | Leg bend |
| Right knee | hip → knee → ankle | Leg bend |
| Left ankle | knee → ankle → heel | Foot flex |
| Right ankle | knee → ankle → heel | Foot flex |
| Upper back | left shoulder → shoulder midpoint → right shoulder | Shoulder hunch/openness |
| Lower back | shoulder midpoint → hip midpoint → knee midpoint | Torso arch/round |

### Speed & Velocity
- Center of mass speed and velocity (x, y)
- Individual landmark speeds (15 points)
- Key landmark velocities: wrists and hips (x, y components)

## Tech Stack

**Phase 1 (Complete):**
- Python 3.11
- OpenCV
- MediaPipe
- NumPy

**Phase 2 (Complete):**
- Backend: FastAPI, SQLite
- Frontend: React, Vite, Zustand
- CV: MediaPipe (via Python CLI)

**Phase 3 (Planned):**
- ML: PyTorch
- Database: PostgreSQL (migration from SQLite)
- Infrastructure: Docker, AWS/GCP

## Project Structure

```
dynalytics/
├── src/
│   ├── core/
│   │   ├── landmark.py         # Landmark class (x, y, z, visibility)
│   │   └── angle.py            # Angle calculation (3 points → degrees)
│   ├── pose/
│   │   └── estimator.py        # PoseEstimator (wraps MediaPipe)
│   ├── analysis/
│   │   ├── joint_analyzer.py   # JointAnalyzer (calculates 12 angles)
│   │   └── frame_data.py       # FrameData (holds all frame data)
│   ├── export/
│   │   └── csv_exporter.py     # CSVExporter
│   └── config/
│       └── settings.py         # Settings & thresholds
├── data_collection/
│   ├── backend/                # FastAPI server
│   │   ├── src/
│   │   │   ├── labeling/
│   │   │   │   ├── models.py       # Video, Move, FrameTag dataclasses
│   │   │   │   ├── database.py     # SQLite operations
│   │   │   │   └── exporter.py     # Label + pose CSV merger
│   │   │   └── web/
│   │   │       └── api.py          # REST endpoints
│   │   ├── data/
│   │   │   ├── labels.db           # SQLite database
│   │   │   └── exports/            # ML-ready labeled CSVs
│   │   └── videos/                 # Uploaded videos (temp, deleted after export)
│   └── frontend/               # React app
│       └── src/
│           ├── components/
│           │   ├── VideoUpload.jsx
│           │   ├── VideoPlayer.jsx
│           │   ├── SkeletonOverlay.jsx
│           │   ├── MoveForm.jsx
│           │   ├── MovesList.jsx
│           │   ├── TaggingMode.jsx
│           │   ├── DoneButton.jsx
│           │   └── ThankYouModal.jsx
│           ├── api/
│           │   ├── client.js
│           │   └── ExportService.js
│           └── store/
│               └── useStore.js     # Zustand state management
├── tests/
├── data/                       # Output CSVs (gitignored)
├── videos/                     # Input videos (gitignored)
├── main.py                     # Main analysis script
├── visualizer_live.py          # Live video player with pose overlay
├── requirements.txt
└── README.md
```

## Installation

```bash
git clone https://github.com/jolieabadir/dynalytics.git
cd dynalytics
python3.11 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

> Note: Requires Python 3.11 (MediaPipe doesn't support 3.13+ yet)

## Usage

### CLI: Extract Pose Data

```bash
# Basic usage - outputs angles and speeds to CSV
python main.py path/to/video.mov

# Include raw landmark positions (required for visualization)
python main.py path/to/video.mov --landmarks

# Specify output path
python main.py path/to/video.mov --output my_data.csv
```

### CLI: Visualize Results

After extracting pose data with landmarks, view it with live overlay:

```bash
# Play video with skeleton and angle overlay
python visualizer_live.py path/to/video.mov data/video.csv
```

**Visualization Controls:**
- **SPACE** - Pause/Resume
- **Q** - Quit
- **→** - Skip forward 10 frames
- **←** - Rewind 10 frames

**Visualization Features:**
- 🟢 Green skeleton connecting body joints
- 🟡 Yellow circles on joint points
- 📊 Real-time angle display (6 key angles)
- 🎨 Color-coded speed indicator (low/med/high)

**Options:**
```bash
# Play at 2x speed
python visualizer_live.py video.mov data.csv --speed 2.0

# Hide specific elements
python visualizer_live.py video.mov data.csv --no-skeleton
python visualizer_live.py video.mov data.csv --no-angles
python visualizer_live.py video.mov data.csv --no-speed
```

### Web UI: Data Collection

```bash
# Terminal 1 - Backend
cd data_collection/backend
source ../../venv/bin/activate
uvicorn src.web.api:app --reload --port 8000

# Terminal 2 - Frontend
cd data_collection/frontend
npm install  # first time only
npm run dev
```

Open http://localhost:5173

**Workflow:**
1. Upload a climbing video
2. Mark move boundaries with `[` and `]` keys
3. Fill out move details (type, quality, effort)
4. Enter tagging mode to tag specific frames with sensations
5. Click "Done" to export labeled data and clean up

**Keyboard Shortcuts:**
| Key | Action |
|-----|--------|
| `←` / `→` | Previous/Next frame |
| `Space` | Play/Pause |
| `[` | Mark move start |
| `]` | Mark move end |
| `S` | Toggle skeleton overlay |

## Data Output

### Raw Pose CSV
Each processed video generates a CSV with 40+ columns per frame:
- **Metadata:** frame_number, timestamp_ms
- **Angles:** 12 joint angles in degrees
- **Speeds:** 15 landmark speeds + center of mass
- **Velocities:** x, y components for wrists, hips, center of mass
- **Landmarks:** x, y, z, visibility for 15 body points (with --landmarks flag)

### Labeled Export CSV
After labeling in the UI, exported CSVs include:
- All pose data columns
- `move_id`, `move_type`, `form_quality`, `effort_level`
- `tag_type`, `tag_level`, `tag_locations`, `tag_note`

Example row with labels:
```csv
frame_number,timestamp_ms,...,move_id,move_type,form_quality,effort_level,tag_type,tag_level,tag_locations,tag_note
29,964.01,...,7,lock_off,3,5,weak,5,Left Elbow,
```

## Broader Applications

While currently focused on climbing, the methodology applies to any context where repetitive movement patterns contribute to injury:
- **Sports:** Gymnastics, weightlifting, running, tennis
- **Manual Labor:** Construction, manufacturing, warehouse work
- **Rehabilitation:** Physical therapy movement analysis

## Project Timeline

**Started:** 2023 (initial prototype)
**Rebooted:** 2026 (with improved ML and software engineering)
**Current:** Phase 2 Complete - Data Collection UI
**Next:** Phase 3 - Model Training

## Related Work

- Original prototype: [computervision-climbing](https://github.com/jolie-aba/computervision-climbing) (2023)

## License

MIT

---

Development by [@jolieabadir](https://github.com/jolieabadir)
