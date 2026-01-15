# Dynalytics UI - Backend Setup

Clean, modular backend for the data collection UI.

## Architecture

```
src/
├── labeling/           # Data layer (pure Python)
│   ├── models.py       # Dataclasses (Video, Move, FrameTag)
│   ├── database.py     # SQLite operations
│   └── __init__.py
└── web/                # API layer
    ├── api.py          # FastAPI routes
    └── __init__.py
```

**Key Design Principles:**
- ✅ **Clear encapsulation** - Models know nothing about database, database knows nothing about API
- ✅ **Easy iteration** - Change one layer without affecting others
- ✅ **Testable** - Each layer can be tested independently

## Setup

```bash
# Install dependencies
pip install -r requirements.txt

# Test backend components
python test_backend.py

# Run API server
uvicorn src.web.api:app --reload --port 8000
```

## API Documentation

Once running, visit:
- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

## API Endpoints

### Configuration
```
GET  /api/config                    # Get move types, questions, body parts
```

### Videos
```
POST /api/videos/upload             # Upload & process video
GET  /api/videos                    # List all videos
GET  /api/videos/{id}               # Get video details
GET  /api/videos/{id}/csv           # Download CSV
GET  /api/videos/{id}/moves         # Get all moves for video
```

### Moves
```
POST /api/moves                     # Create move
GET  /api/moves/{id}                # Get move details
PUT  /api/moves/{id}                # Update move
DELETE /api/moves/{id}              # Delete move (+ frame tags)
GET  /api/moves/{id}/frame-tags     # Get frame tags for move
```

### Frame Tags
```
POST /api/frame-tags                # Create frame tag
DELETE /api/frame-tags/{id}         # Delete frame tag
```

## Data Models

### Video
```python
{
    "id": 1,
    "filename": "climb.mov",
    "path": "videos/climb.mov",
    "csv_path": "data/climb.csv",
    "fps": 30.0,
    "total_frames": 900,
    "duration_ms": 30000.0,
    "uploaded_at": "2026-01-14T19:30:00"
}
```

### Move
```python
{
    "id": 1,
    "video_id": 1,
    "frame_start": 150,
    "frame_end": 200,
    "timestamp_start_ms": 5000.0,
    "timestamp_end_ms": 6666.7,
    "move_type": "dyno",
    "form_quality": 4,           # 1-5
    "effort_level": 7,           # 0-10
    "contextual_data": {
        "catching_hand": "right_hand",
        "push_foot": "left_foot",
        "contact_at_launch": ["left_hand", "right_hand", "left_foot"],
        "body_position": "side_on"
    },
    "tags": ["tweaky_feeling", "controlled"],
    "description": "Big move from left foot, solid catch",
    "labeled_at": "2026-01-14T19:35:00",
    "frame_tag_count": 2
}
```

### Frame Tag
```python
{
    "id": 1,
    "move_id": 1,
    "frame_number": 155,
    "timestamp_ms": 5166.7,
    "tag_type": "pain",
    "level": 6,                  # 0-10 (for sensation tags)
    "locations": ["left_knee"],
    "note": "Sharp pain on push",
    "tagged_at": "2026-01-14T19:36:00"
}
```

## Move Type Configuration

Each move type has contextual questions defined in `models.py`:

```python
MOVE_TYPE_QUESTIONS = {
    'dyno': {
        'catching_hand': {
            'question': 'Which hand caught?',
            'options': ['left_hand', 'right_hand', 'both_hands', 'missed']
        },
        # ... more questions
    },
    'lock_off': { ... },
    'drop_knee': { ... },
    # etc.
}
```

To add a new move type:
1. Add to `MOVE_TYPES` list
2. Define questions in `MOVE_TYPE_QUESTIONS`
3. Frontend will automatically render the form

## Testing

Run component tests:
```bash
python test_backend.py
```

This tests:
- ✅ Data models (Video, Move, FrameTag)
- ✅ Database operations (CRUD)
- ✅ JSON serialization
- ✅ Cascading deletes

## Database Schema

SQLite database at `data/labels.db`:

```sql
videos:
  - id, filename, path, csv_path, fps, total_frames, duration_ms, uploaded_at

moves:
  - id, video_id, frame_start, frame_end, timestamp_start_ms, timestamp_end_ms
  - move_type, form_quality, effort_level
  - contextual_data (JSON), tags (JSON), description
  - labeled_at

frame_tags:
  - id, move_id, frame_number, timestamp_ms
  - tag_type, level, locations (JSON), note
  - tagged_at
```

## Development

### Adding a New Move Type

1. Edit `src/labeling/models.py`:
```python
MOVE_TYPES.append('heel_hook')

MOVE_TYPE_QUESTIONS['heel_hook'] = {
    'hooking_foot': {
        'question': 'Which foot hooked?',
        'options': ['left_foot', 'right_foot']
    },
    # ... more questions
}
```

2. No other changes needed! API and frontend will automatically support it.

### Adding a New Tag Type

1. Edit `src/labeling/models.py`:
```python
TAG_TYPES['cramp'] = 'Muscle Cramp'
```

2. Frontend will automatically show it in tag options.

## Error Handling

API uses standard HTTP status codes:
- `200` - Success
- `201` - Created
- `204` - No Content (successful delete)
- `400` - Bad Request (validation error)
- `404` - Not Found
- `500` - Internal Server Error

Error responses:
```json
{
  "detail": "Video 999 not found"
}
```

## Next Steps

1. ✅ Backend complete
2. ⏭️ Build frontend (React)
3. ⏭️ Connect frontend to API
4. ⏭️ Test full workflow

See `frontend/README.md` for frontend setup.
