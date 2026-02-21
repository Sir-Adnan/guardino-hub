from __future__ import annotations
from datetime import datetime, timezone, timedelta
import math
from app.core.config import settings
from app.models.user import GuardinoUser

BYTES_PER_GB = 1024 ** 3

def used_gb(user: GuardinoUser) -> int:
    return int(math.floor((user.used_bytes or 0) / BYTES_PER_GB))

def refundable_gb_for_user(user: GuardinoUser) -> int:
    # Product rule (simplified MVP):
    # Refund is allowed ONLY within REFUND_WINDOW_DAYS from user creation.
    # Refund is based on remaining GB: max(0, total_gb - used_gb)
    now = datetime.now(timezone.utc)
    if not user.created_at:
        return 0
    if now - user.created_at > timedelta(days=settings.REFUND_WINDOW_DAYS):
        return 0
    remaining = max(0, int(user.total_gb) - used_gb(user))
    return remaining
