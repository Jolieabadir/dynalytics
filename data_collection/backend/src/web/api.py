"""
FastAPI application for data collection UI.

Clean REST API with proper error handling and validation.
Three-lens labeling schema: Environment / Strategy / Outcome

Storage: labels in Supabase Postgres, blobs in Cloudflare R2. Nothing is
written to the container filesystem, which Railway wipes on every deploy.
Every route below /api (except health) requires a Supabase JWT and is scoped to
that token's user.
"""
from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel, Field
from typing import List, Optional
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from ..labeling.database import Database, SchemaNotApplied
from ..labeling.models import (
    Video, Hold, Move, Environment, Outcome, FrameTag,
    APPROACHES, SIZES, MOVE_TAGS,
    WALL_ANGLES, HOLD_TYPES, HOLD_QUALITIES, HOLD_SLOTS, HOLD_SOURCES,
    RESULTS, REACH_DETAILS, CONFIDENCE_LEVELS,
    TAG_TYPES, BODY_PARTS, SIDES,
    DEFINITIONS,
)
from ..labeling.exporter import Exporter
from ..storage import r2
from .auth import get_current_user_id

# Largest body accepted on register, which carries the pose CSV inline.
MAX_REGISTER_BYTES = 60 * 1024 * 1024

# Most holds accepted in one bulk create. A bouldering wall in frame is tens of
# holds; anything past this is a runaway detector, not a real wall.
MAX_HOLDS_PER_REQUEST = 200

