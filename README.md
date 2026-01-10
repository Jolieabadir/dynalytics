# Dynalytics

Extract and analyze climbing movement from video using computer vision.

Dynalytics processes climbing videos to extract pose data, track body position, and calculate joint angles — building a foundation for movement analysis and ML training.

## Who is this for?

- **Athletes** looking to analyze and improve their movement patterns
- **Coaches** who want data-driven feedback for their athletes
- **Researchers** exploring biomechanics and movement optimization

## Features

- Pose estimation and body tracking
- Joint angle calculation (12 angles per frame)
- Center of mass tracking
- Export data to CSV for further analysis

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
pip install -r requirements.txt
```

## Usage

```bash
python main.py path/to/video.mov
```

## Roadmap

- [ ] Core pose extraction pipeline
- [ ] Joint angle calculations
- [ ] Center of mass tracking
- [ ] CSV data export
- [ ] ML-based movement predictions
- [ ] Imbalance and injury risk detection (PT applications)

## License

MIT

---

Development by [@jolieabadir](https://github.com/jolieabadir)
