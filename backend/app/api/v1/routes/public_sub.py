from __future__ import annotations

import html
import json
import re
from datetime import datetime, timezone
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import HTMLResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.models.node import Node, PanelType
from app.models.node_allocation import NodeAllocation
from app.models.subaccount import SubAccount
from app.models.user import GuardinoUser, NodeSelectionMode, UserStatus
from app.services.adapters.factory import get_adapter
from app.services.http_client import build_async_client
from app.services.subscription_merge import merge_subscriptions

router = APIRouter()


def _normalize_url(direct: str | None, base_url: str | None) -> str | None:
    if not direct:
        return None
    u = direct.strip()
    if not u:
        return None
    if u.startswith("http://") or u.startswith("https://"):
        return u
    if not base_url:
        return u
    b = base_url.strip()
    if not b:
        return u
    try:
        p = urlparse(b)
        if p.scheme and p.netloc:
            origin = f"{p.scheme}://{p.netloc}"
        else:
            origin = b
    except Exception:
        origin = b
    if not u.startswith("/"):
        u = "/" + u
    return origin.rstrip("/") + u


def _wants_html(request: Request) -> bool:
    qp = request.query_params
    raw = str(qp.get("raw") or "").strip().lower()
    if raw in ("1", "true", "yes"):
        return False
    view = str(qp.get("view") or qp.get("format") or "").strip().lower()
    if view in ("1", "html", "web"):
        return True
    accept = (request.headers.get("accept") or "").lower()
    return "text/html" in accept


def _safe_conf_filename(name: str | None, fallback: str) -> str:
    base = str(name or "").strip()
    if not base:
        base = fallback
    base = re.sub(r"[^a-zA-Z0-9_.-]+", "_", base).strip("._-") or fallback
    if not base.lower().endswith(".conf"):
        base = f"{base}.conf"
    return base[:120]


