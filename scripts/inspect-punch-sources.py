"""Independent, read-only OpenXML acceptance oracle. Private outputs are gitignored."""
import argparse, collections, hashlib, json, re
from pathlib import Path
import openpyxl

p = argparse.ArgumentParser()
p.add_argument('files', nargs='+', type=Path)
p.add_argument('--output', type=Path, default=Path('outputs/radical/source-inspection.private.json'))
a = p.parse_args()
reports = []
for file in a.files:
    wb = openpyxl.load_workbook(file, data_only=False)
    report = {'file': file.name, 'format': 'OpenXML XLSX', 'sha256': hashlib.sha256(file.read_bytes()).hexdigest(), 'sheets': [], 'cells': []}
    for sheet in wb:
        grid = list(sheet.values)
        headers = [str(v or '').strip() for v in grid[0]]
        daily = 'Punch Date' in headers
        dates, identities, names = set(), set(), collections.defaultdict(set)
        counts = collections.Counter()
        for rownum, row in enumerate(grid[1:], 2):
            if not any(v is not None for v in row): continue
            code, name = str(row[0] or ''), str(row[1] or '')
            identities.add((code, name)); names[code].add(name)
            cells = [(str(row[3]), [row[5], row[6]])] if daily else [('2026-'+h, [row[i]]) for i,h in enumerate(headers) if re.fullmatch(r'\d{2}-\d{2}',h)]
            for date, values in cells:
                dates.add(date)
                tokens = [t for v in values if v is not None for t in re.split(r'\s+',str(v).strip()) if t and t not in ['-','--']]
                minutes, invalid = [], []
                for t in tokens:
                    m = re.fullmatch(r'(\d{1,2}):(\d{2})',t)
                    if not m or int(m[1])>23 or int(m[2])>59: invalid.append(t)
                    else: minutes.append(int(m[1])*60+int(m[2]))
                counts['calendar_cells'] += 1
                counts['populated_cells'] += bool(tokens)
                counts['raw_punch_tokens'] += len(tokens)
                counts['unique_punch_minutes'] += len(set(minutes))
                counts['duplicate_tokens'] += len(minutes)-len(set(minutes))
                counts['invalid_tokens'] += len(invalid)
                counts['single_cells'] += len(set(minutes))==1
                counts['multiple_cells'] += len(set(minutes))>2
                report['cells'].append({'sheet':sheet.title,'row':rownum,'code':code,'name':name,'date':date,'minutes':sorted(set(minutes)),'tokens':tokens,'invalid':invalid,'raw_values':[str(v or '') for v in row] if daily else [code,name,date[5:],str(values[0] or '')]})
        report['sheets'].append({'name':sheet.title,'dimensions':sheet.calculate_dimension(),'headers':headers,'kind':'daily' if daily else 'monthly','year_present':daily,'direction_explicit':False,'representation':'calendar-day extrema' if daily else 'calendar-day matrix','source_rows':len(identities),'identities':len(identities),'code_count':len(names),'conflicting_codes':sum(len(n)>1 for n in names.values()),'date_start':min(dates),'date_end':max(dates),'counts':dict(counts)})
    reports.append(report)
a.output.parent.mkdir(parents=True,exist_ok=True)
a.output.write_text(json.dumps(reports,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps([{k:v for k,v in r.items() if k!='cells'} for r in reports],ensure_ascii=True,indent=2))
