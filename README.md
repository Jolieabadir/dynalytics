# Dynalytics

AI-powered movement analysis for climbing injury prevention and rehabilitation.

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

### Phase 2: Data Collection & ML (In Progress)
Focus: Building the foundation for quality training data

**Current Priority:**
- Web-based data collection interface
- Database design for temporal movement sequences
- Structured labeling system for isolated moves
- Understanding optimal data structure for ML training

**Data Collection Approach:**
Users will upload short (2-3 second) clips of isolated moves:
- Example: Right arm lock-off, specific crimp position, dyno catch
- Structured questionnaire: move type, difficulty, pain/discomfort
- Clinical validation through PT collaboration

**Key Metrics:**
- Joint angles (12 per frame)
- Velocity/speed measurements
- Temporal patterns across movement sequences

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

**Current (Phase 1):**
- Python 3.11
- OpenCV
- MediaPipe
- NumPy

**Planned (Phase 2-3):**
- Backend: Flask/FastAPI
- Database: PostgreSQL
- ML: PyTorch
- Frontend: React
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

### Step 1: Extract Pose Data

```bash
# Basic usage - outputs angles and speeds to CSV
python main.py path/to/video.mov

# Include raw landmark positions (required for visualization)
python main.py path/to/video.mov --landmarks

# Specify output path
python main.py path/to/video.mov --output my_data.csv
```

### Step 2: Visualize Results

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

## Data Output

Each processed video generates a CSV with 40 columns per frame:
- **Metadata:** frame_number, timestamp_ms
- **Angles:** 12 joint angles in degrees
- **Speeds:** 15 landmark speeds + center of mass
- **Velocities:** x, y components for wrists, hips, center of mass

Example row (frame with detected pose):
```
frame_number,timestamp_ms,angle_left_elbow,angle_right_elbow,...,speed_center_of_mass,velocity_left_wrist_x,...
42,1400.5,145.2,152.8,...,98.3,12.5,...
```

## Broader Applications

While currently focused on climbing, the methodology applies to any context where repetitive movement patterns contribute to injury:
- **Sports:** Gymnastics, weightlifting, running, tennis
- **Manual Labor:** Construction, manufacturing, warehouse work
- **Rehabilitation:** Physical therapy movement analysis

## Project Timeline

**Started:** 2021 (initial prototype)
**Rebooted:** 2024 (with improved ML and software engineering)
**Current:** Phase 1 complete, Phase 2 in progress
**Next:** Data collection interface and model training

## Related Work

- Original prototype: [computervision-climbing](https://github.com/jolie-aba/computervision-climbing) (2021)

## License

MIT

---

Development by [@jolieabadir](https://github.com/jolieabadir)