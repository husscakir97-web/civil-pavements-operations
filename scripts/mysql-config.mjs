import mysql from 'mysql2/promise';
export function required(name){const value=process.env[name];if(!value)throw new Error(`Set ${name} in the environment`);return value;}
export function mysqlOptions(){return {host:required('MYSQL_HOST'),port:Number(process.env.MYSQL_PORT||3306),database:required('MYSQL_DATABASE'),user:required('MYSQL_USER'),password:required('MYSQL_PASSWORD'),charset:'utf8mb4',decimalNumbers:true,ssl:process.env.MYSQL_SSL_CA?{ca:process.env.MYSQL_SSL_CA,rejectUnauthorized:true}:undefined};}
export async function connect(){return mysql.createConnection(mysqlOptions());}
export function identifier(name){if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))throw new Error(`Unsupported identifier: ${name}`);return '`'+name+'`';}
