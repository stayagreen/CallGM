import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import os from "os";
import { startAutomationWatcher, jobProgress, handleBrowserDebug } from "./automation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Global Logger Setup ---
const logFilePath = path.join(__dirname, "logger.txt");
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

function appendToLogFile(level: string, ...args: any[]) {
  const timestamp = new Date().toISOString();
  const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
  const logLine = `[${timestamp}] [${level}] ${message}\n`;
  fs.appendFileSync(logFilePath, logLine);
}

console.log = (...args) => {
  originalConsoleLog(...args);
  appendToLogFile('INFO', ...args);
};

console.error = (...args) => {
  originalConsoleError(...args);
  appendToLogFile('ERROR', ...args);
};
// ---------------------------

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "50mb" }));

  const taskDir = path.join(__dirname, "task");
  const historyDir = path.join(taskDir, "history");
  const downloadDir = path.join(__dirname, "download");
  const uploadsDir = path.join(__dirname, "uploads");
  
  if (!fs.existsSync(taskDir)) fs.mkdirSync(taskDir, { recursive: true });
  if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true });
  if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  // Serve static files from the download directory
  app.use("/downloads", express.static(downloadDir));
  app.use("/uploads", express.static(uploadsDir));

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

  // API route to get logs
  app.get("/api/logs", (req, res) => {
    try {
      if (fs.existsSync(logFilePath)) {
        // Read the last 100000 bytes to avoid sending huge files
        const stats = fs.statSync(logFilePath);
        const maxBytes = 100000;
        const start = Math.max(0, stats.size - maxBytes);
        
        const stream = fs.createReadStream(logFilePath, { start, encoding: 'utf-8' });
        let logs = '';
        stream.on('data', chunk => logs += chunk);
        stream.on('end', () => {
          // If we didn't read from the start, cut off the first partial line
          if (start > 0) {
            logs = logs.substring(logs.indexOf('\n') + 1);
          }
          res.send(logs);
        });
      } else {
        res.send("暂无日志 / No logs yet.");
      }
    } catch (error) {
      res.status(500).send("Error reading logs");
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
