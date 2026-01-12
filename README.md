# Dynalytics

Extract and analyze climbing movement from video using computer vision.

Dynalytics processes climbing videos to extract pose data, track body position, and calculate joint angles — building a foundation for movement analysis and ML training.

## Who is this for?

- **Athletes** looking to analyze and improve their movement patterns
- **Researchers** exploring biomechanics and movement optimization/or injury prevention

## Vision

Dynalytics uses a **personalized model architecture**:

```
Base Model (trained on many climbers)
         ↓
    Generic "good form" knowledge
         ↓
User uploads their videos
         ↓
Fine-tuned Personal Model
         ↓
    Learns YOUR body, YOUR style
```

The base model provides immediate value from day one, while personal data fine-tunes recommendations to each climber's unique body type, flexibility, and style.

## Features

### Current (Phase 1)
- Pose estimation and body tracking
- Joint angle calculation (12 angles per frame)
- Export data to CSV for analysis

### Planned
- [ ] Data collection UI
- [ ] Visualization overlay (skeleton + angles on video)
- [ ] Rules engine for form feedback
- [ ] Center of mass tracking
- [ ] Move classification (lock-off, deadpoint, dyno, etc.)
- [ ] ML-based movement predictions
- [ ] Imbalance and injury risk detection

## Tracked Angles

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

## Tech Stack

- Python
- OpenCV
- MediaPipe
- TensorFlow

## Project Structure

```
dynalytics/
├── src/
│   ├── core/
│   │   ├── landmark.py         # Landmark class (x, y, visibility)
│   │   └── angle.py            # Angle class (3 points → degrees)
│   ├── pose/
│   │   └── estimator.py        # PoseEstimator class (wraps MediaPipe)
│   ├── analysis/
│   │   ├── joint_analyzer.py   # JointAnalyzer class (calculates all 12 angles)
│   │   └── frame_data.py       # FrameData class (holds all data for one frame)
│   ├── export/
│   │   └── csv_exporter.py     # CSVExporter class
│   └── config/
│       └── settings.py         # Settings class (thresholds, constants)
├── tests/
├── data/                       # Output CSVs (gitignored)
├── videos/                     # Input videos (gitignored)
├── main.py
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

```bash
# Basic usage - outputs angles to CSV
python main.py path/to/video.mov

# Include raw landmark positions
python main.py path/to/video.mov --landmarks

# Specify output path
python main.py path/to/video.mov --output my_data.csv
```

## Data Pipeline

```
Raw Video
    ↓
Dynalytics (pose extraction)
    ↓
Raw Angles CSV          ← Current phase
    ↓
+ Rules / Labels
    ↓
Labeled Data CSV
    ↓
ML Training
    ↓
Predictions
```

## License

MIT

---

Development by [@jolieabadir](https://github.com/jolieabadir)
