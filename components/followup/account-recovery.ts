export type AccountPending = { id: string; email?: string };
const generations = new Map<string, number>();
const pointers = new Map<string, AccountPending>();
export const captureRecoverySession = (actor: string) =>
  generations.get(actor) || 0;
export const recoverySessionCurrent = (actor: string, generation: number) =>
  captureRecoverySession(actor) === generation;
export function invalidateRecoverySession(actor: string) {
  generations.set(actor, captureRecoverySession(actor) + 1);
}
export function recoveryStorageKeys() {
  return Array.from({ length: sessionStorage.length }, (_, i) =>
    sessionStorage.key(i),
  ).filter((k): k is string => !!k);
}
export type AccountProof = {
  request_id: string;
  state: string;
  email?: string;
  name?: string;
  role?: string;
  departments?: string[];
  user_id?: string | null;
  found_user_id?: string | null;
};
const key = (actor: string) => `fu-account-creation:${actor}`;
export function readAccountPending(actor: string): AccountPending | null {
  const value = sessionStorage.getItem(key(actor));
  if (!value) return pointers.get(actor) || null;
  const p = JSON.parse(value) as AccountPending;
  if (
    !/^[0-9a-f-]{36}$/i.test(p.id) ||
    (p.email !== undefined && typeof p.email !== "string")
  )
    throw Error("تعذر قراءة طلب الحساب المحفوظ؛ راجع المسؤول.");
  return p;
}
export function saveAccountPending(
  actor: string,
  p: AccountPending,
  generation = captureRecoverySession(actor),
) {
  if (!recoverySessionCurrent(actor, generation)) return false;
  sessionStorage.setItem(key(actor), JSON.stringify(p));
  return true;
}
export function clearAccountPending(actor: string) {
  pointers.delete(actor);
  sessionStorage.removeItem(key(actor));
}
export function redactAccountPending(actor: string) {
  let pending: AccountPending | null;
  try {
    pending = readAccountPending(actor);
  } catch {
    sessionStorage.removeItem(key(actor));
    return;
  }
  if (!pending) return;
  const pointer = { id: pending.id };
  pointers.set(actor, pointer);
  try {
    sessionStorage.setItem(key(actor), JSON.stringify(pointer));
  } catch {
    sessionStorage.removeItem(key(actor));
  }
}
