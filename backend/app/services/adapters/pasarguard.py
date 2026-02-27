from __future__ import annotations

from datetime import datetime
import asyncio
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

    @staticmethod
    def _as_int(value: Any) -> int | None:
        if value is None:
            return None
        if isinstance(value, bool):
            return int(value)
        if isinstance(value, int):
            return value
        if isinstance(value, float):
            return int(value)
        try:
            s = str(value).strip()
            if not s:
                return None
            return int(float(s))
        except Exception:
            return None

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
        inbound_tags: list[str] = []
        try:
            inbound_tags = await self._get_inbound_tags()
        except Exception:
            inbound_tags = []

        group_name = "guardino_all_inbounds"

        if inbound_tags:
            # Find existing group with same name and keep it synced with all inbounds
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
                pass

        # Fallback: use an existing group (usually ALL) when creating/syncing a dedicated
        # "all inbounds" group is not possible due panel permissions/version differences.
        try:
            simple = await self._get_json("/api/groups/simple?offset=0&limit=500&all=true")
            groups = simple.get("groups") if isinstance(simple, dict) else None
            if isinstance(groups, list) and groups:
                preferred: list[str] = ["all", "guardino_all_inbounds"]
                for name in preferred:
                    for g in groups:
                        if not isinstance(g, dict):
                            continue
                        gid = g.get("id")
                        gname = str(g.get("name") or "").strip().lower()
                        if isinstance(gid, int) and gname == name:
                            return int(gid)
                first = groups[0]
                if isinstance(first, dict) and isinstance(first.get("id"), int):
                    return int(first["id"])
        except Exception:
            pass
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

    def _all_proxy_settings(self) -> dict[str, Any]:
        # Force-enable all common proxy families for newly created users.
        # Pasarguard validates missing optional fields and generates identifiers where needed.
        return {
            "vmess": {},
            "vless": {},
            "trojan": {},
            "shadowsocks": {"method": "chacha20-ietf-poly1305"},
        }

    def _has_proxy_settings(self, proxy_settings: Any) -> bool:
        if not isinstance(proxy_settings, dict):
            return False
        for key in ("vmess", "vless", "trojan", "shadowsocks"):
            val = proxy_settings.get(key)
            if isinstance(val, dict) and len(val) > 0:
                return True
        return False

    async def _get_user_state(self, remote_identifier: str) -> tuple[int | None, bool, list[int]]:
        js = await self._get_json(f"/api/user/{remote_identifier}")
        if not isinstance(js, dict):
            return None, False, []
        uid = js.get("id")
        proxy_ok = self._has_proxy_settings(js.get("proxy_settings"))
        raw_group_ids = js.get("group_ids")
        group_ids: list[int] = []
        if isinstance(raw_group_ids, list):
            group_ids = [gid for gid in raw_group_ids if isinstance(gid, int)]
        return (int(uid) if isinstance(uid, int) else None), proxy_ok, group_ids

    async def _repair_user_connectivity(self, remote_identifier: str, group_id: int | None) -> None:
        # 1) Try direct PUT (common path for newer versions)
        update_payload: dict[str, Any] = {"proxy_settings": self._all_proxy_settings()}
        if group_id:
            update_payload["group_ids"] = [group_id]
        try:
            await self._put_json(f"/api/user/{remote_identifier}", update_payload)
        except Exception:
            pass

        user_id, proxy_ok, group_ids = await self._get_user_state(remote_identifier)
        group_ok = (group_id is None) or (group_id in group_ids)
        if proxy_ok and (group_ok or group_id is None):
            return

        # 2) Try modify with empty proxy_settings (some versions auto-generate defaults)
        try:
            payload: dict[str, Any] = {"proxy_settings": {}}
            if group_id:
                payload["group_ids"] = [group_id]
            await self._put_json(f"/api/user/{remote_identifier}", payload)
        except Exception:
            pass

        user_id, proxy_ok, group_ids = await self._get_user_state(remote_identifier)
        group_ok = (group_id is None) or (group_id in group_ids)
        if proxy_ok and (group_ok or group_id is None):
            return

        # 3) Final fallback: dedicated bulk proxy API
        if user_id is not None:
            bulk_payload: dict[str, Any] = {"users": [user_id], "method": "chacha20-ietf-poly1305"}
            if group_id:
                bulk_payload["group_ids"] = [group_id]
            try:
                await self._post_json("/api/users/bulk/proxy_settings", bulk_payload)
            except Exception:
                pass

        user_id, proxy_ok, group_ids = await self._get_user_state(remote_identifier)
        group_ok = (group_id is None) or (group_id in group_ids)
        missing: list[str] = []
        if not proxy_ok:
            missing.append("proxy_settings")
        if group_id is not None and not group_ok:
            missing.append("group_ids")
        if missing:
            raise AdapterError(
                f"Pasarguard user '{remote_identifier}' created but missing required config: {', '.join(missing)}"
            )

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

        payload_with_proxies = {**payload, "proxy_settings": self._all_proxy_settings()}

        created_without_proxy_settings = False

        # Preferred: use /api/user with group_ids + proxy_settings so ALL inbounds and proxies are enabled.
        try:
            js = await self._post_json("/api/user", payload_with_proxies)
        except AdapterError:
            # Some Pasarguard versions may reject proxy_settings in create payload.
            # Retry without proxy_settings before falling back to template creation.
            try:
                js = await self._post_json("/api/user", payload)
                created_without_proxy_settings = True
            except AdapterError:
                template_id = await self._pick_default_template_id()
                if not template_id:
                    raise
                # from_template only accepts user_template_id + username; then apply limits via PUT
                js = await self._post_json("/api/user/from_template", {"user_template_id": template_id, "username": label})
                # Apply limits + group_ids + proxy settings after template creation
                update_payload: dict[str, Any] = {
                    "expire": int(expire_at.timestamp()),
                    "data_limit": data_limit,
                    "proxy_settings": self._all_proxy_settings(),
                }
                if group_id:
                    update_payload["group_ids"] = [group_id]
                await self._put_json(f"/api/user/{label}", update_payload)

        remote_identifier = (js or {}).get("username") or label
        if created_without_proxy_settings:
            await self._repair_user_connectivity(remote_identifier, group_id)
        else:
            _user_id, proxy_ok, group_ids = await self._get_user_state(remote_identifier)
            group_ok = (group_id is None) or (group_id in group_ids)
            if not proxy_ok or (group_id is not None and not group_ok):
                await self._repair_user_connectivity(remote_identifier, group_id)

        sub_url = (js or {}).get("subscription_url") or (js or {}).get("subscriptionUrl")
        if not sub_url:
            # fetch from user endpoint (retry a bit; some panels populate async)
            for _ in range(3):
                sub_url = await self.get_direct_subscription_url(remote_identifier)
                if sub_url:
                    break
                await asyncio.sleep(0.4)
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
            return js.get("subscription_url") or js.get("subscriptionUrl") or None
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
        # Prefer direct used_traffic from user object (fast + explicit in API schema)
        try:
            js_user = await self._get_json(f"/api/user/{remote_identifier}")
            if isinstance(js_user, dict):
                direct = self._as_int(js_user.get("used_traffic"))
                if direct is None and isinstance(js_user.get("data"), dict):
                    direct = self._as_int(js_user["data"].get("used_traffic"))
                if direct is not None:
                    return max(0, direct)
        except Exception:
            pass

        # Fallback: usage stats endpoint requires period query param.
        # We use month snapshots and infer current usage from the latest value(s).
        js = await self._get_json(f"/api/user/{remote_identifier}/usage?period=month")
        if isinstance(js, dict):
            payload = js.get("data") if isinstance(js.get("data"), dict) else js
            stats = payload.get("stats")
            if isinstance(stats, dict):
                total = 0
                found_any = False
                for _series, points in stats.items():
                    if not isinstance(points, list):
                        continue
                    vals: list[int] = []
                    for p in points:
                        if not isinstance(p, dict):
                            continue
                        v = self._as_int(p.get("total_traffic"))
                        if v is None:
                            continue
                        vals.append(max(0, v))
                    if vals:
                        # keep the latest cumulative value for each series
                        total += max(vals)
                        found_any = True
                if found_any:
                    return total

            direct = self._as_int(payload.get("used_traffic"))
            if direct is not None:
                return max(0, direct)
        return None
