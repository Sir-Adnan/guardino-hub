from __future__ import annotations

from urllib.parse import urlparse


def normalize_url(direct: str | None, base_url: str | None) -> str | None:
    if not direct:
        return None
    url = direct.strip()
    if not url:
        return None
    if url.startswith("http://") or url.startswith("https://"):
        return url
    if not base_url:
        return url

    base = base_url.strip()
    if not base:
        return url

    try:
        parsed = urlparse(base)
        if parsed.scheme and parsed.netloc:
            origin = f"{parsed.scheme}://{parsed.netloc}"
        else:
            origin = base
    except Exception:
        origin = base

    if not url.startswith("/"):
        url = "/" + url
    return origin.rstrip("/") + url