@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Close the connection pool on shutdown, if this module opened it."""
    yield
    if _db is not None and _db_owned:
        _db.close()


app = FastAPI(
    title="Dynalytix Climbing Data Collection API",
    description="API for labeling climbing movement data",
    version="3.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def limit_register_body(request: Request, call_next):
    """Reject oversized register bodies before FastAPI buffers the form."""
    if request.method == 'POST' and request.url.path == '/api/videos/register':
        content_length = request.headers.get('content-length')
        if content_length and content_length.isdigit() and int(content_length) > MAX_REGISTER_BYTES:
            return JSONResponse(
                status_code=413,
                content={
                    'detail': (
                        f'Body exceeds {MAX_REGISTER_BYTES} bytes. '
                        'Downsample the pose CSV before registering.'
                    )
                },
            )
    return await call_next(request)


# Lazily built so the module imports without DATABASE_URL (tests, tooling).
_db: Optional[Database] = None
_exporter: Optional[Exporter] = None
# True only when this module opened the pool, so an injected one (tests) is
# never closed out from under its owner on app shutdown.
_db_owned: bool = False


def get_db() -> Database:
    """Return the process-wide Database, opening the pool on first use."""
    global _db, _db_owned
    if _db is None:
        _db = Database()
        _db_owned = True
    return _db


def get_exporter() -> Exporter:
    """Return the process-wide Exporter."""
    global _exporter
    if _exporter is None:
        _exporter = Exporter(get_db())
    return _exporter


# ==================== PYDANTIC SCHEMAS ====================

class VideoRegister(BaseModel):
    """Schema for registering a client-processed video."""
    filename: str
    fps: float
    total_frames: int
    duration_ms: float
    # Intrinsic frame size. Optional so a client that predates the dimensions
    # migration still registers; pose landmarks are stored as pixels, so
    # without these they cannot later be normalized against hold boxes.
    width: Optional[int] = Field(default=None, gt=0)
    height: Optional[int] = Field(default=None, gt=0)
    csv_data: str


class VideoResponse(BaseModel):
    """Schema for video response."""
    id: int
    filename: str
    fps: float
    total_frames: int
    duration_ms: float
    width: Optional[int] = None
    height: Optional[int] = None
    r2_video_key: Optional[str]
    r2_pose_csv_key: Optional[str]
    r2_export_key: Optional[str]
    uploaded_at: str


class UploadUrlRequest(BaseModel):
    """Schema for requesting a presigned video upload URL."""
    content_type: str = 'video/mp4'


class UploadUrlResponse(BaseModel):
    """Schema for a presigned upload URL."""
    url: str
    key: str
    expires_in: int


class ConfirmUploadRequest(BaseModel):
    """Schema for confirming a completed direct upload."""
    key: Optional[str] = None


# --- Hold Schemas ---

class HoldItem(BaseModel):
    """One bounding box in a bulk hold create. video_id comes from the path."""
    bbox_x: float = Field(ge=0, le=1)
    bbox_y: float = Field(ge=0, le=1)
    bbox_w: float = Field(ge=0, le=1)
    bbox_h: float = Field(ge=0, le=1)
    source: str = 'manual'  # detected | manual


class HoldCreate(BaseModel):
    """Schema for creating a hold."""
    video_id: int
    bbox_x: float = Field(ge=0, le=1)
    bbox_y: float = Field(ge=0, le=1)
    bbox_w: float = Field(ge=0, le=1)
    bbox_h: float = Field(ge=0, le=1)
    source: str = 'manual'  # detected | manual


class HoldBulkCreate(BaseModel):
    """Schema for creating many holds on one video in a single request."""
    holds: List[HoldItem] = []


class HoldUpdate(BaseModel):
    """Schema for updating a hold. Every field optional; omitted fields stay."""
    bbox_x: Optional[float] = Field(default=None, ge=0, le=1)
    bbox_y: Optional[float] = Field(default=None, ge=0, le=1)
    bbox_w: Optional[float] = Field(default=None, ge=0, le=1)
    bbox_h: Optional[float] = Field(default=None, ge=0, le=1)
    source: Optional[str] = None


class HoldResponse(BaseModel):
    """Schema for hold response."""
    id: int
    video_id: int
    bbox_x: float
    bbox_y: float
    bbox_w: float
    bbox_h: float
    source: str
    created_at: str


# --- Move Schemas (Lens 2: Strategy) ---

class MoveCreate(BaseModel):
    """Schema for creating a move."""
    video_id: int
    frame_start: int
    frame_end: int
    timestamp_start_ms: float
    timestamp_end_ms: float
    approach: str  # static | dynamic | coordination
    size: str  # small | medium | large
    move_tags: List[str] = []  # multi-select from MOVE_TAGS
    form_quality: int = Field(ge=1, le=5, default=3)
    effort_level: int = Field(ge=0, le=10, default=5)
    confidence: Optional[str] = None  # low | med | high
    description: str = ""


class MoveUpdate(BaseModel):
    """Schema for updating a move."""
    frame_start: Optional[int] = None
    frame_end: Optional[int] = None
    timestamp_start_ms: Optional[float] = None
    timestamp_end_ms: Optional[float] = None
    approach: Optional[str] = None
    size: Optional[str] = None
    move_tags: Optional[List[str]] = None
    form_quality: Optional[int] = Field(None, ge=1, le=5)
    effort_level: Optional[int] = Field(None, ge=0, le=10)
    confidence: Optional[str] = None
    description: Optional[str] = None


class MoveResponse(BaseModel):
    """Schema for move response."""
    id: int
    video_id: int
    frame_start: int
    frame_end: int
    timestamp_start_ms: float
    timestamp_end_ms: float
    approach: str
    size: str
    move_tags: List[str]
    form_quality: int
    effort_level: int
    confidence: Optional[str]
    description: str
    labeled_at: str
    frame_tag_count: int = 0


# --- Environment Schemas (Lens 1: Environment) ---

class HoldSlot(BaseModel):
    """One of the four hold slots on an environment. Every field optional."""
    hold_id: Optional[int] = None
    hold_type: Optional[str] = None
    hold_quality: List[str] = []


class EnvironmentCreate(BaseModel):
    """Schema for creating an environment record."""
    move_id: int
    wall_angle: str  # slab | vertical | gentle_overhang | steep
    start_left: HoldSlot = Field(default_factory=HoldSlot)
    start_right: HoldSlot = Field(default_factory=HoldSlot)
    end: HoldSlot = Field(default_factory=HoldSlot)
    foot: HoldSlot = Field(default_factory=HoldSlot)  # optional by design


class EnvironmentUpdate(BaseModel):
    """Schema for updating an environment record."""
    wall_angle: Optional[str] = None
    start_left: Optional[HoldSlot] = None
    start_right: Optional[HoldSlot] = None
    end: Optional[HoldSlot] = None
    foot: Optional[HoldSlot] = None


class EnvironmentResponse(BaseModel):
    """Schema for environment response."""
    id: int
    move_id: int
    wall_angle: str
    start_left: HoldSlot
    start_right: HoldSlot
    end: HoldSlot
    foot: HoldSlot


# --- Outcome Schemas (Lens 3: Outcome) ---

class OutcomeCreate(BaseModel):
    """Schema for creating an outcome record."""
    move_id: int
    result: str  # success | fall
    reach_detail: str  # reached_controlled | reached_not_controlled | didnt_reach
    confidence: Optional[str] = None  # low | med | high


class OutcomeUpdate(BaseModel):
    """Schema for updating an outcome record."""
    result: Optional[str] = None
    reach_detail: Optional[str] = None
    confidence: Optional[str] = None


class OutcomeResponse(BaseModel):
    """Schema for outcome response."""
    id: int
    move_id: int
    result: str
    reach_detail: str
    confidence: Optional[str]


# --- Frame Tag Schemas (Sensation) ---

class FrameTagCreate(BaseModel):
    """Schema for creating a frame tag."""
    move_id: int
    frame_number: int
    timestamp_ms: float
    tag_type: str
    side: Optional[str] = None  # left | right | null
    level: Optional[int] = Field(None, ge=0, le=10)
    locations: List[str] = []
    note: str = ""


class FrameTagResponse(BaseModel):
    """Schema for frame tag response."""
    id: int
    move_id: int
    frame_number: int
    timestamp_ms: float
    tag_type: str
    side: Optional[str]
    level: Optional[int]
    locations: List[str]
    note: str
    tagged_at: str


# --- Config / export / health Schemas ---

class ConfigResponse(BaseModel):
    """Schema for configuration data - complete taxonomy."""
    # Lens 2: Strategy
    approaches: List[str]
    sizes: List[str]
    move_tags: List[str]
    # Lens 1: Environment
    wall_angles: List[str]
    hold_types: List[str]
    hold_qualities: List[str]
    hold_slots: List[str]
    hold_sources: List[str]
    # Lens 3: Outcome
    results: List[str]
    reach_details: List[str]
    confidence_levels: List[str]
    # Sensation (Frame Tags)
    tag_types: dict
    body_parts: List[str]
    sides: List[str]
    # Plain-language definitions for every option above, and optional
    # display_label overrides. {taxonomy_key: {value: {description, display_label?}}}
    definitions: dict


class ExportResponse(BaseModel):
    """Schema for export response."""
    video_id: int
    r2_export_key: str


class ExportListItem(BaseModel):
    """One row in the current user's export list."""
    video_id: int
    filename: str
    r2_export_key: str
    uploaded_at: str


