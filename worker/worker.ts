import io from "socket.io-client";
import fs from "fs";
import path from "path";
import { jobProgress, executeBatch, cancelledJobs } from "../automation.js";

// ========= 配置区域 =========
const SERVER_URL = "http://192.168.1.100:4000"; // 替换为主服务器局域网IP
const WORKER_TOKEN = "wk-YOUR_TOKEN_HERE";      // 替换为后台生成的 Token
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
    }
  } catch (err) {
    console.error(`[Worker] Upload error:`, err);
  }
}

socket.on("run_task", async (taskData) => {
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
      process.exit(0); // 退出码 0 表示被外部 bat 脚本自动重启
  } else if (cmd.action === 'stop') {
      console.log("\n[管理员要求] 永久停止节点!");
      process.exit(99); // 退出码 99 触发批处理结束
  } else if (cmd.action === 'update') {
      console.log("\n[管理员要求] 尝试拉取更新并重启...");
      try {
          const cp = require('child_process');
          let updated = false;

          // 1. 尝试 Git 更新
          if (fs.existsSync('.git')) {
              try {
                  console.log("检测到 Git 仓库，执行: git pull");
                  cp.execSync('git pull', { stdio: 'inherit' });
                  updated = true;
              } catch (gitErr: any) {
                  console.error("Git pull 失败:", gitErr.message);
              }
          }

          // 2. 如果不是 Git 仓库或 Git 失败，尝试从主服务器 HTTP 下载 (适合 worker_dist 模式)
          if (!updated) {
              console.log("准备从主服务器 HTTP 下载更新文件...");
              const filesToUpdate = ['worker.ts', 'automation.ts', 'video_automation.ts', 'watermarkRemover.ts', 'package.json'];
              for (const f of filesToUpdate) {
                  try {
                      const fileUrl = `${SERVER_URL}/worker-files/${f}`;
                      console.log(`正在获取: ${fileUrl}`);
                      const res = await fetch(fileUrl);
                      if (res.ok) {
                          const content = await res.text();
                          if (content && content.length > 0) {
                              fs.writeFileSync(path.join(process.cwd(), f), content);
                              console.log(`✅ 已更新: ${f}`);
                          }
                      } else {
                          console.warn(`⚠️ 无法获取 ${f} (状态: ${res.status})`);
                      }
                  } catch (fetchErr: any) {
                      console.error(`❌ 下载文件 ${f} 失败:`, fetchErr.message);
                  }
              }
          }

          console.log("执行: npm install");
          cp.execSync('npm install', { stdio: 'inherit' });
          console.log("更新完成，立即重启应用新代码...");
          process.exit(0);
      } catch (err: any) {
          console.error("更新总流程失败:", err.message);
      }
  }
});
