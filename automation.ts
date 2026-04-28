process.env.TZ = 'Asia/Shanghai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import { execSync, spawn } from 'child_process';
import net from 'net';
import { autoInpaint } from './watermarkRemover.js';
import CDP from 'chrome-remote-interface';
import db from './src/db/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const taskDir = path.join(__dirname, 'task');
const historyDir = path.join(taskDir, 'history');
export const downloadDir = path.join(__dirname, 'download');
const debugDir = path.join(__dirname, 'debug_screenshots');

// Ensure directories exist
if (!fs.existsSync(taskDir)) fs.mkdirSync(taskDir, { recursive: true });
if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true });
if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });
if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });

function copyImageToClipboard(imagePath: string, isMac: boolean) {
    try {
        const absPath = path.resolve(imagePath);
        if (isMac) {
            execSync(`osascript -e 'set the clipboard to (read (POSIX file "${absPath}") as TIFF picture)'`);
        } else if (os.platform() === 'win32') {
            execSync(`powershell -command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::SetImage([System.Drawing.Image]::FromFile('${absPath}'))"`);
        } else {
            // Linux 环境下，如果是在 headless 容器中，xclip 可能会因为没有 X11 DISPLAY 而失败
            try {
                execSync(`xclip -selection clipboard -t image/png -i "${absPath}"`, { stdio: 'ignore', env: { ...process.env, DISPLAY: ':99' } });
            } catch (xe) {
                // 如果失败且没有 display，尝试无视错误，让后续的文件直接注入逻辑生效
                console.warn('⚠️ xclip 尝试失败，可能处于无显示器环境，将尝试 CDP 原生文件注入。');
                return false; 
            }
        }
        return true;
    } catch (e) {
        console.error('复制图片到剪贴板失败:', e);
        return false;
    }
}

let isRunning = false;
let lastHeartbeat = Date.now();

export const jobProgress = new Map<string, { completed: number, total: number, status: string, message?: string }>();
export const processingImages = new Set<string>();
export const cancelledJobs = new Set<string>();

// 安全解析配置数值
function parseConfigNumber(value: any, defaultValue: number): number {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
        const rangeMatch = value.match(/(\d+)\s*-\s*(\d+)/);
        if (rangeMatch) return parseInt(rangeMatch[2], 10); // 取范围最大值
        const numMatch = value.match(/(\d+)/);
        return numMatch ? parseInt(numMatch[0], 10) : defaultValue;
    }
    return defaultValue;
}

const getRandomTime = (min: number, max: number) => {
    return Math.floor(Math.random() * (max - min + 1) + min) * 1000;
};

async function getAutomationConfig() {
    const dataDir = path.join(__dirname, 'data');
    const configPath = path.join(dataDir, 'config.json');
    if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        console.log(`[Config] 📂 已加载本地配置文件: ${configPath}`);
        return config;
    }
    console.warn(`[Config] ⚠️ 找不到配置文件: ${configPath}`);
    return {};
}

// 检查端口是否占用
function isPortOpen(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const server = net.createConnection({ port }, () => {
            server.end();
            resolve(true);
        });
        server.on('error', () => {
            resolve(false);
        });
    });
}

// 自动启动浏览器
async function ensureBrowserLaunched() {
    const config = await getAutomationConfig();
    const port = 9222;
    const chromePath = config.chromePath || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    const userDataDir = config.userDataDir || 'C:\\ChromeDebug';
    const logPath = path.join(__dirname, 'chrome_debug.log');

    const isOpen = await isPortOpen(port);

    // 1. 如果端口开了，先做健康检查
    if (isOpen) {
        try {
            const response = await fetch(`http://localhost:${port}/json/version`).catch(() => null);
            if (response && response.ok) {
                console.log(`✅ 检测到端口 ${port} 且浏览器响应正常。`);
                return true;
            }
            console.warn(`⚠️ 检测到端口 ${port} 响应异常，准备执行强制清理...`);
        } catch (e) {}
    }

    // 2. 强制清理现有的 Chrome 进程 (避免占用冲突)
    console.log(`🧹 正在执行强制进程清理，确保启动环境纯净...`);
    try {
        const isWin = process.platform === 'win32';
        const killCmd = isWin ? 'taskkill /F /IM chrome.exe /T' : 'pkill -f chrome';
        try {
            execSync(killCmd, { stdio: 'ignore' });
            console.log(`   👉 已尝试清理 Chrome 相关线程。`);
        } catch (e) {
            // 如果本来就没进程，taskkill 会报错，这里忽略
        }

        // 3. 额外清理 UserData 锁文件 (防止锁死崩溃)
        const lockFile = path.join(userDataDir, 'SingletonLock');
        if (fs.existsSync(lockFile)) {
            try {
                fs.unlinkSync(lockFile);
                console.log(`   👉 已清除 SingletonLock 锁定文件。`);
            } catch (e) {
                console.warn(`   ⚠️ 无法删除锁定文件 (可能仍被占用): ${e}`);
            }
        }
        
        await new Promise(r => setTimeout(r, 1000)); // 歇一秒让系统回收资源
    } catch (err) {
        console.warn(`⚠️ 清理过程发生非致命错误: ${err}`);
    }

    // 4. 正式启动浏览器
    console.log(`🚀 重新启动 Chrome 后台实例...`);

    if (!fs.existsSync(chromePath)) {
        console.error(`❌ 找不到 Chrome 程序: ${chromePath}`);
        return false;
    }

    const args = [
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${userDataDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--headless=new',
        '--window-size=1280,1024',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-extensions',
        '--remote-allow-origins=*',
        '--disable-blink-features=AutomationControlled'
    ];

    console.log(`📂 日志将同步至: ${logPath}`);
    
    // 创建日志流
    const logStream = fs.createWriteStream(logPath, { flags: 'a' });
    logStream.write(`\n\n--- 启动日期: ${new Date().toLocaleString()} ---\n`);

    const child = spawn(chromePath, args, {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'] // 捕捉输出
    });

    child.stdout?.pipe(logStream);
    child.stderr?.pipe(logStream);

    child.unref();

    // 等待端口就绪
    for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const check = await isPortOpen(port);
        if (check) {
            try {
                const res = await fetch(`http://localhost:${port}/json/version`).catch(() => null);
                if (res && res.ok) {
                    console.log(`✅ 浏览器已启动并通过健康检查。`);
                    return true;
                }
            } catch(e) {}
        }
    }
    
    console.error(`❌ 浏览器就绪状态检查失败。`);
    return false;
}

// 贝塞尔曲线算法实现
function getBezierPath(start: {x: number, y: number}, end: {x: number, y: number}, steps: number = 20) {
    // 随机生成 1 或 2 个控制点来增加随机性
    const cp1 = {
        x: start.x + (end.x - start.x) * Math.random(),
        y: start.y + (end.y - start.y) * Math.random() + (Math.random() > 0.5 ? 100 : -100)
    };
    
    const path = [];
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        // 二次贝塞尔曲线公式: (1-t)^2 * P0 + 2t(1-t) * P1 + t^2 * P2
        const x = (1 - t) ** 2 * start.x + 2 * t * (1 - t) * cp1.x + t ** 2 * end.x;
        const y = (1 - t) ** 2 * start.y + 2 * t * (1 - t) * cp1.y + t ** 2 * end.y;
        path.push({ x: Math.floor(x), y: Math.floor(y) });
    }
    return path;
}

// 平滑移动鼠标并点击
async function smoothMoveAndClick(Input: any, endX: number, endY: number, click: boolean = true) {
    // 先获取当前位置 (伪模拟，如果没有上次记录则从随机点开始)
    const startX = Math.floor(Math.random() * 200);
    const startY = Math.floor(Math.random() * 200);
    
    const points = getBezierPath({ x: startX, y: startY }, { x: endX, y: endY }, 15 + Math.floor(Math.random() * 10));
    
    for (const p of points) {
        await Input.dispatchMouseEvent({ type: 'mouseMoved', x: p.x, y: p.y });
        await new Promise(r => setTimeout(r, 10 + Math.random() * 10));
    }
    
    if (click) {
        await new Promise(r => setTimeout(r, 100 + Math.random() * 200));
        await Input.dispatchMouseEvent({ type: 'mousePressed', x: endX, y: endY, button: 'left', clickCount: 1 });
        await new Promise(r => setTimeout(r, 50 + Math.random() * 50));
        await Input.dispatchMouseEvent({ type: 'mouseReleased', x: endX, y: endY, button: 'left', clickCount: 1 });
    }
}

