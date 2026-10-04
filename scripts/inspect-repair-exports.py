"""Inspect real browser exports with independent XLSX/PDF readers; render every PDF page."""
import json,zipfile,datetime,re
from pathlib import Path
import openpyxl,pypdf,pypdfium2
out=Path('outputs/repair');files=out/'browser-exports';results=[]
for file in sorted(files.glob('FANU-*.xlsx')):
    wb=openpyxl.load_workbook(file,data_only=True)
    rows=list(wb.active.values)
    populated=[[v if v is not None else '' for v in row] for row in rows]
    flat=[v for row in populated for v in row]
    body=[r for r in populated if 'FANU-000207' in r]
    assert body,file
    if 'daily' in file.name:
        expected=[1,'FANU-000207','موظف اختبار الدوام المسائي','الالتقاط','غير محدد',datetime.time(16,0),datetime.time(16,40),40,'دخول موثق','اختبار daily محلي.xls · سياق الاعتماد','','','']
        assert body==[expected],body
    else:
        expected=json.loads((out/'monthly-expected.json').read_text(encoding='utf8'))
        def excel_time(v):
            if not isinstance(v,str):return v
            overnight=re.fullmatch(r'([٠-٩]{2}):([٠-٩]{2}) ([صم]) \(\+1\) · (\d{4}-\d{2}-\d{2})',v)
            if overnight:return datetime.datetime.combine(datetime.date.fromisoformat(overnight[4]),datetime.time(int(overnight[1])%12+(12 if overnight[3]=='م' else 0),int(overnight[2])))
            m=re.fullmatch(r'([٠-٩]{2}):([٠-٩]{2}) ([صم])',v)
            return datetime.time(int(m[1])%12+(12 if m[3]=='م' else 0),int(m[2])) if m else v
        assert body==[[excel_time(v) for v in row] for row in expected],(file,'All monthly cells and totals must match')
    with zipfile.ZipFile(file) as z:
        assert z.read('xl/media/company.jpeg')==Path('public/brand/fanu-official-20260908.jpeg').read_bytes()
        assert z.read('xl/media/savana.png')==Path('public/brand/savana-official-20260908.png').read_bytes()
    results.append(dict(file=file.name,rows=len(body),cells=sum(len(r) for r in body),all_cells_equal=True,original_logo_bytes_equal=True))
for file in sorted(files.glob('FANU-*.pdf')):
    reader=pypdf.PdfReader(file)
    extracted='\n'.join(p.extract_text() for p in reader.pages)
    assert 'FANU-000207' in extracted,file
    if 'fingerprint' in file.name:
        assert '2026-09-11' in extracted and '2026-09-12' in extracted and '1125' in extracted
    for page in reader.pages:
        fonts=page['/Resources']['/Font'].get_object()
        descriptors=[]
        for f in fonts.values():
            obj=f.get_object()
            for font in [obj]+[d.get_object() for d in obj.get('/DescendantFonts',[])]:
                if font.get('/FontDescriptor'):descriptors.append(font['/FontDescriptor'].get_object())
        assert any('/FontFile2' in d for d in descriptors)
    pdf=pypdfium2.PdfDocument(str(file))
    for i,page in enumerate(pdf):page.render(scale=1.2).to_pil().save(out/(file.stem+'-page-'+str(i+1)+'.png'))
    results.append(dict(file=file.name,pages=len(reader.pages),identity_present=True,embedded_font=True,all_pages_rendered=True))
(out/'export-inspection.json').write_text(json.dumps(results,indent=2),encoding='utf8')
print(json.dumps(results,indent=2))
