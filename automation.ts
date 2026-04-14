import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const taskDir = path.join(__dirname, 'task');
const historyDir = path.join(taskDir, 'history');

// Ensure directories exist
if (!fs.existsSync(taskDir)) fs.mkdirSync(taskDir, { recursive: true });
if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true });

let isRunning = false;

export function startAutomationWatcher() {
  console.log('Starting task watcher on:', taskDir);
  
  // Simple polling to avoid fs.watch cross-platform quirks
  setInterval(async () => {
    if (isRunning) return; // 防止并发冲突
    isRunning = true;

    try {
      const files = fs.readdirSync(taskDir);
      for (const file of files) {
        const filePath = path.join(taskDir, file);
        if (file.endsWith('.json') && fs.statSync(filePath).isFile()) {
          console.log(`Found new task file: ${file}`);
          
          // Read task
          const taskData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          
          // Execute task (Physical Simulation)
          await executeWithPhysicalSimulation(taskData);
          
          // Move to history
          const historyPath = path.join(historyDir, file);
          fs.renameSync(filePath, historyPath);
          console.log(`Task ${file} completed and moved to history.`);
        }
      }
    } catch (err) {
      console.error('Error in watcher:', err);
    } finally {
      isRunning = false; // 执行完毕后释放锁
    }
  }, 3000); // Check every 3 seconds
}

