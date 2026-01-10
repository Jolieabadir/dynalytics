"""
Angle class for calculating angles between three landmarks.
"""
import numpy as np
from .landmark import Landmark


class Angle:
    """
    Calculates the angle formed by three landmarks.
    
    The angle is measured at point B, formed by rays BA and BC.
    
        A
         \
          \  angle
           B -------> C
    
    Usage:
        angle = Angle(landmark_a, landmark_b, landmark_c)
        degrees = angle.degrees
    """

    def __init__(self, a: Landmark, b: Landmark, c: Landmark):
        """
        Initialize angle with three landmarks.
        
        Args:
            a: First point
            b: Vertex point (where angle is measured)
            c: Third point
        """
        self._a = a
        self._b = b
        self._c = c
        self._degrees: float | None = None

    @property
    def degrees(self) -> float | None:
        """
        Calculate angle in degrees.
        
        Returns:
            Angle in degrees (0-180), or None if landmarks not visible.
        """
        if self._degrees is not None:
            return self._degrees

        if not all([
            self._a.is_visible(),
            self._b.is_visible(),
            self._c.is_visible()
        ]):
            return None

        self._degrees = self._calculate()
        return self._degrees

    def _calculate(self) -> float:
        """Perform the angle calculation."""
        vec_ba = self._a.to_array() - self._b.to_array()
        vec_bc = self._c.to_array() - self._b.to_array()

        cosine = np.dot(vec_ba, vec_bc) / (
            np.linalg.norm(vec_ba) * np.linalg.norm(vec_bc) + 1e-6
        )
        
        # Clamp to avoid numerical errors with arccos
        cosine = np.clip(cosine, -1.0, 1.0)
        
        return float(np.degrees(np.arccos(cosine)))

    @property
    def is_valid(self) -> bool:
        """Check if all landmarks are visible."""
        return all([
            self._a.is_visible(),
            self._b.is_visible(),
            self._c.is_visible()
        ])
