#!/usr/bin/env python3
"""
Verify R2 against the real bucket, and apply the CORS rule.

Runs the full object-storage contract the API depends on:

  1. put_object                 - upload a small object
  2. object_exists              - HEAD it
  3. get_object_stream          - stream it back and compare bytes
  4. presigned_put_url          - PUT a file over real HTTP with no credentials
  5. presigned_get_url          - GET it back over real HTTP
  6. put_bucket_cors            - apply the rule from r2-cors.json
  7. get_bucket_cors            - read it back and confirm

Usage:
    python scripts/verify_r2.py                 # verify + apply CORS
    python scripts/verify_r2.py --skip-cors     # verify objects only
    python scripts/verify_r2.py --keep          # leave the test objects behind

Reads R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET from
the environment. Never prints a credential.
"""
import argparse
import json
import pathlib
import socket
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from src.storage import r2  # noqa: E402

CORS_FILE = pathlib.Path(__file__).resolve().parents[1] / 'r2-cors.json'

passed = 0
failed = 0


def endpoint_reachable(endpoint: str, timeout: int = 12):
    """TLS-handshake check against the endpoint host.

    Distinguishes "the network will not let us talk to R2 at all" from a real
    credential or permission error, which otherwise surfaces as a bare
    SSLError deep inside botocore.
    """
    host = urllib.parse.urlparse(endpoint).hostname
    port = urllib.parse.urlparse(endpoint).port or 443
    try:
        with socket.create_connection((host, port), timeout=timeout) as sock:
            with ssl.create_default_context().wrap_socket(sock, server_hostname=host):
                return True, ''
    except ssl.SSLError as exc:
        return False, f'TLS handshake rejected ({exc.reason or exc})'
    except (socket.timeout, TimeoutError):
        return False, 'connection timed out'
    except OSError as exc:
        return False, f'{type(exc).__name__}: {exc}'


def check(label: str, condition: bool, detail: str = ''):
    global passed, failed
    if condition:
        passed += 1
        print(f'  PASS  {label}')
    else:
        failed += 1
        print(f'  FAIL  {label}' + (f' - {detail}' if detail else ''))


