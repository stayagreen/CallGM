process.env.TZ = 'Asia/Shanghai';
import express from "express";
import { GoogleGenAI, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { exec } from "child_process";
import { fileURLToPath } from "url";
import os from "os";
import sharp from "sharp";
import session from "express-session";
import { checkAccess, getUserStoragePath } from "./src/lib/auth-security.js";
import bcrypt from "bcryptjs";
import db from "./src/db/db.js";
import { proxyService } from "./src/services/proxyService.js";
import { dispatcherService } from "./src/services/dispatcherService.js";
import { downloadAndSetupRealESRGAN } from "./src/services/realesrganSetup.js";
import { createServer } from "http";

declare module 'express-session' {
  interface SessionData {
    user: { 
      id: number; 
      username: string; 
      role: string;
      xhs_homepage_url?: string;
      bound_worker_id?: string;
    };
  }
}

import { startAutomationWatcher, jobProgress, handleBrowserDebug, processingImages, cancelledJobs, ensureBrowserLaunched } from "./automation.js";
import { videoJobProgress, cancelledVideoJobs, startVideoAutomationWatcher } from "./video_automation.js";
import { executeXhsPublish, startXhsAutomationWatcher, xhsProgressMap } from "./xhs_automation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import AdmZip from "adm-zip";

async function startServer() {
  const app = express();
  // AI Studio sets DISABLE_HMR=true. When running locally outside AI Studio, default to 4000.
  const PORT = process.env.DISABLE_HMR === 'true' ? 3000 : 4000;

  app.use(express.json({ limit: "500mb" }));
  
  // Session configuration
  app.use(session({
    secret: 'secure-random-key-change-this',
    resave: false,
    saveUninitialized: false,
    cookie: { 
      secure: false,
      maxAge: 24 * 60 * 60 * 1000 // Default 1 day
    } 
  }));

  // Auth Middleware
  const requireAuth = (req: any, res: any, next: any) => {
    if (req.session.user) {
      next();
    } else {
      res.status(401).json({ error: 'Unauthorized' });
    }
  };

  const requireAdmin = (req: any, res: any, next: any) => {
    if (req.session.user && req.session.user.role === 'admin') {
      next();
    } else {
      res.status(403).json({ error: 'Forbidden' });
    }
  };

  // Auth routes
  app.get('/api/me', (req: any, res) => {
    if (req.session.user) {
      const user = db.prepare('SELECT xhs_homepage_url, bound_worker_id FROM users WHERE id = ?').get(req.session.user.id) as any;
      const xhs_homepage_url = user ? (user.xhs_homepage_url || '') : '';
      const bound_worker_id = user ? (user.bound_worker_id || '') : '';
      res.json({
        user: { ...req.session.user, xhs_homepage_url, bound_worker_id }
      });
    } else {
      res.json({ user: null });
    }
  });

  app.post('/api/user/profile', requireAuth, (req: any, res) => {
    const { xhsHomepageUrl, boundWorkerId } = req.body;
    const userId = req.session.user.id;
    const userRole = req.session.user.role;
    try {
      if (userRole !== 'admin') {
        const currentUser = db.prepare('SELECT bound_worker_id FROM users WHERE id = ?').get(userId) as any;
        const currentBoundId = currentUser ? (currentUser.bound_worker_id || '') : '';

        // Only enforce strict validation if the user is changing their bound worker
        if (boundWorkerId !== currentBoundId) {
          if (!boundWorkerId) {
            return res.status(400).json({ error: '普通用户必须绑定一台在线的本地设备，不能取消绑定或设置为不绑定！' });
          }
          if (boundWorkerId === 'local-server-id') {
            return res.status(400).json({ error: '普通用户不能绑定内置的服务器本地(Local Server)节点，必须绑定您当前在线的本地电脑或虚拟机！' });
          }
          const worker = db.prepare('SELECT status FROM workers WHERE id = ?').get(boundWorkerId) as any;
          if (!worker) {
            return res.status(400).json({ error: '所选择的设备不存在，请刷新重试。' });
          }
          if (worker.status === 'offline') {
            return res.status(400).json({ error: '普通用户只能绑定当前在线的设备，该设备目前处于离线状态。' });
          }
        }
      }

      db.prepare('UPDATE users SET xhs_homepage_url = ?, bound_worker_id = ? WHERE id = ?').run(xhsHomepageUrl || '', boundWorkerId || '', userId);
      if (req.session.user) {
        req.session.user.xhs_homepage_url = xhsHomepageUrl || '';
        req.session.user.bound_worker_id = boundWorkerId || '';
        req.session.save();
      }
      res.json({ success: true, xhsHomepageUrl, boundWorkerId });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/login', async (req, res) => {
    const { username, password, remember } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;
    if (user && await bcrypt.compare(password, user.password)) {
      req.session.user = { 
        id: user.id, 
        username: user.username, 
        role: user.role,
        xhs_homepage_url: user.xhs_homepage_url || '',
        bound_worker_id: user.bound_worker_id || ''
      };
      
      if (remember) {
        // Session lasts 30 days if remembered
        req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
      } else {
        // Session lasts only until browser closes
        req.session.cookie.maxAge = undefined;
      }
      
      res.json({ message: 'Logged in', user: req.session.user });
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  });

  // User Management Routes (Admin Only)
  app.get('/api/admin/users', requireAdmin, (req, res) => {
    const users = db.prepare('SELECT id, username, role FROM users').all();
    res.json(users);
  });

  app.post('/api/admin/users', requireAdmin, async (req, res) => {
    const { username, password, role } = req.body;
    if (!username || !password || !role) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    try {
      db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run(username, hashedPassword, role);
      res.json({ message: 'User created' });
    } catch (e) {
      res.status(400).json({ error: 'User already exists' });
    }
  });

  app.put('/api/admin/users/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { username, password, role } = req.body;
    try {
      if (password) {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.prepare('UPDATE users SET username = ?, password = ?, role = ? WHERE id = ?').run(username, hashedPassword, role, id);
      } else {
        db.prepare('UPDATE users SET username = ?, role = ? WHERE id = ?').run(username, role, id);
      }
      res.json({ message: 'User updated' });
    } catch (e) {
      res.status(400).json({ error: 'Update failed' });
    }
  });

  app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
    const { id } = req.params;
    if (parseInt(id) === req.session.user?.id) {
      return res.status(400).json({ error: 'Cannot delete current user' });
    }
    try {
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
      res.json({ message: 'User deleted' });
    } catch (e) {
      res.status(400).json({ error: 'Delete failed' });
    }
  });

  app.post('/api/logout', (req, res) => {
    req.session.destroy(() => {
      res.json({ message: 'Logged out' });
    });
  });

  // Proxy Admin Routes
  app.get('/api/admin/proxy/status', requireAdmin, (req, res) => {
    res.json(proxyService.getStatus());
  });

  app.post('/api/admin/proxy/config', requireAdmin, async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
    await proxyService.updateConfig(username, password);
    res.json({ message: 'Proxy config updated' });
  });

  // Worker Management Routes (Admin Only)
  app.get('/api/workers', requireAuth, (req: any, res) => {
    try {
      // Return ALL workers for all authenticated users so they are visible in personal settings
      const workers = db.prepare('SELECT id, name, status, last_seen, concurrency, capabilities FROM workers').all();
      res.json(workers);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/admin/workers', requireAdmin, (req, res) => {
    try {
      const workers = db.prepare('SELECT * FROM workers').all();
      res.json(workers);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/admin/workers', requireAdmin, (req, res) => {
    const { name, concurrency, capabilities, config } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    
    // Generate UUID and Token using random
    const id = Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
    const token = 'wk-' + Math.random().toString(36).substring(2, 12) + Math.random().toString(36).substring(2, 12);
    
    try {
      db.prepare('INSERT INTO workers (id, name, token, concurrency, capabilities, config) VALUES (?, ?, ?, ?, ?, ?)').run(
        id, name, token, concurrency || 1, JSON.stringify(capabilities || ['gemini_image']), JSON.stringify(config || {})
      );
      res.json({ message: 'Worker created', worker: { id, name, token } });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put('/api/admin/workers/:id', requireAdmin, (req, res) => {
    const { name, concurrency, capabilities, config } = req.body;
    
    // Protect built-in nodes
    if (req.params.id === 'local-server-id') {
        return res.status(403).json({ error: 'System nodes cannot be modified via API' });
    }

    try {
      db.prepare('UPDATE workers SET name = ?, concurrency = ?, capabilities = ?, config = ? WHERE id = ?').run(
        name, concurrency, JSON.stringify(capabilities || []), JSON.stringify(config || {}), req.params.id
      );
      res.json({ message: 'Worker updated' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/api/admin/workers/:id', requireAdmin, (req, res) => {
    // Protect built-in nodes
    if (req.params.id === 'local-server-id') {
        return res.status(403).json({ error: 'System nodes cannot be deleted' });
    }
    
    try {
      db.prepare('DELETE FROM workers WHERE id = ?').run(req.params.id);
      res.json({ message: 'Worker deleted' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/admin/workers/:id/command', requireAdmin, (req, res) => {
    const { action } = req.body;
    try {
      const workerRow = db.prepare('SELECT token FROM workers WHERE id = ?').get(req.params.id) as any;
      if (!workerRow) return res.status(404).json({ error: 'Worker not found' });
      
      // Tell dispatcher to send command
      dispatcherService.sendCommandToWorker(workerRow.token, action);
      res.json({ message: 'Command sent' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Fleet update: send 'update' command to all registered workers
  app.post('/api/admin/workers-fleet/update', requireAdmin, (req, res) => {
    try {
      const workers = db.prepare('SELECT token FROM workers').all() as any[];
      let count = 0;
      for (const w of workers) {
        if (w.token === 'server-local-token') continue; // Skip local server
        dispatcherService.sendCommandToWorker(w.token, 'update');
        count++;
      }
      res.json({ message: `Update command sent to ${count} workers` });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Serve the installation script publicly
  app.get('/worker_install.ps1', (req, res) => {
    const psPath = path.join(__dirname, 'worker_install.ps1');
    if (fs.existsSync(psPath)) {
        const content = fs.readFileSync(psPath, 'utf8');
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.send(content);
    } else {
        res.status(404).send('Script not found');
    }
  });

  // Worker binary/dist download
  app.get('/api/worker/download', (req, res) => {
    try {
      const workerDist = path.join(__dirname, 'worker_dist');
      if (!fs.existsSync(workerDist)) {
          return res.status(404).json({ error: 'worker_dist not found. Run npm run build-worker first.' });
      }

      const zip = new AdmZip();
      zip.addLocalFolder(workerDist);
      const buffer = zip.toBuffer();

      res.set('Content-Type', 'application/zip');
      res.set('Content-Disposition', 'attachment; filename=worker_dist.zip');
      res.send(buffer);
    } catch (e: any) {
      res.status(500).send(e.message);
    }
  });

  // Media endpoint so workers can download the required video / cover images
  app.get('/api/worker/media', (req, res) => {
    const { path: relativePath } = req.query as { path: string };
    if (!relativePath) {
      return res.status(400).send('Missing path');
    }

    // Resolve candidates
    const cleanPath = relativePath.replace(/^\//, ''); // remove leading slash
    const normalizedPath = cleanPath.replace(/\\/g, '/');

    // Convert 'downloads/' web routing prefix to local 'download/' filesystem directory representation
    const localDirMappedPath = normalizedPath.startsWith('downloads/')
      ? normalizedPath.replace(/^downloads\//, 'download/')
      : normalizedPath;

    const candidates = [
      path.join(__dirname, normalizedPath),
      path.join(process.cwd(), normalizedPath),
      path.join(__dirname, localDirMappedPath),
      path.join(process.cwd(), localDirMappedPath),
      path.join(__dirname, 'download', 'videos', normalizedPath),
      path.join(process.cwd(), 'download', 'videos', normalizedPath),
      path.join(__dirname, 'download', normalizedPath),
      path.join(__dirname, 'uploads', normalizedPath),
      path.join(process.cwd(), 'download', normalizedPath),
      path.join(process.cwd(), 'uploads', normalizedPath)
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return res.sendFile(candidate);
      }
    }

    // Deep recursive fallback matching to prevent 404s for any moved or nested media files
    const baseDirs = [
      path.join(__dirname, 'download'),
      path.join(__dirname, 'uploads'),
      path.join(process.cwd(), 'download'),
      path.join(process.cwd(), 'uploads')
    ];

    const searchFileRecursively = (dir: string, suffix: string): string | null => {
      if (!fs.existsSync(dir)) return null;
      try {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const fullPath = path.join(dir, file);
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            const found = searchFileRecursively(fullPath, suffix);
            if (found) return found;
          } else if (stat.isFile()) {
            const normFull = fullPath.replace(/\\/g, '/');
            if (normFull.endsWith(suffix)) {
              return fullPath;
            }
          }
        }
      } catch (e) {}
      return null;
    };

    // Try matching using full relative path first
    for (const base of baseDirs) {
      const found = searchFileRecursively(base, normalizedPath);
      if (found) {
        console.log(`[Media API] Deep match found (path suffix): ${found}`);
        return res.sendFile(found);
      }
    }

    // Try matching using just the basename as absolute fallback
    const baseName = path.basename(normalizedPath);
    for (const base of baseDirs) {
      const found = searchFileRecursively(base, baseName);
      if (found) {
        console.log(`[Media API] Deep match found (basename suffix): ${found}`);
        return res.sendFile(found);
      }
    }

    res.status(404).send('Media file not found');
  });

  // Dynamic script delivery (Stateless / zero config update)
  app.get('/api/worker/note-info/:id', (req, res) => {
    const { id } = req.params;
    try {
      const note = db.prepare('SELECT is_draft FROM xhs_notes WHERE id = ?').get(id) as any;
      if (note) {
        res.json({ is_draft: note.is_draft });
      } else {
        res.status(404).json({ error: 'Note not found' });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/worker/script/:name', (req, res) => {
    const { name } = req.params;
    const safeName = path.basename(name);
    const scriptPath = path.join(__dirname, safeName);
    
    if (fs.existsSync(scriptPath)) {
      res.sendFile(scriptPath);
    } else {
      res.status(404).send('Script not found');
    }
  });

  // Worker API
  app.post('/api/worker/upload-result', async (req, res) => {
    const { token, jobId, base64Data, filename } = req.body;
    if (!token || !jobId || !base64Data || !filename) {
      console.warn(`[Worker Upload] Missing fields for job ${jobId}:`, { hasToken: !!token, hasJobId: !!jobId, hasData: !!base64Data, hasFilename: !!filename });
      return res.status(400).json({ error: 'Missing fields' });
    }

    // Verify token
    const worker = db.prepare('SELECT id, name FROM workers WHERE token = ?').get(token) as any;
    if (!worker) {
      console.warn(`[Worker Upload] Unregistered worker tried to upload. Token: ${token.substring(0, 8)}...`);
      return res.status(401).json({ error: 'Invalid worker token' });
    }

    console.log(`[Worker Upload] Worker ${worker.name} is uploading ${filename} for Job ${jobId}`);

    try {
      const task = db.prepare('SELECT user_id, type FROM tasks WHERE id = ?').get(jobId) as any;
      if (!task) return res.status(404).json({ error: 'Task not found' });

      // Build target dir
      let targetDir = path.join(__dirname, 'download');
      
      const userDownloadDir = path.join(targetDir, String(task.user_id));
      if (!fs.existsSync(userDownloadDir)) fs.mkdirSync(userDownloadDir, { recursive: true });

      const filePath = path.join(userDownloadDir, filename);
      fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));

      // Log asset to db
      const relativePath = `${task.user_id}/${filename}`;
      db.prepare('INSERT OR IGNORE INTO assets (user_id, type, job_id, file_path) VALUES (?, ?, ?, ?)').run(task.user_id, task.type, jobId, relativePath);

      // Safely load, parse, append, and save result_files to avoid any escaping or version compatibility issues with json_insert
      const currentTask = db.prepare('SELECT result_files FROM tasks WHERE id = ?').get(jobId) as any;
      let resultFiles: string[] = [];
      if (currentTask && currentTask.result_files) {
        try {
          resultFiles = JSON.parse(currentTask.result_files);
          if (!Array.isArray(resultFiles)) resultFiles = [];
        } catch (e) {
          resultFiles = [];
        }
      }
      if (!resultFiles.includes(relativePath)) {
        resultFiles.push(relativePath);
      }

      db.prepare('UPDATE tasks SET status = ?, progress = 100, result_files = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('completed', JSON.stringify(resultFiles), jobId);

      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  const taskDir = path.join(__dirname, "task");
  const historyDir = path.join(taskDir, "history");
  const downloadDir = path.join(__dirname, "download");
  const uploadsDir = path.join(__dirname, "uploads");
  const thumbnailsDir = path.join(__dirname, "thumbnails");
  const thumbDownloadsDir = path.join(thumbnailsDir, "downloads");
  const thumbUploadsDir = path.join(thumbnailsDir, "uploads");
  
  // Video directories
  const videoTaskDir = path.join(__dirname, "task_video");
  const videoHistoryDir = path.join(videoTaskDir, "history");
  const videoDownloadDir = path.join(__dirname, "download", "videos");
  const videoThumbDir = path.join(__dirname, "thumbnails", "videos");
  const bgmDir = path.join(__dirname, "bgm");
  
  const dirs = [taskDir, historyDir, downloadDir, uploadsDir, thumbnailsDir, thumbDownloadsDir, thumbUploadsDir];
  dirs.forEach(dir => { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); });

  // Sync function to populate DB from existing files
  const syncFilesToDb = () => {
    console.log('🔄 Starting DB sync with existing files...');
    
    // Sync Tasks
    const syncTasks = (baseDir: string, type: string) => {
        const getJsonFiles = (dir: string): string[] => {
            let results: string[] = [];
            if (!fs.existsSync(dir)) return results;
            const items = fs.readdirSync(dir);
            for (const item of items) {
                const fullPath = path.join(dir, item);
                if (fs.statSync(fullPath).isDirectory()) {
                    results = [...results, ...getJsonFiles(fullPath)];
                } else if (item.endsWith('.json')) {
                    results.push(fullPath);
                }
            }
            return results;
        };

        const jsonFiles = getJsonFiles(baseDir);
        for (const filePath of jsonFiles) {
            try {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                const filename = path.basename(filePath);
                const jobId = filename.replace('.json', '');
                
                let userId = data.userId;
                if (userId === undefined) {
                    const matches = filename.match(/task_(?:video_)?(\d+)_/);
                    if (matches) userId = parseInt(matches[1]);
                }
                if (!userId) userId = 1; // Default to admin if unknown

                const stat = fs.statSync(filePath);
                const status = filePath.includes('history') ? 'completed' : 'pending';
                
                db.prepare('INSERT OR IGNORE INTO tasks (id, user_id, type, data, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
                    jobId, userId, type, JSON.stringify(data), status, 
                    stat.birthtime.toISOString(), stat.mtime.toISOString()
                );
            } catch(e) {}
        }
    };

    syncTasks(taskDir, 'image');
    syncTasks(videoTaskDir, 'video');

    // Sync Assets
    const syncAssets = (baseDir: string, type: string, rootDir: string) => {
        const getFiles = (dir: string): string[] => {
            let results: string[] = [];
            if (!fs.existsSync(dir)) return results;
            const items = fs.readdirSync(dir);
            for (const item of items) {
                const fullPath = path.join(dir, item);
                if (fs.statSync(fullPath).isDirectory()) {
                    if (item !== 'history') results = [...results, ...getFiles(fullPath)];
                } else {
                    const ext = path.extname(item).toLowerCase();
                    if (type === 'image' && ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)) {
                        results.push(fullPath);
                    } else if (type === 'video' && ['.mp4', '.webm', '.mov'].includes(ext)) {
                        results.push(fullPath);
                    }
                }
            }
            return results;
        };

        const files = getFiles(baseDir);
        for (const filePath of files) {
            try {
                const relativePath = path.relative(rootDir, filePath).replace(/\\/g, '/');
                const pathParts = relativePath.split('/');
                let userId = parseInt(pathParts[0]);
                if (isNaN(userId)) userId = 1;

                const stat = fs.statSync(filePath);
                db.prepare('INSERT OR IGNORE INTO assets (user_id, type, file_path, created_at) VALUES (?, ?, ?, ?)').run(
                    userId, type, relativePath, stat.birthtime.toISOString()
                );
            } catch(e) {}
        }
    };

    syncAssets(downloadDir, 'image', downloadDir);
    syncAssets(videoDownloadDir, 'video', videoDownloadDir);
    syncAssets(uploadsDir, 'upload', __dirname); // Uploads include the "uploads/" prefix in Assets table

    try {
        // Fix existing broken gallery images by converting 'uploads/...' records to 'upload' type instead of 'image'
        db.prepare("UPDATE assets SET type = 'upload' WHERE file_path LIKE 'uploads/%' AND type = 'image'").run();
        
        // Fix stuck running tasks on reboot
        db.prepare("UPDATE tasks SET status = 'error' WHERE status = 'running'").run();
    } catch(e) {
        console.error("Failed to migrate asset types or fix stuck tasks", e);
    }

    console.log('✅ DB sync complete.');
  };

  syncFilesToDb();

  // Serve static files
  app.use("/downloads", express.static(downloadDir));
  app.use("/uploads", express.static(uploadsDir));
  app.use("/bgm", express.static(bgmDir));

  // BGM List API
  app.get("/api/bgm", (req, res) => {
    try {
      const files = fs.readdirSync(bgmDir).filter(f => f.endsWith('.mp3') || f.endsWith('.wav'));
      res.json(files);
    } catch (e) {
      res.json([]);
    }
  });

  // Video Task Execution API
  app.post("/api/video/execute", requireAuth, checkAccess, (req: any, res) => {
    const user = req.session.user;
    const taskData = req.body;
    
    // Process base64 images
    const userUploadsDir = path.join(getUserStoragePath(req, uploadsDir));
    if (!fs.existsSync(userUploadsDir)) fs.mkdirSync(userUploadsDir, { recursive: true });

    if (taskData.xhsCoverImage && taskData.xhsCoverImage.startsWith('data:image')) {
      const matches = taskData.xhsCoverImage.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
      if (matches) {
        const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
        const base64Data = matches[2];
        const filename = `ref_xhs_cover_${Date.now()}_${Math.floor(Math.random()*10000)}.${ext}`;
        const relativePath = path.join(user.id.toString(), filename);
        fs.writeFileSync(path.join(userUploadsDir, filename), base64Data, 'base64');
        try { db.prepare('INSERT OR IGNORE INTO assets (user_id, type, file_path) VALUES (?, ?, ?)').run(user.id, 'upload', `uploads/${relativePath}`); } catch(e) {}
        taskData.xhsCoverImage = `/uploads/${user.id}/${filename}`;
      }
    }

    if (taskData.storyboards) {
      taskData.storyboards.forEach((sb: any) => {
        if (sb.image && sb.image.startsWith('data:image')) {
          const matches = sb.image.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
          if (matches) {
            const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
            const base64Data = matches[2];
            const filename = `ref_vid_${Date.now()}_${Math.floor(Math.random()*10000)}.${ext}`;
            const relativePath = path.join(user.id.toString(), filename);
            fs.writeFileSync(path.join(userUploadsDir, filename), base64Data, 'base64');
            
            // Register upload in assets table
            try {
              db.prepare('INSERT OR IGNORE INTO assets (user_id, type, file_path) VALUES (?, ?, ?)').run(user.id, 'upload', `uploads/${relativePath}`);
            } catch(e) {}

            sb.image = `/uploads/${user.id}/${filename}`;
          }
        }
      });
    }

    const jobId = `task_video_${user.id}_${Date.now()}`;
    const filename = `${jobId}.json`;
    const userVideoTaskDir = path.join(getUserStoragePath(req, videoTaskDir));
    if (!fs.existsSync(userVideoTaskDir)) fs.mkdirSync(userVideoTaskDir, { recursive: true });

    const finalTaskData = { ...taskData, userId: user.id, id: jobId };
    // File writing moved to dispatcherService to allow remote distribution logic
    // fs.writeFileSync(path.join(userVideoTaskDir, filename), JSON.stringify(finalTaskData, null, 2));

    // Register job in DB
    db.prepare('INSERT INTO tasks (id, user_id, type, data, status) VALUES (?, ?, ?, ?, ?)').run(
      jobId, 
      user.id, 
      'video', 
      JSON.stringify(finalTaskData), 
      'pending'
    );

    dispatcherService.poke();

    res.json({ status: "ok", message: "Video task queued", filename, jobId });
  });

  // Video Jobs API
  app.get("/api/video/jobs", requireAuth, checkAccess, (req: any, res) => {
    const user = req.session.user;
    
    let query = 'SELECT tasks.*, users.username FROM tasks LEFT JOIN users ON tasks.user_id = users.id WHERE tasks.type = ?';
    let params: any[] = ['video'];

    if (user.role !== 'admin') {
      query += ' AND tasks.user_id = ?';
      params.push(user.id);
    }

    query += ' ORDER BY tasks.created_at DESC LIMIT 100';

    try {
      const rows = db.prepare(query).all(...params) as any[];
      const jobs = rows.map(row => {
        const data = JSON.parse(row.data);
        const progressInfo = videoJobProgress.get(row.id);
        
        return {
          id: row.id,
          userId: row.user_id,
          username: row.username,
          status: progressInfo ? progressInfo.status : row.status,
          progress: progressInfo ? progressInfo.progress : row.progress,
          statusMessage: progressInfo ? (progressInfo.error || '') : '',
          timestamp: new Date(row.created_at.endsWith('Z') ? row.created_at : row.created_at.replace(' ', 'T') + 'Z').getTime(),
          data: data,
          resultFiles: JSON.parse(row.result_files || '[]')
        };
      });
      res.json(jobs);
    } catch (e) {
      console.error('Failed to get video jobs from DB', e);
      res.status(500).json({ error: 'Database error' });
    }
  });

  // Processing Status API (Watermark removal)
  app.get("/api/processing-status", (req, res) => {
    res.json(Array.from(processingImages));
  });

  // Thumbnail generation endpoint
  // Thumbnail serving with subdirectory support
  app.get("/api/thumbnails/:type/*", async (req, res) => {
    const { type } = req.params;
    const filename = req.params[0];
    if (type !== 'downloads' && type !== 'uploads' && type !== 'videos') {
      return res.status(400).send('Invalid type');
    }

    if (type === 'videos') {
      let thumbPath = path.join(videoThumbDir, filename);
      // If not in root, try searching in subdirectories (UserId subdirs)
      if (!fs.existsSync(thumbPath)) {
          try {
              const subdirs = fs.readdirSync(videoThumbDir);
              for (const sub of subdirs) {
                  const subPath = path.join(videoThumbDir, sub, filename);
                  if (fs.existsSync(subPath)) {
                      thumbPath = subPath;
                      break;
                  }
              }
          } catch(e) {}
      }

      if (fs.existsSync(thumbPath)) {
        return res.sendFile(thumbPath);
      } else {
        return res.status(404).send('Thumbnail not found');
      }
    }

    const sourceDir = type === 'downloads' ? downloadDir : uploadsDir;
    const thumbDir = type === 'downloads' ? thumbDownloadsDir : thumbUploadsDir;

    let sourcePath = path.join(sourceDir, filename);
    let thumbPath = path.join(thumbDir, filename);

    if (!fs.existsSync(sourcePath)) {
      // Fallback for historical bug where admin files were saved in root instead of user dir
      const fallbackSourcePath = path.join(sourceDir, path.basename(filename));
      if (fs.existsSync(fallbackSourcePath)) {
        sourcePath = fallbackSourcePath;
        thumbPath = path.join(thumbDir, path.basename(filename));
      } else {
        return res.status(404).send('Image not found');
      }
    }

    if (fs.existsSync(thumbPath)) {
      return res.sendFile(thumbPath);
    }

    try {
      const thumbDirname = path.dirname(thumbPath);
      if (!fs.existsSync(thumbDirname)) {
        fs.mkdirSync(thumbDirname, { recursive: true });
      }
      
      await sharp(sourcePath)
        .resize(256, 256, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(thumbPath);
      res.sendFile(thumbPath);
    } catch (error) {
      console.error('Thumbnail generation failed:', error);
      // Fallback to original if sharp fails
      res.sendFile(sourcePath);
    }
  });

  // API to save a file to gallery (downloads folder)
  app.post("/api/gallery/save", requireAuth, (req: any, res) => {
    const user = req.session.user;
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "URL is required" });

    console.log(`[GallerySave] Request to save: ${url.substring(0, 50)}...`);

    try {
      const userDownloadDir = path.join(downloadDir, user.id.toString());
      if (!fs.existsSync(userDownloadDir)) fs.mkdirSync(userDownloadDir, { recursive: true });

      if (url.startsWith('data:image')) {
        // Handle base64
        const matches = url.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
        if (matches) {
          const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
          const base64Data = matches[2];
          const filename = `saved_${Date.now()}_${Math.floor(Math.random()*1000)}.${ext}`;
          const destPath = path.join(userDownloadDir, filename);
          fs.writeFileSync(destPath, base64Data, 'base64');
          
          const relativePath = path.join(user.id.toString(), filename).replace(/\\/g, '/');
          db.prepare('INSERT OR IGNORE INTO assets (user_id, type, file_path) VALUES (?, ?, ?)').run(user.id, 'image', relativePath);

          return res.json({ status: "ok", filename, url: `/downloads/${relativePath}` });
        }
        return res.status(400).json({ error: "Invalid base64 format" });
      }

      const filename = path.basename(url);
      let sourcePath = '';
      
      if (url.startsWith('/uploads/')) {
        // Handle user-specific uploads
        const uploadFilename = path.basename(url);
        sourcePath = path.join(uploadsDir, user.role === 'admin' ? '' : user.id.toString(), uploadFilename);
        if (!fs.existsSync(sourcePath)) {
            // Try root uploads just in case
            sourcePath = path.join(uploadsDir, uploadFilename);
        }
      } else if (url.startsWith('/downloads/')) {
        const downloadFilename = path.basename(url);
        sourcePath = path.join(downloadDir, user.role === 'admin' ? '' : user.id.toString(), downloadFilename);
        if (!fs.existsSync(sourcePath)) {
            sourcePath = path.join(downloadDir, downloadFilename);
        }
      } else {
        sourcePath = path.join(uploadsDir, filename);
        if (!fs.existsSync(sourcePath)) {
          sourcePath = path.join(downloadDir, filename);
        }
      }

      if (!fs.existsSync(sourcePath)) {
        return res.status(404).json({ error: "Source file not found" });
      }

      const newFilename = `saved_${Date.now()}_${filename}`;
      const destPath = path.join(userDownloadDir, newFilename);
      fs.copyFileSync(sourcePath, destPath);
      
      const relativePath = path.join(user.id.toString(), newFilename).replace(/\\/g, '/');
      db.prepare('INSERT OR IGNORE INTO assets (user_id, type, file_path) VALUES (?, ?, ?)').run(user.id, 'image', relativePath);

      res.json({ status: "ok", filename: newFilename, url: `/downloads/${relativePath}` });
    } catch (e) {
      console.error('[GallerySave] Failed to save to gallery', e);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // API to save generation request
  app.post("/api/execute", requireAuth, checkAccess, (req: any, res) => {
    const user = req.session.user;
    const { tasks } = req.body;
    
    // Process base64 images and save them as files in user-specific upload directory
    const userUploadsDir = path.join(getUserStoragePath(req, uploadsDir));
    if (!fs.existsSync(userUploadsDir)) fs.mkdirSync(userUploadsDir, { recursive: true });

    tasks.forEach((task: any) => {
      if (task.images && Array.isArray(task.images)) {
        task.images = task.images.map((img: string) => {
          if (img.startsWith('data:image')) {
            const matches = img.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
            if (matches) {
              const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
              const base64Data = matches[2];
              const filename = `ref_${Date.now()}_${Math.floor(Math.random()*10000)}.${ext}`;
              const relativePath = path.join(user.id.toString(), filename);
              fs.writeFileSync(path.join(userUploadsDir, filename), base64Data, 'base64');
              
              // Register upload in assets table
              try {
                db.prepare('INSERT OR IGNORE INTO assets (user_id, type, file_path) VALUES (?, ?, ?)').run(user.id, 'upload', `uploads/${relativePath}`);
              } catch(e) {}

              return `/uploads/${user.id}/${filename}`;
            }
          }
          return img;
        });
      }
    });

    // Generate unique ID for the job
    const jobId = `task_${user.id}_${Date.now()}`;
    const filename = `${jobId}.json`;
    
    // Save to JSON file in user-specific task directory (for the engine to pick up)
    const userTaskDir = path.join(getUserStoragePath(req, taskDir));
    if (!fs.existsSync(userTaskDir)) fs.mkdirSync(userTaskDir, { recursive: true });
    const filePath = path.join(userTaskDir, filename);
    const taskData = { ...req.body, userId: user.id, id: jobId };
    
    // File writing moved to dispatcherService to allow remote distribution logic
    // fs.writeFileSync(filePath, JSON.stringify(taskData, null, 2));

    // Register job in DB
    db.prepare('INSERT INTO tasks (id, user_id, type, data, status) VALUES (?, ?, ?, ?, ?)').run(
      jobId, 
      user.id, 
      'image', 
      JSON.stringify(taskData), 
      'pending'
    );

    dispatcherService.poke();

    res.json({ status: "ok", message: "Tasks queued", filename, jobId });
  });

  // API route for browser to send debug info
  app.post("/api/debug", (req, res) => {
    if (req.body && req.body.message) {
      handleBrowserDebug(req.body.message);
    }
    res.json({ status: "ok" });
  });

  // API route to get jobs (pending, running, completed)
  app.get("/api/jobs", requireAuth, checkAccess, (req: any, res) => {
    const user = req.session.user;
    
    let query = 'SELECT tasks.*, users.username FROM tasks LEFT JOIN users ON tasks.user_id = users.id WHERE tasks.type = ?';
    let params: any[] = ['image'];

    if (user.role !== 'admin') {
      query += ' AND tasks.user_id = ?';
      params.push(user.id);
    }

    query += ' ORDER BY tasks.created_at DESC LIMIT 100';

    try {
      const rows = db.prepare(query).all(...params) as any[];
      const jobs = rows.map(row => {
        const data = JSON.parse(row.data);
        let progressInfo = jobProgress.get(row.id) as any;
        if (row.type === 'video' && !progressInfo) {
          progressInfo = videoJobProgress.get(row.id);
        }

        let progress = row.progress;
        let statusMessage = '';
        let currentStatus = row.status;

        if (progressInfo) {
          currentStatus = progressInfo.status;
          if (progressInfo.total !== undefined && progressInfo.completed !== undefined) {
            // Image/Batch automation progress
            progress = progressInfo.total > 0 ? Math.round((progressInfo.completed / progressInfo.total) * 100) : 0;
            statusMessage = progressInfo.message || '';
          } else if (progressInfo.progress !== undefined) {
            // Video rendering progress
            progress = progressInfo.progress;
            statusMessage = progressInfo.error || '';
          }
        }
        
        return {
          id: row.id,
          userId: row.user_id,
          username: row.username,
          status: currentStatus,
          progress: progress,
          statusMessage: statusMessage,
          timestamp: new Date(row.created_at.endsWith('Z') ? row.created_at : row.created_at.replace(' ', 'T') + 'Z').getTime(),
          tasks: data.tasks || (Array.isArray(data) ? data : []),
          resultFiles: JSON.parse(row.result_files || '[]')
        };
      });
      res.json(jobs);
    } catch (e) {
      console.error('Failed to get jobs from DB', e);
      res.status(500).json({ error: 'Database error' });
    }
  });

  // API route to batch delete jobs
  app.post("/api/jobs/delete", requireAuth, checkAccess, (req: any, res) => {
    const { filenames } = req.body;
    if (!Array.isArray(filenames)) return res.status(400).json({error: 'Invalid request'});
    
    for (const file of filenames) {
      const jobId = file.replace('.json', '');
      
      // Notify dispatcher if it was running on a worker
      dispatcherService.cancelTask(jobId);

      // Delete from DB
      try {
        db.prepare('DELETE FROM tasks WHERE id = ?').run(jobId);
      } catch(e) {}

      // Helper to find file in root or subdirs
      const findAndDelete = (baseDir: string, targetFile: string) => {
          // If the job is running, signal cancellation
          if (jobProgress.has(jobId)) {
            cancelledJobs.add(jobId);
          }
          if (videoJobProgress.has(jobId)) {
            cancelledVideoJobs.add(jobId);
          }

          const rootPath = path.join(baseDir, targetFile);
          const rootPaused = rootPath + '.paused';
          if (fs.existsSync(rootPath)) fs.unlinkSync(rootPath);
          if (fs.existsSync(rootPaused)) fs.unlinkSync(rootPaused);

          // Scan subdirs
          try {
              const items = fs.readdirSync(baseDir);
              for (const item of items) {
                  const subPath = path.join(baseDir, item);
                  if (fs.statSync(subPath).isDirectory()) {
                      const f = path.join(subPath, targetFile);
                      const p = f + '.paused';
                      if (fs.existsSync(f)) fs.unlinkSync(f);
                      if (fs.existsSync(p)) fs.unlinkSync(p);
                  }
              }
          } catch(e) {}
          return true;
      };

      findAndDelete(historyDir, file);
      findAndDelete(videoHistoryDir, file);
      findAndDelete(taskDir, file);
      findAndDelete(videoTaskDir, file);
    }

    // 任务删除后立即触发调度器，检查是否有排队的任务可以开始
    dispatcherService.poke();

    res.json({ success: true });
  });

  // Batch action (pause, delete)
  app.post("/api/jobs/batch-action", requireAuth, checkAccess, (req: any, res) => {
    const { taskIds, action } = req.body;
    if (!Array.isArray(taskIds) || !['pause', 'pause_delete', 'delete'].includes(action)) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    try {
      const renameFile = (id: string, isVideo: boolean, pause: boolean) => {
          const baseName = isVideo ? 'task_video' : 'task';
          const historyBase = isVideo ? 'task_video/history' : 'task/history';
          const filename = `${id}.json`;
          
          // Helper to rename if exists
          const doRename = (dir: string) => {
              const fullPath = path.join(process.cwd(), dir, filename);
              const pausedPath = fullPath + '.paused';
              if (pause) {
                  if (fs.existsSync(fullPath)) fs.renameSync(fullPath, pausedPath);
              } else {
                  // resume (not requested yet but good to know)
                  if (fs.existsSync(pausedPath)) fs.renameSync(pausedPath, fullPath);
              }
          };

          doRename(baseName);
          doRename(historyBase);
          // Also check user subdirs if any
          const searchDirs = [path.join(process.cwd(), baseName), path.join(process.cwd(), historyBase)];
          searchDirs.forEach(sd => {
              if (fs.existsSync(sd)) {
                  fs.readdirSync(sd).forEach(sub => {
                      const subPath = path.join(sd, sub);
                      if (fs.statSync(subPath).isDirectory()) {
                          const f = path.join(subPath, filename);
                          const p = f + '.paused';
                          if (pause && fs.existsSync(f)) fs.renameSync(f, p);
                          else if (!pause && fs.existsSync(p)) fs.renameSync(p, f);
                      }
                  });
              }
          });
      };

      for (const id of taskIds) {
        if (action === 'pause' || action === 'pause_delete') {
            const task = db.prepare('SELECT type, worker_id FROM tasks WHERE id = ?').get(id) as any;
            db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('paused', id);
            dispatcherService.cancelTask(id);
            cancelledJobs.add(id);
            cancelledVideoJobs.add(id);
            if (task) renameFile(id, task.type === 'video', true);

            // Release worker
            if (task && task.worker_id) {
               const otherRunning = db.prepare('SELECT COUNT(*) as count FROM tasks WHERE worker_id = ? AND status = ? AND id != ?').get(task.worker_id, 'running', id) as any;
               if (!otherRunning || otherRunning.count === 0) {
                   db.prepare('UPDATE workers SET status = ? WHERE id = ?').run('idle', task.worker_id);
               }
            }
        }

        if (action === 'delete' || action === 'pause_delete') {
            // Need worker_id before delete
            const task = db.prepare('SELECT worker_id FROM tasks WHERE id = ?').get(id) as any;
            db.prepare('DELETE FROM tasks WHERE id = ?').run(id);

            // Release worker
            if (task && task.worker_id) {
               const otherRunning = db.prepare('SELECT COUNT(*) as count FROM tasks WHERE worker_id = ? AND status = ? AND id != ?').get(task.worker_id, 'running', id) as any;
               if (!otherRunning || otherRunning.count === 0) {
                   db.prepare('UPDATE workers SET status = ? WHERE id = ?').run('idle', task.worker_id);
               }
            }
        }
      }

      // 任务状态刷新（暂停/删除）后立即触发调度器，让排队的任务顶替位置
      dispatcherService.poke();

      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  const dataDir = path.join(__dirname, "data");
  const templatesPath = path.join(dataDir, "templates.json");
  const configPath = path.join(dataDir, 'config.json');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  // API route for templates
  app.get('/api/templates', (req, res) => {
    if (fs.existsSync(templatesPath)) {
      try {
        res.json(JSON.parse(fs.readFileSync(templatesPath, 'utf-8')));
      } catch (e) {
        res.json([]);
      }
    } else {
      res.json([]);
    }
  });

  app.post('/api/templates', (req, res) => {
    fs.writeFileSync(templatesPath, JSON.stringify(req.body, null, 2));
    res.json({ success: true });
  });

  // API route for gallery images (with DB permission check)
  app.get('/api/gallery/:img', requireAuth, (req: any, res) => {
    const imgName = req.params.img;
    const user = req.session.user;
    
    // Check DB for asset permissions
    const asset = db.prepare('SELECT * FROM assets WHERE file_path LIKE ?').get(`%${imgName}`) as any;
    
    if (asset) {
      if (user.role !== 'admin' && asset.user_id !== user.id) {
        return res.status(403).json({ error: "Access denied" });
      }
      
      const fullPath = path.join(__dirname, asset.file_path.startsWith('uploads/') ? '' : 'download', asset.file_path);
      if (fs.existsSync(fullPath)) {
        return res.sendFile(fullPath);
      }
    }

    // Fallback for user-specific directories if not in DB yet
    const userPath = path.join(downloadDir, user.role === 'admin' ? '' : user.id.toString(), imgName);
    if (fs.existsSync(userPath)) {
       return res.sendFile(userPath);
    }
    
    res.status(404).json({ error: "Image not found" });
  });

  // CDP (Chrome DevTools Protocol) Chrome Browser Status and Auto-Launcher APIs
  app.get('/api/chrome/status', requireAuth, async (req: any, res) => {
    try {
      // 1. Check if server local port 9222 is active
      let localCdpActive = false;
      try {
        const response = await fetch('http://localhost:9222/json/version', { signal: AbortSignal.timeout(1000) });
        if (response.ok) {
          localCdpActive = true;
        }
      } catch (e) {}

      // 2. Fetch if any workers are currently online
      const activeWorkers = db.prepare("SELECT name, token, status FROM workers WHERE last_seen > datetime('now', '-30 seconds')").all() as any[];
      const onlineWorkersCount = activeWorkers.filter(w => w.status !== 'offline').length;

      res.json({
        localCdpActive,
        onlineWorkersCount,
        activeWorkers: activeWorkers.map(w => ({ name: w.name, status: w.status }))
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/chrome/launch', requireAuth, async (req: any, res) => {
    try {
      console.log('🔮 触发 CDP 静默配置与 Chrome 启动指令...');
      
      // 1. 尝试在服务器本地调起 Chrome (适用于本地化单机运行场景)
      let localLaunchResult = false;
      const isLocal = req.hostname === 'localhost' || req.hostname === '127.0.0.1';
      if (isLocal) {
        console.log('   🖥️ 检测到本地单机访问模式，正在本地尝试调起 Chrome...');
        localLaunchResult = await ensureBrowserLaunched();
      } else {
        // 如果是云端运行，我们也静默尝试 (不阻碍后面向 worker 队列广播指令)
        ensureBrowserLaunched().catch(() => {});
      }

      // 2. 向所有活跃的节点 (Worker) 广播 Chrome CDP 调起指令
      const workers = db.prepare("SELECT token FROM workers WHERE last_seen > datetime('now', '-1 minute')").all() as any[];
      let workerCount = 0;
      for (const w of workers) {
        dispatcherService.sendCommandToWorker(w.token, 'launch_chrome');
        workerCount++;
      }

      res.json({
        success: true,
        localLaunch: localLaunchResult,
        broadcastedWorkersCount: workerCount,
        message: `Chrome CDP 启动指令已成功处理并广播到 ${workerCount} 个活动节点！`
      });
    } catch (e: any) {
      console.error('❌ CDP 智能唤醒 Chrome 异常:', e);
      res.status(500).json({ error: e.message });
    }
  });

  const oldConfigPath = path.join(__dirname, 'config.json');
  
  // 迁移逻辑
  if (!fs.existsSync(configPath) && fs.existsSync(oldConfigPath)) {
    try {
      fs.copyFileSync(oldConfigPath, configPath);
    } catch (e) {}
  }

  const defaultConfig = { 
    systemDownloadsDir: path.join(os.homedir(), 'Downloads'),
    xhsHomepageUrl: '',
    pasteMin: 5,
    pasteMax: 5,
    clickMin: 8,
    clickMax: 8,
    downloadMin: 120,
    downloadMax: 120,
    taskMin: 5,
    taskMax: 5,
    downloadCheckDelay: 1,
    downloadRetries: 3,
    imageQuality: 'performance',
    watermarkRoiWPercent: 15,
    watermarkRoiHPercent: 10,
    videoConcurrency: 3,
    dispatchStrategy: 'all',
    globalConcurrency: 3,
    headless: true,
    xhsPrompt: `【核心要求：请务必深度结合我上传的“小红书封面图片”以及下方的视频分镜描述来创作。你生成的一切内容（包含标题、正文、情感基调与话题）都应该与这张封面图的视觉主题、画面主体、配色、情绪和文字标签高度契合，体现出根据封面图量身定制的原生质感。】

你是一个小红书爆款文案专家。请结合我上传的封面图片，并根据以下提供的视频分镜画面描述，为我制作一个小红书发布的标题、正文和话题标签：

视频分镜详情：
{storyboardTexts}

请遵循以下极严限制：
1. **标题**（xhsTitle）：标题必须短小精悍且极具吸引力（例如使用爆款问句、感叹句、情绪词、emoji），且**总字数（包含文字、标点、特殊符号和emoji）绝对不能超过20字**（严格 ≤ 20字）。
2. **正文**（xhsBody）：正文要求生动活泼，语气要像小红书个人博主日常分享，分段清晰，善用表情符号/emoji。**绝对不能出现任何营销、导流、推广、购买、加好友、链接、加微信等政治敏感/营销广告引导语**，以天然真实原生态分享为主。
3. **话题**（xhsTags）：精选**刚好 10 个**极具热度和深度相关的爆款小红书话题。格式为“#话题1 #话题2 ...”，每个话题带#号，空格隔开，严格返回正好 10 个，不能多也不能少。

请使用以下标准的纯JSON格式返回：
{
  "xhsTitle": "20字内极富吸引力小红书标题",
  "xhsBody": "元气活泼的小红书正文...",
  "xhsTags": "#话题1 #话题2 #话题3 #话题4 #话题5 #话题6 #话题7 #话题8 #话题9 #话题10"
}`
  };

  app.get('/api/config', (req, res) => {
    if (fs.existsSync(configPath)) {
      try {
        const savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        res.json({ ...defaultConfig, ...savedConfig });
      } catch (e) {
        res.json(defaultConfig);
      }
    } else {
      res.json(defaultConfig);
    }
  });

  app.post('/api/config', requireAdmin, (req, res) => {
    try {
        const body = req.body;
        console.log(`[Config] Admin is updating config...`, body);

        if (!body.xhsPrompt || !body.xhsPrompt.trim()) {
            return res.status(400).json({ error: '小红书笔记提示词不能为空！' });
        }
        
        // 1. Save to File
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(configPath, JSON.stringify(body, null, 2));
        
        // 2. Save to Database
        const configJson = JSON.stringify(body);
        try {
            const hasEntry = db.prepare('SELECT 1 FROM system_config WHERE key = ?').get('app_config');
            if (hasEntry) {
                // 如果数据库还没有 updated_at 列，这条语句可能会在第一次运行时失败
                // 没关系，上面的补全逻辑会自动处理，或者我们这里直接更新 value
                db.prepare('UPDATE system_config SET value = ? WHERE key = ?').run(configJson, 'app_config');
                // 尝试更新一下时间戳，即使没有这一列也不影响主流程
                try { db.exec("UPDATE system_config SET updated_at = CURRENT_TIMESTAMP WHERE key = 'app_config'"); } catch(e){}
            } else {
                db.prepare('INSERT INTO system_config (key, value) VALUES (?, ?)').run('app_config', configJson);
            }
            console.log(`[Config] DB sync successful.`);
        } catch (dbErr) {
            console.error(`[Config] DB sync failed:`, dbErr);
            // Non-fatal for the file save, but let's log it
        }
        
        // 3. Poke Dispatcher
        if (dispatcherService && typeof dispatcherService.poke === 'function') {
            dispatcherService.poke();
            console.log(`[Config] Dispatcher poked.`);
        }
        
        res.json({ success: true });
    } catch (e: any) {
        console.error(`[Config] Route Error:`, e);
        res.status(500).json({ error: e.message || 'Internal Server Error' });
    }
  });

  app.post('/api/admin/realesrgan/setup', requireAdmin, async (req, res) => {
    try {
      console.log('[Real-ESRGAN Setup] Initiated via API...');
      const execPath = await downloadAndSetupRealESRGAN((msg) => {
        console.log(`[Real-ESRGAN Setup Progress] ${msg}`);
      });

      // Automatically update the config to use this path
      let config: any = {};
      try {
        const configRow = db.prepare('SELECT value FROM system_config WHERE key = ?').get('app_config') as any;
        if (configRow && configRow.value) {
          config = JSON.parse(configRow.value);
        }
      } catch (e) {}

      config.realesrganPath = execPath;

      // Save to File
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

      // Save to Database
      const configJson = JSON.stringify(config);
      try {
        const hasEntry = db.prepare('SELECT 1 FROM system_config WHERE key = ?').get('app_config');
        if (hasEntry) {
          db.prepare('UPDATE system_config SET value = ? WHERE key = ?').run(configJson, 'app_config');
          try { db.exec("UPDATE system_config SET updated_at = CURRENT_TIMESTAMP WHERE key = 'app_config'"); } catch(e){}
        } else {
          db.prepare('INSERT INTO system_config (key, value) VALUES (?, ?)').run('app_config', configJson);
        }
      } catch (dbErr) {
        console.error(`[Real-ESRGAN Setup] DB sync failed:`, dbErr);
      }

      res.json({ success: true, path: execPath, message: '部署成功！执行路径已自动配置。' });
    } catch (e: any) {
      console.error('[Real-ESRGAN Setup] Error:', e);
      res.status(500).json({ error: e.message || '部署失败，请检查网络连接。' });
    }
  });

  // Open Background Music Folder (BGM) in OS File Explorer (Admin only)
  app.post('/api/config/open-bgm', requireAuth, requireAdmin, (req, res) => {
    try {
      if (!fs.existsSync(bgmDir)) {
        fs.mkdirSync(bgmDir, { recursive: true });
      }

      const platform = process.platform;
      let command = '';
      if (platform === 'win32') {
        command = `explorer.exe "${bgmDir.replace(/\//g, '\\')}"`;
      } else if (platform === 'darwin') {
        command = `open "${bgmDir}"`;
      } else {
        command = `xdg-open "${bgmDir}"`;
      }

      console.log(`[BGM] Executing command: ${command}`);
      exec(command, (err) => {
        if (err) {
          console.error('[BGM] Failed to open folder using OS command:', err);
          return res.status(500).json({ error: `无法调用系统命令打开目录: ${err.message}. 该目录路径为: ${bgmDir}` });
        }
        res.json({ success: true, message: '成功调用系统打开指定目录', path: bgmDir });
      });
    } catch (e: any) {
      console.error('[BGM] Error opening folder:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // Get all downloaded images
  app.get('/api/images', requireAuth, checkAccess, async (req: any, res) => {
    const user = req.session.user;
    
    let query = 'SELECT assets.*, users.username FROM assets LEFT JOIN users ON assets.user_id = users.id WHERE type = ?';
    let params: any[] = ['image'];

    if (user.role !== 'admin') {
      query += ' AND assets.user_id = ?';
      params.push(user.id);
    }

    query += ' ORDER BY assets.created_at DESC';

    try {
      const rows = db.prepare(query).all(...params) as any[];
      const results = await Promise.all(rows.map(async (row) => {
        const filePath = row.file_path.replace(/\\/g, '/');
        const absPath = path.join(downloadDir, row.file_path);
        let resolutionTag = '1K';
        
        if (fs.existsSync(absPath)) {
          try {
            const meta = await sharp(absPath).metadata();
            if (meta.width && meta.height) {
              const maxDim = Math.max(meta.width, meta.height);
              const minDim = Math.min(meta.width, meta.height);
              if (maxDim >= 3200 || minDim >= 2160) {
                resolutionTag = '4K';
              } else if (maxDim >= 2000 || minDim >= 1400) {
                resolutionTag = '2K';
              }
            }
          } catch (e) {
            // ignore
          }
        }
        
        return {
          id: row.id,
          path: filePath,
          userId: row.user_id,
          username: row.username,
          createdAt: row.created_at,
          groupId: row.group_id,
          resolutionTag
        };
      }));
      res.json(results);
    } catch (err) {
      console.error('Failed to read images from DB:', err);
      res.status(500).json({ error: 'Failed to read images' });
    }
  });

  // Get all custom asset groups (folders)
  app.get('/api/groups', requireAuth, checkAccess, (req: any, res) => {
    const user = req.session.user;
    let query = 'SELECT * FROM asset_groups';
    let params: any[] = [];
    if (user.role !== 'admin') {
      query += ' WHERE user_id = ?';
      params.push(user.id);
    }
    query += ' ORDER BY created_at DESC';
    try {
      const rows = db.prepare(query).all(...params) as any[];
      res.json(rows);
    } catch (err) {
      console.error('Failed to read groups from DB:', err);
      res.status(500).json({ error: 'Failed to read groups' });
    }
  });

  // Create a new custom group
  app.post('/api/groups', requireAuth, checkAccess, (req: any, res) => {
    const user = req.session.user;
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: '组名不能为空' });
    }
    try {
      const stmt = db.prepare('INSERT INTO asset_groups (user_id, name) VALUES (?, ?)');
      const result = stmt.run(user.id, name.trim());
      res.json({ success: true, id: result.lastInsertRowid, user_id: user.id, name: name.trim() });
    } catch (err) {
      console.error('Failed to create group:', err);
      res.status(500).json({ error: 'Failed to create group' });
    }
  });

  // Move an asset to a custom group (or set to null, i.e. move out of any group)
  app.post('/api/groups/move', requireAuth, checkAccess, (req: any, res) => {
    const user = req.session.user;
    const { filePath, groupId } = req.body;
    if (!filePath) {
      return res.status(400).json({ error: '缺少图片路径' });
    }
    // Normalize path to match DB representation
    const dbPath1 = filePath.replace(/\//g, '\\');
    const dbPath2 = filePath.replace(/\\/g, '/');
    const parsedGroupId = groupId === null ? null : parseInt(groupId, 10);
    try {
      // Check if group belongs to user if not admin
      if (parsedGroupId !== null && !isNaN(parsedGroupId) && user.role !== 'admin') {
        const group = db.prepare('SELECT * FROM asset_groups WHERE id = ? AND user_id = ?').get(parsedGroupId, user.id);
        if (!group) {
          return res.status(403).json({ error: '无权操作此分组' });
        }
      }
      
      const stmt = db.prepare('UPDATE assets SET group_id = ? WHERE (file_path = ? OR file_path = ?) AND type = ?');
      const result = stmt.run(parsedGroupId, dbPath1, dbPath2, 'image');
      
      res.json({ success: true, changes: result.changes });
    } catch (err) {
      console.error('Failed to move asset to group:', err);
      res.status(500).json({ error: 'Failed to move asset to group' });
    }
  });

  // Delete a group only if it's empty
  app.delete('/api/groups/:id', requireAuth, checkAccess, (req: any, res) => {
    const user = req.session.user;
    const groupId = parseInt(req.params.id, 10);
    if (isNaN(groupId)) {
      return res.status(400).json({ error: '无效的分组ID' });
    }
    try {
      // 1. Verify existence and ownership if user is not admin
      const groupQuery = user.role === 'admin'
        ? 'SELECT * FROM asset_groups WHERE id = ?'
        : 'SELECT * FROM asset_groups WHERE id = ? AND user_id = ?';
      const groupParams = user.role === 'admin' ? [groupId] : [groupId, user.id];
      const group = db.prepare(groupQuery).get(...groupParams) as any;
      if (!group) {
        return res.status(404).json({ error: '分组未找到或无权操作' });
      }

      // 2. Check if group contains any images
      const imagesInGroup = db.prepare('SELECT COUNT(*) as count FROM assets WHERE group_id = ?').get(groupId) as any;
      if (imagesInGroup && imagesInGroup.count > 0) {
        return res.status(400).json({ error: '该图组内存有图片，不支持删除。请先将图片移动至其他分组。' });
      }

      // 3. Delete group
      db.prepare('DELETE FROM asset_groups WHERE id = ?').run(groupId);
      res.json({ success: true });
    } catch (err) {
      console.error('Failed to delete group:', err);
      res.status(500).json({ error: 'Failed to delete group' });
    }
  });

  // Batch download images as a zip
  app.post('/api/images/batch-download', requireAuth, checkAccess, (req: any, res) => {
    const user = req.session.user;
    const { filePaths } = req.body;
    
    if (!filePaths || !Array.isArray(filePaths) || filePaths.length === 0) {
      return res.status(400).json({ error: '请先选择需要下载的图片' });
    }

    try {
      const zip = new AdmZip();
      const addedNames = new Set<string>();

      for (const filePath of filePaths) {
        if (!filePath) continue;

        // Security check: verify this user owns the asset or is an admin
        let assetQuery = 'SELECT * FROM assets WHERE (file_path = ? OR file_path = ?) AND type = ?';
        let assetParams = [filePath, filePath.replace(/\//g, '\\'), 'image'];
        
        if (user.role !== 'admin') {
          assetQuery += ' AND user_id = ?';
          assetParams.push(user.id);
        }

        const asset = db.prepare(assetQuery).get(...assetParams) as any;
        if (!asset) {
          // Skip unauthorized assets silently
          continue;
        }

        // Locate absolute path on disk
        let relativePath = filePath;
        if (relativePath.startsWith('/')) {
          relativePath = relativePath.substring(1);
        }

        let fullPath = '';
        if (relativePath.startsWith('uploads/')) {
          fullPath = path.join(__dirname, relativePath);
        } else if (relativePath.startsWith('downloads/')) {
          fullPath = path.join(__dirname, 'download', relativePath.substring('downloads/'.length));
        } else if (relativePath.startsWith('download/')) {
          fullPath = path.join(__dirname, relativePath);
        } else {
          const tryUploadPath = path.join(__dirname, 'uploads', relativePath);
          if (fs.existsSync(tryUploadPath)) {
            fullPath = tryUploadPath;
          } else {
            const tryDownloadPath = path.join(__dirname, 'download', relativePath);
            if (fs.existsSync(tryDownloadPath)) {
              fullPath = tryDownloadPath;
            } else {
              fullPath = path.join(__dirname, relativePath);
            }
          }
        }

        if (fs.existsSync(fullPath)) {
          let fileName = path.basename(fullPath);
          let baseName = fileName;
          let ext = '';
          const lastDot = fileName.lastIndexOf('.');
          if (lastDot !== -1) {
            baseName = fileName.substring(0, lastDot);
            ext = fileName.substring(lastDot);
          }

          let counter = 1;
          while (addedNames.has(fileName)) {
            fileName = `${baseName}_${counter}${ext}`;
            counter++;
          }
          addedNames.add(fileName);

          zip.addLocalFile(fullPath, '', fileName);
        }
      }

      if (addedNames.size === 0) {
        return res.status(404).json({ error: '选中的图片在服务器上未找到，无法打包' });
      }

      const zipBuffer = zip.toBuffer();
      
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename=images_batch_download_${Date.now()}.zip`);
      res.setHeader('Content-Length', zipBuffer.length);
      res.send(zipBuffer);

    } catch (err: any) {
      console.error('Batch download failed:', err);
      res.status(500).json({ error: `批量打包下载失败: ${err.message || err}` });
    }
  });

  // Batch move images to a group
  app.post('/api/groups/batch-move', requireAuth, checkAccess, (req: any, res) => {
    const user = req.session.user;
    const { filePaths, groupId } = req.body;
    
    if (!filePaths || !Array.isArray(filePaths) || filePaths.length === 0) {
      return res.status(400).json({ error: '未选择任何图片' });
    }

    const parsedGroupId = groupId === null ? null : parseInt(groupId, 10);
    try {
      if (parsedGroupId !== null && !isNaN(parsedGroupId) && user.role !== 'admin') {
        const group = db.prepare('SELECT * FROM asset_groups WHERE id = ? AND user_id = ?').get(parsedGroupId, user.id);
        if (!group) {
          return res.status(403).json({ error: '无权操作此分组' });
        }
      }

      const stmt = db.prepare('UPDATE assets SET group_id = ? WHERE (file_path = ? OR file_path = ?) AND type = ?' + (user.role === 'admin' ? '' : ' AND user_id = ?'));
      
      let updatedCount = 0;
      db.transaction(() => {
        for (const fp of filePaths) {
          const dbPath1 = fp.replace(/\//g, '\\');
          const dbPath2 = fp.replace(/\\/g, '/');
          const params = user.role === 'admin' 
            ? [parsedGroupId, dbPath1, dbPath2, 'image'] 
            : [parsedGroupId, dbPath1, dbPath2, 'image', user.id];
          const resInfo = stmt.run(...params);
          updatedCount += resInfo.changes;
        }
      })();

      res.json({ success: true, updatedCount });
    } catch (err) {
      console.error('Failed to batch move assets:', err);
      res.status(500).json({ error: '批量移动图片失败' });
    }
  });

  // Get all downloaded videos
  app.get('/api/videos', requireAuth, checkAccess, async (req: any, res) => {
    const user = req.session.user;

    let query = 'SELECT assets.*, users.username, tasks.data AS task_data FROM assets LEFT JOIN users ON assets.user_id = users.id LEFT JOIN tasks ON assets.job_id = tasks.id WHERE assets.type = ?';
    let params: any[] = ['video'];

    if (user.role !== 'admin') {
      query += ' AND assets.user_id = ?';
      params.push(user.id);
    }

    query += ' ORDER BY assets.created_at DESC';

    try {
      const rows = db.prepare(query).all(...params) as any[];
      const results = await Promise.all(rows.map(async (row) => {
        let taskData = null;
        try { if (row.task_data) taskData = JSON.parse(row.task_data); } catch(e) {}
        
        let resolutionTag = '1K';
        
        // Check if the video has storyboards in taskData to inspect first image resolution
        if (taskData && taskData.storyboards && taskData.storyboards.length > 0) {
          const firstImg = taskData.storyboards[0].image;
          if (firstImg) {
            let relativeImgPath = firstImg;
            if (relativeImgPath.startsWith('/uploads/')) {
              relativeImgPath = relativeImgPath.replace('/uploads/', 'uploads/');
            } else if (relativeImgPath.startsWith('/downloads/')) {
              relativeImgPath = relativeImgPath.replace('/downloads/', 'download/');
            } else if (relativeImgPath.startsWith('download/')) {
              // keep as is
            } else if (!relativeImgPath.startsWith('uploads/')) {
              relativeImgPath = 'download/' + relativeImgPath;
            }
            
            const absImgPath = path.join(process.cwd(), relativeImgPath);
            if (fs.existsSync(absImgPath)) {
              try {
                const meta = await sharp(absImgPath).metadata();
                if (meta.width && meta.height) {
                  const maxDim = Math.max(meta.width, meta.height);
                  const minDim = Math.min(meta.width, meta.height);
                  if (maxDim >= 3200 || minDim >= 2160) {
                    resolutionTag = '4K';
                  } else if (maxDim >= 2000 || minDim >= 1400) {
                    resolutionTag = '2K';
                  }
                }
              } catch (e) {
                // ignore
              }
            }
          }
        }
        
        return {
          path: row.file_path.replace(/\\/g, '/'),
          userId: row.user_id,
          username: row.username,
          createdAt: row.created_at,
          jobId: row.job_id,
          taskData: taskData,
          resolutionTag
        };
      }));
      res.json(results);
    } catch (err) {
      console.error('Failed to read videos from DB:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Save Xiaohongshu metadata for a video
  app.post('/api/videos/xhs', requireAuth, checkAccess, (req: any, res) => {
    const { videoPath, taskData } = req.body;
    if (!videoPath) return res.status(400).json({ error: 'Video path required' });

    try {
      if (taskData.xhsCoverImage && taskData.xhsCoverImage.startsWith('data:image')) {
        const matches = taskData.xhsCoverImage.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
        if (matches) {
          const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
          const base64Data = matches[2];
          const filename = `ref_xhs_cover_${Date.now()}_${Math.floor(Math.random()*10000)}.${ext}`;
          
          const userUploadsDir = path.join(getUserStoragePath(req, uploadsDir));
          if (!fs.existsSync(userUploadsDir)) fs.mkdirSync(userUploadsDir, { recursive: true });

          const relativePath = path.join(req.session.user.id.toString(), filename);
          fs.writeFileSync(path.join(userUploadsDir, filename), base64Data, 'base64');
          try { db.prepare('INSERT OR IGNORE INTO assets (user_id, type, file_path) VALUES (?, ?, ?)').run(req.session.user.id, 'upload', `uploads/${relativePath}`); } catch(e) {}
          taskData.xhsCoverImage = `/uploads/${req.session.user.id}/${filename}`;
        }
      }

      const dbPath = videoPath.replace(/\//g, '\\');
      const asset = db.prepare('SELECT * FROM assets WHERE file_path = ? OR file_path = ?').get(videoPath, dbPath) as any;
      if (!asset) return res.status(404).json({ error: 'Video not found' });
      
      let jobId = asset.job_id;
      if (!jobId) {
        jobId = Date.now().toString() + Math.floor(Math.random()*1000);
        db.prepare('UPDATE assets SET job_id = ? WHERE id = ?').run(jobId, asset.id);
        db.prepare('INSERT INTO tasks (id, type, status, data, user_id, retry_count) VALUES (?, ?, ?, ?, ?, ?)').run(jobId, 'video_generation', 'completed', JSON.stringify(taskData), asset.user_id, 0);
      } else {
        const taskRow = db.prepare('SELECT data FROM tasks WHERE id = ?').get(jobId) as any;
        let existingData = {};
        if (taskRow && taskRow.data) {
          try { existingData = JSON.parse(taskRow.data); } catch(e) {}
        }
        const newData = { ...existingData, ...taskData };
        db.prepare('UPDATE tasks SET data = ? WHERE id = ?').run(JSON.stringify(newData), jobId);
      }
      
      res.json({ success: true, jobId, coverImage: taskData.xhsCoverImage });
    } catch (err) {
      console.error('Failed to save XHS data:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Pack and download Xiaohongshu notes: video, copy, and cover image in a single ZIP
  app.post('/api/videos/xhs/download-package', requireAuth, checkAccess, async (req: any, res) => {
    const { videoPath, coverPath, title, content, tags } = req.body;
    if (!videoPath) {
      return res.status(400).json({ error: '必须指定视频路径' });
    }

    try {
      const zip = new AdmZip();
      let hasFile = false;

      // Helper function to recursively find a file within a directory tree
      const findFileRecursive = (base: string, targetName: string): string => {
        if (!fs.existsSync(base)) return '';
        const items = fs.readdirSync(base);
        for (const item of items) {
          const full = path.join(base, item);
          try {
            if (fs.statSync(full).isDirectory()) {
              const found = findFileRecursive(full, targetName);
              if (found) return found;
            } else {
              if (item === targetName) {
                return full;
              }
            }
          } catch (e) {
            // ignore permission errors, etc.
          }
        }
        return '';
      };

      // 1. Add video file
      let fullVideoPath = '';
      const cleanVideo = videoPath.split('?')[0];
      
      console.log(`📦 [XHS Pack] Resolving videoPath: "${videoPath}" (clean: "${cleanVideo}")`);

      // Try absolute or relative resolution strategies
      if (cleanVideo.startsWith('/downloads/')) {
        fullVideoPath = path.join(downloadDir, cleanVideo.substring('/downloads/'.length));
      } else if (cleanVideo.startsWith('/uploads/')) {
        fullVideoPath = path.join(uploadsDir, cleanVideo.substring('/uploads/'.length));
      } else if (cleanVideo.startsWith('downloads/')) {
        fullVideoPath = path.join(downloadDir, cleanVideo.substring('downloads/'.length));
      } else if (cleanVideo.startsWith('uploads/')) {
        fullVideoPath = path.join(uploadsDir, cleanVideo.substring('uploads/'.length));
      } else {
        // Try direct combinations of sub-paths or users structure
        const pathsToTry = [
          path.join(videoDownloadDir, cleanVideo),
          path.join(downloadDir, cleanVideo),
          path.join(uploadsDir, cleanVideo),
          path.join(videoDownloadDir, path.basename(cleanVideo)),
          path.join(downloadDir, path.basename(cleanVideo)),
          path.join(uploadsDir, path.basename(cleanVideo)),
        ];

        for (const p of pathsToTry) {
          if (fs.existsSync(p)) {
            fullVideoPath = p;
            break;
          }
        }

        // If still not found, do a robust recursive search in videoDownloadDir and downloadDir
        if (!fullVideoPath || !fs.existsSync(fullVideoPath)) {
          const baseName = path.basename(cleanVideo);
          console.log(`🔍 [XHS Pack] Video file not found via direct paths. Searching recursively for "${baseName}"...`);
          
          let foundPath = findFileRecursive(videoDownloadDir, baseName);
          if (!foundPath) foundPath = findFileRecursive(downloadDir, baseName);
          if (!foundPath) foundPath = findFileRecursive(uploadsDir, baseName);

          if (foundPath) {
            fullVideoPath = foundPath;
            console.log(`🎯 [XHS Pack] Found video file recursively at: "${fullVideoPath}"`);
          }
        }
      }

      if (fullVideoPath && fs.existsSync(fullVideoPath)) {
        console.log(`✅ [XHS Pack] Video verified at: "${fullVideoPath}"`);
        const videoExt = path.extname(fullVideoPath) || '.mp4';
        zip.addLocalFile(fullVideoPath, '', `小红书视频_${Date.now()}${videoExt}`);
        hasFile = true;
      } else {
        console.warn(`❌ [XHS Pack] Video NOT found anywhere: "${videoPath}"`);
      }

      // 2. Add cover image
      if (coverPath) {
        console.log(`📸 [XHS Pack] Resolving coverPath: "${coverPath}"`);
        if (coverPath.startsWith('data:image')) {
          const matches = coverPath.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
          if (matches) {
            const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
            const base64Data = matches[2];
            const buffer = Buffer.from(base64Data, 'base64');
            zip.addFile(`小红书封面_${Date.now()}.${ext}`, buffer);
            hasFile = true;
            console.log(`✅ [XHS Pack] Base64 Cover added successfully.`);
          }
        } else {
          let fullCoverPath = '';
          const cleanCover = coverPath.split('?')[0];
          
          if (cleanCover.startsWith('/downloads/')) {
            fullCoverPath = path.join(downloadDir, cleanCover.substring('/downloads/'.length));
          } else if (cleanCover.startsWith('/uploads/')) {
            fullCoverPath = path.join(uploadsDir, cleanCover.substring('/uploads/'.length));
          } else if (cleanCover.startsWith('downloads/')) {
            fullCoverPath = path.join(downloadDir, cleanCover.substring('downloads/'.length));
          } else if (cleanCover.startsWith('uploads/')) {
            fullCoverPath = path.join(uploadsDir, cleanCover.substring('uploads/'.length));
          } else {
            const pathsToTry = [
              path.join(downloadDir, cleanCover),
              path.join(uploadsDir, cleanCover),
              path.join(downloadDir, path.basename(cleanCover)),
              path.join(uploadsDir, path.basename(cleanCover)),
            ];

            for (const p of pathsToTry) {
              if (fs.existsSync(p)) {
                fullCoverPath = p;
                break;
              }
            }

            if (!fullCoverPath || !fs.existsSync(fullCoverPath)) {
              const baseName = path.basename(cleanCover);
              console.log(`🔍 [XHS Pack] Cover image not found via direct paths. Searching recursively for "${baseName}"...`);
              
              let foundPath = findFileRecursive(downloadDir, baseName);
              if (!foundPath) foundPath = findFileRecursive(uploadsDir, baseName);

              if (foundPath) {
                fullCoverPath = foundPath;
                console.log(`🎯 [XHS Pack] Found cover image recursively at: "${fullCoverPath}"`);
              }
            }
          }

          if (fullCoverPath && fs.existsSync(fullCoverPath)) {
            console.log(`✅ [XHS Pack] Cover image verified at: "${fullCoverPath}"`);
            const imgExt = path.extname(fullCoverPath) || '.jpg';
            zip.addLocalFile(fullCoverPath, '', `小红书封面_${Date.now()}${imgExt}`);
            hasFile = true;
          } else {
            console.warn(`❌ [XHS Pack] Cover image NOT found anywhere: "${coverPath}"`);
          }
        }
      }

      // 3. Add copy content txt file (文案及标题)
      const txtContent = `【小红书笔记标题】
${title || ''}

【小红书笔记话题】
${tags || ''}

【小红书笔记正文】
${content || ''}
`;
      const txtBuffer = Buffer.from(txtContent, 'utf-8');
      zip.addFile('小红书文案与标题.txt', txtBuffer);
      hasFile = true;

      if (!hasFile) {
        return res.status(404).json({ error: '未找到任何可打包的文件资源' });
      }

      const zipBuffer = zip.toBuffer();
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename=xhs_package_${Date.now()}.zip`);
      res.setHeader('Content-Length', zipBuffer.length);
      res.send(zipBuffer);

    } catch (err: any) {
      console.error('Failed to package xhs resources:', err);
      res.status(500).json({ error: `打包失败: ${err.message || err}` });
    }
  });

  // Schedule or Publish a Xiaohongshu Note
  app.post('/api/videos/xhs/publish', requireAuth, checkAccess, async (req: any, res) => {
    const { videoPath, coverPath, title, content, tags, scheduledAt, isDraft } = req.body;
    const user = req.session.user;
    if (!videoPath) return res.status(400).json({ error: '请指定视频路径' });

    try {
      let finalCoverPath = coverPath;
      if (!finalCoverPath) {
        try {
          const dbPath = videoPath.replace(/\//g, '\\');
          const asset = db.prepare('SELECT * FROM assets WHERE file_path = ? OR file_path = ?').get(videoPath, dbPath) as any;
          if (asset && asset.job_id) {
            const taskRow = db.prepare('SELECT data FROM tasks WHERE id = ?').get(asset.job_id) as any;
            if (taskRow && taskRow.data) {
              const data = JSON.parse(taskRow.data);
              if (data.storyboards && Array.isArray(data.storyboards) && data.storyboards.length > 0) {
                finalCoverPath = data.storyboards[0].image;
              }
            }
          }
        } catch (e) {
          console.error('Failed to get database fallback cover path:', e);
        }
      }

      const finalIsDraft = isDraft ? 1 : 0;
      const finalScheduledAt = finalIsDraft ? null : (scheduledAt || null);

      const result = db.prepare(`
        INSERT INTO xhs_notes (user_id, video_path, cover_path, title, content, tags, scheduled_at, is_draft, publish_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(user.id, videoPath, finalCoverPath || null, title || null, content || null, tags || null, finalScheduledAt, finalIsDraft, 'pending');

      const noteId = result.lastInsertRowid as number;

      // If scheduledAt is null or empty, publish immediately in the background
      if (!finalScheduledAt) {
        executeXhsPublish(noteId).catch(err => {
          console.error(`Error executing immediate publish for note ${noteId}:`, err);
        });
      }

      res.json({ success: true, noteId, scheduled: !!scheduledAt });
    } catch (err: any) {
      console.error('Failed to schedule/publish XHS note:', err);
      res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  // Get all Xiaohongshu Note Publishing Summaries
  app.get('/api/xhs-notes', requireAuth, checkAccess, (req: any, res) => {
    const user = req.session.user;
    let query = 'SELECT xhs_notes.*, users.username FROM xhs_notes LEFT JOIN users ON xhs_notes.user_id = users.id';
    const params: any[] = [];

    if (user.role !== 'admin') {
      query += ' WHERE xhs_notes.user_id = ?';
      params.push(user.id);
    }

    query += ' ORDER BY xhs_notes.created_at DESC';

    try {
      const rows = db.prepare(query).all(...params);
      res.json(rows);
    } catch (err: any) {
      console.error('Failed to query xhs notes summaries:', err);
      res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  // Delete an XHS Note record from summary
  app.post('/api/xhs-notes/delete', requireAuth, checkAccess, (req: any, res) => {
    const { id } = req.body;
    const user = req.session.user;
    if (!id) return res.status(400).json({ error: 'Missing note ID' });

    try {
      if (user.role === 'admin') {
        db.prepare('DELETE FROM xhs_notes WHERE id = ?').run(id);
      } else {
        db.prepare('DELETE FROM xhs_notes WHERE id = ? AND user_id = ?').run(id, user.id);
      }
      res.json({ success: true });
    } catch (err: any) {
      console.error('Failed to delete note record:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Update an XHS Note record (title, content, tags, scheduled_at, publish_url, is_draft)
  app.post('/api/xhs-notes/update', requireAuth, checkAccess, (req: any, res) => {
    const { id, title, content, tags, scheduledAt, publishUrl, isDraft } = req.body;
    const user = req.session.user;
    if (!id) return res.status(400).json({ error: 'Missing note ID' });

    try {
      const finalIsDraft = isDraft ? 1 : 0;
      const finalScheduledAt = finalIsDraft ? null : (scheduledAt || null);

      let runResult;
      if (user.role === 'admin') {
        runResult = db.prepare(`
          UPDATE xhs_notes 
          SET title = ?, content = ?, tags = ?, scheduled_at = ?, is_draft = ?, publish_url = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(title || null, content || null, tags || null, finalScheduledAt, finalIsDraft, publishUrl || null, id);
      } else {
        runResult = db.prepare(`
          UPDATE xhs_notes 
          SET title = ?, content = ?, tags = ?, scheduled_at = ?, is_draft = ?, publish_url = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND user_id = ?
        `).run(title || null, content || null, tags || null, finalScheduledAt, finalIsDraft, publishUrl || null, id, user.id);
      }
      
      if (runResult.changes === 0) {
        return res.status(404).json({ error: '未找到该笔记或无权修改' });
      }

      res.json({ success: true });
    } catch (err: any) {
      console.error('Failed to update note record:', err);
      res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  // Get publishing status (polling endpoint for immediate publishing)
  app.get('/api/videos/xhs/publish/status/:id', requireAuth, checkAccess, (req: any, res) => {
    const noteId = parseInt(req.params.id, 10);
    if (isNaN(noteId)) return res.status(400).json({ error: 'Invalid ID' });

    const cachedProgress = xhsProgressMap.get(noteId);
    if (cachedProgress) {
      res.json(cachedProgress);
    } else {
      try {
        const row = db.prepare('SELECT publish_status, error_message FROM xhs_notes WHERE id = ?').get(noteId) as any;
        if (row) {
          res.json({
            id: noteId,
            status: row.publish_status,
            progress: row.publish_status === 'success' ? 100 : 0,
            message: row.publish_status === 'success' ? '发布成功' : (row.publish_status === 'failed' ? `发布失败: ${row.error_message}` : '排队中/定时任务')
          });
        } else {
          res.status(404).json({ error: '未找到发布记录' });
        }
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    }
  });

  function extractJSON(text: string): any {
    const cleaned = text.trim();
    
    // 1. 尝试直接解析
    try {
      return JSON.parse(cleaned);
    } catch (e) {}

    // 2. 尝试提取 Markdown json 代码块包裹
    const markdownRegex = /```(?:json|JSON)?\s*([\s\S]*?)\s*```/;
    const match = cleaned.match(markdownRegex);
    if (match) {
      const blockContent = match[1].trim();
      try {
        return JSON.parse(blockContent);
      } catch (e) {}
    }

    // 3. 寻找最外层的 { 和 } 括号
    const firstOpen = cleaned.indexOf('{');
    const lastClose = cleaned.lastIndexOf('}');
    if (firstOpen !== -1 && lastClose !== -1 && lastClose > firstOpen) {
      const jsonCandidate = cleaned.substring(firstOpen, lastClose + 1);
      try {
        return JSON.parse(jsonCandidate);
      } catch (e) {}

      // 4. 清理末尾多余逗号后重试
      let fuzzyClean = jsonCandidate.trim();
      fuzzyClean = fuzzyClean.replace(/,\s*([\]}])/g, '$1');
      try {
        return JSON.parse(fuzzyClean);
      } catch (e) {}
    }

    // 5. 正则提取降级容错方案（当大模型未按规范输出 JSON，但通过自然语言包含了这些关键内容时，仍可容错转换）
    try {
      const xhsTitleMatch = text.match(/(?:xhsTitle|标题|Title)["'：\s]+([^"'\n]+)/i);
      const xhsTagsMatch = text.match(/(?:xhsTags|标签|话题|Tags)["'：\s]+([^"'\n]+)/i);
      
      let xhsBody = '';
      const bodyMatch = text.match(/(?:xhsBody|正文|内容|Body)["'：\s]+([\s\S]+?)(?=(?:"?xhsTags|标签|话题|Tags|$))/i);
      if (bodyMatch) {
        xhsBody = bodyMatch[1].trim();
        xhsBody = xhsBody.replace(/^["'\s]+|["'\s]+$/g, '');
      } else {
        xhsBody = text;
      }

      if (xhsTitleMatch) {
        return {
          xhsTitle: xhsTitleMatch[1].trim().replace(/^["'\s]+|["'\s]+$/g, ''),
          xhsBody: xhsBody,
          xhsTags: xhsTagsMatch ? xhsTagsMatch[1].trim().replace(/^["'\s]+|["'\s]+$/g, '') : "#话题"
        };
      }
    } catch (e) {}

    throw new Error("无法从回复中解析出具有标准结构的 JSON 文档。原始内容为: " + text);
  }

  async function generateWithGemini(promptText: string, imgData?: { data: string; mimeType: string }) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("内置的 GEMINI_API_KEY 环境变量未设置（请在系统后台或 Key 容器中保存配置）。");
    }
    const ai = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });

    let contents: any = promptText;
    if (imgData) {
      contents = {
        parts: [
          {
            inlineData: {
              data: imgData.data,
              mimeType: imgData.mimeType
            }
          },
          {
            text: promptText
          }
        ]
      };
    }

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: contents,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            xhsTitle: {
              type: Type.STRING,
              description: "小红书爆款标题，不超过20个字"
            },
            xhsBody: {
              type: Type.STRING,
              description: "符合人设要求的小红书正文，不带广告、加微等引流用语"
            },
            xhsTags: {
              type: Type.STRING,
              description: "10个爆款话题标签，格式固定为：#话题1 #话题2 #话题3 #话题4 #话题5 #话题6 #话题7 #话题8 #话题9 #话题10，正好十个，空格隔开"
            }
          },
          required: ["xhsTitle", "xhsBody", "xhsTags"]
        }
      }
    });

    const resultText = response.text;
    if (!resultText) {
      throw new Error("Gemini API 返回了空内容。");
    }
    return extractJSON(resultText);
  }

  // Generate Xiaohongshu metadata using OpenCode API (MiniMax M3 model) with automatic Gemini fallback
  app.post('/api/videos/xhs/generate', requireAuth, checkAccess, async (req: any, res) => {
    const { storyboards, videoName, xhsCoverImage } = req.body;

    let coverUrl = xhsCoverImage;
    if (!coverUrl && storyboards && Array.isArray(storyboards) && storyboards.length > 0) {
      coverUrl = storyboards[0]?.image;
    }

    if (!coverUrl) {
      return res.status(400).json({ error: '请先上传或生成至少一个视频分镜，或先设置您的“小红书封面图”！本系统需要根据您的封面图片为您生成针对性的标题、正文与话题标签。' });
    }

    const imgData = getXhsCoverImageBase64(coverUrl);
    if (!imgData) {
      return res.status(400).json({ error: '未能成功读取您的封面图片，请尝试重新设置或重新上传封面图片。' });
    }

    // Read config robustly from multiple sources (SQLite DB, data/config.json, and root config.json)
    let openCodeApiKey = '';
    let openCodeApiUrl = '';
    let openCodeModel = '';
    let config: any = null;

    // Source 1: SQLite database system_config table (the most updated settings populated by UI)
    try {
      const configRow = db.prepare('SELECT value FROM system_config WHERE key = ?').get('app_config') as any;
      if (configRow && configRow.value) {
        config = JSON.parse(configRow.value);
        console.log("[AI-GEN] Loaded config from SQLite database system_config table successfully.");
      }
    } catch (e: any) {
      console.warn("[AI-GEN] Failed to read from SQLite database:", e.message);
    }
    
    // First, construct the prompt texts
    let storyboardTexts = '';
    if (storyboards && Array.isArray(storyboards) && storyboards.length > 0) {
      storyboardTexts = storyboards.map((s: any, idx: number) => {
        return `分镜 ${idx + 1}: ${s.text || '（无描述）'}`;
      }).join('\n');
    } else if (videoName) {
      storyboardTexts = `视频名称/场景内容: ${videoName}`;
    } else {
      storyboardTexts = `视频场景内容: 这是一个精美的创意视频作品`;
    }

    // Load prompt template from system settings (xhsPrompt)
    const xhsPromptTemplate = (config && config.xhsPrompt) ? config.xhsPrompt : defaultConfig.xhsPrompt;
    
    // Build the dynamic prompt with placeholders replaced
    let prompt = xhsPromptTemplate;
    if (prompt.includes('{storyboardTexts}')) {
      prompt = prompt.split('{storyboardTexts}').join(storyboardTexts);
    } else if (prompt.includes('${storyboardTexts}')) {
      prompt = prompt.split('${storyboardTexts}').join(storyboardTexts);
    } else {
      prompt = prompt + `\n\n视频分镜详情：\n${storyboardTexts}`;
    }

    // Source 2: data/config.json
    if (!config) {
      const dataConfigPath = path.join(__dirname, 'data', 'config.json');
      if (fs.existsSync(dataConfigPath)) {
        try {
          config = JSON.parse(fs.readFileSync(dataConfigPath, 'utf-8'));
          console.log("[AI-GEN] Loaded config from data/config.json successfully.");
        } catch (e) {}
      }
    }

    // Source 3: Root config.json
    if (!config) {
      const rootConfigPath = path.join(__dirname, 'config.json');
      if (fs.existsSync(rootConfigPath)) {
        try {
          config = JSON.parse(fs.readFileSync(rootConfigPath, 'utf-8'));
          console.log("[AI-GEN] Loaded config from root config.json successfully.");
        } catch (e) {}
      }
    }

    if (config) {
      openCodeApiKey = config.openCodeApiKey || '';
      openCodeApiUrl = config.openCodeApiUrl || '';
      openCodeModel = config.openCodeModel || '';
    }

    if (!openCodeApiKey) {
      console.log(`[AI-GEN] 未配置 OpenCode API Key，将尝试使用内置 Gemini 服务直接生成...`);
      try {
        const fallbackData = await generateWithGemini(prompt, imgData);
        return res.json({ success: true, ...fallbackData });
      } catch (geminiErr: any) {
        console.error(`[AI-GEN] Built-in Gemini call also failed:`, geminiErr);
        return res.status(400).json({ error: '请先在系统设置中的 [AI 大模型配置] 里设置您的大模型 API Key（密钥），或确保内置 Gemini API Key 有效。' });
      }
    }

    // Default API URL is https://opencode.ai/zen/go/v1
    let baseUrl = (openCodeApiUrl || 'https://opencode.ai/zen/go/v1').trim();
    if (baseUrl.endsWith('/')) {
      baseUrl = baseUrl.substring(0, baseUrl.length - 1);
    }

    // Default model is minimax-m3
    const actualModel = (openCodeModel || 'minimax-m3').trim();
    
    // Determine clean model name for protocol check (e.g. opencode-go/minimax-m3 -> minimax-m3)
    let cleanModel = actualModel;
    if (cleanModel.startsWith('opencode-go/')) {
      cleanModel = cleanModel.substring(12);
    }

    // Identify if it's Anthropic messages-format (e.g., minimax or qwen models from OpenCode documentation)
    const isAnthropicStyle = cleanModel.includes('minimax') || cleanModel.includes('qwen') || baseUrl.includes('/messages');

    // Clean up base URL to make sure we attach the correct suffix path
    let formattedBase = baseUrl;
    const completionsSuffix = '/chat/completions';
    const messagesSuffix = '/messages';

    if (formattedBase.endsWith(completionsSuffix)) {
      formattedBase = formattedBase.substring(0, formattedBase.length - completionsSuffix.length);
    } else if (formattedBase.endsWith(messagesSuffix)) {
      formattedBase = formattedBase.substring(0, formattedBase.length - messagesSuffix.length);
    }
    if (formattedBase.endsWith('/')) {
      formattedBase = formattedBase.substring(0, formattedBase.length - 1);
    }

    let apiEndpoint = '';
    let requestBody: any = {};

    if (isAnthropicStyle) {
      apiEndpoint = `${formattedBase}/messages`;
      requestBody = {
        model: cleanModel,
        system: "You are a professional social media marketing assistant for Xiaohongshu.",
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: imgData.mimeType,
                  data: imgData.data
                }
              },
              {
                type: 'text',
                text: prompt
              }
            ]
          }
        ],
        max_tokens: 4096,
        temperature: 0.7
      };
    } else {
      apiEndpoint = `${formattedBase}/chat/completions`;
      requestBody = {
        model: cleanModel,
        messages: [
          { role: 'system', content: 'You are a professional social media marketing assistant for Xiaohongshu.' },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: prompt
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${imgData.mimeType};base64,${imgData.data}`
                }
              }
            ]
          }
        ],
        temperature: 0.7
      };
    }

    console.log(`[AI-GEN] API generating content. Model: "${cleanModel}" (Protocol: ${isAnthropicStyle ? 'Anthropic Messages' : 'OpenAI Completions'}) via ${apiEndpoint}...`);
    try {
      const apiResponse = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openCodeApiKey}`,
          ...(isAnthropicStyle ? {
            'x-api-key': openCodeApiKey,
            'anthropic-version': '2023-06-01'
          } : {})
        },
        body: JSON.stringify(requestBody)
      });

      if (!apiResponse.ok) {
        const errText = await apiResponse.text();
        const apiErrorMsg = `[AI-GEN ERROR] OpenCode API 返回了非 200 状态码 (${apiResponse.status})。`;
        
        console.error("======================================== [AI-GEN API ERROR] ========================================");
        console.error(apiErrorMsg);
        console.error(`请求地址: ${apiEndpoint}`);
        console.error(`请求模型: ${cleanModel}`);
        console.error(`API Key 长度: ${openCodeApiKey ? openCodeApiKey.length : 0} (首尾字符: ${openCodeApiKey ? openCodeApiKey.slice(0, 4) + '...' + openCodeApiKey.slice(-4) : '无'})`);
        console.error(`原始错误正文:\n${errText}`);
        console.error("====================================================================================================");
        
        return res.status(apiResponse.status).json({ 
          error: `大模型接口请求失败 (状态码 ${apiResponse.status})。\n\n大模型返回的原始错误信息：\n${errText}`
        });
      } else {
        const rawText = await apiResponse.text();
        console.log("======================================== [AI-GEN API RESPONSE] ========================================");
        console.log(`[AI-GEN] 状态码: 200 OK`);
        console.log(`[AI-GEN] 收到原始响应内容 (长度 ${rawText.length}):\n${rawText}`);
        console.log("=======================================================================================================");

        try {
          const data = JSON.parse(rawText);
          
          // Robust parser helper to extract only conversational/text content while ignoring thinking/reasoning blocks
          let content = '';
          if (data.content && Array.isArray(data.content)) {
            const textParts = data.content
              .filter((part: any) => part && (part.type === 'text' || part.text))
              .map((part: any) => part.text || '');
            content = textParts.join('\n').trim();
          }

          if (!content && data.choices && Array.isArray(data.choices) && data.choices.length > 0) {
            const choice = data.choices[0];
            if (choice) {
              if (choice.message) {
                if (typeof choice.message.content === 'string') {
                  content = choice.message.content.trim();
                } else if (Array.isArray(choice.message.content)) {
                  const textParts = choice.message.content
                    .filter((part: any) => part && (part.type === 'text' || part.text))
                    .map((part: any) => part.text || '');
                  content = textParts.join('\n').trim();
                }
              } else if (typeof choice.text === 'string') {
                content = choice.text.trim();
              }
            }
          }

          // Ultimate deep search fallback if content is still empty
          if (!content) {
            const foundTexts: string[] = [];
            const deepSearch = (obj: any) => {
              if (!obj || typeof obj !== 'object') return;
              if (obj.type === 'text' && typeof obj.text === 'string') {
                foundTexts.push(obj.text);
                return;
              }
              for (const key of Object.keys(obj)) {
                const val = obj[key];
                if (key === 'content' && typeof val === 'string') {
                  foundTexts.push(val);
                } else if (key === 'text' && typeof val === 'string') {
                  foundTexts.push(val);
                } else if (typeof val === 'object') {
                  deepSearch(val);
                }
              }
            };
            deepSearch(data);
            if (foundTexts.length > 0) {
              content = foundTexts.join('\n').trim();
            }
          }

          if (!content) {
            console.error("======================================== [AI-GEN VALIDATION ERROR] ==================================");
            console.error(`[AI-GEN] 解析失败：从返回的JSON中无法抽离出对话文本。`);
            console.error(`[AI-GEN] 原始结构为:\n`, JSON.stringify(data, null, 2));
            console.error("=====================================================================================================");
            throw new Error(`LLM 接口解析成功，但未能提取到 choices[0].message.content 或 content[0].text 文本回复。请检查您的模型 '${cleanModel}' 返回结构。`);
          }

          console.log("======================================== [AI-GEN EXTRACTED CONTENT] ===================================");
          console.log(`[AI-GEN] 提取到的对话回复正文：\n${content}`);
          console.log("=======================================================================================================");

          const parsed = extractJSON(content);
          if (parsed.xhsTitle && parsed.xhsTitle.length > 20) {
            parsed.xhsTitle = parsed.xhsTitle.substring(0, 20);
          }
          return res.json({ success: true, ...parsed });
        } catch (jsonErr: any) {
          console.error("======================================== [AI-GEN JSON PARSE EXCEPTION] ==============================");
          console.error(`[AI-GEN] 处理大模型文本时发生错误:`, jsonErr.message);
          console.error(`[AI-GEN] 无法结构化以下回答：\n${rawText}`);
          console.error("=====================================================================================================");
          
          return res.status(500).json({ 
            error: `大模型处理失败：${jsonErr.message}。\n\n大模型返回的原始数据：\n${rawText}` 
          });
        }
      }
    } catch (err: any) {
      console.error("======================================== [AI-GEN NETWORK EXCEPTION] ==============================");
      console.error(`[AI-GEN] fetch 连接大模型服务异常:`, err);
      console.error("===================================================================================================");
      
      return res.status(500).json({ 
        error: `连接大模型服务发生网络异常（${err.message || '网络连接超时'}）。` 
      });
    }
  });

  function getXhsCoverImageBase64(xhsCoverImage: string): { data: string; mimeType: string } | null {
    if (!xhsCoverImage) return null;
    
    // Strip query parameters like timestamp `?t=...`
    const cleanUrl = xhsCoverImage.split('?')[0];
    
    if (cleanUrl.startsWith('data:image/')) {
      const matches = cleanUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        return { mimeType: matches[1], data: matches[2] };
      }
      return null;
    }

    // Handle local path
    let relativePath = cleanUrl;
    if (relativePath.startsWith('/')) {
      relativePath = relativePath.substring(1);
    }

    let fullPath = '';
    if (relativePath.startsWith('uploads/')) {
      fullPath = path.join(__dirname, relativePath);
    } else if (relativePath.startsWith('downloads/')) {
      // The router maps "/downloads" to physical "__dirname/download" (singular)
      fullPath = path.join(__dirname, 'download', relativePath.substring('downloads/'.length));
    } else if (relativePath.startsWith('download/')) {
      fullPath = path.join(__dirname, relativePath);
    } else {
      const tryUploadPath = path.join(__dirname, 'uploads', relativePath);
      if (fs.existsSync(tryUploadPath)) {
        fullPath = tryUploadPath;
      } else {
        const tryDownloadPath = path.join(__dirname, 'download', relativePath);
        if (fs.existsSync(tryDownloadPath)) {
          fullPath = tryDownloadPath;
        } else {
          fullPath = path.join(__dirname, relativePath);
        }
      }
    }

    console.log(`[AI-GEN] Reading cover image from path: "${fullPath}"`);

    if (fs.existsSync(fullPath)) {
      try {
        const ext = path.extname(fullPath).toLowerCase().replace('.', '');
        let mimeType = 'image/jpeg';
        if (ext === 'png') mimeType = 'image/png';
        else if (ext === 'webp') mimeType = 'image/webp';
        else if (ext === 'gif') mimeType = 'image/gif';

        const fileBuffer = fs.readFileSync(fullPath);
        return {
          mimeType,
          data: fileBuffer.toString('base64'),
        };
      } catch (e) {
        console.error('[AI-GEN] Error reading local cover image:', e);
        return null;
      }
    }

    return null;
  }

  // Delete a downloaded video
  app.delete('/api/videos/*', requireAuth, checkAccess, (req: any, res) => {
    const user = req.session.user;
    const vidPath = req.params[0]; // Gets the full path after /api/videos/
    
    if (!vidPath) return res.status(400).json({ error: 'Video path required' });

    // Clean up DB
    try {
      db.prepare('DELETE FROM assets WHERE file_path = ? AND type = ?').run(vidPath.replace(/\\/g, '/'), 'video');
    } catch(e) {}

    // Ensure users only delete their own
    if (user.role !== 'admin') {
        const pathParts = vidPath.split('/');
        if (pathParts[0] !== user.id.toString()) {
            return res.status(403).json({ error: 'Forbidden' });
        }
    }

    const filePath = path.join(videoDownloadDir, vidPath);
    const thumbPath = path.join(videoThumbDir, vidPath.replace(/\.[^/.]+$/, ".jpg"));

    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
        
        // Cleanup history - search all potential history locations
        const filename = path.basename(vidPath);
        const allHistoryDirs = [videoHistoryDir];
        try {
            const subs = fs.readdirSync(videoHistoryDir).filter(f => fs.statSync(path.join(videoHistoryDir,f)).isDirectory());
            subs.forEach(s => allHistoryDirs.push(path.join(videoHistoryDir, s)));
        } catch(e) {}

        for (const hDir of allHistoryDirs) {
            if (fs.existsSync(hDir)) {
              const historyFiles = fs.readdirSync(hDir).filter(f => f.endsWith('.json'));
              for (const file of historyFiles) {
                try {
                  const jobPath = path.join(hDir, file);
                  const taskData = JSON.parse(fs.readFileSync(jobPath, 'utf-8'));
                  if (taskData.outputVideo === filename) {
                    fs.unlinkSync(jobPath);
                  }
                } catch (e) {}
              }
            }
        }
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: 'Failed to delete video' });
      }
    } else {
      res.status(404).json({ error: 'Video not found' });
    }
  });

  // Delete a video job record
  app.delete('/api/video/jobs/:id', (req, res) => {
    const id = req.params.id;
    
    try {
      // 1. Get task data from DB first to get userId and handle files
      const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as any;
      
      let taskData: any = null;
      let userId: string | null = null;
      
      if (task) {
        try { taskData = JSON.parse(task.data); } catch(e) {}
        userId = String(task.user_id);
      }

      // 2. Database deletion (Pre-emptive)
      db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
      db.prepare('DELETE FROM assets WHERE job_id = ?').run(id);

      // 3. File searches and deletion
      const filename = id.endsWith('.json') ? id : `${id}.json`;
      const searchPaths = [
        path.join(videoTaskDir, filename),
        path.join(videoHistoryDir, filename)
      ];

      if (userId) {
        searchPaths.push(path.join(videoTaskDir, userId, filename));
        searchPaths.push(path.join(videoHistoryDir, userId, filename));
      }

      for (const p of searchPaths) {
        if (fs.existsSync(p)) {
          if (!taskData) {
            try { taskData = JSON.parse(fs.readFileSync(p, 'utf-8')); } catch(e) {}
          }
          try { fs.unlinkSync(p); } catch(e) {}
        }
      }

      // 4. Delete associated media files
      const possibleOutputs = [];
      if (taskData?.outputVideo) possibleOutputs.push(taskData.outputVideo);
      
      for (const output of possibleOutputs) {
        const videoPath = path.join(videoDownloadDir, output);
        const thumbPath = path.join(videoThumbDir, output.replace(/\.[^/.]+$/, ".jpg"));
        if (fs.existsSync(videoPath)) try { fs.unlinkSync(videoPath); } catch(e) {}
        if (fs.existsSync(thumbPath)) try { fs.unlinkSync(thumbPath); } catch(e) {}
      }

      res.json({ success: true });
    } catch (err) {
      console.error('[VideoDelete] Error:', err);
      res.status(500).json({ error: 'Failed to delete job' });
    }
  });

  // Delete a downloaded image
  app.delete('/api/images/*', requireAuth, checkAccess, (req: any, res) => {
    const user = req.session.user;
    const imgPath = req.params[0]; // Gets the full path after /api/images/
    
    if (!imgPath) return res.status(400).json({ error: 'Image path required' });

    // Clean up DB
    try {
      db.prepare('DELETE FROM assets WHERE file_path = ? AND type = ?').run(imgPath.replace(/\\/g, '/'), 'image');
    } catch(e) {}

    // Ensure users only delete their own
    if (user.role !== 'admin') {
        const pathParts = imgPath.split('/');
        // Uploads have "uploads/userid/..." structure, normal has "userid/..."
        const targetUserId = pathParts[0] === 'uploads' ? pathParts[1] : pathParts[0];
        if (targetUserId !== user.id.toString()) {
            return res.status(403).json({ error: 'Forbidden' });
        }
    }

    const isUpload = imgPath.startsWith('uploads/');
    const baseDir = isUpload ? path.join(__dirname, 'uploads') : downloadDir;
    // For uploads we strip the "uploads/" prefix to find the physical file
    const physicalPath = isUpload ? imgPath.replace(/^uploads\//, '') : imgPath;
    
    const filePath = path.join(baseDir, physicalPath);

    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: 'Failed to delete image' });
      }
    } else {
      res.status(404).json({ error: 'Image not found' });
    }
  });

  // Upload images to gallery
  app.post('/api/images/upload', requireAuth, checkAccess, express.json({ limit: '500mb' }), (req: any, res) => {
    const userStoragePath = getUserStoragePath(req, downloadDir);
    const { images, groupId } = req.body;
    if (!images || !Array.isArray(images)) return res.status(400).json({ error: 'Invalid images' });
    
    if (!fs.existsSync(userStoragePath)) fs.mkdirSync(userStoragePath, { recursive: true });
    
    const parsedGroupId = (groupId !== undefined && groupId !== null) ? parseInt(groupId, 10) : null;
    const targetGroupId = isNaN(parsedGroupId as number) ? null : parsedGroupId;
    
    const savedFiles: string[] = [];
    images.forEach((base64: string) => {
      try {
        const matches = base64.match(/^data:image\/([a-zA-Z+]+);base64,(.+)$/);
        if (!matches) return;
        
        const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
        const data = matches[2];
        const buffer = Buffer.from(data, 'base64');
        const filename = `upload_${Date.now()}_${Math.floor(Math.random() * 1000)}.${ext}`;
        fs.writeFileSync(path.join(userStoragePath, filename), buffer);
        
        try {
            const userId = req.session.user.id;
            const relativePath = path.join(userId.toString(), filename).replace(/\\/g, '/');
            db.prepare('INSERT OR IGNORE INTO assets (user_id, type, file_path, group_id) VALUES (?, ?, ?, ?)').run(userId, 'image', relativePath, targetGroupId);
        } catch(e) {}
        
        savedFiles.push(filename);
      } catch (e) {
        console.error('Failed to save uploaded image:', e);
      }
    });
    
    res.json({ success: true, files: savedFiles });
  });

  // Update gallery image
  app.post('/api/gallery/update', requireAuth, checkAccess, express.json({ limit: '500mb' }), (req: any, res) => {
    const userStoragePath = getUserStoragePath(req, downloadDir);
    const { filename, image } = req.body;
    if (!filename || !image) return res.status(400).json({ error: 'Missing filename or image' });
    
    try {
      const matches = image.match(/^data:image\/([a-zA-Z+]+);base64,(.+)$/);
      if (!matches) return res.status(400).json({ error: 'Invalid image format' });
      
      const data = matches[2];
      const buffer = Buffer.from(data, 'base64');
      const filePath = path.join(userStoragePath, filename);
      
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Original image not found' });
      }
      
      fs.writeFileSync(filePath, buffer);
      
      // Also delete thumbnail so it gets regenerated
      const thumbPath = path.join(thumbDownloadsDir, filename);
      if (fs.existsSync(thumbPath)) {
        fs.unlinkSync(thumbPath);
      }
      
      res.json({ success: true });
    } catch (e) {
      console.error('Failed to update gallery image:', e);
      res.status(500).json({ error: 'Failed to update image' });
    }
  });

  // Copy gallery images to uploads for task reference
  app.post('/api/images/copy-to-uploads', requireAuth, (req: any, res) => {
    const { filenames } = req.body;
    const user = req.session.user;
    if (!filenames || !Array.isArray(filenames)) return res.status(400).json({ error: 'Invalid filenames' });
    
    const copiedUrls: string[] = [];
    filenames.forEach((filename: string) => {
      let sourcePath = '';
      let baseDir = '';
      if (filename.startsWith('uploads/')) {
        baseDir = uploadsDir;
        sourcePath = path.join(uploadsDir, filename.replace(/^uploads\//, ''));
      } else {
        baseDir = downloadDir;
        sourcePath = path.join(downloadDir, filename);
      }
      
      if (!fs.existsSync(sourcePath)) {
        const fallbackSourcePath = path.join(baseDir, path.basename(filename));
        if (fs.existsSync(fallbackSourcePath)) {
          sourcePath = fallbackSourcePath;
        }
      }
      
      const baseName = path.basename(filename); // Extract just the file name (no directories)
      const destFilename = `ref_gallery_${Date.now()}_${Math.floor(Math.random() * 1000)}_${baseName}`;
      
      // Save it properly in the user's upload subdirectory
      const userUploadsDir = path.join(uploadsDir, user.id.toString());
      if (!fs.existsSync(userUploadsDir)) {
          fs.mkdirSync(userUploadsDir, { recursive: true });
      }
      
      const destPath = path.join(userUploadsDir, destFilename);
      
      if (fs.existsSync(sourcePath)) {
        try {
          fs.copyFileSync(sourcePath, destPath);
          const relativeDest = path.join(user.id.toString(), destFilename).replace(/\\/g, '/');
          copiedUrls.push(`/uploads/${relativeDest}`);
        } catch (e) {
          console.error('Failed to copy image to uploads:', e);
        }
      }
    });
    
    res.json({ success: true, urls: copiedUrls });
  });

  // Find realesrgan-ncnn-vulkan executable command
  function getRealESRGANCommand(): string {
    let customPath = '';
    try {
      const configRow = db.prepare('SELECT value FROM system_config WHERE key = ?').get('app_config') as any;
      if (configRow && configRow.value) {
        const config = JSON.parse(configRow.value);
        if (config.realesrganPath && config.realesrganPath.trim()) {
          customPath = config.realesrganPath.trim();
        }
      }
    } catch (e) {}

    if (customPath) {
      if (fs.existsSync(customPath)) {
        return `"${customPath}"`;
      }
      const absCustom = path.resolve(process.cwd(), customPath);
      if (fs.existsSync(absCustom)) {
        return `"${absCustom}"`;
      }
      return customPath.includes(' ') ? `"${customPath}"` : customPath;
    }

    const isWin = process.platform === 'win32';
    const binName = isWin ? 'realesrgan-ncnn-vulkan.exe' : 'realesrgan-ncnn-vulkan';
    
    const possiblePaths = [
      path.join(process.cwd(), binName),
      path.join(process.cwd(), 'bin', binName),
      path.join(process.cwd(), 'tools', binName),
      path.join(process.cwd(), 'realesrgan', binName),
      path.join(process.cwd(), 'realesrgan-ncnn-vulkan', binName),
    ];
    
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        return `"${p}"`;
      }
    }
    return binName;
  }

  // Helper function to apply high-fidelity micro film grain
  async function applyFilmGrain(inputPath: string, outputPath: string, strength: number = 0.015) {
    try {
      const img = sharp(inputPath);
      const { width, height } = await img.metadata();
      if (!width || !height) return;

      console.log(`🎬 [Film Grain] Generating high-fidelity grain (${width}x${height}, strength: ${(strength * 100).toFixed(1)}%)`);

      // Allocate single-channel grayscale raw buffer for the noise map
      const pixelCount = width * height;
      const noiseBuffer = Buffer.alloc(pixelCount);
      
      // In soft-light blend, 128 is perfectly neutral (0% change).
      // The contrast/amplitude of the noise determines the grain's visibility.
      // For strength = 0.015, maxOffset = 0.015 * 128 * 10 = 19 (deviation from 128)
      const maxOffset = Math.max(5, Math.min(120, Math.round(strength * 128 * 10)));

      for (let i = 0; i < pixelCount; i++) {
        // Fast uniform random noise centered at 128
        const offset = Math.floor((Math.random() - 0.5) * 2 * maxOffset);
        noiseBuffer[i] = 128 + offset;
      }

      // Convert raw noise buffer to a sharp image
      const noiseImg = await sharp(noiseBuffer, {
        raw: {
          width,
          height,
          channels: 1
        }
      })
      .png()
      .toBuffer();

      // Composite the noise over the original image using soft-light blending
      const tempPath = `${outputPath}.grain.tmp`;
      await img
        .composite([{
          input: noiseImg,
          blend: 'soft-light'
        }])
        .toFile(tempPath);

      if (fs.existsSync(tempPath)) {
        fs.renameSync(tempPath, outputPath);
        console.log(`✅ [Film Grain] Successfully applied film grain to upscaled image: ${outputPath}`);
      }
    } catch (err: any) {
      console.error('❌ [Film Grain] Failed to apply film grain:', err);
    }
  }

  // Super-resolution (Upscale 2x) endpoint
  app.post('/api/images/upscale', requireAuth, checkAccess, async (req: any, res) => {
    const { assetId } = req.body;
    const user = req.session.user;
    
    if (!assetId) {
      return res.status(400).json({ error: '请提供图片ID (assetId is required)' });
    }
    
    try {
      // 1. Fetch asset from DB
      const row = db.prepare('SELECT * FROM assets WHERE id = ?').get(assetId) as any;
      if (!row) {
        return res.status(404).json({ error: '未找到该图片资源' });
      }
      
      // Permission check: admins can access any asset, regular users only their own
      if (user.role !== 'admin' && row.user_id !== user.id) {
        return res.status(403).json({ error: '您无权操作此图片资源' });
      }
      
      const relativeInputPath = row.file_path;
      // In the gallery, asset type is 'image', which resides relative to downloadDir
      const absoluteInputPath = path.join(downloadDir, relativeInputPath);
      
      if (!fs.existsSync(absoluteInputPath)) {
        return res.status(404).json({ error: '物理文件不存在' });
      }
      
      // 2. Validate current resolution (must not be 4K)
      let meta;
      try {
        meta = await sharp(absoluteInputPath).metadata();
      } catch (e: any) {
        return res.status(500).json({ error: `无法读取图片元数据: ${e.message}` });
      }
      
      if (meta.width && meta.height) {
        const maxDim = Math.max(meta.width, meta.height);
        const minDim = Math.min(meta.width, meta.height);
        if (maxDim >= 3200 || minDim >= 2160) {
          return res.status(400).json({ error: '该图片已是4K超高清分辨率，无需继续超分' });
        }
      }
      
      // 3. Define output filename & paths
      const ext = path.extname(relativeInputPath);
      const baseName = path.basename(relativeInputPath, ext);
      const dirName = path.dirname(relativeInputPath);
      
      // Output file path with suffix '_2x_timestamp'
      const outputFilename = `${baseName}_2x_${Date.now()}${ext}`;
      const relativeOutputPath = path.join(dirName, outputFilename).replace(/\\/g, '/');
      const absoluteOutputPath = path.join(downloadDir, relativeOutputPath);
      
      // Ensure directory exists
      fs.mkdirSync(path.dirname(absoluteOutputPath), { recursive: true });
      
      const cmdBin = getRealESRGANCommand();
      // s = 2 for 2x upscaling
      const cmd = `${cmdBin} -i "${absoluteInputPath}" -o "${absoluteOutputPath}" -s 2`;
      
      console.log(`🚀 [Super-Resolution] Attempting GPU-accelerated upscale: ${cmd}`);
      
      exec(cmd, (err, stdout, stderr) => {
        if (err) {
          console.warn(`⚠️ [Super-Resolution] GPU upscale failed or driver not supported. Error: ${err.message}. Stderr: ${stderr}`);
          console.log(`🔄 [Super-Resolution] Falling back to CPU mode (-g -1)...`);
          
          const cpuCmd = `${cmdBin} -i "${absoluteInputPath}" -o "${absoluteOutputPath}" -s 2 -g -1`;
          console.log(`🚀 [Super-Resolution] Running CPU upscale: ${cpuCmd}`);
          
          exec(cpuCmd, (cpuErr, cpuStdout, cpuStderr) => {
            if (cpuErr) {
              console.error(`❌ [Super-Resolution] CPU fallback upscale also failed! Error: ${cpuErr.message}. Stderr: ${cpuStderr}`);
              
              const isWin = process.platform === 'win32';
              const errorInstructions = isWin 
                ? '【未找到或无法执行 Real-ESRGAN 程序】\n\n请按照以下步骤解决：\n' +
                  '1. 访问官方发布页下载 Windows 版本：\n   https://github.com/xinntao/Real-ESRGAN/releases/tag/v0.1.0\n' +
                  '   (请选择 "realesrgan-ncnn-vulkan-20220424-windows.zip")\n' +
                  '2. 解压下载的压缩包，将解压后的文件夹（包含 realesrgan-ncnn-vulkan.exe 与 models 文件夹）复制到本项目根目录下。\n' +
                  '3. 或者，在系统后台的“系统参数设置”中，在“Real-ESRGAN 超分执行文件路径”中，填写解压出来的 .exe 文件的【绝对路径】(例如: F:\\tools\\realesrgan-ncnn-vulkan.exe)。'
                : '【未找到或无法执行 Real-ESRGAN 程序】\n\n请确保您的系统安装了 realesrgan-ncnn-vulkan，并在系统设置中配置了正确的命令或绝对路径。';
              
              return res.status(500).json({ 
                error: `超分环境未就绪！\n\n${errorInstructions}\n\n系统错误详情: ${cpuErr.message}` 
              });
            }
            
            completeUpscale(relativeOutputPath, absoluteOutputPath, row.group_id);
          });
        } else {
          completeUpscale(relativeOutputPath, absoluteOutputPath, row.group_id);
        }
      });
      
      async function completeUpscale(relOut: string, absOut: string, groupId: number | null) {
        if (!fs.existsSync(absOut)) {
          return res.status(500).json({ error: '超分成功结束，但未生成输出文件' });
        }
        
        try {
          // Apply 1.5% cinematic film grain to neutralize AI watercolor/plastic texture and make details look 100% natural!
          await applyFilmGrain(absOut, absOut, 0.015);

          // 4. Register new upscaled asset in the database
          const stmt = db.prepare('INSERT INTO assets (user_id, type, file_path, group_id) VALUES (?, ?, ?, ?)');
          const info = stmt.run(user.id, 'image', relOut, groupId);
          const newAssetId = info.lastInsertRowid;
          
          console.log(`✅ [Super-Resolution] Successfully upscaled image. New Asset ID: ${newAssetId}`);
          
          res.json({
            success: true,
            message: '超分成功！',
            asset: {
              id: newAssetId,
              path: relOut,
              userId: user.id,
              username: user.username,
              createdAt: new Date().toISOString(),
              groupId: groupId,
              resolutionTag: '2K'
            }
          });
        } catch (dbErr: any) {
          console.error('❌ [Super-Resolution] Failed to insert upscaled asset into database:', dbErr);
          res.status(500).json({ error: `超分完成，但保存到数据库失败: ${dbErr.message}` });
        }
      }
      
    } catch (err: any) {
      console.error('❌ [Super-Resolution] Unexpected error:', err);
      res.status(500).json({ error: `超分处理发生意外错误: ${err.message}` });
    }
  });

  app.post("/api/gallery/save-manual-edit", async (req, res) => {
    const { filename, base64 } = req.body;
    if (!filename || !base64) {
      return res.status(400).json({ error: "Filename and base64 string are required" });
    }

    const filePath = path.join(downloadDir, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "File not found" });
    }

    try {
      console.log(`🖌️ [Manual Edit] Saving edited image: ${filename}`);
      // Remove data:image/...;base64, prefix
      const base64Data = base64.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, 'base64');
      
      fs.writeFileSync(filePath, buffer);
      
      // Delete thumbnail so it gets regenerated
      const thumbPath = path.join(thumbDownloadsDir, filename);
      if (fs.existsSync(thumbPath)) {
        fs.unlinkSync(thumbPath);
      }
      
      res.json({ status: "ok", message: "Image saved successfully" });
    } catch (error) {
      console.error(`❌ [Manual Edit] Failed: ${filename}`, error);
      res.status(500).json({ error: "Failed to save edited image" });
    }
  });

  // API to trigger one-click watermark removal
  app.post("/api/gallery/auto-watermark", async (req, res) => {
    const { filename, imageQuality } = req.body;
    if (!filename) return res.status(400).json({ error: "Filename is required" });

    const filePath = path.join(downloadDir, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "File not found" });
    }

    try {
      console.log(`✨ [One-Click Watermark] Processing: ${filename} (Mode: ${imageQuality || 'performance'})...`);
      const { autoInpaint } = await import("./watermarkRemover.js");
      
      const success = await autoInpaint(filePath, imageQuality || 'performance');
      
      if (success) {
        // Delete thumbnail so it gets regenerated
        const thumbPath = path.join(thumbDownloadsDir, filename);
        if (fs.existsSync(thumbPath)) {
          fs.unlinkSync(thumbPath);
        }
        res.json({ status: "ok", message: "Watermark removed successfully" });
      } else {
        res.json({ status: "ignored", message: "No watermark detected or processing skipped" });
      }
    } catch (error) {
      console.error(`❌ [One-Click Watermark] Failed: ${filename}`, error);
      res.status(500).json({ error: "Failed to process image" });
    }
  });

  // Register/Update Local Server node
  try {
    // 1. Delete potential corrupt/incomplete local records
    db.prepare("DELETE FROM workers WHERE token = 'local-server' OR id IS NULL").run();
    
    db.prepare('INSERT INTO workers (id, name, token, status, capabilities, ip_address) VALUES (?, ?, ?, ?, ?, ?)')
      .run('local-server-id', 'Local Server (Built-in)', 'local-server', 'idle', JSON.stringify(['gemini_image', 'gemini_video']), '127.0.0.1');
    console.log('[Worker] Local Server node registered successfully.');

    // 2. Reset stale local running tasks (tasks with running status but no worker_id)
    // This handles tasks that were interrupted by a server restart
    const resetCount = db.prepare("UPDATE tasks SET status = 'pending', progress = 0 WHERE status = 'running' AND (worker_id IS NULL OR worker_id = 'local-server-id')").run();
    if (resetCount.changes > 0) {
        console.log(`[Startup] Reset ${resetCount.changes} stale local running tasks to pending.`);
    }
  } catch(e) {
    console.error('Failed to initialize local server node or reset tasks:', e);
  }

  // Start the automation watcher
  startAutomationWatcher();
  
  // Start the Xiaohongshu automation watcher
  startXhsAutomationWatcher();

  // Start the video automation watcher
  const getVideoConcurrency = () => {
    try {
      const configRow = db.prepare('SELECT value FROM system_config WHERE key = ?').get('app_config') as any;
      if (configRow) {
        const config = JSON.parse(configRow.value);
        return config.videoConcurrency || 1; // Default 1
      }
    } catch (e) {}
    return 1;
  };
  startVideoAutomationWatcher(getVideoConcurrency);

  // Start Proxy Service
  proxyService.start();

  // Expose worker_dist for remote updates
  app.use('/worker-files', express.static(path.join(__dirname, 'worker_dist')));

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const httpServer = createServer(app);
  dispatcherService.attach(httpServer);

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
