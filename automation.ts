import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import { execSync, spawn } from 'child_process';
import net from 'net';
import { autoInpaint } from './watermarkRemover.js';
import CDP from 'chrome-remote-interface';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const taskDir = path.join(__dirname, 'task');
const historyDir = path.join(taskDir, 'history');
const downloadDir = path.join(__dirname, 'download');

// Ensure directories exist
if (!fs.existsSync(taskDir)) fs.mkdirSync(taskDir, { recursive: true });
if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true });
if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

function copyImageToClipboard(imagePath: string, isMac: boolean) {
    try {
        const absPath = path.resolve(imagePath);
        if (isMac) {
            execSync(`osascript -e 'set the clipboard to (read (POSIX file "${absPath}") as TIFF picture)'`);
        } else if (os.platform() === 'win32') {
            execSync(`powershell -command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::SetImage([System.Drawing.Image]::FromFile('${absPath}'))"`);
        } else {
            execSync(`xclip -selection clipboard -t image/png -i "${absPath}"`);
        }
        return true;
    } catch (e) {
        console.error('复制图片到剪贴板失败:', e);
        return false;
    }
}

let isRunning = false;
let lastHeartbeat = Date.now();

export const jobProgress = new Map<string, { completed: number, total: number, status: string }>();
export const processingImages = new Set<string>();

const getRandomTime = (min: number, max: number) => {
    return Math.floor(Math.random() * (max - min + 1) + min) * 1000;
};