def http(method: str, url: str, body: bytes = None, content_type: str = None):
    """Plain HTTP with no AWS signing - presigned URLs must work unaided."""
    headers = {}
    if content_type:
        headers['Content-Type'] = content_type
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()
    except urllib.error.URLError as exc:
        return 0, str(exc.reason).encode()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--skip-cors', action='store_true', help='Do not touch the CORS config')
    parser.add_argument('--keep', action='store_true', help='Leave test objects in the bucket')
    args = parser.parse_args()

    if not r2.is_configured():
        sys.exit(
            'R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, '
            'R2_SECRET_ACCESS_KEY and R2_BUCKET (e.g. `set -a && . .env && set +a`).'
        )

    bucket = r2.bucket_name()
    endpoint = r2.endpoint_url()
    print(f'Verifying R2 bucket "{bucket}" at {endpoint}\n')

    reachable, why = endpoint_reachable(endpoint)
    if not reachable:
        sys.exit(
            f'Cannot reach {endpoint}: {why}\n\n'
            'The credentials may be fine - this is a network-level failure before\n'
            'any request is signed. Some networks block Cloudflare\'s S3 API domain\n'
            '(*.r2.cloudflarestorage.com) while leaving dash.cloudflare.com reachable.\n'
            'Check with:\n'
            f'    curl -sv https://{urllib.parse.urlparse(endpoint).hostname}/ 2>&1 | tail -5\n'
            'If that fails too, run this from another network (phone hotspot or VPN),\n'
            'or rely on the deployed service, which reaches R2 from its own network.'
        )

    run_id = uuid.uuid4().hex[:12]
    direct_key = f'_verify/{run_id}/direct.csv'
    presigned_key = f'_verify/{run_id}/presigned.csv'
    payload = b'frame_number,timestamp_ms\n0,0\n1,33\n'
    created = []

    # --- 1. put_object ------------------------------------------------------
    print('direct object operations')
    try:
        r2.put_object(direct_key, payload, content_type='text/csv')
        created.append(direct_key)
        check('put_object uploads', True)
    except Exception as exc:
        check('put_object uploads', False, f'{type(exc).__name__}: {exc}')
        return summarize()

    # --- 2. object_exists ---------------------------------------------------
    try:
        check('object_exists finds it', r2.object_exists(direct_key))
        check('object_exists is False for a missing key',
              not r2.object_exists(f'_verify/{run_id}/nope.csv'))
    except Exception as exc:
        check('object_exists works', False, f'{type(exc).__name__}: {exc}')

    # --- 3. get_object_stream ----------------------------------------------
    try:
        with r2.get_object_stream(direct_key) as stream:
            fetched = stream.read()
        check('get_object_stream round-trips the bytes', fetched == payload,
              f'got {fetched[:60]!r}')
    except Exception as exc:
        check('get_object_stream works', False, f'{type(exc).__name__}: {exc}')

    try:
        r2.get_object_stream(f'_verify/{run_id}/nope.csv')
        check('missing key raises FileNotFoundError', False, 'no exception raised')
    except FileNotFoundError:
        check('missing key raises FileNotFoundError', True)
    except Exception as exc:
        check('missing key raises FileNotFoundError', False, f'got {type(exc).__name__}')

    # --- 4. presigned PUT over real HTTP ------------------------------------
    print('\npresigned URLs (plain HTTP, no credentials)')
    try:
        put_url = r2.presigned_put_url(presigned_key, content_type='text/csv', expires_in=600)
        check('presigned_put_url returns a URL', put_url.startswith('http'))
        status, body = http('PUT', put_url, body=payload, content_type='text/csv')
        ok = status in (200, 201, 204)
        check('PUT to the presigned URL succeeds', ok, f'HTTP {status}: {body[:200]!r}')
        if ok:
            created.append(presigned_key)
            check('object landed in the bucket', r2.object_exists(presigned_key))
    except Exception as exc:
        check('presigned PUT works', False, f'{type(exc).__name__}: {exc}')

    # --- 5. presigned GET over real HTTP ------------------------------------
    try:
        get_url = r2.presigned_get_url(presigned_key, expires_in=600,
                                       download_filename='verify.csv')
        status, body = http('GET', get_url)
        check('GET from the presigned URL succeeds', status == 200, f'HTTP {status}')
        check('presigned GET returns the same bytes', body == payload, f'got {body[:60]!r}')
    except Exception as exc:
        check('presigned GET works', False, f'{type(exc).__name__}: {exc}')

    # --- 6/7. CORS ----------------------------------------------------------
    if not args.skip_cors:
        print('\nCORS')
        rules = json.loads(CORS_FILE.read_text())
        try:
            r2.put_bucket_cors(rules)
            check('put_bucket_cors applied', True)
        except Exception as exc:
            if 'AccessDenied' in str(exc):
                # Expected: bucket configuration is an admin-scoped operation,
                # and the production token is deliberately Object Read & Write
                # only. CORS is managed in the dashboard, or with a separate
                # admin token. Not a failure.
                print('  SKIP  bucket CORS is not writable by this token')
                print('        (Object Read & Write cannot change bucket config -')
                print('         that is the intended least-privilege posture.)')
                print('        Manage CORS at: R2 > bucket > Settings > CORS Policy,')
                print('        or re-run with an Admin Read & Write token.')
                return summarize()
            check('CORS configuration', False, f'{type(exc).__name__}: {exc}')
            return summarize()

        try:
            applied = r2.get_bucket_cors()
            check('get_bucket_cors returns a rule', bool(applied), str(applied))

            if applied:
                methods = set()
                origins = set()
                for rule in applied:
                    methods |= set(rule.get('AllowedMethods', []))
                    origins |= set(rule.get('AllowedOrigins', []))
                check('PUT is allowed', 'PUT' in methods, str(sorted(methods)))
                check('GET is allowed', 'GET' in methods, str(sorted(methods)))
                check('localhost:5173 is permitted',
                      'http://localhost:5173' in origins or '*' in origins,
                      str(sorted(origins)))
                print(f'  applied rules: {json.dumps(applied, default=str)}')
        except Exception as exc:
            check('get_bucket_cors', False, f'{type(exc).__name__}: {exc}')

    # --- cleanup ------------------------------------------------------------
    if not args.keep:
        print('\ncleanup')
        for key in created:
            try:
                r2.delete_object(key)
            except Exception as exc:
                print(f'  warn: could not delete {key}: {type(exc).__name__}')
        check('test objects removed',
              all(not r2.object_exists(k) for k in created))

    return summarize()


def summarize() -> int:
    print(f'\n{passed} passed, {failed} failed')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
