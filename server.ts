import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { startAutomationWatcher } from "./automation.js";

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

  // API route to get history
  app.get("/api/history", (req, res) => {
    if (!fs.existsSync(historyDir)) return res.json([]);
    const files = fs.readdirSync(historyDir).filter(f => f.endsWith('.json'));
    const history = files.map(file => {
      const filePath = path.join(historyDir, file);
      const stat = fs.statSync(filePath);
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      return {
        filename: file,
        timestamp: stat.mtimeMs,
        tasks: data
      };
    });
    history.sort((a, b) => b.timestamp - a.timestamp);
    res.json(history);
  });

  // API route to delete history
  app.delete("/api/history/:filename", (req, res) => {
    const filePath = path.join(historyDir, req.params.filename);
    const deleteFiles = req.query.deleteFiles === 'true';

    if (fs.existsSync(filePath)) {
      if (deleteFiles) {
        try {
          const taskData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          taskData.forEach((task: any) => {
            if (task.downloadedFiles && Array.isArray(task.downloadedFiles)) {
              task.downloadedFiles.forEach((file: string) => {
                const imgPath = path.join(downloadDir, file);
                if (fs.existsSync(imgPath)) {
                  fs.unlinkSync(imgPath);
                }
              });
            }
          });
        } catch (e) {
          console.error('Error deleting associated files:', e);
        }
      }
      fs.unlinkSync(filePath);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "File not found" });
    }
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
