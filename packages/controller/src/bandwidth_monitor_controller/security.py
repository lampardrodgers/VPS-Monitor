from __future__ import annotations

from hashlib import sha256
from hmac import compare_digest
import secrets


def new_token(prefix: str) -> str:
    return f"{prefix}_{secrets.token_urlsafe(32)}"


def hash_token(token: str) -> str:
    return sha256(token.encode("utf-8")).hexdigest()


def verify_token(token: str, token_hash: str) -> bool:
    return compare_digest(hash_token(token), token_hash)


def bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, value = authorization.partition(" ")
    if scheme.lower() != "bearer" or not value:
        return None
    return value.strip()
