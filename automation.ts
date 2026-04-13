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
          
          // Execute task (Puppeteer)
          await executeWithPuppeteer(taskData);
          
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

async function executeWithPuppeteer(tasks: any) {
  try {
    // Dynamically import puppeteer so it doesn't crash the cloud server if missing
    const puppeteer = (await import('puppeteer')).default;
    console.log('Connecting to existing browser on port 9222...');
    
    const browser = await puppeteer.connect({ 
      browserURL: 'http://127.0.0.1:9222',
      defaultViewport: null
    });
    
    const pages = await browser.pages();
    let page = pages.find(p => p.url().includes('gemini.google.com'));
    
    if (!page) {
       page = await browser.newPage();
       await page.goto('https://gemini.google.com/');
    } else {
       await page.bringToFront();
    }
    
    for (const task of tasks) {
      for (let i = 0; i < task.count; i++) {
        console.log(`Executing task: ${task.prompt}, iteration: ${i + 1}`);
        // Add actual automation logic here
        // await page.type('.input-selector', task.prompt);
        // await page.click('.send-button');
        await new Promise(r => setTimeout(r, 2000)); // simulate work
      }
    }
    
    browser.disconnect();
    console.log('Tasks execution finished, disconnected from browser.');
  } catch (error) {
    console.error('Failed to connect to browser. Please ensure Chrome is running with --remote-debugging-port=9222', error);
    console.log('Simulating execution for 2 seconds...');
    await new Promise(r => setTimeout(r, 2000));
  }
}
