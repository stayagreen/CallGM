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
        // 这完美避开了地址栏被中文输入法拦截，以及 Chrome 自动搜索的问题
        console.log('正在智能定位输入框 (通过开发者工具)...');
        
        // 打开开发者工具 (Console)
        if (isMac) {
            await keyboard.pressKey(Key.LeftSuper, Key.LeftAlt, Key.J);
            await keyboard.releaseKey(Key.LeftSuper, Key.LeftAlt, Key.J);
        } else {
            await keyboard.pressKey(Key.LeftControl, Key.LeftShift, Key.J);
            await keyboard.releaseKey(Key.LeftControl, Key.LeftShift, Key.J);
        }
        await new Promise(r => setTimeout(r, 2000)); // 等待控制台打开

        // 粘贴 JS 代码
        const focusScript = `(() => { const box = document.querySelector('rich-textarea, [contenteditable="true"], textarea'); if(box) { box.focus(); } })();`;
        await clipboard.setContent(focusScript);
        
        if (isMac) {
            await keyboard.pressKey(Key.LeftSuper, Key.V);
            await keyboard.releaseKey(Key.LeftSuper, Key.V);
        } else {
            await keyboard.pressKey(Key.LeftControl, Key.V);
            await keyboard.releaseKey(Key.LeftControl, Key.V);
        }
        await new Promise(r => setTimeout(r, 500));

        // 执行代码
        await keyboard.pressKey(Key.Enter);
        await keyboard.releaseKey(Key.Enter);
        await new Promise(r => setTimeout(r, 500));

        // 关闭开发者工具
        if (isMac) {
            await keyboard.pressKey(Key.LeftSuper, Key.LeftAlt, Key.J);
            await keyboard.releaseKey(Key.LeftSuper, Key.LeftAlt, Key.J);
        } else {
            await keyboard.pressKey(Key.LeftControl, Key.LeftShift, Key.J);
            await keyboard.releaseKey(Key.LeftControl, Key.LeftShift, Key.J);
        }
        await new Promise(r => setTimeout(r, 1000)); // 等待控制台关闭，焦点回到页面

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

        // 5. 等待生成完成
        console.log('等待生图完成 (15秒)...');
        await new Promise(r => setTimeout(r, 15000));
        
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
