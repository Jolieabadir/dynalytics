"""
Data models for labeling system.

Three-lens model: Environment / Strategy / Outcome
These are pure Python dataclasses with no database dependencies.
Database layer handles persistence separately.

Schema version 4 (storage v3): per-user scoping, hold bounding boxes, and
slot-based environments. Every record carries the owning Supabase user id.
"""
from dataclasses import dataclass, field, asdict
from datetime import datetime
from typing import Optional


@dataclass
class Video:
    """Represents an uploaded video with metadata.

    Pose CSV, the original video and the export all live in R2; the table only
    keeps their object keys. ``r2_video_key`` stays None until the browser has
    finished its direct-to-R2 upload and called confirm-upload.
    """

    id: Optional[int] = None
    user_id: str = ""
    filename: str = ""
    fps: float = 0.0
    total_frames: int = 0
    duration_ms: float = 0.0
    # Intrinsic frame size in pixels. None for rows registered before the
    # dimensions migration; readers must treat that as "unknown", not a default.
    width: Optional[int] = None
    height: Optional[int] = None
    r2_video_key: Optional[str] = None
    r2_pose_csv_key: Optional[str] = None
    r2_export_key: Optional[str] = None
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
class Hold:
    """A hold on the wall, located by a normalized bounding box.

    Coordinates are fractions of frame width/height in the range 0-1 so they
    survive any later re-encode or resize of the source video.
    """

    id: Optional[int] = None
    video_id: int = 0
    user_id: str = ""
    bbox_x: float = 0.0
    bbox_y: float = 0.0
    bbox_w: float = 0.0
    bbox_h: float = 0.0
    source: str = "manual"  # detected | manual
    created_at: Optional[datetime] = None

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        data = asdict(self)
        if self.created_at:
            data['created_at'] = self.created_at.isoformat()
        return data

    @classmethod
    def from_dict(cls, data: dict) -> 'Hold':
        """Create from dictionary."""
        if 'created_at' in data and isinstance(data['created_at'], str):
            data['created_at'] = datetime.fromisoformat(data['created_at'])
        return cls(**data)


@dataclass
class Move:
    """
    Represents a labeled climbing move (Lens 2: Strategy).

    Contains move boundaries and strategy information.
    """

    id: Optional[int] = None
    video_id: int = 0
    user_id: str = ""
    frame_start: int = 0
    frame_end: int = 0
    timestamp_start_ms: float = 0.0
    timestamp_end_ms: float = 0.0

    # Strategy lens
    approach: str = ""  # static | dynamic | coordination
    move_tags: list[str] = field(default_factory=list)  # multi-select from MOVE_TAGS
    size: str = ""  # small | medium | large

    # Quality metrics
    form_quality: int = 3  # 1-5
    effort_level: int = 5  # 0-10
    confidence: str = ""  # low | med | high

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
class Environment:
    """
    Represents the environment context for a move (Lens 1: Environment).

    One record per move, joined by move_id. Each of the four hold slots may
    point at a row in ``holds`` and carries its own type and quality list; all
    slots are optional, which covers no-hands, no-feet and one-hand moves.
    """

    id: Optional[int] = None
    move_id: int = 0
    user_id: str = ""

    wall_angle: str = ""  # slab | vertical | gentle_overhang | steep

    start_left_hold_id: Optional[int] = None
    start_left_hold_type: Optional[str] = None
    start_left_hold_quality: list[str] = field(default_factory=list)

    start_right_hold_id: Optional[int] = None
    start_right_hold_type: Optional[str] = None
    start_right_hold_quality: list[str] = field(default_factory=list)

    end_hold_id: Optional[int] = None
    end_hold_type: Optional[str] = None
    end_hold_quality: list[str] = field(default_factory=list)

    foot_hold_id: Optional[int] = None
    foot_hold_type: Optional[str] = None
    foot_hold_quality: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> 'Environment':
        """Create from dictionary."""
        return cls(**data)


