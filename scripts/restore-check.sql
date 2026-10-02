-- READ-ONLY restore validation. Returns counts and integrity results only: no row data, no credentials.
-- Run the WHOLE script in phpMyAdmin (SQL tab) with the u840559204_infra_test database selected, then again with
-- u840559204_restorecheck selected, and compare. Nothing here writes, and the temporary SQL is session-only.
SET SESSION group_concat_max_len = 1000000;

-- 1. Structure (restore integrity: these must be identical in both databases; expect tables=110, fks=2)
SELECT DATABASE() AS db,
 (SELECT COUNT(*) FROM information_schema.TABLES  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE') AS tables_,
 (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()) AS columns_,
 (SELECT COUNT(DISTINCT TABLE_NAME, INDEX_NAME) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE()) AS indexes_,
 (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE()) AS fks;

-- 2. Migration journal (expect 25 rows, last = 0024_workshop_service_due.sql, 0 incomplete steps; 0025 must NOT be present before PR62)
SELECT (SELECT COUNT(*) FROM app_migrations) AS migrations_applied,
 (SELECT MAX(name) FROM app_migrations) AS last_migration,
 (SELECT COUNT(*) FROM app_migration_steps WHERE complete=0) AS incomplete_steps;

-- 3. Exact row count for every table (restore integrity: restore must equal the backup; the LIVE db may be higher
--    ONLY in tables that take daily writes: auth_session, audit_log, audit_events and any table users write daily). Never lower.
SET @sql = (SELECT GROUP_CONCAT(CONCAT('SELECT ''', TABLE_NAME, ''' AS table_name, COUNT(*) AS row_count FROM `', TABLE_NAME, '`') ORDER BY TABLE_NAME SEPARATOR ' UNION ALL ')
            FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 4. Relationship checks (app-level links; the schema has only 2 DB foreign keys). Every result must be 0 in the restore.
--    Orphaned organisation_id for each table that carries one:
SET @sql = (SELECT GROUP_CONCAT(CONCAT('SELECT ''', c.TABLE_NAME, '.organisation_id'' AS link, COUNT(*) AS orphans FROM `', c.TABLE_NAME,
            '` t LEFT JOIN organisations o ON o.id=t.organisation_id WHERE t.organisation_id IS NOT NULL AND o.id IS NULL') SEPARATOR ' UNION ALL ')
            FROM information_schema.COLUMNS c JOIN information_schema.TABLES t2 ON t2.TABLE_SCHEMA=c.TABLE_SCHEMA AND t2.TABLE_NAME=c.TABLE_NAME AND t2.TABLE_TYPE='BASE TABLE'
            WHERE c.TABLE_SCHEMA=DATABASE() AND c.COLUMN_NAME='organisation_id' AND c.TABLE_NAME<>'organisations');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
--    Declared foreign keys (single-column), child rows with no parent:
SET @sql = (SELECT GROUP_CONCAT(CONCAT('SELECT ''', k.TABLE_NAME, '.', k.COLUMN_NAME, ' -> ', k.REFERENCED_TABLE_NAME, ''' AS link, COUNT(*) AS orphans FROM `', k.TABLE_NAME,
            '` c LEFT JOIN `', k.REFERENCED_TABLE_NAME, '` p ON p.`', k.REFERENCED_COLUMN_NAME, '`=c.`', k.COLUMN_NAME, '` WHERE c.`', k.COLUMN_NAME, '` IS NOT NULL AND p.`', k.REFERENCED_COLUMN_NAME, '` IS NULL') SEPARATOR ' UNION ALL ')
            FROM information_schema.KEY_COLUMN_USAGE k WHERE k.TABLE_SCHEMA=DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 5. Tenancy sanity (counts only): users without an organisation; organisations without any entitlement row.
SELECT (SELECT COUNT(*) FROM users WHERE organisation_id IS NULL) AS users_without_org,
       (SELECT COUNT(*) FROM organisations o WHERE NOT EXISTS (SELECT 1 FROM organisation_entitlements e WHERE e.organisation_id=o.id)) AS orgs_without_entitlements;
