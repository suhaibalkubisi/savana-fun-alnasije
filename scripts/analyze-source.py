"""Read every source sheet; produce immutable initial import data and reproducible SQL."""
import openpyxl, json, uuid, collections, hashlib, argparse
from pathlib import Path
parser=argparse.ArgumentParser()
parser.add_argument('workbook', type=Path)
src=parser.parse_args().workbook
root=Path(__file__).resolve().parents[1]
wb=openpyxl.load_workbook(src,data_only=True)
sha=hashlib.sha256(src.read_bytes()).hexdigest()
mapping={'Picking':('الالتقاط','Picking'),'Sorting':('الفرز','Sorting'),'merge':('الدمج','Merge'),'Packing':('التجهيز','Packing'),'Put away':('الخزن','Put away'),'Return':('الراجع','Return'),'Cyclecount':('الجرد','Cyclecount'),'Supervisors':('المسؤولين','Supervisors'),'متابعه':('المتابعة','Follow-up'),'خدمات':('الخدمات','Service')}
status={'نشط':'active','مستقيل':'resigned','غير نشط':'inactive','إجازة طويلة':'long_leave'}
ns=uuid.UUID('7121a109-82a2-4b91-8701-c6453845dcab')
def uid(s):return str(uuid.uuid5(ns,s))
def clean(v):return ' '.join(str(v).split()) if v is not None else ''
def sql(v):return 'NULL' if v is None else "'"+str(v).replace("'","''")+"'"
rows=[]; managers=[]; sheets=[]
for sheet in wb:
 values=list(sheet.values);header=None
 for i,row in enumerate(values):
  if 'الاسم' in row and 'القسم' in row:header=i;break
 if header is None:raise ValueError('Unmapped sheet: '+sheet.title)
 headers=[clean(v) for v in values[header]]
 for i,row in enumerate(values[header+1:],header+2):
  if not any(v is not None for v in row):continue
  r={k:clean(v) for k,v in zip(headers,row)}
  assert r['الاسم'] and r['القسم'] in mapping and r['حالة الموظف'] in status,(i,r)
  e={'id':uid(sha+sheet.title+str(i)),'employee_number':None,'name':r['الاسم'],'department_id':uid('department:'+r['القسم']),'shift_id':None,'direct_manager_id':None,'employment_status':status[r['حالة الموظف']]}
  rows.append(e)
  if r.get('الصفة')=='مشرف':managers.append({'id':uid('manager:'+e['id']),'name':e['name'],'employee_id':e['id']})
 sheets.append({'sheet':sheet.title,'rows':len(values),'headers':headers})
summary={'file':'AHH.xlsx','sha256':sha,'sheets':sheets,'total':len(rows),'counts':dict(collections.Counter(r['employment_status'] for r in rows)),'duplicate_names':{k:v for k,v in collections.Counter(r['name'] for r in rows).items() if v>1},'missing_fields':['employee_number','shift_id','direct_manager_id'],'source_role_usage':'Supervisors become selectable manager entries; no direct-manager relationship is inferred.'}
(root/'data/import-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
(root/'data/initial-employees.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2))
statements=['-- AHH.xlsx: '+sha,'-- Separate seed; run after schema. Safe to repeat by fixed UUID and source hash.','begin;']
for i,(key,(ar,en)) in enumerate(mapping.items(),1):
 statements.append('insert into public.departments(id,arabic_name,english_name,display_order) values('+','.join(map(sql,[uid('department:'+key),ar,en,i]))+') on conflict(id) do nothing;')
for r in rows:statements.append('insert into public.employees('+','.join(r)+') values('+','.join(sql(v) for v in r.values())+') on conflict(id) do nothing;')
for r in managers:statements.append('insert into public.managers('+','.join(r)+') values('+','.join(sql(v) for v in r.values())+') on conflict(id) do nothing;')
statements.append('insert into public.import_batches(id,source_hash,row_count) values('+','.join(map(sql,[uid(sha),sha,len(rows)]))+') on conflict(source_hash) do nothing;')
statements.append('commit;')
(root/'supabase/seed.sql').write_text('\n'.join(statements)+'\n')
print(json.dumps(summary,ensure_ascii=False))
