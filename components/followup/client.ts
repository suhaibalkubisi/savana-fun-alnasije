import { parseRosterPointer, type RosterPointer } from "./roster-recovery";
import {
  invalidateRecoverySession,
  redactAccountPending,
  recoveryStorageKeys,
} from "./account-recovery";
import {
  decisionRecoveries,
  redactDecisionRecoveries,
} from "./decision-recovery";
export class RequestError extends Error {
  constructor(
    value: string,
    public status: number,
  ) {
    super(value);
    this.name = "RequestError";
  }
}
export async function request<T>(
  path: string,
  data?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const r = await fetch(
    path,
    data === undefined
      ? { cache: "no-store", signal }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-hr-request": "1" },
          body: JSON.stringify(data),
          signal,
        },
  );
  let b: T & { error?: string };
  try {
    b = await r.json();
  } catch (e) {
    if (isAbort(e)) throw e;
    throw Error(
      data === undefined
        ? "تعذر تحميل نتيجة صحيحة. أعد المحاولة"
        : "لم تصل نتيجة العملية بشكل صحيح. تحقق من السجل قبل إعادة المحاولة",
    );
  }
  if (!r.ok) throw new RequestError(b?.error || "تعذر إكمال الطلب", r.status);
  return b;
}
const retryKeys = new Map<string, string>();
export async function write<T>(
  kind: string,
  data: unknown,
  verify?: (value: T) => boolean | Promise<boolean>,
  requestId?: string,
): Promise<T> {
  const payload = JSON.stringify({ kind, data });
  if (
    requestId &&
    !parseRosterPointer({ preview_id: requestId, request_id: requestId })
  )
    throw Error("معرّف إعادة المحاولة غير صالح");
  const id = requestId || retryKeys.get(payload) || crypto.randomUUID();
  retryKeys.set(payload, id);
  const value = await request<T>("/api/followup", {
    kind,
    data,
    request_id: id,
  });
  if (verify && !(await verify(value)))
    throw Error(
      "لم تُثبت الاستجابة حفظ البيانات كاملة. تحقق من السجل قبل إعادة المحاولة",
    );
  retryKeys.delete(payload);
  return value;
}
export async function privateWrite<T>(
  data: Record<string, unknown>,
): Promise<T> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(data)),
  );
  const payload =
    "private:" +
    Array.from(new Uint8Array(digest), (value) =>
      value.toString(16).padStart(2, "0"),
    ).join("");
  let id = retryKeys.get(payload);
  if (!id) {
    id = crypto.randomUUID();
    retryKeys.set(payload, id);
  }
  const result = await request<T>("/api/followup/documents", {
    ...data,
    request_id: id,
  });
  retryKeys.delete(payload);
  return result;
}
export const get = <T>(
  kind: string,
  filters: Record<string, string> = {},
  signal?: AbortSignal,
) =>
  request<T>(
    "/api/followup?" + new URLSearchParams({ kind, ...filters }),
    undefined,
    signal,
  );
export function clearRetryKeys() {
  retryKeys.clear();
}
export function message(e: unknown) {
  return e instanceof Error ? e.message : "تعذر إكمال الطلب";
}
export function isAbort(e: unknown) {
  return e instanceof Error && e.name === "AbortError";
}
export function draftKey(user: string, department: string, date: string) {
  return "fu-evening-draft:" + user + ":" + department + ":" + date;
}
const recoveryActorKey = "fu-recovery-active-actor";
let recoveryActor: string | null = null;
function rememberedRecoveryActor() {
  try {
    return sessionStorage.getItem(recoveryActorKey) || recoveryActor;
  } catch {
    return recoveryActor;
  }
}
function rememberRecoveryActor(user: string) {
  recoveryActor = user;
  try {
    sessionStorage.setItem(recoveryActorKey, user);
  } catch {}
}
export function activateRecoveryActor(user: string) {
  const previous = rememberedRecoveryActor();
  if (previous && previous !== user) clearSessionDrafts(previous);
  invalidateRecoverySession(user);
  rememberRecoveryActor(user);
}
export function confirmRecoverySignedOut() {
  const previous = rememberedRecoveryActor();
  if (previous) clearSessionDrafts(previous);
  recoveryActor = null;
  try {
    sessionStorage.removeItem(recoveryActorKey);
  } catch {}
}
export function clearSessionDrafts(user: string) {
  invalidateRecoverySession(user);
  redactAccountPending(user);
  redactDecisionRecoveries(user);
  for (const key of recoveryStorageKeys())
    if (
      key.startsWith("fu-evening-draft:" + user + ":") ||
      key === rosterRecoveryKey(user)
    )
      sessionStorage.removeItem(key);
  if (rememberedRecoveryActor() === user) {
    recoveryActor = null;
    sessionStorage.removeItem(recoveryActorKey);
  }
}
export async function prepareLogoutRecovery(user: string) {
  rememberRecoveryActor(user);
  // Legacy requests may predate server staging. Best-effort staging must never
  // hold logout hostage; an unstaged pointer remains locked to verification or
  // an atomic close after the same actor signs in again.
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bounded = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve();
    }, 2000);
  });
  try {
    await Promise.race([
      bounded,
      Promise.allSettled(
        decisionRecoveries(user)
          .filter((p) => !p.redacted)
          .map((p) =>
            request(
              "/api/followup",
              {
                kind: "decision_recovery_stage",
                data: { kind: p.kind, data: p.data },
                request_id: p.id,
              },
              controller.signal,
            ),
          ),
      ),
    ]);
  } catch {
  } finally {
    clearTimeout(timer);
  }
}
export function rosterRecoveryKey(user: string) {
  return "fu-roster-setup:" + user;
}
export function readRosterRecovery(user: string): RosterPointer | null {
  try {
    const text = sessionStorage.getItem(rosterRecoveryKey(user));
    if (!text) return null;
    const p = parseRosterPointer(JSON.parse(text));
    if (p) return p;
  } catch {}
  throw Error(
    "تعذرت قراءة معرّف استرداد قرار القائمة. راجع مسؤول النظام قبل بدء قرار آخر.",
  );
}
export function saveRosterRecovery(user: string, value: RosterPointer) {
  const p = parseRosterPointer(value);
  if (!p) throw Error("معرّف استرداد القرار غير صالح");
  try {
    sessionStorage.setItem(rosterRecoveryKey(user), JSON.stringify(p));
  } catch {
    throw Error(
      "تعذر حفظ معرّف الاسترداد في هذه الجلسة. اسمح بتخزين الجلسة قبل تأكيد القرار.",
    );
  }
}
export function clearRosterRecovery(user: string) {
  sessionStorage.removeItem(rosterRecoveryKey(user));
}
