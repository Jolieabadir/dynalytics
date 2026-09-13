"""
API authentication and per-user scoping tests.

Two users, one dataset each: every endpoint must refuse to leak across the
boundary, and must return 404 (not 403) so an id's existence stays private.
"""
import uuid

import pytest
from fastapi.testclient import TestClient

from src.web import api as api_module
from tests.conftest import make_jwt, requires_db

pytestmark = requires_db


# ==================== FIXTURES ====================

@pytest.fixture
def client(clean_db, fake_r2, monkeypatch):
    """TestClient wired to the test database and the R2 fixture."""
    monkeypatch.setattr(api_module, '_db', clean_db)
    monkeypatch.setattr(api_module, '_exporter', None)
    with TestClient(api_module.app) as test_client:
        yield test_client


def auth(user_id: str) -> dict:
    return {'Authorization': f'Bearer {make_jwt(user_id)}'}


POSE_CSV = (
    'frame_number,timestamp_ms,left_elbow_angle\n'
    '0,0,170.0\n'
    '1,33,165.5\n'
    '2,66,150.2\n'
)


def register_video(client, user_id, filename='climb.mp4'):
    response = client.post(
        '/api/videos/register',
        json={
            'filename': filename,
            'fps': 30.0,
            'total_frames': 3,
            'duration_ms': 100.0,
            'csv_data': POSE_CSV,
        },
        headers=auth(user_id),
    )
    assert response.status_code == 201, response.text
    return response.json()


def create_move(client, user_id, video_id):
    response = client.post(
        '/api/moves',
        json={
            'video_id': video_id,
            'frame_start': 0,
            'frame_end': 2,
            'timestamp_start_ms': 0.0,
            'timestamp_end_ms': 66.0,
            'approach': 'dynamic',
            'size': 'large',
            'move_tags': ['dyno', 'technical'],
            'form_quality': 4,
            'effort_level': 7,
            'confidence': 'high',
            'description': 'test move',
        },
        headers=auth(user_id),
    )
    assert response.status_code == 201, response.text
    return response.json()


# ==================== AUTH ====================

def test_health_needs_no_token(client):
    response = client.get('/api/health')
    assert response.status_code == 200
    body = response.json()
    assert body['database'] == 'ok'
    assert body['schema_version'] == 3


def test_root_needs_no_token(client):
    assert client.get('/').status_code == 200


@pytest.mark.parametrize('path', [
    '/api/config',
    '/api/videos',
    '/api/exports/mine',
])
def test_endpoints_require_a_token(client, path):
    assert client.get(path).status_code == 401


def test_config_with_token(client, user_a):
    response = client.get('/api/config', headers=auth(user_a))
    assert response.status_code == 200
    config = response.json()
    assert 'technical' in config['move_tags']
    assert 'tension' in config['move_tags']
    assert 'timings' not in config
    assert config['hold_slots'] == ['start_left', 'start_right', 'end', 'foot']


def test_garbage_token_is_rejected(client):
    response = client.get('/api/videos', headers={'Authorization': 'Bearer not-a-jwt'})
    assert response.status_code == 401


def test_token_signed_with_wrong_secret_is_rejected(client, user_a):
    token = make_jwt(user_a, secret='some-other-secret-padded-to-32-bytes-minimum')
    response = client.get('/api/videos', headers={'Authorization': f'Bearer {token}'})
    assert response.status_code == 401


def test_expired_token_is_rejected(client, user_a):
    token = make_jwt(user_a, expires_in=-60)
    response = client.get('/api/videos', headers={'Authorization': f'Bearer {token}'})
    assert response.status_code == 401
    assert 'expired' in response.json()['detail'].lower()


# ==================== REGISTER ====================

def test_register_stores_pose_csv_in_r2(client, fake_r2, user_a):
    video = register_video(client, user_a)

    assert video['r2_pose_csv_key'] == f'pose/{user_a}/{video["id"]}.csv'
    assert video['r2_video_key'] is None
    assert video['fps'] == 30.0
    assert video['total_frames'] == 3

    if fake_r2 is not None:
        assert fake_r2.objects[video['r2_pose_csv_key']].decode() == POSE_CSV


