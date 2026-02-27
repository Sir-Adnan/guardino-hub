import { storage } from "./storage";

// In production behind nginx, UI calls "/api/v1/..." directly.
// For local dev you can set NEXT_PUBLIC_API_BASE to "http://localhost:8000" (or similar).
const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "";

function localizeApiError(message: string): string {
  const m = (message || "").trim();
  const l = m.toLowerCase();
  if (l === "not found") return "موردی یافت نشد.";
  if (l.includes("user not found")) return "کاربر پیدا نشد.";
  if (l.includes("invalid credentials")) return "نام کاربری یا رمز عبور اشتباه است.";
  if (l.includes("account disabled")) return "حساب کاربری شما غیرفعال است.";
  if (l.includes("invalid token")) return "نشست شما معتبر نیست. دوباره وارد شوید.";
  if (l.includes("insufficient balance")) return "موجودی کافی نیست.";
  return m;
}

function extractApiErrorDetail(raw: string): string | null {
  const txt = (raw || "").trim();
  if (!txt) return null;
  try {
    const parsed = JSON.parse(txt);
    if (typeof parsed === "string" && parsed.trim()) return parsed.trim();
    if (typeof parsed?.detail === "string" && parsed.detail.trim()) return parsed.detail.trim();
    if (typeof parsed?.message === "string" && parsed.message.trim()) return parsed.message.trim();
    if (Array.isArray(parsed?.detail) && parsed.detail.length) {
      const first = parsed.detail[0];
      if (typeof first === "string" && first.trim()) return first.trim();
      if (typeof first?.msg === "string" && first.msg.trim()) return first.msg.trim();
    }
  } catch {
    // not JSON, fallback to raw text
  }
  return txt;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = storage.get("token");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as any),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const base = API_BASE.endsWith("/") ? API_BASE.slice(0, -1) : API_BASE;
  const method = String(init?.method || "GET").toUpperCase();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers,
    // Avoid stale lists/pagination in browser/proxy caches.
    cache: method === "GET" ? "no-store" : init?.cache,
  });
  if (!res.ok) {
    const txt = await res.text();
    if (txt) {
      const detail = extractApiErrorDetail(txt);
      if (detail) throw new Error(localizeApiError(detail));
    }
    throw new Error(localizeApiError(res.statusText || `HTTP ${res.status}`));
  }
  return (await res.json()) as T;
}
