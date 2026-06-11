import io from "socket.io-client";
import fs from "fs";
import path from "path";
import { jobProgress, executeBatch, cancelledJobs, downloadDir, ensureBrowserLaunched } from "../automation.js";

// ========= 配置加载逻辑 =========
const configPath = path.join(process.cwd(), "config.json");
let DEFAULT_SERVER_URL = "http://localhost:3000";
let WORKER_TOKEN = "wk-YOUR_TOKEN_HERE";

if (fs.existsSync(configPath)) {
    try {
        let configContent = fs.readFileSync(configPath, 'utf-8');
        // Handle UTF-8 BOM if written by powershell/windows utilities
        if (configContent.charCodeAt(0) === 0xFEFF) {
            configContent = configContent.slice(1);
        }
        // Handle UTF-16 representation (which older PowerShell Out-File default creates)
        if (configContent.includes('\u0000')) {
            configContent = fs.readFileSync(configPath, 'utf16le');
            if (configContent.charCodeAt(0) === 0xFEFF) {
                configContent = configContent.slice(1);
            }
        }
        const config = JSON.parse(configContent.trim());
        DEFAULT_SERVER_URL = config.SERVER_URL || DEFAULT_SERVER_URL;
        WORKER_TOKEN = config.WORKER_TOKEN || WORKER_TOKEN;
        console.log(`[配置] 已从 ${configPath} 加载配置: ${DEFAULT_SERVER_URL}`);
    } catch (e) {
        console.warn("[配置] 读取 config.json 失败:", e);
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
    
    // 同步服务器存储的专属节点配置到本地 data/config.json
    if (info.workerConfig) {
        try {
            const parsedConfig = typeof info.workerConfig === 'string' ? JSON.parse(info.workerConfig) : info.workerConfig;
            const dataDir = path.join(process.cwd(), 'data');
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }
            const localConfigPath = path.join(dataDir, 'config.json');
            let currentLocalConfig = {};
            if (fs.existsSync(localConfigPath)) {
                try {
                    currentLocalConfig = JSON.parse(fs.readFileSync(localConfigPath, 'utf-8'));
                } catch (e) {}
            }
            const mergedConfig = { ...currentLocalConfig, ...parsedConfig };
            fs.writeFileSync(localConfigPath, JSON.stringify(mergedConfig, null, 2));
            console.log(`[配置] 已同步专属节点配置至本地 data/config.json:`, mergedConfig);
        } catch (err: any) {
            console.error(`[配置] 同步专属配置失败:`, err.message);
        }
    }
    
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
        // 挂载主服务器地址，供 automation.ts 异步拉取缺失的参考图
        if (data && typeof data === 'object') {
            data.serverUrl = finalServerUrl;
        }
        
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

socket.on("admin_command", async (data: any) => {
    if (data && (data.action === 'launch_chrome' || data.action === 'reset_chrome')) {
        console.log(`[Worker] 收到管理命令 '${data.action}', 正在检测并配置 Chrome CDP 端口 9222...`);
        await ensureBrowserLaunched();
    }
});

socket.on("launch_chrome", async () => {
    console.log("[Worker] 收到前端按键请求: 正在初始化并启动 Chrome CDP...");
    await ensureBrowserLaunched();
});

// 登陆即启动：客户端连接成功后，自动做一次 Chrome 端口 9222 的环境自检与静默拉起
socket.on("registered", async (info: any) => {
    console.log(`鉴权成功! 节点: ${info.name}. 正在执行 Chrome 浏览器 CDP 挂载自检及配置...`);
    
    // 如果 info 中带有局部专属 workerConfig 个人设置，写入/合并到本地 data/config.json
    if (info && info.workerConfig) {
        try {
            const dataDir = path.join(process.cwd(), 'data');
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }
            const configObj = typeof info.workerConfig === 'string' ? JSON.parse(info.workerConfig) : info.workerConfig;
            
            const localConfigPath = path.join(dataDir, 'config.json');
            let baseConf = {};
            if (fs.existsSync(localConfigPath)) {
                try {
                    baseConf = JSON.parse(fs.readFileSync(localConfigPath, 'utf-8'));
                } catch(e) {}
            }
            
            const merged = { ...baseConf, ...configObj };
            fs.writeFileSync(localConfigPath, JSON.stringify(merged, null, 2));
            console.log(`[个人设置同步] 📥 成功载入当前节点专属的浏览器、下载路径等个性化参数：data/config.json`);
        } catch(e: any) {
            console.error("[个人设置同步] ❌ 失败:", e.message);
        }
    }

    try {
        await syncScriptsFromServer(DEFAULT_SERVER_URL);
        await ensureBrowserLaunched();
    } catch(e) {
        console.error("[CDP自检] 自动检查/启动 Chrome 失败:", e);
    }
});