class HealthResponse(BaseModel):
    """Schema for the health check."""
    status: str
    database: str
    r2: str
    schema_version: Optional[int] = None


# ==================== HELPER FUNCTIONS ====================

def _iso(value: Optional[datetime]) -> str:
    return value.isoformat() if value else ""


def video_to_response(video: Video) -> VideoResponse:
    """Convert Video model to response schema."""
    return VideoResponse(
        id=video.id,
        filename=video.filename,
        fps=video.fps,
        total_frames=video.total_frames,
        duration_ms=video.duration_ms,
        width=video.width,
        height=video.height,
        r2_video_key=video.r2_video_key,
        r2_pose_csv_key=video.r2_pose_csv_key,
        r2_export_key=video.r2_export_key,
        uploaded_at=_iso(video.uploaded_at),
    )


def hold_to_response(hold: Hold) -> HoldResponse:
    """Convert Hold model to response schema."""
    return HoldResponse(
        id=hold.id,
        video_id=hold.video_id,
        bbox_x=hold.bbox_x,
        bbox_y=hold.bbox_y,
        bbox_w=hold.bbox_w,
        bbox_h=hold.bbox_h,
        source=hold.source,
        created_at=_iso(hold.created_at),
    )


def move_to_response(move: Move, user_id: str) -> MoveResponse:
    """Convert Move model to response schema."""
    tags = get_db().get_frame_tags_for_move(move.id, user_id)

    return MoveResponse(
        id=move.id,
        video_id=move.video_id,
        frame_start=move.frame_start,
        frame_end=move.frame_end,
        timestamp_start_ms=move.timestamp_start_ms,
        timestamp_end_ms=move.timestamp_end_ms,
        approach=move.approach,
        size=move.size,
        move_tags=move.move_tags,
        form_quality=move.form_quality,
        effort_level=move.effort_level,
        confidence=move.confidence or None,
        description=move.description,
        labeled_at=_iso(move.labeled_at),
        frame_tag_count=len(tags),
    )


def environment_to_response(env: Environment) -> EnvironmentResponse:
    """Convert Environment model to response schema."""
    slots = {
        slot: HoldSlot(
            hold_id=getattr(env, f'{slot}_hold_id'),
            hold_type=getattr(env, f'{slot}_hold_type'),
            hold_quality=getattr(env, f'{slot}_hold_quality') or [],
        )
        for slot in HOLD_SLOTS
    }
    return EnvironmentResponse(
        id=env.id,
        move_id=env.move_id,
        wall_angle=env.wall_angle,
        start_left=slots['start_left'],
        start_right=slots['start_right'],
        end=slots['end'],
        foot=slots['foot'],
    )


def outcome_to_response(outcome: Outcome) -> OutcomeResponse:
    """Convert Outcome model to response schema."""
    return OutcomeResponse(
        id=outcome.id,
        move_id=outcome.move_id,
        result=outcome.result,
        reach_detail=outcome.reach_detail,
        confidence=outcome.confidence or None,
    )


def frame_tag_to_response(tag: FrameTag) -> FrameTagResponse:
    """Convert FrameTag model to response schema."""
    return FrameTagResponse(
        id=tag.id,
        move_id=tag.move_id,
        frame_number=tag.frame_number,
        timestamp_ms=tag.timestamp_ms,
        tag_type=tag.tag_type,
        side=tag.side,
        level=tag.level,
        locations=tag.locations,
        note=tag.note,
        tagged_at=_iso(tag.tagged_at),
    )


