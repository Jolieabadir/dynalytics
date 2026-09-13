"""
Export service for combining pose data with labels.
Creates ML-ready CSV files with three-lens labeling schema.

Both ends are R2: the raw pose CSV is streamed out of the bucket and the joined
result is written straight back to it. Nothing touches local disk, so an export
survives a Railway redeploy.
"""
import csv
import io
from typing import Optional

from .database import Database
from .models import HOLD_SLOTS
from ..storage import r2


class Exporter:
    """Combines raw pose CSV with labels from Postgres."""

    def __init__(self, db: Database):
        self.db = db

    def export_video(self, video_id: int, user_id: str) -> str:
        """
        Export combined data for one of this user's videos.

        Streams the pose CSV from R2, joins the labels, writes the result back
        to R2 and records the key on the video row.

        Returns the R2 key of the export.
        """
        video = self.db.get_video(video_id, user_id)
        if not video:
            raise ValueError(f"Video {video_id} not found")

        if not video.r2_pose_csv_key:
            raise ValueError(f"Video {video_id} has no pose CSV stored")

        frame_labels = self._build_frame_labels(video_id, user_id)

        try:
            source = r2.get_object_stream(video.r2_pose_csv_key)
        except FileNotFoundError as exc:
            raise ValueError(str(exc)) from exc

        # StreamingBody yields bytes; wrap it so csv sees text.
        with source:
            text_stream = io.TextIOWrapper(source, encoding='utf-8', newline='')
            reader = csv.DictReader(text_stream)
            output = io.StringIO()
            writer = self._make_writer(output, reader.fieldnames or [])

            for row in reader:
                writer.writerow(self._merge_row(row, frame_labels))

        key = r2.export_key(user_id, video_id)
        r2.put_object(key, output.getvalue(), content_type='text/csv')
        self.db.set_video_r2_keys(video_id, user_id, r2_export_key=key)

        return key

    # ==================== INTERNALS ====================

    def _build_frame_labels(self, video_id: int, user_id: str) -> dict:
        """Expand each move's labels across every frame it covers."""
        frame_labels = {}

        for move in self.db.get_moves_for_video(video_id, user_id):
            env = self.db.get_environment_for_move(move.id, user_id)
            outcome = self.db.get_outcome_for_move(move.id, user_id)
            tags = self.db.get_frame_tags_for_move(move.id, user_id)

            labels = {
                'move_id': move.id,
                # Lens 2: Strategy
                'approach': move.approach,
                'size': move.size,
                'move_tags': '|'.join(move.move_tags) if move.move_tags else '',
                'form_quality': move.form_quality,
                'effort_level': move.effort_level,
                'move_confidence': move.confidence or '',
                # Lens 1: Environment
                'wall_angle': env.wall_angle if env else '',
                # Lens 3: Outcome
                'result': outcome.result if outcome else '',
                'reach_detail': outcome.reach_detail if outcome else '',
                'outcome_confidence': outcome.confidence if outcome else '',
            }

            # One group of columns per hold slot.
            for slot in HOLD_SLOTS:
                hold_id = getattr(env, f'{slot}_hold_id', None) if env else None
                hold_type = getattr(env, f'{slot}_hold_type', None) if env else None
                quality = getattr(env, f'{slot}_hold_quality', None) if env else None

                labels[f'{slot}_hold_id'] = hold_id if hold_id is not None else ''
                labels[f'{slot}_hold_type'] = hold_type or ''
                labels[f'{slot}_hold_quality'] = '|'.join(quality) if quality else ''

                # Denormalize the bbox so the export stands alone as a dataset.
                bbox = ''
                if hold_id is not None:
                    hold = self.db.get_hold(hold_id, user_id)
                    if hold:
                        bbox = f'{hold.bbox_x},{hold.bbox_y},{hold.bbox_w},{hold.bbox_h}'
                labels[f'{slot}_hold_bbox'] = bbox

            for frame in range(move.frame_start, move.frame_end + 1):
                frame_labels[frame] = dict(labels, frame_tags=[])

            for tag in tags:
                if tag.frame_number in frame_labels:
                    frame_labels[tag.frame_number]['frame_tags'].append({
                        'tag_type': tag.tag_type,
                        'level': tag.level,
                        'locations': tag.locations,
                        'side': tag.side,
                        'note': tag.note,
                    })

        return frame_labels

    @staticmethod
    def label_columns() -> list:
        """The label columns appended to the raw pose header, in order."""
        columns = [
            'move_id',
            # Lens 2: Strategy
            'approach', 'size', 'move_tags', 'form_quality', 'effort_level',
            'move_confidence',
            # Lens 1: Environment
            'wall_angle',
        ]
        for slot in HOLD_SLOTS:
            columns += [
                f'{slot}_hold_id',
                f'{slot}_hold_type',
                f'{slot}_hold_quality',
                f'{slot}_hold_bbox',
            ]
        columns += [
            # Lens 3: Outcome
            'result', 'reach_detail', 'outcome_confidence',
            # Sensation (Frame Tags) - pipe-delimited across tags on a frame
            'tag_types', 'tag_levels', 'tag_locations', 'tag_sides', 'tag_notes',
        ]
        return columns

    def _make_writer(self, output, source_fieldnames) -> csv.DictWriter:
        writer = csv.DictWriter(
            output,
            fieldnames=list(source_fieldnames) + self.label_columns(),
        )
        writer.writeheader()
        return writer

    def _merge_row(self, row: dict, frame_labels: dict) -> dict:
        """Attach the labels for this row's frame."""
        try:
            frame_num = int(row.get('frame_number', 0))
        except (TypeError, ValueError):
            frame_num = -1

        labels = frame_labels.get(frame_num, {})

        for column in self.label_columns():
            if column.startswith('tag_'):
                continue
            row[column] = labels.get(column, '')

        frame_tags = labels.get('frame_tags', [])
        if frame_tags:
            row['tag_types'] = '|'.join(t['tag_type'] for t in frame_tags)
            row['tag_levels'] = '|'.join(
                str(t['level']) if t['level'] is not None else '' for t in frame_tags
            )
            row['tag_locations'] = '|'.join(
                ','.join(t['locations']) if t['locations'] else '' for t in frame_tags
            )
            row['tag_sides'] = '|'.join(t['side'] or '' for t in frame_tags)
            row['tag_notes'] = '|'.join(t['note'] or '' for t in frame_tags)
        else:
            row['tag_types'] = ''
            row['tag_levels'] = ''
            row['tag_locations'] = ''
            row['tag_sides'] = ''
            row['tag_notes'] = ''

        return row
