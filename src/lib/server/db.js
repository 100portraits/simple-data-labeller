// This file is no longer needed for establishing a DB connection when deployed to Cloudflare.
// The D1 database binding ('DB' from wrangler.toml) is accessed via `event.platform.env.DB` 
// directly within the server routes (+server.js files).

// We keep the file to avoid import errors in routes for now, but it exports nothing essential.

// // // Previous better-sqlite3 code removed: // // //
// import Database from 'better-sqlite3';
// import fs from 'fs';
// import path from 'path';
// import { parse } from 'csv-parse/sync';
// 
// const DB_DIR = path.join(process.cwd(), 'db');
// const DB_PATH = path.join(DB_DIR, 'labelling.sqlite');
// 
// console.log(`Initializing database at: ${DB_PATH}`);
// // ... rest of connection, schema, and ingest logic ...
// export default db; 

console.log('INFO: src/lib/server/db.js loaded (Deployment Mode - No local DB export)');

export {}; // Export an empty object to satisfy module system if needed 