def test_register_rejects_oversized_body(client, user_a):
    oversized = 'x' * (api_module.MAX_REGISTER_BYTES + 1024)
    response = client.post(
        '/api/videos/register',
        json={
            'filename': 'huge.mp4',
            'fps': 30.0,
            'total_frames': 1,
            'duration_ms': 1.0,
            'csv_data': oversized,
        },
        headers=auth(user_a),
    )
    assert response.status_code == 413


# ==================== VIDEO SCOPING ====================

def test_video_list_is_per_user(client, user_a, user_b):
    register_video(client, user_a, 'a.mp4')
    register_video(client, user_b, 'b.mp4')

    a_videos = client.get('/api/videos', headers=auth(user_a)).json()
    b_videos = client.get('/api/videos', headers=auth(user_b)).json()

    assert [v['filename'] for v in a_videos] == ['a.mp4']
    assert [v['filename'] for v in b_videos] == ['b.mp4']


def test_other_users_video_is_404(client, user_a, user_b):
    video = register_video(client, user_a)
    assert client.get(f'/api/videos/{video["id"]}', headers=auth(user_a)).status_code == 200
    assert client.get(f'/api/videos/{video["id"]}', headers=auth(user_b)).status_code == 404


def test_other_user_cannot_request_upload_url(client, user_a, user_b):
    video = register_video(client, user_a)
    response = client.post(
        f'/api/videos/{video["id"]}/upload-url',
        json={'content_type': 'video/mp4'},
        headers=auth(user_b),
    )
    assert response.status_code == 404


def test_upload_url_and_confirm(client, user_a):
    video = register_video(client, user_a)

    response = client.post(
        f'/api/videos/{video["id"]}/upload-url',
        json={'content_type': 'video/mp4'},
        headers=auth(user_a),
    )
    assert response.status_code == 200
    payload = response.json()
    expected_key = f'videos/{user_a}/{video["id"]}/climb.mp4'
    assert payload['key'] == expected_key
    assert payload['url']

    confirmed = client.post(
        f'/api/videos/{video["id"]}/confirm-upload',
        json={'key': payload['key']},
        headers=auth(user_a),
    )
    assert confirmed.status_code == 200
    assert confirmed.json()['r2_video_key'] == expected_key


def test_confirm_upload_rejects_foreign_prefix(client, user_a, user_b):
    video = register_video(client, user_a)
    response = client.post(
        f'/api/videos/{video["id"]}/confirm-upload',
        json={'key': f'videos/{user_b}/999/steal.mp4'},
        headers=auth(user_a),
    )
    assert response.status_code == 400


# ==================== LABEL SCOPING ====================

def test_other_user_cannot_create_move_on_your_video(client, user_a, user_b):
    video = register_video(client, user_a)
    response = client.post(
        '/api/moves',
        json={
            'video_id': video['id'],
            'frame_start': 0, 'frame_end': 1,
            'timestamp_start_ms': 0.0, 'timestamp_end_ms': 33.0,
            'approach': 'static', 'size': 'small',
        },
        headers=auth(user_b),
    )
    assert response.status_code == 404


def test_other_user_cannot_read_or_update_move(client, user_a, user_b):
    video = register_video(client, user_a)
    move = create_move(client, user_a, video['id'])

    assert client.get(f'/api/moves/{move["id"]}', headers=auth(user_b)).status_code == 404
    assert client.put(
        f'/api/moves/{move["id"]}',
        json={'approach': 'static'},
        headers=auth(user_b),
    ).status_code == 404
    assert client.delete(f'/api/moves/{move["id"]}', headers=auth(user_b)).status_code == 404

    # Still intact for the owner.
    assert client.get(f'/api/moves/{move["id"]}', headers=auth(user_a)).json()['approach'] == 'dynamic'


def test_move_list_scoped_by_video_owner(client, user_a, user_b):
    video = register_video(client, user_a)
    create_move(client, user_a, video['id'])

    assert client.get(f'/api/videos/{video["id"]}/moves', headers=auth(user_b)).status_code == 404
    assert len(client.get(f'/api/videos/{video["id"]}/moves', headers=auth(user_a)).json()) == 1


