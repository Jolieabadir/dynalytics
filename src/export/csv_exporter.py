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

        # Find first frame with pose data to build complete headers
        reference_frame = None
        for frame in frames:
            if frame.has_pose():
                reference_frame = frame
                break
        
        if reference_frame is None:
            raise ValueError("No frames with pose data to export")

        # Build fieldnames from reference frame
        fieldnames = ['frame_number', 'timestamp_ms']
        for angle_name in reference_frame.angles.keys():
            fieldnames.append(f'angle_{angle_name}')

        with open(output_path, 'w', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()

            for frame in frames:
                row = {
                    'frame_number': frame.frame_number,
                    'timestamp_ms': frame.timestamp_ms,
                }
                for angle_name in reference_frame.angles.keys():
                    row[f'angle_{angle_name}'] = frame.angles.get(angle_name)
                writer.writerow(row)

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

        # Find first frame with pose data to build complete headers
        reference_frame = None
        for frame in frames:
            if frame.has_pose():
                reference_frame = frame
                break
        
        if reference_frame is None:
            raise ValueError("No frames with pose data to export")

        # Build fieldnames: frame info + angles + landmarks
        fieldnames = ['frame_number', 'timestamp_ms']
        
        # Add angle columns
        for angle_name in reference_frame.angles.keys():
            fieldnames.append(f'angle_{angle_name}')

        # Add landmark columns
        for landmark_name in reference_frame.landmarks.keys():
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

                # Add angles (use None for frames without pose)
                for angle_name in reference_frame.angles.keys():
                    row[f'angle_{angle_name}'] = frame.angles.get(angle_name)

                # Add landmarks (use None for frames without pose)
                for landmark_name in reference_frame.landmarks.keys():
                    landmark = frame.landmarks.get(landmark_name)
                    if landmark:
                        row[f'{landmark_name}_x'] = landmark.x
                        row[f'{landmark_name}_y'] = landmark.y
                        row[f'{landmark_name}_visibility'] = landmark.visibility
                    else:
                        row[f'{landmark_name}_x'] = None
                        row[f'{landmark_name}_y'] = None
                        row[f'{landmark_name}_visibility'] = None

                writer.writerow(row)
