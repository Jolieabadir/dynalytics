"""
Dynalytics - Climbing movement analysis.

Usage:
    python main.py <video_path> [--output <csv_path>] [--landmarks]
"""
import sys
import argparse
from pathlib import Path

import cv2 as cv

from src.pose.estimator import PoseEstimator
from src.analysis.joint_analyzer import JointAnalyzer
from src.analysis.frame_data import FrameData
from src.export.csv_exporter import CSVExporter
from src.config.settings import Settings


def parse_args():
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(
        description='Extract pose data from climbing videos.'
    )
    parser.add_argument(
        'video_path',
        type=str,
        help='Path to input video file'
    )
    parser.add_argument(
        '--output', '-o',
        type=str,
        default=None,
        help='Path to output CSV file (default: data/<video_name>.csv)'
    )
    parser.add_argument(
        '--landmarks', '-l',
        action='store_true',
        help='Include raw landmark positions in output'
    )
    return parser.parse_args()


def process_video(video_path: str, settings: Settings) -> list[FrameData]:
    """
    Process video and extract frame data.
    
    Args:
        video_path: Path to video file
        settings: Configuration settings
        
    Returns:
        List of FrameData objects, one per frame
    """
    cap = cv.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Could not open video: {video_path}")

    fps = cap.get(cv.CAP_PROP_FPS)
    total_frames = int(cap.get(cv.CAP_PROP_FRAME_COUNT))
    
    print(f"Processing video: {video_path}")
    print(f"FPS: {fps}, Total frames: {total_frames}")

    estimator = PoseEstimator(settings)
    analyzer = JointAnalyzer(settings)
    frames: list[FrameData] = []

    frame_number = 0
    
    while True:
        ret, frame = cap.read()
        if not ret:
            break

        timestamp_ms = (frame_number / fps) * 1000
        
        # Extract pose
        landmarks = estimator.process(frame)
        
        # Calculate angles
        angles = {}
        if landmarks:
            angles = analyzer.calculate(landmarks)
        
        # Store frame data
        frame_data = FrameData(
            frame_number=frame_number,
            timestamp_ms=timestamp_ms,
            landmarks=landmarks or {},
            angles=angles,
        )
        frames.append(frame_data)

        # Progress update
        if frame_number % 100 == 0:
            print(f"Processed frame {frame_number}/{total_frames}")

        frame_number += 1

    cap.release()
    estimator.close()

    print(f"Finished processing {frame_number} frames")
    return frames


def main():
    """Main entry point."""
    args = parse_args()
    
    video_path = Path(args.video_path)
    if not video_path.exists():
        print(f"Error: Video file not found: {video_path}")
        sys.exit(1)

    # Determine output path
    if args.output:
        output_path = Path(args.output)
    else:
        output_path = Path('data') / f"{video_path.stem}.csv"

    settings = Settings()
    
    # Process video
    frames = process_video(str(video_path), settings)
    
    # Count frames with detected poses
    frames_with_pose = sum(1 for f in frames if f.has_pose())
    print(f"Pose detected in {frames_with_pose}/{len(frames)} frames")

    # Export to CSV
    exporter = CSVExporter()
    
    if args.landmarks:
        exporter.export_with_landmarks(frames, output_path)
    else:
        exporter.export(frames, output_path)

    print(f"Exported data to: {output_path}")


if __name__ == '__main__':
    main()
