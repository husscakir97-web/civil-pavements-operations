import {defineConfig} from 'drizzle-kit';
export default defineConfig({out:'./migrations/mysql',schema:['./db/schema.ts','./db/schema-v1.ts','./db/auth-schema.ts'],dialect:'mysql'});
