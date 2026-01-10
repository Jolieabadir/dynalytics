"""
PoseEstimator class wrapping MediaPipe pose detection.
"""
import mediapipe as mp
import numpy as np
import cv2 as cv

from ..core.landmark import Landmark
from ..config.settings import Settings


class PoseEstimator:
    """
    Wraps MediaPipe Pose to extract landmarks from video frames.
    
    Usage:
        estimator = PoseEstimator()
        landmarks = estimator.process(frame)
        if landmarks:
            left_shoulder = landmarks['left_shoulder']
    """

    # Mapping of our names to MediaPipe landmark indices
    _MP_LANDMARK_MAP = {
        'nose': mp.solutions.pose.PoseLandmark.NOSE,
        'left_shoulder': mp.solutions.pose.PoseLandmark.LEFT_SHOULDER,
        'right_shoulder': mp.solutions.pose.PoseLandmark.RIGHT_SHOULDER,
        'left_elbow': mp.solutions.pose.PoseLandmark.LEFT_ELBOW,
        'right_elbow': mp.solutions.pose.PoseLandmark.RIGHT_ELBOW,
        'left_wrist': mp.solutions.pose.PoseLandmark.LEFT_WRIST,
        'right_wrist': mp.solutions.pose.PoseLandmark.RIGHT_WRIST,
        'left_hip': mp.solutions.pose.PoseLandmark.LEFT_HIP,
        'right_hip': mp.solutions.pose.PoseLandmark.RIGHT_HIP,
        'left_knee': mp.solutions.pose.PoseLandmark.LEFT_KNEE,
        'right_knee': mp.solutions.pose.PoseLandmark.RIGHT_KNEE,
        'left_ankle': mp.solutions.pose.PoseLandmark.LEFT_ANKLE,
        'right_ankle': mp.solutions.pose.PoseLandmark.RIGHT_ANKLE,
        'left_heel': mp.solutions.pose.PoseLandmark.LEFT_HEEL,
        'right_heel': mp.solutions.pose.PoseLandmark.RIGHT_HEEL,
    }

    def __init__(self, settings: Settings | None = None):
        """
        Initialize the pose estimator.
        
        Args:
            settings: Configuration settings. Uses defaults if not provided.
        """
        self._settings = settings or Settings()
        self._pose = mp.solutions.pose.Pose(
            min_detection_confidence=self._settings.min_detection_confidence,
            min_tracking_confidence=self._settings.min_tracking_confidence,
        )

    def process(self, frame: np.ndarray) -> dict[str, Landmark] | None:
        """
        Process a frame and extract pose landmarks.
        
        Args:
            frame: BGR image from OpenCV
            
        Returns:
            Dictionary mapping landmark names to Landmark objects,
            or None if no pose detected.
        """
        rgb_frame = cv.cvtColor(frame, cv.COLOR_BGR2RGB)
        results = self._pose.process(rgb_frame)

        if not results.pose_landmarks:
            return None

        height, width = frame.shape[:2]
        landmarks = {}

        for name, mp_landmark in self._MP_LANDMARK_MAP.items():
            lm = results.pose_landmarks.landmark[mp_landmark]
            landmarks[name] = Landmark(
                x=lm.x * width,
                y=lm.y * height,
                z=lm.z,
                visibility=lm.visibility,
            )

        return landmarks

    def close(self):
        """Release MediaPipe resources."""
        self._pose.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()
