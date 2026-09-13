"""
Supabase JWT authentication.

Every API route depends on get_current_user_id, which verifies the bearer token
and returns its `sub` claim. That uuid is the user_id every query is scoped by.

Supabase projects created from 2025 on sign user tokens with an asymmetric key
(ES256) published at {SUPABASE_URL}/auth/v1/.well-known/jwks.json. Older
projects sign with the shared HS256 secret in SUPABASE_JWT_SECRET. Both are
supported: the token's own `alg` header decides which path is taken, so this
works before and after a project migrates its signing keys.
"""
import os
import threading
from typing import Optional

import jwt
from jwt import PyJWKClient
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

# auto_error=False so a missing header produces our own 401 with a useful
# message rather than FastAPI's bare 403.
_bearer = HTTPBearer(auto_error=False)

# Supabase stamps this audience on end-user tokens.
JWT_AUDIENCE = 'authenticated'
ASYMMETRIC_ALGORITHMS = ('ES256', 'RS256')
SYMMETRIC_ALGORITHM = 'HS256'

_jwks_client: Optional[PyJWKClient] = None
_jwks_lock = threading.Lock()


class AuthNotConfigured(RuntimeError):
    """Raised when neither a JWKS URL nor a shared secret is available."""


def _secret() -> str:
    secret = os.environ.get('SUPABASE_JWT_SECRET')
    if not secret:
        raise AuthNotConfigured('SUPABASE_JWT_SECRET is not set')
    return secret


def jwks_url() -> Optional[str]:
    """The project's JWKS endpoint, derived from SUPABASE_URL."""
    base = os.environ.get('SUPABASE_URL')
    if not base:
        return None
    return f"{base.rstrip('/')}/auth/v1/.well-known/jwks.json"


def get_jwks_client() -> PyJWKClient:
    """Cached JWKS client. Keys are fetched once and refreshed on cache miss."""
    global _jwks_client
    if _jwks_client is not None:
        return _jwks_client

    with _jwks_lock:
        if _jwks_client is None:
            url = jwks_url()
            if not url:
                raise AuthNotConfigured(
                    'SUPABASE_URL is not set, so the JWKS endpoint cannot be resolved'
                )
            _jwks_client = PyJWKClient(url, cache_keys=True)
        return _jwks_client


def reset_jwks_client():
    """Drop the cached client. Used by tests and after a key rotation."""
    global _jwks_client
    with _jwks_lock:
        _jwks_client = None


def decode_token(token: str) -> dict:
    """Verify and decode a Supabase JWT. Raises jwt exceptions on failure."""
    header = jwt.get_unverified_header(token)
    algorithm = header.get('alg', SYMMETRIC_ALGORITHM)

    if algorithm in ASYMMETRIC_ALGORITHMS:
        key = get_jwks_client().get_signing_key_from_jwt(token).key
        algorithms = [algorithm]
    else:
        key = _secret()
        algorithms = [SYMMETRIC_ALGORITHM]

    return jwt.decode(
        token,
        key,
        algorithms=algorithms,
        audience=JWT_AUDIENCE,
        options={'require': ['exp', 'sub']},
    )


async def get_current_user_id(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> str:
    """FastAPI dependency returning the authenticated user's uuid.

    401 when the Authorization header is missing, malformed, expired or signed
    with a key this project does not recognise.
    """
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail='Missing bearer token',
            headers={'WWW-Authenticate': 'Bearer'},
        )

    try:
        payload = decode_token(credentials.credentials)
    except AuthNotConfigured:
        # A server misconfiguration, not a client error.
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail='Auth is not configured on the server',
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail='Token has expired',
            headers={'WWW-Authenticate': 'Bearer'},
        )
    except jwt.PyJWKClientError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f'Signing key not found: {exc}',
            headers={'WWW-Authenticate': 'Bearer'},
        )
    except jwt.InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f'Invalid token: {exc}',
            headers={'WWW-Authenticate': 'Bearer'},
        )

    user_id = payload.get('sub')
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail='Token has no subject claim',
            headers={'WWW-Authenticate': 'Bearer'},
        )

    return str(user_id)
