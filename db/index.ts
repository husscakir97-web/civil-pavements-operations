import { drizzle } from 'drizzle-orm/mysql2';
import { getPool } from '@/lib/platform/database';
import * as legacy from './schema';
import * as v1 from './schema-v1';
const schema={...legacy,...v1};
export function getDb(){return drizzle(getPool(),{schema,mode:'default'});}
