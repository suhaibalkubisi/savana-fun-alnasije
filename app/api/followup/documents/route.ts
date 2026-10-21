import {z} from 'zod';
import {AppError,body,errorResponse,json,protectMutation,requireConfig,rpc,session} from '@/lib/server/supabase';
import {supabaseHeaders} from '@/lib/server/supabase-connection.mjs';
import {createDocumentGrant,decodeFile,DOCUMENT_LIMIT,fileDigest,PHOTO_LIMIT,safeFileName,stripJpegMetadata,THUMBNAIL_LIMIT,validateFile} from '@/lib/server/document-security.mjs';
export type PrivateDocument={id:string;employee_id:string;version:number;state:string;bucket:string;object_path:string;thumbnail_object_path?:string;file_name:string;mime_type:string;byte_size:number;uploaded_by:string;title:string;kind:string;description:string;issued_on?:string|null;expires_on?:string|null;previous_document_id?:string|null;original_sha256:string;thumbnail_sha256?:string|null;thumbnail_byte_size?:number|null;photo_crop?:{x:number;y:number;width:number;height:number}|null;crop_x?:number|null;crop_y?:number|null;crop_width?:number|null;crop_height?:number|null};
const upload=z.object({operation:z.literal('upload'),request_id:z.string().uuid(),employee_id:z.string().uuid(),title:z.string().trim().min(1).max(200),kind:z.enum(['photo','general','identity','qualification','action']),file_name:z.string().max(200),mime_type:z.enum(['image/jpeg','image/png','application/pdf']),content_base64:z.string(),thumbnail_base64:z.string().optional(),description:z.string().max(2000).optional(),issued_on:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),expires_on:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),previous_document_id:z.string().uuid().optional(),photo_crop:z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1),width:z.number().positive().max(1),height:z.number().positive().max(1)}).optional()});
const archive=z.object({operation:z.literal('archive'),request_id:z.string().uuid(),id:z.string().uuid(),version:z.number().int().positive(),reason:z.string().trim().min(3).max(1000)});
const resumeUpload=upload.extend({resume_document_id:z.string().uuid().optional()});
const abandon=archive.extend({operation:z.literal('abandon')});
const cleanup=z.object({operation:z.literal('cleanup'),request_id:z.string().uuid(),id:z.string().uuid()});
const schema=z.discriminatedUnion('operation',[resumeUpload,archive,abandon,cleanup]);
function canonical(value:unknown):string {if(value===null||value===undefined)return 'null';if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>JSON.stringify(key)+':'+canonical(item)).join(',')+'}';return JSON.stringify(value);}
function objectTarget(doc:PrivateDocument,path:string,authenticated=false){
 const c=requireConfig();return `${c.url}/storage/v1/object/${authenticated?'authenticated/':''}${encodeURIComponent(doc.bucket)}/${path.split('/').map(encodeURIComponent).join('/')}`;
}
async function probeStoredObject(doc:PrivateDocument,path:string,bytes:Uint8Array,token:string):Promise<{match:boolean;mismatch:boolean;status:number}>{
 let response:Response;try{response=await fetch(objectTarget(doc,path,true),{headers:supabaseHeaders(requireConfig(),{token}),cache:'no-store',signal:AbortSignal.timeout(30000)});}catch{return {match:false,mismatch:false,status:503};}
 if(!response.ok||!response.body)return {match:false,mismatch:false,status:response.status};
 const reader=response.body.getReader(),stored=new Uint8Array(bytes.length);let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;if(size+value.length>bytes.length){await reader.cancel();return {match:false,mismatch:true,status:409};}stored.set(value,size);size+=value.length;}}
 catch{return {match:false,mismatch:false,status:503};}
 finally{reader.releaseLock();}
 const match=size===bytes.length&&await fileDigest(stored)===await fileDigest(bytes);
 return {match,mismatch:!match,status:match?200:409};
}
async function verifyStoredObject(doc:PrivateDocument,path:string,bytes:Uint8Array,token:string){
 const result=await probeStoredObject(doc,path,bytes,token);
 if(result.match)return;
 if(result.mismatch)throw new AppError('بصمة الملف المحفوظ لا تطابق الملف المرسل. لا يجوز استبدال الأصل.',409);
 throw new AppError('تعذر التحقق من الملف الخاص. أعد المحاولة بنفس الطلب.',result.status===403?403:503);
}
async function storeObject(doc:PrivateDocument,path:string,bytes:Uint8Array,mime:string,token:string){
 const headers=supabaseHeaders(requireConfig(),{token});headers.set('Content-Type',mime);headers.set('Cache-Control','private, no-store');headers.set('x-upsert','false');
 let response:Response|undefined;
 try{response=await fetch(objectTarget(doc,path),{method:'POST',headers,body:bytes as BodyInit,signal:AbortSignal.timeout(30000)});}catch{/* The object may have committed before the response was lost. */}
 if(response?.ok)return;
 const existing=await probeStoredObject(doc,path,bytes,token);
 if(existing.match)return;
 if(existing.mismatch)throw new AppError('يوجد ملف مختلف في المسار المحفوظ. لا يجوز استبدال الأصل.',409);
 throw new AppError('تعذر رفع الملف الخاص. أعد المحاولة بنفس الطلب.',response?.status===403||existing.status===403?403:503);
}
export async function GET(request:Request){try{
 const s=await session(),p=new URL(request.url).searchParams,id=z.string().uuid().parse(p.get('id'));
 const doc=await rpc<PrivateDocument>('followup_read',{p_kind:'document',p_filters:{id}},s.token);
 if(!['active','archived'].includes(doc.state))throw new AppError('المستند غير متاح',404);
 const variant=p.get('thumbnail')==='1'?'thumbnail':'original';if(variant==='thumbnail'&&!doc.thumbnail_object_path)throw new AppError('لا توجد صورة مصغرة',404);
 const grant=await createDocumentGrant(requireConfig().secretKey,s.profile.id,id,variant);
 return json({url:'/api/followup/documents/content?'+new URLSearchParams({id,variant,expires:String(grant.expires),signature:grant.signature}),expires_in:60});
 }catch(e){return errorResponse(e);}}