def _bad_request(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


def _not_found(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


def _require_video(video_id: int, user_id: str) -> Video:
    """Fetch one of this user's videos or 404.

    Another user's video is indistinguishable from a missing one.
    """
    video = get_db().get_video(video_id, user_id)
    if not video:
        raise _not_found(f"Video {video_id} not found")
    return video


def _require_move(move_id: int, user_id: str) -> Move:
    """Fetch one of this user's moves or 404."""
    move = get_db().get_move(move_id, user_id)
    if not move:
        raise _not_found(f"Move {move_id} not found")
    return move


def _validate_slot(name: str, slot: HoldSlot, user_id: str):
    """Validate a hold slot's type, qualities and hold ownership."""
    if slot.hold_type and slot.hold_type not in HOLD_TYPES:
        raise _bad_request(
            f"Invalid {name}.hold_type: {slot.hold_type}. Must be one of: {HOLD_TYPES}"
        )
    for quality in slot.hold_quality:
        if quality not in HOLD_QUALITIES:
            raise _bad_request(
                f"Invalid {name}.hold_quality: {quality}. Must be one of: {HOLD_QUALITIES}"
            )
    if slot.hold_id is not None and not get_db().get_hold(slot.hold_id, user_id):
        raise _not_found(f"Hold {slot.hold_id} not found")


def _apply_slots_to_env(env: Environment, data, user_id: str):
    """Copy the four slot objects onto an Environment model."""
    for slot_name in HOLD_SLOTS:
        slot = getattr(data, slot_name, None)
        if slot is None:
            continue
        _validate_slot(slot_name, slot, user_id)
        setattr(env, f'{slot_name}_hold_id', slot.hold_id)
        setattr(env, f'{slot_name}_hold_type', slot.hold_type)
        setattr(env, f'{slot_name}_hold_quality', slot.hold_quality)


# ==================== HEALTH / CONFIG ====================

@app.get("/")
async def root():
    """Unauthenticated liveness probe."""
    return {"status": "ok", "message": "Dynalytix Climbing API is running"}


@app.get("/api/health", response_model=HealthResponse)
async def health():
    """Unauthenticated readiness probe: reports Postgres and R2 reachability.

    Left open deliberately - Railway's health check has no JWT to present.
    """
    database_status = 'ok'
    schema_version = None
    try:
        schema_version = get_db().check_schema()
    except SchemaNotApplied as exc:
        database_status = f'schema: {exc}'
    except Exception as exc:
        database_status = f'error: {type(exc).__name__}'

    r2_status = 'ok' if r2.is_configured() else 'not configured'

    overall = 'ok' if database_status == 'ok' and r2_status == 'ok' else 'degraded'
    return HealthResponse(
        status=overall,
        database=database_status,
        r2=r2_status,
        schema_version=schema_version,
    )


@app.get("/api/config", response_model=ConfigResponse)
async def get_config(user_id: str = Depends(get_current_user_id)):
    """Get configuration data - complete taxonomy for all three lenses."""
    return ConfigResponse(
        # Lens 2: Strategy
        approaches=APPROACHES,
        sizes=SIZES,
        move_tags=MOVE_TAGS,
        # Lens 1: Environment
        wall_angles=WALL_ANGLES,
        hold_types=HOLD_TYPES,
        hold_qualities=HOLD_QUALITIES,
        hold_slots=HOLD_SLOTS,
        hold_sources=HOLD_SOURCES,
        # Lens 3: Outcome
        results=RESULTS,
        reach_details=REACH_DETAILS,
        confidence_levels=CONFIDENCE_LEVELS,
        # Sensation (Frame Tags)
        tag_types=TAG_TYPES,
        body_parts=BODY_PARTS,
        sides=SIDES,
        # Definitions rendered as an "i" tooltip beside each option.
        definitions=DEFINITIONS,
    )


# ==================== VIDEO ENDPOINTS ====================

@app.post("/api/videos/register", response_model=VideoResponse, status_code=status.HTTP_201_CREATED)
async def register_video(
    payload: VideoRegister,
    user_id: str = Depends(get_current_user_id),
):
    """
    Register a video that was processed client-side.

    The browser sends pose CSV text plus the metadata it measured (fps,
    total_frames, duration_ms). The CSV goes straight to R2; the original video
    is uploaded separately through a presigned URL.
    """
    if len(payload.csv_data.encode('utf-8')) > MAX_REGISTER_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f'Pose CSV exceeds {MAX_REGISTER_BYTES} bytes',
        )

    db = get_db()

    # Insert first so the R2 key can carry the real video id.
    video = Video(
        user_id=user_id,
        filename=payload.filename,
        fps=payload.fps,
        total_frames=payload.total_frames,
        duration_ms=payload.duration_ms,
        width=payload.width,
        height=payload.height,
        uploaded_at=datetime.now(timezone.utc),
    )
    video.id = db.create_video(video)

    key = r2.pose_csv_key(user_id, video.id)
    try:
        r2.put_object(key, payload.csv_data, content_type='text/csv')
    except r2.R2NotConfigured as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f'Object storage unavailable: {exc}',
        )

    db.set_video_r2_keys(video.id, user_id, r2_pose_csv_key=key)
    video.r2_pose_csv_key = key

    return video_to_response(video)


