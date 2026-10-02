// Recovery check for interrupted `ALTER TABLE ... MODIFY` steps. MODIFY is not
// recognised by the generic object checks, so each supported statement is listed here
// with the exact column definition expected BEFORE and AFTER it. The live definition is
// read from information_schema and compared: "after" means the DDL already ran, "before"
// means it did not, anything else is refused rather than guessed at.
const SUPPORTED=new Map([
 ['asset_meter_readings.next_service',{before:{type:'decimal(15,2)',nullable:false},after:{type:'decimal(15,2)',nullable:true}}],
]);
const MODIFY=/^ALTER TABLE `([^`]+)` MODIFY(?: COLUMN)? `([^`]+)` ([a-z]+(?:\(\d+(?:,\d+)?\))?) (NOT NULL|NULL);?$/i;
export function parseModify(sql){
 const match=sql.match(MODIFY);if(!match)return null;
 return {table:match[1],column:match[2],type:match[3].toLowerCase(),nullable:match[4].toUpperCase()==='NULL'};
}
const describe=c=>`${c.type} ${c.nullable?'NULL':'NOT NULL'}`;
// Returns null when the statement is not a supported MODIFY, true when the column already
// has the target definition (skip the DDL), false when it still has the original one
// (run it). Throws on any other state, before anything is changed.
export async function modifyColumnState(db,sql){
 const parsed=parseModify(sql);if(!parsed)return null;
 const key=`${parsed.table}.${parsed.column}`,rule=SUPPORTED.get(key);
 if(!rule||rule.after.type!==parsed.type||rule.after.nullable!==parsed.nullable)return null;
 const [rows]=await db.execute('SELECT COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',[parsed.table,parsed.column]);
 if(!rows.length)throw new Error(`Unexpected schema for ${key}: column not found; manual database recovery required, nothing was changed`);
 const actual={type:String(rows[0].COLUMN_TYPE).toLowerCase(),nullable:rows[0].IS_NULLABLE==='YES'};
 // MariaDB reports the default of a nullable column as the text 'NULL'; MySQL as SQL NULL.
 const noDefault=rows[0].COLUMN_DEFAULT===null||(actual.nullable&&String(rows[0].COLUMN_DEFAULT).toUpperCase()==='NULL');
 const plain=noDefault&&!rows[0].EXTRA;
 const same=(a,b)=>a.type===b.type&&a.nullable===b.nullable;
 if(plain&&same(actual,rule.after))return true;
 if(plain&&same(actual,rule.before))return false;
 throw new Error(`Unexpected schema for ${key}: found ${describe(actual)}${plain?'':' with a default or extra attributes'}, expected ${describe(rule.before)} (not yet applied) or ${describe(rule.after)} (applied); manual database recovery required, nothing was changed`);
}