// Helpers for cloud dynamic script syncing and media fetching
async function syncScriptsFromServer(serverUrl: string) {
    console.log(`[数据同步] 正在从云端拉取最新的执行脚本与全局系统配置...`);
    try {
        // 1. 同步系统配置到 data/config.json
        const configRes = await fetch(`${serverUrl}/api/config`);
        if (configRes.ok) {
            const configData = await configRes.json();
            const dataDir = path.join(process.cwd(), 'data');
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }
            
            const localConfigPath = path.join(dataDir, 'config.json');
            let finalConfig = { ...configData };
            
            // 如果本地已有独特的个人环境/路径配置，我们要加以融合保留，防止被云端系统默认配置覆盖
            if (fs.existsSync(localConfigPath)) {
                try {
                    const currentLocal = JSON.parse(fs.readFileSync(localConfigPath, 'utf-8'));
                    const localCustomKeys = [
                        'chromePath', 'userDataDir', 'systemDownloadsDir', 'headless', 
                        'gemini_download_dir', 'video_mount_dir'
                    ];
                    for (const k of localCustomKeys) {
                        if (currentLocal[k] !== undefined && currentLocal[k] !== '') {
                            finalConfig[k] = currentLocal[k];
                        }
                    }
                } catch(e) {}
            }
            
            fs.writeFileSync(localConfigPath, JSON.stringify(finalConfig, null, 2));
            console.log(`[配置同步] ✅ 成功拉取全局设置并合入该节点的本地专属个人设置到: data/config.json`);
        } else {
            console.warn(`[配置同步] ⚠️ 无法从主服务器拉取系统设置: ${configRes.statusText}`);
        }

        // 2. 同步自动化脚本
        const scripts = ["xhs_automation.ts", "automation.ts"];
        for (const script of scripts) {
            const res = await fetch(`${serverUrl}/api/worker/script/${script}`);
            if (res.ok) {
                const code = await res.text();
                fs.writeFileSync(path.join(process.cwd(), script), code);
                console.log(`[脚本同步] ✅ 成功同步并挂载本地: ${script}`);
            } else {
                console.warn(`[脚本同步] ⚠️ 无法获取 ${script}: ${res.statusText}`);
            }
        }
    } catch (e: any) {
        console.error("[数据同步] ❌ 同步异常:", e.message);
    }
}

