from __future__ import annotations

from datetime import datetime
from typing import Any

import httpx

from app.services.adapters.base import AdapterError, ProvisionResult, TestConnectionResult


class PasarguardAdapter:
    def __init__(self, base_url: str, credentials: dict[str, Any], verify_ssl: bool = True, timeout: float = 20.0):
        self.base_url = base_url.rstrip("/")
        self.verify_ssl = verify_ssl
        self.timeout = timeout

        self._username = str(credentials.get("username") or "")
        self._password = str(credentials.get("password") or "")
        self._token = str(credentials.get("token") or "")

    async def _ensure_token(self) -> str:
        if self._token:
            return self._token
        if not (self._username and self._password):
            raise AdapterError("Pasarguard credentials must include token OR username/password")

        url = f"{self.base_url}/api/admin/token"
        data = {
            "grant_type": "password",
            "username": self._username,
            "password": self._password,
            "scope": "",
        }
        async with httpx.AsyncClient(verify=self.verify_ssl, timeout=self.timeout) as client:
            r = await client.post(url, data=data, headers={"Accept": "application/json"})
        if r.status_code >= 400:
            raise AdapterError(f"HTTP {r.status_code} POST /api/admin/token: {r.text[:300]}")
        js = r.json()
        tok = js.get("access_token")
        if not tok:
            raise AdapterError("Pasarguard token response missing access_token")
        self._token = str(tok)
        return self._token

    async def _headers(self) -> dict[str, str]:
        token = await self._ensure_token()
        return {"Accept": "application/json", "Authorization": f"Bearer {token}"}

    async def _get_json(self, path: str) -> Any:
        url = f"{self.base_url}{path}"
        async with httpx.AsyncClient(verify=self.verify_ssl, timeout=self.timeout) as client:
            r = await client.get(url, headers=await self._headers())
        if r.status_code >= 400:
            raise AdapterError(f"HTTP {r.status_code} GET {path}: {r.text[:300]}")
        return r.json()

    async def _post_json(self, path: str, payload: dict[str, Any] | None = None) -> Any:
        url = f"{self.base_url}{path}"
        async with httpx.AsyncClient(verify=self.verify_ssl, timeout=self.timeout) as client:
            r = await client.post(
                url,
                headers={**(await self._headers()), "Content-Type": "application/json"},
                json=payload or {},
            )
        if r.status_code >= 400:
            raise AdapterError(f"HTTP {r.status_code} POST {path}: {r.text[:300]}")
        return r.json() if r.text else None

    async def _put_json(self, path: str, payload: dict[str, Any]) -> Any:
        url = f"{self.base_url}{path}"
        async with httpx.AsyncClient(verify=self.verify_ssl, timeout=self.timeout) as client:
            r = await client.put(
                url,
                headers={**(await self._headers()), "Content-Type": "application/json"},
                json=payload,
            )
        if r.status_code >= 400:
            raise AdapterError(f"HTTP {r.status_code} PUT {path}: {r.text[:300]}")
        return r.json() if r.text else None

    async def _delete(self, path: str) -> None:
        url = f"{self.base_url}{path}"
        async with httpx.AsyncClient(verify=self.verify_ssl, timeout=self.timeout) as client:
            r = await client.delete(url, headers=await self._headers())
        if r.status_code >= 400:
            raise AdapterError(f"HTTP {r.status_code} DELETE {path}: {r.text[:300]}")

    async def _get_inbound_tags(self) -> list[str]:
        """Return a list of inbound tags.

        Pasarguard exposes /api/inbounds as a list[str] of inbound tags.
        """
        js = await self._get_json("/api/inbounds")
        if not isinstance(js, list):
            return []
        out: list[str] = []
        for it in js:
            if isinstance(it, str) and it:
                out.append(it)
        return out

    async def _ensure_all_inbounds_group_id(self) -> int | None:
        """Ensure a group exists that includes ALL current inbounds.

        Guardino default: enable all inbounds by default. In Pasarguard, inbounds are
        controlled via groups (group_ids on user).
        """
        inbound_tags = await self._get_inbound_tags()
        if not inbound_tags:
            return None

        group_name = "guardino_all_inbounds"

        # Find existing group
        try:
            js = await self._get_json("/api/groups?offset=0&limit=500")
            groups = js.get("groups") if isinstance(js, dict) else None
            if isinstance(groups, list):
                for g in groups:
                    if not isinstance(g, dict):
                        continue
                    if str(g.get("name") or "") != group_name:
                        continue
                    gid = g.get("id")
                    if not isinstance(gid, int):
                        continue
                    existing = g.get("inbound_tags")
                    existing_set = set(existing) if isinstance(existing, list) else set()
                    target_set = set(inbound_tags)
                    if existing_set != target_set or bool(g.get("is_disabled")):
                        await self._put_json(
                            f"/api/group/{gid}",
                            {"name": group_name, "inbound_tags": inbound_tags, "is_disabled": False},
                        )
                    return int(gid)
        except Exception:
            pass

        # Create if not found
        try:
            created = await self._post_json("/api/group", {"name": group_name, "inbound_tags": inbound_tags})
            if isinstance(created, dict) and isinstance(created.get("id"), int):
                return int(created["id"])
        except Exception:
            return None
        return None

    async def test_connection(self) -> TestConnectionResult:
        try:
            js = await self._get_json("/api/system")
            return TestConnectionResult(ok=True, detail="ok", meta={"system": js})
        except Exception as e:
            return TestConnectionResult(ok=False, detail=str(e))

    async def _pick_default_template_id(self) -> int | None:
        try:
            js = await self._get_json("/api/user_templates/simple")
            templates = js.get("templates") if isinstance(js, dict) else None
            if isinstance(templates, list) and templates:
                for t in templates:
                    if isinstance(t, dict) and str(t.get("name", "")).lower() in ("default", "all", "full"):
                        tid = t.get("id")
                        if isinstance(tid, int):
                            return tid
                t0 = templates[0]
                if isinstance(t0, dict) and isinstance(t0.get("id"), int):
                    return int(t0["id"])
        except Exception:
            return None
        return None

    async def provision_user(self, label: str, total_gb: int, expire_at: datetime) -> ProvisionResult:
        data_limit = int(total_gb) * 1024 * 1024 * 1024
        payload: dict[str, Any] = {
            "username": label,
            "expire": int(expire_at.timestamp()),
            "data_limit": data_limit,
            "data_limit_reset_strategy": "no_reset",
            "status": "active",
        }

        # Default selection rule (Guardino): enable ALL inbounds by default.
        # In Pasarguard, this is done via group_ids.
        group_id = None
        try:
            group_id = await self._ensure_all_inbounds_group_id()
            if group_id:
                payload["group_ids"] = [group_id]
        except Exception:
            group_id = None

        # Preferred: use /api/user with group_ids so ALL inbounds are enabled.
        try:
            js = await self._post_json("/api/user", payload)
        except AdapterError:
            template_id = await self._pick_default_template_id()
            if not template_id:
                raise
            # from_template only accepts user_template_id + username; then apply limits via PUT
            js = await self._post_json("/api/user/from_template", {"user_template_id": template_id, "username": label})
            # Apply limits + group_ids after template creation
            update_payload: dict[str, Any] = {"expire": int(expire_at.timestamp()), "data_limit": data_limit}
            if group_id:
                update_payload["group_ids"] = [group_id]
            await self._put_json(f"/api/user/{label}", update_payload)

        remote_identifier = (js or {}).get("username") or label
        sub_url = (js or {}).get("subscription_url")
        if not sub_url:
            # fetch from user endpoint
            sub_url = await self.get_direct_subscription_url(remote_identifier)
        return ProvisionResult(remote_identifier=remote_identifier, direct_sub_url=sub_url, meta=None)

    async def update_user_limits(self, remote_identifier: str, total_gb: int, expire_at: datetime) -> None:
        payload: dict[str, Any] = {
            "expire": int(expire_at.timestamp()),
            "data_limit": int(total_gb) * 1024 * 1024 * 1024,
        }
        await self._put_json(f"/api/user/{remote_identifier}", payload)

    async def delete_user(self, remote_identifier: str) -> None:
        await self._delete(f"/api/user/{remote_identifier}")

    async def set_status(self, remote_identifier: str, status: str) -> None:
        await self._put_json(f"/api/user/{remote_identifier}", {"status": status})

    async def disable_user(self, remote_identifier: str) -> None:
        await self.set_status(remote_identifier, "disabled")

    async def enable_user(self, remote_identifier: str) -> None:
        await self.set_status(remote_identifier, "active")

    async def get_direct_subscription_url(self, remote_identifier: str) -> str | None:
        js = await self._get_json(f"/api/user/{remote_identifier}")
        if isinstance(js, dict):
            return js.get("subscription_url") or None
        return None

    async def revoke_subscription(self, label: str, remote_identifier: str, total_gb: int, expire_at: datetime) -> ProvisionResult:
        try:
            await self._post_json(f"/api/user/{remote_identifier}/revoke_sub", {})
        except Exception:
            pass
        direct = await self.get_direct_subscription_url(remote_identifier)
        return ProvisionResult(remote_identifier=remote_identifier, direct_sub_url=direct, meta=None)

    async def reset_usage(self, remote_identifier: str) -> None:
        await self._post_json(f"/api/user/{remote_identifier}/reset", {})

    async def get_used_bytes(self, remote_identifier: str) -> int | None:
        js = await self._get_json(f"/api/user/{remote_identifier}/usage")
        if isinstance(js, dict):
            used = js.get("used_traffic")
            if isinstance(used, int):
                return used
        return None
