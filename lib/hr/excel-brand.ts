import { brandAssets } from './brand';
import { strToU8 } from 'fflate';

export type ExcelBrands = {company: Uint8Array; savana: Uint8Array};
export async function loadExcelBrands(): Promise<ExcelBrands> {
  const load = async (kind: 'company' | 'savana') => {
    const response = await fetch(brandAssets[kind].src, {signal: AbortSignal.timeout(15000)});
    if (!response.ok) throw new Error('تعذر تحميل شعار التقرير؛ أعد المحاولة');
    return new Uint8Array(await response.arrayBuffer());
  };
  const [company, savana] = await Promise.all([load('company'),load('savana')]);
  return {company,savana};
}

// Embed the original files. Drawing crop coordinates only control their presentation.
export function addExcelBrands(files: Record<string,Uint8Array>, brands: ExcelBrands, sheetWidth: number) {
  const xml=(path:string,content:string)=>{files[path]=strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${content}`);};
  files['xl/media/company.jpeg']=brands.company; files['xl/media/savana.png']=brands.savana;
  const picture=(kind:'company'|'savana',id:number,x:number,w:number)=>{
    const a=brandAssets[kind], [l,t,cw,ch]=a.crop, h=w*ch/cw;
    const crop=`l="${Math.round(l/a.width*100000)}" t="${Math.round(t/a.height*100000)}" r="${Math.round((a.width-l-cw)/a.width*100000)}" b="${Math.round((a.height-t-ch)/a.height*100000)}"`;
    return `<xdr:absoluteAnchor><xdr:pos x="${Math.round(x*9525)}" y="${Math.round((86-h)/2*9525)}"/><xdr:ext cx="${Math.round(w*9525)}" cy="${Math.round(h*9525)}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${id}" name="${kind}" descr="Original ${kind} logo"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId${id}"/><a:srcRect ${crop}/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${Math.round(w*9525)}" cy="${Math.round(h*9525)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:absoluteAnchor>`;
  };
  xml('xl/drawings/drawing1.xml',`<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${picture('savana',2,20,170)}${picture('company',1,Math.max(250,sheetWidth-235),210)}</xdr:wsDr>`);
  xml('xl/drawings/_rels/drawing1.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/company.jpeg"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/savana.png"/></Relationships>');
  xml('xl/worksheets/_rels/sheet1.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdBrand" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>');
}
