/** Explanations of evidence quality are independent of persisted approval state. */
export function importDiagnostics(position) {
  const groups = new Map();
  const definitions = {
    unresolved_identity:['رابط هوية سابق غير مثبت','راجع الهوية بدليل مستقل في معاينة تصحيحية؛ المصدر المغلق لا يُعدل.',true],
    unmatched: ['مطابقة الهوية', 'تحقق من صاحب رقم الجهاز واربطه بموظف موجود.', true],
    missing_assignment: ['الانتماء التاريخي', 'وثّق انتماء الموظف في الفترة من ملفه، استناداً إلى مستند فعلي.', true],
    missing_schedule: ['قاعدة الدوام', 'أضف قاعدة دوام مؤرخة للقسم في هذه الفترة.', true],
    exit_only: ['بصمات خارج نافذة الدخول', 'افحص أوقات المصدر وحدود الوردية؛ لا يوجد دخول مؤكد.', true],
    single: ['بصمة واحدة', 'يبقى الخروج ناقصاً. راجع وجود مصدر اليوم التالي، ولا تضف وقتاً افتراضياً.', false],
    unproven_coverage:['نطاق تصدير غير مثبت','تحقق من اكتمال نطاق الجهاز؛ لا يحول الفراغ إلى غياب.',false],
    no_punch: ['تواريخ مغطاة بلا بصمات', 'نقص دليل فقط؛ الغياب أو الإجازة قرار HR مستقل.', false],
    outside_coverage: ['خارج التغطية', 'لا توجد تغطية مؤكدة لهذا التاريخ في الملف.', false],
    future: ['تواريخ لاحقة', 'لا تُحتسب في نتائج الفترة الحالية.', false],
    pending: ['قرار مراجعة مفتوح', 'افتح مجموعة الهوية وراجع الدليل ثم احفظ القرار وسببه.', true],
  };
  for (const row of position?.rows || []) for (const cell of Object.values(row.cells)) {
    const cause = cell.state === 'complete' && cell.pending ? 'pending' : cell.state;
    if (!definitions[cause]) continue;
    if (!groups.has(cause)) groups.set(cause, {cause,label:definitions[cause][0],action:definitions[cause][1],blocksCalculation:definitions[cause][2],days:0,people:new Map()});
    const group=groups.get(cause); group.days++;
    if(!group.people.has(row.key))group.people.set(row.key,{key:row.key,name:row.name,employee_id:row.employee_id,code:row.internal_code,dates:[]});
    group.people.get(row.key).dates.push(cell.date);
  }
  return [...groups.values()].map(g=>({...g,people:[...g.people.values()]})).sort((a,b)=>Number(b.blocksCalculation)-Number(a.blocksCalculation)||b.days-a.days);
}