async function executeWithCDP(tasks: any[], filename: string, userId?: string | number) {
    const totalLoops = tasks.reduce((acc: number, t: any) => acc + (parseInt(t.count) || 1), 0);
    let completedLoops = 0;
    jobProgress.set(filename, { completed: completedLoops, total: totalLoops, status: 'running', message: '🚀 正在初始化引擎...' });

    console.log('\n====================================================');
    console.log('🚀 正在启动 CDP 原生引擎 (最高安全性模式)...');
    
    // 强制智能后台运行检测与启动
    const launched = await ensureBrowserLaunched();
    if (!launched) {
         console.error('❌ 无法确保浏览器运行，退出任务。');
         // 如果无法启动，标记所有任务为失败
         tasks.forEach(t => t.status = 'failed');
         return tasks;
    }

    console.log('🔗 正在连接到浏览器 (端口 9222)...');
    console.log('====================================================\n');

    const simulateIdleMovement = async (Input: any) => {
         const x = Math.floor(Math.random() * 800) + 100;
         const y = Math.floor(Math.random() * 600) + 100;
         await smoothMoveAndClick(Input, x, y, false);
    };

    // 常用的检测脚本定义在外部
    const sendBtnScript = `
        (() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const sendBtn = btns.find(b => {
                const lbl = (b.getAttribute('aria-label') || '').toLowerCase();
                return lbl.includes('send') || lbl.includes('发送');
            });
            if (sendBtn) {
                const rect = sendBtn.getBoundingClientRect();
                return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            }
            return null;
        })()
    `;

    const checkResultScript = `
        (() => {
            // 1. 获取模型回复容器 (严格过滤掉用户消息，防止把上传的参考图当成生成图)
            const allMessages = Array.from(document.querySelectorAll('message-content, [data-message-author="model"], .model-response-text, model-message'));
            const modelMessages = allMessages.filter(m => {
                // 如果它的祖先节点是 user-message 或者明确标注了 author="user"，则排除掉
                if (m.closest('user-message, [data-message-author="user"]')) return false;
                // 如果它内部包含了 "You uploaded an image" 的标志性结构也排除 (备用)
                return true;
            });
            
            if (modelMessages.length === 0) return { status: 'no_messages' };
            
            // 2. 聚焦最后一条回复
            const lastMessage = modelMessages[modelMessages.length - 1];

            // 3. 只要最后一条回复里有图片 (不分类型，只要有 img 即可)
            const images = lastMessage.querySelectorAll('img');
            
            // 4. 定位下载按钮 (使用极度精准的固定标识)
            const allElements = Array.from(lastMessage.querySelectorAll('button, a, [role="button"], [data-test-id], mat-icon'));
            const downloadBtn = allElements.find(el => {
                const b = el.closest('button, a, [role="button"]') || el;
                const html = b.outerHTML.toLowerCase();
                const text = b.innerText.toLowerCase();
                const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                const title = (b.getAttribute('title') || '').toLowerCase();
                const tooltip = (b.getAttribute('mat-tooltip') || b.getAttribute('data-tooltip') || '').toLowerCase();
                
                // 极度精准的固定标识匹配
                const isMatch = html.includes('下载完整尺寸的图片') || html.includes('download full size') || 
                               text.includes('下载完整尺寸的图片') || text.includes('download full size') ||
                               aria.includes('下载完整尺寸的图片') || aria.includes('download full size') ||
                               title.includes('下载完整尺寸的图片') || title.includes('download full size') ||
                               tooltip.includes('下载完整尺寸的图片') || tooltip.includes('download full size');
                
                const rect = b.getBoundingClientRect();
                return isMatch && rect.width > 0 && rect.height > 0;
            });

            if (images.length > 0 && downloadBtn) {
                const b = downloadBtn.closest('button, a, [role="button"]') || downloadBtn;
                const rect = b.getBoundingClientRect();
                return { 
                    status: 'found', 
                    x: rect.left + rect.width / 2, 
                    y: rect.top + rect.height / 2,
                    imgCount: images.length
                };
            } else if (images.length > 0) {
                return { status: 'img_no_btn', imgCount: images.length };
            }

            return { status: 'waiting' };
        })()
    `;

    try {
        for (const task of tasks) {
            if (cancelledJobs.has(filename)) throw new Error('CANCELLED');
            task.download = true;
            if (!task.downloadedFiles) task.downloadedFiles = [];
            
            for (let i = 0; i < (parseInt(task.count) || 1); i++) {
                if (cancelledJobs.has(filename)) throw new Error('CANCELLED');
                const stepPrefix = `[TASK-${filename}][Loop-${i + 1}]`;
                console.log(`\n${stepPrefix} 🚀 准备开启新标签页执行任务: "${task.prompt}"`);
                
                // 实时更新进度：开始当前 Loop
                jobProgress.set(filename, { completed: completedLoops + 0.05, total: totalLoops, status: 'running', message: `🌐 正在打开标签页 [${i+1}/${task.count}]...` });
                
                let currentTarget: any = null;
                let client: any = null;

                try {
                    // 0. 强力清理：在开启每一个新任务标签页前，先强制关闭所有已存在的页面标签，确保环境纯净
                    try {
                        const targets = await CDP.List({ port: 9222 });
                        for (const t of targets) {
                            if (t.type === 'page') {
                                await CDP.Close({ id: t.id, port: 9222 });
                            }
                        }
                    } catch (e) {
                        // 忽略清理阶段可能的连接报错
                    }

                    // 1. 创建并连接新标签页
                    currentTarget = await CDP.New({ url: 'https://gemini.google.com/', port: 9222 });
                    client = await CDP({ target: currentTarget.id, port: 9222 });
                    const { Page, Runtime, Input, Network, DOM } = client;

                    await Network.enable();
                    await Page.enable();
                    await Runtime.enable();
                    await DOM.enable();

                    // 1.5 设置标准视口与下载行为
                    try {
                        await client.send('Emulation.setDeviceMetricsOverride', {
                            width: 1280,
                            height: 800,
                            deviceScaleFactor: 1,
                            mobile: false
                        });
                        
                        const config = await getAutomationConfig();
                        const sysDir = (task.systemConfig && task.systemConfig.systemDownloadsDir) || config.systemDownloadsDir || path.join(os.homedir(), 'Downloads');
                        if (!fs.existsSync(sysDir)) fs.mkdirSync(sysDir, { recursive: true });

                        await client.send('Page.setDownloadBehavior', {
                            behavior: 'allow',
                            downloadPath: sysDir
                        });
                        console.log(`${stepPrefix} ⚙️ 已配置视口(1280x800)与下载路径: ${sysDir}`);
                    } catch (e: any) {
                        console.warn(`${stepPrefix} ⚠️ 设置视口/下载行为失败:`, e.message);
                    }

                    console.log(`${stepPrefix} 🌐 新标签页已就绪，正在等待页面加载 (8秒)...`);
                    for (let wait = 0; wait < 8; wait++) {
                        await new Promise(r => setTimeout(r, 1000));
                        if (cancelledJobs.has(filename)) throw new Error('CANCELLED');
                    }
                    await simulateIdleMovement(Input);

                    // 2. 诊断登录状态
                    if (cancelledJobs.has(filename)) throw new Error('CANCELLED');
                    const diagRes = await Runtime.evaluate({ expression: '({ title: document.title, url: window.location.href })', returnByValue: true });
                    const diag = diagRes.result?.value || { title: '未知', url: '未知' };
                    if (diag.title.includes('登录') || diag.title.includes('Sign in')) {
                         console.error(`${stepPrefix} ❌ [CRITICAL] 检测到页面处于登录状态。请确保在 UserData 中已登录 Google。`);
                         task.status = 'failed';
                         continue; 
                    }

                    console.log(`${stepPrefix} ⌨️ 正在定位输入框执行平滑移动...`);
                    jobProgress.set(filename, { completed: completedLoops + 0.1, total: totalLoops, status: 'running', message: '🖱️ 正在聚焦输入框...' });
                    const focusScript = `
                        (() => {
                            const el = document.querySelector('div[contenteditable="true"], textarea');
                            if (el) {
                                el.focus();
                                const rect = el.getBoundingClientRect();
                                return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
                            }
                            return null;
                        })()
                    `;
                    const focusResult = await Runtime.evaluate({ expression: focusScript, returnByValue: true });
                    if (focusResult.result && focusResult.result.value) {
                        const { x, y } = focusResult.result.value;
                        console.log(`${stepPrefix} 🖱️ [Bezier] 曲线平滑移动至输入框: (${Math.floor(x)}, ${Math.floor(y)})`);
                        await smoothMoveAndClick(Input, x, y, true);
                    }

                    await new Promise(r => setTimeout(r, 1000));

                    // 3. 粘贴参考图 (如果存在)
                    const config = await getAutomationConfig();
                    const isMac = os.platform() === 'darwin';
                    if (task.images && task.images.length > 0) {
                        console.log(`${stepPrefix} 🖼️ 处理图片上传 (使用底层数据流协议模拟粘贴)...`);
                        console.log(`${stepPrefix} 📋 待处理参考图列表:`, task.images);
                        jobProgress.set(filename, { completed: completedLoops + 0.15, total: totalLoops, status: 'running', message: '🖼️ 正在上传参考图...' });
                        
                        const { Runtime } = client;

                        for (const imgUrl of task.images) {
                            if (cancelledJobs.has(filename)) throw new Error('CANCELLED');
                            console.log(`${stepPrefix} 🛠️ 正在分析图片路径: ${imgUrl}`);
                            let localPath = '';
                            let fallbackDir = '';
                            if (imgUrl.startsWith('http')) {
                                console.log(`${stepPrefix} 🌐 远程图片 URL: ${imgUrl}`);
                                try {
                                    console.log(`${stepPrefix} ⏳ 正在从服务器拉取图片数据...`);
                                    const imgRes = await fetch(imgUrl);
                                    if (!imgRes.ok) throw new Error(`HTTP ${imgRes.status}`);
                                    const buffer = await imgRes.arrayBuffer();
                                    const tempPath = path.join(os.tmpdir(), `ref_${Date.now()}_${path.basename(imgUrl.split('?')[0])}`);
                                    fs.writeFileSync(tempPath, Buffer.from(buffer));
                                    localPath = tempPath;
                                    console.log(`${stepPrefix} ✅ 图片下载并保存至临时目录: ${localPath} (${buffer.byteLength} 字节)`);
                                } catch (downloadErr: any) {
                                    console.error(`${stepPrefix} ❌ 下载远程图片失败:`, downloadErr.message);
                                }
                            } else if (imgUrl.startsWith('/uploads/')) {
                                localPath = path.join(__dirname, 'uploads', imgUrl.replace('/uploads/', ''));
                                fallbackDir = path.join(__dirname, 'uploads');
                            } else if (imgUrl.startsWith('/downloads/')) {
                                localPath = path.join(__dirname, 'download', imgUrl.replace('/downloads/', ''));
                                fallbackDir = path.join(__dirname, 'download');
                            } else {
                                const relativeUrl = imgUrl.startsWith('/') ? imgUrl.slice(1) : imgUrl;
                                localPath = path.resolve(__dirname, relativeUrl);
                            }
                            
                            if (fallbackDir && !fs.existsSync(localPath)) {
                                const fallbackPath = path.join(fallbackDir, path.basename(imgUrl));
                                if (fs.existsSync(fallbackPath)) {
                                    localPath = fallbackPath;
                                }
                            }
                            
                            if (fs.existsSync(localPath)) {
                                console.log(`${stepPrefix} 📂 准备处理本地文件: ${localPath}`);
                                
                                try {
                                    // 1. 读取本地图片并转换为 Base64
                                    const base64Data = fs.readFileSync(localPath, 'base64');
                                    const imgName = path.basename(localPath);
                                    let mimeType = 'image/png';
                                    const ext = path.extname(localPath).toLowerCase();
                                    if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
                                    else if (ext === '.webp') mimeType = 'image/webp';
                                    else if (ext === '.gif') mimeType = 'image/gif';

                                    // 2. 将数据注入浏览器并派发原生 paste 事件
                                    const injectPasteScript = `
                                        (async () => {
                                            try {
                                                const el = document.querySelector('div[contenteditable="true"], textarea, rich-textarea, main [role="textbox"]') || document.activeElement;
                                                if (!el) {
                                                    console.error('[Inject] 未找到输入框组件');
                                                    return { success: false, reason: '未找到输入框' };
                                                }
                                                console.log('[Inject] 已找到输入框:', el.tagName, el.className);

                                                // 确保目标获取焦点
                                                el.focus();

                                                // 将 Base64 转换为 Blob -> File
                                                console.log('[Inject] 正在转换 Base64 数据, 类型: ${mimeType}, 长度: ${base64Data.length}');
                                                const res = await fetch('data:${mimeType};base64,${base64Data}');
                                                const blob = await res.blob();
                                                const file = new File([blob], "${imgName}", { type: "${mimeType}" });

                                                // 创建包含该文件的 DataTransfer 对象
                                                const dt = new DataTransfer();
                                                dt.items.add(file);

                                                // 派发 paste 事件
                                                console.log('[Inject] 正在向目标派发 paste 事件元件...');
                                                const pasteEvent = new ClipboardEvent('paste', {
                                                    bubbles: true,
                                                    cancelable: true,
                                                    clipboardData: dt
                                                });
                                                
                                                // 某些框架兼容性处理: 如果构造函数不支持 clipboardData，使用 defineProperty 强行覆盖
                                                if (!pasteEvent.clipboardData || pasteEvent.clipboardData.files.length === 0) {
                                                    console.log('[Inject] ClipboardEvent 属性热修复 (针对部分浏览器限制)...');
                                                    Object.defineProperty(pasteEvent, 'clipboardData', { value: dt });
                                                }

                                                el.dispatchEvent(pasteEvent);
                                                
                                                // 双重保险：同时触发一个 drop 事件（有些现代化编辑器监听的是 drop）
                                                console.log('[Inject] 准备触发 drop 事件作为双重保险...');
                                                const dropEvent = new DragEvent('drop', {
                                                    bubbles: true,
                                                    cancelable: true,
                                                    dataTransfer: dt
                                                });
                                                if (!dropEvent.dataTransfer || dropEvent.dataTransfer.files.length === 0) {
                                                    Object.defineProperty(dropEvent, 'dataTransfer', { value: dt });
                                                }
                                                el.dispatchEvent(dropEvent);

                                                console.log('[Inject] 事件派发流程结束');
                                                return { success: true };
                                            } catch (e) {
                                                return { success: false, reason: e.toString() };
                                            }
                                        })()
                                    `;

                                    const pasteRes = await Runtime.evaluate({ expression: injectPasteScript, awaitPromise: true, returnByValue: true });
                                    
                                    if (pasteRes.result?.value?.success) {
                                        console.log(`${stepPrefix} ✅ 成功向输入框发送底层图片数据流 (绕过系统剪贴板)`);
                                        await new Promise(r => setTimeout(r, (config.pasteMin || 5) * 1000));
                                    } else {
                                        console.log(`${stepPrefix} ⚠️ 数据流注入失败: ${pasteRes.result?.value?.reason}`);
                                    }

                                } catch (err) {
                                    console.log(`${stepPrefix} ❌ 读取或注入图片失败:`, (err as any).message);
                                }
                            }
                        }
                    }

                    // 4. 高速文本注入 (模拟粘贴)
                    console.log(`${stepPrefix} ✍️ 正在高速注入提示词 (长文本优化)...`);
                    const inputPrompt = task.prompt.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
                    const injectScript = `
                        (() => {
                            const el = document.querySelector('div[contenteditable="true"], textarea');
                            if (el) {
                                el.focus();
                                // 使用 insertText 模拟粘贴，能触发框架的 input 事件且速度极快
                                document.execCommand('insertText', false, \`${inputPrompt}\`);
                                return true;
                            }
                            return false;
                        })()
                    `;
                    await Runtime.evaluate({ expression: injectScript });
                    
                    // 实时更新进度：输入提示词完成
                    jobProgress.set(filename, { completed: completedLoops + 0.4, total: totalLoops, status: 'running', message: '✍️ 提示词发送成功，等待模型响应...' });

                    await new Promise(r => setTimeout(r, 1000));
                    await Input.dispatchKeyEvent({ type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
                    await Input.dispatchKeyEvent({ type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });

                    const sendBtnRes = await Runtime.evaluate({ expression: sendBtnScript, returnByValue: true });
                    if (sendBtnRes.result?.value) {
                        const { x, y } = sendBtnRes.result.value;
                        await smoothMoveAndClick(Input, x, y, true);
                    }

                    // 5. 循环监控结果
                    let found = false;
                    let attempts = 0;
                    while (!found && attempts < 80) { 
                        if (cancelledJobs.has(filename)) throw new Error('CANCELLED');
                        await new Promise(r => setTimeout(r, 4000));
                        if (cancelledJobs.has(filename)) throw new Error('CANCELLED');
                        attempts++;
                        
                        if (attempts % 5 === 0) {
                             const stateRes = await Runtime.evaluate({ expression: '({ title: document.title })', returnByValue: true });
                             console.log(`${stepPrefix} 🔦 [监控中] 标题: "${stateRes.result?.value?.title || '未知'}" | ${attempts}/80`);
                             await Runtime.evaluate({ expression: 'window.scrollTo(0, document.body.scrollHeight)' });
                             const loopSnap = await Page.captureScreenshot({ format: 'png' });
                             const debugPath = path.join(debugDir, `debug_${filename}_${i + 1}_at_${Date.now()}.png`);
                             fs.writeFileSync(debugPath, Buffer.from(loopSnap.data, 'base64'));
                             await simulateIdleMovement(Input);
                        }

                        const resultDetect = await Runtime.evaluate({ expression: checkResultScript, returnByValue: true });
                        if (cancelledJobs.has(filename)) throw new Error('CANCELLED');
                        const resValue = resultDetect.result?.value;

                        // 监控过程中微量增加进度，让进度条看起来在“动”
                        const miniProgress = Math.min(0.85, 0.4 + (attempts / 80) * 0.45);
                        let subStatus = `🎨 模型正在生图中 [${attempts}s]...`;
                        if (resValue?.status === 'img_no_btn') subStatus = `🖼️ 图片已生成，等待下载按钮...`;
                        jobProgress.set(filename, { completed: completedLoops + miniProgress, total: totalLoops, status: 'running', message: subStatus });

                        if (resValue && resValue.status === 'found') {
                            console.log(`${stepPrefix} ✅ [SUCCESS] 发现生图结果 (${resValue.imgCount} 张图)！正在启动下载流程...`);
                            const clickX = Math.floor(resValue.x);
                            const clickY = Math.floor(resValue.y);
                            
                            // 物理模拟点击 (移动鼠标触发 Hover 显示真实按钮)
                            await smoothMoveAndClick(Input, clickX, clickY, true);
                            
                            // 延时等待 hover 态动画、弹出气泡、和事件绑定生效
                            await new Promise(r => setTimeout(r, 800));

                            // JS 强制点击补位: 直接通过特征查找并点击，彻底杜绝元素被遮挡导致坐标寻址 elementFromPoint 失败
                            await Runtime.evaluate({ 
                                expression: `
                                    (() => {
                                        const allMessages = Array.from(document.querySelectorAll('message-content, [data-message-author="model"], .model-response-text, model-message'));
                                        const modelMessages = allMessages.filter(m => !m.closest('user-message, [data-message-author="user"]'));
                                        if (modelMessages.length === 0) return "NO_MSG";
                                        
                                        const lastMessage = modelMessages[modelMessages.length - 1];
                                        const allElements = Array.from(lastMessage.querySelectorAll('button, a, [role="button"], [data-test-id], mat-icon'));
                                        
                                        const downloadBtn = allElements.find(el => {
                                            const b = el.closest('button, a, [role="button"]') || el;
                                            const html = b.outerHTML.toLowerCase();
                                            const text = b.innerText.toLowerCase();
                                            const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                                            const title = (b.getAttribute('title') || '').toLowerCase();
                                            const tooltip = (b.getAttribute('mat-tooltip') || b.getAttribute('data-tooltip') || '').toLowerCase();
                                            
                                            // 极度精准的固定标识匹配
                                            return html.includes('下载完整尺寸的图片') || html.includes('download full size') || 
                                                text.includes('下载完整尺寸的图片') || text.includes('download full size') ||
                                                aria.includes('下载完整尺寸的图片') || aria.includes('download full size') ||
                                                title.includes('下载完整尺寸的图片') || title.includes('download full size') ||
                                                tooltip.includes('下载完整尺寸的图片') || tooltip.includes('download full size');
                                        });

                                        if (downloadBtn) {
                                            const btn = downloadBtn.closest('button, a[download], [role="button"]') || downloadBtn;
                                            if (typeof btn.click === 'function') {
                                                btn.click();
                                                return "JS_CLICKED_BY_SELECTOR";
                                            }
                                        }
                                        // 极其特殊情况下的底层备选坐标点击
                                        const el = document.elementFromPoint(${clickX}, ${clickY});
                                        if (el) {
                                            const btn = el.closest('button, a[download], [role="button"]') || el;
                                            if (typeof btn.click === 'function') {
                                                btn.click();
                                                return "JS_CLICKED_BY_POINT";
                                            }
                                        }
                                        return "JS_NOT_CLICKED";
                                    })()
                                `
                            });

                            // 验证是否触发了下载标识 (根据用户反馈：正在下载完整尺寸的图片 / Downloading full size)
                            let downloadDetected = false;
                            for (let poll = 0; poll < 10; poll++) { // 最多轮询 10 秒
                                const checkClick = await Runtime.evaluate({
                                    expression: `document.body.innerText.includes('Downloading full size') || document.body.innerText.includes('正在下载完整尺寸的图片')`
                                });
                                
                                if (checkClick.result && checkClick.result.value) {
                                    downloadDetected = true;
                                    break;
                                }
                                await new Promise(r => setTimeout(r, 1000));
                            }
                            
                            if (downloadDetected) {
                                console.log(`${stepPrefix} ✅ UI 响应成功：检测到“正在下载”提示，正在等待文件落盘...`);
                                jobProgress.set(filename, { completed: completedLoops + 0.9, total: totalLoops, status: 'running', message: '⬇️ 正在下载完整尺寸图片...' });
                            } else {
                                console.log(`${stepPrefix} ⚠️ 点击后多次尝试仍未见 UI “正在下载”提示，尝试等待文件趋势。`);
                            }
                            
                            // 实际的文件移动逻辑
                            const config = await getAutomationConfig();
                            const timeoutSeconds = parseConfigNumber(config.downloadTimeout, 35); // 默认缩短到 35 秒
                            const sysDir = (task.systemConfig && task.systemConfig.systemDownloadsDir) || config.systemDownloadsDir || path.join(os.homedir(), 'Downloads');
                            const userDownloadDir = userId ? path.join(downloadDir, userId.toString()) : downloadDir;
                            if (!fs.existsSync(userDownloadDir)) fs.mkdirSync(userDownloadDir, { recursive: true });
                            
                            const movedFiles = await waitForAndMoveDownloads(Date.now(), sysDir, userDownloadDir, timeoutSeconds, () => {
                                if (cancelledJobs.has(filename)) throw new Error('CANCELLED');
                            });
                            
                            if (movedFiles && movedFiles.length > 0) {
                                // Important: make sure we push the relative path to db (like "1/Gemini_xxx.jpg")
                                const prefixedFiles = userId ? movedFiles.map(f => path.join(userId.toString(), f).replace(/\\/g, '/')) : movedFiles;
                                task.downloadedFiles.push(...prefixedFiles);
                                task.status = 'completed';
                                found = true;
                            } else {
                                console.warn(`${stepPrefix} ⚠️ 尝试了下载点击，但未检测到新文件。`);
                                // 如果已经点击过且失败，我们不再无休止地在 while 循环中重复点击，增加 attempts 消耗
                                attempts += 10; 
                            }
                        } else if (resValue?.status === 'img_no_btn') {
                            if (attempts % 5 === 0) console.log(`${stepPrefix} 🧐 已看到图片 (${resValue.imgCount}张)，但下载按钮尚未出现，静待渲染...`);
                        }
                    }

                    if (!found) {
                        console.error(`${stepPrefix} ❌ 任务超时或下载失败。`);
                        task.status = 'failed';
                    }

                } catch (taskErr: any) {
                    const msg = taskErr.message || taskErr;
                    console.error(`${stepPrefix} ❌ 任务执行异常:`, msg);
                    task.status = 'failed';
                    // 如果是手动取消，则不再尝试后续循环，直接向外层抛出
                    if (msg === 'CANCELLED') throw taskErr;
                } finally {
                    if (client) {
                        try { await client.close(); } catch(e) {}
                    }
                    if (currentTarget) {
                        try { 
                            console.log(`${stepPrefix} 🧹 正在关闭任务标签页...`);
                            await CDP.Close({ id: currentTarget.id, port: 9222 }); 
                        } catch(e) {}
                    }
                }

                completedLoops++;
                jobProgress.set(filename, { completed: completedLoops, total: totalLoops, status: 'completed', message: `✅ 第 ${completedLoops} 个循环已完成` });
            }
        }
    } catch (err: any) {
        const errorMsg = err.message || String(err);
        if (errorMsg === 'CANCELLED') {
            console.log(`🛑 [TASK-${filename}] 任务已被手动取消`);
            jobProgress.set(filename, { completed: completedLoops, total: totalLoops, status: 'failed', message: `🛑 任务已手动取消` });
        } else {
            console.error('❌ CDP 引擎发生异常中断:', errorMsg);
            jobProgress.set(filename, { completed: completedLoops, total: totalLoops, status: 'failed', message: `❌ 发生异常: ${errorMsg.slice(0, 30)}` });
        }
        
        // 尝试诊断
        if (errorMsg.includes('Target crashed')) {
            console.log('🧐 诊断提示: 检测到目标页面崩溃。');
            console.log('👉 可能原因: 1. 内存不足; 2. UserData 目录被其它 Chrome 占用; 3. 显卡驱动冲突。');
            console.log('💡 建议: 在设置中尝试更换一个新的 UserData 目录路径。');
            
            try {
                const logFile = path.join(__dirname, 'chrome_debug.log');
                if (fs.existsSync(logFile)) {
                    const content = fs.readFileSync(logFile, 'utf-8');
                    const lines = content.trim().split('\n');
                    const logTail = lines.slice(-15).join('\n');
                    console.log('\n📋 --- 浏览器最后 15 行日志内容 ---');
                    console.log(logTail || '(日志文件为空)');
                    console.log('-----------------------------------\n');
                } else {
                    console.log('⚠️ 诊断失败: 找不到浏览器日志文件 ' + logFile);
                }
            } catch(diagErr: any) {
                console.error('⚠️ 诊断组件自身故障:', diagErr.message);
            }
        }

        // 关键修复：发生崩溃或异常时，确保内存中的任务对象被标记为失败，以便写入文件
        tasks.forEach(t => {
            if (t.status !== 'completed') t.status = 'failed';
        });
    } finally {
        cancelledJobs.delete(filename);
        // jobProgress.delete(filename); // 移动到执行循环外，确保归档后才清理状态
    }
    return tasks;
}

export async function executeBatch(input: any, filename: string, userId?: string | number) {
    console.log(`[Batch] 🚀 准备执行批次任务: ${filename}, 包含 ${Array.isArray(input) ? input.length : (input.tasks?.length || 0)} 个子任务`);
    if (input.systemConfig) {
        console.log(`[Batch] 🛠️ 收到系统下载目录配置: ${input.systemConfig.systemDownloadsDir}`);
    }
    const tasks = Array.isArray(input) ? input : (input.tasks || []);
    if (!Array.isArray(tasks) || tasks.length === 0) {
        console.log(`⚠️ 批次 ${filename} 中没有可执行的任务任务。`);
        return input;
    }

    // Attach systemConfig to each task so they can use it for download paths
    if (input.systemConfig) {
        tasks.forEach((t: any) => {
            if (!t.systemConfig) t.systemConfig = input.systemConfig;
        });
    }

    const firstExecutor = tasks[0]?.executor || 'cdp';
    console.log(`📡 任务分发器: 正在使用 [${firstExecutor.toUpperCase()}] 引擎执行批次 ${filename} (User: ${userId || 'global'})`);
    
    let result;
    if (firstExecutor === 'cdp') {
        result = await executeWithCDP(tasks, filename, userId);
    } else {
        result = await executeWithPhysicalSimulation(tasks, filename, userId);
    }

    if (Array.isArray(input)) {
        return result;
    } else {
        return { ...input, tasks: result };
    }
}

let lastCleanupDay = -1;

function cleanOldDebugScreenshots() {
    try {
        const now = new Date();
        const currentDay = now.getDate();
        const hours = now.getHours();

        // 每天中午 12 点清理昨天及更早的截图
        if (hours === 12 && lastCleanupDay !== currentDay) {
            lastCleanupDay = currentDay;
            const yesterdayEnd = new Date(now);
            yesterdayEnd.setDate(now.getDate() - 1);
            yesterdayEnd.setHours(23, 59, 59, 999);
            
            // 1. 清理新目录
            if (fs.existsSync(debugDir)) {
                console.log('🧹 [Cleanup] 正在清理专用目录中的调试截图...');
                const files = fs.readdirSync(debugDir);
                deleteFilesOlderThan(files, debugDir, yesterdayEnd);
            }

            // 2. 顺便清理根目录下的遗留截图（过渡期清理）
            console.log('🧹 [Cleanup] 正在扫描根目录遗留截图...');
            const rootFiles = fs.readdirSync(__dirname).filter(f => f.startsWith('debug_') && f.endsWith('.png'));
            deleteFilesOlderThan(rootFiles, __dirname, yesterdayEnd);
        }
    } catch (e) {
        console.error('❌ 清理调试截图失败:', e);
    }
}

function deleteFilesOlderThan(files: string[], baseDir: string, threshold: Date) {
    let deletedCount = 0;
    for (const file of files) {
        const filePath = path.join(baseDir, file);
        try {
            const stats = fs.statSync(filePath);
            if (stats.mtime < threshold) {
                fs.unlinkSync(filePath);
                deletedCount++;
            }
        } catch (e) {}
    }
    if (deletedCount > 0) {
        console.log(`🗑️ [Cleanup] 从 ${baseDir} 已删除 ${deletedCount} 张过期截图。`);
    }
}

export function startAutomationWatcher() {
  console.log('\n====================================================');
  console.log('🚀 CallGM 自动化引擎已成功启动！');
  console.log(`📂 正在实时监听任务目录: ${taskDir}`);
  console.log('👀 等待接收前端发送的任务...');
  console.log('====================================================\n');
  
  // Simple polling to avoid fs.watch cross-platform quirks
  setInterval(async () => {
    cleanOldDebugScreenshots();
    if (isRunning) return; // 防止并发冲突
    isRunning = true;

    try {
      // 获取所有任务目录（根 taskDir 和所有用户子目录）
      let allDirs = [taskDir];
      try {
        const subDirs = fs.readdirSync(taskDir).filter(f => {
            const fullPath = path.join(taskDir, f);
            return fs.statSync(fullPath).isDirectory() && f !== 'history';
        });
        allDirs = [...allDirs, ...subDirs.map(sd => path.join(taskDir, sd))];
      } catch (e) {}

      const taskFiles: { path: string, filename: string }[] = [];
      
      for (const dir of allDirs) {
          const files = fs.readdirSync(dir);
          files.filter(f => f.endsWith('.json') && fs.statSync(path.join(dir, f)).isFile()).forEach(f => {
              taskFiles.push({ path: path.join(dir, f), filename: f });
          });
      }

      if (taskFiles.length > 0) {
          console.log(`\n🔔 [${new Date().toLocaleTimeString()}] 检测到 ${taskFiles.length} 个任务文件！准备开始执行...`);
      } else {
          // 每 60 秒打印一次心跳日志
          if (Date.now() - lastHeartbeat > 60000) {
              console.log(`⏳ [${new Date().toLocaleTimeString()}] 自动化引擎持续监听中... (暂无新任务)`);
              lastHeartbeat = Date.now();
          }
      }

      for (const { path: filePath, filename } of taskFiles) {
        console.log(`\n📄 开始解析任务文件: ${filename} (位置: ${filePath})`);
        
        // 使用相对路径作为 Key，确保多用户环境下不冲突
        const relKey = path.relative(taskDir, filePath).replace(/\\/g, '/');
        const jobId = filename.replace('.json', '');

        // Read task
        const taskData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        
        // Update DB: Status -> Running
        try {
            db.prepare('UPDATE tasks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('running', jobId);
        } catch(e) {}

        // Execute task
        const updatedTaskData = await executeBatch(taskData, jobId, taskData.userId);
        
        // Update the file with downloadedFiles info before moving
        if (updatedTaskData && fs.existsSync(filePath)) {
            try {
                fs.writeFileSync(filePath, JSON.stringify(updatedTaskData, null, 2));
            } catch(e) {}
        }

        // Determine final status
        let finalStatus = 'completed';
        let resultFiles = [];
        if (updatedTaskData) {
            const tasks = Array.isArray(updatedTaskData) ? updatedTaskData : (updatedTaskData.tasks || []);
            if (tasks.some((t: any) => t.status === 'failed')) finalStatus = 'failed';
            
            // Collect all result files
            tasks.forEach((t: any) => {
                if (t.downloadedFiles) resultFiles.push(...t.downloadedFiles);
            });
        }

        // Register result files in assets table
        if (resultFiles.length > 0) {
            for (const file of resultFiles) {
                try {
                    db.prepare('INSERT OR IGNORE INTO assets (user_id, job_id, type, file_path) VALUES (?, ?, ?, ?)').run(
                        taskData.userId || 1, 
                        jobId, 
                        'image', 
                        file.replace(/\\/g, '/')
                    );
                } catch(e) {}
            }
        }

        // Update DB: Final Status and Data (to persist results like downloadedFiles)
        try {
            db.prepare('UPDATE tasks SET status = ?, progress = 100, data = ?, result_files = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
                finalStatus,
                JSON.stringify(updatedTaskData || taskData),
                JSON.stringify(resultFiles),
                jobId
            );
        } catch(e) {
            console.error(`Failed to update DB for job ${jobId}`, e);
        }
        
        // Move to history - 需要确保子目录对应的 history 文件夹存在
        if (fs.existsSync(filePath)) {
            const fileDir = path.dirname(filePath);
            const relativeSubDir = path.relative(taskDir, fileDir);
            const targetHistoryDir = path.join(historyDir, relativeSubDir);
            if (!fs.existsSync(targetHistoryDir)) fs.mkdirSync(targetHistoryDir, { recursive: true });
            
            const historyPath = path.join(targetHistoryDir, filename);
            try {
                fs.renameSync(filePath, historyPath);
                console.log(`✅ 任务文件 ${filename} 已全部执行完毕，并归档到 ${targetHistoryDir}。`);
            } catch(e) {
                console.error(`Failed to move ${filename} to history:`, e.message);
            }
        } else {
            console.log(`ℹ️ 任务文件 ${filename} 在执行过程中已由外部(如用户删除)清理。`);
        }
        
        // 核心优化：延迟清理内存状态，给 UI 缓冲时间
        setTimeout(() => {
            jobProgress.delete(relKey);
            jobProgress.delete(jobId);
        }, 3000);

        console.log('👀 恢复监听新任务...\n');
        lastHeartbeat = Date.now(); // 任务完成后重置心跳计时
      }
    } catch (err) {
      console.error('❌ 自动化引擎发生错误:', err);
    } finally {
      isRunning = false; // 执行完毕后释放锁
    }
  }, 3000); // Check every 3 seconds
}

let browserDebugState = '';
export function handleBrowserDebug(msg: string) {
    browserDebugState = msg;
    console.log(`  👉 [浏览器内部视角] ${msg.replace(/\\n/g, ' ')}`);
}

async function waitForAndMoveDownloads(clickTime: number, systemDownloadsDir: string, projectDownloadDir: string, maxWaitSeconds: number = 130, checkCancel?: () => void): Promise<string[]> {
    console.log(`[监控] 进入下载监控循环: sysDir=${systemDownloadsDir}, dest=${projectDownloadDir}, maxWait=${maxWaitSeconds}s`);
    console.log(`[DEBUG] waitForAndMoveDownloads called with maxWaitSeconds: ${maxWaitSeconds} seconds`);
    console.log(`\n⏳ 开始死守系统下载目录，等待图片出现: ${systemDownloadsDir}`);
    let attempts = 0;
    const movedFiles: string[] = [];

    while (attempts < maxWaitSeconds) {
        if (checkCancel) checkCancel();
        await new Promise(r => setTimeout(r, 1000));
        attempts++;

        try {
            if (!fs.existsSync(systemDownloadsDir)) {
                console.log(`⚠️ 找不到系统下载目录: ${systemDownloadsDir}`);
                return movedFiles;
            }

            const currentFiles = fs.readdirSync(systemDownloadsDir);
            let newestFile = null;
            let newestTime = 0;
            let isDownloading = false;

            for (const file of currentFiles) {
                if (file === '.DS_Store' || file === 'desktop.ini' || file.startsWith('.')) continue;
                
                // 检查是否正在下载 (浏览器临时文件)
                if (file.endsWith('.crdownload') || file.endsWith('.part') || file.endsWith('.tmp') || file.includes('.com.google.Chrome')) {
                    isDownloading = true;
                    continue;
                }

                // 只监控图片文件
                if (!file.match(/\.(jpg|jpeg|png|webp|gif)$/i)) {
                    continue;
                }
                
                const filePath = path.join(systemDownloadsDir, file);
                try {
                    const stat = fs.statSync(filePath);
                    // 综合考虑创建时间、修改时间、状态改变时间
                    const fileTime = Math.max(stat.ctimeMs, stat.mtimeMs, stat.birthtimeMs || 0);
                    
                    if (fileTime > newestTime) {
                        newestTime = fileTime;
                        newestFile = file;
                    }
                } catch (e) {}
            }

            if (isDownloading) {
                if (attempts % 5 === 0) console.log(`   ...图片正在下载中 (检测到临时文件)，请稍候... (已等待 ${attempts} 秒)`);
                continue;
            }

            // 进一步扩大时间窗口到 30 秒，防止系统时钟微小差异
            const timeDiff = newestTime - clickTime;
            if (newestFile && newestTime > clickTime - 30000) {
                console.log(`✅ [DEBUG] 成功监测到新下载的图片文件: ${newestFile}`);
                console.log(`   详细信息: 文件时间: ${new Date(newestTime).toLocaleTimeString()}, 点击时间: ${new Date(clickTime).toLocaleTimeString()}, 时间差: ${timeDiff}ms`);
                
                // 额外等待 3 秒，确保浏览器彻底释放文件占用锁
                await new Promise(r => setTimeout(r, 3000));
                
                const oldPath = path.join(systemDownloadsDir, newestFile);
                const newPath = path.join(projectDownloadDir, newestFile);
                try {
                    if (fs.existsSync(oldPath)) {
                        // 使用 fs.renameSync 移动文件，如果跨分区则使用 copy+unlink
                        try {
                            fs.renameSync(oldPath, newPath);
                        } catch (e) {
                            fs.copyFileSync(oldPath, newPath);
                            fs.unlinkSync(oldPath);
                        }
                        console.log(`📦 成功移动文件: ${newestFile} -> 项目 download 目录`);
                        movedFiles.push(newestFile);
                        
                        // 异步启动自动去水印处理
                        (async () => {
                            processingImages.add(newestFile);
                            console.log(`✨ [自动去水印] 正在处理: ${newestFile}...`);
                            try {
                                await autoInpaint(newPath);
                                console.log(`✅ [自动去水印] 完成: ${newestFile}`);
                            } catch (e) {
                                console.error(`❌ [自动去水印] 失败: ${newestFile}`, e);
                            } finally {
                                processingImages.delete(newestFile);
                            }
                        })();

                        return movedFiles;
                    }
                } catch (moveErr) {
                    console.error(`❌ 移动文件失败: ${newestFile}`, moveErr);
                }
            } else {
                if (attempts % 5 === 0) {
                    console.log(`   ...等待新文件出现... (最新文件是 ${newestFile || '无'}, 时间: ${newestTime ? new Date(newestTime).toLocaleTimeString() : 'N/A'}, 点击时间: ${new Date(clickTime).toLocaleTimeString()})`);
                }
            }
        } catch (err) {
            console.error('监控下载目录时出错:', err);
        }
    }
    console.log('⚠️ 等待下载超时或未检测到新文件。请检查：1. 浏览器是否弹出了"另存为"对话框？ 2. 浏览器的默认下载路径是否被修改？');
    return movedFiles;
}

async function executeWithPhysicalSimulation(tasks: any, filename: string, userId?: string | number) {
  const totalLoops = tasks.reduce((acc: number, t: any) => acc + t.count, 0);
  let completedLoops = 0;
  jobProgress.set(filename, { completed: completedLoops, total: totalLoops, status: 'running' });

  // 提前加载配置
  let systemDownloadsDir = path.join(os.homedir(), 'Downloads');
  let config = { 
    systemDownloadsDir: '', 
    pasteMin: 5, 
    pasteMax: 5, 
    clickMin: 8, 
    clickMax: 8, 
    downloadMin: 120, 
    downloadMax: 120, 
    taskMin: 5, 
    taskMax: 5,
    downloadCheckDelay: 1,
    downloadRetries: 3
  };
  
  // 优先从 data/config.json 读取，如果不存在则从根目录 config.json 读取并迁移
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  
  const configPath = path.join(dataDir, 'config.json');
  const oldConfigPath = path.join(__dirname, 'config.json');
  
  let targetConfigPath = configPath;
  if (!fs.existsSync(configPath) && fs.existsSync(oldConfigPath)) {
      console.log('📦 正在迁移配置文件到 data/config.json');
      fs.copyFileSync(oldConfigPath, configPath);
  }

  if (fs.existsSync(configPath)) {
      try {
          const configContent = fs.readFileSync(configPath, 'utf-8');
          config = { ...config, ...JSON.parse(configContent) };
          if (config.systemDownloadsDir) {
              // 增强路径清理：移除所有不可见字符、控制字符，并统一路径分隔符
              systemDownloadsDir = config.systemDownloadsDir
                .replace(/[\u200B-\u200D\uFEFF\u200E\u200F]/g, '')
                .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
                .trim();
              
              // 确保路径是绝对路径并符合当前操作系统规范
              systemDownloadsDir = path.resolve(systemDownloadsDir);
          }
      } catch (e) {
          console.error('读取配置文件失败:', e);
      }
  }

  try {
    // Dynamically import nut.js (using the maintained fork) and open
    const nutjs = await import('@nut-tree-fork/nut-js');
    const { keyboard, Key, mouse, screen, Point, clipboard } = nutjs;
    const open = (await import('open')).default;
    const isMac = os.platform() === 'darwin';

    // 封装地址栏注入逻辑 (终极无敌版：完美绕过 Chrome 粘贴保护 + 完美绕过中文输入法)
    const injectJsViaAddressBar = async (script: string) => {
        // 1. 聚焦地址栏 (Ctrl+L / Cmd+L)
        if (isMac) {
            await keyboard.pressKey(Key.LeftSuper, Key.L);
            await keyboard.releaseKey(Key.LeftSuper, Key.L);
        } else {
            await keyboard.pressKey(Key.LeftControl, Key.L);
            await keyboard.releaseKey(Key.LeftControl, Key.L);
        }
        await new Promise(r => setTimeout(r, 500));

        // 2. 终极 Trick：分段粘贴！
        // 为什么这么做？
        // - 如果直接粘贴 javascript:... Chrome 会为了安全自动删掉 javascript: 前缀。
        // - 如果用 keyboard.type('javascript:')，中文输入法会把它变成中文字符，导致回车后变成 Google 搜索。
        // - 解决方案：先复制粘贴一个 'j'，再复制粘贴 'avascript:...'。全程只用 Ctrl+V，绝对不触发输入法！

        // 2.1 复制并粘贴 'j'
        await clipboard.setContent('j');
        if (isMac) {
            await keyboard.pressKey(Key.LeftSuper, Key.V);
            await keyboard.releaseKey(Key.LeftSuper, Key.V);
        } else {
            await keyboard.pressKey(Key.LeftControl, Key.V);
            await keyboard.releaseKey(Key.LeftControl, Key.V);
        }
        await new Promise(r => setTimeout(r, 100));

        // 2.2 复制并粘贴剩下的部分
        await clipboard.setContent('avascript:' + script);
        if (isMac) {
            await keyboard.pressKey(Key.LeftSuper, Key.V);
            await keyboard.releaseKey(Key.LeftSuper, Key.V);
        } else {
            await keyboard.pressKey(Key.LeftControl, Key.V);
            await keyboard.releaseKey(Key.LeftControl, Key.V);
        }
        await new Promise(r => setTimeout(r, 500));

        // 3. 回车执行
        await keyboard.pressKey(Key.Enter);
        await keyboard.releaseKey(Key.Enter);
        await new Promise(r => setTimeout(r, 1000));
    };

    console.log('\n====================================================');
    console.log('准备开始【物理键鼠模拟】执行！');
    console.log('正在自动唤起默认浏览器并打开 Gemini...');
    console.log('====================================================\n');
    
    // 1. 使用系统命令自动打开/唤起浏览器，直接进入 Gemini
    await open('https://gemini.google.com/');
    
    // 等待浏览器启动、页面加载并自动获取焦点
    console.log('等待页面加载 (8秒)...');
    await new Promise(r => setTimeout(r, 8000));

    for (const task of tasks) {
      if (cancelledJobs.has(filename)) throw new Error('CANCELLED');
      if (!task.downloadedFiles) task.downloadedFiles = [];
      for (let i = 0; i < task.count; i++) {
        if (cancelledJobs.has(filename)) throw new Error('CANCELLED');
        jobProgress.set(filename, { completed: completedLoops + 0.1, total: totalLoops, status: 'running' });
        console.log(`\n正在执行任务: ${task.prompt}, 第 ${i + 1} 次`);
        
        // 1.5 粘贴参考图
        if (task.images && task.images.length > 0) {
            console.log(`准备粘贴 ${task.images.length} 张参考图...`);
            for (const imgUrl of task.images) {
                if (imgUrl.startsWith('blob:')) {
                    console.log(`⚠️ 发现旧版失效的参考图链接 (${imgUrl})，已跳过。请在网页端删除此任务并重新上传图片创建新任务！`);
                    continue;
                }
                
                // 修复路径拼接问题：如果 imgUrl 以 / 开头，path.join 可能会将其视为绝对路径（在某些系统上）
                const relativeUrl = imgUrl.startsWith('/') ? imgUrl.slice(1) : imgUrl;
                let localPath = path.join(__dirname, relativeUrl);
                
                if (!fs.existsSync(localPath)) {
                    // Fallback to base directory root search for historical paths
                    let fallbackDir = '';
                    if (relativeUrl.startsWith('uploads/')) fallbackDir = path.join(__dirname, 'uploads');
                    else if (relativeUrl.startsWith('download/')) fallbackDir = path.join(__dirname, 'download');
                    else if (relativeUrl.startsWith('downloads/')) fallbackDir = path.join(__dirname, 'download');
                    
                    if (fallbackDir) {
                        const fallbackPath = path.join(fallbackDir, path.basename(relativeUrl));
                        if (fs.existsSync(fallbackPath)) {
                            localPath = fallbackPath;
                        }
                    }
                }
                
                console.log(`正在查找参考图文件: ${localPath}`);
                if (fs.existsSync(localPath)) {
                    console.log(`文件存在，正在复制到剪贴板...`);
                    const success = copyImageToClipboard(localPath, isMac);
                    if (success) {
                        console.log(`复制成功，执行粘贴操作...`);
                        if (isMac) {
                            await keyboard.pressKey(Key.LeftSuper, Key.V);
                            await keyboard.releaseKey(Key.LeftSuper, Key.V);
                        } else {
                            await keyboard.pressKey(Key.LeftControl, Key.V);
                            await keyboard.releaseKey(Key.LeftControl, Key.V);
                        }
                        console.log(`粘贴完成，等待配置的粘贴后等待时间...`);
                        await new Promise(r => setTimeout(r, getRandomTime(config.pasteMin, config.pasteMax))); // 等待 5 秒让图片上传解析
                    } else {
                        console.log(`❌ 复制图片到剪贴板失败`);
                    }
                } else {
                    console.log(`❌ 找不到参考图文件: ${localPath}`);
                }
            }
        }

        jobProgress.set(filename, { completed: completedLoops + 0.2, total: totalLoops, status: 'running' });

        // 2. 复制提示词并粘贴 (支持中文)
        // (注: Gemini 网页加载或刷新后默认会自动聚焦输入框，因此直接粘贴即可)
        console.log('输入提示词...');
        await clipboard.setContent(task.prompt);
        if (isMac) {
            await keyboard.pressKey(Key.LeftSuper, Key.V);
            await keyboard.releaseKey(Key.LeftSuper, Key.V);
        } else {
            await keyboard.pressKey(Key.LeftControl, Key.V);
            await keyboard.releaseKey(Key.LeftControl, Key.V);
        }
        await new Promise(r => setTimeout(r, 1000));

        jobProgress.set(filename, { completed: completedLoops + 0.3, total: totalLoops, status: 'running' });

        // 4. 发送 (回车)
        console.log('发送任务...');
        await keyboard.pressKey(Key.Enter);
        await keyboard.releaseKey(Key.Enter);

        // 等待 5 秒，确保新的对话气泡已经出现在 DOM 中，避免获取到上一次的旧按钮
        await new Promise(r => setTimeout(r, 5000));

        // 5. 动态等待生成完成并根据设置下载
        console.log(`等待生图完成... (自动下载: ${task.download ? '开启' : '关闭'})`);
        
        // 清空状态
        browserDebugState = 'WAITING_FOR_GEMINI';
        
        // 记录任务开始时间，用于后续通过文件修改时间查找下载的文件
        const taskStartTime = Date.now();
        
        // 在注入脚本前，提前给系统的 Downloads 文件夹拍个“快照”，防止错过 GEMINI_FOUND 信号
        // (config 和 systemDownloadsDir 已在函数开头加载)
        
        const rawPollScript = `void((() => {
            let hud = document.getElementById('callgm-hud');
            if (!hud) {
                hud = document.createElement('div');
                hud.id = 'callgm-hud';
                hud.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);color:#00ff00;padding:20px;z-index:9999999;font-size:18px;border-radius:10px;pointer-events:none;font-family:monospace;white-space:pre-wrap;text-align:center;box-shadow:0 4px 6px rgba(0,0,0,0.3);border:2px solid #00ff00;';
                document.body.appendChild(hud);
            }
            function updateStatus(text) {
                hud.innerText = text;
                hud.style.backgroundColor = 'rgba(0,0,0,0.85)';
                /* 彻底移除所有通信代码 (Fetch/Clipboard/Blob下载) */
                /* 仅保留视觉 UI 提示，Node.js 端将直接通过监控文件系统来判断进度 */
            }
            let attempts = 0;
            let imageFoundAttempts = 0;
            const checkInterval = setInterval(() => {
                attempts++;
                if (attempts > 120) { // 增加超时上限
                    clearInterval(checkInterval);
                    updateStatus('GEMINI_TIMEOUT\\n❌ 等待超时');
                    return;
                }
                const messages = document.querySelectorAll('message-content, [data-message-author="model"], .model-response-text, model-message');
                const lastMessage = messages.length > 0 ? messages[messages.length - 1] : document;
                const images = lastMessage.querySelectorAll('img');
                
                images.forEach(img => {
                    img.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
                    img.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
                    if(img.parentElement) {
                        img.parentElement.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
                    }
                });

                const allBtns = Array.from(lastMessage.querySelectorAll('button, a, [role="button"], [data-test-id]'));
                const targetBtns = allBtns.filter(b => {
                    const html = b.outerHTML.toLowerCase();
                    const text = b.innerText.toLowerCase();
                    const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                    const title = (b.getAttribute('title') || '').toLowerCase();
                    const tooltip = (b.getAttribute('mat-tooltip') || '').toLowerCase();
                    const dataTooltip = (b.getAttribute('data-tooltip') || '').toLowerCase();
                    
                    return html.includes('下载完整尺寸的图片') || html.includes('download full size') || 
                           text.includes('下载完整尺寸的图片') || text.includes('download full size') ||
                           aria.includes('下载完整尺寸的图片') || aria.includes('download full size') ||
                           title.includes('下载完整尺寸的图片') || title.includes('download full size') ||
                           tooltip.includes('下载完整尺寸的图片') || tooltip.includes('download full size') ||
                           dataTooltip.includes('下载完整尺寸的图片') || dataTooltip.includes('download full size');
                });
                const debugInfo = 'DEBUG: 第' + attempts + '次扫描\\n找到图片: ' + images.length + ' 张\\n找到所有按钮: ' + allBtns.length + ' 个\\n匹配到下载按钮: ' + targetBtns.length + ' 个';
                updateStatus(debugInfo);
                if (targetBtns.length > 0 && images.length > 0) {
                    clearInterval(checkInterval);
                    updateStatus('GEMINI_FOUND\\n✅ 找到图片和按钮，等待触发...');
                    if (${task.download}) {
                        setTimeout(() => {
                            updateStatus('GEMINI_TRIGGERING\\n⬇️ 正在触发下载...');
                            const tryDownload = (retryCount) => {
                                const currentBtns = Array.from(lastMessage.querySelectorAll('button, a, [role="button"], [data-test-id]')).filter(b => {
                                    const html = b.outerHTML.toLowerCase();
                                    const text = b.innerText.toLowerCase();
                                    const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                                    return html.includes('下载完整尺寸的图片') || html.includes('download full size') || 
                                           text.includes('下载完整尺寸的图片') || text.includes('download full size') || 
                                           aria.includes('下载完整尺寸的图片') || aria.includes('download full size');
                                });
                                
                                const btnsToClick = currentBtns.length > 0 ? currentBtns : targetBtns;
                                
                                btnsToClick.forEach((btn, index) => {
                                    setTimeout(() => {
                                        btn.click();
                                        btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                                        btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                                    }, index * 1500);
                                });

                                setTimeout(() => {
                                    const bodyText = document.body.innerText;
                                    const success = bodyText.includes('Downloading full size') || bodyText.includes('正在下载完整尺寸的图片');
                                    
                                    if (success) {
                                        updateStatus('GEMINI_CLICKED\\n⏳ 已成功触发下载！Node.js 正在后台监控文件...');
                                    } else if (retryCount < ${config.downloadRetries}) {
                                        const waitTime = ${config.clickMax} * (retryCount + 1);
                                        updateStatus('GEMINI_RETRYING\\n⚠️ 未检测到下载提示，' + waitTime + '秒后进行第' + (retryCount + 1) + '次重试...');
                                        setTimeout(() => tryDownload(retryCount + 1), waitTime * 1000);
                                    } else {
                                        updateStatus('GEMINI_CLICKED\\n⏳ 已达到最大重试次数，Node.js 正在后台监控文件...');
                                    }
                                }, ${config.downloadCheckDelay} * 1000);
                            };
                            tryDownload(0);
                        }, ${getRandomTime(config.clickMin, config.clickMax)});
                    } else {
                        setTimeout(() => {
                            updateStatus('GEMINI_DONE\\n🎉 任务完成！(未开启下载)');
                        }, 1000);
                    }
                } else if (images.length > 0) {
                    imageFoundAttempts++;
                    /* 只要有图片，就一直等，直到找到下载按钮，不轻易报错 */
                    if (imageFoundAttempts > 60) { // 增加等待时长
                        clearInterval(checkInterval);
                        updateStatus('GEMINI_NO_BTN\\n⚠️ 图片已生成，但长时间未找到下载按钮');
                    }
                }
            }, 2000);
        })());`;
        
        // 将多行脚本压缩成单行 (虽然控制台支持多行，但地址栏必须单行)
        const pollScript = rawPollScript.replace(/\/\*.*?\*\//gs, '').replace(/\/\/.*?\n/g, ' ').replace(/\n/g, ' ').replace(/\s{2,}/g, ' ');
        await injectJsViaAddressBar(pollScript);

        // 彻底抛弃状态轮询，直接进入文件监控模式 (Zero-IPC 架构)
        if (task.download) {
            console.log('✅ 脚本已注入！Node.js 开始死守下载目录，等待图片出现...');
            const injectTime = Date.now();
            
            // 使用配置的超时时间
            const min = parseConfigNumber(config.downloadMin, 180);
            const max = parseConfigNumber(config.downloadMax, 200);
            const timeoutSeconds = Math.floor(getRandomTime(min, max) / 1000);
            
            // 给足等待图片生成和下载
            // 监控下载
            const userDownloadDir = userId ? path.join(downloadDir, userId.toString()) : downloadDir;
            if (!fs.existsSync(userDownloadDir)) fs.mkdirSync(userDownloadDir, { recursive: true });

            const files = await waitForAndMoveDownloads(injectTime, systemDownloadsDir, userDownloadDir, timeoutSeconds, () => {
                if (cancelledJobs.has(filename)) throw new Error('CANCELLED');
            });
            if (files && files.length > 0) {
                const prefixedFiles = userId ? files.map(f => path.join(userId.toString(), f).replace(/\\/g, '/')) : files;
                task.downloadedFiles.push(...prefixedFiles);
                console.log(`📦 成功移动 ${files.length} 个文件`);
                task.status = 'completed';
            } else {
                console.log(`⚠️ ${timeoutSeconds}秒内未检测到新图片，任务失败。`);
                task.status = 'failed';
                throw new Error('下载超时或未检测到图片');
            }
        } else {
            console.log('✅ 脚本已注入！(未开启下载，等待 45 秒后进入下一任务)');
            await new Promise(r => setTimeout(r, 45000));
            task.status = 'completed';
        }

        console.log('✅ 当前任务彻底执行完毕！准备进入下一个任务。');
        completedLoops++;
        // Identify if it's the final loop
        if (completedLoops >= totalLoops) {
            jobProgress.set(filename, { completed: completedLoops, total: totalLoops, status: 'completed' });
        } else {
            jobProgress.set(filename, { completed: completedLoops, total: totalLoops, status: 'running' });
        }
        
        // 使用配置的任务间隔时间
        await new Promise(r => setTimeout(r, getRandomTime(config.taskMin, config.taskMax)));

        // 如果还有下一次循环，关闭当前标签页，重新打开新标签页
        if (i < task.count - 1 || tasks.indexOf(task) < tasks.length - 1) {
            console.log('🔄 关闭当前标签页，重新打开新标签页...');
            if (isMac) {
                await keyboard.pressKey(Key.LeftSuper, Key.W);
                await keyboard.releaseKey(Key.LeftSuper, Key.W);
                await new Promise(r => setTimeout(r, 1000));
                await keyboard.pressKey(Key.LeftSuper, Key.T);
                await keyboard.releaseKey(Key.LeftSuper, Key.T);
            } else {
                await keyboard.pressKey(Key.LeftControl, Key.W);
                await keyboard.releaseKey(Key.LeftControl, Key.W);
                await new Promise(r => setTimeout(r, 1000));
                await keyboard.pressKey(Key.LeftControl, Key.T);
                await keyboard.releaseKey(Key.LeftControl, Key.T);
            }
            await new Promise(r => setTimeout(r, 2000));
            await open('https://gemini.google.com/');
            await new Promise(r => setTimeout(r, 8000));
        }
      }
    }
    
    console.log('\n🎉 所有任务物理模拟执行完毕！');
    return tasks;
  } catch (error: any) {
    const errorMsg = error.message || String(error);
    if (errorMsg === 'CANCELLED') {
      console.log(`🛑 [PHYSICAL-TASK-${filename}] 任务已被手动取消`);
      jobProgress.set(filename, { completed: completedLoops, total: totalLoops, status: 'failed', message: `🛑 任务已手动取消` });
    } else {
      console.error('\n❌ 自动化执行过程中发生严重错误:');
      console.error(errorMsg);
      if (error.stack) {
        console.error('详细堆栈:', error.stack);
      }
      console.log('\n(提示: 如果上方报错提示找不到模块，请在本地运行 npm install @nut-tree-fork/nut-js open)');
    }
    
    // 把所有未完成的任务都标记为 failed，确保写入历史记录时能体现出报错
    if (tasks && Array.isArray(tasks)) {
        for (const task of tasks) {
            if (task.status !== 'completed') {
                task.status = 'failed';
            }
        }
    }
    return tasks;
  } finally {
    cancelledJobs.delete(filename);
    try {
        // 只有当加载了 nutjs 且环境支持时才尝试关闭
        const nutjs = await import('@nut-tree-fork/nut-js');
        const { keyboard, Key } = nutjs;
        const isMac = os.platform() === 'darwin';
        
        console.log('🏁 正在尝试关闭自动化任务使用的浏览器标签页...');
        if (isMac) {
            await keyboard.pressKey(Key.LeftSuper, Key.W);
            await keyboard.releaseKey(Key.LeftSuper, Key.W);
        } else {
            await keyboard.pressKey(Key.LeftControl, Key.W);
            await keyboard.releaseKey(Key.LeftControl, Key.W);
        }
    } catch (e) {
        // 如果 nutjs 还没加载或者关闭失败，静默处理
    }
    // jobProgress.delete(filename);
  }
}
