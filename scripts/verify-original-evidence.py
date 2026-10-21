"""Independent xlrd reader: compares every source coordinate, name/code, raw cell and minute."""
import sys,json,re,hashlib
from pathlib import Path
sys.path.insert(0,str(Path('outputs/repair/python-deps').resolve()))
import xlrd
out=Path('outputs/repair')
results=[]
def text(v):
    return str(int(v)) if isinstance(v,float) and v.is_integer() else str(v)
def minutes(values):
    result=[]
    for v in values:
        for h,m,ampm in re.findall(r'(\d{1,2}):(\d{2})(?:\:\d{2})?\s*(am|pm)?',v,re.I):
            hour=int(h)
            if ampm: hour=hour%12+(12 if ampm.lower()=='pm' else 0)
            result.append(hour*60+int(m))
    return sorted(set(result))
for kind,file in zip(['daily','monthly'],sys.argv[1:]):
    workbook=xlrd.open_workbook(file);parsed=json.loads((out/(kind+'-original.private.json')).read_text(encoding='utf8'))
    expected=[]
    for sheet in workbook.sheets():
        grid=[[text(c.value) for c in sheet.row(i)] for i in range(sheet.nrows)]
        h=next(i for i,r in enumerate(grid) if 'Person Code' in r and 'Name' in r);headers=grid[h];ci=headers.index('Person Code');ni=headers.index('Name')
        for i,r in enumerate(grid[h+1:],h+1):
            if not r[ci].strip() and not r[ni].strip():continue
            if kind=='daily':
                vals=[r[headers.index('First Time Punch')],r[headers.index('Last Time Punch')]]
                cells=[(r[headers.index('Punch Date')],r,vals)]
            else:
                cells=[('2026-'+x,[r[ci],r[ni],x,r[j]],[r[j]]) for j,x in enumerate(headers) if re.fullmatch(r'\d{2}-\d{2}',x)]
            for date,raw,vals in cells:
                expected.append(dict(source_sheet=sheet.name,source_row=i+1,calendar_date=date,person_code=r[ci].strip(),source_name=r[ni].strip(),raw_values=raw,punch_minutes=minutes(vals),invalid=False))
    assert len(expected)==len(parsed['rows']),(kind,len(expected),len(parsed['rows']))
    for i,(a,b) in enumerate(zip(expected,parsed['rows'])):
        assert a==b,(kind,i,[k for k in a if a[k]!=b[k]])
    results.append(dict(kind=kind,all_rows_and_raw_cells_equal=True,rows=len(expected),punches=sum(len(r['punch_minutes']) for r in expected),sha256=hashlib.sha256(Path(file).read_bytes()).hexdigest()))
(out/'original-independent-comparison.json').write_text(json.dumps(results,indent=2),encoding='utf8')
print(json.dumps(results,indent=2))
