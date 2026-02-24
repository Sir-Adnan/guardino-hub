import { storage } from "./storage";

// In production behind nginx, UI calls "/api/v1/..." directly.
// For local dev you can set NEXT_PUBLIC_API_BASE to "http://localhost:8000" (or similar).
const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "";

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = storage.get("token");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as any),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const base = API_BASE.endsWith("/") ? API_BASE.slice(0, -1) : API_BASE;
  const res = await fetch(`${base}${path}`, { ...init, headers });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}
