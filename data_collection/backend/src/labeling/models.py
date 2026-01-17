"""
Data models for labeling system.

These are pure Python dataclasses with no database dependencies.
Database layer handles persistence separately.
"""
from dataclasses import dataclass, field, asdict
from datetime import datetime
from typing import Optional


@dataclass
class Video:
    """Represents an uploaded video with metadata."""
    
    id: Optional[int] = None
    filename: str = ""
    path: str = ""
    csv_path: str = ""
    fps: float = 0.0
    total_frames: int = 0
    duration_ms: float = 0.0
    uploaded_at: Optional[datetime] = None
    
    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        data = asdict(self)
        if self.uploaded_at:
            data['uploaded_at'] = self.uploaded_at.isoformat()
        return data
    
    @classmethod
    def from_dict(cls, data: dict) -> 'Video':
        """Create from dictionary."""
        if 'uploaded_at' in data and isinstance(data['uploaded_at'], str):
            data['uploaded_at'] = datetime.fromisoformat(data['uploaded_at'])
        return cls(**data)


@dataclass
class Move:
    """
    Represents a labeled climbing move.
    
    Contains move boundaries, type, and all contextual answers.
    """
    
    id: Optional[int] = None
    video_id: int = 0
    frame_start: int = 0
    frame_end: int = 0
    timestamp_start_ms: float = 0.0
    timestamp_end_ms: float = 0.0
    
    # Core move data
    move_type: str = ""  # 'dyno', 'lock_off', 'static', etc.
    form_quality: int = 3  # 1-5
    effort_level: int = 5  # 0-10
    
    # Contextual answers (stored as dict - specific to move type)
    # Example for dyno: {'catching_hand': 'right_hand', 'push_foot': 'left_foot', ...}
    contextual_data: dict = field(default_factory=dict)
    
    # Tags and description
    tags: list[str] = field(default_factory=list)
    description: str = ""
    
    # Metadata
    labeled_at: Optional[datetime] = None
    
    def duration_seconds(self) -> float:
        """Calculate move duration in seconds."""
        return (self.timestamp_end_ms - self.timestamp_start_ms) / 1000.0
    
    def frame_count(self) -> int:
        """Calculate number of frames in this move."""
        return self.frame_end - self.frame_start + 1
    
    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        data = asdict(self)
        if self.labeled_at:
            data['labeled_at'] = self.labeled_at.isoformat()
        return data
    
    @classmethod
    def from_dict(cls, data: dict) -> 'Move':
        """Create from dictionary."""
        if 'labeled_at' in data and isinstance(data['labeled_at'], str):
            data['labeled_at'] = datetime.fromisoformat(data['labeled_at'])
        return cls(**data)


@dataclass
class FrameTag:
    """
    Represents a tag on a specific frame within a move.
    
    Used for precise sensation tracking (pain, instability, weakness).
    """
    
    id: Optional[int] = None
    move_id: int = 0
    frame_number: int = 0
    timestamp_ms: float = 0.0
    
    # Tag type: 'pain', 'instability', 'weakness', 'technique', 'slip'
    tag_type: str = ""
    
    # For sensation tags (0-10 scale, None for non-sensation tags)
    level: Optional[int] = None
    
    # Body part locations (for sensation tags)
    # Example: ['left_knee', 'lower_back']
    locations: list[str] = field(default_factory=list)
    
    # Optional note
    note: str = ""
    
    # Metadata
    tagged_at: Optional[datetime] = None
    
    def is_sensation_tag(self) -> bool:
        """Check if this is a sensation tag (pain/instability/weakness)."""
        return self.tag_type in ['pain', 'instability', 'weakness']
    
    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        data = asdict(self)
        if self.tagged_at:
            data['tagged_at'] = self.tagged_at.isoformat()
        return data
    
    @classmethod
    def from_dict(cls, data: dict) -> 'FrameTag':
        """Create from dictionary."""
        if 'tagged_at' in data and isinstance(data['tagged_at'], str):
            data['tagged_at'] = datetime.fromisoformat(data['tagged_at'])
        return cls(**data)


