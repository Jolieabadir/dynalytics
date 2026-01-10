"""
Landmark class representing a single body point.
"""
from dataclasses import dataclass
import numpy as np


@dataclass
class Landmark:
    """
    Represents a single pose landmark (body point).
    
    Attributes:
        x: Horizontal position in pixels
        y: Vertical position in pixels
        z: Depth estimate (relative, not absolute)
        visibility: Confidence score (0.0 to 1.0)
    """
    x: float
    y: float
    z: float
    visibility: float

    def to_array(self) -> np.ndarray:
        """Return x, y as numpy array for calculations."""
        return np.array([self.x, self.y])

    def to_tuple(self) -> tuple[int, int]:
        """Return x, y as integer tuple for drawing."""
        return (int(self.x), int(self.y))

    def is_visible(self, threshold: float = 0.5) -> bool:
        """Check if landmark is visible above threshold."""
        return self.visibility >= threshold

    @staticmethod
    def midpoint(a: 'Landmark', b: 'Landmark') -> 'Landmark':
        """Calculate midpoint between two landmarks."""
        return Landmark(
            x=(a.x + b.x) / 2,
            y=(a.y + b.y) / 2,
            z=(a.z + b.z) / 2,
            visibility=min(a.visibility, b.visibility)
        )
