import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import os from "os";
import { startAutomationWatcher, jobProgress } from "./automation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "10mb" }));

  const taskDir = path.join(__dirname, "task");
  const historyDir = path.join(taskDir, "history");
  const downloadDir = path.join(__dirname, "download");
  
  if (!fs.existsSync(taskDir)) fs.mkdirSync(taskDir, { recursive: true });
  if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true });
  if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

  // Serve static files from the download directory
  app.use("/downloads", express.static(downloadDir));

  // API route to save generation request
  app.post("/api/execute", (req, res) => {
    const { tasks } = req.body;
    
    // Save to JSON file with unique name
    const filename = `task_${Date.now()}.json`;
    const filePath = path.join(taskDir, filename);
    fs.writeFileSync(filePath, JSON.stringify(tasks, null, 2));

    res.json({ status: "ok", message: "Tasks queued", filename });
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

  // API route for config
  const configPath = path.join(__dirname, 'config.json');
  app.get('/api/config', (req, res) => {
    if (fs.existsSync(configPath)) {
      try {
        res.json(JSON.parse(fs.readFileSync(configPath, 'utf-8')));
      } catch (e) {
        res.json({ systemDownloadsDir: path.join(os.homedir(), 'Downloads') });
      }
    } else {
      res.json({ systemDownloadsDir: path.join(os.homedir(), 'Downloads') });
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

  // Start the automation watcher
  startAutomationWatcher();

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
