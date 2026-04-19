import Database from 'better-sqlite3';
const db = new Database('./data/app.db');
const rows = db.prepare("SELECT id, type, status, updated_at FROM tasks ORDER BY updated_at DESC LIMIT 10").all();
console.log("Tasks in DB:", rows);

const assets = db.prepare("SELECT * FROM assets WHERE type = 'video' ORDER BY created_at DESC LIMIT 5").all();
console.log("Assets in DB:", assets);