@app.post("/api/videos/{video_id}/upload-url", response_model=UploadUrlResponse)
async def create_upload_url(
    video_id: int,
    payload: UploadUrlRequest,
    user_id: str = Depends(get_current_user_id),
):
    """Presigned PUT URL so the browser uploads the original video to R2 directly."""
    video = _require_video(video_id, user_id)

    key = r2.video_key(user_id, video_id, video.filename)
    expires_in = 3600
    try:
        url = r2.presigned_put_url(key, content_type=payload.content_type, expires_in=expires_in)
    except r2.R2NotConfigured as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f'Object storage unavailable: {exc}',
        )

    return UploadUrlResponse(url=url, key=key, expires_in=expires_in)


@app.post("/api/videos/{video_id}/confirm-upload", response_model=VideoResponse)
async def confirm_upload(
    video_id: int,
    payload: ConfirmUploadRequest,
    user_id: str = Depends(get_current_user_id),
):
    """Record the R2 key once the browser's direct upload has finished."""
    video = _require_video(video_id, user_id)

    key = payload.key or r2.video_key(user_id, video_id, video.filename)

    # Never let a client point a row at another user's prefix.
    if not key.startswith(f'videos/{user_id}/'):
        raise _bad_request('Key does not belong to this user')

    get_db().set_video_r2_keys(video_id, user_id, r2_video_key=key)
    video.r2_video_key = key
    return video_to_response(video)


@app.get("/api/videos", response_model=List[VideoResponse])
async def list_videos(user_id: str = Depends(get_current_user_id)):
    """Get all of the current user's videos."""
    return [video_to_response(v) for v in get_db().get_all_videos(user_id)]


@app.get("/api/videos/{video_id}", response_model=VideoResponse)
async def get_video(video_id: int, user_id: str = Depends(get_current_user_id)):
    """Get a specific video by ID."""
    return video_to_response(_require_video(video_id, user_id))


@app.get("/api/videos/{video_id}/csv")
async def get_video_csv(video_id: int, user_id: str = Depends(get_current_user_id)):
    """Redirect to a presigned URL for the raw pose CSV."""
    video = _require_video(video_id, user_id)
    if not video.r2_pose_csv_key:
        raise _not_found("No pose CSV stored for this video")

    url = r2.presigned_get_url(
        video.r2_pose_csv_key,
        download_filename=f'{video.filename}.csv',
    )
    return RedirectResponse(url=url, status_code=status.HTTP_307_TEMPORARY_REDIRECT)


@app.post("/api/videos/{video_id}/export", response_model=ExportResponse)
async def export_video_endpoint(video_id: int, user_id: str = Depends(get_current_user_id)):
    """
    Export labeled data for a video.

    Streams the pose CSV out of R2, joins the labels from Postgres and writes
    the result back to R2, recording the key on the video row.
    """
    _require_video(video_id, user_id)

    try:
        key = get_exporter().export_video(video_id, user_id)
    except ValueError as exc:
        raise _not_found(str(exc))
    except r2.R2NotConfigured as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f'Object storage unavailable: {exc}',
        )

    return ExportResponse(video_id=video_id, r2_export_key=key)


@app.get("/api/videos/{video_id}/export/download")
async def download_export(video_id: int, user_id: str = Depends(get_current_user_id)):
    """Redirect to a presigned URL for the labeled export."""
    video = _require_video(video_id, user_id)
    if not video.r2_export_key:
        raise _not_found("Export not found. Run export first.")

    url = r2.presigned_get_url(
        video.r2_export_key,
        download_filename=f'{video.filename}_labeled.csv',
    )
    return RedirectResponse(url=url, status_code=status.HTTP_307_TEMPORARY_REDIRECT)


@app.get("/api/exports/mine", response_model=List[ExportListItem])
async def list_my_exports(user_id: str = Depends(get_current_user_id)):
    """List the current user's exports."""
    return [
        ExportListItem(
            video_id=v.id,
            filename=v.filename,
            r2_export_key=v.r2_export_key,
            uploaded_at=_iso(v.uploaded_at),
        )
        for v in get_db().get_videos_with_exports(user_id)
    ]


# ==================== HOLD ENDPOINTS ====================

@app.post("/api/holds", response_model=HoldResponse, status_code=status.HTTP_201_CREATED)
async def create_hold(hold_data: HoldCreate, user_id: str = Depends(get_current_user_id)):
    """Mark a hold on a video."""
    _require_video(hold_data.video_id, user_id)

    if hold_data.source not in HOLD_SOURCES:
        raise _bad_request(
            f"Invalid source: {hold_data.source}. Must be one of: {HOLD_SOURCES}"
        )

    hold = Hold(
        video_id=hold_data.video_id,
        user_id=user_id,
        bbox_x=hold_data.bbox_x,
        bbox_y=hold_data.bbox_y,
        bbox_w=hold_data.bbox_w,
        bbox_h=hold_data.bbox_h,
        source=hold_data.source,
        created_at=datetime.now(timezone.utc),
    )
    hold.id = get_db().create_hold(hold)
    return hold_to_response(hold)


