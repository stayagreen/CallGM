import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const taskDir = path.join(__dirname, 'task');
const historyDir = path.join(taskDir, 'history');
const downloadDir = path.join(__dirname, 'download');

// Ensure directories exist
if (!fs.existsSync(taskDir)) fs.mkdirSync(taskDir, { recursive: true });
if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true });
if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

let isRunning = false;
let lastHeartbeat = Date.now();

export const jobProgress = new Map<string, { completed: number, total: number, status: string }>();

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
        
        // Execute task (Physical Simulation)
        const updatedTaskData = await executeWithPhysicalSimulation(taskData, file);
        
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

async function waitForAndMoveDownloads(initialSnapshot: Set<string>, systemDownloadsDir: string, projectDownloadDir: string): Promise<string[]> {
    console.log(`\n⏳ 开始监控系统下载目录: ${systemDownloadsDir}`);
    let attempts = 0;
    const maxAttempts = 60; // 最多等 60 秒
    const movedFiles: string[] = [];

    while (attempts < maxAttempts) {
        await new Promise(r => setTimeout(r, 1000));
        attempts++;

        try {
            if (!fs.existsSync(systemDownloadsDir)) {
                console.log(`⚠️ 找不到系统下载目录: ${systemDownloadsDir}`);
                return movedFiles;
            }

            const currentFiles = fs.readdirSync(systemDownloadsDir);
            // 找出在触发下载后新出现的文件
            const newFiles = currentFiles.filter(f => !initialSnapshot.has(f));

            if (newFiles.length === 0) {
                if (attempts % 5 === 0) console.log('   ...等待新文件出现...');
                continue;
            }

            let isDownloading = false;
            let readyFiles = [];

            for (const file of newFiles) {
                // 如果存在 Chrome/Firefox 等浏览器的临时下载文件后缀，说明还没下载完
                if (file.endsWith('.crdownload') || file.endsWith('.part') || file.endsWith('.tmp')) {
                    isDownloading = true;
                    break; 
                }
                // 只要不是临时文件，且不是系统隐藏文件，就认为是下载完成的文件！
                if (file !== '.DS_Store' && file !== 'desktop.ini' && !file.startsWith('.')) {
                    readyFiles.push(file);
                }
            }

            if (isDownloading) {
                if (attempts % 5 === 0) console.log('   ...文件正在下载中，请稍候...');
                continue; // 继续等待下载完成
            }

            if (readyFiles.length > 0) {
                // 额外等待 2 秒，确保浏览器彻底释放文件占用锁
                await new Promise(r => setTimeout(r, 2000));
                
                for (const file of readyFiles) {
                    const oldPath = path.join(systemDownloadsDir, file);
                    const newPath = path.join(projectDownloadDir, file);
                    try {
                        if (fs.existsSync(oldPath)) {
                            // 使用 copy + unlink 避免跨盘符移动报错 (EXDEV)
                            fs.copyFileSync(oldPath, newPath);
                            fs.unlinkSync(oldPath);
                            console.log(`📦 成功剪切文件: ${file} -> 项目 download 目录`);
                            movedFiles.push(file);
                        }
                    } catch (moveErr) {
                        console.error(`❌ 移动文件失败: ${file}`, moveErr);
                    }
                }
                return movedFiles; // 移动完毕，退出等待
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

  try {
    // Dynamically import nut.js (using the maintained fork) and open
    const nutjs = await import('@nut-tree-fork/nut-js');
    const { keyboard, Key, mouse, screen, Point, clipboard } = nutjs;
    const open = (await import('open')).default;
    const isMac = os.platform() === 'darwin';

    // 封装地址栏注入逻辑 (终极无敌版：完美绕过 Chrome 粘贴保护 + 完美绕过中文输入法)
    const injectJsViaAddressBar = async (script: string) => {
        // 0. 夺回焦点：如果有其他弹窗抢走焦点，尝试点击屏幕中上方安全区域恢复浏览器焦点
        try {
            const screenWidth = await screen.width();
            await mouse.setPosition(new Point(screenWidth / 2, 200));
            await mouse.leftClick();
            await new Promise(r => setTimeout(r, 500));
        } catch (e) {
            console.log('恢复焦点失败，继续尝试...');
        }

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
        console.log(`\n正在执行任务: ${task.prompt}, 第 ${i + 1} 次`);
        
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

        // 4. 发送 (回车)
        console.log('发送任务...');
        await keyboard.pressKey(Key.Enter);
        await keyboard.releaseKey(Key.Enter);

        // 等待 5 秒，确保新的对话气泡已经出现在 DOM 中，避免获取到上一次的旧按钮
        await new Promise(r => setTimeout(r, 5000));

        // 5. 动态等待生成完成并根据设置下载
        console.log(`等待生图完成... (自动下载: ${task.download ? '开启' : '关闭'})`);
        
        // 清空剪贴板并设置初始状态
        await clipboard.setContent('WAITING_FOR_GEMINI');
        
        // 在注入脚本前，提前给系统的 Downloads 文件夹拍个“快照”，防止错过 GEMINI_FOUND 信号
        const systemDownloadsDir = path.join(os.homedir(), 'Downloads');
        let initialDownloadsSnapshot = new Set<string>();
        if (fs.existsSync(systemDownloadsDir)) {
            initialDownloadsSnapshot = new Set(fs.readdirSync(systemDownloadsDir));
        }
        
        const rawPollScript = `void((() => {
            let hud = document.getElementById('callgm-hud');
            if (!hud) {
                hud = document.createElement('div');
                hud.id = 'callgm-hud';
                hud.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);color:#00ff00;padding:20px;z-index:9999999;font-size:18px;border-radius:10px;pointer-events:none;font-family:monospace;white-space:pre-wrap;text-align:center;box-shadow:0 4px 6px rgba(0,0,0,0.3);border:2px solid #00ff00;';
                document.body.appendChild(hud);
            }
            function updateStatus(text, copyToClipboard = false) {
                hud.innerText = text;
                if (copyToClipboard) {
                    try {
                        const ta = document.createElement('textarea');
                        ta.value = text.split('\\n')[0]; 
                        document.body.appendChild(ta);
                        ta.select();
                        document.execCommand('copy');
                        document.body.removeChild(ta);
                    } catch(e) {}
                }
            }
            let attempts = 0;
            let imageFoundAttempts = 0;
            const checkInterval = setInterval(() => {
                attempts++;
                if (attempts > 60) {
                    clearInterval(checkInterval);
                    updateStatus('GEMINI_TIMEOUT\\n❌ 等待超时 (120秒)', true);
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
                updateStatus(debugInfo, true);
                if (targetBtns.length > 0 && images.length > 0) {
                    clearInterval(checkInterval);
                    updateStatus('GEMINI_FOUND\\n✅ 找到图片和按钮，等待 3 秒后下载...', true);
                    if (${task.download}) {
                        setTimeout(() => {
                            updateStatus('GEMINI_TRIGGERING\\n⬇️ 正在触发下载...', true);
                            setTimeout(() => {
                                const currentBtns = Array.from(lastMessage.querySelectorAll('button, a, [role="button"], [data-test-id]')).filter(b => {
                                    const html = b.outerHTML.toLowerCase();
                                    const text = b.innerText.toLowerCase();
                                    const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                                    return html.includes('下载') || html.includes('download') || text.includes('下载') || text.includes('download') || aria.includes('下载') || aria.includes('download');
                                });
                                
                                const btnsToClick = currentBtns.length > 0 ? currentBtns : targetBtns;
                                
                                btnsToClick.forEach(btn => {
                                    btn.click();
                                    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                                    btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                                });
                                updateStatus('GEMINI_CLICKED\\n⏳ 已点击下载，等待系统保存文件...', true);
                            }, 500);
                        }, 3000);
                    } else {
                        setTimeout(() => {
                            updateStatus('GEMINI_DONE\\n🎉 任务完成！(未开启下载)', true);
                        }, 1000);
                    }
                } else if (images.length > 0) {
                    imageFoundAttempts++;
                    if (imageFoundAttempts > 8) {
                        clearInterval(checkInterval);
                        updateStatus('GEMINI_NO_BTN\\n⚠️ 图片已生成，但未找到下载按钮', true);
                    }
                }
            }, 2000);
        })());`;
        
        // 将多行脚本压缩成单行 (虽然控制台支持多行，但地址栏必须单行)
        const pollScript = rawPollScript.replace(/\n/g, ' ').replace(/\s{2,}/g, ' ');
        await injectJsViaAddressBar(pollScript);

        // 轮询剪贴板，等待网页发回的完成信号
        let isDone = false;
        let waitTime = 0;
        let lastDebugMsg = '';
        
        while (!isDone && waitTime < 130) {
            await new Promise(r => setTimeout(r, 1000));
            try {
                const clipText = await clipboard.getContent();
                
                if (clipText.startsWith('DEBUG:') || clipText.startsWith('GEMINI_')) {
                    if (clipText !== lastDebugMsg) {
                        console.log(`  👉 [浏览器内部视角] ${clipText.replace(/\\n/g, ' ')}`);
                        lastDebugMsg = clipText;
                        
                        if (clipText.startsWith('GEMINI_FOUND')) {
                            // Snapshot is now taken before script injection
                        } else if (clipText.startsWith('GEMINI_CLICKED')) {
                            // 浏览器已经点击了下载按钮，Node.js 接管后续的监控工作
                            if (task.download) {
                                const files = await waitForAndMoveDownloads(initialDownloadsSnapshot, systemDownloadsDir, downloadDir);
                                if (files && files.length > 0) {
                                    task.downloadedFiles.push(...files);
                                }
                            }
                            console.log('✅ 当前任务彻底执行完毕！准备进入下一个任务。');
                            isDone = true;
                            completedLoops++;
                            jobProgress.set(filename, { completed: completedLoops, total: totalLoops, status: 'running' });
                            await new Promise(r => setTimeout(r, 2000)); // 额外缓冲时间
                        } else if (clipText.startsWith('GEMINI_DONE') || clipText.startsWith('GEMINI_NO_BTN') || clipText.startsWith('GEMINI_TIMEOUT')) {
                            console.log('✅ 当前任务执行完毕！准备进入下一个任务。');
                            isDone = true;
                            completedLoops++;
                            jobProgress.set(filename, { completed: completedLoops, total: totalLoops, status: 'running' });
                            await new Promise(r => setTimeout(r, 2000));
                        }
                    }
                }
            } catch (clipErr) {
                // 忽略剪贴板读取偶尔失败的情况
            }
            waitTime++;
        }

        // 如果还有下一次循环，刷新页面以重置状态
        if (i < task.count - 1 || tasks.indexOf(task) < tasks.length - 1) {
            console.log('🔄 刷新页面准备下一次任务...');
            if (isMac) {
                await keyboard.pressKey(Key.LeftSuper, Key.R);
                await keyboard.releaseKey(Key.LeftSuper, Key.R);
            } else {
                await keyboard.pressKey(Key.LeftControl, Key.R);
                await keyboard.releaseKey(Key.LeftControl, Key.R);
            }
            await new Promise(r => setTimeout(r, 8000));
        }
      }
    }
    
    console.log('\n🎉 所有任务物理模拟执行完毕！');
    console.log('关闭当前浏览器标签页...');
    if (isMac) {
        await keyboard.pressKey(Key.LeftSuper, Key.W);
        await keyboard.releaseKey(Key.LeftSuper, Key.W);
    } else {
        await keyboard.pressKey(Key.LeftControl, Key.W);
        await keyboard.releaseKey(Key.LeftControl, Key.W);
    }
    
    return tasks;
  } catch (error: any) {
    console.error('\n❌ 自动化执行过程中发生严重错误:');
    console.error(error.message || error);
    if (error.stack) {
        console.error('详细堆栈:', error.stack);
    }
    console.log('\n(提示: 如果上方报错提示找不到模块，请在本地运行 npm install @nut-tree-fork/nut-js open)');
  } finally {
    jobProgress.delete(filename);
  }
}
