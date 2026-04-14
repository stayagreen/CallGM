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

let lastHeartbeat = Date.now();

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
        await executeWithPhysicalSimulation(taskData);
        
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

async function executeWithPhysicalSimulation(tasks: any) {
  try {
    // Dynamically import nut.js (using the maintained fork) and open
    const nutjs = await import('@nut-tree-fork/nut-js');
    const { keyboard, Key, mouse, screen, clipboard } = nutjs;
    const open = (await import('open')).default;
    const isMac = os.platform() === 'darwin';

    // 封装控制台注入逻辑 (带 allow pasting 绕过保护)
    const injectJsViaConsole = async (script: string) => {
        // 1. 打开控制台
        if (isMac) {
            await keyboard.pressKey(Key.LeftSuper, Key.LeftAlt, Key.J);
            await keyboard.releaseKey(Key.LeftSuper, Key.LeftAlt, Key.J);
        } else {
            await keyboard.pressKey(Key.LeftControl, Key.LeftShift, Key.J);
            await keyboard.releaseKey(Key.LeftControl, Key.LeftShift, Key.J);
        }
        await new Promise(r => setTimeout(r, 3000)); // 等待控制台打开

        // 2. 自动输入 allow pasting 解除 Chrome 的粘贴保护
        // 即使是中文版 Chrome，输入英文的 allow pasting 也能解锁
        await keyboard.type('allow pasting');
        await keyboard.pressKey(Key.Enter);
        await keyboard.releaseKey(Key.Enter);
        await new Promise(r => setTimeout(r, 500));

        // 3. 粘贴代码
        await clipboard.setContent(script);
        if (isMac) {
            await keyboard.pressKey(Key.LeftSuper, Key.V);
            await keyboard.releaseKey(Key.LeftSuper, Key.V);
        } else {
            await keyboard.pressKey(Key.LeftControl, Key.V);
            await keyboard.releaseKey(Key.LeftControl, Key.V);
        }
        await new Promise(r => setTimeout(r, 500));

        // 4. 执行
        await keyboard.pressKey(Key.Enter);
        await keyboard.releaseKey(Key.Enter);
        await new Promise(r => setTimeout(r, 500));

        // 5. 关闭控制台
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
        
        // 2. 智能定位：通过控制台注入 JS 代码
        console.log('正在智能定位输入框 (通过控制台注入)...');
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
                const allBtns = Array.from(lastMessage.querySelectorAll('button, a, [role="button"], [data-test-id]'));
                const targetBtns = allBtns.filter(b => {
                    const html = b.outerHTML.toLowerCase();
                    return html.includes('下载完整尺寸') || html.includes('download full size') || html.includes('下载全部') || html.includes('download all') || html.includes('下载') || html.includes('download');
                });
                const debugInfo = 'DEBUG: 第' + attempts + '次扫描\\n找到图片: ' + images.length + ' 张\\n找到所有按钮: ' + allBtns.length + ' 个\\n匹配到下载按钮: ' + targetBtns.length + ' 个';
                updateStatus(debugInfo, true);
                if (targetBtns.length > 0 && images.length > 0) {
                    clearInterval(checkInterval);
                    updateStatus('GEMINI_DONE\\n✅ 找到按钮，准备下载...', true);
                    if (${task.download}) {
                        images.forEach(img => {
                            img.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
                            img.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
                            if(img.parentElement) {
                                img.parentElement.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
                            }
                        });
                        setTimeout(() => {
                            targetBtns.forEach(btn => {
                                btn.click();
                                btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                                btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                            });
                        }, 500);
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
        
        // 将多行脚本压缩成单行 (虽然控制台支持多行，但压缩一下更稳妥)
        const pollScript = rawPollScript.replace(/\n/g, ' ').replace(/\s{2,}/g, ' ');
        await injectJsViaConsole(pollScript);

        // 轮询剪贴板，等待网页发回的完成信号
        let isDone = false;
        let waitTime = 0;
        let lastDebugMsg = '';
        
        while (!isDone && waitTime < 130) {
            await new Promise(r => setTimeout(r, 1000));
            try {
                const clipText = await clipboard.getContent();
                
                if (clipText.startsWith('DEBUG:')) {
                    if (clipText !== lastDebugMsg) {
                        console.log(`  👉 [浏览器内部视角] ${clipText.substring(7)}`);
                        lastDebugMsg = clipText;
                    }
                } else if (clipText === 'GEMINI_DONE') {
                    console.log('✅ 检测到图片已生成！' + (task.download ? '已触发自动下载。' : '未开启自动下载，跳过。'));
                    isDone = true;
                } else if (clipText === 'GEMINI_NO_BTN') {
                    console.log('⚠️ 图片已生成，但未能找到“下载”按钮！可能是 Gemini 界面更新了。');
                    isDone = true;
                } else if (clipText === 'GEMINI_TIMEOUT') {
                    console.log('❌ 等待超时 (120秒)，未检测到图片。');
                    isDone = true;
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
  } catch (error: any) {
    console.error('\n❌ 自动化执行过程中发生严重错误:');
    console.error(error.message || error);
    if (error.stack) {
        console.error('详细堆栈:', error.stack);
    }
    console.log('\n(提示: 如果上方报错提示找不到模块，请在本地运行 npm install @nut-tree-fork/nut-js open)');
  }
}
