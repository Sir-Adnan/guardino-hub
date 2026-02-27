from __future__ import annotations

import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote, unquote

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
    _PEER_ID_FIELDS = (
        "id",
        "peer_id",
        "peerId",
        "public_key",
        "publicKey",
        "client_public_key",
        "clientPublicKey",
    )
    _TOTAL_USAGE_FIELDS = ("total_data", "totalData", "total_traffic", "totalTraffic")
    _TOTAL_RECV_FIELDS = ("total_receive", "totalReceive", "download")
    _TOTAL_SENT_FIELDS = ("total_sent", "totalSent", "upload")
    _CUMU_USAGE_FIELDS = ("cumu_data", "cumuData", "cumulative_data", "cumulativeData")
    _CUMU_RECV_FIELDS = ("cumu_receive", "cumuReceive", "cumulative_receive", "cumulativeReceive")
    _CUMU_SENT_FIELDS = ("cumu_sent", "cumuSent", "cumulative_sent", "cumulativeSent")

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
        self._configuration_names_cache: list[str] | None = None
        self._peer_index_loaded: bool = False
        self._peer_index: dict[str, tuple[dict[str, Any], str, bool]] = {}

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
    def _as_optional_int(value: Any) -> int | None:
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

    @staticmethod
    def _as_optional_number(value: Any) -> float | None:
        if value is None:
            return None
        if isinstance(value, bool):
            return float(int(value))
        if isinstance(value, (int, float)):
            return float(value)
        try:
            s = str(value).strip().replace(",", "")
            if not s:
                return None
            return float(s)
        except Exception:
            m = re.search(r"[-+]?\d*\.?\d+", str(value))
            if not m:
                return None
            try:
                return float(m.group(0))
            except Exception:
                return None

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

    @staticmethod
    def _id_candidates(value: Any) -> set[str]:
        raw = str(value or "").strip()
        if not raw:
            return set()
        out = {raw}
        try:
            uq = unquote(raw).strip()
            if uq:
                out.add(uq)
        except Exception:
            pass
        try:
            q = quote(raw, safe="").strip()
            if q:
                out.add(q)
        except Exception:
            pass
        return {x for x in out if x}

    @classmethod
    def _peer_identifier_candidates(cls, peer: dict[str, Any]) -> set[str]:
        ids: set[str] = set()
        for field in cls._PEER_ID_FIELDS:
            ids.update(cls._id_candidates(peer.get(field)))
        return ids

    @classmethod
    def _id_matches(cls, left: Any, right: Any) -> bool:
        return bool(cls._id_candidates(left).intersection(cls._id_candidates(right)))

    def _invalidate_peer_index(self) -> None:
        self._peer_index_loaded = False
        self._peer_index = {}

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
        names = await self._list_configuration_names()
        self.configuration_name = names[0]
        return self.configuration_name

    async def _list_configuration_names(self) -> list[str]:
        if self._configuration_names_cache is not None:
            return self._configuration_names_cache
        data = await self._get_json("/api/getWireguardConfigurations")
        if not isinstance(data, list) or not data:
            raise AdapterError("WGDashboard has no WireGuard configuration available")
        names: list[str] = []
        for item in data:
            if not isinstance(item, dict):
                continue
            name = str(item.get("Name") or "").strip()
            if name:
                names.append(name)
        if not names:
            raise AdapterError("WGDashboard configuration discovery failed")
        self._configuration_names_cache = names
        return names

    async def _ordered_configuration_names(self) -> list[str]:
        names = await self._list_configuration_names()
        preferred = str(self.configuration_name or "").strip()
        if not preferred:
            return names
        ordered = [preferred]
        ordered.extend(n for n in names if n != preferred)
        return ordered

    async def _get_configuration_info(self, config_name: str | None = None) -> dict[str, Any]:
        target_config = str(config_name or "").strip() or await self._resolve_configuration_name()
        data = await self._get_json("/api/getWireguardConfigurationInfo", params={"configurationName": target_config})
        if not isinstance(data, dict):
            raise AdapterError("WGDashboard getWireguardConfigurationInfo returned invalid payload")
        return data

    @staticmethod
    def _iter_info_peers(data: dict[str, Any]) -> list[tuple[dict[str, Any], bool]]:
        out: list[tuple[dict[str, Any], bool]] = []
        peers = data.get("configurationPeers")
        if isinstance(peers, list):
            for peer in peers:
                if isinstance(peer, dict):
                    out.append((peer, False))
        restricted = data.get("configurationRestrictedPeers")
        if isinstance(restricted, list):
            for peer in restricted:
                if isinstance(peer, dict):
                    out.append((peer, True))
                elif isinstance(peer, str) and peer.strip():
                    out.append(({"id": peer.strip()}, True))
        return out

    async def _ensure_peer_index(self, *, refresh_config_names: bool = False) -> None:
        if self._peer_index_loaded and not refresh_config_names:
            return
        if refresh_config_names:
            self._configuration_names_cache = None
        index: dict[str, tuple[dict[str, Any], str, bool]] = {}
        first_error: Exception | None = None
        for config_name in await self._ordered_configuration_names():
            try:
                info = await self._get_configuration_info(config_name)
            except Exception as e:
                if first_error is None:
                    first_error = e
                continue
            for peer, is_restricted in self._iter_info_peers(info):
                ids = self._peer_identifier_candidates(peer)
                for pid in ids:
                    if pid not in index:
                        index[pid] = (peer, config_name, is_restricted)
        if not index and first_error is not None:
            raise first_error
        self._peer_index = index
        self._peer_index_loaded = True

    async def _get_peer_context(
        self,
        remote_identifier: str,
        *,
        allow_refresh: bool = True,
    ) -> tuple[dict[str, Any] | None, str | None, bool]:
        candidates = self._id_candidates(remote_identifier)
        if not candidates:
            return None, None, False
        await self._ensure_peer_index()
        for candidate in candidates:
            found = self._peer_index.get(candidate)
            if found:
                return found
        if allow_refresh:
            # Retry once with refreshed configuration list in case configs changed.
            await self._ensure_peer_index(refresh_config_names=True)
            for candidate in candidates:
                found = self._peer_index.get(candidate)
                if found:
                    return found
        return None, None, False

    async def _resolve_peer_request_id(self, remote_identifier: str) -> str:
        peer, _config_name, _is_restricted = await self._get_peer_context(remote_identifier)
        if isinstance(peer, dict):
            preferred = str(peer.get("id") or "").strip()
            if preferred:
                return preferred
            for field in self._PEER_ID_FIELDS:
                candidate = str(peer.get(field) or "").strip()
                if candidate:
                    return candidate
        unquoted = unquote(str(remote_identifier or "").strip())
        return unquoted.strip() or str(remote_identifier or "").strip()

    async def _resolve_peer_configuration_name(self, remote_identifier: str) -> str:
        _peer, config_name, _restricted = await self._get_peer_context(remote_identifier)
        if config_name:
            return config_name
        return await self._resolve_configuration_name()

    async def _get_peer_info(self, remote_identifier: str) -> dict[str, Any] | None:
        peer, _config_name, _restricted = await self._get_peer_context(remote_identifier)
        return peer

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
        if not self._id_matches(job.get("Peer"), remote_identifier):
            return False
        return self._job_field(job) == "total_data" and self._job_action(job) == "restrict"

    def _is_expiry_job(self, job: dict[str, Any], remote_identifier: str) -> bool:
        if not self._id_matches(job.get("Peer"), remote_identifier):
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
            if not self._id_matches(job.get("Peer"), remote_identifier):
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
        config_name = await self._resolve_peer_configuration_name(remote_identifier)
        peer_id = await self._resolve_peer_request_id(remote_identifier)
        jobs = await self._list_peer_jobs(remote_identifier)
        matched = [j for j in jobs if matcher(j, remote_identifier)]
        current = matched[0] if matched else None

        job = {
            "JobID": str((current or {}).get("JobID") or str(uuid.uuid4())),
            "Configuration": config_name,
            "Peer": str(peer_id),
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

        # WGDashboard schedule jobs for total_data expect GB values.
        await self._upsert_peer_schedule_job(
            remote_identifier,
            field="total_data",
            operator="lgt",
            value=str(safe_total),
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
        self._invalidate_peer_index()

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
        peer, _config_name, _restricted = await self._get_peer_context(remote_identifier)
        if not isinstance(peer, dict):
            raise AdapterError(f"WGDashboard peer not found: {remote_identifier}")
        await self._sync_peer_volume_job(remote_identifier, total_gb)
        await self._sync_peer_expiry_job(remote_identifier, expire_at)
        self._invalidate_peer_index()

    async def delete_user(self, remote_identifier: str) -> None:
        config_name = await self._resolve_peer_configuration_name(remote_identifier)
        peer_id = await self._resolve_peer_request_id(remote_identifier)
        try:
            await self._delete_peer_volume_jobs(remote_identifier)
        except Exception:
            pass
        try:
            await self._delete_peer_expiry_jobs(remote_identifier)
        except Exception:
            pass
        await self._post_json(f"/api/deletePeers/{config_name}", {"peers": [peer_id]})
        self._invalidate_peer_index()

    async def set_status(self, remote_identifier: str, status: str) -> None:
        config_name = await self._resolve_peer_configuration_name(remote_identifier)
        peer_id = await self._resolve_peer_request_id(remote_identifier)
        if status == "active":
            try:
                await self._post_json(f"/api/allowAccessPeers/{config_name}", {"peers": [peer_id]})
            except AdapterError:
                # Some WGDashboard builds return status=false even when peer is already allowed.
                peer, _cfg, is_restricted = await self._get_peer_context(remote_identifier)
                if isinstance(peer, dict) and not is_restricted:
                    return
                raise
        else:
            await self._post_json(f"/api/restrictPeers/{config_name}", {"peers": [peer_id]})
        self._invalidate_peer_index()

    async def disable_user(self, remote_identifier: str) -> None:
        await self.set_status(remote_identifier, "disabled")

    async def enable_user(self, remote_identifier: str) -> None:
        await self.set_status(remote_identifier, "active")

    async def get_direct_subscription_url(self, remote_identifier: str) -> str | None:
        config_name = await self._resolve_peer_configuration_name(remote_identifier)
        peer_id = await self._resolve_peer_request_id(remote_identifier)
        encoded = quote(peer_id, safe="")
        return f"{self.base_url}/api/downloadPeer/{config_name}?id={encoded}"

    async def download_peer_config(self, remote_identifier: str) -> tuple[str, str]:
        config_name = await self._resolve_peer_configuration_name(remote_identifier)
        peer_id = await self._resolve_peer_request_id(remote_identifier)
        data = await self._get_json(f"/api/downloadPeer/{config_name}", params={"id": peer_id})
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
        config_name = await self._resolve_peer_configuration_name(remote_identifier)
        peer_id = await self._resolve_peer_request_id(remote_identifier)
        await self._post_json(f"/api/resetPeerData/{config_name}", {"id": peer_id, "type": "total"})
        try:
            await self._post_json(f"/api/resetPeerData/{config_name}", {"id": peer_id, "type": "cumu"})
        except Exception:
            pass
        self._invalidate_peer_index()

    @classmethod
    def _extract_peer_used_bytes(cls, peer: dict[str, Any]) -> int | None:
        def _pick(keys: tuple[str, ...] | list[str]) -> float | None:
            for key in keys:
                parsed = cls._as_optional_number(peer.get(key))
                if parsed is not None:
                    return max(0.0, float(parsed))
            return None

        prefer_gb_units = cls._peer_volume_job_uses_gb(peer)
        direct_total = _pick(cls._TOTAL_USAGE_FIELDS)
        direct_cumu = _pick(cls._CUMU_USAGE_FIELDS)

        total_recv = _pick(cls._TOTAL_RECV_FIELDS)
        total_sent = _pick(cls._TOTAL_SENT_FIELDS)
        total_sum = (total_recv or 0.0) + (total_sent or 0.0) if (total_recv is not None or total_sent is not None) else None

        cumu_recv = _pick(cls._CUMU_RECV_FIELDS)
        cumu_sent = _pick(cls._CUMU_SENT_FIELDS)
        cumu_sum = (cumu_recv or 0.0) + (cumu_sent or 0.0) if (cumu_recv is not None or cumu_sent is not None) else None

        def _max_bytes(candidates: list[float | None]) -> int | None:
            out: list[int] = []
            for candidate in candidates:
                b = cls._usage_value_to_bytes(candidate, prefer_gb_units=prefer_gb_units)
                if b is None:
                    continue
                out.append(max(0, int(b)))
            if not out:
                return None
            return max(out)

        total_bytes = _max_bytes([direct_total, total_sum])
        cumu_bytes = _max_bytes([direct_cumu, cumu_sum])

        if total_bytes is None and cumu_bytes is None:
            return None

        if total_bytes is None:
            return max(0, int(cumu_bytes or 0))
        if total_bytes > 0:
            return max(0, int(total_bytes))
        if cumu_bytes is not None and cumu_bytes > 0:
            # Some builds only update cumulative counters while total_* stays zero.
            return max(0, int(cumu_bytes))
        return max(0, int(total_bytes))

    @classmethod
    def _peer_volume_job_uses_gb(cls, peer: dict[str, Any]) -> bool:
        jobs = peer.get("jobs")
        if not isinstance(jobs, list):
            return False
        for job in jobs:
            if not isinstance(job, dict):
                continue
            if cls._job_field(job) != "total_data" or cls._job_action(job) != "restrict":
                continue
            val = cls._as_optional_number(job.get("Value"))
            if val is None or val <= 0:
                continue
            # In official WGDashboard docs, total_data schedule jobs are set in GB.
            # Very large values indicate legacy byte-based jobs from older Guardino versions.
            if val <= 1_000_000:
                return True
        return False

    @classmethod
    def _usage_value_to_bytes(cls, value: float | None, *, prefer_gb_units: bool) -> int | None:
        if value is None:
            return None
        safe = max(0.0, float(value))
        if safe <= 0:
            return 0

        # Fractional counters are treated as GB values.
        if abs(safe - round(safe)) > 1e-9:
            return int(safe * cls.BYTES_PER_GB)

        whole = int(round(safe))
        if prefer_gb_units:
            return whole * cls.BYTES_PER_GB
        return whole

    async def get_used_bytes(self, remote_identifier: str) -> int | None:
        peer = await self._get_peer_info(remote_identifier)
        if not isinstance(peer, dict):
            return None
        return self._extract_peer_used_bytes(peer)

    async def get_used_bytes_many(self, remote_identifiers: list[str]) -> dict[str, int | None]:
        result: dict[str, int | None] = {}
        cleaned: list[str] = []
        for rid in remote_identifiers:
            key = str(rid or "").strip()
            if not key:
                continue
            cleaned.append(key)
            result[key] = None
        if not cleaned:
            return result
        await self._ensure_peer_index()
        missing: list[str] = []
        for rid in cleaned:
            peer, _config_name, _restricted = await self._get_peer_context(rid, allow_refresh=False)
            if not isinstance(peer, dict):
                missing.append(rid)
                continue
            result[rid] = self._extract_peer_used_bytes(peer)
        # One refresh pass helps after topology changes or stale cached config names.
        if missing:
            await self._ensure_peer_index(refresh_config_names=True)
            for rid in missing:
                peer, _config_name, _restricted = await self._get_peer_context(rid, allow_refresh=False)
                if not isinstance(peer, dict):
                    continue
                result[rid] = self._extract_peer_used_bytes(peer)
        return result
