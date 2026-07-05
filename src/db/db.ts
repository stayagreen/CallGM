import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';

const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'app.db');
console.log('dbPath is:', dbPath);
const db = new Database(dbPath);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    xhs_homepage_url TEXT,
    bound_worker_id TEXT
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
    is_published INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS workers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    ip_address TEXT,
    status TEXT DEFAULT 'offline',
    concurrency INTEGER DEFAULT 1,
    capabilities TEXT DEFAULT '["gemini_image"]',
    config TEXT DEFAULT '{}',
    last_seen DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS system_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS xhs_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    video_path TEXT NOT NULL,
    cover_path TEXT,
    title TEXT,
    content TEXT,
    tags TEXT,
    scheduled_at DATETIME,
    is_draft INTEGER DEFAULT 0,
    publish_status TEXT DEFAULT 'pending',
    publish_url TEXT,
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS asset_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

// Bootstrap initial config
const configExists = db.prepare('SELECT * FROM system_config WHERE key = ?').get('app_config');
if (!configExists) {
    const configPath = path.join(dataDir, 'config.json');
    let initialConfig = { dispatchStrategy: 'all', globalConcurrency: 3 };
    
    if (fs.existsSync(configPath)) {
        try {
            const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            initialConfig = { ...initialConfig, ...saved };
        } catch (e) {}
    }
    
    db.prepare('INSERT INTO system_config (key, value) VALUES (?, ?)').run('app_config', JSON.stringify(initialConfig));
}

// Simple auto-migration for legacy databases
try { db.exec('ALTER TABLE tasks ADD COLUMN type TEXT NOT NULL DEFAULT "image";'); } catch (e) {}
try { db.exec('ALTER TABLE assets ADD COLUMN type TEXT NOT NULL DEFAULT "image";'); } catch (e) {}
try { db.exec('ALTER TABLE assets ADD COLUMN job_id TEXT;'); } catch (e) {}
try { db.exec('ALTER TABLE tasks ADD COLUMN worker_id TEXT;'); } catch (e) {}
try { db.exec('ALTER TABLE system_config ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP;'); } catch (e) {}
try { db.exec('ALTER TABLE users ADD COLUMN xhs_homepage_url TEXT;'); } catch (e) {}
try { db.exec('ALTER TABLE users ADD COLUMN bound_worker_id TEXT;'); } catch (e) {}
try { db.exec('ALTER TABLE xhs_notes ADD COLUMN is_draft INTEGER DEFAULT 0;'); } catch (e) {}
try { db.exec('ALTER TABLE assets ADD COLUMN group_id INTEGER;'); } catch (e) {}
try { db.exec('ALTER TABLE assets ADD COLUMN is_published INTEGER DEFAULT 0;'); } catch (e) {}
try { db.exec('ALTER TABLE asset_groups ADD COLUMN type TEXT NOT NULL DEFAULT "image";'); } catch (e) {}
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS xhs_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      video_path TEXT NOT NULL,
      cover_path TEXT,
      title TEXT,
      content TEXT,
      tags TEXT,
      scheduled_at DATETIME,
      is_draft INTEGER DEFAULT 0,
      publish_status TEXT DEFAULT 'pending',
      publish_url TEXT,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
  `);
} catch (e) {}

// Bootstrap admin user
const adminExists = db.prepare('SELECT * FROM users WHERE username = ?').get('administrator');
if (!adminExists) {
  const hashedPassword = bcrypt.hashSync('19871128', 10);
  db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run('administrator', hashedPassword, 'admin');
}

export default db;
