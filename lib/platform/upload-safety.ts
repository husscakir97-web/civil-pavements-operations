// Shared upload/download safety rules for files that originate from users. Pure (no I/O) so legacy routes and the
// SQLite regression harness can use it. The allowlist is the one the shared document service already enforces
// (lib/platform/documents.ts imports it from here). HTML, SVG, XML and script files are never on it.
// The client-supplied extension, the client-declared MIME type and the file's own bytes are three separate claims; a file
// is accepted only when the extension is allowed AND the bytes agree with it. Anything uncertain is served as a download.

export const ALLOWED_UPLOAD_NAME=/\.(pdf|png|jpe?g|gif|webp|heic|txt|csv|docx?|xlsx?|pptx?|zip|msg|eml|dwg|dxf)$/i;
/** Tender attachments: the shared allowlist plus the raster scan formats the tender picker and local OCR reader support. */
export const TENDER_UPLOAD_NAME=/\.(pdf|png|jpe?g|gif|webp|heic|tiff?|bmp|txt|csv|docx?|xlsx?|pptx?|zip|msg|eml|dwg|dxf)$/i;
/** Docket source documents: the formats the docket intake offers (PDF and photos). */
export const DOCKET_UPLOAD_NAME=/\.(pdf|png|jpe?g|webp)$/i;
export const UNSUPPORTED_TYPE_MESSAGE='This file type is not accepted. Use PDF, image, Office, CSV, text or ZIP files.';

export const extensionOf=(name:string)=>/\.([a-z0-9]+)$/i.exec(String(name||''))?.[1].toLowerCase()??'';

/** Fixed mapping by extension. Never derived from a stored or client-declared type. Unknown/active types fall back to octet-stream. */
const SAFE_TYPE:Record<string,string>={
 pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',heic:'image/heic',
 txt:'text/plain; charset=utf-8',csv:'text/csv; charset=utf-8',
 doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
 xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
 ppt:'application/vnd.ms-powerpoint',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',
 tif:'image/tiff',tiff:'image/tiff',bmp:'image/bmp',
 zip:'application/zip',msg:'application/vnd.ms-outlook',eml:'message/rfc822',
};
export const FALLBACK_TYPE='application/octet-stream';
export const safeContentType=(name:string)=>SAFE_TYPE[extensionOf(name)]??FALLBACK_TYPE;

const at=(b:Uint8Array,offset:number,sig:number[])=>b.length>=offset+sig.length&&sig.every((v,i)=>b[offset+i]===v);
const ascii=(s:string)=>[...s].map(c=>c.charCodeAt(0));
const OLE=[0xD0,0xCF,0x11,0xE0,0xA1,0xB1,0x1A,0xE1];
const isZip=(b:Uint8Array)=>at(b,0,[0x50,0x4B,0x03,0x04])||at(b,0,[0x50,0x4B,0x05,0x06]);
const isPdf=(b:Uint8Array)=>{const head=b.subarray(0,1024);for(let i=0;i+5<=head.length;i++)if(at(head,i,ascii('%PDF-')))return true;return false;};
const isPng=(b:Uint8Array)=>at(b,0,[0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]);
const isJpeg=(b:Uint8Array)=>at(b,0,[0xFF,0xD8,0xFF]);
const isGif=(b:Uint8Array)=>at(b,0,ascii('GIF87a'))||at(b,0,ascii('GIF89a'));
const isWebp=(b:Uint8Array)=>at(b,0,ascii('RIFF'))&&at(b,8,ascii('WEBP'));
const isHeic=(b:Uint8Array)=>at(b,4,ascii('ftyp'));
const isTiff=(b:Uint8Array)=>at(b,0,[0x49,0x49,0x2A,0x00])||at(b,0,[0x4D,0x4D,0x00,0x2A]);
// BMP: 'BM', then the DIB header size at offset 14 must be a known header version (rejects arbitrary text starting with "BM").
const isBmp=(b:Uint8Array)=>at(b,0,ascii('BM'))&&b.length>=18&&[12,40,52,56,64,108,124].includes(b[14]|(b[15]<<8)|(b[16]<<16)|(b[17]<<24));
const isOleOrZipOrRtf=(b:Uint8Array)=>at(b,0,OLE)||isZip(b)||at(b,0,ascii('{\\rtf'));
/** File signatures for the formats with a fixed binary header. Formats without one (txt, csv, eml, msg, dwg, dxf) are checked for markup instead. */
const SIGNATURE:Record<string,(b:Uint8Array)=>boolean>={
 pdf:isPdf,png:isPng,jpg:isJpeg,jpeg:isJpeg,gif:isGif,webp:isWebp,heic:isHeic,tif:isTiff,tiff:isTiff,bmp:isBmp,
 zip:isZip,docx:isZip,xlsx:isZip,pptx:isZip,doc:isOleOrZipOrRtf,xls:isOleOrZipOrRtf,ppt:isOleOrZipOrRtf,
};

