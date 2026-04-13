import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const taskDir = path.join(__dirname, 'task');
const historyDir = path.join(taskDir, 'history');

// Ensure directories exist
if (!fs.existsSync(taskDir)) fs.mkdirSync(taskDir, { recursive: true });
if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true });

export function startAutomationWatcher() {
  console.log('Starting task watcher on:', taskDir);
  
  // Simple polling to avoid fs.watch cross-platform quirks
  setInterval(async () => {
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
    }
  }, 3000); // Check every 3 seconds
}

async function executeWithPhysicalSimulation(tasks: any) {
  try {
    // Dynamically import nut.js and open
    const nutjs = await import('@nut-tree/nut-js');
    const { keyboard, Key, mouse, screen, clipboard } = nutjs;
    const open = (await import('open')).default;

    console.log('\n====================================================');
    console.log('准备开始【物理键鼠模拟】执行！');
    console.log('正在自动唤起默认浏览器并打开 Gemini...');
    console.log('====================================================\n');
    
    // 1. 使用系统命令自动打开/唤起浏览器，直接进入 Gemini
    // 这取代了视觉识别，是最稳定、最原生的方式
    await open('https://gemini.google.com/');
    
    // 等待浏览器启动、页面加载并自动获取焦点
    console.log('等待页面加载 (8秒)...');
    await new Promise(r => setTimeout(r, 8000));

    for (const task of tasks) {
      for (let i = 0; i < task.count; i++) {
        console.log(`\n正在执行任务: ${task.prompt}, 第 ${i + 1} 次`);
        
        // 2. 盲点：将鼠标移动到屏幕中下方并点击，以确保输入框被激活
        // 假设输入框在屏幕水平居中，垂直方向靠下 150 像素的位置
        const width = await screen.width();
        const height = await screen.height();
        await mouse.setPosition({ x: width / 2, y: height - 150 });
        await mouse.leftClick();
        await new Promise(r => setTimeout(r, 500));

        // 3. 复制提示词并粘贴 (支持中文)
        await clipboard.setContent(task.prompt);
        await keyboard.pressKey(Key.LeftControl, Key.V);
        await keyboard.releaseKey(Key.LeftControl, Key.V);
        await new Promise(r => setTimeout(r, 1000));

        // 4. 发送 (回车)
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
    console.log('未检测到 @nut-tree/nut-js 或 open。这在云端环境中是正常的。');
    console.log('请在本地运行: npm install @nut-tree/nut-js open');
    console.log('模拟执行 2 秒...');
    await new Promise(r => setTimeout(r, 2000));
  }
}
