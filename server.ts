import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import os from "os";
import sharp from "sharp";
import { startAutomationWatcher, jobProgress, handleBrowserDebug } from "./automation.js";
import { startVideoAutomationWatcher, videoJobProgress } from "./video_automation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "50mb" }));

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
  app.post("/api/video/execute", (req, res) => {
    const taskData = req.body;
    
    // Process base64 images
    if (taskData.storyboards) {
      taskData.storyboards.forEach((sb: any) => {
        if (sb.image && sb.image.startsWith('data:image')) {
          const matches = sb.image.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
          if (matches) {
            const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
            const base64Data = matches[2];
            const filename = `ref_vid_${Date.now()}_${Math.floor(Math.random()*10000)}.${ext}`;
            fs.writeFileSync(path.join(uploadsDir, filename), base64Data, 'base64');
            sb.image = `/uploads/${filename}`;
          }
        }
      });
    }

    const filename = `task_video_${Date.now()}.json`;
    fs.writeFileSync(path.join(videoTaskDir, filename), JSON.stringify(taskData, null, 2));
    res.json({ status: "ok", message: "Video task queued", filename });
  });

  // Video Jobs API
  app.get("/api/video/jobs", (req, res) => {
    const jobs: any[] = [];
    
    if (fs.existsSync(videoHistoryDir)) {
      const files = fs.readdirSync(videoHistoryDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const stat = fs.statSync(path.join(videoHistoryDir, file));
          const data = JSON.parse(fs.readFileSync(path.join(videoHistoryDir, file), 'utf-8'));
          jobs.push({ 
            id: file, 
            timestamp: stat.mtimeMs, 
            data, 
            status: data.status || 'completed', 
            progress: data.status === 'error' ? 0 : 100,
            error: data.error
          });
        } catch (e) {}
      }
    }

    if (fs.existsSync(videoTaskDir)) {
      const files = fs.readdirSync(videoTaskDir).filter(f => f.endsWith('.json') && fs.statSync(path.join(videoTaskDir, f)).isFile());
      for (const file of files) {
        try {
          const stat = fs.statSync(path.join(videoTaskDir, file));
          const data = JSON.parse(fs.readFileSync(path.join(videoTaskDir, file), 'utf-8'));
          const progressInfo = videoJobProgress.get(file);
          jobs.push({
            id: file,
            timestamp: stat.mtimeMs,
            data,
            status: progressInfo ? progressInfo.status : 'pending',
            progress: progressInfo ? progressInfo.progress : 0,
            error: progressInfo?.error
          });
        } catch (e) {}
      }
    }

    jobs.sort((a, b) => b.timestamp - a.timestamp);
    res.json(jobs);
  });

  // Thumbnail generation endpoint
  app.get("/api/thumbnails/:type/:filename", async (req, res) => {
    const { type, filename } = req.params;
    if (type !== 'downloads' && type !== 'uploads' && type !== 'videos') {
      return res.status(400).send('Invalid type');
    }

    if (type === 'videos') {
      const thumbPath = path.join(videoThumbDir, filename);
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
  app.post("/api/gallery/save", (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "URL is required" });

    console.log(`[GallerySave] Request to save: ${url.substring(0, 50)}...`);

    try {
      if (url.startsWith('data:image')) {
        // Handle base64
        const matches = url.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
        if (matches) {
          const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
          const base64Data = matches[2];
          const filename = `saved_${Date.now()}_${Math.floor(Math.random()*1000)}.${ext}`;
          const destPath = path.join(downloadDir, filename);
          fs.writeFileSync(destPath, base64Data, 'base64');
          console.log(`[GallerySave] Base64 saved to: ${destPath}`);
          return res.json({ status: "ok", filename });
        }
        return res.status(400).json({ error: "Invalid base64 format" });
      }

      const filename = path.basename(url);
      let sourcePath = '';
      
      if (url.startsWith('/uploads/')) {
        sourcePath = path.join(uploadsDir, filename);
      } else if (url.startsWith('/downloads/')) {
        sourcePath = path.join(downloadDir, filename);
      } else {
        // Try to resolve from filename alone if it's just a name
        sourcePath = path.join(uploadsDir, filename);
        if (!fs.existsSync(sourcePath)) {
          sourcePath = path.join(downloadDir, filename);
        }
      }

      console.log(`[GallerySave] Resolved source path: ${sourcePath}`);

      if (!fs.existsSync(sourcePath)) {
        console.error(`[GallerySave] Source file not found: ${sourcePath}`);
        return res.status(404).json({ error: "Source file not found" });
      }

      const newFilename = `saved_${Date.now()}_${filename}`;
      const destPath = path.join(downloadDir, newFilename);
      fs.copyFileSync(sourcePath, destPath);
      console.log(`[GallerySave] File copied to: ${destPath}`);
      res.json({ status: "ok", filename: newFilename });
    } catch (e) {
      console.error('[GallerySave] Failed to save to gallery', e);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // API route to save generation request
  app.post("/api/execute", (req, res) => {
    const { tasks } = req.body;
    
    // Process base64 images and save them as files
    tasks.forEach((task: any) => {
      if (task.images && Array.isArray(task.images)) {
        task.images = task.images.map((img: string) => {
          if (img.startsWith('data:image')) {
            const matches = img.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
            if (matches) {
              const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
              const base64Data = matches[2];
              const filename = `ref_${Date.now()}_${Math.floor(Math.random()*10000)}.${ext}`;
              fs.writeFileSync(path.join(uploadsDir, filename), base64Data, 'base64');
              return `/uploads/${filename}`;
            }
          }
          return img;
        });
      }
    });

    // Save to JSON file with unique name
    const filename = `task_${Date.now()}.json`;
    const filePath = path.join(taskDir, filename);
    fs.writeFileSync(filePath, JSON.stringify(tasks, null, 2));

    res.json({ status: "ok", message: "Tasks queued", filename });
  });

  // API route for browser to send debug info
  app.post("/api/debug", (req, res) => {
    if (req.body && req.body.message) {
      handleBrowserDebug(req.body.message);
    }
    res.json({ status: "ok" });
  });

  // API route to get jobs (pending, running, completed)
  app.get("/api/jobs", (req, res) => {
    const jobs: any[] = [];
    
    // Read completed jobs from history
    if (fs.existsSync(historyDir)) {
      const files = fs.readdirSync(historyDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const stat = fs.statSync(path.join(historyDir, file));
          const data = JSON.parse(fs.readFileSync(path.join(historyDir, file), 'utf-8'));
          jobs.push({
            id: file,
            timestamp: stat.mtimeMs,
            tasks: data,
            status: 'completed',
            progress: 100
          });
        } catch (e) {}
      }
    }

    // Read pending/running jobs from task dir
    if (fs.existsSync(taskDir)) {
      const files = fs.readdirSync(taskDir).filter(f => f.endsWith('.json') && fs.statSync(path.join(taskDir, f)).isFile());
      for (const file of files) {
        try {
          const stat = fs.statSync(path.join(taskDir, file));
          const data = JSON.parse(fs.readFileSync(path.join(taskDir, file), 'utf-8'));
          const progressInfo = jobProgress.get(file);
          
          let progress = 0;
          let status = 'pending';
          if (progressInfo) {
            status = progressInfo.status;
            progress = progressInfo.total > 0 ? Math.round((progressInfo.completed / progressInfo.total) * 100) : 0;
          }

          jobs.push({
            id: file,
            timestamp: stat.mtimeMs,
            tasks: data,
            status: status,
            progress: progress
          });
        } catch (e) {}
      }
    }

    jobs.sort((a, b) => b.timestamp - a.timestamp);
    res.json(jobs);
  });

  // API route to batch delete jobs
  app.post("/api/jobs/delete", (req, res) => {
    const { filenames } = req.body;
    if (!Array.isArray(filenames)) return res.status(400).json({error: 'Invalid request'});
    
    for (const file of filenames) {
      const historyPath = path.join(historyDir, file);
      const taskPath = path.join(taskDir, file);
      if (fs.existsSync(historyPath)) fs.unlinkSync(historyPath);
      if (fs.existsSync(taskPath)) fs.unlinkSync(taskPath);
    }
    res.json({ success: true });
  });

  const dataDir = path.join(__dirname, "data");
  const templatesPath = path.join(dataDir, "templates.json");
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

  // API route for config
  const configPath = path.join(__dirname, 'config.json');
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
    downloadRetries: 3
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
  app.get('/api/images', (req, res) => {
    if (!fs.existsSync(downloadDir)) return res.json([]);
    try {
      const files = fs.readdirSync(downloadDir).filter(f => f.match(/\.(jpg|jpeg|png|webp|gif)$/i));
      // Sort by modified time descending (newest first)
      files.sort((a, b) => {
        return fs.statSync(path.join(downloadDir, b)).mtimeMs - fs.statSync(path.join(downloadDir, a)).mtimeMs;
      });
      res.json(files);
    } catch (err) {
      res.status(500).json({ error: 'Failed to read images' });
    }
  });

  // Get all downloaded videos
  app.get('/api/videos', (req, res) => {
    if (!fs.existsSync(videoDownloadDir)) return res.json([]);
    try {
      const files = fs.readdirSync(videoDownloadDir).filter(f => f.match(/\.(mp4|webm|mov)$/i));
      files.sort((a, b) => {
        return fs.statSync(path.join(videoDownloadDir, b)).mtimeMs - fs.statSync(path.join(videoDownloadDir, a)).mtimeMs;
      });
      res.json(files);
    } catch (err) {
      res.status(500).json({ error: 'Failed to read videos' });
    }
  });

  // Delete a downloaded video
  app.delete('/api/videos/:filename', (req, res) => {
    const filePath = path.join(videoDownloadDir, req.params.filename);
    const thumbPath = path.join(videoThumbDir, req.params.filename.replace(/\.[^/.]+$/, ".jpg"));
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
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
      if (fs.existsSync(historyPath)) {
        fs.unlinkSync(historyPath);
        return res.json({ success: true });
      } else if (fs.existsSync(pendingPath)) {
        fs.unlinkSync(pendingPath);
        return res.json({ success: true });
      }
      res.status(404).json({ error: 'Job not found' });
    } catch (err) {
      res.status(500).json({ error: 'Failed to delete job' });
    }
  });

  // Delete a downloaded image
  app.delete('/api/images/:filename', (req, res) => {
    const filePath = path.join(downloadDir, req.params.filename);
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
  app.post('/api/images/upload', express.json({ limit: '50mb' }), (req, res) => {
    const { images } = req.body;
    if (!images || !Array.isArray(images)) return res.status(400).json({ error: 'Invalid images' });
    
    if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });
    
    const savedFiles: string[] = [];
    images.forEach((base64: string) => {
      try {
        const matches = base64.match(/^data:image\/([a-zA-Z+]+);base64,(.+)$/);
        if (!matches) return;
        
        const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
        const data = matches[2];
        const buffer = Buffer.from(data, 'base64');
        const filename = `upload_${Date.now()}_${Math.floor(Math.random() * 1000)}.${ext}`;
        fs.writeFileSync(path.join(downloadDir, filename), buffer);
        savedFiles.push(filename);
      } catch (e) {
        console.error('Failed to save uploaded image:', e);
      }
    });
    
    res.json({ success: true, files: savedFiles });
  });

  // Update gallery image
  app.post('/api/gallery/update', express.json({ limit: '50mb' }), (req, res) => {
    const { filename, image } = req.body;
    if (!filename || !image) return res.status(400).json({ error: 'Missing filename or image' });
    
    try {
      const matches = image.match(/^data:image\/([a-zA-Z+]+);base64,(.+)$/);
      if (!matches) return res.status(400).json({ error: 'Invalid image format' });
      
      const data = matches[2];
      const buffer = Buffer.from(data, 'base64');
      const filePath = path.join(downloadDir, filename);
      
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
  app.post('/api/images/copy-to-uploads', (req, res) => {
    const { filenames } = req.body;
    if (!filenames || !Array.isArray(filenames)) return res.status(400).json({ error: 'Invalid filenames' });
    
    const copiedUrls: string[] = [];
    filenames.forEach((filename: string) => {
      const sourcePath = path.join(downloadDir, filename);
      const destFilename = `ref_gallery_${Date.now()}_${Math.floor(Math.random() * 1000)}_${filename}`;
      const destPath = path.join(uploadsDir, destFilename);
      
      if (fs.existsSync(sourcePath)) {
        try {
          fs.copyFileSync(sourcePath, destPath);
          copiedUrls.push(`/uploads/${destFilename}`);
        } catch (e) {
          console.error('Failed to copy image to uploads:', e);
        }
      }
    });
    
    res.json({ success: true, urls: copiedUrls });
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
