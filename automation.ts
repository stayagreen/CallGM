import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
        
        // 2. 智能定位：通过地址栏注入 JS 代码来让输入框自动获取焦点
        // 这完美解决了不同分辨率、不同语言、不同主题下的定位问题
        console.log('正在智能定位输入框...');
        await keyboard.pressKey(Key.LeftControl, Key.L); // Mac 用户如果是 Cmd+L，可在此修改为 Key.LeftSuper
        await keyboard.releaseKey(Key.LeftControl, Key.L);
        await new Promise(r => setTimeout(r, 500));

        // 输入 javascript: 协议头 (必须手动输入，浏览器禁止直接粘贴协议头)
        await keyboard.type('javascript:');
        
        // 注入寻找输入框并聚焦的代码 (兼容各种富文本框)
        // 注意：必须以 javascript: 开头，并且不能有返回值，否则浏览器可能会跳转
        const focusScript = `void((() => { const box = document.querySelector('rich-textarea, [contenteditable="true"], textarea'); if(box) { box.focus(); } })());`;
        await clipboard.setContent(focusScript);
        await keyboard.pressKey(Key.LeftControl, Key.V); // Mac 为 Cmd+V
        await keyboard.releaseKey(Key.LeftControl, Key.V);
        await new Promise(r => setTimeout(r, 500));
        
        // 执行注入的脚本，此时光标会自动跳到 Gemini 的输入框内
        await keyboard.pressKey(Key.Enter);
        await keyboard.releaseKey(Key.Enter);
        await new Promise(r => setTimeout(r, 1000));

        // 3. 复制提示词并粘贴 (支持中文)
        console.log('输入提示词...');
        await clipboard.setContent(task.prompt);
        await keyboard.pressKey(Key.LeftControl, Key.V);
        await keyboard.releaseKey(Key.LeftControl, Key.V);
        await new Promise(r => setTimeout(r, 1000));

        // 4. 发送 (回车)
        console.log('发送任务...');
        await keyboard.pressKey(Key.Enter);
        await keyboard.releaseKey(Key.Enter);

        // 5. 等待生成完成
        console.log('等待生图完成 (15秒)...');
        await new Promise(r => setTimeout(r, 15000));
        
        // 如果还有下一次循环，刷新页面以重置状态 (Ctrl+R)
        if (i < task.count - 1 || tasks.indexOf(task) < tasks.length - 1) {
            console.log('刷新页面准备下一次任务...');
            await keyboard.pressKey(Key.LeftControl, Key.R);
            await keyboard.releaseKey(Key.LeftControl, Key.R);
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