const MARKUP=/^(?:<!doctype\s+html|<html|<head|<body|<script|<svg|<iframe|<object|<embed|<meta|<link|<style|<base|<form|<math|<\?xml|<!--|<xml|<!entity)/i;
/** True when the content opens like HTML/SVG/XML (after an optional BOM and whitespace): active content that must never be accepted or shown. */
export function looksLikeMarkup(bytes:Uint8Array){
 let i=0;if(at(bytes,0,[0xEF,0xBB,0xBF]))i=3;else if(at(bytes,0,[0xFF,0xFE])||at(bytes,0,[0xFE,0xFF]))return true; // UTF-16 text is not a supported upload
 while(i<bytes.length&&i<4096&&(bytes[i]===0x20||bytes[i]===0x09||bytes[i]===0x0A||bytes[i]===0x0D||bytes[i]===0x00))i++;
 const head=new TextDecoder('latin1').decode(bytes.subarray(i,i+64));
 return MARKUP.test(head);
}

export type UploadVerdict={ok:true;contentType:string}|{ok:false;status:415;reason:string};
/** Accept only an allowed extension whose bytes agree with it. The returned contentType is the fixed safe mapping, not the client's. */
export function checkUpload(name:string,bytes:Uint8Array,allowed:RegExp=ALLOWED_UPLOAD_NAME):UploadVerdict{
 if(!allowed.test(String(name||'')))return {ok:false,status:415,reason:allowed===DOCKET_UPLOAD_NAME?'Upload a PDF, JPG, PNG or WebP file.':UNSUPPORTED_TYPE_MESSAGE};
 const ext=extensionOf(name),sig=SIGNATURE[ext];
 if(sig){if(!sig(bytes))return {ok:false,status:415,reason:`The file contents do not match a .${ext} file.`};}
 else if(looksLikeMarkup(bytes))return {ok:false,status:415,reason:'Web pages, SVG and XML files are not accepted.'};
 return {ok:true,contentType:safeContentType(name)};
}

const INLINE_MIME:Record<string,string[]>={pdf:['application/pdf'],png:['image/png'],jpg:['image/jpeg','image/jpg'],jpeg:['image/jpeg','image/jpg'],webp:['image/webp'],gif:['image/gif']};
/**
 * The content type a stored file may be shown INLINE with, or null (serve as a download). All three claims must agree:
 * the extension is a safe preview format, the stored/declared MIME is the matching type, and the bytes carry the matching signature.
 */
export function inlinePreviewType(name:string,declaredType:string|null|undefined,bytes:Uint8Array):string|null{
 const ext=extensionOf(name),expected=INLINE_MIME[ext];if(!expected)return null;
 const declared=String(declaredType||'').split(';')[0].trim().toLowerCase();
 if(!expected.includes(declared))return null;
 const sig=SIGNATURE[ext];if(!sig||!sig(bytes))return null;
 return SAFE_TYPE[ext]??null;
}

/**
 * Same-origin preview of a tender PDF in the review viewer. Only a file whose extension is .pdf AND whose bytes carry a PDF
 * signature may be shown inline (always as application/pdf); everything else stays a download. Images need no inline mode:
 * <img> renders them from the attachment response.
 */
export const previewablePdf=(name:string,bytes:Uint8Array)=>extensionOf(name)==='pdf'&&isPdf(bytes);
export const inlinePdfHeaders=(name:string):Record<string,string>=>({'Content-Type':'application/pdf','Content-Disposition':`inline; filename*=UTF-8''${encodeFilename(name)}`,'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store'});

/** RFC 5987 filename*= encoding (encodeURIComponent leaves ' ( ) * unescaped). */
export const encodeFilename=(name:string)=>encodeURIComponent(String(name||'file')).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
export const attachmentHeaders=(name:string,contentType:string):Record<string,string>=>({'Content-Type':contentType,'Content-Disposition':`attachment; filename*=UTF-8''${encodeFilename(name)}`,'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store'});

/** Reads a stored object's bytes whatever the storage adapter returns (Buffer, ArrayBuffer, typed array, stream, or arrayBuffer()). */
export async function objectBytes(object:{body?:unknown;arrayBuffer?:()=>Promise<ArrayBuffer>}):Promise<Uint8Array>{
 const body=object.body as unknown;
 if(body instanceof Uint8Array)return body;
 if(body instanceof ArrayBuffer)return new Uint8Array(body);
 if(typeof object.arrayBuffer==='function')return new Uint8Array(await object.arrayBuffer());
 return new Uint8Array(await new Response(body as BodyInit).arrayBuffer());
}
