import {
  captureRecoverySession,
  recoverySessionCurrent,
  recoveryStorageKeys,
} from "./account-recovery";
export type DecisionAttempt = {
  id: string;
  actor: string;
  kind: "service_state" | "employee_identity";
  data: Record<string, unknown>;
  redacted?: boolean;
};
export type DecisionRecoveryProof = {
  request_id: string;
  actor: string;
  kind: DecisionAttempt["kind"];
  employee_id: string;
  state: "staged" | "committed" | "not_found" | "closed";
  data?: Record<string, unknown>;
};
export type DecisionReceipt = {
  request_id: string;
  actor: string;
  kind: string;
  employee_id: string;
  entity_id: string;
  employee_version: number;
};
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const key = (actor: string, employee: string, kind: string) =>
  `fu-decision-recovery:${actor}:${employee}:${kind}`;
const pointers = new Map<string, DecisionAttempt>();
export function readDecisionRecovery(
  actor: string,
  employee: string,
  kind: DecisionAttempt["kind"],
): DecisionAttempt | null {
  const storageKey = key(actor, employee, kind);
  const raw = sessionStorage.getItem(storageKey);
  if (!raw) return pointers.get(storageKey) || null;
  const p = JSON.parse(raw) as DecisionAttempt;
  if (
    !uuid.test(p.id) ||
    p.actor !== actor ||
    p.kind !== kind ||
    p.data?.employee_id !== employee ||
    !Number.isInteger(p.data.version) ||
    (!p.redacted && typeof p.data.reason !== "string")
  )
    throw Error("تعذر قراءة طلب الاستكمال. راجع المسؤول قبل بدء قرار بديل.");
  return p;
}
export function saveDecisionRecovery(
  p: DecisionAttempt,
  generation = captureRecoverySession(p.actor),
) {
  if (!recoverySessionCurrent(p.actor, generation)) return false;
  sessionStorage.setItem(
    key(p.actor, String(p.data.employee_id), p.kind),
    JSON.stringify(p),
  );
  return true;
}
export function clearDecisionRecovery(p: DecisionAttempt) {
  const k = key(p.actor, String(p.data.employee_id), p.kind);
  if (pointers.get(k)?.id === p.id) pointers.delete(k);
  const current = sessionStorage.getItem(k);
  if (current && (JSON.parse(current) as DecisionAttempt).id === p.id)
    sessionStorage.removeItem(k);
}
export function decisionRecoveries(actor: string) {
  const prefix = `fu-decision-recovery:${actor}:`;
  return recoveryStorageKeys()
    .filter((k) => k.startsWith(prefix))
    .map((k) => {
      const [, , employee, kind] = k.split(":");
      return readDecisionRecovery(
        actor,
        employee,
        kind as DecisionAttempt["kind"],
      );
    })
    .filter((p): p is DecisionAttempt => !!p);
}
export function redactDecisionRecoveries(actor: string) {
  for (const storageKey of recoveryStorageKeys().filter((k) =>
    k.startsWith(`fu-decision-recovery:${actor}:`),
  )) {
    const [, , employee, kind] = storageKey.split(":");
    let p: DecisionAttempt | null;
    try {
      p = readDecisionRecovery(
        actor,
        employee,
        kind as DecisionAttempt["kind"],
      );
    } catch {
      sessionStorage.removeItem(storageKey);
      continue;
    }
    if (!p) continue;
    const pointer: DecisionAttempt = {
      id: p.id,
      actor: p.actor,
      kind: p.kind,
      data: { employee_id: p.data.employee_id, version: p.data.version },
      redacted: true,
    };
    const k = key(actor, String(p.data.employee_id), p.kind);
    pointers.set(k, pointer);
    try {
      sessionStorage.setItem(k, JSON.stringify(pointer));
    } catch {
      sessionStorage.removeItem(k);
    }
  }
}
export function restoreDecisionAttempt(
  pointer: DecisionAttempt,
  proof: DecisionRecoveryProof,
): DecisionAttempt | null {
  if (
    proof.request_id !== pointer.id ||
    proof.actor !== pointer.actor ||
    proof.kind !== pointer.kind ||
    proof.employee_id !== pointer.data.employee_id
  )
    throw Error("نتيجة الاستكمال لا تطابق الطلب المحفوظ.");
  if (proof.state === "closed") return null;
  if (!proof.data || !["staged", "committed"].includes(proof.state))
    throw Error(
      "لم تتوفر بيانات الطلب بعد. تحقق أو أغلق الطلب بأمان قبل قرار جديد.",
    );
  if (
    proof.data.employee_id !== pointer.data.employee_id ||
    proof.data.version !== pointer.data.version ||
    typeof proof.data.reason !== "string"
  )
    throw Error("بيانات الاستكمال لا تطابق الطلب الأصلي.");
  return {
    id: pointer.id,
    actor: pointer.actor,
    kind: pointer.kind,
    data: proof.data,
  };
}
export function matchesDecisionReceipt(
  p: DecisionAttempt,
  receipt: DecisionReceipt | null,
) {
  return (
    !!receipt &&
    receipt.request_id === p.id &&
    receipt.actor === p.actor &&
    receipt.kind === p.kind &&
    receipt.employee_id === p.data.employee_id &&
    uuid.test(receipt.entity_id) &&
    receipt.employee_version === Number(p.data.version) + 1
  );
}
