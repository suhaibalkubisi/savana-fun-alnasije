"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { scopedResult, singleFlight } from "./request-state.mjs";
export async function api<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: body ? "POST" : "GET",
      headers: body
        ? { "Content-Type": "application/json", "x-hr-request": "1" }
        : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(45000),
    });
  } catch {
    throw new Error(
      body
        ? "لم تصل نتيجة الطلب. تحقق من السجل قبل إعادة المحاولة لتجنب التكرار"
        : "تعذر تحميل البيانات. تحقق من الاتصال وأعد المحاولة",
    );
  }
  const data = await response
    .json()
    .catch(() => ({ error: "تعذر قراءة الاستجابة" }));
  if (!response.ok) {
    if (response.status === 401)
      window.dispatchEvent(new Event("hr-session-expired"));
    throw new Error((data as { error?: string }).error || "تعذر إكمال العملية");
  }
  return data as T;
}
export function useData<T>(
  kind: string,
  filters: Record<string, string | number | undefined> = {},
  enabled = true,
) {
  const query = new URLSearchParams({
    kind,
    ...Object.fromEntries(
      Object.entries(filters)
        .filter(([, v]) => v !== undefined && v !== "")
        .map(([k, v]) => [k, String(v)]),
    ),
  }).toString();
  const [result, setResult] = useState<{
    data?: T;
    error: string;
    key: string;
    query?: string;
  }>({ error: "", key: "" });
  const [revision, bump] = useState(0);
  const sequence = useRef(0);
  const key = query + "#" + revision;
  const refresh = useCallback(() => bump((v) => v + 1), []);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const seq = ++sequence.current;
    api<T>(`/api/data?${query}`)
      .then((data) => {
        if (active && seq === sequence.current)
          setResult({ data, error: "", key, query });
      })
      .catch((error) => {
        if (active && seq === sequence.current)
          setResult({ error: error.message, key, query });
      });
    return () => {
      active = false;
    };
  }, [query, key, enabled]);
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 30000);
    window.addEventListener("hr-data-changed", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("hr-data-changed", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh, enabled]);
  return {
    ...scopedResult(result, query, key, enabled),
    refresh,
  };
}
export const changed = () => window.dispatchEvent(new Event("hr-data-changed"));
const pendingMutation = singleFlight();
export async function mutate<T = unknown>(action: string, data: unknown) {
  return pendingMutation(JSON.stringify({ action, data }), async () => {
    const result = await api<T>("/api/data", { action, data });
    changed();
    return result;
  });
}
export function useDebounced(value: string) {
  const [delayed, set] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => set(value), 220);
    return () => clearTimeout(t);
  }, [value]);
  return delayed;
}
