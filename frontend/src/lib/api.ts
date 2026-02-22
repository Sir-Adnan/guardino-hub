import { storage } from "./storage";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "/api";

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = storage.get("token");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as any),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}
