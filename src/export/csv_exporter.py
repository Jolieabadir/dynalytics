"""
CSV export functionality.
"""
import csv
from pathlib import Path
from typing import Union

from ..analysis.frame_data import FrameData


class CSVExporter:
    """
    Exports frame data to CSV files.
    
    Usage:
        exporter = CSVExporter()
        exporter.export(frames, 'output.csv')
    """

    def export(self, frames: list[FrameData], path: Union[str, Path]) -> None:
        """
        Export frame data to CSV (angles + speeds).
        
        Args:
            frames: List of FrameData objects
            path: Output file path
        """
        if not frames:
            return

        path = Path(path)
        
        # Get all possible columns from first frame with data
        sample_frame = next((f for f in frames if f.has_pose()), frames[0])
        sample_dict = sample_frame.to_dict()
        fieldnames = list(sample_dict.keys())

        with open(path, 'w', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            
            for frame in frames:
                writer.writerow(frame.to_dict())

    def export_minimal(self, frames: list[FrameData], path: Union[str, Path]) -> None:
        """
        Export minimal frame data to CSV (angles + CoM speed only).
        
        Args:
            frames: List of FrameData objects
            path: Output file path
        """
        if not frames:
            return

        path = Path(path)
        
        # Get columns from minimal dict
        sample_frame = next((f for f in frames if f.has_pose()), frames[0])
        sample_dict = sample_frame.to_dict_minimal()
        fieldnames = list(sample_dict.keys())

        with open(path, 'w', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            
            for frame in frames:
                writer.writerow(frame.to_dict_minimal())

    def export_with_landmarks(
        self, 
        frames: list[FrameData], 
        path: Union[str, Path]
    ) -> None:
        """
        Export frame data with raw landmark positions.
        
        Args:
            frames: List of FrameData objects
            path: Output file path
        """
        if not frames:
            return

        path = Path(path)
        
        # Build fieldnames including landmarks
        sample_frame = next((f for f in frames if f.has_pose()), frames[0])
        base_dict = sample_frame.to_dict()
        fieldnames = list(base_dict.keys())
        
        # Add landmark columns
        landmark_names = list(sample_frame.landmarks.keys())
        for name in landmark_names:
            fieldnames.extend([
                f'landmark_{name}_x',
                f'landmark_{name}_y',
                f'landmark_{name}_z',
                f'landmark_{name}_visibility',
            ])

        with open(path, 'w', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            
            for frame in frames:
                row = frame.to_dict()
                
                # Add landmark data
                for name in landmark_names:
                    landmark = frame.landmarks.get(name)
                    if landmark:
                        row[f'landmark_{name}_x'] = landmark.x
                        row[f'landmark_{name}_y'] = landmark.y
                        row[f'landmark_{name}_z'] = landmark.z
                        row[f'landmark_{name}_visibility'] = landmark.visibility
                    else:
                        row[f'landmark_{name}_x'] = None
                        row[f'landmark_{name}_y'] = None
                        row[f'landmark_{name}_z'] = None
                        row[f'landmark_{name}_visibility'] = None
                
                writer.writerow(row)
