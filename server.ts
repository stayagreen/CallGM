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
  if (!fs.existsSync(taskDir)) fs.mkdirSync(taskDir, { recursive: true });

  // API route to save generation request
  app.post("/api/execute", (req, res) => {
    const { tasks } = req.body;
    
    // Save to JSON file with unique name
    const filename = `task_${Date.now()}.json`;
    const filePath = path.join(taskDir, filename);
    fs.writeFileSync(filePath, JSON.stringify(tasks, null, 2));

    res.json({ status: "ok", message: "Tasks queued", filename });
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
