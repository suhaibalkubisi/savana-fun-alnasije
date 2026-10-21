import {zipSync,strToU8} from 'fflate';
import {brandAssets} from '@/lib/hr/brand';
import type {ExportTable,ReportSection,Cell} from './report-model';
export type ExportAssets={bodyFont:string;titleFont:string;company:Uint8Array;savana:Uint8Array};
const xmlEscape=(v:unknown)=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'');
const col=(n:number)=>{let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
const base64=(bytes:Uint8Array)=>{let bin='';for(let i=0;i<bytes.length;i+=8192)bin+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(bin);};
const time=(at:string)=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Baghdad',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(at));
export async function loadExportAssets():Promise<ExportAssets>{
  const paths=['/fonts/FANUArabic.ttf','/fonts/Cairo-750.ttf?v=2',brandAssets.company.src,brandAssets.savana.src];
  const xs=await Promise.all(paths.map(async p=>{const r=await fetch(p,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('تعذر تحميل الخط أو الشعار الرسمي');return new Uint8Array(await r.arrayBuffer());}));
  return{bodyFont:base64(xs[0]),titleFont:base64(xs[1]),company:xs[2],savana:xs[3]};
}
let priorDownload:{url:string;anchor:HTMLAnchorElement}|undefined;
let priorPreview:string|undefined;
export function clearDownloads(){if(priorDownload){URL.revokeObjectURL(priorDownload.url);priorDownload.anchor.remove();priorDownload=undefined;}if(priorPreview){URL.revokeObjectURL(priorPreview);priorPreview=undefined;}}
function download(bytes:Uint8Array,type:string,name:string){if(priorDownload){URL.revokeObjectURL(priorDownload.url);priorDownload.anchor.remove();}const url=URL.createObjectURL(new Blob([bytes as BlobPart],{type}));const anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.textContent='تنزيل '+name;anchor.className='fu-download';document.body.appendChild(anchor);anchor.click();priorDownload={url,anchor};}
const uniqueSheets=(t:ExportTable)=>{const used=new Set<string>();return t.sheets.map((s,i)=>{const stem=s.name.replace(/[\[\]:*?/\\]/g,'').slice(0,27)||'تقرير';let name=stem,n=2;while(used.has(name))name=stem.slice(0,26)+' '+n++;used.add(name);return{...s,name,index:i};});};
function style(v:Cell,header:string){if(typeof v==='number')return 3;if(/التاريخ|الاستحقاق/.test(header)&&/^\d{4}-\d{2}-\d{2}$/.test(v))return 4;if(/^(ح ·|حاضر|مكتمل|تمت المراجعة)/.test(v))return 5;if(/^(غ[123]|غائب)/.test(v))return 6;if(/^(إ ·|إجازة)/.test(v))return 7;if(/غير محسوم|غير موثق|بلا تقرير|لم يرد/.test(v))return 8;return 0;}
function sheetWidth(s:ReportSection){const base=s.headers.map((h,i)=>/^\d+$/.test(h)?12:i<(s.identityColumns||0)?(h.includes('الموظف')?27:22):h.includes('الإجراء')||h.includes('ملاحظ')||h.includes('التعريف')?45:22),sum=base.reduce((a,b)=>a+b,0);return base.map(w=>w*Math.max(1,100/sum));}

// XLSX values are typed. User text is always an inline string, never a formula.
export async function excelBytes(t:ExportTable,assets?:ExportAssets):Promise<Uint8Array>{
  if(t.scope_kind!==(t.selection?.kind==='directory'?'authorized-directory':'evening'))throw Error('نطاق تصدير غير صالح');
  const a=assets||await loadExportAssets(),files:Record<string,Uint8Array>={},sheets=uniqueSheets(t);
  const xml=(path:string,value:string)=>files[path]=strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+value);
  xml('[Content_Types].xml',`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="png" ContentType="image/png"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/drawings/drawing${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`).join('')}</Types>`);
  xml('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  xml('xl/workbook.xml',`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${sheets.map((s,i)=>`<sheet name="${xmlEscape(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets><definedNames>${sheets.map((s,i)=>`<definedName name="_xlnm.Print_Titles" localSheetId="${i}">'${xmlEscape(s.name)}'!$1:$8${s.identityColumns?`, '${xmlEscape(s.name)}'!$A:$${col(s.identityColumns-1)}`:''}</definedName><definedName name="_xlnm.Print_Area" localSheetId="${i}">'${xmlEscape(s.name)}'!$A$1:$${col(s.headers.length-1)}$${s.rows.length+10}</definedName>`).join('')}</definedNames><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`);
  xml('xl/_rels/workbook.xml.rels',`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  const fills=['none','gray125','FF173859','FFF2F6FA','FFE8F6ED','FFFDECEC','FFFFF3D8','FFFFE5C7'];
  const xf=(font:number,fill:number,num=0)=>`<xf numFmtId="${num}" fontId="${font}" fillId="${fill}" borderId="1" xfId="0" applyAlignment="1" applyNumberFormat="1"><alignment horizontal="right" vertical="center" wrapText="1" readingOrder="2"/></xf>`;
  xml('xl/styles.xml',`<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Cairo"/><color rgb="FF172D46"/></font><font><b/><sz val="11"/><name val="Cairo"/><color rgb="FFFFFFFF"/></font><font><b/><sz val="16"/><name val="Cairo"/><color rgb="FF173859"/></font></fonts><fills count="${fills.length}">${fills.map((f,i)=>i<2?`<fill><patternFill patternType="${f}"/></fill>`:`<fill><patternFill patternType="solid"><fgColor rgb="${f}"/><bgColor indexed="64"/></patternFill></fill>`).join('')}</fills><borders count="2"><border/><border><left style="thin"><color rgb="FFD7E0EB"/></left><right style="thin"><color rgb="FFD7E0EB"/></right><top style="thin"><color rgb="FFD7E0EB"/></top><bottom style="thin"><color rgb="FFD7E0EB"/></bottom></border></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="9">${xf(0,0)}${xf(1,2)}${xf(2,3)}${xf(0,0,3)}${xf(0,0,164)}${xf(0,4)}${xf(0,5)}${xf(0,6)}${xf(0,7)}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
  files['xl/media/company.jpeg']=a.company;files['xl/media/savana.png']=a.savana;
  for(const [i,s] of sheets.entries()){
    const widths=sheetWidth(s),rows:Cell[][]=[[],[],['قسم المتابعة - مسائي'],[t.title+' · '+s.name],[t.scope],[`التوليد - بغداد: ${time(t.generated_at)} · ${t.reference}`],[t.source_status],s.headers,...s.rows,[s.note||t.footer],[t.legend.join(' | ')]];
    const cell=(v:Cell,row:number,j:number)=>{const st=row===8?1:row===3||row===4?2:style(v,s.headers[j]||'');const key=`${col(j)}${row}`;if(typeof v==='number')return`<c r="${key}" s="${st}"><v>${v}</v></c>`;if(st===4){const date=(Date.parse(v+'T00:00:00Z')-Date.UTC(1899,11,30))/86400000;return`<c r="${key}" s="4"><v>${date}</v></c>`;}return`<c r="${key}" s="${st}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(v)}</t></is></c>`;};
    const rowHeight=(r:Cell[],ri:number)=>ri<2?34:ri===7?42:Math.min(409,Math.max(30,...r.map((v,j)=>Math.ceil(String(v).length/Math.max(8,(r.length===1?widths.reduce((a,b)=>a+b,0):widths[j])*.85))*(ri===2||ri===3?23:15)+8)));
    const n=s.headers.length,last=col(n-1),bodyEnd=8+s.rows.length;
    const monthly=s.headers.some(h=>h==='31'||h==='30'||h==='29'||h==='28');
    const breakAt=monthly?Math.min(18,n):0;
    xml(`xl/worksheets/sheet${i+1}.xml`,`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${last}${rows.length}"/><sheetViews><sheetView workbookViewId="0" rightToLeft="1"><pane xSplit="${s.identityColumns||0}" ySplit="8" topLeftCell="${col(s.identityColumns||0)}9" activePane="bottomRight" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="30"/><cols>${widths.map((w,j)=>`<col min="${j+1}" max="${j+1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${rows.map((r,ri)=>`<row r="${ri+1}" ht="${rowHeight(r,ri)}" customHeight="1">${r.map((v,j)=>cell(v,ri+1,j)).join('')}</row>`).join('')}</sheetData>${s.rows.length?`<autoFilter ref="A8:${last}${bodyEnd}"/>`:''}<mergeCells count="7">${[3,4,5,6,7,bodyEnd+1,bodyEnd+2].map(r=>`<mergeCell ref="A${r}:${last}${r}"/>`).join('')}</mergeCells><pageMargins left="0.3" right="0.3" top="0.4" bottom="0.4" header="0.2" footer="0.2"/><pageSetup paperSize="${n>16?8:9}" orientation="landscape" fitToWidth="${monthly?0:1}" fitToHeight="0" scale="85"/><headerFooter><oddFooter>&amp;R${xmlEscape(t.reference)}&amp;Cصفحة &amp;P من &amp;N</oddFooter></headerFooter>${breakAt?`<colBreaks count="1" manualBreakCount="1"><brk id="${breakAt}" min="0" max="1048575" man="1"/></colBreaks>`:''}<drawing r:id="rIdBrand"/></worksheet>`);
    const picture=(kind:'company'|'savana',id:number,x:number,w:number)=>{const b=brandAssets[kind],[l,top,cw,ch]=b.crop,h=w*ch/cw;return`<xdr:absoluteAnchor><xdr:pos x="${Math.round(x*9525)}" y="${Math.round((86-h)/2*9525)}"/><xdr:ext cx="${Math.round(w*9525)}" cy="${Math.round(h*9525)}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${id}" name="${kind}"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId${id}"/><a:srcRect l="${Math.round(l/b.width*100000)}" t="${Math.round(top/b.height*100000)}" r="${Math.round((b.width-l-cw)/b.width*100000)}" b="${Math.round((b.height-top-ch)/b.height*100000)}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${Math.round(w*9525)}" cy="${Math.round(h*9525)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:absoluteAnchor>`;};
    const width=Math.max(700,widths.reduce((x,w)=>x+w*7,0));
    xml(`xl/drawings/drawing${i+1}.xml`,`<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${picture('savana',2,20,170)}${picture('company',1,width-235,210)}</xdr:wsDr>`);
    xml(`xl/drawings/_rels/drawing${i+1}.xml.rels`,'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/company.jpeg"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/savana.png"/></Relationships>');
    xml(`xl/worksheets/_rels/sheet${i+1}.xml.rels`,`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdBrand" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${i+1}.xml"/></Relationships>`);
  }
  return zipSync(files);
}

export async function pdfDocument(t:ExportTable,assets?:ExportAssets){
  if(t.scope_kind!==(t.selection?.kind==='directory'?'authorized-directory':'evening'))throw Error('نطاق تصدير غير صالح');
  const a=assets||await loadExportAssets(),{jsPDF}=await import('jspdf');
  const sections=t.sections.flatMap(s=>{if(s.headers.length<=20)return[s];const identity=s.identityColumns||Math.min(3,s.headers.length),size=16,parts:ReportSection[]=[];for(let from=identity;from<s.headers.length;from+=size){const indexes=[...Array.from({length:identity},(_,i)=>i),...Array.from({length:Math.min(size,s.headers.length-from)},(_,i)=>from+i)];parts.push({...s,name:`${s.name} · أعمدة ${from-identity+1} إلى ${Math.min(from-identity+size,s.headers.length-identity)}`,headers:indexes.map(i=>s.headers[i]),rows:s.rows.map(r=>indexes.map(i=>r[i])),columnWeights:s.columnWeights?indexes.map(i=>s.columnWeights![i]):undefined,note:(s.note||'')+' · أعمدة المجاميع موزعة بين المقاطع وتظهر مرة واحدة.'});}return parts;});
  const wide=sections.some(s=>s.headers.length>16);
  const doc=new jsPDF({orientation:'landscape',unit:'pt',format:wide?'a3':'a4',compress:true});
  doc.addFileToVFS('FANUArabic.ttf',a.bodyFont);doc.addFont('FANUArabic.ttf','Arabic','normal');doc.addFileToVFS('Cairo750.ttf',a.titleFont);doc.addFont('Cairo750.ttf','CairoTitle','normal');doc.setFont('Arabic');doc.setR2L(false);
  const W=doc.internal.pageSize.getWidth(),H=doc.internal.pageSize.getHeight(),margin=28;
  doc.setFontSize(7.5);const footerLegend=doc.splitTextToSize(t.legend.join(' | '),W-margin*2) as string[];
  const footerHeight=Math.max(68,footerLegend.length*10+40);
  const drawLogo=(kind:'company'|'savana',x:number,y:number,w:number)=>{const b=brandAssets[kind],[l,top,cw,ch]=b.crop,scale=w/cw,h=ch*scale;doc.saveGraphicsState();doc.rect(x,y,w,h);doc.clip();doc.discardPath();doc.addImage(a[kind],b.format,x-l*scale,y-top*scale,b.width*scale,b.height*scale,kind);doc.restoreGraphicsState();};
  const txt=(value:string,x:number,y:number,size:number,align:'right'|'center'|'left'='right')=>{doc.setFont('Arabic');doc.setFontSize(size);doc.text(value,x,y,{align});};
  let first=true;
  for(const s of sections){
    if(!first)doc.addPage();first=false;
    const fs=s.headers.length>7?9:10,line=fs*1.3;
    doc.setFont('Arabic');doc.setFontSize(fs);
    const weights=s.columnWeights||s.headers.map((h,i)=>/^\d+$/.test(h)?9:i<(s.identityColumns||0)?(h.includes('الموظف')?28:21):h.includes('الإجراء')||h.includes('الملاحظ')?32:18);
    const minimums=s.headers.map((h,i)=>Math.max(...h.split(/\s+/).map(word=>doc.getTextWidth(word)+12),h.includes('الكود')?Math.max(90,...s.rows.map(r=>doc.getTextWidth(String(r[i]||''))+12)):/التاريخ|الاستحقاق/.test(h)?80:h.includes('الموظف')&&!h.includes('أيام')?95:26));
    const rest=W-margin*2-minimums.reduce((x,y)=>x+y,0);
    const widths=weights.map((w,i)=>minimums[i]+Math.max(0,rest)*w/weights.reduce((x,y)=>x+y,0));
    const right=(i:number)=>W-margin-widths.slice(0,i).reduce((x,y)=>x+y,0);
    doc.setFontSize(9);const scopeLines=doc.splitTextToSize(t.scope.replace(/^\d{4}-\d{2}-\d{2} إلى \d{4}-\d{2}-\d{2} · /,''),W-margin*2) as string[];
    const extraScope=(scopeLines.length-1)*12;
    const tableTop=160+extraScope,headerHeight=Math.max(31,...s.headers.map((h,i)=>{doc.setFont('Arabic');doc.setFontSize(fs);return doc.splitTextToSize(h,widths[i]-10).length*line+12;}));
    const bodyTop=tableTop+headerHeight,bottom=H-footerHeight;
    const heading=()=>{
      drawLogo('savana',margin,18,130);drawLogo('company',W-margin-170,16,170);
      doc.setFont('CairoTitle');doc.setFontSize(17);doc.setTextColor(20,44,70);doc.text('قسم المتابعة - مسائي',W/2,36,{align:'center'});
      txt(t.title,W/2,58,12,'center');txt(s.name,W/2,78,11,'center');
      doc.setFont('Arabic');doc.setFontSize(9);doc.text(scopeLines,W-margin,98,{align:'right'});
      txt(`${t.selection?.start||''} / ${t.selection?.end||''}`,margin,113+extraScope,8.5,'left');txt('الفترة',W-margin,113+extraScope,8.5);
      txt(t.reference,margin,128+extraScope,8.5,'left');txt(`التوليد - بغداد: ${time(t.generated_at)}`,W-margin,128+extraScope,8.5);txt(t.source_status,W-margin,143+extraScope,8.5);
      doc.setFillColor(23,56,89);doc.rect(margin,tableTop,W-margin*2,headerHeight,'F');doc.setTextColor(255,255,255);doc.setFont('Arabic');doc.setFontSize(fs);
      s.headers.forEach((h,i)=>doc.text(doc.splitTextToSize(h,widths[i]-10),right(i)-5,tableTop+fs+6,{align:'right'}));doc.setTextColor(20,44,70);
    };
    heading();let y=bodyTop;
    const rows=s.rows.length?s.rows:[['لا توجد سجلات ضمن النطاق المحدد',...Array(s.headers.length-1).fill('')]];
    for(const r of rows){
      doc.setFont('Arabic');doc.setFontSize(fs);
      const lines=r.map((v,i)=>doc.splitTextToSize(String(v),widths[i]-10) as string[]),length=Math.max(1,...lines.map(x=>x.length));
      let offset=0;
      while(offset<length){
        const remaining=length-offset,fullHeight=Math.max(24,remaining*line+12);
        if(y+Math.min(fullHeight,bottom-bodyTop)>bottom){doc.addPage();heading();y=bodyTop;}
        const capacity=Math.max(1,Math.floor((bottom-y-12)/line)),chunk=Math.min(remaining,capacity),height=Math.max(24,chunk*line+12);
        r.forEach((v,i)=>{const st=style(v,s.headers[i]),color=st===5?[232,246,237]:st===6?[253,236,236]:st===7?[255,243,216]:st===8?[255,229,199]:[255,255,255];doc.setFillColor(color[0],color[1],color[2]);doc.setDrawColor(212,224,236);doc.rect(right(i)-widths[i],y,widths[i],height,'FD');doc.setTextColor(20,44,70);const text=offset&&i<(s.identityColumns||0)?lines[i]:lines[i].slice(offset,offset+chunk);if(text.length)doc.text(text,right(i)-5,y+fs+6,{align:'right'});});y+=height;offset+=chunk;
        if(offset<length){doc.addPage();heading();y=bodyTop;}
      }
    }
    const notes=s.note||t.footer;doc.setFontSize(8);const noteLines=doc.splitTextToSize(notes,W-margin*2) as string[];
    if(y+noteLines.length*10+12>bottom){doc.addPage();heading();y=bodyTop;}
    doc.text(noteLines,W-margin,y+16,{align:'right'});
  }
  const pageCount=doc.getNumberOfPages();
  for(let p=1;p<=pageCount;p++){doc.setPage(p);doc.setDrawColor(212,224,236);doc.line(margin,H-footerHeight+16,W-margin,H-footerHeight+16);doc.setFont('Arabic');doc.setFontSize(7.5);doc.text(footerLegend,W-margin,H-footerHeight+28,{align:'right'});txt(t.reference,W-margin,H-14,8);txt(`صفحة ${p} من ${pageCount}`,W/2,H-14,8,'center');}
  doc.setProperties({title:t.title,author:'',creator:'FANU Follow-up',subject:t.scope});
  return{doc,pageCount,bytes:new Uint8Array(doc.output('arraybuffer'))};
}
export async function pdfBytes(t:ExportTable,assets?:ExportAssets){return(await pdfDocument(t,assets)).bytes;}
export async function excel(t:ExportTable,signal?:AbortSignal){const bytes=await excelBytes(t);if(signal?.aborted)throw new DOMException('تم الإلغاء','AbortError');download(bytes,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',`${t.reference}.xlsx`);}
export async function pdf(t:ExportTable,signal?:AbortSignal){const bytes=await pdfBytes(t);if(signal?.aborted)throw new DOMException('تم الإلغاء','AbortError');download(bytes,'application/pdf',`${t.reference}.pdf`);}
export async function printPreview(t:ExportTable,signal?:AbortSignal,preparedWindow?:Window){
  const preview=preparedWindow||window.open('about:blank','_blank');if(!preview||preview.closed)throw Error('اسمح بفتح نافذة معاينة التقرير');
  preview.document.documentElement.dir='rtl';preview.document.title='معاينة التقرير';preview.document.body.textContent='جارٍ إعداد التقرير الرسمي...';
  try{const {bytes,pageCount}=await pdfDocument(t);if(signal?.aborted)throw new DOMException('تم الإلغاء','AbortError');if(priorPreview)URL.revokeObjectURL(priorPreview);const url=URL.createObjectURL(new Blob([bytes as BlobPart],{type:'application/pdf'}));priorPreview=url;
    preview.document.body.textContent='';const info=preview.document.createElement('p');info.textContent=`${t.title} · ${pageCount} صفحة · ${t.reference}`;const button=preview.document.createElement('button');button.textContent='فتح PDF للطباعة';button.onclick=()=>{preview.location.href=url;};const frame=preview.document.createElement('iframe');frame.src=url;frame.title=t.title;frame.style.cssText='width:100%;height:90vh;border:0';preview.document.body.appendChild(info);preview.document.body.appendChild(button);preview.document.body.appendChild(frame);return pageCount;
  }catch(e){preview.close();throw e;}
}
