import io from "socket.io-client";
import fs from "fs";
import path from "path";
import { jobProgress, executeBatch, cancelledJobs, downloadDir } from "./automation.js";

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
  }, 5000);
});

socket.on("new_batch", async (taskData) => {
  const { id: jobId, data } = taskData;
  console.log(`[任务] 收到新批次: ${jobId}`);
  
  const filename = `${jobId}.json`;
  
  try {
    // 执行批次任务
    const resultFiles = await executeBatch(data, filename, jobId);
    
    console.log(`[任务] 批次 ${jobId} 执行完成, 结果文件数: ${resultFiles.length}`);
    
     // 上传结果文件
     const uploadResult = async (token, taskId, filePath) => {
         const formData = new FormData();
         const fileBuffer = fs.readFileSync(filePath);
         const blob = new Blob([fileBuffer]);
         formData.append('token', token);
         formData.append('taskId', taskId);
         formData.append('file', blob, path.basename(filePath));

         await fetch(`${SERVER_URL}/api/worker/upload-result`, {
             method: 'POST',
             body: formData
         });
     }

     for (let filePath of resultFiles) {
         // Resolve relative path to absolute path using automation's downloadDir
         if (!path.isAbsolute(filePath)) {
             filePath = path.join(downloadDir, filePath);
         }
         
         if (fs.existsSync(filePath)) {
             console.log(`[传输] 向服务器发送结果文件 -> ${filePath}`);
             await uploadResult(WORKER_TOKEN, taskData.id, filePath);
         } else {
             console.warn(`[传输] 找不到待上传的文件: ${filePath}`);
         }
     }
     
     socket.emit("batch_complete", { jobId });
  } catch (err) {
    console.error(`[任务] 批次 ${jobId} 执行失败:`, err);
    socket.emit("batch_error", { jobId, error: err.message });
  }
});

socket.on("cancel_batch", (jobId) => {
  console.log(`[任务] 收到取消指令: ${jobId}`);
  cancelledJobs.add(jobId);
});

socket.on("disconnect", () => {
  console.log("与服务器断开连接.");
});