def test_holds_and_environment_slots(client, user_a):
    video = register_video(client, user_a)
    move = create_move(client, user_a, video['id'])

    hold = client.post(
        '/api/holds',
        json={
            'video_id': video['id'],
            'bbox_x': 0.4, 'bbox_y': 0.5, 'bbox_w': 0.06, 'bbox_h': 0.05,
            'source': 'detected',
        },
        headers=auth(user_a),
    )
    assert hold.status_code == 201, hold.text
    hold_id = hold.json()['id']

    env = client.post(
        '/api/environments',
        json={
            'move_id': move['id'],
            'wall_angle': 'steep',
            'start_left': {'hold_id': hold_id, 'hold_type': 'jug', 'hold_quality': ['incut']},
            'end': {'hold_id': hold_id, 'hold_type': 'pinch', 'hold_quality': ['small']},
        },
        headers=auth(user_a),
    )
    assert env.status_code == 201, env.text
    body = env.json()
    assert body['start_left']['hold_id'] == hold_id
    assert body['start_left']['hold_quality'] == ['incut']
    # Foot slot omitted entirely - it is optional.
    assert body['foot']['hold_id'] is None
    assert body['start_right']['hold_id'] is None


def test_environment_cannot_reference_another_users_hold(client, user_a, user_b):
    video_a = register_video(client, user_a)
    hold_a = client.post(
        '/api/holds',
        json={'video_id': video_a['id'], 'bbox_x': 0.1, 'bbox_y': 0.1,
              'bbox_w': 0.1, 'bbox_h': 0.1, 'source': 'manual'},
        headers=auth(user_a),
    ).json()

    video_b = register_video(client, user_b)
    move_b = create_move(client, user_b, video_b['id'])

    response = client.post(
        '/api/environments',
        json={
            'move_id': move_b['id'],
            'wall_angle': 'slab',
            'start_left': {'hold_id': hold_a['id'], 'hold_type': 'jug'},
        },
        headers=auth(user_b),
    )
    assert response.status_code == 404


def test_outcome_and_frame_tag_scoping(client, user_a, user_b):
    video = register_video(client, user_a)
    move = create_move(client, user_a, video['id'])

    outcome = client.post(
        '/api/outcomes',
        json={'move_id': move['id'], 'result': 'success',
              'reach_detail': 'reached_controlled', 'confidence': 'high'},
        headers=auth(user_a),
    )
    assert outcome.status_code == 201, outcome.text
    assert 'foot_cut' not in outcome.json()

    tag = client.post(
        '/api/frame-tags',
        json={'move_id': move['id'], 'frame_number': 1, 'timestamp_ms': 33.0,
              'tag_type': 'sharp_pain', 'side': 'left', 'level': 6,
              'locations': ['left_shoulder'], 'note': 'tweak'},
        headers=auth(user_a),
    )
    assert tag.status_code == 201, tag.text

    # user_b sees none of it.
    assert client.get(f'/api/moves/{move["id"]}/outcome', headers=auth(user_b)).status_code == 404
    assert client.get(f'/api/moves/{move["id"]}/frame-tags', headers=auth(user_b)).status_code == 404
    assert client.put(
        f'/api/outcomes/{outcome.json()["id"]}',
        json={'result': 'fall'},
        headers=auth(user_b),
    ).status_code == 404
    assert client.delete(
        f'/api/frame-tags/{tag.json()["id"]}', headers=auth(user_b)
    ).status_code == 404


# ==================== EXPORT ====================

def test_export_writes_to_r2_and_is_scoped(client, fake_r2, user_a, user_b):
    video = register_video(client, user_a)
    move = create_move(client, user_a, video['id'])
    client.post(
        '/api/outcomes',
        json={'move_id': move['id'], 'result': 'success',
              'reach_detail': 'reached_controlled', 'confidence': 'high'},
        headers=auth(user_a),
    )

    # Another user cannot trigger it.
    assert client.post(
        f'/api/videos/{video["id"]}/export', headers=auth(user_b)
    ).status_code == 404

    response = client.post(f'/api/videos/{video["id"]}/export', headers=auth(user_a))
    assert response.status_code == 200, response.text
    key = response.json()['r2_export_key']
    assert key == f'exports/{user_a}/{video["id"]}_labeled.csv'

    if fake_r2 is not None:
        content = fake_r2.objects[key].decode()
        header = content.splitlines()[0]
        # Raw pose columns survive, labels are appended.
        assert header.startswith('frame_number,timestamp_ms,left_elbow_angle')
        assert 'approach' in header
        assert 'start_left_hold_type' in header
        assert 'foot_hold_bbox' in header
        assert 'dyno|technical' in content
        assert 'reached_controlled' in content


