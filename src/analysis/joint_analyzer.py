"""
JointAnalyzer class for calculating all joint angles.
"""
from ..core.landmark import Landmark
from ..core.angle import Angle
from ..config.settings import Settings


class JointAnalyzer:
    """
    Calculates all 12 joint angles from pose landmarks.
    
    Usage:
        analyzer = JointAnalyzer()
        angles = analyzer.calculate(landmarks)
        print(angles['left_elbow'])  # 145.2
    """

    def __init__(self, settings: Settings | None = None):
        """
        Initialize the analyzer.
        
        Args:
            settings: Configuration settings.
        """
        self._settings = settings or Settings()

    def calculate(self, landmarks: dict[str, Landmark]) -> dict[str, float | None]:
        """
        Calculate all joint angles from landmarks.
        
        Args:
            landmarks: Dictionary of landmark name to Landmark object.
            
        Returns:
            Dictionary of angle name to degrees (or None if not visible).
        """
        angles = {}

        # Standard joint angles (10)
        for angle_name, point_a, point_b, point_c in self._settings.ANGLE_DEFINITIONS:
            if all(name in landmarks for name in [point_a, point_b, point_c]):
                angle = Angle(
                    landmarks[point_a],
                    landmarks[point_b],
                    landmarks[point_c],
                )
                angles[angle_name] = angle.degrees
            else:
                angles[angle_name] = None

        # Back angles (2) - require midpoint calculations
        angles['upper_back'] = self._calculate_upper_back(landmarks)
        angles['lower_back'] = self._calculate_lower_back(landmarks)

        return angles

    def _calculate_upper_back(self, landmarks: dict[str, Landmark]) -> float | None:
        """
        Calculate upper back angle.
        
        Points: left_shoulder → shoulder_midpoint → right_shoulder
        Measures shoulder hunch/openness.
        """
        required = ['left_shoulder', 'right_shoulder']
        if not all(name in landmarks for name in required):
            return None

        left_shoulder = landmarks['left_shoulder']
        right_shoulder = landmarks['right_shoulder']
        shoulder_mid = Landmark.midpoint(left_shoulder, right_shoulder)

        angle = Angle(left_shoulder, shoulder_mid, right_shoulder)
        return angle.degrees

    def _calculate_lower_back(self, landmarks: dict[str, Landmark]) -> float | None:
        """
        Calculate lower back angle.
        
        Points: shoulder_midpoint → hip_midpoint → knee_midpoint
        Measures torso arch/round.
        """
        required = ['left_shoulder', 'right_shoulder', 
                    'left_hip', 'right_hip',
                    'left_knee', 'right_knee']
        if not all(name in landmarks for name in required):
            return None

        shoulder_mid = Landmark.midpoint(
            landmarks['left_shoulder'],
            landmarks['right_shoulder']
        )
        hip_mid = Landmark.midpoint(
            landmarks['left_hip'],
            landmarks['right_hip']
        )
        knee_mid = Landmark.midpoint(
            landmarks['left_knee'],
            landmarks['right_knee']
        )

        angle = Angle(shoulder_mid, hip_mid, knee_mid)
        return angle.degrees
