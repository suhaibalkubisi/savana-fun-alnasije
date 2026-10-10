export type OnboardingRow=Record<string,any>;
export function fileOnboarding(evidence:{batch:OnboardingRow;sources:OnboardingRow[];employees:OnboardingRow[];assignments:OnboardingRow[];rules:OnboardingRow[]},proposed?:{person_code:string;employee_uuid:string}[]):OnboardingRow;
export function validateCompanyProposal(proposal:OnboardingRow,digest:(text:string)=>Promise<string>):Promise<OnboardingRow>;
export function companyApproval(proposal:OnboardingRow,choices:Record<string,{selected:boolean;employee_uuid:string;reason?:string;evidence?:string}>,employees:OnboardingRow[],evidence:string):OnboardingRow;
