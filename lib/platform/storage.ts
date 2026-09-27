import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
let client:S3Client|undefined;
function storage(){for(const name of ['R2_ENDPOINT','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_BUCKET_NAME'])if(!process.env[name])throw new Error(`Missing ${name}`);return client??=new S3Client({region:'auto',endpoint:process.env.R2_ENDPOINT,credentials:{accessKeyId:process.env.R2_ACCESS_KEY_ID!,secretAccessKey:process.env.R2_SECRET_ACCESS_KEY!}});}
export const bucket={
 async put(key:string,value:ArrayBuffer|Uint8Array|string,options?:{httpMetadata?:{contentType?:string}}){await storage().send(new PutObjectCommand({Bucket:process.env.R2_BUCKET_NAME,Key:key,Body:typeof value==='string'?value:Buffer.from(value instanceof ArrayBuffer?new Uint8Array(value):value),ContentType:options?.httpMetadata?.contentType}));},
 async get(key:string){try{const result=await storage().send(new GetObjectCommand({Bucket:process.env.R2_BUCKET_NAME,Key:key}));if(!result.Body)return null;const bytes=await result.Body.transformToByteArray();return {body:Buffer.from(bytes),arrayBuffer:async()=>Uint8Array.from(bytes).buffer,writeHttpMetadata(headers:Headers){if(result.ContentType)headers.set('Content-Type',result.ContentType);if(result.ETag)headers.set('ETag',result.ETag);}};}catch(error){if((error as {name?:string}).name==='NoSuchKey')return null;throw error;}},
 async delete(key:string){await storage().send(new DeleteObjectCommand({Bucket:process.env.R2_BUCKET_NAME,Key:key}));}
};
