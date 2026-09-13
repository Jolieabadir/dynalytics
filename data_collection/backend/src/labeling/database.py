"""
Database layer for labeling system.

Handles all Postgres operations against Supabase via psycopg v3. Models know
nothing about the database. Raw SQL throughout - no ORM.

Schema version 3: per-user scoping, holds with normalized bounding boxes,
slot-based environments, R2 object keys instead of local paths.

DDL lives in supabase/migrations/*_schema_v3.sql, which is the single source of
truth. This module never creates tables outside of apply_schema_sql(), which
exists so tests can build a fresh schema without the Supabase CLI.
"""
import os
from pathlib import Path
from typing import Optional, List
from datetime import datetime, timezone
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

from .models import Video, Hold, Move, Environment, Outcome, FrameTag, HOLD_SLOTS

SCHEMA_VERSION = 3


class SchemaNotApplied(RuntimeError):
    """Raised when the database has not had the v3 migration applied."""


class Database:
    """
    Database handler with clean separation of concerns.

    Every read, update and delete is scoped by user_id so one climber can never
    reach another's rows even if they guess an id. Create takes the user_id off
    the model instance.

    Usage:
        db = Database()            # reads DATABASE_URL from the environment
        db.check_schema()

        video_id = db.create_video(video)
        video = db.get_video(video_id, user_id)
        moves = db.get_moves_for_video(video_id, user_id)
    """

    def __init__(self, dsn: Optional[str] = None, min_size: int = 1, max_size: int = 5):
        """Initialize the connection pool.

        Args:
            dsn: Postgres connection string. Defaults to $DATABASE_URL.
            min_size/max_size: pool bounds. Small by default because Railway
                runs a single container and Supabase's pooler charges per
                connection.
        """
        self.dsn = dsn or os.environ.get('DATABASE_URL')
        if not self.dsn:
            raise RuntimeError(
                'DATABASE_URL is not set. Point it at the Supabase Postgres '
                'connection string (session or transaction pooler).'
            )
        self.pool = ConnectionPool(
            self.dsn,
            min_size=min_size,
            max_size=max_size,
            kwargs={'row_factory': dict_row},
            configure=self._configure_connection,
            open=True,
        )

    @staticmethod
    def _configure_connection(conn):
        """Prepare each pooled connection.

        Supabase's transaction pooler (pgbouncer, port 6543) multiplexes
        connections per transaction, so a prepared statement created on one
        backend is not there on the next - psycopg3's automatic prepared
        statements raise DuplicatePreparedStatement against it. Disabling the
        threshold keeps every statement unprepared, which is what the pooler
        requires. Harmless on a direct connection.
        """
        conn.prepare_threshold = None

    def close(self):
        """Close the pool. Call on application shutdown."""
        self.pool.close()

    @contextmanager
    def get_connection(self):
        """Context manager for pooled connections, committing on clean exit."""
        with self.pool.connection() as conn:
            # psycopg commits on clean block exit and rolls back on exception.
            yield conn

    # ==================== SCHEMA ====================

    def check_schema(self) -> int:
        """Return the applied schema version, raising if the migration is missing."""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('SELECT MAX(version) AS version FROM schema_version')
                row = cursor.fetchone()
        except psycopg.errors.UndefinedTable as exc:
            raise SchemaNotApplied(
                'schema_version table is missing - apply '
                'supabase/migrations/*_schema_v3.sql before starting the API.'
            ) from exc

        version = row['version'] if row and row['version'] is not None else 0
        if version != SCHEMA_VERSION:
            raise SchemaNotApplied(
                f'Database is at schema version {version}, expected {SCHEMA_VERSION}.'
            )
        return version

    def get_schema_version(self) -> int:
        """Get the current schema version, or 0 when nothing is applied."""
        try:
            return self.check_schema()
        except SchemaNotApplied:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute(
                    "SELECT to_regclass('public.schema_version') AS t"
                )
                if not cursor.fetchone()['t']:
                    return 0
                cursor.execute('SELECT MAX(version) AS version FROM schema_version')
                row = cursor.fetchone()
                return row['version'] if row and row['version'] is not None else 0

    def apply_schema_sql(self, sql_path: Optional[str] = None):
        """Execute the v3 migration file.

        Used by the test suite to build a fresh schema. Production applies the
        same file through `supabase db push`.
        """
        if sql_path is None:
            candidates = sorted(
                Path(__file__).resolve().parents[2].glob('supabase/migrations/*_schema_v3.sql')
            )
            if not candidates:
                raise FileNotFoundError('No *_schema_v3.sql migration found')
            sql_path = str(candidates[-1])

        sql = Path(sql_path).read_text()
        with self.get_connection() as conn:
            conn.execute(sql)

    # ==================== VIDEO OPERATIONS ====================

    def create_video(self, video: Video) -> int:
        """Create a new video record. Returns video_id."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO videos (
                    user_id, filename, fps, total_frames, duration_ms,
                    r2_video_key, r2_pose_csv_key, r2_export_key, uploaded_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            ''', (
                video.user_id,
                video.filename,
                video.fps,
                video.total_frames,
                video.duration_ms,
                video.r2_video_key,
                video.r2_pose_csv_key,
                video.r2_export_key,
                video.uploaded_at or datetime.now(timezone.utc),
            ))
            return cursor.fetchone()['id']

    def get_video(self, video_id: int, user_id: str) -> Optional[Video]:
        """Get one of this user's videos by ID."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                'SELECT * FROM videos WHERE id = %s AND user_id = %s',
                (video_id, user_id)
            )
            row = cursor.fetchone()
            return self._row_to_video(row) if row else None

    def get_all_videos(self, user_id: str) -> List[Video]:
        """Get all of this user's videos, newest first."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                'SELECT * FROM videos WHERE user_id = %s ORDER BY uploaded_at DESC',
                (user_id,)
            )
            return [self._row_to_video(row) for row in cursor.fetchall()]

    def set_video_r2_keys(
        self,
        video_id: int,
        user_id: str,
        r2_video_key: Optional[str] = None,
        r2_pose_csv_key: Optional[str] = None,
        r2_export_key: Optional[str] = None,
    ) -> bool:
        """Record one or more R2 keys on a video. Only the keys passed are written."""
        sets, params = [], []
        for column, value in (
            ('r2_video_key', r2_video_key),
            ('r2_pose_csv_key', r2_pose_csv_key),
            ('r2_export_key', r2_export_key),
        ):
            if value is not None:
                sets.append(f'{column} = %s')
                params.append(value)
        if not sets:
            return False

        params.extend([video_id, user_id])
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                f'UPDATE videos SET {", ".join(sets)} WHERE id = %s AND user_id = %s',
                tuple(params)
            )
            return cursor.rowcount > 0

    def get_videos_with_exports(self, user_id: str) -> List[Video]:
        """Get this user's videos that have an export stored in R2."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                'SELECT * FROM videos WHERE user_id = %s AND r2_export_key IS NOT NULL '
                'ORDER BY uploaded_at DESC',
                (user_id,)
            )
            return [self._row_to_video(row) for row in cursor.fetchall()]

    # ==================== HOLD OPERATIONS ====================

    def create_hold(self, hold: Hold) -> int:
        """Create a new hold. Returns hold_id."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO holds (
                    video_id, user_id, bbox_x, bbox_y, bbox_w, bbox_h, source, created_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            ''', (
                hold.video_id,
                hold.user_id,
                hold.bbox_x,
                hold.bbox_y,
                hold.bbox_w,
                hold.bbox_h,
                hold.source,
                hold.created_at or datetime.now(timezone.utc),
            ))
            return cursor.fetchone()['id']

    def get_hold(self, hold_id: int, user_id: str) -> Optional[Hold]:
        """Get one of this user's holds by ID."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                'SELECT * FROM holds WHERE id = %s AND user_id = %s',
                (hold_id, user_id)
            )
            row = cursor.fetchone()
            return self._row_to_hold(row) if row else None

    def get_holds_for_video(self, video_id: int, user_id: str) -> List[Hold]:
        """Get all holds marked on a video."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                'SELECT * FROM holds WHERE video_id = %s AND user_id = %s ORDER BY id',
                (video_id, user_id)
            )
            return [self._row_to_hold(row) for row in cursor.fetchall()]

    def delete_hold(self, hold_id: int, user_id: str) -> bool:
        """Delete a hold. Returns success."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                'DELETE FROM holds WHERE id = %s AND user_id = %s',
                (hold_id, user_id)
            )
            return cursor.rowcount > 0

    # ==================== MOVE OPERATIONS ====================

    def create_move(self, move: Move) -> int:
        """Create a new move. Returns move_id."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO moves (
                    video_id, user_id, frame_start, frame_end,
                    timestamp_start_ms, timestamp_end_ms,
                    approach, move_tags, size, form_quality, effort_level,
                    confidence, description, labeled_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            ''', (
                move.video_id,
                move.user_id,
                move.frame_start,
                move.frame_end,
                move.timestamp_start_ms,
                move.timestamp_end_ms,
                move.approach,
                Jsonb(move.move_tags),
                move.size,
                move.form_quality,
                move.effort_level,
                move.confidence,
                move.description,
                move.labeled_at or datetime.now(timezone.utc),
            ))
            return cursor.fetchone()['id']

    def get_move(self, move_id: int, user_id: str) -> Optional[Move]:
        """Get one of this user's moves by ID."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                'SELECT * FROM moves WHERE id = %s AND user_id = %s',
                (move_id, user_id)
            )
            row = cursor.fetchone()
            return self._row_to_move(row) if row else None

    def get_moves_for_video(self, video_id: int, user_id: str) -> List[Move]:
        """Get all moves for a video."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                'SELECT * FROM moves WHERE video_id = %s AND user_id = %s ORDER BY frame_start',
                (video_id, user_id)
            )
            return [self._row_to_move(row) for row in cursor.fetchall()]

    def update_move(self, move: Move) -> bool:
        """Update an existing move. Returns success."""
        if not move.id:
            return False

        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                UPDATE moves SET
                    frame_start = %s,
                    frame_end = %s,
                    timestamp_start_ms = %s,
                    timestamp_end_ms = %s,
                    approach = %s,
                    move_tags = %s,
                    size = %s,
                    form_quality = %s,
                    effort_level = %s,
                    confidence = %s,
                    description = %s
                WHERE id = %s AND user_id = %s
            ''', (
                move.frame_start,
                move.frame_end,
                move.timestamp_start_ms,
                move.timestamp_end_ms,
                move.approach,
                Jsonb(move.move_tags),
                move.size,
                move.form_quality,
                move.effort_level,
                move.confidence,
                move.description,
                move.id,
                move.user_id,
            ))
            return cursor.rowcount > 0

    def delete_move(self, move_id: int, user_id: str) -> bool:
        """Delete a move and its related records. Returns success."""
        with self.get_connection() as conn:
            cursor = conn.cursor()

            # Children first - the FKs are not ON DELETE CASCADE so that a
            # partial delete can never orphan a row behind a user's back.
            cursor.execute(
                'DELETE FROM frame_tags WHERE move_id = %s AND user_id = %s',
                (move_id, user_id)
            )
            cursor.execute(
                'DELETE FROM environments WHERE move_id = %s AND user_id = %s',
                (move_id, user_id)
            )
            cursor.execute(
                'DELETE FROM outcomes WHERE move_id = %s AND user_id = %s',
                (move_id, user_id)
            )
            cursor.execute(
                'DELETE FROM moves WHERE id = %s AND user_id = %s',
                (move_id, user_id)
            )
            return cursor.rowcount > 0

    # ==================== ENVIRONMENT OPERATIONS ====================

    def create_environment(self, env: Environment) -> int:
        """Create a new environment record. Returns environment_id."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO environments (
                    move_id, user_id, wall_angle,
                    start_left_hold_id, start_left_hold_type, start_left_hold_quality,
                    start_right_hold_id, start_right_hold_type, start_right_hold_quality,
                    end_hold_id, end_hold_type, end_hold_quality,
                    foot_hold_id, foot_hold_type, foot_hold_quality
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            ''', (
                env.move_id,
                env.user_id,
                env.wall_angle,
                env.start_left_hold_id,
                env.start_left_hold_type,
                Jsonb(env.start_left_hold_quality),
                env.start_right_hold_id,
                env.start_right_hold_type,
                Jsonb(env.start_right_hold_quality),
                env.end_hold_id,
                env.end_hold_type,
                Jsonb(env.end_hold_quality),
                env.foot_hold_id,
                env.foot_hold_type,
                Jsonb(env.foot_hold_quality),
            ))
            return cursor.fetchone()['id']

    def get_environment(self, env_id: int, user_id: str) -> Optional[Environment]:
        """Get an environment by ID."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                'SELECT * FROM environments WHERE id = %s AND user_id = %s',
                (env_id, user_id)
            )
            row = cursor.fetchone()
            return self._row_to_environment(row) if row else None

    def get_environment_for_move(self, move_id: int, user_id: str) -> Optional[Environment]:
        """Get the environment for a move."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                'SELECT * FROM environments WHERE move_id = %s AND user_id = %s',
                (move_id, user_id)
            )
            row = cursor.fetchone()
            return self._row_to_environment(row) if row else None

    def update_environment(self, env: Environment) -> bool:
        """Update an existing environment. Returns success."""
        if not env.id:
            return False

        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                UPDATE environments SET
                    wall_angle = %s,
                    start_left_hold_id = %s,
                    start_left_hold_type = %s,
                    start_left_hold_quality = %s,
                    start_right_hold_id = %s,
                    start_right_hold_type = %s,
                    start_right_hold_quality = %s,
                    end_hold_id = %s,
                    end_hold_type = %s,
                    end_hold_quality = %s,
                    foot_hold_id = %s,
                    foot_hold_type = %s,
                    foot_hold_quality = %s
                WHERE id = %s AND user_id = %s
            ''', (
                env.wall_angle,
                env.start_left_hold_id,
                env.start_left_hold_type,
                Jsonb(env.start_left_hold_quality),
                env.start_right_hold_id,
                env.start_right_hold_type,
                Jsonb(env.start_right_hold_quality),
                env.end_hold_id,
                env.end_hold_type,
                Jsonb(env.end_hold_quality),
                env.foot_hold_id,
                env.foot_hold_type,
                Jsonb(env.foot_hold_quality),
                env.id,
                env.user_id,
            ))
            return cursor.rowcount > 0

    def delete_environment(self, env_id: int, user_id: str) -> bool:
        """Delete an environment. Returns success."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                'DELETE FROM environments WHERE id = %s AND user_id = %s',
                (env_id, user_id)
            )
            return cursor.rowcount > 0

    # ==================== OUTCOME OPERATIONS ====================

    def create_outcome(self, outcome: Outcome) -> int:
        """Create a new outcome record. Returns outcome_id."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO outcomes (move_id, user_id, result, reach_detail, confidence)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id
            ''', (
                outcome.move_id,
                outcome.user_id,
                outcome.result,
                outcome.reach_detail,
                outcome.confidence,
            ))
            return cursor.fetchone()['id']

    def get_outcome(self, outcome_id: int, user_id: str) -> Optional[Outcome]:
        """Get an outcome by ID."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                'SELECT * FROM outcomes WHERE id = %s AND user_id = %s',
                (outcome_id, user_id)
            )
            row = cursor.fetchone()
            return self._row_to_outcome(row) if row else None

    def get_outcome_for_move(self, move_id: int, user_id: str) -> Optional[Outcome]:
        """Get the outcome for a move."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                'SELECT * FROM outcomes WHERE move_id = %s AND user_id = %s',
                (move_id, user_id)
            )
            row = cursor.fetchone()
            return self._row_to_outcome(row) if row else None

    def update_outcome(self, outcome: Outcome) -> bool:
        """Update an existing outcome. Returns success."""
        if not outcome.id:
            return False

        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                UPDATE outcomes SET
                    result = %s,
                    reach_detail = %s,
                    confidence = %s
                WHERE id = %s AND user_id = %s
            ''', (
                outcome.result,
                outcome.reach_detail,
                outcome.confidence,
                outcome.id,
                outcome.user_id,
            ))
            return cursor.rowcount > 0

    def delete_outcome(self, outcome_id: int, user_id: str) -> bool:
        """Delete an outcome. Returns success."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                'DELETE FROM outcomes WHERE id = %s AND user_id = %s',
                (outcome_id, user_id)
            )
            return cursor.rowcount > 0

    # ==================== FRAME TAG OPERATIONS ====================

    def create_frame_tag(self, tag: FrameTag) -> int:
        """Create a new frame tag. Returns tag_id."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO frame_tags (
                    move_id, user_id, frame_number, timestamp_ms,
                    tag_type, side, level, locations, note, tagged_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            ''', (
                tag.move_id,
                tag.user_id,
                tag.frame_number,
                tag.timestamp_ms,
                tag.tag_type,
                tag.side,
                tag.level,
                Jsonb(tag.locations),
                tag.note,
                tag.tagged_at or datetime.now(timezone.utc),
            ))
            return cursor.fetchone()['id']

    def get_frame_tag(self, tag_id: int, user_id: str) -> Optional[FrameTag]:
        """Get a frame tag by ID."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                'SELECT * FROM frame_tags WHERE id = %s AND user_id = %s',
                (tag_id, user_id)
            )
            row = cursor.fetchone()
            return self._row_to_frame_tag(row) if row else None

    def get_frame_tags_for_move(self, move_id: int, user_id: str) -> List[FrameTag]:
        """Get all frame tags for a move."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                'SELECT * FROM frame_tags WHERE move_id = %s AND user_id = %s '
                'ORDER BY frame_number',
                (move_id, user_id)
            )
            return [self._row_to_frame_tag(row) for row in cursor.fetchall()]

    def delete_frame_tag(self, tag_id: int, user_id: str) -> bool:
        """Delete a frame tag. Returns success."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                'DELETE FROM frame_tags WHERE id = %s AND user_id = %s',
                (tag_id, user_id)
            )
            return cursor.rowcount > 0

    # ==================== HELPER METHODS ====================

    @staticmethod
    def _row_to_video(row: dict) -> Video:
        """Convert database row to Video object."""
        return Video(
            id=row['id'],
            user_id=str(row['user_id']),
            filename=row['filename'],
            fps=row['fps'],
            total_frames=row['total_frames'],
            duration_ms=row['duration_ms'],
            r2_video_key=row['r2_video_key'],
            r2_pose_csv_key=row['r2_pose_csv_key'],
            r2_export_key=row['r2_export_key'],
            uploaded_at=row['uploaded_at'],
        )

    @staticmethod
    def _row_to_hold(row: dict) -> Hold:
        """Convert database row to Hold object."""
        return Hold(
            id=row['id'],
            video_id=row['video_id'],
            user_id=str(row['user_id']),
            bbox_x=row['bbox_x'],
            bbox_y=row['bbox_y'],
            bbox_w=row['bbox_w'],
            bbox_h=row['bbox_h'],
            source=row['source'],
            created_at=row['created_at'],
        )

    @staticmethod
    def _row_to_move(row: dict) -> Move:
        """Convert database row to Move object."""
        return Move(
            id=row['id'],
            video_id=row['video_id'],
            user_id=str(row['user_id']),
            frame_start=row['frame_start'],
            frame_end=row['frame_end'],
            timestamp_start_ms=row['timestamp_start_ms'],
            timestamp_end_ms=row['timestamp_end_ms'],
            approach=row['approach'],
            move_tags=row['move_tags'] or [],
            size=row['size'],
            form_quality=row['form_quality'],
            effort_level=row['effort_level'],
            confidence=row['confidence'] or '',
            description=row['description'] or '',
            labeled_at=row['labeled_at'],
        )

    @staticmethod
    def _row_to_environment(row: dict) -> Environment:
        """Convert database row to Environment object."""
        kwargs = {
            'id': row['id'],
            'move_id': row['move_id'],
            'user_id': str(row['user_id']),
            'wall_angle': row['wall_angle'],
        }
        for slot in HOLD_SLOTS:
            kwargs[f'{slot}_hold_id'] = row[f'{slot}_hold_id']
            kwargs[f'{slot}_hold_type'] = row[f'{slot}_hold_type']
            kwargs[f'{slot}_hold_quality'] = row[f'{slot}_hold_quality'] or []
        return Environment(**kwargs)

    @staticmethod
    def _row_to_outcome(row: dict) -> Outcome:
        """Convert database row to Outcome object."""
        return Outcome(
            id=row['id'],
            move_id=row['move_id'],
            user_id=str(row['user_id']),
            result=row['result'],
            reach_detail=row['reach_detail'],
            confidence=row['confidence'] or '',
        )

    @staticmethod
    def _row_to_frame_tag(row: dict) -> FrameTag:
        """Convert database row to FrameTag object."""
        return FrameTag(
            id=row['id'],
            move_id=row['move_id'],
            user_id=str(row['user_id']),
            frame_number=row['frame_number'],
            timestamp_ms=row['timestamp_ms'],
            tag_type=row['tag_type'],
            side=row['side'],
            level=row['level'],
            locations=row['locations'] or [],
            note=row['note'] or '',
            tagged_at=row['tagged_at'],
        )
