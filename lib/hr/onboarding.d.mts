export interface OnboardingSummary {rows:number;matched:number;linked_people:number}
export interface OnboardingBatch {
 id:string;version:number;state:string;lifecycle_state?:string;import_kind?:'daily'|'monthly';
 source_name:string;device_namespace?:string;period_start:string;period_end:string;
 coverage_confirmed?:boolean;coverage_start?:string;coverage_end?:string;summary?:OnboardingSummary;
}
export interface OnboardingSource {
 id:string;person_code:string;source_name:string;employee_id:string|null;calendar_date:string;
 punch_minutes:number[];match_state?:string;identity_verified?:boolean;source_sheet:string;source_row:number;
}
export interface OnboardingEmployee {
 id:string;name:string;department_id:string;department:string;version:number;employment_status:string;
}
export interface OnboardingAssignment {
 id:string;employee_id:string;department_id:string;department?:string;version:number;
 valid_from:string;valid_to:string|null;employment_status:string;
}
export interface OnboardingRule {
 id:string;version:number;department_id:string;effective_from:string;start_minute:number;
 grace_minutes:number;entry_window_start:number;entry_window_end:number;working_weekdays:number[];
}
export interface OnboardingEvidence {
 batch:OnboardingBatch;sources:OnboardingSource[];employees:OnboardingEmployee[];
 assignments:OnboardingAssignment[];rules:OnboardingRule[];
}
export interface OnboardingIdentity {person_code:string;name:string;employee_uuid:string|null;established:boolean}
export interface OnboardingRange {from:string;through:string}
export interface OnboardingPerson {employee_uuid:string;name:string;version:number;established:boolean}
export interface OnboardingGap {
 key:string;reason:string;department_id:string;department:string;department_is_historical:boolean;
 people:OnboardingPerson[];ranges:OnboardingRange[];
}
export interface OnboardingEvidencePerson {
 employee_uuid:string;name:string;person_code:string;established:boolean;calendar_date:string;
 punch_minutes:number[];source_rows:{id:string;sheet:string;row:number}[];
 effective_rule:Omit<OnboardingRule,'department_id'>;
 assignment:Pick<OnboardingAssignment,'id'|'version'|'department'|'valid_from'|'valid_to'>;
}
export interface OnboardingInspection {
 batch:OnboardingBatch;identities:number;established:number;established_people:OnboardingIdentity[];
 proposed:number;exceptions:OnboardingIdentity[];existing_context_person_days:number;observed_entry_people:number;
 evidence_gaps:{key:string;reason:string;department:string;people:OnboardingEvidencePerson[]}[];
 coverage_confirmed:boolean;coverage:{start:string;end:string};gaps:OnboardingGap[];
 conditional_schedule_gaps:{department_id:string;department:string;ranges:OnboardingRange[]}[];
 existing_rules:OnboardingRule[];identity_decisions_written:0;attendance_approved:false;
}
export interface OnboardingProposedIdentity {person_code:string;employee_uuid:string}
export interface CompanyPreviewGuard {id:string;kind?:'daily'|'monthly';expected_state:string}
export interface CompanySourceRow {import_id:string;source_row_id?:string;source_sheet?:string;source_row?:number}
export interface CompanySupportingEvidence {
 original_roster:{file:string;sheet:string;row:number;original_department:string};distinct_export_contents:number;
}
export interface CompanyDecision {
 person_code:string;employee_uuid:string;employee_name?:string;employee_department?:string;company_name?:string;
 expected_employee_revision:number;expected_employee_status:string;expected_source_rows:CompanySourceRow[];
 import_ids:string[];evidence_brief:string;supporting_evidence:CompanySupportingEvidence;
}
export interface CompanyProposal {
 schema_version:number;batch_id:string;version:number;status:string;production_applied:false;identity_confirmed:false;
 attendance_approved:false;selected_count:number;selected_decisions:CompanyDecision[];preview_guards:CompanyPreviewGuard[];
 source_scope:{namespace:string};proposal_sha256:string;hash_definition?:string;evidence_reference?:string;
 exceptions_not_in_batch:{person_code:string;classification:string}[];
}
export interface CompanyReviewProposal extends Pick<CompanyProposal,'batch_id'|'version'|'selected_count'|'preview_guards'|'proposal_sha256'|'source_scope'|'exceptions_not_in_batch'|'evidence_reference'> {
 selected_decisions:CompanyDecision[];
}
export interface CompanyChoice {selected:boolean;employee_uuid:string;reason?:string;evidence?:string}
export interface CompanyAppliedResult {
 confirmation_id:string;batch_id:string;selected_count:number;linked_rows_changed:number;attendance_approved:false;
 before:{id:string;linked_people:number}[];
 previews:{id:string;version:number;state:string;coverage_confirmed:boolean;summary:OnboardingSummary}[];
}
export interface CompanyConfirmation {
 id:string;selected_count:number;confirmed_at?:string;batch_version?:number;result?:CompanyAppliedResult|null;
 decisions?:{person_code:string;company_name?:string;employee_name?:string;employee_uuid:string;decision?:string}[];
}
export interface CompanyNotes {version:number;answers:Record<string,string>}
export interface CompanyReview {proposal:CompanyReviewProposal|null;confirmation?:CompanyConfirmation|null;notes?:CompanyNotes|null}
export interface CompanyApprovedDecision extends CompanyDecision {
 employee_name:string;employee_department:string;decision:string;
 user_correction:{original_proposed_employee_uuid:string;reason:string;evidence_reference:string;original_algorithm_evidence_not_claimed_for_corrected_target:true}|null;
}
export interface CompanyApprovalResult extends Omit<CompanyProposal,'selected_decisions'|'proposal_sha256'|'hash_definition'> {
 selected_decisions:CompanyApprovedDecision[];base_proposal_sha256:string;excluded_from_proposal:{person_code:string;disposition:string}[];review_confirmed:true;
}
export function fileOnboarding(evidence:OnboardingEvidence,proposed?:OnboardingProposedIdentity[]):OnboardingInspection;
export function validateCompanyProposal(proposal:CompanyProposal,digest:(text:string)=>Promise<string>):Promise<CompanyProposal>;
export function companyApproval(proposal:CompanyProposal,choices:Record<string,CompanyChoice>,employees:OnboardingEmployee[],evidence:string):CompanyApprovalResult;
