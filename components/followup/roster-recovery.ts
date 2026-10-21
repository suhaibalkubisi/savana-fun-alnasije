import type { Employee } from "./domain";
export type RosterMember = Employee & { employee_id: string; version: number };
export type RosterPreview = { id: string; expires_at: string; department_id: string; valid_from: string; reason: string; employees: RosterMember[]; member_count: number };
export type RosterDecision = { id: string; preview_id: string; member_count: number; valid_from: string; department_id: string; reason?: string; employees?: RosterMember[] };
export type RosterPayload = { department_id: string; valid_from: string; reason: string; employees: { employee_id: string; version: number }[] };
export type RosterPointer = { preview_id: string; request_id: string };
export type RosterStatus = { preview: RosterPreview; decision: RosterDecision | null };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseRosterPointer(value: unknown): RosterPointer | null {
  if (!value || typeof value !== "object") return null;
  const p = value as Record<string, unknown>;
  return typeof p.preview_id === "string" && uuid.test(p.preview_id) && typeof p.request_id === "string" && uuid.test(p.request_id) ? { preview_id: p.preview_id, request_id: p.request_id } : null;
}
function validPreview(value: RosterPreview) {
  return !!value?.id && typeof value.department_id === "string" && !!value.department_id && /^\d{4}-\d{2}-\d{2}$/.test(value.valid_from) && typeof value.reason === "string" && !!value.reason.trim() && Number.isFinite(Date.parse(value.expires_at)) && Number.isInteger(value.member_count) && value.member_count > 0 && Array.isArray(value.employees) && value.employees.length === value.member_count && new Set(value.employees.map(row => row?.employee_id)).size === value.member_count && value.employees.every(row => row && row.id === row.employee_id && typeof row.name === "string" && typeof row.internal_code === "string" && row.department_id === value.department_id && Number.isInteger(row.version) && Number(row.version) > 0);
}
function sameMembers(actual: RosterMember[], wanted: { employee_id: string; version: number }[]) {
  if (!Array.isArray(actual) || actual.length !== wanted.length) return false;
  const expected = new Map(wanted.map(row => [row.employee_id, row.version]));
  return expected.size === wanted.length && new Set(actual.map(row => row?.employee_id)).size === wanted.length && actual.every(row => row && expected.get(row.employee_id) === row.version);
}
export function exactPreview(value: RosterPreview, payload: RosterPayload) {
  return validPreview(value) && Date.parse(value.expires_at) > Date.now() && value.department_id === payload.department_id && value.valid_from === payload.valid_from && value.reason === payload.reason && value.member_count === payload.employees.length && sameMembers(value.employees, payload.employees);
}
export function exactDecision(value: RosterDecision, preview: RosterPreview) {
  return !!value?.id && value.preview_id === preview.id && value.department_id === preview.department_id && value.valid_from === preview.valid_from && value.member_count === preview.member_count;
}
export function exactRosterStatus(value: RosterStatus, pointer: RosterPointer) {
  if (!value || !validPreview(value.preview) || value.preview.id !== pointer.preview_id) return false;
  return value.decision === null || (exactDecision(value.decision, value.preview) && value.decision.reason === value.preview.reason && sameMembers(value.decision.employees!, value.preview.employees) && value.decision.employees!.every(row => row.department_id === value.preview.department_id));
}
