// Administrative decisions and verified attendance are independent sources.
import {buildDailyPosition} from './attendance-engine.mjs';
import {buildMonthlyPosition} from './monthly-position.mjs';
export function comprehensivePosition(evidence){
 const report=evidence.report;
 const monthly=buildMonthlyPosition(evidence.monthly);
 const daily=new Map((evidence.daily||[]).map(e=>[e.date,new Map(buildDailyPosition(e).rows.map(r=>[r.employee_id,r]))]));
 const days=new Date(Number(report.month.slice(0,4)),Number(report.month.slice(5)),0).getDate();
 const rows=report.rows.map(r=>{
  const cells={...r.cells},details={};let verified=0,conflicts=0;
  const monthlyRow=monthly.available?monthly.rows.find(p=>p.employee_id===r.id):null;
  for(let n=1;n<=days;n++){
   const date=report.month+'-'+String(n).padStart(2,'0');
   const c=monthly.available?monthlyRow?.cells[String(n)]:daily.get(date)?.get(r.id);
   const valid=!!c&&date<=evidence.as_of&&(monthly.available
    ?c.entry!==null&&!c.pending&&c.expected===true&&c.assignment?.employment_status==='active'&&['complete','single'].includes(c.state)
    :c.entry_minute!==null&&!c.needs_review&&c.assignment_verified&&c.expected===true&&c.attendance_state==='entry_recorded');
   const manual=r.cells[n]||null;const conflict=!!manual&&manual!=='late'&&valid;
   details[n]={date,manual,recorded_entry:valid,conflict,attendance_state:c?(c.state||c.attendance_state):date>evidence.as_of?'future':'no_file',
    source:monthly.available?'monthly':'daily',source_id:monthly.available?monthly.batch.id:c?.raw_timeline?.[0]?.source_id||null};
   if(valid){verified++;if(!manual)cells[n]='attendance';}
   if(conflict)conflicts++;
  }
  return {...r,cells,cell_details:details,verified_entry_days:verified,attendance_conflicts:conflicts};
 });
 return {...report,rows,attendance_source:monthly.available?'approved_monthly':'approved_daily',as_of:evidence.as_of,attendance_conflicts:rows.reduce((n,r)=>n+r.attendance_conflicts,0)};
}

