"""
Configuration settings for Dynalytics.
"""
from dataclasses import dataclass


@dataclass
class Settings:
    """
    Central configuration for the application.
    
    Attributes:
        min_detection_confidence: MediaPipe detection threshold
        min_tracking_confidence: MediaPipe tracking threshold
        visibility_threshold: Minimum visibility to consider landmark valid
    """
    min_detection_confidence: float = 0.5
    min_tracking_confidence: float = 0.5
    visibility_threshold: float = 0.5

    # Landmark names used in the application
    LANDMARK_NAMES: tuple = (
        'nose',
        'left_shoulder',
        'right_shoulder',
        'left_elbow',
        'right_elbow',
        'left_wrist',
        'right_wrist',
        'left_hip',
        'right_hip',
        'left_knee',
        'right_knee',
        'left_ankle',
        'right_ankle',
        'left_heel',
        'right_heel',
    )

    # Angle definitions: (name, point_a, point_b, point_c)
    # Angle is measured at point_b
    ANGLE_DEFINITIONS: tuple = (
        ('left_elbow', 'left_shoulder', 'left_elbow', 'left_wrist'),
        ('right_elbow', 'right_shoulder', 'right_elbow', 'right_wrist'),
        ('left_shoulder', 'left_hip', 'left_shoulder', 'left_elbow'),
        ('right_shoulder', 'right_hip', 'right_shoulder', 'right_elbow'),
        ('left_hip', 'left_shoulder', 'left_hip', 'left_knee'),
        ('right_hip', 'right_shoulder', 'right_hip', 'right_knee'),
        ('left_knee', 'left_hip', 'left_knee', 'left_ankle'),
        ('right_knee', 'right_hip', 'right_knee', 'right_ankle'),
        ('left_ankle', 'left_knee', 'left_ankle', 'left_heel'),
        ('right_ankle', 'right_knee', 'right_ankle', 'right_heel'),
        # Back angles use midpoints - handled separately in JointAnalyzer
    )

    BACK_ANGLES: tuple = (
        'upper_back',
        'lower_back',
    )
