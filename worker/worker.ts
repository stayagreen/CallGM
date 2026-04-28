import io from "socket.io-client";
import fs from "fs";
import path from "path";
import { jobProgress, executeBatch, cancelledJobs } from "../automation.js";

// ========= 配置加载逻辑 =========
const configPath = path.join(process.cwd(), "config.json");
let SERVER_URL = "http://192.168.1.100:4000";
let WORKER_TOKEN = "wk-YOUR_TOKEN_HERE";

if (fs.existsSync(configPath)) {
    try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        SERVER_URL = config.SERVER_URL || SERVER_URL;
        WORKER_TOKEN = config.WORKER_TOKEN || WORKER_TOKEN;
        console.log(`[配置] 已从 ${configPath} 加载配置: ${SERVER_URL}`);
    } catch (e) {
        console.warn("[配置] 读取 config.json 失败，使用默认配置");
    }
} else {
    // 首次运行，创建默认配置文件
    fs.writeFileSync(configPath, JSON.stringify({ SERVER_URL, WORKER_TOKEN }, null, 2));
    console.log(`[配置] 已创建初始化配置文件: ${configPath}`);
}
// ==========================

console.log("启动 Worker 工作节点...");

const socket = io(SERVER_URL);

socket.on("connect", () => {
  console.log("成功连接到主服务器! 等待鉴权...");
  socket.emit("register", { token: WORKER_TOKEN });
});

socket.on("auth_error", (msg) => {
  console.error("鉴权失败:", msg);
  process.exit(1);
});

socket.on("registered", (info) => {
  console.log(`鉴权成功! 节点名称: ${info.name}. 就绪等待任务...`);
  setInterval(() => {
    socket.emit("heartbeat");
  }, 30000); // 30秒发一次心跳
  
  // 定期上报本地内存中的执行进度
  setInterval(() => {
    for (const [jobId, progress] of jobProgress.entries()) {
      socket.emit("task_status", { jobId, progress, status: progress.status });
    }
  }, 2000);
});

async function uploadResult(token: string, jobId: string, filePath: string) {
  try {
    const filename = path.basename(filePath);
    const base64Data = fs.readFileSync(filePath, { encoding: 'base64' });
    
    // We send to the primary server endpoint
    const response = await fetch(`${SERVER_URL}/api/worker/upload-result`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            token,
            jobId,
            filename,
            base64Data
        })
    });
    const resText = await response.text();
    if (!response.ok) {
        console.error(`[Worker] 上传失败: ${resText}`);
    } else {
        console.log(`[Worker] 成功上传: ${filename}`);
        // 回传成功后删除本地文件，节省空间
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log(`[Worker] 已删除本地临时文件: ${filename}`);
            }
        } catch (unlinkErr) {
            console.error(`[Worker] 删除文件失败:`, unlinkErr);
        }
    }
  } catch (err) {
    console.error(`[Worker] Upload error:`, err);
  }
}

let isProcessing = false;
let updatePending = false;

// Helper to check and exit
function checkUpdateAndExit() {
    if (updatePending && !isProcessing) {
        console.log("任务已全部执行完毕，现在执行更新重启...");
        // Delay slightly for socket to flush logs
        setTimeout(() => process.exit(0), 1000);
    }
}

socket.on("run_task", async (taskData) => {
  isProcessing = true;
  console.log("-----------------------------------------");
  console.log(`[新任务] 收到生图任务: ${taskData.id}`);
  
  // Reset cancellation for this task if it was previously set (though unlikely)
  cancelledJobs.delete(taskData.id);

  try {
     // Execute native automation script
     // executeBatch takes (input, filename, userId)
     const updatedTaskData = await executeBatch(taskData, taskData.id, taskData.userId || 1);
     
     console.log(`[完成] 任务 ${taskData.id} 本地执行处理完毕. 等待传输文件...`);
     
     // Look for result files
     let resultFiles: string[] = [];
     if (updatedTaskData) {
         const tasks = Array.isArray(updatedTaskData) ? updatedTaskData : (updatedTaskData.tasks || []);
         tasks.forEach((t: any) => {
             if (t.downloadedFiles) resultFiles.push(...t.downloadedFiles);
         });
     }

     for (const filePath of resultFiles) {
         if (fs.existsSync(filePath)) {
             console.log(`[传输] 向服务器发送结果文件 -> ${filePath}`);
             await uploadResult(WORKER_TOKEN, taskData.id, filePath);
         }
     }
     
     // 发送最终完成状态，通知主服务器将任务状态设为 completed
     socket.emit("task_status", { 
         jobId: taskData.id, 
         progress: { completed: 1, total: 1, status: 'completed' }, 
         status: 'completed' 
     });

     // 汇报完全结束 (The main server should update the status to completed)
     // Also clear local map
     jobProgress.delete(taskData.id);
     
     console.log(`[完全结束] 任务 ${taskData.id} 全部完成及传送.`);
  } catch (error: any) {
     console.error(`[失败] 任务报错:`, error.message);
     const errStatus = { completed: 0, total: 1, status: 'error', message: error.message };
     jobProgress.set(taskData.id, errStatus);
     socket.emit("task_status", { jobId: taskData.id, progress: errStatus, status: 'error' });
  } finally {
     isProcessing = false;
     checkUpdateAndExit();
  }
});

socket.on("cancel_task", (data: { jobId: string }) => {
  console.log(`[取消指令] 接收到任务中止信号: ${data.jobId}`);
  cancelledJobs.add(data.jobId);
});

socket.on("disconnect", () => {
  console.log("与主服务器断开连接...");
});

// 处理主服务器发来的管理员远程指令
socket.on("admin_command", async (cmd: { action: string }) => {
  if (cmd.action === 'restart') {
      console.log("\n[管理员要求] 重启节点...");
      process.exit(0); 
  } else if (cmd.action === 'stop') {
      console.log("\n[管理员要求] 永久停止节点!");
      process.exit(99); 
  } else if (cmd.action === 'update') {
      console.log("\n[管理员要求] 节点更新指令已收到。");
      updatePending = true;
      if (!isProcessing) {
          console.log("准备退出以让外部脚本执行更新...");
          setTimeout(() => process.exit(0), 1000); 
      } else {
          console.log("当前正在执行任务，将在任务完成后自动重启以执行更新...");
      }
  }
});
