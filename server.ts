process.env.TZ = 'Asia/Shanghai';
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import os from "os";
import sharp from "sharp";
import session from "express-session";
import { checkAccess, getUserStoragePath } from "./src/lib/auth-security.js";
import bcrypt from "bcryptjs";
import db from "./src/db/db.js";

declare module 'express-session' {
  interface SessionData {
    user: { id: number; username: string; role: string };
  }
}

import { startAutomationWatcher, jobProgress, handleBrowserDebug, processingImages } from "./automation.js";
import { startVideoAutomationWatcher, videoJobProgress } from "./video_automation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
    cookie: { secure: false } // Set to true in production with HTTPS
  }));

  // Auth Middleware
  const requireAuth = (req: any, res: any, next: any) => {
    if (req.session.user) {
      next();
    } else {
      res.status(401).json({ error: 'Unauthorized' });
    }
  };

  // Auth routes
  app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    try {
      db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(username, hashedPassword);
      res.json({ message: 'User registered' });
    } catch (e) {
      res.status(400).json({ error: 'User already exists' });
    }
  });

  app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;
    if (user && await bcrypt.compare(password, user.password)) {
      req.session.user = { id: user.id, username: user.username, role: user.role };
      res.json({ message: 'Logged in', user: req.session.user });
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  });

  app.post('/api/logout', (req, res) => {
    req.session.destroy(() => {
      res.json({ message: 'Logged out' });
    });
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
  
  const dirs = [taskDir, historyDir, downloadDir, uploadsDir, thumbnailsDir, thumbDownloadsDir, thumbUploadsDir, videoTaskDir, videoHistoryDir, videoDownloadDir, videoThumbDir, bgmDir];
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

                db.prepare('INSERT OR IGNORE INTO assets (user_id, type, file_path) VALUES (?, ?, ?)').run(
                    userId, type, relativePath
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
    } catch(e) {
        console.error("Failed to migrate asset types", e);
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
    fs.writeFileSync(path.join(userVideoTaskDir, filename), JSON.stringify(finalTaskData, null, 2));

    // Register job in DB
    db.prepare('INSERT INTO tasks (id, user_id, type, data, status) VALUES (?, ?, ?, ?, ?)').run(
      jobId, 
      user.id, 
      'video', 
      JSON.stringify(finalTaskData), 
      'pending'
    );

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

    const sourcePath = path.join(sourceDir, filename);
    const thumbPath = path.join(thumbDir, filename);

    if (!fs.existsSync(sourcePath)) {
      return res.status(404).send('Image not found');
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
    fs.writeFileSync(filePath, JSON.stringify(taskData, null, 2));

    // Register job in DB
    db.prepare('INSERT INTO tasks (id, user_id, type, data, status) VALUES (?, ?, ?, ?, ?)').run(
      jobId, 
      user.id, 
      'image', 
      JSON.stringify(taskData), 
      'pending'
    );

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
        const progressInfo = jobProgress.get(row.id);
        
        return {
          id: row.id,
          userId: row.user_id,
          username: row.username,
          status: progressInfo ? progressInfo.status : row.status,
          progress: progressInfo ? (progressInfo.total > 0 ? Math.round((progressInfo.completed / progressInfo.total) * 100) : 0) : row.progress,
          statusMessage: progressInfo ? (progressInfo.message || '') : '',
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
      
      // Delete from DB
      try {
        db.prepare('DELETE FROM tasks WHERE id = ?').run(jobId);
      } catch(e) {}

      // Helper to find file in root or subdirs
      const findAndDelete = (baseDir: string, targetFile: string) => {
          const rootPath = path.join(baseDir, targetFile);
          if (fs.existsSync(rootPath)) {
              fs.unlinkSync(rootPath);
              return true;
          }
          // Scan subdirs
          try {
              const subs = fs.readdirSync(baseDir).filter(f => fs.statSync(path.join(baseDir, f)).isDirectory());
              for (const sub of subs) {
                  const subPath = path.join(baseDir, sub, targetFile);
                  if (fs.existsSync(subPath)) {
                      fs.unlinkSync(subPath);
                      return true;
                  }
              }
          } catch(e) {}
          return false;
      };

      findAndDelete(historyDir, file);
      findAndDelete(taskDir, file);
    }
    res.json({ success: true });
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
  const oldConfigPath = path.join(__dirname, 'config.json');
  
  // 迁移逻辑
  if (!fs.existsSync(configPath) && fs.existsSync(oldConfigPath)) {
    try {
      fs.copyFileSync(oldConfigPath, configPath);
    } catch (e) {}
  }

  const defaultConfig = { 
    systemDownloadsDir: path.join(os.homedir(), 'Downloads'),
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
    videoConcurrency: 3
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

  app.post('/api/config', (req, res) => {
    fs.writeFileSync(configPath, JSON.stringify(req.body, null, 2));
    res.json({ success: true });
  });

  // Get all downloaded images
  app.get('/api/images', requireAuth, checkAccess, (req: any, res) => {
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
      // The frontend expects an array of paths or objects. Since we are upgrading it, return objects.
      res.json(rows.map(row => ({
        path: row.file_path.replace(/\\/g, '/'),
        userId: row.user_id,
        username: row.username
      })));
    } catch (err) {
      console.error('Failed to read images from DB:', err);
      res.status(500).json({ error: 'Failed to read images' });
    }
  });

  // Get all downloaded videos
  app.get('/api/videos', requireAuth, checkAccess, (req: any, res) => {
    const user = req.session.user;

    let query = 'SELECT assets.*, users.username FROM assets LEFT JOIN users ON assets.user_id = users.id WHERE type = ?';
    let params: any[] = ['video'];

    if (user.role !== 'admin') {
      query += ' AND assets.user_id = ?';
      params.push(user.id);
    }

    query += ' ORDER BY assets.created_at DESC';

    try {
      const rows = db.prepare(query).all(...params) as any[];
      // The frontend expects paths relative to /downloads/videos/
      res.json(rows.map(row => ({
        path: row.file_path.replace(/\\/g, '/'),
        userId: row.user_id,
        username: row.username
      })));
    } catch (err) {
      console.error('Failed to read videos from DB:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

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
    const historyPath = path.join(videoHistoryDir, id);
    const pendingPath = path.join(videoTaskDir, id);
    
    try {
      let deleted = false;
      let taskData = null;
      
      if (fs.existsSync(historyPath)) {
        taskData = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
        fs.unlinkSync(historyPath);
        deleted = true;
      } else if (fs.existsSync(pendingPath)) {
        taskData = JSON.parse(fs.readFileSync(pendingPath, 'utf-8'));
        fs.unlinkSync(pendingPath);
        deleted = true;
      }
      
      if (deleted) {
        // Also delete the generated video file if it exists
        if (taskData && taskData.outputVideo) {
          const videoPath = path.join(videoDownloadDir, taskData.outputVideo);
          const thumbPath = path.join(videoThumbDir, taskData.outputVideo.replace(/\.[^/.]+$/, ".jpg"));
          if (fs.existsSync(videoPath)) {
            try { fs.unlinkSync(videoPath); } catch (e) { console.error('Failed to delete video file:', e); }
          }
          if (fs.existsSync(thumbPath)) {
            try { fs.unlinkSync(thumbPath); } catch (e) { console.error('Failed to delete video thumbnail:', e); }
          }
        }
        return res.json({ success: true });
      }
      
      res.status(404).json({ error: 'Job not found' });
    } catch (err) {
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
    const { images } = req.body;
    if (!images || !Array.isArray(images)) return res.status(400).json({ error: 'Invalid images' });
    
    if (!fs.existsSync(userStoragePath)) fs.mkdirSync(userStoragePath, { recursive: true });
    
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
            const relativePath = path.join(user.id.toString(), filename).replace(/\\/g, '/');
            db.prepare('INSERT OR IGNORE INTO assets (user_id, type, file_path) VALUES (?, ?, ?)').run(user.id, 'image', relativePath);
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
      if (filename.startsWith('uploads/')) {
        // Strip the "uploads/" prefix to find it in uploadsDir
        sourcePath = path.join(uploadsDir, filename.replace(/^uploads\//, ''));
      } else {
        sourcePath = path.join(downloadDir, filename);
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

  // Start the automation watcher
  startAutomationWatcher();
  
  // Start the video automation watcher
  startVideoAutomationWatcher(() => {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return config.videoConcurrency || 3;
    } catch (e) {
      return 3;
    }
  });

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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