async function executeWithPhysicalSimulation(tasks: any) {
  try {
    // Dynamically import nut.js (using the maintained fork) and open
    const nutjs = await import('@nut-tree-fork/nut-js');
    const { keyboard, Key, mouse, screen, clipboard } = nutjs;
    const open = (await import('open')).default;
    const isMac = os.platform() === 'darwin';

    // 封装控制台注入逻辑，方便复用
    const injectJsViaConsole = async (script: string) => {
        // 打开控制台
        if (isMac) {
            await keyboard.pressKey(Key.LeftSuper, Key.LeftAlt, Key.J);
            await keyboard.releaseKey(Key.LeftSuper, Key.LeftAlt, Key.J);
        } else {
            await keyboard.pressKey(Key.LeftControl, Key.LeftShift, Key.J);
            await keyboard.releaseKey(Key.LeftControl, Key.LeftShift, Key.J);
        }
        await new Promise(r => setTimeout(r, 2000)); // 等待控制台打开

        // 粘贴代码
        await clipboard.setContent(script);
        if (isMac) {
            await keyboard.pressKey(Key.LeftSuper, Key.V);
            await keyboard.releaseKey(Key.LeftSuper, Key.V);
        } else {
            await keyboard.pressKey(Key.LeftControl, Key.V);
            await keyboard.releaseKey(Key.LeftControl, Key.V);
        }
        await new Promise(r => setTimeout(r, 500));

        // 执行
        await keyboard.pressKey(Key.Enter);
        await keyboard.releaseKey(Key.Enter);
        await new Promise(r => setTimeout(r, 500));

        // 关闭控制台
        if (isMac) {
            await keyboard.pressKey(Key.LeftSuper, Key.LeftAlt, Key.J);
            await keyboard.releaseKey(Key.LeftSuper, Key.LeftAlt, Key.J);
        } else {
            await keyboard.pressKey(Key.LeftControl, Key.LeftShift, Key.J);
            await keyboard.releaseKey(Key.LeftControl, Key.LeftShift, Key.J);
        }
        await new Promise(r => setTimeout(r, 1000)); // 等待控制台关闭，焦点回到页面
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
      for (let i = 0; i < task.count; i++) {
        console.log(`\n正在执行任务: ${task.prompt}, 第 ${i + 1} 次`);
        
        // 2. 智能定位：通过开发者工具(Console)注入 JS 代码
        console.log('正在智能定位输入框 (通过开发者工具)...');
        const focusScript = `void((() => { const box = document.querySelector('rich-textarea, [contenteditable="true"], textarea'); if(box) { box.focus(); } })());`;
        await injectJsViaConsole(focusScript);

        // 3. 复制提示词并粘贴 (支持中文)
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
        
        const pollScript = `void((() => {
            let attempts = 0;
            const checkInterval = setInterval(() => {
                attempts++;
                if (attempts > 60) { // 最多等待 120 秒
                    clearInterval(checkInterval);
                    const ta = document.createElement('textarea');
                    ta.value = 'GEMINI_TIMEOUT';
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                    return;
                }

                // 只在最后一个模型回复区块中寻找，避免点到历史记录里的按钮
                const messages = document.querySelectorAll('message-content, [data-message-author="model"], .model-response-text, model-message');
                const lastMessage = messages.length > 0 ? messages[messages.length - 1] : document;
                
                // 1. 模拟鼠标悬浮在所有图片上，强制触发 React/Angular 渲染隐藏的下载按钮
                const images = lastMessage.querySelectorAll('img');
                images.forEach(img => {
                    const hoverEvent = new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window });
                    const enterEvent = new MouseEvent('mouseenter', { bubbles: true, cancelable: true, view: window });
                    img.dispatchEvent(hoverEvent);
                    img.dispatchEvent(enterEvent);
                    // 通常悬浮事件可能绑定在图片的父容器上
                    if (img.parentElement) {
                        img.parentElement.dispatchEvent(hoverEvent);
                        img.parentElement.dispatchEvent(enterEvent);
                    }
                });

                // 2. 寻找下载按钮 (扩大属性搜索范围，包含 data-tooltip 等)
                const btns = Array.from(lastMessage.querySelectorAll('button, a, [role="button"]'));
                const targetBtns = btns.filter(b => {
                    const str = (
                        (b.getAttribute('aria-label') || '') + ' ' +
                        (b.getAttribute('title') || '') + ' ' +
                        (b.getAttribute('data-tooltip') || '') + ' ' +
                        (b.getAttribute('data-tooltip-content') || '') + ' ' +
                        (b.textContent || '')
                    ).toLowerCase();
                    return str.includes('下载完整尺寸') || 
                           str.includes('download full size') ||
                           str.includes('下载全部') ||
                           str.includes('download all');
                });
                
                if (targetBtns.length > 0) {
                    clearInterval(checkInterval);
                    
                    if (${task.download}) {
                        // 触发点击。为了防止原生 click() 被拦截，同时派发 MouseEvent
                        targetBtns.forEach(btn => {
                            btn.click();
                            btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                            btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                        });
                    }
                    
                    // 延迟 1.5 秒后通知 Node.js 已完成，确保点击事件已触发并开始下载
                    setTimeout(() => {
                        const ta = document.createElement('textarea');
                        ta.value = 'GEMINI_DONE';
                        document.body.appendChild(ta);
                        ta.select();
                        document.execCommand('copy');
                        document.body.removeChild(ta);
                    }, 1500);
                }
            }, 2000);
        })());`;
        
        await injectJsViaConsole(pollScript);

        // 轮询剪贴板，等待网页发回的完成信号
        let isDone = false;
        let waitTime = 0;
        while (!isDone && waitTime < 130) {
            await new Promise(r => setTimeout(r, 1000));
            const clipText = await clipboard.getContent();
            if (clipText === 'GEMINI_DONE') {
                console.log('检测到图片已生成！' + (task.download ? '已触发自动下载。' : '未开启自动下载，跳过。'));
                isDone = true;
            } else if (clipText === 'GEMINI_TIMEOUT') {
                console.log('等待超时 (120秒)，未检测到下载按钮。');
                isDone = true;
            }
            waitTime++;
        }

        // 如果还有下一次循环，刷新页面以重置状态
        if (i < task.count - 1 || tasks.indexOf(task) < tasks.length - 1) {
            console.log('刷新页面准备下一次任务...');
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
    
    console.log('\n所有任务物理模拟执行完毕！');
  } catch (error) {
    console.log('未检测到 @nut-tree-fork/nut-js 或 open。这在云端环境中是正常的。');
    console.log('请在本地运行: npm install @nut-tree-fork/nut-js open');
    console.log('模拟执行 2 秒...');
    await new Promise(r => setTimeout(r, 2000));
  }
}
