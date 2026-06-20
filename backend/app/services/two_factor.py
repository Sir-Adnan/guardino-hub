from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import struct
import time
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import quote

from cryptography.fernet import Fernet, InvalidToken
from jose import JWTError, jwt

from app.core.config import settings
from app.core.security import ALGORITHM, hash_password, verify_password
from app.models.reseller import Reseller

TOTP_ALGORITHM = "SHA1"
TOTP_DIGITS = 6
TOTP_PERIOD_SECONDS = 30
TOTP_WINDOW = 1
TWO_FACTOR_CHALLENGE_MINUTES = 5
RECOVERY_CODE_COUNT = 10
RECOVERY_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"


def _fernet() -> Fernet:
    key = base64.urlsafe_b64encode(hashlib.sha256(settings.SECRET_KEY.encode("utf-8")).digest())
    return Fernet(key)


def encrypt_secret(secret: str) -> str:
    return _fernet().encrypt(secret.encode("utf-8")).decode("ascii")


def decrypt_secret(secret_enc: str | None) -> str | None:
    if not secret_enc:
        return None
    try:
        return _fernet().decrypt(secret_enc.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError, UnicodeDecodeError):
        return None


def normalize_otp_code(value: str | None) -> str:
    return "".join(ch for ch in str(value or "").strip().upper() if ch.isalnum())


def generate_totp_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


def _decode_secret(secret: str) -> bytes:
    clean = normalize_otp_code(secret)
    padded = clean + ("=" * ((8 - len(clean) % 8) % 8))
    return base64.b32decode(padded, casefold=True)


def _hotp(secret: str, counter: int, digits: int = TOTP_DIGITS) -> str:
    key = _decode_secret(secret)
    msg = struct.pack(">Q", int(counter))
    digest = hmac.new(key, msg, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code_int = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(code_int % (10**digits)).zfill(digits)


def current_totp(secret: str, now: int | None = None) -> str:
    timestamp = int(now if now is not None else time.time())
    return _hotp(secret, timestamp // TOTP_PERIOD_SECONDS)


def verify_totp_step(secret: str, code: str | None, now: int | None = None, window: int = TOTP_WINDOW) -> int | None:
    """Return the matched TOTP time-step counter, or None when the code is invalid.

    The counter lets callers reject replays of an already-consumed code that is
    still inside its validity window.
    """
    normalized = normalize_otp_code(code)
    if len(normalized) != TOTP_DIGITS or not normalized.isdigit():
        return None
    timestamp = int(now if now is not None else time.time())
    counter = timestamp // TOTP_PERIOD_SECONDS
    try:
        for drift in range(-window, window + 1):
            if hmac.compare_digest(_hotp(secret, counter + drift), normalized):
                return counter + drift
    except Exception:
        return None
    return None


def verify_totp(secret: str, code: str | None, now: int | None = None, window: int = TOTP_WINDOW) -> bool:
    return verify_totp_step(secret, code, now=now, window=window) is not None


def totp_step_from_datetime(value: datetime | None) -> int | None:
    """Map a stored "last used" timestamp back to its TOTP time-step counter."""
    if value is None:
        return None
    try:
        return int(value.timestamp()) // TOTP_PERIOD_SECONDS
    except (OverflowError, OSError, ValueError):
        return None


def datetime_for_totp_step(step: int) -> datetime:
    """Inverse of ``totp_step_from_datetime`` for persisting the consumed step."""
    return datetime.fromtimestamp(int(step) * TOTP_PERIOD_SECONDS, tz=timezone.utc)


def build_otpauth_uri(secret: str, username: str, issuer: str | None = None) -> str:
    clean_issuer = (issuer or "Guardino Hub").strip() or "Guardino Hub"
    label = f"{clean_issuer}:{username}"
    return (
        "otpauth://totp/"
        f"{quote(label)}?secret={quote(secret)}"
        f"&issuer={quote(clean_issuer)}"
        f"&algorithm={TOTP_ALGORITHM}&digits={TOTP_DIGITS}&period={TOTP_PERIOD_SECONDS}"
    )


def generate_recovery_codes(count: int = RECOVERY_CODE_COUNT) -> list[str]:
    codes: list[str] = []
    for _ in range(count):
        raw = "".join(secrets.choice(RECOVERY_CODE_ALPHABET) for _ in range(16))
        codes.append("-".join(raw[i : i + 4] for i in range(0, len(raw), 4)))
    return codes


def hash_recovery_codes(codes: list[str]) -> list[str]:
    return [hash_password(normalize_otp_code(code)) for code in codes]


def verify_recovery_code(code: str | None, hashes: list[str] | None) -> tuple[bool, list[str]]:
    normalized = normalize_otp_code(code)
    if len(normalized) < 8:
        return False, list(hashes or [])
    remaining: list[str] = []
    matched = False
    for item in list(hashes or []):
        if not matched and verify_password(normalized, item):
            matched = True
            continue
        remaining.append(item)
    return matched, remaining


def verify_reseller_second_factor(
    reseller: Reseller,
    code: str | None,
    *,
    last_used_step: int | None = None,
) -> tuple[bool, bool, int | None]:
    """Verify a TOTP code or a recovery code.

    Returns ``(ok, used_recovery, used_step)``. ``used_step`` is the consumed
    TOTP counter (or ``None`` for a recovery code) so the caller can persist it
    and reject replays of the same code within its validity window.
    """
    secret = decrypt_secret(getattr(reseller, "two_factor_secret_enc", None))
    if secret:
        step = verify_totp_step(secret, code)
        if step is not None:
            if last_used_step is not None and step <= last_used_step:
                # Same (or older) time-step already consumed: reject the replay.
                return False, False, None
            return True, False, step
    ok, remaining = verify_recovery_code(code, getattr(reseller, "two_factor_recovery_hashes", []) or [])
    if ok:
        reseller.two_factor_recovery_hashes = remaining
        return True, True, None
    return False, False, None


def create_two_factor_challenge_token(reseller: Reseller, role: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=TWO_FACTOR_CHALLENGE_MINUTES)
    payload: dict[str, Any] = {
        "sub": reseller.username,
        "rid": reseller.id,
        "role": role,
        "purpose": "2fa",
        "exp": expire,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGORITHM)


def decode_two_factor_challenge_token(token: str) -> dict[str, Any]:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return {}
    if payload.get("purpose") != "2fa":
        return {}
    return payload