def test_export_response_has_no_delete_video_option(client, fake_r2, user_a):
    video = register_video(client, user_a)
    response = client.post(f'/api/videos/{video["id"]}/export', headers=auth(user_a))
    assert response.status_code == 200
    assert set(response.json().keys()) == {'video_id', 'r2_export_key'}


def test_export_download_redirects_to_presigned_url(client, fake_r2, user_a, user_b):
    video = register_video(client, user_a)
    client.post(f'/api/videos/{video["id"]}/export', headers=auth(user_a))

    response = client.get(
        f'/api/videos/{video["id"]}/export/download',
        headers=auth(user_a),
        follow_redirects=False,
    )
    assert response.status_code == 307
    assert response.headers['location']

    assert client.get(
        f'/api/videos/{video["id"]}/export/download',
        headers=auth(user_b),
        follow_redirects=False,
    ).status_code == 404


def test_download_before_export_is_404(client, user_a):
    video = register_video(client, user_a)
    response = client.get(
        f'/api/videos/{video["id"]}/export/download',
        headers=auth(user_a),
        follow_redirects=False,
    )
    assert response.status_code == 404


def test_exports_mine_lists_only_own(client, fake_r2, user_a, user_b):
    video_a = register_video(client, user_a, 'mine.mp4')
    video_b = register_video(client, user_b, 'theirs.mp4')
    client.post(f'/api/videos/{video_a["id"]}/export', headers=auth(user_a))
    client.post(f'/api/videos/{video_b["id"]}/export', headers=auth(user_b))

    mine = client.get('/api/exports/mine', headers=auth(user_a)).json()
    assert len(mine) == 1
    assert mine[0]['filename'] == 'mine.mp4'
    assert mine[0]['r2_export_key'].startswith(f'exports/{user_a}/')


def test_exports_mine_excludes_unexported(client, user_a):
    register_video(client, user_a)
    assert client.get('/api/exports/mine', headers=auth(user_a)).json() == []


# ==================== BULK HOLD CREATE AND UPDATE ====================
#
# Added with the frontend hold work: the detector posts a whole frame's worth of
# boxes in one request, and the overlay can move or resize one after the fact.


def test_bulk_hold_create_returns_ids_in_order(client, user_a):
    video = register_video(client, user_a)

    boxes = [
        {'bbox_x': 0.10, 'bbox_y': 0.10, 'bbox_w': 0.05, 'bbox_h': 0.05, 'source': 'detected'},
        {'bbox_x': 0.30, 'bbox_y': 0.20, 'bbox_w': 0.06, 'bbox_h': 0.04, 'source': 'detected'},
        {'bbox_x': 0.50, 'bbox_y': 0.60, 'bbox_w': 0.07, 'bbox_h': 0.07, 'source': 'manual'},
    ]
    res = client.post(
        f'/api/videos/{video["id"]}/holds', json={'holds': boxes}, headers=auth(user_a)
    )
    assert res.status_code == 201, res.text

    created = res.json()
    assert len(created) == 3
    # Order preserved, so the caller can line the response up with what it sent.
    assert [h['bbox_x'] for h in created] == [0.10, 0.30, 0.50]
    assert [h['source'] for h in created] == ['detected', 'detected', 'manual']
    assert all(h['video_id'] == video['id'] for h in created)

    listed = client.get(f'/api/videos/{video["id"]}/holds', headers=auth(user_a)).json()
    assert [h['id'] for h in listed] == [h['id'] for h in created]


def test_bulk_hold_create_accepts_an_empty_list(client, user_a):
    video = register_video(client, user_a)
    res = client.post(f'/api/videos/{video["id"]}/holds', json={'holds': []}, headers=auth(user_a))
    assert res.status_code == 201
    assert res.json() == []


def test_bulk_hold_create_is_all_or_nothing(client, user_a):
    """A bad box anywhere in the batch must leave no holds behind."""
    video = register_video(client, user_a)
    good = {'bbox_x': 0.1, 'bbox_y': 0.1, 'bbox_w': 0.05, 'bbox_h': 0.05}

    res = client.post(
        f'/api/videos/{video["id"]}/holds',
        json={'holds': [good, dict(good, source='nonsense'), good]},
        headers=auth(user_a),
    )
    assert res.status_code == 400
    assert 'Invalid source' in res.json()['detail']

    assert client.get(f'/api/videos/{video["id"]}/holds', headers=auth(user_a)).json() == []


