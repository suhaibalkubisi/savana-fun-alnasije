import {z} from 'zod';
import {AppError,errorResponse,requireConfig,rpc,session} from '@/lib/server/supabase';
import {supabaseHeaders} from '@/lib/server/supabase-connection.mjs';
import {verifiedStoredFile,verifyDocumentGrant} from '@/lib/server/document-security.mjs';
import type {PrivateDocument} from '../route';
export async function GET(request:Request){try{
 const s=await session(),p=new URL(request.url).searchParams,id=z.string().uuid().parse(p.get('id')),variant=p.get('variant')||'original',expires=Number(p.get('expires')),signature=p.get('signature')||'',c=requireConfig();
 if(!await verifyDocumentGrant(c.secretKey,s.profile.id,id,variant,expires,signature))throw new AppError('انتهت صلاحية الرابط أو أنه غير صالح. افتح المستند مجدداً',410);
 // Re-check account revocation, department and sensitive-document grants for every read.
 const doc=await rpc<PrivateDocument>('followup_read',{p_kind:'document',p_filters:{id}},s.token);if(!['active','archived'].includes(doc.state))throw new AppError('المستند غير متاح',404);
 const path=variant==='thumbnail'?doc.thumbnail_object_path:doc.object_path;if(!path)throw new AppError('المستند غير متاح',404);
 const upstream=await fetch(`${c.url}/storage/v1/object/authenticated/${encodeURIComponent(doc.bucket)}/${path.split('/').map(encodeURIComponent).join('/')}`,{headers:supabaseHeaders(c,{token:s.token}),cache:'no-store',signal:AbortSignal.timeout(30000)});
 if(!upstream.ok)throw new AppError('المستند غير متاح ضمن صلاحيتك',upstream.status===403?403:404);
 let bytes:Uint8Array;try{bytes=await verifiedStoredFile(upstream,doc,variant);}catch{throw new AppError('تعذر التحقق من سلامة المستمسك. راجع مسؤول النظام',422);}
 const headers=new Headers({'Content-Type':variant==='thumbnail'?'image/jpeg':doc.mime_type,'Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; sandbox"});
 headers.set('Content-Disposition',`inline; filename="document${doc.mime_type==='application/pdf'?'.pdf':'.jpg'}"; filename*=UTF-8''${encodeURIComponent(doc.file_name)}`);
 return new Response(bytes as BodyInit,{headers});
 }catch(e){return errorResponse(e);}}
