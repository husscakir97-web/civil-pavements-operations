// Never serve requests against an old schema. Hostinger runs this with npm start.
import './migrate.mjs';
// Keep Next in this process so hosting shutdown signals reach it directly.
process.argv=[process.execPath,'next','start','--hostname','0.0.0.0',...process.argv.slice(2)];
await import('next/dist/bin/next');
