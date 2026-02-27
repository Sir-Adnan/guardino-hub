from __future__ import annotations

import html
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
    total_links = len(node_links)

    created_at = user.created_at.astimezone(timezone.utc)
    updated_at = user.updated_at.astimezone(timezone.utc)
    expire_at = user.expire_at.astimezone(timezone.utc)
    life_seconds = max(1, int((expire_at - created_at).total_seconds()))
    elapsed_seconds = int((now - created_at).total_seconds())
    if sec_left < 0:
        elapsed_seconds = life_seconds
    elapsed_seconds = max(0, min(life_seconds, elapsed_seconds))
    time_percent = min(100, int(round((elapsed_seconds / life_seconds) * 100)))
    days_left_display = max(0, days_left)

    rows = []
    for idx, item in enumerate(node_links, start=1):
        node_name = html.escape(item.get("node_name") or f"Node #{item.get('node_id')}")
        panel_type = str(item.get("panel_type") or "unknown")
        panel_key = panel_type if panel_type in ("marzban", "pasarguard", "wg_dashboard") else "unknown"
        panel_label = {
            "wg_dashboard": "وایرگارد",
            "marzban": "لینک امن",
            "pasarguard": "لینک امن",
            "unknown": "لینک امن",
        }.get(panel_key, "لینک امن")
        panel_css = {
            "marzban": "panel-marzban",
            "pasarguard": "panel-pasarguard",
            "wg_dashboard": "panel-wg",
            "unknown": "panel-unknown",
        }.get(panel_key, "panel-unknown")
        panel_icon = {"marzban": "S", "pasarguard": "S", "wg_dashboard": "WG", "unknown": "S"}.get(panel_key, "S")

        status_raw = str(item.get("status") or "missing")
        status_badge = "ok" if status_raw == "ok" else ("warn" if status_raw == "missing" else "err")
        status_label = {"ok": "سالم", "missing": "بدون لینک", "error": "خطا"}.get(status_raw, "خطا")

        url = item.get("url") or ""
        url_html = html.escape(url)
        url_attr = html.escape(url, quote=True)
        action_text = "دانلود کانفیگ" if panel_key == "wg_dashboard" else "باز کردن لینک"
        action = (
            f'<a class="btn" href="{url_html}" target="_blank" rel="noopener">{action_text}</a>'
            if url
            else '<span class="muted">بدون لینک</span>'
        )
        copy_btn = f'<button type="button" class="btn btn-soft copy-btn" data-copy="{url_attr}">کپی</button>' if url else ""
        rows.append(
            f"""
            <article class="node-row reveal" style="--delay:{min(idx * 0.05, 0.70):.2f}s">
              <div class="node-main">
                <div class="node-icon {panel_css}">{panel_icon}</div>
                <div class="meta">
                  <div class="name">{node_name}</div>
                  <div class="sub">{panel_label}</div>
                </div>
              </div>
              <div class="url">{url_html or "—"}</div>
              <div class="status {status_badge}">{status_label}</div>
              <div class="actions node-actions">{copy_btn}{action}</div>
            </article>
            """
        )

    rows_html = "\n".join(rows) if rows else '<div class="empty">لینکی برای این کاربر پیدا نشد.</div>'
    label = html.escape(user.label or f"user-{user.id}")
    status_value = str(user.status.value if hasattr(user.status, "value") else user.status)
    status_text = html.escape({"active": "فعال", "disabled": "غیرفعال", "deleted": "حذف‌شده"}.get(status_value, status_value))
    status_class = "ok" if status_value == "active" else ("warn" if status_value == "disabled" else "err")
    is_disabled = status_value != "active"
    is_expired = sec_left < 0
    is_volume_exhausted = total_gb > 0 and used_gb >= total_gb
    is_near_expiry = (not is_expired) and days_left <= 3

    account_state = "normal"
    if is_disabled or is_expired or is_volume_exhausted:
        account_state = "blocked"
    elif is_near_expiry or percent >= 85:
        account_state = "warning"

    if account_state == "blocked":
        status_headline = "سرویس شما نیاز به اقدام دارد"
        status_desc = "برای ادامه استفاده، وضعیت اشتراک را بررسی و در صورت نیاز تمدید یا ارتقا انجام دهید."
    elif account_state == "warning":
        status_headline = "سرویس شما نزدیک به محدودیت است"
        status_desc = "زمان یا حجم اشتراک در آستانه پایان است. بهتر است قبل از قطع سرویس اقدام کنید."
    else:
        status_headline = "سرویس شما آماده استفاده است"
        status_desc = "همه چیز در وضعیت مناسب قرار دارد و می‌توانید از لینک‌های اشتراک استفاده کنید."

    alert_reasons: list[str] = []
    if is_disabled:
        alert_reasons.append("حساب کاربری شما غیرفعال شده است.")
    if is_expired:
        alert_reasons.append("مدت زمان اشتراک شما به پایان رسیده است.")
    if is_volume_exhausted:
        alert_reasons.append("حجم اشتراک شما به پایان رسیده است.")
    has_alert_modal = len(alert_reasons) > 0
    alert_items_html = "".join(f"<li>{html.escape(reason)}</li>" for reason in alert_reasons)
    alert_modal_html = (
        f"""
    <div id="statusModal" class="modal show" role="dialog" aria-modal="true" aria-labelledby="statusModalTitle">
      <div class="modal-card">
        <div class="modal-icon" aria-hidden="true">!</div>
        <h3 id="statusModalTitle">توجه: وضعیت اشتراک نیاز به بررسی دارد</h3>
        <p>یک یا چند مورد مهم در حساب شما شناسایی شده است:</p>
        <ul>{alert_items_html}</ul>
        <div class="modal-actions">
          <button type="button" class="btn" data-close-modal>متوجه شدم</button>
        </div>
      </div>
    </div>
        """
        if has_alert_modal
        else ""
    )
    expire_text = html.escape(expire_at.strftime("%Y-%m-%d %H:%M:%S UTC"))
    created_text = html.escape(created_at.strftime("%Y-%m-%d %H:%M:%S UTC"))
    updated_text = html.escape(updated_at.strftime("%Y-%m-%d %H:%M:%S UTC"))
    generated_text = html.escape(now.strftime("%Y-%m-%d %H:%M:%S UTC"))
    expire_iso = html.escape(expire_at.isoformat())
    created_iso = html.escape(created_at.isoformat())
    updated_iso = html.escape(updated_at.isoformat())
    generated_iso = html.escape(now.isoformat())
    master_link_html = html.escape(master_raw_link)
    master_link_attr = html.escape(master_raw_link, quote=True)
    token_html = html.escape(token)
    token_attr = html.escape(token, quote=True)

    return f"""<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>داشبورد اشتراک - {label}</title>
  <style>
    :root {{
      --bg-0: #f2f6ff;
      --bg-1: #e8f0ff;
      --paper: rgba(255, 255, 255, 0.82);
      --paper-strong: #ffffff;
      --line: #cad8ef;
      --fg: #102040;
      --muted: #5f7398;
      --ok: #16a34a;
      --warn: #d97706;
      --err: #dc2626;
      --accent: #2563eb;
      --accent-soft: #0ea5e9;
      --ring-rest: #dbe8ff;
      --shadow: 0 16px 34px rgba(9, 37, 88, 0.14);
    }}
    html[data-theme="night"] {{
      --bg-0: #081224;
      --bg-1: #0f1d39;
      --paper: rgba(13, 26, 49, 0.86);
      --paper-strong: #0f1f3a;
      --line: #2a4266;
      --fg: #e8f0ff;
      --muted: #95add3;
      --ok: #22c55e;
      --warn: #f59e0b;
      --err: #ef4444;
      --accent: #3b82f6;
      --accent-soft: #06b6d4;
      --ring-rest: #1a2c4e;
      --shadow: 0 16px 36px rgba(2, 8, 23, 0.44);
    }}
    body[data-account-state="warning"] {{
      --accent: #d97706;
      --accent-soft: #f59e0b;
      --ring-rest: #fef3c7;
    }}
    body[data-account-state="blocked"] {{
      --accent: #dc2626;
      --accent-soft: #f97316;
      --ring-rest: #fee2e2;
      --shadow: 0 18px 36px rgba(127, 29, 29, 0.2);
    }}
    html[data-theme="night"] body[data-account-state="warning"] {{
      --ring-rest: #4d2e12;
    }}
    html[data-theme="night"] body[data-account-state="blocked"] {{
      --ring-rest: #4f1d1d;
      --shadow: 0 18px 36px rgba(2, 8, 23, 0.58);
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      font-family: "Vazirmatn", "IRANSansX", "IRANYekanX", Tahoma, sans-serif;
      color: var(--fg);
      background:
        radial-gradient(980px 620px at 6% -10%, #3b82f62b 0%, transparent 60%),
        radial-gradient(760px 520px at 98% 0%, #06b6d430 0%, transparent 66%),
        linear-gradient(145deg, var(--bg-0) 0%, var(--bg-1) 100%);
      min-height: 100dvh;
      position: relative;
      overflow-x: hidden;
    }}
    .orb {{
      position: fixed;
      border-radius: 999px;
      filter: blur(40px);
      opacity: 0.28;
      pointer-events: none;
      z-index: 0;
    }}
    .orb-a {{
      width: 320px;
      height: 320px;
      background: #3b82f6;
      top: -80px;
      right: -60px;
      animation: drift 13s ease-in-out infinite;
    }}
    .orb-b {{
      width: 280px;
      height: 280px;
      background: #0ea5e9;
      bottom: -120px;
      left: -80px;
      animation: drift 16s ease-in-out infinite reverse;
    }}
    .page {{
      position: relative;
      z-index: 1;
      max-width: 1260px;
      margin: 0 auto;
      padding: 18px;
      display: grid;
      gap: 12px;
    }}
    .glass {{
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: 20px;
      box-shadow: var(--shadow);
      backdrop-filter: blur(8px);
    }}
    .hero {{
      padding: 18px;
      display: grid;
      gap: 14px;
      position: relative;
      overflow: hidden;
    }}
    .hero::after {{
      content: "";
      position: absolute;
      width: 240px;
      height: 240px;
      border-radius: 999px;
      background: radial-gradient(circle at center, rgba(37, 99, 235, 0.22), transparent 70%);
      top: -110px;
      left: -70px;
      pointer-events: none;
    }}
    .hero-top {{
      display: flex;
      gap: 12px;
      align-items: flex-start;
      justify-content: space-between;
      flex-wrap: wrap;
    }}
    .brand {{
      display: flex;
      align-items: center;
      gap: 12px;
    }}
    .brand-icon {{
      width: 48px;
      height: 48px;
      border-radius: 999px;
      background: linear-gradient(135deg, var(--accent), var(--accent-soft));
      display: grid;
      place-items: center;
      color: #fff;
      box-shadow: 0 10px 24px rgba(37, 99, 235, 0.34);
      animation: floaty 4s ease-in-out infinite;
    }}
    .brand-icon svg {{
      width: 24px;
      height: 24px;
      stroke: currentColor;
      fill: none;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }}
    .hero-title {{
      margin: 0;
      font-size: clamp(22px, 2.2vw, 31px);
      font-weight: 900;
      letter-spacing: 0.2px;
    }}
    .hero-subtitle {{
      margin: 5px 0 0;
      font-size: 12px;
      color: var(--muted);
      line-height: 1.8;
    }}
    .top-actions {{
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }}
    .btn {{
      border: 0;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      border-radius: 12px;
      padding: 9px 12px;
      font-size: 12px;
      font-weight: 700;
      color: #fff;
      background: linear-gradient(135deg, var(--accent), var(--accent-soft));
      transition: transform .2s ease, filter .2s ease, box-shadow .2s ease;
      box-shadow: 0 8px 18px rgba(37, 99, 235, 0.24);
    }}
    .btn:hover {{
      transform: translateY(-1px);
      filter: brightness(1.03);
      box-shadow: 0 10px 20px rgba(37, 99, 235, 0.3);
    }}
    .btn-soft {{
      border: 1px solid var(--line);
      background: var(--paper-strong);
      color: var(--fg);
      box-shadow: none;
    }}
    html[data-theme="night"] .btn-soft {{
      background: #122648;
    }}
    .theme-icon {{
      width: 16px;
      height: 16px;
      border-radius: 999px;
      background: linear-gradient(135deg, #f59e0b, #facc15);
      box-shadow: inset 0 0 0 1px #ffffff66;
      display: inline-block;
      margin-left: 6px;
      animation: pulse 2.2s ease-in-out infinite;
    }}
    html[data-theme="night"] .theme-icon {{
      background: linear-gradient(135deg, #64748b, #94a3b8);
    }}
    .token-line {{
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
      font-size: 12px;
      color: var(--muted);
    }}
    .mono {{
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      color: #1e3a8a;
      word-break: break-all;
    }}
    html[data-theme="night"] .mono {{
      color: #bfdbfe;
    }}
    .mini-chips {{
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }}
    .state-hero {{
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 10px;
      align-items: center;
      border-radius: 14px;
      border: 1px solid var(--line);
      padding: 10px 12px;
      background: linear-gradient(120deg, #eef5ff, #ffffff);
    }}
    .state-hero-icon {{
      width: 34px;
      height: 34px;
      border-radius: 999px;
      display: grid;
      place-items: center;
      font-weight: 900;
      color: #fff;
      background: linear-gradient(135deg, var(--accent), var(--accent-soft));
      box-shadow: 0 8px 16px rgba(37, 99, 235, 0.28);
    }}
    .state-hero-title {{
      font-size: 14px;
      font-weight: 900;
      line-height: 1.4;
      color: var(--fg);
    }}
    .state-hero-sub {{
      margin-top: 2px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.7;
    }}
    .state-hero.warning {{
      border-color: #f59e0b66;
      background: linear-gradient(120deg, #fff7e6, #fffdf6);
    }}
    .state-hero.blocked {{
      border-color: #ef444480;
      background: linear-gradient(120deg, #fff1f2, #fff7ed);
    }}
    html[data-theme="night"] .state-hero.warning {{
      background: linear-gradient(120deg, #3f2a10, #302012);
    }}
    html[data-theme="night"] .state-hero.blocked {{
      background: linear-gradient(120deg, #4a1f24, #462415);
    }}
    .badge {{
      border: 1px solid var(--line);
      border-radius: 999px;
      font-size: 12px;
      padding: 5px 10px;
      background: var(--paper-strong);
      color: var(--muted);
    }}
    .badge.ok {{ color: var(--ok); border-color: #86efac88; }}
    .badge.warn {{ color: var(--warn); border-color: #fcd34d88; }}
    .badge.err {{ color: var(--err); border-color: #fca5a588; }}
    .badge.neutral {{ color: var(--fg); }}
    .grid-4 {{
      display: grid;
      gap: 10px;
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }}
    .stat-card {{
      padding: 12px;
      display: grid;
      gap: 8px;
    }}
    .stat-top {{
      display: flex;
      justify-content: space-between;
      align-items: center;
    }}
    .k {{
      font-size: 12px;
      color: var(--muted);
    }}
    body[data-account-state="warning"] .k {{
      color: #9a5b00;
    }}
    body[data-account-state="blocked"] .k {{
      color: #9f1239;
    }}
    html[data-theme="night"] body[data-account-state="warning"] .k,
    html[data-theme="night"] body[data-account-state="blocked"] .k {{
      color: #fcd34d;
    }}
    .v {{
      font-size: 18px;
      font-weight: 900;
      line-height: 1.25;
      word-break: break-word;
    }}
    .v.slim {{
      font-size: 14px;
      font-weight: 700;
    }}
    .dot {{
      width: 10px;
      height: 10px;
      border-radius: 999px;
      animation: pulse 2.1s ease-in-out infinite;
    }}
    .dot.ok {{ background: var(--ok); }}
    .dot.warn {{ background: var(--warn); }}
    .dot.err {{ background: var(--err); }}
    .dot.neutral {{ background: var(--accent); }}
    .grid-2 {{
      display: grid;
      gap: 10px;
      grid-template-columns: 1.2fr .8fr;
    }}
    .analytics {{
      padding: 14px;
    }}
    .section-head {{
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 10px;
    }}
    .section-title {{
      margin: 0;
      font-size: 17px;
      font-weight: 900;
    }}
    .section-sub {{
      margin: 2px 0 0;
      color: var(--muted);
      font-size: 12px;
    }}
    .usage-wrap {{
      display: grid;
      grid-template-columns: 220px 1fr;
      align-items: center;
      gap: 14px;
    }}
    .ring {{
      --value: 0;
      width: 188px;
      aspect-ratio: 1;
      border-radius: 50%;
      margin: 0 auto;
      position: relative;
      background: conic-gradient(var(--accent) calc(var(--value) * 1%), var(--accent-soft) calc(var(--value) * 1%), var(--ring-rest) 0);
      display: grid;
      place-items: center;
      box-shadow: inset 0 0 0 1px #ffffff5e;
      transition: background .35s ease;
    }}
    .ring::before {{
      content: "";
      width: 66%;
      height: 66%;
      border-radius: 50%;
      background: var(--paper-strong);
      border: 1px solid var(--line);
      position: absolute;
    }}
    html[data-theme="night"] .ring::before {{
      background: #10203c;
    }}
    .ring .ring-inner {{
      position: relative;
      text-align: center;
      z-index: 1;
      display: grid;
      gap: 2px;
    }}
    .ring strong {{
      font-size: 28px;
      font-weight: 900;
      line-height: 1;
    }}
    .ring span {{
      font-size: 11px;
      color: var(--muted);
    }}
    .ring.ring-sm {{
      width: 146px;
      margin-top: 12px;
    }}
    .ring.ring-sm strong {{
      font-size: 23px;
    }}
    .progress-list {{
      display: grid;
      gap: 9px;
    }}
    .progress-item {{
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 9px 10px;
      background: var(--paper-strong);
    }}
    html[data-theme="night"] .progress-item {{
      background: #122648;
    }}
    .progress-meta {{
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 12px;
      color: var(--muted);
      margin-bottom: 6px;
    }}
    .progress-meta strong {{
      font-size: 13px;
      color: var(--fg);
    }}
    .track {{
      height: 8px;
      border-radius: 999px;
      overflow: hidden;
      background: var(--ring-rest);
      border: 1px solid var(--line);
    }}
    .track > span {{
      display: block;
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, var(--accent), var(--accent-soft));
    }}
    body[data-account-state="blocked"] .track > span,
    body[data-account-state="blocked"] .ring {{
      filter: saturate(1.1);
    }}
    .health-grid {{
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }}
    .mini {{
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 8px;
      background: var(--paper-strong);
      text-align: center;
    }}
    html[data-theme="night"] .mini {{
      background: #122648;
    }}
    .mini span {{
      display: block;
      font-size: 11px;
      color: var(--muted);
    }}
    .mini strong {{
      display: block;
      margin-top: 4px;
      font-size: 18px;
    }}
    .panel-list {{
      display: grid;
      gap: 8px;
      margin-top: 10px;
    }}
    .panel-row {{
      display: grid;
      gap: 5px;
    }}
    .panel-top {{
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 12px;
    }}
    .chip {{
      border-radius: 999px;
      padding: 3px 9px;
      border: 1px solid transparent;
      font-size: 11px;
      font-weight: 700;
    }}
    .panel-marzban {{
      color: #1d4ed8;
      background: #dbeafe;
      border-color: #93c5fd;
    }}
    .panel-pasarguard {{
      color: #0f766e;
      background: #ccfbf1;
      border-color: #5eead4;
    }}
    .panel-wg {{
      color: #9333ea;
      background: #f3e8ff;
      border-color: #d8b4fe;
    }}
    .panel-unknown {{
      color: #475569;
      background: #e2e8f0;
      border-color: #cbd5e1;
    }}
    html[data-theme="night"] .panel-marzban {{
      color: #bfdbfe;
      background: #1d4ed866;
      border-color: #60a5fa80;
    }}
    html[data-theme="night"] .panel-pasarguard {{
      color: #99f6e4;
      background: #0f766e66;
      border-color: #2dd4bf80;
    }}
    html[data-theme="night"] .panel-wg {{
      color: #e9d5ff;
      background: #7e22ce66;
      border-color: #c084fc80;
    }}
    html[data-theme="night"] .panel-unknown {{
      color: #cbd5e1;
      background: #33415570;
      border-color: #64748b80;
    }}
    .bar-track {{
      height: 7px;
      border-radius: 999px;
      background: var(--ring-rest);
      border: 1px solid var(--line);
      overflow: hidden;
    }}
    .bar-fill {{
      display: block;
      height: 100%;
      border-radius: inherit;
      transition: width .55s ease;
    }}
    .bar-fill.panel-marzban {{ background: linear-gradient(90deg, #1d4ed8, #2563eb); }}
    .bar-fill.panel-pasarguard {{ background: linear-gradient(90deg, #0f766e, #14b8a6); }}
    .bar-fill.panel-wg {{ background: linear-gradient(90deg, #7e22ce, #a855f7); }}
    .bar-fill.panel-unknown {{ background: linear-gradient(90deg, #64748b, #94a3b8); }}
    .master {{
      padding: 15px;
    }}
    .link-box {{
      margin-top: 10px;
      border: 1px dashed var(--line);
      border-radius: 12px;
      padding: 10px;
      background: var(--paper-strong);
    }}
    html[data-theme="night"] .link-box {{
      background: #10203c;
    }}
    .node-section {{
      padding: 14px;
    }}
    .node-row {{
      margin-top: 8px;
      display: grid;
      gap: 10px;
      align-items: center;
      grid-template-columns: 230px minmax(0, 1fr) 92px 210px;
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 10px;
      background: var(--paper-strong);
    }}
    html[data-theme="night"] .node-row {{
      background: #10203c;
    }}
    .node-main {{
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }}
    .node-icon {{
      width: 28px;
      height: 28px;
      border-radius: 10px;
      font-size: 12px;
      font-weight: 900;
      display: grid;
      place-items: center;
      animation: pulse 2.5s ease-in-out infinite;
    }}
    .meta .name {{
      font-weight: 800;
      word-break: break-word;
    }}
    .meta .sub {{
      margin-top: 3px;
      font-size: 11px;
      color: var(--muted);
    }}
    .url {{
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      border: 1px dashed var(--line);
      border-radius: 10px;
      padding: 8px;
      color: var(--accent);
      background: #f6faff;
      word-break: break-all;
    }}
    html[data-theme="night"] .url {{
      background: #0d1b34;
      color: #bfdbfe;
    }}
    .status {{
      justify-self: start;
      font-size: 11px;
      font-weight: 800;
      border-radius: 999px;
      border: 1px solid var(--line);
      padding: 5px 9px;
    }}
    .status.ok {{ color: var(--ok); background: #dcfce7; border-color: #86efac; }}
    .status.warn {{ color: var(--warn); background: #fef3c7; border-color: #fcd34d; }}
    .status.err {{ color: var(--err); background: #fee2e2; border-color: #fca5a5; }}
    html[data-theme="night"] .status.ok {{ background: #14532d66; border-color: #22c55e88; }}
    html[data-theme="night"] .status.warn {{ background: #78350f66; border-color: #f59e0b88; }}
    html[data-theme="night"] .status.err {{ background: #7f1d1d66; border-color: #ef444488; }}
    .actions {{
      display: flex;
      gap: 8px;
      justify-content: flex-end;
      flex-wrap: wrap;
    }}
    .node-actions .btn {{
      padding: 7px 10px;
      border-radius: 10px;
      font-size: 11px;
    }}
    .empty {{
      color: var(--muted);
      font-size: 13px;
      padding: 10px;
      border: 1px dashed var(--line);
      border-radius: 12px;
      background: var(--paper-strong);
      margin-top: 10px;
    }}
    .muted {{
      color: var(--muted);
      font-size: 12px;
    }}
    .foot-note {{
      color: var(--muted);
      font-size: 12px;
      text-align: center;
      padding: 4px 0 1px;
    }}
    .toast {{
      position: fixed;
      left: 14px;
      bottom: 14px;
      background: #0f1f3aed;
      border: 1px solid #335489;
      border-radius: 11px;
      padding: 10px 12px;
      font-size: 13px;
      color: #e7f0ff;
      opacity: 0;
      transform: translateY(8px);
      transition: opacity .2s ease, transform .2s ease;
      pointer-events: none;
      z-index: 60;
      max-width: min(420px, calc(100vw - 28px));
    }}
    .toast.show {{
      opacity: 1;
      transform: translateY(0);
    }}
    .toast.ok {{ border-color: #22c55e88; }}
    .toast.warn {{ border-color: #f59e0b88; }}
    .toast.err {{ border-color: #ef444488; }}
    .modal {{
      position: fixed;
      inset: 0;
      z-index: 80;
      display: grid;
      place-items: center;
      background: rgba(10, 18, 36, 0.5);
      backdrop-filter: blur(4px);
      opacity: 0;
      pointer-events: none;
      transition: opacity .2s ease;
      padding: 16px;
    }}
    .modal.show {{
      opacity: 1;
      pointer-events: auto;
    }}
    .modal-card {{
      width: min(520px, 100%);
      border-radius: 18px;
      border: 1px solid var(--line);
      background: var(--paper-strong);
      box-shadow: 0 20px 45px rgba(2, 8, 23, 0.25);
      padding: 18px;
      display: grid;
      gap: 10px;
      animation: reveal .3s ease;
    }}
    html[data-theme="night"] .modal-card {{
      background: #122648;
    }}
    .modal-icon {{
      width: 44px;
      height: 44px;
      border-radius: 999px;
      background: linear-gradient(135deg, #ef4444, #f97316);
      color: #fff;
      display: grid;
      place-items: center;
      font-weight: 900;
      font-size: 22px;
      box-shadow: 0 12px 24px rgba(239, 68, 68, 0.3);
    }}
    .modal-card h3 {{
      margin: 0;
      font-size: 18px;
      font-weight: 900;
    }}
    .modal-card p {{
      margin: 0;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.8;
    }}
    .modal-card ul {{
      margin: 0;
      padding: 0 18px 0 0;
      display: grid;
      gap: 6px;
      color: var(--fg);
      font-size: 13px;
      line-height: 1.8;
    }}
    .modal-actions {{
      display: flex;
      justify-content: flex-end;
      margin-top: 4px;
    }}
    .reveal {{
      opacity: 0;
      transform: translateY(10px);
      animation: reveal .55s ease forwards;
      animation-delay: var(--delay, 0s);
    }}
    @keyframes reveal {{
      from {{ opacity: 0; transform: translateY(10px); }}
      to {{ opacity: 1; transform: translateY(0); }}
    }}
    @keyframes floaty {{
      0%, 100% {{ transform: translateY(0); }}
      50% {{ transform: translateY(-4px); }}
    }}
    @keyframes pulse {{
      0%, 100% {{ transform: scale(1); opacity: 1; }}
      50% {{ transform: scale(1.07); opacity: .78; }}
    }}
    @keyframes drift {{
      0%, 100% {{ transform: translate(0, 0); }}
      50% {{ transform: translate(14px, -12px); }}
    }}
    @media (max-width: 1120px) {{
      .grid-4 {{ grid-template-columns: repeat(3, minmax(0, 1fr)); }}
      .grid-2 {{ grid-template-columns: 1fr; }}
      .usage-wrap {{ grid-template-columns: 1fr; }}
      .node-row {{ grid-template-columns: 1fr; }}
      .actions {{ justify-content: flex-start; }}
    }}
    @media (max-width: 760px) {{
      .page {{ padding: 10px; }}
      .hero {{ padding: 13px; border-radius: 16px; }}
      .grid-4 {{ grid-template-columns: repeat(2, minmax(0, 1fr)); }}
      .ring {{ width: 160px; }}
      .ring.ring-sm {{ width: 126px; }}
    }}
    @media (max-width: 520px) {{
      .grid-4 {{ grid-template-columns: 1fr; }}
      .top-actions {{ width: 100%; }}
      .top-actions .btn {{ width: 100%; }}
      .section-head {{ flex-direction: column; align-items: flex-start; }}
      .health-grid {{ grid-template-columns: 1fr; }}
      .state-hero {{ grid-template-columns: 1fr; }}
      .modal-card {{ padding: 14px; border-radius: 15px; }}
      .modal-actions .btn {{ width: 100%; }}
    }}
  </style>
</head>
<body data-account-state="{account_state}" data-has-alert="{1 if has_alert_modal else 0}">
  <div class="orb orb-a"></div>
  <div class="orb orb-b"></div>
  <main class="page">
    <section class="glass hero reveal" style="--delay:.02s">
      <div class="hero-top">
        <div class="brand">
          <div class="brand-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M12 3v18M3 12h18M5 7l14 10M5 17L19 7"></path>
            </svg>
          </div>
          <div>
            <h1 class="hero-title">داشبورد مدیریت اشتراک</h1>
            <p class="hero-subtitle">نمای کامل وضعیت سرویس، لینک اصلی اشتراک و لینک‌های مستقیم برای اتصال سریع در کلاینت‌های VPN.</p>
          </div>
        </div>
        <div class="top-actions">
          <button type="button" id="themeToggle" class="btn btn-soft">
            <span class="theme-icon" aria-hidden="true"></span>
            <span id="themeLabel">حالت شب</span>
          </button>
          <button type="button" class="btn btn-soft copy-btn" data-copy="{master_link_attr}">کپی لینک اصلی</button>
          <a class="btn" href="{master_link_html}" target="_blank" rel="noopener">باز کردن لینک اصلی</a>
        </div>
      </div>
      <div class="token-line">
        <span>توکن کاربر:</span>
        <span class="mono">{token_html}</span>
        <button type="button" class="btn btn-soft copy-btn" data-copy="{token_attr}">کپی توکن</button>
      </div>
      <div class="mini-chips">
        <span class="badge {expiry_badge}">{expiry_state}</span>
        <span class="badge {status_class}">وضعیت کاربر: {status_text}</span>
        <span class="badge neutral"><span data-number="{usable_links}">{usable_links}</span> لینک فعال</span>
      </div>
      <div class="state-hero {account_state}">
        <div class="state-hero-icon" aria-hidden="true">{'!' if account_state != 'normal' else '✓'}</div>
        <div>
          <div class="state-hero-title">{status_headline}</div>
          <div class="state-hero-sub">{status_desc}</div>
        </div>
      </div>
    </section>

    <section class="grid-4">
      <article class="glass stat-card reveal" style="--delay:.03s">
        <div class="stat-top"><span class="k">کاربر</span><span class="dot neutral"></span></div>
        <div class="v">{label}</div>
      </article>
      <article class="glass stat-card reveal" style="--delay:.06s">
        <div class="stat-top"><span class="k">روز باقی‌مانده</span><span class="dot {expiry_badge}"></span></div>
        <div class="v" data-number="{days_left_display}">{days_left_display}</div>
      </article>
      <article class="glass stat-card reveal" style="--delay:.09s">
        <div class="stat-top"><span class="k">انقضا (شمسی)</span><span class="dot {expiry_badge}"></span></div>
        <div class="v slim jalali" data-jalali="datetime" data-iso="{expire_iso}" data-fallback="{expire_text}">{expire_text}</div>
      </article>
      <article class="glass stat-card reveal" style="--delay:.12s">
        <div class="stat-top"><span class="k">درصد مصرف</span><span class="dot neutral"></span></div>
        <div class="v"><span data-number="{percent}">{percent}</span>%</div>
      </article>
      <article class="glass stat-card reveal" style="--delay:.15s">
        <div class="stat-top"><span class="k">حجم کل</span><span class="dot neutral"></span></div>
        <div class="v"><span data-number="{total_gb:.2f}">{total_gb:.2f}</span> GB</div>
      </article>
      <article class="glass stat-card reveal" style="--delay:.18s">
        <div class="stat-top"><span class="k">مصرف شده</span><span class="dot warn"></span></div>
        <div class="v"><span data-number="{used_gb:.2f}">{used_gb:.2f}</span> GB</div>
      </article>
      <article class="glass stat-card reveal" style="--delay:.21s">
        <div class="stat-top"><span class="k">باقی‌مانده</span><span class="dot ok"></span></div>
        <div class="v"><span data-number="{remain_gb:.2f}">{remain_gb:.2f}</span> GB</div>
      </article>
      <article class="glass stat-card reveal" style="--delay:.24s">
        <div class="stat-top"><span class="k">آخرین بروزرسانی</span><span class="dot neutral"></span></div>
        <div class="v slim jalali" data-jalali="datetime" data-iso="{updated_iso}" data-fallback="{updated_text}">{updated_text}</div>
      </article>
    </section>

    <section class="grid-2">
      <article class="glass analytics reveal" style="--delay:.27s">
        <div class="section-head">
          <div>
            <h2 class="section-title">تحلیل مصرف و زمان</h2>
            <p class="section-sub">نمودار مصرف حجم، روند زمانی اشتراک، و جزئیات تخصیص.</p>
          </div>
          <span class="badge neutral">شناسه کاربر: <span data-number="{user.id}">{user.id}</span></span>
        </div>
        <div class="usage-wrap">
          <div class="ring" style="--value:{percent}">
            <div class="ring-inner">
              <strong data-number="{percent}">{percent}</strong>
              <span>درصد مصرف</span>
            </div>
          </div>
          <div class="progress-list">
            <div class="progress-item">
              <div class="progress-meta">
                <span>مصرف حجم</span>
                <strong><span data-number="{used_gb:.2f}">{used_gb:.2f}</span> GB</strong>
              </div>
              <div class="track"><span style="width:{percent}%"></span></div>
            </div>
            <div class="progress-item">
              <div class="progress-meta">
                <span>پیشرفت زمانی اشتراک</span>
                <strong><span data-number="{time_percent}">{time_percent}</span>%</strong>
              </div>
              <div class="track"><span style="width:{time_percent}%"></span></div>
            </div>
            <div class="progress-item">
              <div class="progress-meta">
                <span>ایجاد اشتراک</span>
                <strong class="jalali" data-jalali="datetime" data-iso="{created_iso}" data-fallback="{created_text}">{created_text}</strong>
              </div>
            </div>
          </div>
        </div>
      </article>

      <article class="glass analytics reveal" style="--delay:.30s">
        <div class="section-head">
          <div>
            <h2 class="section-title">راهنمای استفاده سریع</h2>
            <p class="section-sub">مراحل پیشنهادی برای اتصال پایدار در کلاینت‌های مختلف.</p>
          </div>
          <span class="badge neutral">لینک‌های آماده: <span data-number="{total_links}">{total_links}</span></span>
        </div>
        <div class="progress-list">
            <div class="progress-item">
              <div class="progress-meta">
                <span>۱) لینک اصلی اشتراک</span>
                <strong>پیشنهادی</strong>
              </div>
              <div class="muted">ابتدا لینک اصلی را کپی کنید و در کلاینت وارد کنید تا همه نودها یکجا لود شوند.</div>
            </div>
            <div class="progress-item">
              <div class="progress-meta">
                <span>۲) لینک مستقیم نود</span>
                <strong>جایگزین</strong>
              </div>
              <div class="muted">اگر کلاینت شما با لینک اصلی سازگار نیست، از لینک‌های مستقیم همین صفحه استفاده کنید.</div>
            </div>
          <div class="progress-item">
            <div class="progress-meta">
              <span>۳) انقضا و مصرف</span>
              <strong>پایش روزانه</strong>
            </div>
            <div class="muted">تاریخ انقضا و درصد مصرف را بررسی کنید تا پیش از قطع سرویس، تمدید انجام شود.</div>
          </div>
        </div>
      </article>
    </section>

    <section class="glass master reveal" style="--delay:.33s">
      <div class="section-head">
        <div>
          <h2 class="section-title">لینک اصلی اشتراک</h2>
          <p class="section-sub">این لینک را در کلاینت‌ها قرار دهید تا همه نودهای مجاز یک‌جا خوانده شوند.</p>
        </div>
        <div class="actions">
          <button type="button" class="btn btn-soft copy-btn" data-copy="{master_link_attr}">کپی</button>
          <a class="btn" href="{master_link_html}" target="_blank" rel="noopener">باز کردن</a>
        </div>
      </div>
      <div class="link-box mono">{master_link_html}</div>
    </section>

    <section class="glass node-section reveal" style="--delay:.36s">
      <div class="section-head">
        <div>
          <h2 class="section-title">لینک‌های مستقیم نودها</h2>
          <p class="section-sub">برای برخی سرویس‌ها فایل پیکربندی `.conf` ارائه می‌شود.</p>
        </div>
        <span class="badge neutral"><span data-number="{total_links}">{total_links}</span> نود</span>
      </div>
      {rows_html}
    </section>

    <footer class="foot-note">
      زمان تولید صفحه:
      <span class="jalali" data-jalali="datetime" data-iso="{generated_iso}" data-fallback="{generated_text}">{generated_text}</span>
    </footer>
  </main>
  <div id="toast" class="toast"></div>
  {alert_modal_html}
  <script>
    let toastTimer = null;
    function showToast(msg, tone) {{
      const el = document.getElementById("toast");
      if (!el) return;
      el.className = "toast";
      if (tone) el.classList.add(tone);
      el.textContent = msg;
      el.classList.add("show");
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {{
        el.classList.remove("show");
      }}, 1700);
    }}

    function toFaNumber(value) {{
      const n = Number(value);
      if (!Number.isFinite(n)) return null;
      if (Math.floor(n) === n) return n.toLocaleString("fa-IR");
      return n.toLocaleString("fa-IR", {{ maximumFractionDigits: 2 }});
    }}

    function renderFaNumbers() {{
      const nodes = document.querySelectorAll("[data-number]");
      nodes.forEach((el) => {{
        const raw = el.getAttribute("data-number");
        const txt = toFaNumber(raw);
        if (txt !== null) el.textContent = txt;
      }});
    }}

    function renderJalaliDates() {{
      const dateFmt = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {{ dateStyle: "long" }});
      const dateTimeFmt = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {{ dateStyle: "long", timeStyle: "short" }});
      document.querySelectorAll(".jalali[data-iso]").forEach((el) => {{
        const iso = el.getAttribute("data-iso");
        const mode = el.getAttribute("data-jalali");
        const fallback = el.getAttribute("data-fallback") || el.textContent || "";
        if (!iso) {{
          el.textContent = fallback;
          return;
        }}
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) {{
          el.textContent = fallback;
          return;
        }}
        try {{
          el.textContent = mode === "date" ? dateFmt.format(d) : dateTimeFmt.format(d);
        }} catch (_err) {{
          el.textContent = fallback;
        }}
      }});
    }}

    function applyTheme(mode) {{
      const normalized = mode === "night" ? "night" : "day";
      document.documentElement.dataset.theme = normalized;
      const label = document.getElementById("themeLabel");
      if (label) {{
        label.textContent = normalized === "night" ? "حالت روز" : "حالت شب";
      }}
      try {{
        localStorage.setItem("guardino-sub-theme", normalized);
      }} catch (_err) {{
        // ignore storage errors
      }}
    }}

    function initTheme() {{
      let saved = "day";
      try {{
        const v = localStorage.getItem("guardino-sub-theme");
        if (v === "night") saved = "night";
      }} catch (_err) {{
        saved = "day";
      }}
      applyTheme(saved);
      const toggle = document.getElementById("themeToggle");
      if (!toggle) return;
      toggle.addEventListener("click", () => {{
        const current = document.documentElement.dataset.theme === "night" ? "night" : "day";
        applyTheme(current === "night" ? "day" : "night");
      }});
    }}

    async function copyTextSafe(t) {{
      const value = String(t ?? "");
      if (!value.trim()) {{
        showToast("متنی برای کپی وجود ندارد", "warn");
        return false;
      }}
      try {{
        if (navigator.clipboard && window.isSecureContext) {{
          await navigator.clipboard.writeText(value);
          showToast("با موفقیت کپی شد", "ok");
          return true;
        }}
      }} catch (_err) {{
        // fallback to legacy copy
      }}
      try {{
        const ta = document.createElement("textarea");
        ta.value = value;
        ta.setAttribute("readonly", "true");
        ta.style.position = "fixed";
        ta.style.top = "-1000px";
        ta.style.left = "-1000px";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (ok) {{
          showToast("با موفقیت کپی شد", "ok");
          return true;
        }}
      }} catch (_err) {{
        // fallback to manual prompt
      }}
      window.prompt("کپی دستی:", value);
      showToast("کپی خودکار در این مرورگر محدود است", "warn");
      return false;
    }}

    function bindCopyButtons() {{
      document.querySelectorAll(".copy-btn[data-copy]").forEach((btn) => {{
        btn.addEventListener("click", async () => {{
          const value = btn.getAttribute("data-copy") || "";
          await copyTextSafe(value);
        }});
      }});
    }}

    function initStatusModal() {{
      const modal = document.getElementById("statusModal");
      if (!modal) return;
      const closeModal = () => {{
        modal.classList.remove("show");
        setTimeout(() => {{
          if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
        }}, 200);
      }};
      modal.querySelectorAll("[data-close-modal]").forEach((btn) => {{
        btn.addEventListener("click", closeModal);
      }});
      modal.addEventListener("click", (e) => {{
        if (e.target === modal) closeModal();
      }});
    }}

    initTheme();
    bindCopyButtons();
    initStatusModal();
    renderFaNumbers();
    renderJalaliDates();
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
