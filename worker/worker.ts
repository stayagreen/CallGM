import io from "socket.io-client";
import fs from "fs";
import path from "path";
import { jobProgress, executeBatch, cancelledJobs, downloadDir } from "../automation.js";

// ========= 配置加载逻辑 =========
const configPath = path.join(process.cwd(), "config.json");
let DEFAULT_SERVER_URL = "http://localhost:3000";
let WORKER_TOKEN = "wk-YOUR_TOKEN_HERE";

if (fs.existsSync(configPath)) {
    try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        DEFAULT_SERVER_URL = config.SERVER_URL || DEFAULT_SERVER_URL;
        WORKER_TOKEN = config.WORKER_TOKEN || WORKER_TOKEN;
        console.log(`[配置] 已从 ${configPath} 加载配置: ${DEFAULT_SERVER_URL}`);
    } catch (e) {
        console.warn("[配置] 读取 config.json 失败");
    }
} else {
    fs.writeFileSync(configPath, JSON.stringify({ SERVER_URL: DEFAULT_SERVER_URL, WORKER_TOKEN }, null, 2));
}

console.log("启动 Worker 工作节点...");

const socket = io(DEFAULT_SERVER_URL, {
    reconnection: true,
    reconnectionAttempts: Infinity
});

socket.on("connect", () => {
    console.log("成功连接到主服务器! 等待鉴权...");
    socket.emit("register", { token: WORKER_TOKEN });
});

socket.on("registered", (info: any) => {
    console.log(`鉴权成功! 节点: ${info.name}`);
    
    // 定期上报心跳和任务进度
    setInterval(() => {
        socket.emit("heartbeat");
        for (const [jobId, progress] of jobProgress.entries()) {
            socket.emit("task_status", { jobId, progress, status: (progress as any).status || 'running' });
        }
    }, 5000);
});

socket.on("run_task", async (taskData: any) => {
    const { id: jobId, data, serverUrl } = taskData;
    const finalServerUrl = serverUrl || DEFAULT_SERVER_URL;
    
    console.log(`[任务] 收到新任务: ${jobId}, Server: ${finalServerUrl}`);
    
    try {
        // 执行任务
        const resultFiles = await executeBatch(data, `${jobId}.json`, jobId);
        console.log(`[任务] 执行完成, 产生文件: ${resultFiles.length}`);

        // 上传文件函数
        const uploadFile = async (filePath: string) => {
            const absPath = path.isAbsolute(filePath) ? filePath : path.join(downloadDir, filePath);
            if (!fs.existsSync(absPath)) {
                console.warn(`[传输] 文件不存在: ${absPath}`);
                return;
            }

            const fileName = path.basename(absPath);
            const fileData = fs.readFileSync(absPath);
            const base64Data = fileData.toString('base64');
            
            console.log(`[传输] 上传文件: ${fileName}`);

            try {
                const response = await fetch(`${finalServerUrl}/api/worker/upload-result`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        token: WORKER_TOKEN,
                        jobId: jobId,
                        filename: fileName,
                        base64Data: base64Data
                    })
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                console.log(`[传输] 文件上传成功: ${fileName}`);
            } catch (err) {
                console.error(`[传输] 上传失败: ${fileName}`, err);
            }
        };

        for (const f of resultFiles) {
            await uploadFile(f);
        }

        socket.emit("task_status", { jobId, progress: { status: 'completed', progress: 100 }, status: 'completed' });
    } catch (err: any) {
        console.error(`[任务] 失败: ${jobId}`, err);
        socket.emit("task_status", { jobId, progress: { status: 'error', progress: 0, error: err.message }, status: 'error' });
    }
});

socket.on("cancel_task", (payload: any) => {
    const jobId = payload.jobId;
    cancelledJobs.add(jobId);
    console.log(`[任务] 已加入取消队列: ${jobId}`);
});

socket.on("disconnect", () => console.log("与服务器断开连接..."));
