"""
Cloudflare R2 object storage.

R2 speaks the S3 API, so this is boto3 pointed at the account endpoint
https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com with region "auto".

Every persistent blob the platform produces lives here - original videos, raw
pose CSVs and labeled exports - because Railway's container filesystem is wiped
on every deploy.

Key layout (user id first, so a prefix listing is always one climber's data):
    videos/{user_id}/{video_id}/{filename}
    pose/{user_id}/{video_id}.csv
    exports/{user_id}/{video_id}_labeled.csv

Required environment:
    R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
"""
import os
import threading
from typing import Optional, BinaryIO, Union

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

_client = None
_client_lock = threading.Lock()


class R2NotConfigured(RuntimeError):
    """Raised when R2 environment variables are missing."""


def _env(name: str) -> Optional[str]:
    value = os.environ.get(name)
    return value.strip() if value else None


def _required_vars() -> tuple:
    """Variables that must be set, given how the endpoint is being resolved."""
    base = ('R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET')
    return base if _env('R2_ENDPOINT_URL') else ('R2_ACCOUNT_ID',) + base


def is_configured() -> bool:
    """True when every R2 variable needed to build a client is present."""
    return all(_env(name) for name in _required_vars())


def bucket_name() -> str:
    """The configured bucket, or raise."""
    bucket = _env('R2_BUCKET')
    if not bucket:
        raise R2NotConfigured('R2_BUCKET is not set')
    return bucket


def endpoint_url() -> str:
    """The account-level S3 endpoint for this R2 account.

    R2_ENDPOINT_URL overrides it, which is how a local MinIO or S3 stub is
    pointed at during development. Leave it unset in production.
    """
    override = _env('R2_ENDPOINT_URL')
    if override:
        return override

    account_id = _env('R2_ACCOUNT_ID')
    if not account_id:
        raise R2NotConfigured('R2_ACCOUNT_ID is not set')
    return f'https://{account_id}.r2.cloudflarestorage.com'


def get_client():
    """Return a process-wide boto3 S3 client bound to R2.

    Built lazily so the module imports cleanly in environments without
    credentials (tests, local dev without R2).
    """
    global _client
    if _client is not None:
        return _client

    with _client_lock:
        if _client is not None:
            return _client

        if not is_configured():
            missing = [name for name in _required_vars() if not _env(name)]
            raise R2NotConfigured(f'Missing R2 environment variables: {", ".join(missing)}')

        _client = boto3.client(
            's3',
            endpoint_url=endpoint_url(),
            aws_access_key_id=_env('R2_ACCESS_KEY_ID'),
            aws_secret_access_key=_env('R2_SECRET_ACCESS_KEY'),
            region_name='auto',
            config=Config(
                signature_version='s3v4',
                retries={'max_attempts': 3, 'mode': 'standard'},
            ),
        )
        return _client


def reset_client():
    """Drop the cached client. Used by tests that swap credentials."""
    global _client
    with _client_lock:
        _client = None


# ==================== KEY LAYOUT ====================

def video_key(user_id: str, video_id: int, filename: str) -> str:
    """Key for an original uploaded video."""
    return f'videos/{user_id}/{video_id}/{filename}'


def pose_csv_key(user_id: str, video_id: int) -> str:
    """Key for a raw pose CSV."""
    return f'pose/{user_id}/{video_id}.csv'


def export_key(user_id: str, video_id: int) -> str:
    """Key for a labeled export CSV."""
    return f'exports/{user_id}/{video_id}_labeled.csv'


# ==================== OPERATIONS ====================

def put_object(key: str, body: Union[bytes, str, BinaryIO], content_type: Optional[str] = None) -> str:
    """Upload an object. Returns the key.

    Args:
        key: destination object key.
        body: bytes, str (encoded as UTF-8) or a file-like object.
        content_type: MIME type to store alongside the object.
    """
    if isinstance(body, str):
        body = body.encode('utf-8')

    kwargs = {'Bucket': bucket_name(), 'Key': key, 'Body': body}
    if content_type:
        kwargs['ContentType'] = content_type

    get_client().put_object(**kwargs)
    return key


def get_object_stream(key: str):
    """Open an object for streaming reads.

    Returns botocore's StreamingBody: iterate it, or call .read()/.iter_lines().
    Raises FileNotFoundError when the key does not exist so callers can map it
    onto a 404 without importing botocore.
    """
    try:
        response = get_client().get_object(Bucket=bucket_name(), Key=key)
    except ClientError as exc:
        if exc.response.get('Error', {}).get('Code') in ('NoSuchKey', '404', 'NotFound'):
            raise FileNotFoundError(f'R2 object not found: {key}') from exc
        raise
    return response['Body']


def object_exists(key: str) -> bool:
    """True when the key exists in the bucket."""
    try:
        get_client().head_object(Bucket=bucket_name(), Key=key)
        return True
    except ClientError as exc:
        if exc.response.get('Error', {}).get('Code') in ('NoSuchKey', '404', 'NotFound'):
            return False
        raise


def presigned_put_url(key: str, content_type: Optional[str] = None, expires_in: int = 3600) -> str:
    """Presigned URL the browser can PUT directly to.

    If content_type is given the client must send a matching Content-Type
    header or the signature will not validate.
    """
    params = {'Bucket': bucket_name(), 'Key': key}
    if content_type:
        params['ContentType'] = content_type

    return get_client().generate_presigned_url(
        'put_object',
        Params=params,
        ExpiresIn=expires_in,
    )


def presigned_get_url(key: str, expires_in: int = 3600, download_filename: Optional[str] = None) -> str:
    """Presigned URL for reading an object.

    Args:
        download_filename: when set, forces a browser download under this name.
    """
    params = {'Bucket': bucket_name(), 'Key': key}
    if download_filename:
        params['ResponseContentDisposition'] = f'attachment; filename="{download_filename}"'

    return get_client().generate_presigned_url(
        'get_object',
        Params=params,
        ExpiresIn=expires_in,
    )