export async function POST(request:Request){try{
 protectMutation(request);const s=await session(),p=schema.parse(await body(request,15*1024*1024));
 if(p.operation==='archive')return json(await rpc('followup_write',{p_kind:'document_archive',p_data:{id:p.id,version:p.version,reason:p.reason},p_request_id:p.request_id},s.token));
 if(p.operation==='abandon'||p.operation==='cleanup'){
  const doc=p.operation==='abandon'?await rpc<PrivateDocument>('followup_write',{p_kind:'document_abandon',p_data:{id:p.id,version:p.version,reason:p.reason},p_request_id:p.request_id},s.token):await rpc<PrivateDocument>('followup_read',{p_kind:'document',p_filters:{id:p.id}},s.token);
  if(doc.state!=='abandoned'||doc.uploaded_by!==s.profile.id)throw new AppError('تنظيف الرفع الملغى متاح لمن بدأه فقط',403);
  const c=requireConfig(),response=await fetch(`${c.url}/storage/v1/object/${encodeURIComponent(doc.bucket)}`,{method:'DELETE',headers:supabaseHeaders(c,{token:s.token}),body:JSON.stringify({prefixes:[doc.object_path,...(doc.thumbnail_object_path?[doc.thumbnail_object_path]:[])]}),signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new AppError('تم إلغاء الرفع وحفظ السجل؛ تنظيف الملفات لم يكتمل. أعد المحاولة بالطلب نفسه',503);
  return json({...doc,cleanup_complete:true});
 }
 const original=decodeFile(p.content_base64,p.kind==='photo'?PHOTO_LIMIT:DOCUMENT_LIMIT);validateFile(original,p.mime_type,{photo:p.kind==='photo'});
 let thumbnail:Uint8Array|undefined;
 if(p.kind==='photo'){if(!p.thumbnail_base64)throw new AppError('أعد اختيار الصورة وإنشاء المعاينة المصغرة');const candidate=decodeFile(p.thumbnail_base64,THUMBNAIL_LIMIT);validateFile(candidate,'image/jpeg',{thumbnail:true});thumbnail=stripJpegMetadata(candidate);}
 if(p.photo_crop&&(p.photo_crop.x+p.photo_crop.width>1.001||p.photo_crop.y+p.photo_crop.height>1.001))throw new AppError('إطار قص الصورة غير صالح');
 const metadata={employee_id:p.employee_id,title:p.title,kind:p.kind,file_name:safeFileName(p.file_name,p.mime_type),mime_type:p.mime_type,byte_size:original.length,description:p.description||'',issued_on:p.issued_on||null,expires_on:p.expires_on||null,previous_document_id:p.previous_document_id||null,photo_crop:p.photo_crop||null,original_sha256:await fileDigest(original),...(thumbnail?{thumbnail_byte_size:thumbnail.length,thumbnail_sha256:await fileDigest(thumbnail)}:{})};
 let doc:PrivateDocument;
 if(p.resume_document_id)doc=await rpc<PrivateDocument>('followup_read',{p_kind:'document',p_filters:{id:p.resume_document_id}},s.token);
 else{
  const receipt=await rpc<PrivateDocument>('followup_write',{p_kind:'document',p_data:metadata,p_request_id:p.request_id},s.token);
  doc=await rpc<PrivateDocument>('followup_read',{p_kind:'document',p_filters:{id:receipt.id}},s.token);
 }
 if(doc.uploaded_by!==s.profile.id)throw new AppError('الاستئناف متاح فقط لمن رفع الملف.',403);
 const saved:Record<string,unknown>={...doc,photo_crop:doc.crop_x==null?null:{x:Number(doc.crop_x),y:Number(doc.crop_y),width:Number(doc.crop_width),height:Number(doc.crop_height)}};
 if(Object.entries(metadata).some(([key,value])=>canonical(saved[key])!==canonical(value)))throw new AppError('الملف أو بياناته لا تطابق محاولة الرفع الأصلية. احتفظ بالطلب الأصلي أو ابدأ محاولة مستقلة.',409);
 if(doc.state==='active'){
  await verifyStoredObject(doc,doc.object_path,original,s.token);
  if(thumbnail){if(!doc.thumbnail_object_path)throw new AppError('مسار الصورة المصغرة غير متاح.',503);await verifyStoredObject(doc,doc.thumbnail_object_path,thumbnail,s.token);}
  return json(doc);
 }
 if(doc.state!=='pending')throw new AppError('حالة المستمسك تغيرت. أعد التحميل قبل المتابعة.',409);
 await storeObject(doc,doc.object_path,original,p.mime_type,s.token);
 if(thumbnail){if(!doc.thumbnail_object_path)throw new AppError('مسار الصورة المصغرة غير مهيأ',503);await storeObject(doc,doc.thumbnail_object_path,thumbnail,'image/jpeg',s.token);}
 const result=await rpc('followup_write',{p_kind:'document_activate',p_data:{id:doc.id,version:doc.version},p_request_id:doc.id},s.token);return json(result);
 }catch(e){return errorResponse(e instanceof Error&&!(e instanceof AppError)&&/^[\u0600-\u06ff]/.test(e.message)?new AppError(e.message):e);}}