async function getAutomationConfig() {
    const dataDir = path.join(__dirname, 'data');
    const configPath = path.join(dataDir, 'config.json');
    if (fs.existsSync(configPath)) {
        return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
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
        const { execSync } = require('child_process');
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

async function executeWithCDP(tasks: any[], filename: string) {
    const totalLoops = tasks.reduce((acc: number, t: any) => acc + (parseInt(t.count) || 1), 0);
    let completedLoops = 0;
    jobProgress.set(filename, { completed: completedLoops, total: totalLoops, status: 'running' });

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

    let client: any = null;
    try {
        // 增加重试机制连接核心服务
        let targets;
        try {
            targets = await CDP.List({ port: 9222 });
        } catch (e) {
            console.log('⚠️ 连接失败，等待 2 秒重试...');
            await new Promise(r => setTimeout(r, 2000));
            targets = await CDP.List({ port: 9222 });
        }

        let target = targets.find((t: any) => (t.url.includes('gemini.google.com') || t.url === 'about:blank') && t.type === 'page');
        
        if (!target) {
            console.log('🌐 未发现可用标签页，正在等待浏览器稳定后创建新标签页...');
            await new Promise(r => setTimeout(r, 2000));
            target = await CDP.New({ url: 'https://gemini.google.com/', port: 9222 });
        } else if (target.url === 'about:blank') {
            console.log('🌐 发现空标签页，正在导航到 Gemini...');
            const tempClient = await CDP({ target: target.id, port: 9222 });
            await tempClient.Page.navigate({ url: 'https://gemini.google.com/' });
            await new Promise(r => setTimeout(r, 2000));
            await tempClient.close();
        }

        client = await CDP({ target: target.id, port: 9222 });
        const { Page, Runtime, Input, Network, DOM } = client;

        // 监听崩溃事件
        client.on('error', (err: any) => {
            console.error('🚫 [CDP 实时监听] 捕获到底层错误:', err);
        });
        client.on('disconnect', () => {
            console.warn('🔌 [CDP 实时监听] 浏览器连接已断开');
        });

        await Network.enable();
        await Page.enable();
        await Runtime.enable();
        await DOM.enable();

        console.log('✅ CDP 连接成功！已锁定受控浏览器。');

        const simulateIdleMovement = async () => {
             const x = Math.floor(Math.random() * 800) + 100;
             const y = Math.floor(Math.random() * 600) + 100;
             await smoothMoveAndClick(Input, x, y, false);
        };

        for (const task of tasks) {
            task.download = true;
            if (!task.downloadedFiles) task.downloadedFiles = [];
            
            for (let i = 0; i < (parseInt(task.count) || 1); i++) {
                const stepPrefix = `[TASK-${filename}][Loop-${i + 1}]`;
                console.log(`\n${stepPrefix} 🚀 正在执行任务: "${task.prompt}"`);
                
                await Page.bringToFront();
                
                const currentStatus = await Runtime.evaluate({ expression: 'window.location.href' });
                if (!currentStatus.result.value.includes('gemini.google.com')) {
                    console.log(`${stepPrefix} ⚠️ 检测到偏离 Gemini 页面，正在重新导航...`);
                    await Page.navigate({ url: 'https://gemini.google.com/' });
                    await new Promise(r => setTimeout(r, 5000));
                }

                console.log(`${stepPrefix} ⏳ 等待页面渲染与加载 (6秒)...`);
                await new Promise(r => setTimeout(r, 6000));
                await simulateIdleMovement();

                console.log(`${stepPrefix} ⌨️ 正在定位输入框进行贝塞尔平滑移动并获取焦点...`);
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
                } else {
                    console.log(`${stepPrefix} ⚠️ 警告: 未能找到输入框中心点，直接执行操作。`);
                }

                await new Promise(r => setTimeout(r, 500));

                // 1. 粘贴参考图 (如果存在)
                const config = await getAutomationConfig();
                const isMac = os.platform() === 'darwin';
                
                if (task.images && task.images.length > 0) {
                    console.log(`${stepPrefix} 🖼️ 检测到参考图，准备执行粘贴流程...`);
                    for (const imgUrl of task.images) {
                        const relativeUrl = imgUrl.startsWith('/') ? imgUrl.slice(1) : imgUrl;
                        const localPath = path.resolve(__dirname, relativeUrl);
                        
                        if (fs.existsSync(localPath)) {
                            console.log(`${stepPrefix} 📋 正在将图片放入系统剪贴板: ${path.basename(localPath)}`);
                            const success = copyImageToClipboard(localPath, isMac);
                            if (success) {
                                console.log(`${stepPrefix} 📥 发送物理粘贴指令 (Ctrl+V)...`);
                                if (isMac) {
                                    await Input.dispatchKeyEvent({ type: 'keyDown', modifiers: 8, key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86 }); 
                                    await Input.dispatchKeyEvent({ type: 'keyUp', modifiers: 8, key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86 });
                                } else {
                                    await Input.dispatchKeyEvent({ type: 'keyDown', modifiers: 2, key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86 }); 
                                    await Input.dispatchKeyEvent({ type: 'keyUp', modifiers: 2, key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86 });
                                }
                                const pasteWait = (config.pasteMin || 5) * 1000;
                                console.log(`${stepPrefix} ⏳ 等待图片上传解析 (${config.pasteMin || 5}s)...`);
                                await new Promise(r => setTimeout(r, pasteWait));
                            }
                        } else {
                            console.log(`${stepPrefix} ❌ 找不到图片文件: ${localPath}`);
                        }
                    }
                }

                console.log(`${stepPrefix} ✍️ 逐字模拟拟人化输入提示词: "${task.prompt}"`);
                for (const char of task.prompt) {
                    await Input.dispatchKeyEvent({ type: 'char', text: char });
                    await new Promise(r => setTimeout(r, Math.random() * 160 + 40));
                }
                
                await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));
                console.log(`${stepPrefix} ⏎ 发送 Enter 键触发生成...`);
                await Input.dispatchKeyEvent({ type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
                await Input.dispatchKeyEvent({ type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });

                console.log(`${stepPrefix} 🛡️ 静默监控结果生成 (4s 轮询)...`);
                
                let found = false;
                let attempts = 0;
                while (!found && attempts < 50) {
                    await new Promise(r => setTimeout(r, 4000));
                    attempts++;
                    
                    if (attempts % 5 === 0) {
                         await simulateIdleMovement();
                    }

                    const checkScript = `
                        (() => {
                            const messages = document.querySelectorAll('message-content, [data-message-author="model"], model-message');
                            if (messages.length === 0) return { status: 'no_messages' };
                            const lastMsg = messages[messages.length - 1];
                            const img = lastMsg.querySelector('img');
                            const btns = Array.from(lastMsg.querySelectorAll('button, a[download]'));
                            const downloadBtn = btns.find(b => {
                                const txt = (b.innerText || b.getAttribute('aria-label') || b.outerHTML).toLowerCase();
                                return txt.includes('下载') || txt.includes('download');
                            });
                            
                            if (img && downloadBtn) {
                                const rect = downloadBtn.getBoundingClientRect();
                                return { 
                                    status: 'found',
                                    x: rect.left + rect.width / 2,
                                    y: rect.top + rect.height / 2
                                };
                            }
                            return { status: 'waiting' };
                        })()
                    `;
                    const result = await Runtime.evaluate({ expression: checkScript, returnByValue: true });
                    const resValue = result.result?.value;

                    if (resValue && resValue.status === 'found') {
                        console.log(`${stepPrefix} ✅ [SUCCESS] 第一时间捕捉到生成结果！`);
                        const { x, y } = resValue;
                        console.log(`${stepPrefix} 🖱️ [Bezier] 曲线平滑移动至下载按钮: (${Math.floor(x)}, ${Math.floor(y)})`);
                        await smoothMoveAndClick(Input, x, y, true);
                        found = true;
                    }
                }

                if (found) {
                     const config = await getAutomationConfig();
                     const sysDir = config.systemDownloadsDir || path.join(os.homedir(), 'Downloads');
                     const files = await waitForAndMoveDownloads(Date.now(), sysDir, downloadDir, 60);
                     if (files && files.length > 0) {
                         task.downloadedFiles.push(...files);
                         task.status = 'completed';
                     } else {
                         task.status = 'failed';
                     }
                } else {
                    task.status = 'failed';
                }

                completedLoops++;
                jobProgress.set(filename, { completed: completedLoops, total: totalLoops, status: 'running' });
                
                // 环节间隔，反爬：随机休息
                const restTime = 5000 + Math.random() * 5000;
                console.log(`${stepPrefix} 💤 循环结束，随机休息 ${Math.floor(restTime/1000)} 秒后继续...`);
                await new Promise(r => setTimeout(r, restTime));
            }
        }
    } catch (err: any) {
        const errorMsg = err.message || String(err);
        console.error('❌ CDP 引擎发生异常中断:', errorMsg);
        
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
        if (client) {
            console.log(`📡 正在断开 CDP 调试连接...`);
            try { await client.close(); } catch(e) {}
        }
        jobProgress.delete(filename);
    }
    return tasks;
}

async function executeBatch(tasks: any[], filename: string) {
    const firstExecutor = tasks[0]?.executor || 'cdp';
    console.log(`📡 任务分发器: 正在使用 [${firstExecutor.toUpperCase()}] 引擎执行批次 ${filename}`);
    
    if (firstExecutor === 'cdp') {
        return await executeWithCDP(tasks, filename);
    } else {
        return await executeWithPhysicalSimulation(tasks, filename);
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
    if (isRunning) return; // 防止并发冲突
    isRunning = true;

    try {
      const files = fs.readdirSync(taskDir);
      const taskFiles = files.filter(f => f.endsWith('.json') && fs.statSync(path.join(taskDir, f)).isFile());

      if (taskFiles.length > 0) {
          console.log(`\n🔔 [${new Date().toLocaleTimeString()}] 检测到 ${taskFiles.length} 个新任务文件！准备开始执行...`);
      } else {
          // 每 60 秒打印一次心跳日志，让用户知道脚本还在正常工作
          if (Date.now() - lastHeartbeat > 60000) {
              console.log(`⏳ [${new Date().toLocaleTimeString()}] 自动化引擎持续监听中... (暂无新任务)`);
              lastHeartbeat = Date.now();
          }
      }

      for (const file of taskFiles) {
        const filePath = path.join(taskDir, file);
        console.log(`\n📄 开始解析任务文件: ${file}`);
        
        // Read task
        const taskData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        
        // Execute task
        const updatedTaskData = await executeBatch(taskData, file);
        
        // Update the file with downloadedFiles info before moving
        if (updatedTaskData) {
            fs.writeFileSync(filePath, JSON.stringify(updatedTaskData, null, 2));
        }
        
        // Move to history
        const historyPath = path.join(historyDir, file);
        fs.renameSync(filePath, historyPath);
        console.log(`✅ 任务文件 ${file} 已全部执行完毕，并归档到 history 目录。`);
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

async function waitForAndMoveDownloads(clickTime: number, systemDownloadsDir: string, projectDownloadDir: string, maxWaitSeconds: number = 130): Promise<string[]> {
    console.log(`\n⏳ 开始死守系统下载目录，等待图片出现: ${systemDownloadsDir}`);
    let attempts = 0;
    const movedFiles: string[] = [];

    while (attempts < maxWaitSeconds) {
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

async function executeWithPhysicalSimulation(tasks: any, filename: string) {
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
      if (!task.downloadedFiles) task.downloadedFiles = [];
      for (let i = 0; i < task.count; i++) {
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
                const localPath = path.join(__dirname, relativeUrl);
                
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
                    
                    return html.includes('下载') || html.includes('download') || 
                           text.includes('下载') || text.includes('download') ||
                           aria.includes('下载') || aria.includes('download') ||
                           title.includes('下载') || title.includes('download') ||
                           tooltip.includes('下载') || tooltip.includes('download') ||
                           dataTooltip.includes('下载') || dataTooltip.includes('download');
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
                                    return html.includes('下载') || html.includes('download') || text.includes('下载') || text.includes('download') || aria.includes('下载') || aria.includes('download');
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
            const timeoutSeconds = Math.floor(getRandomTime(config.downloadMin, config.downloadMax) / 1000);
            
            // 给足等待图片生成和下载
            const files = await waitForAndMoveDownloads(injectTime, systemDownloadsDir, downloadDir, timeoutSeconds);
            if (files && files.length > 0) {
                task.downloadedFiles.push(...files);
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
        jobProgress.set(filename, { completed: completedLoops, total: totalLoops, status: 'running' });
        
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
    console.error('\n❌ 自动化执行过程中发生严重错误:');
    console.error(error.message || error);
    if (error.stack) {
        console.error('详细堆栈:', error.stack);
    }
    console.log('\n(提示: 如果上方报错提示找不到模块，请在本地运行 npm install @nut-tree-fork/nut-js open)');
    
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
    jobProgress.delete(filename);
  }
}
