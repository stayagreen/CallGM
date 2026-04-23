import fs from 'fs';
import path from 'path';

const dist = 'worker_dist';
if (!fs.existsSync(dist)) fs.mkdirSync(dist);
if (!fs.existsSync(path.join(dist, 'src'))) fs.mkdirSync(path.join(dist, 'src'));
if (!fs.existsSync(path.join(dist, 'src', 'db'))) fs.mkdirSync(path.join(dist, 'src', 'db'));

// Copy core files
fs.copyFileSync('automation.ts', path.join(dist, 'automation.ts'));
if (fs.existsSync('video_automation.ts')) fs.copyFileSync('video_automation.ts', path.join(dist, 'video_automation.ts'));
if (fs.existsSync('watermarkRemover.ts')) fs.copyFileSync('watermarkRemover.ts', path.join(dist, 'watermarkRemover.ts'));

// Copy worker.ts and fix imports (remove ../)
let workerCode = fs.readFileSync('worker/worker.ts', 'utf-8');
workerCode = workerCode.replace(/from "\.\.\//g, 'from "./');
fs.writeFileSync(path.join(dist, 'worker.ts'), workerCode);

// Mock DB to prevent SQLite native bindings making the worker heavy
fs.writeFileSync(path.join(dist, 'src', 'db', 'db.js'), `
export default {
    prepare: (sql) => ({
        run: (...args) => ({ changes: 1, lastInsertRowid: 1 }),
        get: (...args) => null,
        all: (...args) => []
    }),
    exec: (sql) => {}
};
`);
fs.writeFileSync(path.join(dist, 'src', 'db', 'db.ts'), `
export default {
    prepare: (sql: string) => ({
        run: (...args: any[]) => ({ changes: 1, lastInsertRowid: 1 }),
        get: (...args: any[]) => null,
        all: (...args: any[]) => []
    }),
    exec: (sql: string) => {}
};
`);

// package.json for worker
fs.writeFileSync(path.join(dist, 'package.json'), JSON.stringify({
  "name": "ai-studio-worker-light",
  "version": "1.0.0",
  "scripts": {
    "start": "tsx worker.ts"
  },
  "dependencies": {
    "socket.io-client": "^4.7.5",
    "chrome-remote-interface": "^0.34.0",
    "tsx": "^4.21.0",
    "sharp": "^0.33.3",
    "puppeteer": "^24.40.0",
    "opencv-wasm": "^4.3.0",
    "@nut-tree-fork/nut-js": "^4.3.1",
    "open": "^10.1.0",
    "fluent-ffmpeg": "^2.1.2",
    "@ffmpeg-installer/ffmpeg": "^1.1.0",
    "execa": "^8.0.1"
  }
}, null, 2));

// install.bat
fs.writeFileSync(path.join(dist, 'install.bat'), `@echo off
echo ===================================================
echo   正在自动安装轻量化 Worker 依赖...
echo ===================================================
npm install
echo.
echo 安装完成！您可以双击 start.bat 启动节点。
pause
`);

// start.bat (Loop wrapper that respects exit codes)
fs.writeFileSync(path.join(dist, 'start.bat'), `@echo off
title AI Studio Worker Node
echo ===================================================
echo   AI 自动化分布式 Worker 启动器 (守护进程)
echo ===================================================
:loop
npx tsx worker.ts
if %errorlevel% equ 99 goto stop
echo.
echo [System] Worker 进程已退出，正在自动重启...
timeout /t 3
goto loop

:stop
echo.
echo [System] 收到主服务器永久停止指令，Worker 退出。
pause
`);

// README.md
fs.writeFileSync(path.join(dist, 'README.md'), `# AI Studio 分布式 Worker (轻量化纯净版)

这是一个专门适配于虚拟机的执行节点代码。
相比于主服务器，它**完全剥离**了复杂的数据库 (SQLite) 和前端页面的冗余包依赖。仅需要极小的资源即可运行，专门在后台死磕生图 / 自动化任务！

## 🚀 部署步骤 (1分钟跑通)

1. **环境准备:** 确保虚拟机内安装了 Node.js (推荐 v18+)。
2. **连接配置:** 打开 \`worker.ts\`，修改顶部的 \`SERVER_URL\` 和 \`WORKER_TOKEN\` 为你的主服务器配置。
3. **一键安装:** 双击运行 \`install.bat\` (仅执行一次，用于下载自动化库)。
4. **一键启动:** 双击运行 \`start.bat\` 即可挂机接单。

## 🎮 控制指南

启动后，该黑框不要关闭。它是一个守护进程 (\`start.bat\` 负责无限保活)。
你可以直接在主服务器前端的 **[节点管理]** 面板中，对这台虚拟机发送 \`重启\`、\`停止\` 甚至 \`从GitHub拉取更新\` 的指令！
`);

console.log("Worker dist build complete.");
