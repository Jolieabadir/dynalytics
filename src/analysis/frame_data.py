"""
FrameData class for holding all data from a single frame.
"""
from dataclasses import dataclass, field

from ..core.landmark import Landmark


@dataclass
class FrameData:
    """
    Container for all extracted data from a single video frame.
    
    Attributes:
        frame_number: Sequential frame index
        timestamp_ms: Timestamp in milliseconds
        landmarks: Dictionary of landmark name to Landmark
        angles: Dictionary of angle name to degrees
    """
    frame_number: int
    timestamp_ms: float
    landmarks: dict[str, Landmark] = field(default_factory=dict)
    angles: dict[str, float | None] = field(default_factory=dict)

    def has_pose(self) -> bool:
        """Check if pose was detected in this frame."""
        return len(self.landmarks) > 0

    def get_angle(self, name: str) -> float | None:
        """Get a specific angle by name."""
        return self.angles.get(name)

    def get_landmark(self, name: str) -> Landmark | None:
        """Get a specific landmark by name."""
        return self.landmarks.get(name)

    def to_dict(self) -> dict:
        """
        Convert to flat dictionary for CSV export.
        
        Returns:
            Dictionary with frame_number, timestamp, all angles.
        """
        data = {
            'frame_number': self.frame_number,
            'timestamp_ms': self.timestamp_ms,
        }

        # Add all angles
        for angle_name, degrees in self.angles.items():
            data[f'angle_{angle_name}'] = degrees

        return data