async function downloadMedia(serverUrl: string, relativePath: string): Promise<string> {
    if (!relativePath) return '';
    try {
        const fileName = path.basename(relativePath);
        const localPath = path.join(process.cwd(), "downloads", fileName);
        if (!fs.existsSync(path.dirname(localPath))) {
            fs.mkdirSync(path.dirname(localPath), { recursive: true });
        }
        
        console.log(`[媒体下载] 正在下载: ${relativePath} -> ${localPath}`);
        const res = await fetch(`${serverUrl}/api/worker/media?path=${encodeURIComponent(relativePath)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        
        const buffer = await res.arrayBuffer();
        fs.writeFileSync(localPath, Buffer.from(buffer));
        console.log(`[媒体下载] ✅ 同步成功: ${fileName}`);
        return localPath;
    } catch (e: any) {
        console.error(`[媒体下载] ❌ 失败 ${relativePath}:`, e.message);
        return '';
    }
}

socket.on("run_xhs_publish", async (payload: any) => {
    const { noteId, videoPath, coverPath, title, content, tags, serverUrl } = payload;
    const finalServerUrl = serverUrl || DEFAULT_SERVER_URL;
    
    console.log(`\n===================================================`);
    console.log(`[XHS 发布] 收到云端任务下发委托, noteId=${noteId}`);
    console.log(`===================================================`);
    
    // 1. 同步最新版本脚本极其关键：真正的 Worker “零配自适应与云端下发脚本方案”
    await syncScriptsFromServer(finalServerUrl);
    
    let progressTimer: NodeJS.Timeout | null = null;
    try {
        socket.emit("xhs_publish_progress", {
            noteId, status: 'publishing', progress: 12,
            message: '云端同步与自适应依赖环境部署完毕，正在后台安全传输素材媒体包...'
        });
        
        // 2. 本地拉取对应的发布视频与封面素材至执行机，杜绝客户端去读不存在的共享盘
        const localVideo = await downloadMedia(finalServerUrl, videoPath);
        const localCover = await downloadMedia(finalServerUrl, coverPath);
        
        if (!localVideo) {
            throw new Error("下载核心媒体素材数据流失败，请重试或检查服务器宿主连接");
        }
        
        socket.emit("xhs_publish_progress", {
            noteId, status: 'publishing', progress: 20,
            message: '素材流本地就位！正在连接目标客户端主浏览器，建立物理控制通道...'
        });
        
        // 3. 动态配置 Mock DB 便于 XHS 核心模块无感读取发布实体内容
        const dbPath = "./src/db/db.js";
        const dbMockModule = await import(dbPath);
        if (dbMockModule.default && (dbMockModule.default as any).store) {
            (dbMockModule.default as any).store.set(noteId, {
                id: noteId,
                user_id: 1,
                video_path: localVideo,
                cover_path: localCover,
                title,
                content,
                tags,
                publish_status: 'publishing'
            });
        }
        
        // 4. 动态载入热更脚本，无缓存热核执行
        const targetAutomationPath = `${path.join(process.cwd(), "xhs_automation.js")}?update=${Date.now()}`;
        const { executeXhsPublish, xhsProgressMap } = await import(targetAutomationPath);
        
        progressTimer = setInterval(() => {
            const currentProgress = xhsProgressMap.get(noteId);
            if (currentProgress) {
                socket.emit("xhs_publish_progress", {
                    noteId,
                    status: currentProgress.status,
                    progress: currentProgress.progress,
                    message: currentProgress.message,
                    url: (currentProgress as any).url,
                    errorMessage: (currentProgress as any).error || (currentProgress as any).message
                });
            }
        }, 1200);
        
        const result = await executeXhsPublish(noteId);
        clearInterval(progressTimer);
        
        if (result && result.success) {
            socket.emit("xhs_publish_progress", {
                noteId, status: 'success', progress: 100,
                message: '恭喜！发布执行成果物已挂载小红书官方服务器且检测到链路成功更新！',
                url: result.url
            });
        } else {
            throw new Error(result?.error || '发布执行故障，未获取小红书成功标志');
        }
    } catch (err: any) {
        if (progressTimer) clearInterval(progressTimer);
        console.error(`[XHS 发布] 远程操作失败:`, err.message);
        socket.emit("xhs_publish_progress", {
            noteId, status: 'failed', progress: 0,
            message: `远程操作失败: ${err.message}`,
            errorMessage: err.message
        });
    }
});

socket.on("disconnect", () => console.log("与服务器断开连接..."));