@app.get("/api/videos/{video_id}/holds", response_model=List[HoldResponse])
async def list_holds(video_id: int, user_id: str = Depends(get_current_user_id)):
    """Get all holds marked on a video."""
    _require_video(video_id, user_id)
    return [hold_to_response(h) for h in get_db().get_holds_for_video(video_id, user_id)]


@app.post(
    "/api/videos/{video_id}/holds",
    response_model=List[HoldResponse],
    status_code=status.HTTP_201_CREATED,
)
async def create_holds_bulk(
    video_id: int,
    payload: HoldBulkCreate,
    user_id: str = Depends(get_current_user_id),
):
    """Mark many holds on a video at once.

    This is what the in-browser detector posts after it runs on the first
    frame: one request for the whole wall, in one transaction, so a failure
    part-way through leaves no holds rather than a partial set.
    """
    # Shape checks first: a runaway payload is rejected without a DB round trip.
    if len(payload.holds) > MAX_HOLDS_PER_REQUEST:
        raise _bad_request(
            f'Too many holds in one request: {len(payload.holds)}. '
            f'Maximum is {MAX_HOLDS_PER_REQUEST}.'
        )
    for hold in payload.holds:
        if hold.source not in HOLD_SOURCES:
            raise _bad_request(
                f"Invalid source: {hold.source}. Must be one of: {HOLD_SOURCES}"
            )

    _require_video(video_id, user_id)

    if not payload.holds:
        return []

    now = datetime.now(timezone.utc)
    holds = [
        Hold(
            video_id=video_id,
            user_id=user_id,
            bbox_x=h.bbox_x,
            bbox_y=h.bbox_y,
            bbox_w=h.bbox_w,
            bbox_h=h.bbox_h,
            source=h.source,
            created_at=now,
        )
        for h in payload.holds
    ]

    ids = get_db().create_holds_bulk(holds)
    for hold, hold_id in zip(holds, ids):
        hold.id = hold_id
    return [hold_to_response(h) for h in holds]


@app.put("/api/holds/{hold_id}", response_model=HoldResponse)
async def update_hold(
    hold_id: int,
    payload: HoldUpdate,
    user_id: str = Depends(get_current_user_id),
):
    """Move or resize a hold, or change whether it is detected or manual."""
    if payload.source is not None and payload.source not in HOLD_SOURCES:
        raise _bad_request(
            f"Invalid source: {payload.source}. Must be one of: {HOLD_SOURCES}"
        )

    updated = get_db().update_hold(
        hold_id,
        user_id,
        bbox_x=payload.bbox_x,
        bbox_y=payload.bbox_y,
        bbox_w=payload.bbox_w,
        bbox_h=payload.bbox_h,
        source=payload.source,
    )
    if updated is None:
        raise _not_found(f"Hold {hold_id} not found")
    return hold_to_response(updated)


