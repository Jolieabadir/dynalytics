"""
FrameData class for holding all data from a single frame.
"""
from dataclasses import dataclass, field
from typing import Optional
import numpy as np

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
        velocities: Dictionary of landmark name to velocity vector [vx, vy]
        speeds: Dictionary of landmark name to speed (magnitude)
        center_of_mass_velocity: Velocity of CoM (hip midpoint)
        center_of_mass_speed: Speed of CoM
    """
    frame_number: int
    timestamp_ms: float
    landmarks: dict[str, Landmark] = field(default_factory=dict)
    angles: dict[str, float | None] = field(default_factory=dict)
    velocities: dict[str, np.ndarray] = field(default_factory=dict)
    speeds: dict[str, float] = field(default_factory=dict)
    center_of_mass_velocity: Optional[np.ndarray] = None
    center_of_mass_speed: float = 0.0

    def has_pose(self) -> bool:
        """Check if pose was detected in this frame."""
        return len(self.landmarks) > 0

    def get_angle(self, name: str) -> float | None:
        """Get a specific angle by name."""
        return self.angles.get(name)

    def get_landmark(self, name: str) -> Landmark | None:
        """Get a specific landmark by name."""
        return self.landmarks.get(name)

    def get_velocity(self, name: str) -> Optional[np.ndarray]:
        """Get velocity vector for a landmark."""
        return self.velocities.get(name)

    def get_speed(self, name: str) -> float:
        """Get speed for a landmark."""
        return self.speeds.get(name, 0.0)

    def to_dict(self) -> dict:
        """
        Convert to flat dictionary for CSV export.
        
        Returns:
            Dictionary with frame_number, timestamp, all angles, and speeds.
        """
        data = {
            'frame_number': self.frame_number,
            'timestamp_ms': self.timestamp_ms,
        }

        # Add all angles
        for angle_name, degrees in self.angles.items():
            data[f'angle_{angle_name}'] = degrees

        # Add all speeds
        for landmark_name, speed in self.speeds.items():
            data[f'speed_{landmark_name}'] = speed

        # Add center of mass speed
        data['speed_center_of_mass'] = self.center_of_mass_speed

        # Add velocity components for key landmarks
        key_landmarks = ['left_wrist', 'right_wrist', 'left_hip', 'right_hip']
        for name in key_landmarks:
            if name in self.velocities:
                vel = self.velocities[name]
                data[f'velocity_{name}_x'] = vel[0]
                data[f'velocity_{name}_y'] = vel[1]

        # Add center of mass velocity components
        if self.center_of_mass_velocity is not None:
            data['velocity_center_of_mass_x'] = self.center_of_mass_velocity[0]
            data['velocity_center_of_mass_y'] = self.center_of_mass_velocity[1]

        return data

    def to_dict_minimal(self) -> dict:
        """
        Convert to minimal dictionary (just angles and CoM speed).
        
        Returns:
            Dictionary with frame_number, timestamp, angles, and CoM speed.
        """
        data = {
            'frame_number': self.frame_number,
            'timestamp_ms': self.timestamp_ms,
            'speed_center_of_mass': self.center_of_mass_speed,
        }

        # Add all angles
        for angle_name, degrees in self.angles.items():
            data[f'angle_{angle_name}'] = degrees

        return data
