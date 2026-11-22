import { RailError } from "./types";

export async function httpJson<T>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<{ status: number; body: T }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 20000);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, cache: "no-store" });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text.slice(0, 200) };
    }
    if (res.status === 401 || res.status === 403) throw new RailError("AUTH", "Provider rejected the credentials");
    return { status: res.status, body: body as T };
  } catch (e) {
    if (e instanceof RailError) throw e;
    throw new RailError("NETWORK", e instanceof Error ? e.message : "Network error");
  } finally {
    clearTimeout(timer);
  }
}
