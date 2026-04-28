import { Server } from "socket.io";
import db from "../db/db.js";
import path from "path";
import os from "os";
import fs from "fs";

export class DispatcherService {
  private io: Server | null = null;
  private connectedWorkers = new Map<string, string>(); // socket.id -> worker.token

  public attach(httpServer: any) {
    this.io = new Server(httpServer, {
      cors: { origin: "*" },
      maxHttpBufferSize: 1e8 // 100MB
    });

    this.io.on("connection", (socket) => {
      console.log(`[Dispatcher] New connection: ${socket.id}`);

      socket.on("register", (data: { token: string }) => {
        const workerRow = db.prepare('SELECT * FROM workers WHERE token = ?').get(data.token) as any;
        if (!workerRow) {
          socket.emit("auth_error", "Invalid token");
          socket.disconnect();
          return;
        }

        const ip = socket.handshake.address;
        db.prepare('UPDATE workers SET status = ?, ip_address = ?, last_seen = CURRENT_TIMESTAMP WHERE id = ?').run('idle', ip, workerRow.id);
        
        this.connectedWorkers.set(socket.id, data.token);
        socket.emit("registered", { workerId: workerRow.id, name: workerRow.name });
        console.log(`[Dispatcher] Worker registered: ${workerRow.name} (${workerRow.id})`);
      });

      socket.on("heartbeat", () => {
        const token = this.connectedWorkers.get(socket.id);
        if (token) {
          db.prepare('UPDATE workers SET last_seen = CURRENT_TIMESTAMP WHERE token = ?').run(token);
        }
      });

      socket.on("task_status", (data: { jobId: string, progress: any, status: string }) => {
        // Here we pipe updates to the global jobProgress which the UI reads
        // Need to import jobProgress dynamically to avoid circular dependencies if any
        import("../../automation.js").then(({ jobProgress }) => {
              if (data.status === 'completed' || data.status === 'error' || data.status === 'failed') {
                 // update db and remove from map
                 try {
                     const task = db.prepare('SELECT status, worker_id FROM tasks WHERE id = ?').get(data.jobId) as any;
                     
                     // If the task was manually paused, keep it paused in the DB
                     const finalStatus = (task && task.status === 'paused') ? 'paused' : data.status;

                     if (finalStatus !== 'completed') {
                         db.prepare('UPDATE tasks SET status = ?, status_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(finalStatus, data.progress.message || '', data.jobId);
                     } else {
                         db.prepare('UPDATE tasks SET status = ?, progress = 100, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(finalStatus, data.jobId);
                     }

                     // Reset worker status to idle if it has no other running tasks
                     if (task && task.worker_id) {
                        const otherRunning = db.prepare('SELECT COUNT(*) as count FROM tasks WHERE worker_id = ? AND status = ? AND id != ?').get(task.worker_id, 'running', data.jobId) as any;
                        if (!otherRunning || otherRunning.count === 0) {
                            db.prepare('UPDATE workers SET status = ? WHERE id = ?').run('idle', task.worker_id);
                        }
                     }
                 } catch (e) {}
                 jobProgress.delete(data.jobId);
             } else {
                 jobProgress.set(data.jobId, data.progress);
             }
        }).catch(err => {
             console.error("[Dispatcher] Failed to pass jobProgress", err);
        });
      });

      socket.on("disconnect", () => {
        const token = this.connectedWorkers.get(socket.id);
        if (token) {
          db.prepare('UPDATE workers SET status = ? WHERE token = ?').run('offline', token);
          this.connectedWorkers.delete(socket.id);
          console.log(`[Dispatcher] Worker disconnected: ${token}`);
        }
      });
    });

    // A background loop trying to match jobs with available workers / servers
    setInterval(() => this.dispatchLoop(), 2000);
  }

  public poke() {
      // Eager dispatch
      this.dispatchLoop();
  }

  public sendCommandToWorker(token: string, action: string) {
      if (!this.io) return;
      let targetSid: string | null = null;
      for (const [sid, t] of this.connectedWorkers.entries()) {
          if (t === token) { targetSid = sid; break; }
      }
      if (targetSid) {
          console.log(`[Dispatcher] Sending admin command '${action}' to worker ${token}`);
          this.io.to(targetSid).emit('admin_command', { action });
      } else {
          console.log(`[Dispatcher] Worker ${token} is not connected. Command '${action}' ignored.`);
      }
  }

  private isDispatching = false;

  private async dispatchLoop() {
    if (this.isDispatching) return;
    this.isDispatching = true;
    try {
      // 1. Read global config
      const configRow = db.prepare('SELECT value FROM system_config WHERE key = ?').get('app_config') as any;
      let config: any = { dispatchStrategy: 'all', globalConcurrency: 3 };
      
      if (configRow) {
        try { 
          const dbConfig = JSON.parse(configRow.value);
          config = { ...config, ...dbConfig };
          console.log(`[Dispatcher] Loaded config from DB: strategy=${config.dispatchStrategy}, concurrency=${config.globalConcurrency}`);
        } catch(e) {
          console.error("[Dispatcher] Failed to parse config from DB", e);
        }
      } else {
        const configPath = path.join(process.cwd(), 'data', 'config.json');
        if (fs.existsSync(configPath)) {
            try { 
              const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
              config = { ...config, ...fileConfig };
              console.log(`[Dispatcher] Loaded config from File: strategy=${config.dispatchStrategy}`);
            } catch(e) {}
        }
      }

      // 2. Find pending tasks. Increase limit to allow scanning past blocked tasks.
      const pendingTasks = db.prepare('SELECT * FROM tasks WHERE status = ? ORDER BY created_at ASC LIMIT 50').all('pending') as any[];
      if (pendingTasks.length > 0) {
          console.log(`[Dispatcher] Found ${pendingTasks.length} pending tasks to process.`);
      } else {
          this.isDispatching = false;
          return;
      }

      // 3. Count current running jobs separately
      const counts = db.prepare('SELECT type, COUNT(*) as count FROM tasks WHERE status = ? GROUP BY type').all('running') as any[];
      let runningImageCount = 0;
      counts.forEach(c => {
          if (c.type !== 'video') runningImageCount = c.count;
      });

      const maxImage = config.globalConcurrency || 10;
      
      console.log(`[Dispatcher] Current running: Image=${runningImageCount}/${maxImage}`);

      for (const task of pendingTasks) {
         // Skip video tasks in worker dispatch if nodes don't handle them
         if (task.type === 'video' && config.dispatchStrategy !== 'server') {
             continue;
         }
         
         if (task.type !== 'video' && runningImageCount >= maxImage) {
             console.log(`[Dispatcher] Skipping image task ${task.id} due to concurrency limit.`);
             continue;
         }

         let dispatched = false;
         const taskData = JSON.parse(task.data);

         // Resolve Worker vs Server based on dispatchStrategy
         const strategy = config.dispatchStrategy || 'all';
         console.log(`[Dispatcher] Task ${task.id} (${task.type}) strategy: ${strategy}`);

         if (strategy === 'worker' || strategy === 'all') {
            // Only image/batch tasks go to workers
            if (task.type !== 'video') {
                const idleWorkers = db.prepare('SELECT * FROM workers WHERE status = ?').all('idle') as any[];
                // Find a worker that has 'gemini_image' capability
                const matchedWorker = idleWorkers.find(w => {
                    try {
                        const caps = JSON.parse(w.capabilities);
                        return Array.isArray(caps) && caps.includes('gemini_image');
                    } catch(e) { return false; }
                });

                if (matchedWorker) {
                    // Find socket
                    let targetSocketId: string | null = null;
                    for (const [sid, token] of this.connectedWorkers.entries()) {
                        if (token === matchedWorker.token) {
                            targetSocketId = sid;
                            break;
                        }
                    }

                    if (targetSocketId) {
                        const socket = this.io!.sockets.sockets.get(targetSocketId);
                        // Fix image paths for workers - they need full URLs
                        const protocol = this.io!.engine.opts.cors ? 'https' : 'http';
                        // We use the host from the handshake to determine how the worker reached us
                        const host = socket?.handshake.headers.host || 'localhost:4000';
                        const serverUrl = `${protocol}://${host}`;

                        const taskPayload = {
                            ...taskData,
                            id: task.id, // Ensure ID is present
                            userId: task.user_id,
                            serverUrl: serverUrl,
                            systemConfig: config // Pass global config (including systemDownloadsDir)
                        };

                        if (taskPayload.images && Array.isArray(taskPayload.images)) {
                            taskPayload.images = taskPayload.images.map((img: string) => {
                                if (img.startsWith('/')) return `${serverUrl}${img}`;
                                return img;
                            });
                        }

                        db.prepare('UPDATE workers SET status = ? WHERE id = ?').run('running', matchedWorker.id);
                        db.prepare('UPDATE tasks SET status = ?, worker_id = ? WHERE id = ?').run('running', matchedWorker.id, task.id);
                        this.io!.to(targetSocketId).emit('run_task', taskPayload);
                        console.log(`[Dispatcher] -> Dispatched task ${task.id} to WORKER ${matchedWorker.name} with serverUrl=${serverUrl}`);
                        dispatched = true;
                        runningImageCount++;
                    }
                } else {
                    console.log(`[Dispatcher] Task ${task.id} is waiting for an idle worker...`);
                }
            }
         }

         // ONLY dispatch to local server if strategy is 'server' OR 'all'
         // If strategy is 'worker', this block will NEVER execute
         if (!dispatched && (strategy === 'server' || strategy === 'all')) {
             // Dispatch locally
             try {
                const reqUserId = task.user_id;
                const baseDirName = task.type === 'video' ? 'task_video' : 'task';
                const userTaskDir = path.join(process.cwd(), baseDirName, String(reqUserId));
                
                if (!fs.existsSync(userTaskDir)) fs.mkdirSync(userTaskDir, { recursive: true });
                const filename = `${task.id}.json`;
                fs.writeFileSync(path.join(userTaskDir, filename), JSON.stringify(taskData, null, 2));

                db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('running', task.id);
                console.log(`[Dispatcher] -> Dispatched task ${task.id} to LOCAL SERVER (${baseDirName}).`);
                dispatched = true;
                if (task.type !== 'video') runningImageCount++;
             } catch(e: any) {
                console.error(`[Dispatcher] Failed to dispatch locally: ${e.message}`);
             }
         }
      }

    } catch(e) {
       console.error("[Dispatcher Loop Error]", e);
    } finally {
       this.isDispatching = false;
    }
  }
  public cancelTask(taskId: string) {
      if (!this.io) return;
      try {
          const task = db.prepare('SELECT worker_id FROM tasks WHERE id = ?').get(taskId) as any;
          if (task && task.worker_id) {
              const worker = db.prepare('SELECT token FROM workers WHERE id = ?').get(task.worker_id) as any;
              if (worker) {
                  let targetSid: string | null = null;
                  for (const [sid, t] of this.connectedWorkers.entries()) {
                      if (t === worker.token) { targetSid = sid; break; }
                  }
                  if (targetSid) {
                      console.log(`[Dispatcher] Sending cancel_task for ${taskId} to worker ${task.worker_id}`);
                      this.io.to(targetSid).emit('cancel_task', { jobId: taskId });
                  }
              }
          }
      } catch (e) {
          console.error(`[Dispatcher] Cancel Task Error for ${taskId}:`, e);
      }
  }
}

export const dispatcherService = new DispatcherService();
