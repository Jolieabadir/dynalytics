"""
Velocity tracking for pose landmarks.
"""
import numpy as np
from typing import Optional

from ..core.landmark import Landmark


class VelocityTracker:
    """
    Tracks velocity and speed of all landmarks between frames.
    
    Usage:
        tracker = VelocityTracker(fps=30)
        tracker.update(landmarks)
        
        # Get velocity vector (direction + magnitude)
        vel = tracker.get_velocity('left_wrist')  # np.ndarray [vx, vy]
        
        # Get speed (magnitude only)
        speed = tracker.get_speed('left_wrist')  # float, pixels/sec
    """
    
    def __init__(self, fps: float = 30.0, smoothing_window: int = 3):
        """
        Initialize velocity tracker.
        
        Args:
            fps: Video frames per second (for converting to pixels/sec)
            smoothing_window: Number of frames to average for smoothing (1 = no smoothing)
        """
        self._fps = fps
        self._smoothing_window = smoothing_window
        
        # Current frame positions
        self._current_positions: dict[str, np.ndarray] = {}
        
        # History for smoothing: {landmark_name: [pos1, pos2, ...]}
        self._position_history: dict[str, list[np.ndarray]] = {}
        
        # Calculated velocities (pixels/frame)
        self._velocities: dict[str, np.ndarray] = {}
        
        # Frame count
        self._frame_count: int = 0
    
    def update(self, landmarks: dict[str, Landmark]) -> None:
        """
        Update tracker with new frame's landmarks.
        
        Args:
            landmarks: Dictionary of landmark name to Landmark object
        """
        self._frame_count += 1
        
        for name, landmark in landmarks.items():
            current_pos = landmark.to_array()
            
            # Initialize history if new landmark
            if name not in self._position_history:
                self._position_history[name] = []
            
            # Add to history
            self._position_history[name].append(current_pos)
            
            # Keep only what we need for smoothing
            max_history = self._smoothing_window + 1
            if len(self._position_history[name]) > max_history:
                self._position_history[name] = self._position_history[name][-max_history:]
            
            # Calculate velocity if we have enough history
            if len(self._position_history[name]) >= 2:
                self._velocities[name] = self._calculate_velocity(name)
            
            self._current_positions[name] = current_pos
    
    def _calculate_velocity(self, name: str) -> np.ndarray:
        """
        Calculate smoothed velocity for a landmark.
        
        Returns:
            Velocity vector [vx, vy] in pixels/frame
        """
        history = self._position_history[name]
        
        if len(history) < 2:
            return np.array([0.0, 0.0])
        
        if self._smoothing_window <= 1 or len(history) == 2:
            # No smoothing - just use last two positions
            return history[-1] - history[-2]
        
        # Smoothed: average velocity over window
        velocities = []
        for i in range(1, len(history)):
            vel = history[i] - history[i-1]
            velocities.append(vel)
        
        return np.mean(velocities, axis=0)
    
    def get_velocity(self, name: str) -> Optional[np.ndarray]:
        """
        Get velocity vector for a landmark.
        
        Args:
            name: Landmark name
            
        Returns:
            Velocity vector [vx, vy] in pixels/second, or None if not available
        """
        if name not in self._velocities:
            return None
        
        # Convert from pixels/frame to pixels/second
        return self._velocities[name] * self._fps
    
    def get_speed(self, name: str) -> float:
        """
        Get speed (velocity magnitude) for a landmark.
        
        Args:
            name: Landmark name
            
        Returns:
            Speed in pixels/second, or 0.0 if not available
        """
        vel = self.get_velocity(name)
        if vel is None:
            return 0.0
        return float(np.linalg.norm(vel))
    
    def get_all_velocities(self) -> dict[str, np.ndarray]:
        """
        Get all current velocities.
        
        Returns:
            Dictionary of landmark name to velocity vector (pixels/second)
        """
        return {
            name: vel * self._fps 
            for name, vel in self._velocities.items()
        }
    
    def get_all_speeds(self) -> dict[str, float]:
        """
        Get all current speeds.
        
        Returns:
            Dictionary of landmark name to speed (pixels/second)
        """
        return {
            name: float(np.linalg.norm(vel * self._fps))
            for name, vel in self._velocities.items()
        }
    
    def get_center_of_mass_velocity(self, landmarks: dict[str, Landmark]) -> Optional[np.ndarray]:
        """
        Calculate velocity of center of mass (hip midpoint).
        
        Args:
            landmarks: Current frame landmarks
            
        Returns:
            Velocity vector [vx, vy] in pixels/second, or None
        """
        if 'left_hip' in landmarks and 'right_hip' in landmarks:
            # Use hip midpoint as center of mass proxy
            left_vel = self.get_velocity('left_hip')
            right_vel = self.get_velocity('right_hip')
            
            if left_vel is not None and right_vel is not None:
                return (left_vel + right_vel) / 2
        
        return None
    
    def get_center_of_mass_speed(self, landmarks: dict[str, Landmark]) -> float:
        """
        Get speed of center of mass.
        
        Args:
            landmarks: Current frame landmarks
            
        Returns:
            Speed in pixels/second
        """
        vel = self.get_center_of_mass_velocity(landmarks)
        if vel is None:
            return 0.0
        return float(np.linalg.norm(vel))
    
    def reset(self) -> None:
        """Clear all tracking history."""
        self._current_positions.clear()
        self._position_history.clear()
        self._velocities.clear()
        self._frame_count = 0
    
    @property
    def frame_count(self) -> int:
        """Number of frames processed."""
        return self._frame_count
