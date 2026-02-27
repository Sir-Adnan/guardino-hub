from __future__ import annotations

import html
import json
import re
from datetime import datetime, timezone
from pathlib import Path
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
    raw = Path(str(name or "").strip()).name
    fallback_raw = Path(str(fallback or "").strip()).name or "wireguard"
    stem = Path(raw).stem if raw else Path(fallback_raw).stem
    safe_stem = re.sub(r"[^a-zA-Z0-9_.-]+", "_", stem).strip("._-") or "wireguard"
    return f"{safe_stem[:110]}.conf"


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
    sec_left = int((user.expire_at - now).total_seconds())
    days_left = int(sec_left // 86400)
    expiry_state = "منقضی شده" if sec_left < 0 else ("نزدیک به انقضا" if days_left <= 3 else "فعال")
    expiry_badge = "err" if sec_left < 0 else ("warn" if days_left <= 3 else "ok")
    usable_links = sum(1 for it in node_links if (it.get("url") or "").strip())

    rows = []
    for idx, item in enumerate(node_links, start=1):
        node_name = html.escape(item.get("node_name") or f"Node #{item.get('node_id')}")
        panel_type = html.escape(item.get("panel_type") or "unknown")
        panel_label = {
            "marzban": "Marzban",
            "pasarguard": "Pasarguard",
            "wg_dashboard": "WGDashboard",
        }.get(panel_type, panel_type)
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
        copy_btn = f'<button class="btn btn-outline" onclick="copyText({url_js})">کپی</button>' if url else ""
        rows.append(
            f"""
            <article class="row" style="animation-delay:{min(idx * 0.04, 0.36):.2f}s">
              <div class="meta">
                <div class="name">{node_name}</div>
                <div class="sub">{panel_label}</div>
              </div>
              <div class="url">{url_html or "—"}</div>
              <div class="status {badge}">{status}</div>
              <div class="actions">{copy_btn}{action}</div>
            </article>
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
  <title>Guardino Subscription - {label}</title>
  <style>
    :root {{
      --bg-0: #060f1f;
      --bg-1: #0e1b34;
      --card: #0f1e38;
      --line: #223658;
      --fg: #eaf3ff;
      --muted: #93a9cc;
      --ok: #22c55e;
      --warn: #f59e0b;
      --err: #ef4444;
      --btn: #1d4ed8;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      background:
        radial-gradient(900px 620px at 10% -12%, #1e3a8a66 0%, transparent 60%),
        radial-gradient(720px 520px at 100% 0%, #0891b233 0%, transparent 64%),
        linear-gradient(160deg, var(--bg-0) 0%, var(--bg-1) 100%);
      color: var(--fg);
      min-height: 100dvh;
      padding: 18px;
    }}
    .container {{ max-width: 1160px; margin: 0 auto; display: grid; gap: 14px; }}
    .card {{
      background: linear-gradient(180deg, color-mix(in srgb, var(--card) 88%, #fff 2%), color-mix(in srgb, var(--card) 93%, #000 7%));
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 16px;
      box-shadow: 0 16px 36px #02081766;
      backdrop-filter: blur(3px);
    }}
    .title {{ font-size: 24px; font-weight: 900; margin: 0 0 8px; letter-spacing: .2px; }}
    .subtitle {{ color: var(--muted); font-size: 13px; line-height: 1.7; }}
    .row-head {{ display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; }}
    .pill {{
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 6px 10px;
      font-size: 12px;
      color: var(--muted);
      background: #0b1530;
    }}
    .pill.ok {{ color: #86efac; border-color: #16653488; }}
    .pill.warn {{ color: #fcd34d; border-color: #92400e88; }}
    .pill.err {{ color: #fca5a5; border-color: #991b1b88; }}
    .grid {{ display: grid; gap: 10px; grid-template-columns: repeat(4, minmax(0, 1fr)); margin-top: 12px; }}
    .stat {{
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 11px 12px;
      background: linear-gradient(180deg, #0b1833, #0a162d);
    }}
    .k {{ color: var(--muted); font-size: 12px; }}
    .v {{ margin-top: 5px; font-size: 16px; font-weight: 800; }}
    .progress {{
      height: 10px;
      border-radius: 999px;
      background: #0a1226;
      overflow: hidden;
      margin-top: 10px;
      border: 1px solid var(--line);
    }}
    .progress > span {{
      display: block;
      height: 100%;
      width: {percent}%;
      background: linear-gradient(90deg, #16a34a 0%, #06b6d4 52%, #2563eb 100%);
      transition: width .45s ease;
    }}
    .row {{
      display: grid;
      gap: 10px;
      align-items: center;
      grid-template-columns: 230px 1fr 96px 186px;
      border: 1px solid var(--line);
      border-radius: 13px;
      padding: 10px;
      margin-top: 8px;
      background: linear-gradient(180deg, #0a1631, #091327);
      opacity: 0;
      transform: translateY(8px);
      animation: fadeUp .45s ease forwards;
    }}
    .meta .name {{ font-weight: 700; word-break: break-word; }}
    .meta .sub {{ font-size: 12px; color: var(--muted); margin-top: 3px; }}
    .url {{
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      color: #bfdbfe;
      word-break: break-all;
      border: 1px dashed #355083;
      border-radius: 10px;
      padding: 6px 8px;
      background: #08132a;
    }}
    .status {{ justify-self: start; font-size: 12px; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--line); text-transform: uppercase; }}
    .status.ok {{ background: color-mix(in srgb, var(--ok) 24%, transparent); color: #86efac; }}
    .status.warn {{ background: color-mix(in srgb, var(--warn) 22%, transparent); color: #fcd34d; }}
    .status.err {{ background: color-mix(in srgb, var(--err) 22%, transparent); color: #fca5a5; }}
    .actions {{ display: flex; gap: 8px; justify-content: end; flex-wrap: wrap; }}
    .btn {{
      border: 0;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      border-radius: 10px;
      padding: 8px 10px;
      font-size: 12px;
      color: #fff;
      background: linear-gradient(135deg, #1d4ed8, #2563eb);
      transition: transform .18s ease, filter .18s ease;
    }}
    .btn:hover {{ transform: translateY(-1px); filter: brightness(1.05); }}
    .btn-outline {{ border: 1px solid var(--line); background: #0a1530; color: var(--fg); }}
    .mono {{ font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #bfdbfe; word-break: break-all; }}
    .empty {{ color: var(--muted); font-size: 13px; padding: 8px 0; }}
    .muted {{ color: var(--muted); font-size: 12px; }}
    .toast {{
      position: fixed;
      left: 16px;
      bottom: 16px;
      background: #061225f0;
      border: 1px solid #334d7f;
      border-radius: 10px;
      padding: 10px 12px;
      font-size: 13px;
      color: #e2ecff;
      opacity: 0;
      transform: translateY(8px);
      transition: opacity .2s ease, transform .2s ease;
      pointer-events: none;
      z-index: 30;
    }}
    .toast.show {{ opacity: 1; transform: translateY(0); }}
    @keyframes fadeUp {{
      from {{ opacity: 0; transform: translateY(8px); }}
      to {{ opacity: 1; transform: translateY(0); }}
    }}
    @media (max-width: 980px) {{
      .grid {{ grid-template-columns: repeat(2, minmax(0, 1fr)); }}
      .row {{ grid-template-columns: 1fr; }}
      .actions {{ justify-content: flex-start; }}
    }}
    @media (max-width: 560px) {{
      body {{ padding: 10px; }}
      .card {{ padding: 12px; border-radius: 14px; }}
      .title {{ font-size: 20px; }}
      .grid {{ grid-template-columns: 1fr; }}
    }}
  </style>
</head>
<body>
  <div class="container">
    <section class="card">
      <div class="row-head">
        <div>
          <h1 class="title">اشتراک Guardino</h1>
          <div class="subtitle">توکن کاربر: <span class="mono">{token_html}</span></div>
        </div>
        <div class="pill {expiry_badge}">{expiry_state}</div>
      </div>
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
      <div class="row-head">
        <div>
          <div class="title" style="font-size:18px;margin:0;">لینک‌های هر نود</div>
          <div class="subtitle">برای نودهای WGDashboard فایل کانفیگ `.conf` ارائه می‌شود.</div>
        </div>
        <div class="pill">{usable_links} لینک فعال</div>
      </div>
      {rows_html}
    </section>
  </div>
  <div id="toast" class="toast"></div>
  <script>
    let toastTimer = null;
    function showToast(msg) {{
      const el = document.getElementById("toast");
      if (!el) return;
      el.textContent = msg;
      el.classList.add("show");
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {{
        el.classList.remove("show");
      }}, 1500);
    }}

    async function copyText(t) {{
      try {{
        await navigator.clipboard.writeText(t);
        showToast("کپی شد");
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
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}"'},
    )