@dataclass
class Outcome:
    """
    Represents the outcome of a move (Lens 3: Outcome).

    One record per move, joined by move_id.
    """

    id: Optional[int] = None
    move_id: int = 0
    user_id: str = ""

    result: str = ""  # success | fall
    reach_detail: str = ""  # reached_controlled | reached_not_controlled | didnt_reach
    confidence: str = ""  # low | med | high

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> 'Outcome':
        """Create from dictionary."""
        return cls(**data)


@dataclass
class FrameTag:
    """
    Represents a tag on a specific frame within a move.

    Used for precise sensation tracking (pain, instability, weakness, etc.).
    """

    id: Optional[int] = None
    move_id: int = 0
    user_id: str = ""
    frame_number: int = 0
    timestamp_ms: float = 0.0

    # Tag type from TAG_TYPES
    tag_type: str = ""

    side: Optional[str] = None  # left | right | null

    # For sensation tags (0-10 scale, None for non-sensation tags)
    level: Optional[int] = None

    # Body part locations (for sensation tags)
    locations: list[str] = field(default_factory=list)

    # Optional note
    note: str = ""

    # Metadata
    tagged_at: Optional[datetime] = None

    def is_sensation_tag(self) -> bool:
        """Check if this is a sensation tag (pain/instability/weakness)."""
        return self.tag_type in ['sharp_pain', 'dull_pain', 'unstable', 'weak']

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


# =============================================================================
# LENS 2: STRATEGY CONSTANTS
# =============================================================================

APPROACHES = ['static', 'dynamic', 'coordination']

SIZES = ['small', 'medium', 'large']

MOVE_TAGS = [
    'bump',
    'mantle',
    'balance',
    'upper_body_coordination',
    'lower_body_coordination',
    'heel_hook',
    'toe_hook',
    'no_feet_on',
    'deadpoint',
    'dyno',
    'foot_move',
    'no_hands',
    'technical',
    'tension',
]

# =============================================================================
# LENS 1: ENVIRONMENT CONSTANTS
# =============================================================================

WALL_ANGLES = ['slab', 'vertical', 'gentle_overhang', 'steep']

HOLD_TYPES = ['horizontal_edge', 'gaston', 'side_pull', 'undercling', 'jug', 'pinch']

HOLD_QUALITIES = ['incut', 'sloped', 'small']

# The four hold slots an environment can reference. Column names are derived
# from these: {slot}_hold_id, {slot}_hold_type, {slot}_hold_quality.
HOLD_SLOTS = ['start_left', 'start_right', 'end', 'foot']

HOLD_SOURCES = ['detected', 'manual']

# =============================================================================
# LENS 3: OUTCOME CONSTANTS
# =============================================================================

RESULTS = ['success', 'fall']

REACH_DETAILS = ['reached_controlled', 'reached_not_controlled', 'didnt_reach']

CONFIDENCE_LEVELS = ['low', 'med', 'high']

# =============================================================================
# SENSATION (FRAME TAG) CONSTANTS
# =============================================================================

TAG_TYPES = {
    'sharp_pain': 'Sharp Pain',
    'dull_pain': 'Dull Pain',
    'audible_pop': 'Audible Pop',
    'unstable': 'Unstable',
    'stretch': 'Stretch',
    'strong': 'Strong',
    'weak': 'Weak',
    'pumped': 'Pumped',
    'fatigue': 'Fatigue',
}

SIDES = ['left', 'right']

# Body part options for sensation tagging (unchanged - 16 entries)
BODY_PARTS = [
    'left_shoulder', 'right_shoulder',
    'left_elbow', 'right_elbow',
    'left_wrist', 'right_wrist',
    'left_hip', 'right_hip',
    'left_knee', 'right_knee',
    'left_ankle', 'right_ankle',
    'lower_back', 'upper_back',
    'core', 'forearms',
]
