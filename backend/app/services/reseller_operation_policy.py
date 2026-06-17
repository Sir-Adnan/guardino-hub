from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import HTTPException

from app.models.user import GuardinoUser
from app.services.refund import BYTES_PER_GB

_POLICY_PRESET_DAYS = {
    "7d": 7,
    "1m": 31,
    "3m": 90,
    "6m": 180,
    "1y": 365,
}
_DEFAULT_RENEWAL_TRAFFIC_GB = {20, 30, 50, 70, 100, 150, 200}


def policy_refund_window_days(policy: dict) -> int:
    try:
        return max(0, min(36500, int(policy.get("delete_refund_window_days", 10))))
    except Exception:
        return 10


def _policy_allowed_days(policy: dict) -> set[int]:
    out: set[int] = set()
    for preset in policy.get("allowed_duration_presets") or []:
        days = _POLICY_PRESET_DAYS.get(str(preset or "").strip().lower())
        if days:
            out.add(days)
    return out


def enforce_policy_days(policy: dict, days: int) -> None:
    if not bool(policy.get("enabled")):
        return
    days_int = int(days)
    min_days = int(policy.get("min_days", 1) or 1)
    max_days = int(policy.get("max_days", 3650) or 3650)
    if days_int < min_days or days_int > max_days:
        raise HTTPException(status_code=400, detail=f"Allowed days range is {min_days}-{max_days}.")
    if not bool(policy.get("allow_custom_days", True)):
        allowed = _policy_allowed_days(policy)
        if allowed and days_int not in allowed:
            allowed_text = ", ".join(str(x) for x in sorted(allowed))
            raise HTTPException(status_code=400, detail=f"This day value is not allowed for your account. Allowed: {allowed_text}")


def enforce_policy_traffic(policy: dict, gb: int) -> None:
    if not bool(policy.get("enabled")):
        return
    if bool(policy.get("allow_custom_traffic", True)):
        return
    allowed = {int(x) for x in (policy.get("allowed_traffic_gb") or []) if str(x).isdigit()}
    if allowed and int(gb) not in allowed:
        allowed_text = ", ".join(str(x) for x in sorted(allowed))
        raise HTTPException(status_code=400, detail=f"This traffic value is not allowed for your account. Allowed: {allowed_text}")


def enforce_edit_allowed(policy: dict, operation: str) -> None:
    if bool(policy.get("enabled")) and bool(policy.get("restrict_edit_to_renewal_only")):
        raise HTTPException(status_code=403, detail=f"{operation} is disabled; package renewal is the only allowed edit.")


def enforce_renewal_package_policy(policy: dict, days: int, gb: int) -> None:
    if not (bool(policy.get("enabled")) and bool(policy.get("restrict_edit_to_renewal_only"))):
        return

    allowed_days = _policy_allowed_days(policy) or set(_POLICY_PRESET_DAYS.values())
    if int(days) not in allowed_days:
        allowed_text = ", ".join(str(x) for x in sorted(allowed_days))
        raise HTTPException(status_code=400, detail=f"This renewal duration is not allowed. Allowed: {allowed_text}")

    allowed_traffic = {int(x) for x in (policy.get("allowed_traffic_gb") or []) if str(x).isdigit()} or set(_DEFAULT_RENEWAL_TRAFFIC_GB)
    if int(gb) not in allowed_traffic:
        allowed_text = ", ".join(str(x) for x in sorted(allowed_traffic))
        raise HTTPException(status_code=400, detail=f"This renewal traffic is not allowed. Allowed: {allowed_text}")


def user_used_gb_float(user: GuardinoUser) -> float:
    return float(user.used_bytes or 0) / float(BYTES_PER_GB)


def _user_expired(user: GuardinoUser) -> bool:
    expire_at = user.expire_at
    now = datetime.now(expire_at.tzinfo) if expire_at.tzinfo else datetime.utcnow()
    return expire_at < now


def _user_volume_exhausted(user: GuardinoUser) -> bool:
    total_bytes = int(user.total_gb or 0) * BYTES_PER_GB
    return total_bytes > 0 and int(user.used_bytes or 0) >= total_bytes


def enforce_delete_policy(user: GuardinoUser, policy: dict) -> None:
    if not bool(policy.get("allow_user_delete", True)):
        raise HTTPException(status_code=403, detail="User delete/refund is disabled for your account.")

    if _user_expired(user) or _user_volume_exhausted(user):
        raise HTTPException(status_code=400, detail="Expired or volume-exhausted users cannot be deleted/refunded.")

    try:
        used_limit = float(policy.get("delete_expired_used_gb_limit", 1.0))
    except Exception:
        used_limit = 1.0
    if used_limit > 0 and user_used_gb_float(user) > used_limit:
        raise HTTPException(status_code=400, detail="User usage is above the configured delete/refund limit.")

    window_days = policy_refund_window_days(policy)
    if window_days > 0:
        created_at = user.created_at
        if not created_at:
            raise HTTPException(status_code=400, detail="User creation date is missing.")
        now = datetime.now(created_at.tzinfo) if created_at.tzinfo else datetime.utcnow()
        if now - created_at > timedelta(days=window_days):
            raise HTTPException(status_code=400, detail=f"Delete/refund window expired ({window_days} days).")