def _render_sub_page(
    *,
    token: str,
    user: GuardinoUser,
    master_raw_link: str,
    node_links: list[dict[str, str]],
) -> str:
    used_gb = float(user.used_bytes or 0) / (1024 * 1024 * 1024)
    total_gb = float(user.total_gb or 0)
    remain_gb = max(0.0, total_gb - used_gb)
    percent = 0 if total_gb <= 0 else min(100, int((used_gb / total_gb) * 100))
    now = datetime.now(timezone.utc)
    days_left = int((user.expire_at - now).total_seconds() // 86400)

    rows = []
    for item in node_links:
        node_name = html.escape(item.get("node_name") or f"Node #{item.get('node_id')}")
        panel_type = html.escape(item.get("panel_type") or "unknown")
        status = html.escape(item.get("status") or "missing")
        url = item.get("url") or ""
        url_html = html.escape(url)
        url_js = json.dumps(url)
        badge = "ok" if status == "ok" else ("warn" if status == "missing" else "err")
        action_text = "دانلود فایل" if panel_type == "wg_dashboard" else "باز کردن لینک"
        action = (
            f'<a class="btn" href="{url_html}" target="_blank" rel="noopener">{action_text}</a>'
            if url
            else '<span class="muted">بدون لینک</span>'
        )
        copy_btn = (
            f'<button class="btn btn-outline" onclick="copyText({url_js})">کپی</button>' if url else ""
        )
        rows.append(
            f"""
            <div class="row">
              <div class="meta">
                <div class="name">{node_name}</div>
                <div class="sub">{panel_type}</div>
              </div>
              <div class="url">{url_html or "—"}</div>
              <div class="status {badge}">{status}</div>
              <div class="actions">{copy_btn}{action}</div>
            </div>
            """
        )

    rows_html = "\n".join(rows) if rows else '<div class="empty">لینکی برای این کاربر پیدا نشد.</div>'
    label = html.escape(user.label or f"user-{user.id}")
    expire_text = html.escape(user.expire_at.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"))
    status = html.escape(user.status.value if hasattr(user.status, "value") else str(user.status))
    master_link_html = html.escape(master_raw_link)
    master_link_js = json.dumps(master_raw_link)
    token_html = html.escape(token)

    return f"""<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Guardino Subscription</title>
  <style>
    :root {{
      --bg: #0b1220;
      --card: #0f172a;
      --line: #1f2937;
      --fg: #e5e7eb;
      --muted: #94a3b8;
      --ok: #16a34a;
      --warn: #d97706;
      --err: #dc2626;
      --btn: #2563eb;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      background: radial-gradient(1200px 700px at 15% -10%, #1e293b 0%, var(--bg) 45%);
      color: var(--fg);
      padding: 16px;
    }}
    .container {{ max-width: 1100px; margin: 0 auto; display: grid; gap: 16px; }}
    .card {{ background: color-mix(in srgb, var(--card) 88%, #000 12%); border: 1px solid var(--line); border-radius: 16px; padding: 16px; }}
    .title {{ font-size: 22px; font-weight: 800; margin: 0 0 6px; }}
    .subtitle {{ color: var(--muted); font-size: 13px; }}
    .grid {{ display: grid; gap: 10px; grid-template-columns: repeat(4, minmax(0, 1fr)); margin-top: 12px; }}
    .stat {{ border: 1px solid var(--line); border-radius: 12px; padding: 10px; background: #0b1325; }}
    .k {{ color: var(--muted); font-size: 12px; }}
    .v {{ margin-top: 5px; font-size: 16px; font-weight: 700; }}
    .progress {{ height: 9px; border-radius: 999px; background: #111827; overflow: hidden; margin-top: 10px; border: 1px solid var(--line); }}
    .progress > span {{ display: block; height: 100%; width: {percent}%; background: linear-gradient(90deg, #22c55e, #0ea5e9); }}
    .row {{ display: grid; gap: 10px; align-items: center; grid-template-columns: 220px 1fr 90px 180px; border: 1px solid var(--line); border-radius: 12px; padding: 10px; margin-top: 8px; }}
    .meta .name {{ font-weight: 700; word-break: break-word; }}
    .meta .sub {{ font-size: 12px; color: var(--muted); margin-top: 3px; }}
    .url {{ font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #bfdbfe; word-break: break-all; }}
    .status {{ justify-self: start; font-size: 12px; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--line); text-transform: uppercase; }}
    .status.ok {{ background: color-mix(in srgb, var(--ok) 22%, transparent); color: #86efac; }}
    .status.warn {{ background: color-mix(in srgb, var(--warn) 22%, transparent); color: #fcd34d; }}
    .status.err {{ background: color-mix(in srgb, var(--err) 22%, transparent); color: #fca5a5; }}
    .actions {{ display: flex; gap: 8px; justify-content: end; flex-wrap: wrap; }}
    .btn {{ border: 0; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; border-radius: 10px; padding: 8px 10px; font-size: 12px; color: #fff; background: var(--btn); }}
    .btn-outline {{ border: 1px solid var(--line); background: transparent; color: var(--fg); }}
    .mono {{ font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #bfdbfe; word-break: break-all; }}
    .empty {{ color: var(--muted); font-size: 13px; padding: 8px 0; }}
    .muted {{ color: var(--muted); font-size: 12px; }}
    @media (max-width: 980px) {{
      .grid {{ grid-template-columns: repeat(2, minmax(0, 1fr)); }}
      .row {{ grid-template-columns: 1fr; }}
      .actions {{ justify-content: flex-start; }}
    }}
  </style>
</head>
<body>
  <div class="container">
    <section class="card">
      <h1 class="title">اشتراک Guardino</h1>
      <div class="subtitle">توکن: <span class="mono">{token_html}</span></div>
      <div class="grid">
        <div class="stat"><div class="k">کاربر</div><div class="v">{label}</div></div>
        <div class="stat"><div class="k">وضعیت</div><div class="v">{status}</div></div>
        <div class="stat"><div class="k">انقضا</div><div class="v">{expire_text}</div></div>
        <div class="stat"><div class="k">روز باقی‌مانده</div><div class="v">{days_left}</div></div>
      </div>
      <div class="grid">
        <div class="stat"><div class="k">حجم کل</div><div class="v">{total_gb:.1f} GB</div></div>
        <div class="stat"><div class="k">مصرف‌شده</div><div class="v">{used_gb:.1f} GB</div></div>
        <div class="stat"><div class="k">باقی‌مانده</div><div class="v">{remain_gb:.1f} GB</div></div>
        <div class="stat"><div class="k">مصرف</div><div class="v">{percent}%</div></div>
      </div>
      <div class="progress"><span></span></div>
    </section>

    <section class="card">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:space-between;">
        <div>
          <div class="title" style="font-size:18px;margin:0;">لینک مرکزی (Raw)</div>
          <div class="subtitle">برای کلاینت‌ها این لینک را استفاده کنید.</div>
        </div>
        <div class="actions">
          <button class="btn btn-outline" onclick="copyText({master_link_js})">کپی</button>
          <a class="btn" href="{master_link_html}" target="_blank" rel="noopener">باز کردن</a>
        </div>
      </div>
      <div class="mono" style="margin-top:10px;">{master_link_html}</div>
    </section>

    <section class="card">
      <div class="title" style="font-size:18px;margin:0 0 6px;">لینک‌های هر نود</div>
      <div class="subtitle">برای نودهای WGDashboard فایل کانفیگ `.conf` نمایش داده می‌شود.</div>
      {rows_html}
    </section>
  </div>
  <script>
    async function copyText(t) {{
      try {{
        await navigator.clipboard.writeText(t);
        alert("کپی شد");
      }} catch (_e) {{
        prompt("کپی دستی:", t);
      }}
    }}
  </script>
</body>
</html>"""


async def _get_user_by_token(db: AsyncSession, token: str) -> GuardinoUser:
    q = await db.execute(select(GuardinoUser).where(GuardinoUser.master_sub_token == token))
    user = q.scalar_one_or_none()
    if not user or user.status in (UserStatus.deleted,):
        raise HTTPException(status_code=404, detail="Not found")
    return user


@router.get("/sub/{token}")
async def subscription(token: str, request: Request, db: AsyncSession = Depends(get_db)):
    user = await _get_user_by_token(db, token)

    # Resolve nodes for this user:
    # - If manual: nodes from subaccounts
    # - If group: ensure subaccounts exist for all enabled, visible nodes tagged with user.node_group AND allocated to reseller
    now = datetime.now(timezone.utc)
    changed_cache = False
    base = str(request.base_url).rstrip("/")

    if user.node_selection_mode == NodeSelectionMode.group and user.node_group:
        qn = await db.execute(
            select(Node)
            .join(NodeAllocation, NodeAllocation.node_id == Node.id)
            .where(
                NodeAllocation.reseller_id == user.owner_reseller_id,
                NodeAllocation.enabled.is_(True),
                Node.is_enabled.is_(True),
                Node.is_visible_in_sub.is_(True),
            )
        )
        eligible = [n for n in qn.scalars().all() if user.node_group in (n.tags or [])]
        qs = await db.execute(select(SubAccount).where(SubAccount.user_id == user.id))
        existing = {sa.node_id: sa for sa in qs.scalars().all()}
        for n in eligible:
            if n.id in existing:
                continue
            try:
                adapter = get_adapter(n)
                pr = await adapter.provision_user(label=user.label, total_gb=user.total_gb, expire_at=user.expire_at)
                sa = SubAccount(
                    user_id=user.id,
                    node_id=n.id,
                    remote_identifier=pr.remote_identifier,
                    panel_sub_url_cached=_normalize_url(pr.direct_sub_url, n.base_url),
                    panel_sub_url_cached_at=now if pr.direct_sub_url else None,
                    used_bytes=0,
                )
                db.add(sa)
                changed_cache = True
            except Exception:
                continue
        if changed_cache:
            await db.commit()

    qs2 = await db.execute(select(SubAccount).where(SubAccount.user_id == user.id))
    subs = qs2.scalars().all()
    if not subs:
        return Response(content=merge_subscriptions([]), media_type="text/plain")

    node_ids = [sa.node_id for sa in subs]
    qn2 = await db.execute(select(Node).where(Node.id.in_(node_ids)))
    node_map = {n.id: n for n in qn2.scalars().all()}

    bodies: list[str] = []
    wg_download_urls: list[str] = []
    node_links_for_view: list[dict[str, str]] = []

    async with build_async_client() as client:
        for sa in subs:
            node = node_map.get(sa.node_id)
            if not node:
                continue

            if node.panel_type == PanelType.wg_dashboard:
                dl = f"{base}/api/v1/sub/wg/{token}/{sa.node_id}.conf"
                wg_download_urls.append(dl)
                node_links_for_view.append(
                    {
                        "node_id": str(sa.node_id),
                        "node_name": node.name,
                        "panel_type": "wg_dashboard",
                        "status": "ok",
                        "url": dl,
                    }
                )
                continue

            direct = _normalize_url(sa.panel_sub_url_cached, node.base_url)
            if direct and direct != sa.panel_sub_url_cached:
                sa.panel_sub_url_cached = direct
                changed_cache = True

            if not direct:
                try:
                    adapter = get_adapter(node)
                    fresh = await adapter.get_direct_subscription_url(sa.remote_identifier)
                    direct = _normalize_url(fresh, node.base_url)
                    if direct:
                        sa.panel_sub_url_cached = direct
                        sa.panel_sub_url_cached_at = now
                        changed_cache = True
                except Exception:
                    direct = None

            if not direct:
                node_links_for_view.append(
                    {
                        "node_id": str(sa.node_id),
                        "node_name": node.name,
                        "panel_type": node.panel_type.value,
                        "status": "missing",
                        "url": "",
                    }
                )
                continue

            ok = False
            try:
                resp = await client.get(direct)
                if resp.status_code < 400:
                    bodies.append(resp.text)
                    ok = True
            except httpx.RequestError:
                ok = False

            if not ok:
                try:
                    adapter = get_adapter(node)
                    fresh = await adapter.get_direct_subscription_url(sa.remote_identifier)
                    refreshed_direct = _normalize_url(fresh, node.base_url)
                    if refreshed_direct and refreshed_direct != direct:
                        sa.panel_sub_url_cached = refreshed_direct
                        sa.panel_sub_url_cached_at = now
                        changed_cache = True
                        resp2 = await client.get(refreshed_direct)
                        if resp2.status_code < 400:
                            direct = refreshed_direct
                            bodies.append(resp2.text)
                            ok = True
                except Exception:
                    ok = False

            node_links_for_view.append(
                {
                    "node_id": str(sa.node_id),
                    "node_name": node.name,
                    "panel_type": node.panel_type.value,
                    "status": "ok" if ok else "error",
                    "url": direct if ok else "",
                }
            )

    if changed_cache:
        await db.commit()

    # WG config links can be bundled as plain HTTP lines in the master merged output.
    # Many clients will ignore unknown formats, but this keeps them discoverable in one place.
    if wg_download_urls:
        bodies.append("\n".join(sorted(set(wg_download_urls))))

    merged_b64 = merge_subscriptions(bodies)

    if _wants_html(request):
        return HTMLResponse(
            _render_sub_page(
                token=token,
                user=user,
                master_raw_link=f"{base}/api/v1/sub/{token}?raw=1",
                node_links=node_links_for_view,
            )
        )

    return Response(content=merged_b64, media_type="text/plain")


@router.get("/sub/wg/{token}/{node_id}.conf")
async def download_wg_config(token: str, node_id: int, db: AsyncSession = Depends(get_db)):
    user = await _get_user_by_token(db, token)

    qs = await db.execute(
        select(SubAccount).where(
            SubAccount.user_id == user.id,
            SubAccount.node_id == node_id,
        )
    )
    sub = qs.scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=404, detail="WireGuard config not found")

    qn = await db.execute(select(Node).where(Node.id == node_id))
    node = qn.scalar_one_or_none()
    if not node or node.panel_type != PanelType.wg_dashboard:
        raise HTTPException(status_code=404, detail="Node is not WGDashboard")

    adapter = get_adapter(node)
    if not hasattr(adapter, "download_peer_config"):
        raise HTTPException(status_code=501, detail="WGDashboard download is not supported by adapter")

    try:
        filename, content = await adapter.download_peer_config(sub.remote_identifier)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"WGDashboard download failed: {str(e)[:200]}")

    safe_name = _safe_conf_filename(filename, fallback=f"wg_{user.id}_{node_id}.conf")
    return Response(
        content=content,
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}"'},
    )
