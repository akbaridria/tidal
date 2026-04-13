from __future__ import annotations

import os

from cryptography.fernet import Fernet


def _fernet_from_env() -> Fernet:
    key = os.environ.get("SYMMETRIC_ENCRYPTION_KEY")
    if not key:
        raise RuntimeError(
            "SYMMETRIC_ENCRYPTION_KEY must be set (use Fernet.generate_key() bytes as ASCII)"
        )
    return Fernet(key.encode("ascii"))


def encrypt_secret(plaintext: bytes) -> bytes:
    return _fernet_from_env().encrypt(plaintext)


def encrypt_key(plaintext: str | bytes) -> bytes:
    """Encrypt a UTF-8 string or raw bytes (e.g. base58 private key material)."""
    data = plaintext.encode("utf-8") if isinstance(plaintext, str) else plaintext
    return encrypt_secret(data)


def decrypt_secret(token: bytes) -> bytes:
    return _fernet_from_env().decrypt(token)


def decrypt_key(token: bytes) -> str:
    """Decrypt Fernet payload to UTF-8 text (e.g. base58 private key string)."""
    return decrypt_secret(token).decode("utf-8")


def wipe_bytearray(buf: bytearray) -> None:
    """Best-effort zeroization for sensitive buffers (mutable only)."""
    for i in range(len(buf)):
        buf[i] = 0