@app.delete("/api/holds/{hold_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_hold(hold_id: int, user_id: str = Depends(get_current_user_id)):
    """Delete a hold."""
    if not get_db().delete_hold(hold_id, user_id):
        raise _not_found(f"Hold {hold_id} not found")
    return None


# ==================== MOVE ENDPOINTS ====================

@app.post("/api/moves", response_model=MoveResponse, status_code=status.HTTP_201_CREATED)
async def create_move(move_data: MoveCreate, user_id: str = Depends(get_current_user_id)):
    """Create a new move."""
    _require_video(move_data.video_id, user_id)

    if move_data.approach not in APPROACHES:
        raise _bad_request(
            f"Invalid approach: {move_data.approach}. Must be one of: {APPROACHES}"
        )
    if move_data.size not in SIZES:
        raise _bad_request(f"Invalid size: {move_data.size}. Must be one of: {SIZES}")
    for tag in move_data.move_tags:
        if tag not in MOVE_TAGS:
            raise _bad_request(f"Invalid move tag: {tag}. Must be one of: {MOVE_TAGS}")
    if move_data.confidence is not None and move_data.confidence not in CONFIDENCE_LEVELS:
        raise _bad_request(
            f"Invalid confidence: {move_data.confidence}. Must be one of: {CONFIDENCE_LEVELS}"
        )

    move = Move(
        video_id=move_data.video_id,
        user_id=user_id,
        frame_start=move_data.frame_start,
        frame_end=move_data.frame_end,
        timestamp_start_ms=move_data.timestamp_start_ms,
        timestamp_end_ms=move_data.timestamp_end_ms,
        approach=move_data.approach,
        size=move_data.size,
        move_tags=move_data.move_tags,
        form_quality=move_data.form_quality,
        effort_level=move_data.effort_level,
        confidence=move_data.confidence or '',
        description=move_data.description,
        labeled_at=datetime.now(timezone.utc),
    )
    move.id = get_db().create_move(move)

    return move_to_response(move, user_id)


@app.get("/api/videos/{video_id}/moves", response_model=List[MoveResponse])
async def list_moves(video_id: int, user_id: str = Depends(get_current_user_id)):
    """Get all moves for a video."""
    _require_video(video_id, user_id)
    moves = get_db().get_moves_for_video(video_id, user_id)
    return [move_to_response(m, user_id) for m in moves]


@app.get("/api/moves/{move_id}", response_model=MoveResponse)
async def get_move(move_id: int, user_id: str = Depends(get_current_user_id)):
    """Get a specific move by ID."""
    return move_to_response(_require_move(move_id, user_id), user_id)


@app.put("/api/moves/{move_id}", response_model=MoveResponse)
async def update_move(
    move_id: int,
    move_data: MoveUpdate,
    user_id: str = Depends(get_current_user_id),
):
    """Update an existing move."""
    move = _require_move(move_id, user_id)

    if move_data.approach is not None:
        if move_data.approach not in APPROACHES:
            raise _bad_request(f"Invalid approach: {move_data.approach}")
        move.approach = move_data.approach
    if move_data.size is not None:
        if move_data.size not in SIZES:
            raise _bad_request(f"Invalid size: {move_data.size}")
        move.size = move_data.size
    if move_data.move_tags is not None:
        for tag in move_data.move_tags:
            if tag not in MOVE_TAGS:
                raise _bad_request(f"Invalid move tag: {tag}")
        move.move_tags = move_data.move_tags
    if move_data.confidence is not None:
        if move_data.confidence not in CONFIDENCE_LEVELS:
            raise _bad_request(f"Invalid confidence: {move_data.confidence}")
        move.confidence = move_data.confidence
    if move_data.frame_start is not None:
        move.frame_start = move_data.frame_start
    if move_data.frame_end is not None:
        move.frame_end = move_data.frame_end
    if move_data.timestamp_start_ms is not None:
        move.timestamp_start_ms = move_data.timestamp_start_ms
    if move_data.timestamp_end_ms is not None:
        move.timestamp_end_ms = move_data.timestamp_end_ms
    if move_data.form_quality is not None:
        move.form_quality = move_data.form_quality
    if move_data.effort_level is not None:
        move.effort_level = move_data.effort_level
    if move_data.description is not None:
        move.description = move_data.description

    get_db().update_move(move)

    return move_to_response(move, user_id)


@app.delete("/api/moves/{move_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_move(move_id: int, user_id: str = Depends(get_current_user_id)):
    """Delete a move and its frame tags, environment, and outcome."""
    if not get_db().delete_move(move_id, user_id):
        raise _not_found(f"Move {move_id} not found")
    return None


# ==================== ENVIRONMENT ENDPOINTS (Lens 1) ====================

@app.post("/api/environments", response_model=EnvironmentResponse, status_code=status.HTTP_201_CREATED)
async def create_environment(
    env_data: EnvironmentCreate,
    user_id: str = Depends(get_current_user_id),
):
    """Create an environment record for a move."""
    _require_move(env_data.move_id, user_id)

    if get_db().get_environment_for_move(env_data.move_id, user_id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Environment already exists for move {env_data.move_id}. Use PUT to update.",
        )

    if env_data.wall_angle not in WALL_ANGLES:
        raise _bad_request(
            f"Invalid wall_angle: {env_data.wall_angle}. Must be one of: {WALL_ANGLES}"
        )

    env = Environment(
        move_id=env_data.move_id,
        user_id=user_id,
        wall_angle=env_data.wall_angle,
    )
    _apply_slots_to_env(env, env_data, user_id)

    env.id = get_db().create_environment(env)
    return environment_to_response(env)


@app.get("/api/moves/{move_id}/environment", response_model=EnvironmentResponse)
async def get_environment(move_id: int, user_id: str = Depends(get_current_user_id)):
    """Get the environment record for a move."""
    _require_move(move_id, user_id)

    env = get_db().get_environment_for_move(move_id, user_id)
    if not env:
        raise _not_found(f"No environment record for move {move_id}")

    return environment_to_response(env)


@app.put("/api/environments/{env_id}", response_model=EnvironmentResponse)
async def update_environment(
    env_id: int,
    env_data: EnvironmentUpdate,
    user_id: str = Depends(get_current_user_id),
):
    """Update an environment record."""
    env = get_db().get_environment(env_id, user_id)
    if not env:
        raise _not_found(f"Environment {env_id} not found")

    if env_data.wall_angle is not None:
        if env_data.wall_angle not in WALL_ANGLES:
            raise _bad_request(f"Invalid wall_angle: {env_data.wall_angle}")
        env.wall_angle = env_data.wall_angle

    _apply_slots_to_env(env, env_data, user_id)

    get_db().update_environment(env)
    return environment_to_response(env)


# ==================== OUTCOME ENDPOINTS (Lens 3) ====================

@app.post("/api/outcomes", response_model=OutcomeResponse, status_code=status.HTTP_201_CREATED)
async def create_outcome(
    outcome_data: OutcomeCreate,
    user_id: str = Depends(get_current_user_id),
):
    """Create an outcome record for a move."""
    _require_move(outcome_data.move_id, user_id)

    if get_db().get_outcome_for_move(outcome_data.move_id, user_id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Outcome already exists for move {outcome_data.move_id}. Use PUT to update.",
        )

    if outcome_data.result not in RESULTS:
        raise _bad_request(f"Invalid result: {outcome_data.result}. Must be one of: {RESULTS}")
    if outcome_data.reach_detail not in REACH_DETAILS:
        raise _bad_request(
            f"Invalid reach_detail: {outcome_data.reach_detail}. Must be one of: {REACH_DETAILS}"
        )
    if outcome_data.confidence is not None and outcome_data.confidence not in CONFIDENCE_LEVELS:
        raise _bad_request(
            f"Invalid confidence: {outcome_data.confidence}. Must be one of: {CONFIDENCE_LEVELS}"
        )

    outcome = Outcome(
        move_id=outcome_data.move_id,
        user_id=user_id,
        result=outcome_data.result,
        reach_detail=outcome_data.reach_detail,
        confidence=outcome_data.confidence or '',
    )
    outcome.id = get_db().create_outcome(outcome)

    return outcome_to_response(outcome)


@app.get("/api/moves/{move_id}/outcome", response_model=OutcomeResponse)
async def get_outcome(move_id: int, user_id: str = Depends(get_current_user_id)):
    """Get the outcome record for a move."""
    _require_move(move_id, user_id)

    outcome = get_db().get_outcome_for_move(move_id, user_id)
    if not outcome:
        raise _not_found(f"No outcome record for move {move_id}")

    return outcome_to_response(outcome)


@app.put("/api/outcomes/{outcome_id}", response_model=OutcomeResponse)
async def update_outcome(
    outcome_id: int,
    outcome_data: OutcomeUpdate,
    user_id: str = Depends(get_current_user_id),
):
    """Update an outcome record."""
    outcome = get_db().get_outcome(outcome_id, user_id)
    if not outcome:
        raise _not_found(f"Outcome {outcome_id} not found")

    if outcome_data.result is not None:
        if outcome_data.result not in RESULTS:
            raise _bad_request(f"Invalid result: {outcome_data.result}")
        outcome.result = outcome_data.result
    if outcome_data.reach_detail is not None:
        if outcome_data.reach_detail not in REACH_DETAILS:
            raise _bad_request(f"Invalid reach_detail: {outcome_data.reach_detail}")
        outcome.reach_detail = outcome_data.reach_detail
    if outcome_data.confidence is not None:
        if outcome_data.confidence not in CONFIDENCE_LEVELS:
            raise _bad_request(f"Invalid confidence: {outcome_data.confidence}")
        outcome.confidence = outcome_data.confidence

    get_db().update_outcome(outcome)
    return outcome_to_response(outcome)


# ==================== FRAME TAG ENDPOINTS ====================

@app.post("/api/frame-tags", response_model=FrameTagResponse, status_code=status.HTTP_201_CREATED)
async def create_frame_tag(
    tag_data: FrameTagCreate,
    user_id: str = Depends(get_current_user_id),
):
    """Create a new frame tag."""
    _require_move(tag_data.move_id, user_id)

    if tag_data.tag_type not in TAG_TYPES:
        raise _bad_request(
            f"Invalid tag type: {tag_data.tag_type}. Must be one of: {list(TAG_TYPES.keys())}"
        )
    if tag_data.side is not None and tag_data.side not in SIDES:
        raise _bad_request(f"Invalid side: {tag_data.side}. Must be one of: {SIDES}")
    for loc in tag_data.locations:
        if loc not in BODY_PARTS:
            raise _bad_request(f"Invalid body part: {loc}. Must be one of: {BODY_PARTS}")

    tag = FrameTag(
        move_id=tag_data.move_id,
        user_id=user_id,
        frame_number=tag_data.frame_number,
        timestamp_ms=tag_data.timestamp_ms,
        tag_type=tag_data.tag_type,
        side=tag_data.side,
        level=tag_data.level,
        locations=tag_data.locations,
        note=tag_data.note,
        tagged_at=datetime.now(timezone.utc),
    )
    tag.id = get_db().create_frame_tag(tag)

    return frame_tag_to_response(tag)


@app.get("/api/moves/{move_id}/frame-tags", response_model=List[FrameTagResponse])
async def list_frame_tags(move_id: int, user_id: str = Depends(get_current_user_id)):
    """Get all frame tags for a move."""
    _require_move(move_id, user_id)
    tags = get_db().get_frame_tags_for_move(move_id, user_id)
    return [frame_tag_to_response(t) for t in tags]


@app.delete("/api/frame-tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_frame_tag(tag_id: int, user_id: str = Depends(get_current_user_id)):
    """Delete a frame tag."""
    if not get_db().delete_frame_tag(tag_id, user_id):
        raise _not_found(f"Frame tag {tag_id} not found")
    return None


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