# Move type configurations
MOVE_TYPES = [
    'static',
    'lock_off',
    'dyno',
    'deadpoint',
    'mantle',
    'drop_knee',
]

# Contextual questions for each move type
MOVE_TYPE_QUESTIONS = {
    'dyno': {
        'catching_hand': {
            'question': 'Which hand caught the target hold?',
            'options': ['left_hand', 'right_hand', 'both_hands', 'missed']
        },
        'push_foot': {
            'question': 'Which foot pushed off?',
            'options': ['left_foot', 'right_foot', 'both_feet']
        },
        'contact_at_launch': {
            'question': 'Contact points at launch',
            'options': ['left_hand', 'right_hand', 'left_foot', 'right_foot'],
            'multi_select': True
        },
        'body_position': {
            'question': 'Body position',
            'options': ['square', 'side_on', 'turned_away']
        }
    },
    'lock_off': {
        'lock_off_arm': {
            'question': 'Which arm was the lock-off on?',
            'options': ['left_arm', 'right_arm', 'both_arms']
        },
        'contact_points': {
            'question': 'Contact points during lock-off',
            'options': ['left_hand', 'right_hand', 'left_foot', 'right_foot'],
            'multi_select': True
        },
        'hold_duration': {
            'question': 'How long held (estimate)',
            'options': ['<1sec', '1-3sec', '3-5sec', '>5sec']
        }
    },
    'drop_knee': {
        'dropped_knee': {
            'question': 'Which knee dropped?',
            'options': ['left_knee', 'right_knee']
        },
        'hip_rotation': {
            'question': 'Hip rotation',
            'options': ['internal', 'external', 'neutral']
        },
        'contact_points': {
            'question': 'Contact points',
            'options': ['left_hand', 'right_hand', 'left_foot', 'right_foot'],
            'multi_select': True
        }
    },
    'static': {
        'reaching_hand': {
            'question': 'Which hand reached?',
            'options': ['left_hand', 'right_hand', 'both_hands']
        },
        'supporting_leg': {
            'question': 'Supporting leg',
            'options': ['left_foot', 'right_foot', 'both_feet']
        },
        'other_leg_position': {
            'question': 'Other leg position',
            'options': ['on_hold', 'flagged_left', 'flagged_right', 'dangling']
        },
        'contact_points': {
            'question': 'Contact points',
            'options': ['left_hand', 'right_hand', 'left_foot', 'right_foot'],
            'multi_select': True
        }
    },
    'deadpoint': {
        'reaching_hand': {
            'question': 'Which hand reached?',
            'options': ['left_hand', 'right_hand', 'both_hands']
        },
        'push_foot': {
            'question': 'Push foot',
            'options': ['left_foot', 'right_foot', 'both_feet']
        },
        'contact_at_peak': {
            'question': 'Contact at peak',
            'options': ['left_hand', 'right_hand', 'left_foot', 'right_foot'],
            'multi_select': True
        }
    },
    'mantle': {
        'mantle_side': {
            'question': 'Which side mantled first?',
            'options': ['left_side', 'right_side', 'both_together']
        },
        'starting_position': {
            'question': 'Starting position',
            'options': ['below_hold', 'level_with_hold', 'above_hold']
        },
        'contact_at_top': {
            'question': 'Contact points at top',
            'options': ['left_hand', 'right_hand', 'left_knee', 'right_knee'],
            'multi_select': True
        }
    }
}

# Body part options for sensation tagging
BODY_PARTS = [
    'left_shoulder', 'right_shoulder',
    'left_elbow', 'right_elbow',
    'left_wrist', 'right_wrist',
    'left_hip', 'right_hip',
    'left_knee', 'right_knee',
    'left_ankle', 'right_ankle',
    'lower_back', 'upper_back',
    'core', 'forearms'
]

# Tag types
TAG_TYPES = {
    'sharp_pain': 'Sharp Pain',
    'dull_pain': 'Dull Pain',
    'pop': 'Pop',
    'unstable': 'Unstable',
    'stretch_awkward': 'Stretch/Awkward',
    'strong_controlled': 'Strong/Controlled',
    'weak': 'Weak',
    'pumped': 'Pumped',
    'fatigue': 'Fatigue',
}