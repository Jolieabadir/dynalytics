"""
CSVExporter class for exporting frame data to CSV.
"""
import csv
from pathlib import Path

from ..analysis.frame_data import FrameData


class CSVExporter:
    """
    Exports a list of FrameData objects to CSV.
    
    Usage:
        exporter = CSVExporter()
        exporter.export(frames, 'output.csv')
    """

    def export(self, frames: list[FrameData], output_path: str | Path) -> None:
        """
        Export frame data to CSV file.
        
        Args:
            frames: List of FrameData objects
            output_path: Path to output CSV file
        """
        if not frames:
            raise ValueError("No frames to export")

        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        # Get fieldnames from first frame
        fieldnames = list(frames[0].to_dict().keys())

        with open(output_path, 'w', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()

            for frame in frames:
                writer.writerow(frame.to_dict())

    def export_with_landmarks(self, frames: list[FrameData], 
                               output_path: str | Path) -> None:
        """
        Export frame data including raw landmark positions.
        
        Args:
            frames: List of FrameData objects
            output_path: Path to output CSV file
        """
        if not frames:
            raise ValueError("No frames to export")

        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        # Build fieldnames: frame info + angles + landmarks
        first_frame = frames[0]
        fieldnames = ['frame_number', 'timestamp_ms']
        
        # Add angle columns
        for angle_name in first_frame.angles.keys():
            fieldnames.append(f'angle_{angle_name}')

        # Add landmark columns
        for landmark_name in first_frame.landmarks.keys():
            fieldnames.extend([
                f'{landmark_name}_x',
                f'{landmark_name}_y',
                f'{landmark_name}_visibility',
            ])

        with open(output_path, 'w', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()

            for frame in frames:
                row = {
                    'frame_number': frame.frame_number,
                    'timestamp_ms': frame.timestamp_ms,
                }

                # Add angles
                for angle_name, degrees in frame.angles.items():
                    row[f'angle_{angle_name}'] = degrees

                # Add landmarks
                for landmark_name, landmark in frame.landmarks.items():
                    row[f'{landmark_name}_x'] = landmark.x
                    row[f'{landmark_name}_y'] = landmark.y
                    row[f'{landmark_name}_visibility'] = landmark.visibility

                writer.writerow(row)
