"""
Database layer for labeling system.

Handles all SQLite operations. Models know nothing about the database.
"""
import sqlite3
import json
from pathlib import Path
from typing import Optional, List
from datetime import datetime
from contextlib import contextmanager

from .models import Video, Move, FrameTag


class Database:
    """
    Database handler with clean separation of concerns.
    
    Usage:
        db = Database('data/labels.db')
        db.init()
        
        # Create
        video_id = db.create_video(video)
        
        # Read
        video = db.get_video(video_id)
        moves = db.get_moves_for_video(video_id)
        
        # Update
        db.update_move(move)
        
        # Delete
        db.delete_frame_tag(tag_id)
    """
    
    def __init__(self, db_path: str = 'data/labels.db'):
        """Initialize database connection."""
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
    
    @contextmanager
    def get_connection(self):
        """Context manager for database connections."""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
    
    def init(self):
        """Initialize database schema."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            
            # Videos table
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS videos (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    filename TEXT NOT NULL,
                    path TEXT NOT NULL,
                    csv_path TEXT NOT NULL,
                    fps REAL NOT NULL,
                    total_frames INTEGER NOT NULL,
                    duration_ms REAL NOT NULL,
                    uploaded_at TEXT NOT NULL
                )
            ''')
            
            # Moves table
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS moves (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    video_id INTEGER NOT NULL,
                    frame_start INTEGER NOT NULL,
                    frame_end INTEGER NOT NULL,
                    timestamp_start_ms REAL NOT NULL,
                    timestamp_end_ms REAL NOT NULL,
                    move_type TEXT NOT NULL,
                    form_quality INTEGER NOT NULL,
                    effort_level INTEGER NOT NULL,
                    contextual_data TEXT NOT NULL,
                    technique_modifiers TEXT NOT NULL DEFAULT '[]',
                    tags TEXT NOT NULL,
                    description TEXT NOT NULL,
                    labeled_at TEXT NOT NULL,
                    FOREIGN KEY (video_id) REFERENCES videos(id)
                )
            ''')
            
            # Frame tags table
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS frame_tags (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    move_id INTEGER NOT NULL,
                    frame_number INTEGER NOT NULL,
                    timestamp_ms REAL NOT NULL,
                    tag_type TEXT NOT NULL,
                    level INTEGER,
                    locations TEXT NOT NULL,
                    note TEXT NOT NULL,
                    tagged_at TEXT NOT NULL,
                    FOREIGN KEY (move_id) REFERENCES moves(id)
                )
            ''')
            
            # Create indexes
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_moves_video ON moves(video_id)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_frame_tags_move ON frame_tags(move_id)')
            
            # Migration: Add technique_modifiers column if it doesn't exist
            self._migrate_add_technique_modifiers(cursor)
    
    def _migrate_add_technique_modifiers(self, cursor):
        """Add technique_modifiers column to existing moves table if missing."""
        # Check if column exists
        cursor.execute("PRAGMA table_info(moves)")
        columns = [row['name'] for row in cursor.fetchall()]
        
        if 'technique_modifiers' not in columns:
            cursor.execute('''
                ALTER TABLE moves ADD COLUMN technique_modifiers TEXT NOT NULL DEFAULT '[]'
            ''')
            print("Migration: Added technique_modifiers column to moves table")
    
    # ==================== VIDEO OPERATIONS ====================
    
    def create_video(self, video: Video) -> int:
        """Create a new video record. Returns video_id."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO videos (filename, path, csv_path, fps, total_frames, duration_ms, uploaded_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (
                video.filename,
                video.path,
                video.csv_path,
                video.fps,
                video.total_frames,
                video.duration_ms,
                (video.uploaded_at or datetime.now()).isoformat()
            ))
            return cursor.lastrowid
    
    def get_video(self, video_id: int) -> Optional[Video]:
        """Get a video by ID."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM videos WHERE id = ?', (video_id,))
            row = cursor.fetchone()
            
            if not row:
                return None
            
            return Video(
                id=row['id'],
                filename=row['filename'],
                path=row['path'],
                csv_path=row['csv_path'],
                fps=row['fps'],
                total_frames=row['total_frames'],
                duration_ms=row['duration_ms'],
                uploaded_at=datetime.fromisoformat(row['uploaded_at'])
            )
    
    def get_all_videos(self) -> List[Video]:
        """Get all videos."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM videos ORDER BY uploaded_at DESC')
            rows = cursor.fetchall()
            
            return [
                Video(
                    id=row['id'],
                    filename=row['filename'],
                    path=row['path'],
                    csv_path=row['csv_path'],
                    fps=row['fps'],
                    total_frames=row['total_frames'],
                    duration_ms=row['duration_ms'],
                    uploaded_at=datetime.fromisoformat(row['uploaded_at'])
                )
                for row in rows
            ]
    
    # ==================== MOVE OPERATIONS ====================
    
    def create_move(self, move: Move) -> int:
        """Create a new move. Returns move_id."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO moves (
                    video_id, frame_start, frame_end, timestamp_start_ms, timestamp_end_ms,
                    move_type, form_quality, effort_level, contextual_data, technique_modifiers,
                    tags, description, labeled_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                move.video_id,
                move.frame_start,
                move.frame_end,
                move.timestamp_start_ms,
                move.timestamp_end_ms,
                move.move_type,
                move.form_quality,
                move.effort_level,
                json.dumps(move.contextual_data),
                json.dumps(move.technique_modifiers),
                json.dumps(move.tags),
                move.description,
                (move.labeled_at or datetime.now()).isoformat()
            ))
            return cursor.lastrowid
    
    def get_move(self, move_id: int) -> Optional[Move]:
        """Get a move by ID."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM moves WHERE id = ?', (move_id,))
            row = cursor.fetchone()
            
            if not row:
                return None
            
            return self._row_to_move(row)
    
    def get_moves_for_video(self, video_id: int) -> List[Move]:
        """Get all moves for a video."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                'SELECT * FROM moves WHERE video_id = ? ORDER BY frame_start',
                (video_id,)
            )
            rows = cursor.fetchall()
            return [self._row_to_move(row) for row in rows]
    
    def update_move(self, move: Move) -> bool:
        """Update an existing move. Returns success."""
        if not move.id:
            return False
        
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                UPDATE moves SET
                    frame_start = ?,
                    frame_end = ?,
                    timestamp_start_ms = ?,
                    timestamp_end_ms = ?,
                    move_type = ?,
                    form_quality = ?,
                    effort_level = ?,
                    contextual_data = ?,
                    technique_modifiers = ?,
                    tags = ?,
                    description = ?
                WHERE id = ?
            ''', (
                move.frame_start,
                move.frame_end,
                move.timestamp_start_ms,
                move.timestamp_end_ms,
                move.move_type,
                move.form_quality,
                move.effort_level,
                json.dumps(move.contextual_data),
                json.dumps(move.technique_modifiers),
                json.dumps(move.tags),
                move.description,
                move.id
            ))
            return cursor.rowcount > 0
    
    def delete_move(self, move_id: int) -> bool:
        """Delete a move and its frame tags. Returns success."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            
            # Delete frame tags first (foreign key constraint)
            cursor.execute('DELETE FROM frame_tags WHERE move_id = ?', (move_id,))
            
            # Delete move
            cursor.execute('DELETE FROM moves WHERE id = ?', (move_id,))
            
            return cursor.rowcount > 0
    
    # ==================== FRAME TAG OPERATIONS ====================
    
    def create_frame_tag(self, tag: FrameTag) -> int:
        """Create a new frame tag. Returns tag_id."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO frame_tags (
                    move_id, frame_number, timestamp_ms, tag_type, level, locations, note, tagged_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                tag.move_id,
                tag.frame_number,
                tag.timestamp_ms,
                tag.tag_type,
                tag.level,
                json.dumps(tag.locations),
                tag.note,
                (tag.tagged_at or datetime.now()).isoformat()
            ))
            return cursor.lastrowid
    
    def get_frame_tag(self, tag_id: int) -> Optional[FrameTag]:
        """Get a frame tag by ID."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM frame_tags WHERE id = ?', (tag_id,))
            row = cursor.fetchone()
            
            if not row:
                return None
            
            return self._row_to_frame_tag(row)
    
    def get_frame_tags_for_move(self, move_id: int) -> List[FrameTag]:
        """Get all frame tags for a move."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                'SELECT * FROM frame_tags WHERE move_id = ? ORDER BY frame_number',
                (move_id,)
            )
            rows = cursor.fetchall()
            return [self._row_to_frame_tag(row) for row in rows]
    
    def delete_frame_tag(self, tag_id: int) -> bool:
        """Delete a frame tag. Returns success."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('DELETE FROM frame_tags WHERE id = ?', (tag_id,))
            return cursor.rowcount > 0
    
    # ==================== HELPER METHODS ====================
    
    def _row_to_move(self, row: sqlite3.Row) -> Move:
        """Convert database row to Move object."""
        # Handle technique_modifiers - may not exist in old rows
        technique_modifiers = []
        if 'technique_modifiers' in row.keys():
            technique_modifiers = json.loads(row['technique_modifiers'])
        
        return Move(
            id=row['id'],
            video_id=row['video_id'],
            frame_start=row['frame_start'],
            frame_end=row['frame_end'],
            timestamp_start_ms=row['timestamp_start_ms'],
            timestamp_end_ms=row['timestamp_end_ms'],
            move_type=row['move_type'],
            form_quality=row['form_quality'],
            effort_level=row['effort_level'],
            contextual_data=json.loads(row['contextual_data']),
            technique_modifiers=technique_modifiers,
            tags=json.loads(row['tags']),
            description=row['description'],
            labeled_at=datetime.fromisoformat(row['labeled_at'])
        )
    
    def _row_to_frame_tag(self, row: sqlite3.Row) -> FrameTag:
        """Convert database row to FrameTag object."""
        return FrameTag(
            id=row['id'],
            move_id=row['move_id'],
            frame_number=row['frame_number'],
            timestamp_ms=row['timestamp_ms'],
            tag_type=row['tag_type'],
            level=row['level'],
            locations=json.loads(row['locations']),
            note=row['note'],
            tagged_at=datetime.fromisoformat(row['tagged_at'])
        )
