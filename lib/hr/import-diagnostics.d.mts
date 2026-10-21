import type {MonthlyPosition} from './monthly-position.mjs';
export type ImportDiagnostic={cause:string;label:string;action:string;blocksCalculation:boolean;days:number;people:{key:string;name:string;employee_id:string|null;code:string|null;dates:string[]}[]};
export function importDiagnostics(position?:MonthlyPosition|null):ImportDiagnostic[];
