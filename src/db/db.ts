import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';

const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'app.db');
const db = new Database(dbPath);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'user'
  );
  
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL DEFAULT 'image', -- 'image' or 'video'
    data TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    progress INTEGER DEFAULT 0,
    result_files TEXT DEFAULT '[]', -- JSON array
    error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    job_id TEXT,
    type TEXT NOT NULL DEFAULT 'image', -- 'image' or 'video'
    file_path TEXT UNIQUE NOT NULL, -- e.g. '1/saved_123.jpg'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

// Simple auto-migration for legacy databases
try { db.exec('ALTER TABLE tasks ADD COLUMN type TEXT NOT NULL DEFAULT "image";'); } catch (e) {}
try { db.exec('ALTER TABLE assets ADD COLUMN type TEXT NOT NULL DEFAULT "image";'); } catch (e) {}
try { db.exec('ALTER TABLE assets ADD COLUMN job_id TEXT;'); } catch (e) {}

// Bootstrap admin user
const adminExists = db.prepare('SELECT * FROM users WHERE username = ?').get('administrator');
if (!adminExists) {
  const hashedPassword = bcrypt.hashSync('19871128', 10);
  db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run('administrator', hashedPassword, 'admin');
}

export default db;
