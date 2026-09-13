"""
Supabase JWT authentication.

Every API route depends on get_current_user_id, which verifies the bearer token
against SUPABASE_JWT_SECRET (Supabase signs project JWTs with HS256) and returns
the `sub` claim. That uuid is the user_id every query is scoped by.
"""
import os
from typing import Optional

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

# auto_error=False so a missing header produces our own 401 with a useful
# message rather than FastAPI's bare 403.
_bearer = HTTPBearer(auto_error=False)

# Supabase stamps this audience on end-user tokens.
JWT_AUDIENCE = 'authenticated'
JWT_ALGORITHM = 'HS256'


class AuthNotConfigured(RuntimeError):
    """Raised when SUPABASE_JWT_SECRET is missing."""


def _secret() -> str:
    secret = os.environ.get('SUPABASE_JWT_SECRET')
    if not secret:
        raise AuthNotConfigured('SUPABASE_JWT_SECRET is not set')
    return secret


def decode_token(token: str) -> dict:
    """Verify and decode a Supabase JWT. Raises jwt exceptions on failure."""
    return jwt.decode(
        token,
        _secret(),
        algorithms=[JWT_ALGORITHM],
        audience=JWT_AUDIENCE,
        options={'require': ['exp', 'sub']},
    )


async def get_current_user_id(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> str:
    """FastAPI dependency returning the authenticated user's uuid.

    401 when the Authorization header is missing, malformed, expired or signed
    with the wrong key.
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