def test_bulk_hold_create_rejects_an_oversized_batch(client, user_a):
    video = register_video(client, user_a)
    box = {'bbox_x': 0.1, 'bbox_y': 0.1, 'bbox_w': 0.05, 'bbox_h': 0.05}

    res = client.post(
        f'/api/videos/{video["id"]}/holds', json={'holds': [box] * 201}, headers=auth(user_a)
    )
    assert res.status_code == 400
    assert 'Too many holds' in res.json()['detail']
    assert client.get(f'/api/videos/{video["id"]}/holds', headers=auth(user_a)).json() == []


def test_bulk_hold_create_rejects_a_box_outside_the_frame(client, user_a):
    video = register_video(client, user_a)
    res = client.post(
        f'/api/videos/{video["id"]}/holds',
        json={'holds': [{'bbox_x': 1.5, 'bbox_y': 0.1, 'bbox_w': 0.05, 'bbox_h': 0.05}]},
        headers=auth(user_a),
    )
    assert res.status_code == 422


def test_bulk_hold_create_scoped_to_the_video_owner(client, user_a, user_b):
    video = register_video(client, user_a)
    res = client.post(
        f'/api/videos/{video["id"]}/holds',
        json={'holds': [{'bbox_x': 0.1, 'bbox_y': 0.1, 'bbox_w': 0.05, 'bbox_h': 0.05}]},
        headers=auth(user_b),
    )
    assert res.status_code == 404
    assert client.get(f'/api/videos/{video["id"]}/holds', headers=auth(user_a)).json() == []


def test_update_hold_moves_the_box(client, user_a):
    video = register_video(client, user_a)
    hold = client.post(
        '/api/holds',
        json={
            'video_id': video['id'],
            'bbox_x': 0.1, 'bbox_y': 0.1, 'bbox_w': 0.05, 'bbox_h': 0.05,
            'source': 'detected',
        },
        headers=auth(user_a),
    ).json()

    res = client.put(
        f'/api/holds/{hold["id"]}',
        json={'bbox_x': 0.42, 'bbox_y': 0.33, 'source': 'manual'},
        headers=auth(user_a),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body['bbox_x'] == 0.42
    assert body['bbox_y'] == 0.33
    assert body['source'] == 'manual'
    # Omitted fields are left alone.
    assert body['bbox_w'] == 0.05
    assert body['bbox_h'] == 0.05


def test_update_hold_with_no_fields_is_a_no_op(client, user_a):
    video = register_video(client, user_a)
    hold = client.post(
        '/api/holds',
        json={
            'video_id': video['id'],
            'bbox_x': 0.1, 'bbox_y': 0.1, 'bbox_w': 0.05, 'bbox_h': 0.05,
        },
        headers=auth(user_a),
    ).json()

    res = client.put(f'/api/holds/{hold["id"]}', json={}, headers=auth(user_a))
    assert res.status_code == 200
    assert res.json()['bbox_x'] == 0.1


def test_update_hold_rejects_a_bad_source(client, user_a):
    video = register_video(client, user_a)
    hold = client.post(
        '/api/holds',
        json={
            'video_id': video['id'],
            'bbox_x': 0.1, 'bbox_y': 0.1, 'bbox_w': 0.05, 'bbox_h': 0.05,
        },
        headers=auth(user_a),
    ).json()

    res = client.put(f'/api/holds/{hold["id"]}', json={'source': 'nonsense'}, headers=auth(user_a))
    assert res.status_code == 400
    assert 'Invalid source' in res.json()['detail']


def test_update_hold_cannot_touch_another_users_hold(client, user_a, user_b):
    video = register_video(client, user_a)
    hold = client.post(
        '/api/holds',
        json={
            'video_id': video['id'],
            'bbox_x': 0.1, 'bbox_y': 0.1, 'bbox_w': 0.05, 'bbox_h': 0.05,
        },
        headers=auth(user_a),
    ).json()

    res = client.put(f'/api/holds/{hold["id"]}', json={'bbox_x': 0.9}, headers=auth(user_b))
    assert res.status_code == 404

    # And the original is untouched.
    still = client.get(f'/api/videos/{video["id"]}/holds', headers=auth(user_a)).json()
    assert still[0]['bbox_x'] == 0.1


def test_update_missing_hold_is_404(client, user_a):
    assert client.put('/api/holds/999999', json={'bbox_x': 0.5}, headers=auth(user_a)).status_code == 404
