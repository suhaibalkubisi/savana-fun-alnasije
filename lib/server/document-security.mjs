// Pure validation shared by the Worker upload route and isolated security tests.
export const PHOTO_LIMIT=5*1024*1024;
export const DOCUMENT_LIMIT=10*1024*1024;
export const THUMBNAIL_LIMIT=180*1024;
export function decodeFile(encoded,limit){
 if(typeof encoded!=='string'||!encoded.length||encoded.length>Math.ceil(limit/3)*4+4||encoded.length%4!==0||/[^A-Za-z0-9+/=]/.test(encoded))throw Error('محتوى الملف غير صالح أو أكبر من المسموح');
 const padding=encoded.indexOf('=');if(padding!==-1&&!(padding===encoded.length-1||padding===encoded.length-2&&encoded.endsWith('==')))throw Error('محتوى الملف غير صالح');
 const binary=atob(encoded),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
 if(bytes.length>limit||!bytes.length)throw Error('حجم الملف أكبر من المسموح');return bytes;
}
const u32=(b,o)=>new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(o);
function jpegInfo(bytes){
 if(bytes.length<12||bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)throw Error('توقيع صورة JPEG غير صالح');
 let p=2,dimensions;
 while(p<bytes.length-2){if(bytes[p++]!==255)throw Error('بنية JPEG غير صالحة');while(bytes[p]===255)p++;const marker=bytes[p++];
  if(marker===217)break;if(marker===218){if(!dimensions)throw Error('أبعاد JPEG غير موجودة');return dimensions;}
  if(marker===1||(marker>=208&&marker<=215))continue;if(p+2>bytes.length)throw Error('بنية JPEG غير صالحة');const length=bytes[p]*256+bytes[p+1];
  if(length<2||p+length>bytes.length)throw Error('بنية JPEG غير صالحة');
  if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){if(length<8)throw Error('بنية JPEG غير صالحة');dimensions={width:bytes[p+5]*256+bytes[p+6],height:bytes[p+3]*256+bytes[p+4]};}
  p+=length;
 }throw Error('بيانات صورة JPEG غير مكتملة');
}
function pngInfo(bytes){
 const signature=[137,80,78,71,13,10,26,10];if(signature.some((v,i)=>bytes[i]!==v)||bytes.length<45)throw Error('توقيع صورة PNG غير صالح');
 let p=8,dimensions,hasData=false;
 while(p+12<=bytes.length){const size=u32(bytes,p),type=String.fromCharCode(...bytes.slice(p+4,p+8));if(p+12+size>bytes.length)throw Error('بنية PNG غير صالحة');
  if(p===8){if(type!=='IHDR'||size!==13)throw Error('بنية PNG غير صالحة');dimensions={width:u32(bytes,p+8),height:u32(bytes,p+12)};}
  if(type==='IDAT')hasData=true;if(type==='acTL')throw Error('استخدم صورة ثابتة بصيغة PNG أو JPEG');
  p+=12+size;if(type==='IEND'){if(size!==0||p!==bytes.length||!hasData||!dimensions)throw Error('بنية PNG غير مكتملة');return dimensions;}
 }throw Error('بنية PNG غير مكتملة');
}
export function validateFile(bytes,mime,{photo=false,thumbnail=false}={}){
 const limit=thumbnail?THUMBNAIL_LIMIT:photo?PHOTO_LIMIT:DOCUMENT_LIMIT;if(bytes.length>limit)throw Error('حجم الملف أكبر من المسموح');
 let dimensions;
 if(mime==='image/jpeg')dimensions=jpegInfo(bytes);else if(mime==='image/png')dimensions=pngInfo(bytes);else if(mime==='application/pdf'&&!photo&&!thumbnail){
  const head=new TextDecoder().decode(bytes.slice(0,16)),tail=new TextDecoder().decode(bytes.slice(-1024));
  if(!/^%PDF-(1\.[0-7]|2\.0)/.test(head)||!tail.includes('%%EOF'))throw Error('توقيع ملف PDF غير صالح');
  // This rejects visible active-action markers; it is not malware scanning.
  const content=new TextDecoder('latin1').decode(bytes);
  if(/\/(JavaScript|JS|Launch|RichMedia|EmbeddedFile|XFA)\b/.test(content))throw Error('ملف PDF يحتوي محتوى نشطاً غير مسموح');return {mime};
 }else throw Error('الصيغ المسموحة: PDF وJPEG وPNG؛ الصورة بصيغة JPEG أو PNG');
 if(!dimensions.width||!dimensions.height||dimensions.width>8000||dimensions.height>8000||dimensions.width*dimensions.height>24000000)throw Error('أبعاد الصورة أكبر من المسموح');
 if(thumbnail&&(mime!=='image/jpeg'||dimensions.width>320||dimensions.height>320))throw Error('الصورة المصغرة يجب أن تكون JPEG وبأبعاد لا تتجاوز 320');
 return {mime,...dimensions};
}
export function stripJpegMetadata(bytes){
 jpegInfo(bytes);const parts=[bytes.slice(0,2)];let p=2;
 while(p<bytes.length){const start=p;p++;while(bytes[p]===255)p++;const marker=bytes[p++];
  if(marker===218||marker===217){parts.push(bytes.slice(start));break;}
  if(marker===1||(marker>=208&&marker<=215)){parts.push(bytes.slice(start,p));continue;}
  const length=bytes[p]*256+bytes[p+1];p+=length;
  if(!(marker>=225&&marker<=239)&&marker!==254)parts.push(bytes.slice(start,p));
 }
 const result=new Uint8Array(parts.reduce((n,b)=>n+b.length,0));let offset=0;for(const part of parts){result.set(part,offset);offset+=part.length;}return result;
}
export function safeFileName(name,mime){
 const extension=mime==='application/pdf'?'.pdf':mime==='image/png'?'.png':'.jpg';
 const stem=String(name??'document').replace(/\.[^.]*$/,'').replace(/[\u0000-\u001f\u007f\\/<>:"|?*\u202a-\u202e]/g,'_').trim().slice(0,100)||'document';return stem+extension;
}
export async function fileDigest(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');}
export async function verifiedStoredFile(response,doc,variant='original'){
 const thumbnail=variant==='thumbnail',limit=thumbnail?THUMBNAIL_LIMIT:doc.kind==='photo'?PHOTO_LIMIT:DOCUMENT_LIMIT;
 const expectedSize=thumbnail?doc.thumbnail_byte_size:doc.byte_size,expectedHash=thumbnail?doc.thumbnail_sha256:doc.original_sha256;
 if(!Number.isInteger(expectedSize)||expectedSize<1||expectedSize>limit||!/^[a-f0-9]{64}$/.test(expectedHash||'')||!response.body)throw Error('تعذر التحقق من سلامة المستمسك');
 const reader=response.body.getReader(),parts=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>expectedSize||size>limit){await reader.cancel();throw Error('حجم المستمسك لا يطابق السجل');}parts.push(value);}}finally{reader.releaseLock();}
 if(size!==expectedSize)throw Error('حجم المستمسك لا يطابق السجل');
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
 validateFile(bytes,thumbnail?'image/jpeg':doc.mime_type,{photo:doc.kind==='photo',thumbnail});
 if(await fileDigest(bytes)!==expectedHash)throw Error('بصمة المستمسك لا تطابق السجل');return bytes;
}
const grantMessage=(user,document,variant,expires)=>new TextEncoder().encode(`${user}\n${document}\n${variant}\n${expires}`);
async function signingKey(secret){if(typeof secret!=='string'||secret.length<24)throw Error('توقيع المستندات غير مهيأ');return crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
export async function createDocumentGrant(secret,user,document,variant='original',now=Date.now()){
 const expires=Math.floor(now/1000)+60,key=await signingKey(secret),signature=new Uint8Array(await crypto.subtle.sign('HMAC',key,grantMessage(user,document,variant,expires)));
 return {expires,signature:Array.from(signature,b=>b.toString(16).padStart(2,'0')).join('')};
}
export async function verifyDocumentGrant(secret,user,document,variant,expires,signature,now=Date.now()){
 const seconds=Math.floor(now/1000);if(!Number.isInteger(expires)||expires<=seconds||expires>seconds+60||!['original','thumbnail'].includes(variant)||!/^[a-f0-9]{64}$/.test(signature))return false;
 const bytes=Uint8Array.from(signature.match(/../g),x=>parseInt(x,16));return crypto.subtle.verify('HMAC',await signingKey(secret),bytes,grantMessage(user,document,variant,expires));
}
