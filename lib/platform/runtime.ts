// Node services, created lazily so production builds need no database or R2 access.
import {database} from './database';
import {bucket} from './storage';
export const env={DB:database,BUCKET:bucket,get OPENAI_API_KEY(){return process.env.OPENAI_API_KEY},get OPENAI_DOCUMENT_MODEL(){return process.env.OPENAI_DOCUMENT_MODEL}};
