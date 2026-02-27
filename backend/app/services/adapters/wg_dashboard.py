from __future__ import annotations

import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx

from app.services.adapters.base import AdapterError, ProvisionResult, TestConnectionResult


class WGDashboardAdapter:
    """WGDashboard adapter (v4.3.x).

    Node.credentials expected (minimum):
      {
        "apikey": "...",
        "configuration_name": "wg0",  # optional, auto-detected if omitted
        "dns_addresses": "1.1.1.1",
        "mtu": 1460,
        "keep_alive": 21,
        "endpoint_allowed_ip": "0.0.0.0/0",
        "allowed_ips_validation": true
      }

    remote_identifier is stored as WG peer id/public_key (base64).
    """
    BYTES_PER_GB = 1024 ** 3
    _TRAFFIC_FIELDS = {"total_receive", "total_sent", "total_data"}
    _EXPIRY_FIELDS = {"date", "datetime", "expire", "expire_at", "expire_date"}

    def __init__(self, base_url: str, credentials: dict[str, Any], verify_ssl: bool = True, timeout: float = 20.0):
        self.base_url = base_url.rstrip("/")
        self.apikey = str(credentials.get("apikey") or "")
        self.configuration_name = str(
            credentials.get("configuration_name")
            or credentials.get("config_name")
            or credentials.get("interface")
            or ""
        ).strip()
        self.verify_ssl = verify_ssl
        self.timeout = timeout

        self.dns_addresses = str(credentials.get("dns_addresses") or "1.1.1.1").strip()
        self.mtu = self._as_int(credentials.get("mtu"), 1460)
        self.keep_alive = self._as_int(credentials.get("keep_alive"), 21)
        self.endpoint_allowed_ip = str(credentials.get("endpoint_allowed_ip") or "0.0.0.0/0")
        self.allowed_ips_validation = self._as_bool(credentials.get("allowed_ips_validation"), True)
        self.remote_endpoint = str(credentials.get("remote_endpoint") or "").strip()
        self.preshared_key = str(credentials.get("preshared_key") or "").strip()

        if not self.apikey:
            raise AdapterError("WGDashboard credentials must include 'apikey'")

    @staticmethod
    def _as_int(value: Any, default: int) -> int:
        try:
            if value is None:
                return default
            return int(str(value).strip())
        except Exception:
            return default

    @staticmethod
    def _as_bool(value: Any, default: bool) -> bool:
        if value is None:
            return default
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return bool(value)
        s = str(value).strip().lower()
        if s in {"1", "true", "yes", "on"}:
            return True
        if s in {"0", "false", "no", "off"}:
            return False
        return default

    def _headers(self) -> dict[str, str]:
        return {"Accept": "application/json", "wg-dashboard-apikey": self.apikey}

    def _extract_data_or_raise(self, payload: Any) -> Any:
        if isinstance(payload, dict) and "status" in payload:
            ok = bool(payload.get("status"))
            if not ok:
                msg = str(payload.get("message") or "WGDashboard API returned status=false")
                raise AdapterError(msg)
            return payload.get("data")
        return payload

    async def _get_json(self, path: str, params: dict[str, Any] | None = None) -> Any:
        url = f"{self.base_url}{path}"
        async with httpx.AsyncClient(verify=self.verify_ssl, timeout=self.timeout) as client:
            r = await client.get(url, headers=self._headers(), params=params)
        if r.status_code >= 400:
            raise AdapterError(f"HTTP {r.status_code} GET {path}: {r.text[:300]}")
        payload = r.json() if r.text else None
        return self._extract_data_or_raise(payload)

    async def _post_json(self, path: str, payload: dict[str, Any]) -> Any:
        url = f"{self.base_url}{path}"
        async with httpx.AsyncClient(verify=self.verify_ssl, timeout=self.timeout) as client:
            r = await client.post(url, headers={**self._headers(), "Content-Type": "application/json"}, json=payload)
        if r.status_code >= 400:
            raise AdapterError(f"HTTP {r.status_code} POST {path}: {r.text[:300]}")
        body = r.json() if r.text else None
        return self._extract_data_or_raise(body)

    async def _resolve_configuration_name(self) -> str:
        if self.configuration_name:
            return self.configuration_name

        data = await self._get_json("/api/getWireguardConfigurations")
        if not isinstance(data, list) or not data:
            raise AdapterError("WGDashboard has no WireGuard configuration available")

        for item in data:
            if isinstance(item, dict):
                name = str(item.get("Name") or "").strip()
                if name:
                    self.configuration_name = name
                    return name
        raise AdapterError("WGDashboard configuration discovery failed")

    async def _get_configuration_info(self) -> dict[str, Any]:
        config_name = await self._resolve_configuration_name()
        data = await self._get_json("/api/getWireguardConfigurationInfo", params={"configurationName": config_name})
        if not isinstance(data, dict):
            raise AdapterError("WGDashboard getWireguardConfigurationInfo returned invalid payload")
        return data

    async def _get_peer_info(self, remote_identifier: str) -> dict[str, Any] | None:
        data = await self._get_configuration_info()
        peers = data.get("configurationPeers")
        if not isinstance(peers, list):
            return None
        for peer in peers:
            if not isinstance(peer, dict):
                continue
            if str(peer.get("id") or "") == str(remote_identifier):
                return peer
        return None

    @staticmethod
    def _job_field(job: dict[str, Any]) -> str:
        return str(job.get("Field") or "").strip().lower()

    @staticmethod
    def _job_action(job: dict[str, Any]) -> str:
        return str(job.get("Action") or "").strip().lower()

    @staticmethod
    def _looks_like_datetime(value: str) -> bool:
        s = str(value or "").strip()
        if not s:
            return False
        try:
            datetime.strptime(s, "%Y-%m-%d %H:%M:%S")
            return True
        except Exception:
            return False

    @staticmethod
    def _format_job_datetime(value: datetime) -> str:
        # WGDashboard schedule jobs expect "YYYY-mm-dd HH:MM:SS" string.
        return value.strftime("%Y-%m-%d %H:%M:%S")

    def _is_volume_job(self, job: dict[str, Any], remote_identifier: str) -> bool:
        if str(job.get("Peer") or "") != str(remote_identifier):
            return False
        return self._job_field(job) == "total_data" and self._job_action(job) == "restrict"

    def _is_expiry_job(self, job: dict[str, Any], remote_identifier: str) -> bool:
        if str(job.get("Peer") or "") != str(remote_identifier):
            return False
        field = self._job_field(job)
        if field in self._EXPIRY_FIELDS:
            return True
        # Backward/legacy compatibility: any datetime-based restrict/delete rule.
        if field in self._TRAFFIC_FIELDS:
            return False
        if self._job_action(job) not in {"restrict", "delete"}:
            return False
        return self._looks_like_datetime(str(job.get("Value") or ""))

    async def _list_peer_jobs(self, remote_identifier: str) -> list[dict[str, Any]]:
        peer = await self._get_peer_info(remote_identifier)
        if not isinstance(peer, dict):
            return []
        jobs = peer.get("jobs")
        if not isinstance(jobs, list):
            return []
        out: list[dict[str, Any]] = []
        for job in jobs:
            if not isinstance(job, dict):
                continue
            if str(job.get("Peer") or "") != str(remote_identifier):
                continue
            out.append(job)
        return out

    async def _delete_peer_jobs(
        self,
        remote_identifier: str,
        matcher,
    ) -> None:
        jobs = await self._list_peer_jobs(remote_identifier)
        for job in jobs:
            if not matcher(job, remote_identifier):
                continue
            try:
                await self._post_json("/api/deletePeerScheduleJob", {"Job": job})
            except Exception:
                # best-effort cleanup
                continue

    async def _delete_peer_volume_jobs(self, remote_identifier: str) -> None:
        await self._delete_peer_jobs(remote_identifier, self._is_volume_job)

    async def _delete_peer_expiry_jobs(self, remote_identifier: str) -> None:
        await self._delete_peer_jobs(remote_identifier, self._is_expiry_job)

    async def _upsert_peer_schedule_job(
        self,
        remote_identifier: str,
        *,
        field: str,
        operator: str,
        value: str,
        action: str,
        matcher,
    ) -> None:
        config_name = await self._resolve_configuration_name()
        jobs = await self._list_peer_jobs(remote_identifier)
        matched = [j for j in jobs if matcher(j, remote_identifier)]
        current = matched[0] if matched else None

        job = {
            "JobID": str((current or {}).get("JobID") or str(uuid.uuid4())),
            "Configuration": config_name,
            "Peer": str(remote_identifier),
            "Field": field,
            "Operator": operator,
            "Value": str(value),
            "CreationDate": str((current or {}).get("CreationDate") or ""),
            "ExpireDate": str((current or {}).get("ExpireDate") or ""),
            "Action": action,
        }
        await self._post_json("/api/savePeerScheduleJob", {"Job": job})

        # Keep a single active job for this rule kind.
        keep_id = str(job["JobID"])
        for old in matched[1:]:
            old_id = str(old.get("JobID") or "")
            if not old_id or old_id == keep_id:
                continue
            try:
                await self._post_json("/api/deletePeerScheduleJob", {"Job": old})
            except Exception:
                continue

    async def _sync_peer_volume_job(self, remote_identifier: str, total_gb: int) -> None:
        safe_total = max(0, int(total_gb))
        if safe_total <= 0:
            await self._delete_peer_volume_jobs(remote_identifier)
            return

        value_bytes = safe_total * self.BYTES_PER_GB
        await self._upsert_peer_schedule_job(
            remote_identifier,
            field="total_data",
            operator="lgt",
            value=str(value_bytes),
            action="restrict",
            matcher=self._is_volume_job,
        )

    async def _sync_peer_expiry_job(self, remote_identifier: str, expire_at: datetime) -> None:
        # Guardino uses far-future timestamp for "no-expire"; skip creating expiry jobs for that case.
        now_ref = datetime.now(tz=expire_at.tzinfo) if expire_at.tzinfo else datetime.utcnow()
        if (expire_at - now_ref).total_seconds() >= (36500 * 86400) - 60:
            await self._delete_peer_expiry_jobs(remote_identifier)
            return

        await self._upsert_peer_schedule_job(
            remote_identifier,
            field="date",
            operator="lgt",
            value=self._format_job_datetime(expire_at),
            action="restrict",
            matcher=self._is_expiry_job,
        )

    async def _build_add_peer_payload(self, label: str) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "name": label,
            "allowed_ips_validation": self.allowed_ips_validation,
            "dns_addresses": self.dns_addresses,
            "mtu": self.mtu,
            "keep_alive": self.keep_alive,
            "endpoint_allowed_ip": self.endpoint_allowed_ip,
        }
        if self.remote_endpoint:
            payload["remote_endpoint"] = self.remote_endpoint
        if self.preshared_key:
            payload["preshared_key"] = self.preshared_key

        # Use a deterministic available address when possible.
        # If the API call fails, WGDashboard default behavior is still valid.
        try:
            available_ip = await self._get_available_ip()
            if available_ip:
                payload["allowed_ips"] = [available_ip]
        except Exception:
            pass
        return payload

    async def test_connection(self) -> TestConnectionResult:
        try:
            await self._get_json("/api/handshake")
            config_name = await self._resolve_configuration_name()
            return TestConnectionResult(ok=True, detail="ok", meta={"configuration_name": config_name})
        except Exception as e:
            return TestConnectionResult(ok=False, detail=str(e))

    async def _get_available_ip(self) -> str:
        config_name = await self._resolve_configuration_name()
        data = await self._get_json(f"/api/getAvailableIPs/{config_name}")
        if isinstance(data, dict):
            for _subnet, ip_list in data.items():
                if isinstance(ip_list, list):
                    for candidate in ip_list:
                        s = str(candidate or "").strip()
                        if s:
                            return s
        if isinstance(data, list):
            for candidate in data:
                s = str(candidate or "").strip()
                if s:
                    return s
        raise AdapterError("WGDashboard: no available IP returned")

    async def provision_user(self, label: str, total_gb: int, expire_at: datetime) -> ProvisionResult:
        config_name = await self._resolve_configuration_name()
        payload = await self._build_add_peer_payload(label)
        try:
            result = await self._post_json(f"/api/addPeers/{config_name}", payload)
        except Exception:
            # Fallback: let WGDashboard use dashboard defaults.
            # Some deployments may reject strict custom fields.
            result = await self._post_json(f"/api/addPeers/{config_name}", {"name": label})
        if not isinstance(result, list) or not result:
            raise AdapterError("WGDashboard addPeers returned an empty response")
        peer = result[0] if isinstance(result[0], dict) else {}
        remote_identifier = str(peer.get("id") or "").strip()
        if not remote_identifier:
            raise AdapterError("WGDashboard addPeers did not return peer id")

        # Explicitly allow access (idempotent) and sync schedule limit.
        try:
            await self.enable_user(remote_identifier)
        except Exception:
            pass
        try:
            await self._sync_peer_volume_job(remote_identifier, total_gb)
        except Exception:
            # Guardino local enforcement still applies even if peer job fails.
            pass
        try:
            await self._sync_peer_expiry_job(remote_identifier, expire_at)
        except Exception:
            # Guardino local enforcement still applies even if peer job fails.
            pass

        direct = await self.get_direct_subscription_url(remote_identifier)
        return ProvisionResult(
            remote_identifier=remote_identifier,
            direct_sub_url=direct,
            meta={
                "configuration_name": config_name,
                "allowed_ip": peer.get("allowed_ip"),
                "name": peer.get("name"),
            },
        )

    async def update_user_limits(self, remote_identifier: str, total_gb: int, expire_at: datetime) -> None:
        # WGDashboard does not have native quota/expiry fields per peer.
        # Mirror Guardino limits using peer schedule jobs.
        await self._sync_peer_volume_job(remote_identifier, total_gb)
        await self._sync_peer_expiry_job(remote_identifier, expire_at)

    async def delete_user(self, remote_identifier: str) -> None:
        config_name = await self._resolve_configuration_name()
        try:
            await self._delete_peer_volume_jobs(remote_identifier)
        except Exception:
            pass
        try:
            await self._delete_peer_expiry_jobs(remote_identifier)
        except Exception:
            pass
        await self._post_json(f"/api/deletePeers/{config_name}", {"peers": [remote_identifier]})

    async def set_status(self, remote_identifier: str, status: str) -> None:
        config_name = await self._resolve_configuration_name()
        if status == "active":
            await self._post_json(f"/api/allowAccessPeers/{config_name}", {"peers": [remote_identifier]})
        else:
            await self._post_json(f"/api/restrictPeers/{config_name}", {"peers": [remote_identifier]})

    async def disable_user(self, remote_identifier: str) -> None:
        await self.set_status(remote_identifier, "disabled")

    async def enable_user(self, remote_identifier: str) -> None:
        await self.set_status(remote_identifier, "active")

    async def get_direct_subscription_url(self, remote_identifier: str) -> str | None:
        config_name = await self._resolve_configuration_name()
        encoded = quote(remote_identifier, safe="")
        return f"{self.base_url}/api/downloadPeer/{config_name}?id={encoded}"

    async def download_peer_config(self, remote_identifier: str) -> tuple[str, str]:
        config_name = await self._resolve_configuration_name()
        data = await self._get_json(f"/api/downloadPeer/{config_name}", params={"id": remote_identifier})
        if not isinstance(data, dict):
            raise AdapterError("WGDashboard downloadPeer returned invalid payload")
        file_content = str(data.get("file") or "")
        if not file_content.strip():
            raise AdapterError("WGDashboard did not return peer config content")
        raw_file_name = str(data.get("fileName") or "wireguard-peer").strip() or "wireguard-peer"
        name_only = Path(raw_file_name).name
        stem = Path(name_only).stem or "wireguard-peer"
        stem = re.sub(r"[^a-zA-Z0-9_.-]+", "_", stem).strip("._-") or "wireguard-peer"
        file_name = f"{stem}.conf"
        return file_name, file_content

    async def revoke_subscription(self, label: str, remote_identifier: str, total_gb: int, expire_at: datetime) -> ProvisionResult:
        # Policy: delete & recreate peer (link changes).
        try:
            await self.delete_user(remote_identifier)
        except Exception:
            pass
        return await self.provision_user(label=label, total_gb=total_gb, expire_at=expire_at)

    async def reset_usage(self, remote_identifier: str) -> None:
        config_name = await self._resolve_configuration_name()
        await self._post_json(f"/api/resetPeerData/{config_name}", {"id": remote_identifier, "type": "total"})

    async def get_used_bytes(self, remote_identifier: str) -> int | None:
        peer = await self._get_peer_info(remote_identifier)
        if not isinstance(peer, dict):
            return None
        val = peer.get("total_data")
        try:
            return int(val)
        except Exception:
            return None
