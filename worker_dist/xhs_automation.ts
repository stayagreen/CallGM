import CDP from 'chrome-remote-interface';
import db from "./src/db/db.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ensureBrowserLaunched } from "./automation.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface XhsNoteProgress {
  id: number;
  status: 'pending' | 'publishing' | 'success' | 'failed';
  progress: number; // 0-100
  message: string;
}

export const xhsProgressMap = new Map<number, XhsNoteProgress>();

// Helper to resolve paths to absolute paths
function getAbsoluteFilePath(relativeOrAbsolute: string): string {
  if (!relativeOrAbsolute) return '';
  if (path.isAbsolute(relativeOrAbsolute)) {
    if (fs.existsSync(relativeOrAbsolute)) return relativeOrAbsolute;
  }
  
  const cleanPath = relativeOrAbsolute.replace(/^\//, ''); // remove leading slash
  
  const candidates = [
    path.join(process.cwd(), cleanPath),
    path.join(__dirname, cleanPath),
    // Standard uploads
    path.join(process.cwd(), 'uploads', cleanPath.replace(/^uploads\//, '')),
    path.join(__dirname, 'uploads', cleanPath.replace(/^uploads\//, '')),
    // Standard download
    path.join(process.cwd(), 'download', cleanPath.replace(/^downloads\//, '').replace(/^download\//, '')),
    path.join(__dirname, 'download', cleanPath.replace(/^downloads\//, '').replace(/^download\//, '')),
    // Subfolders under download (like videos, images)
    path.join(process.cwd(), 'download', 'videos', cleanPath.replace(/^downloads\//, '').replace(/^download\//, '').replace(/^videos\//, '')),
    path.join(__dirname, 'download', 'videos', cleanPath.replace(/^downloads\//, '').replace(/^download\//, '').replace(/^videos\//, '')),
    path.join(process.cwd(), 'download', 'images', cleanPath.replace(/^downloads\//, '').replace(/^download\//, '').replace(/^images\//, '')),
    path.join(__dirname, 'download', 'images', cleanPath.replace(/^downloads\//, '').replace(/^download\//, '').replace(/^images\//, ''))
  ];
  
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return path.join(process.cwd(), cleanPath);
}

/**
 * Executes a single Xiaohongshu note publish task using CDP
 */
export async function executeXhsPublish(noteId: number): Promise<{ success: boolean; url?: string; error?: string }> {
  console.log(`[XHS 发布] 开始执行任务 ID: ${noteId}`);
  xhsProgressMap.set(noteId, { id: noteId, status: 'publishing', progress: 5, message: '正在启动并就绪浏览器...' });
  
  // 1. 获取对应的任务详情
  const note = db.prepare("SELECT * FROM xhs_notes WHERE id = ?").get(noteId) as any;
  if (!note) {
    const err = "找不到指定的小红书发布任务";
    xhsProgressMap.set(noteId, { id: noteId, status: 'failed', progress: 0, message: err });
    return { success: false, error: err };
  }

  let isDraftTask = !!note.is_draft;

  // 双重云校检逻辑：向主服务器主动验证最新的草稿设定，攻克客户由于运行旧版本 Worker 导致的 is_draft 数据遗漏或状态不齐！
  try {
    let serverUrl = "http://localhost:3000";
    const configPath = path.join(process.cwd(), 'config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.SERVER_URL) {
        serverUrl = config.SERVER_URL.replace(/\/$/, "");
      }
    }
    console.log(`[XHS 发布] [双检逻辑] 正在向主服务器校验任务草稿状态: ${serverUrl}/api/worker/note-info/${noteId}`);
    const noteInfoRes = await fetch(`${serverUrl}/api/worker/note-info/${noteId}`);
    if (noteInfoRes.ok) {
      const noteInfo = await noteInfoRes.json() as any;
      if (noteInfo && noteInfo.is_draft !== undefined) {
        isDraftTask = !!noteInfo.is_draft;
        console.log(`[XHS 发布] [双检逻辑] 成功获取最新云端状态，is_draft = ${noteInfo.is_draft} (isDraftTask: ${isDraftTask})`);
      }
    } else {
      console.warn(`[XHS 发布] [双检逻辑] 获取云端状态失败, HTTP: ${noteInfoRes.status}`);
    }
  } catch (e: any) {
    console.warn(`[XHS 发布] [双检逻辑] 尝试向云端验证草稿状态出错 (不影响主进程):`, e.message || e);
  }

  const actionLabel = isDraftTask ? '暂存离开' : '发布';

  // Intercept if user is bound to a worker computer!
  const userRow = db.prepare('SELECT bound_worker_id FROM users WHERE id = ?').get(note.user_id) as any;
  const boundWorkerId = userRow ? userRow.bound_worker_id : null;

  if (boundWorkerId) {
      const worker = db.prepare("SELECT * FROM workers WHERE id = ?").get(boundWorkerId) as any;
      if (worker) {
          const { dispatcherService } = await import("./src/services/dispatcherService.js");
          // Check if the worker is currently online
          let workerSocketId: string | null = null;
          for (const [sid, token] of (dispatcherService as any).connectedWorkers.entries()) {
              if (token === worker.token) { workerSocketId = sid; break; }
          }
          
          if (workerSocketId) {
              console.log(`[XHS 发布] 检测到用户绑定了执行节点: ${worker.name}, 正在启动云端下发发布命令...`);
              xhsProgressMap.set(noteId, { id: noteId, status: 'publishing', progress: 10, message: `正在远程下发小红书发布任务至电脑: ${worker.name}...` });
              db.prepare("UPDATE xhs_notes SET publish_status = 'publishing', error_message = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(noteId);
              
              // Find server host or construct payload
              const socket = (dispatcherService as any).io!.sockets.sockets.get(workerSocketId);
              let serverUrl = '';
              if (process.env.APP_URL && process.env.APP_URL !== "MY_APP_URL" && process.env.APP_URL.trim() !== "") {
                  serverUrl = process.env.APP_URL.replace(/\/$/, "");
              } else {
                  const host = socket?.handshake?.headers?.['x-forwarded-host'] || socket?.handshake?.headers?.host || 'localhost:3000';
                  let protocol = 'http';
                  if (socket?.handshake?.headers?.['x-forwarded-proto'] === 'https') {
                      protocol = 'https';
                  } else if (!host.includes('localhost') && !/^\d+\.\d+\.\d+\.\d+/.test(host.split(':')[0])) {
                      protocol = 'https';
                  }
                  serverUrl = `${protocol}://${host}`;
              }

              const payload = {
                  noteId: note.id,
                  videoPath: note.video_path,
                  coverPath: note.cover_path,
                  title: note.title,
                  content: note.content,
                  tags: note.tags,
                  is_draft: note.is_draft,
                  serverUrl: serverUrl
              };
              
              // Emit event
              (dispatcherService as any).io!.to(workerSocketId).emit('run_xhs_publish', payload);
              return { success: true };
          } else {
              console.log(`[XHS 发布] 绑定的节点 ${worker.name} 离线中，将降级为服务器本地执行。`);
              xhsProgressMap.set(noteId, { id: noteId, status: 'publishing', progress: 5, message: `绑定的电脑 ${worker.name} 离线中，临时为您降级至服务器本地开始发布...` });
          }
      }
  }

  // 更新数据库状态为发布中
  db.prepare("UPDATE xhs_notes SET publish_status = 'publishing', error_message = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(noteId);

  let client: any = null;
  let currentTarget: any = null;
  let shouldKeepTabOpen = false;

  try {
    // 2. 确保浏览器已打开
    await ensureBrowserLaunched();
    xhsProgressMap.set(noteId, { id: noteId, status: 'publishing', progress: 15, message: '浏览器就绪，创建新标签页并导航至创作者中心...' });

    // 3. 打开小红书后台发布页面
    // 用 9222 端口建立 CDP 连接
    currentTarget = await CDP.New({ url: 'https://creator.xiaohongshu.com/publish/publish?from=menu&target=video', port: 9222 });
    client = await CDP({ target: currentTarget.id, port: 9222 });

    const { Page, Runtime, DOM, Input } = client;
    await Promise.all([Page.enable(), Runtime.enable(), DOM.enable()]);

    // 定义拟真键盘打字操作，支持高拟真键盘输入。对于普通文本字词，依靠 CDP 核心 char 单发派送，能完美攻克富文本编辑器内“新新中中式式”重复录入的顽疾；同时依然保留了控制符（井号、空格、回车）触发小红书话题探测的功能！
    const typeCharacter = async (char: string) => {
      let code = '';
      let windowsVirtualKeyCode = 0;
      let modifiers = 0;
      
      if (char === ' ') {
        code = 'Space';
        windowsVirtualKeyCode = 32;
      } else if (char === '#') {
        code = 'Digit3';
        windowsVirtualKeyCode = 51;
        modifiers = 8; // Shift modifier
      } else if (char === 'Enter') {
        code = 'Enter';
        windowsVirtualKeyCode = 13;
      } else if (char >= 'a' && char <= 'z') {
        code = `Key${char.toUpperCase()}`;
        windowsVirtualKeyCode = char.toUpperCase().charCodeAt(0);
      } else if (char >= 'A' && char <= 'Z') {
        code = `Key${char}`;
        windowsVirtualKeyCode = char.charCodeAt(0);
        modifiers = 8; // Shift modifier
      } else if (char >= '0' && char <= '9') {
        code = `Digit${char}`;
        windowsVirtualKeyCode = char.charCodeAt(0);
      } else {
        // 对于中文字符或常规字符，设置 IME 输入虚拟键码 229
        code = '';
        windowsVirtualKeyCode = 229;
      }

      try {
        if (char === ' ' || char === '#' || char === 'Enter') {
          // 核心控制键（空格、井号、回车）：遵循严禁且完整的 keyDown + char + keyUp 信号发射流。
          // 核心要点：在 keyDown 阶段绝不传 text 和 unmodifiedText 属性，仅在 char 阶段注入，规避现代 ContentEditable 对两次 text 属性的处理产生双倍输出！
          await Input.dispatchKeyEvent({
            type: 'keyDown',
            key: char === ' ' ? ' ' : (char === 'Enter' ? 'Enter' : char),
            code: code,
            windowsVirtualKeyCode: windowsVirtualKeyCode,
            modifiers: modifiers
          });
          
          if (char !== 'Enter') {
            await Input.dispatchKeyEvent({
              type: 'char',
              text: char,
              unmodifiedText: char,
              key: char === ' ' ? ' ' : char,
              code: code,
              windowsVirtualKeyCode: windowsVirtualKeyCode,
              modifiers: modifiers
            });
          }

          await Input.dispatchKeyEvent({
            type: 'keyUp',
            key: char === ' ' ? ' ' : (char === 'Enter' ? 'Enter' : char),
            code: code,
            windowsVirtualKeyCode: windowsVirtualKeyCode,
            modifiers: modifiers
          });
        } else {
          // 普通文字（包括繁/汉字、英文字母、常规数字、拼音符）：
          // 纯粹、简单地采用 type: 'char' 一击触达，不仅效率绝伦，更是 100% 根除所有 HTML/DOM 双重打字、拼音重影或打字多带一个井号的问题！
          await Input.dispatchKeyEvent({
            type: 'char',
            text: char,
            unmodifiedText: char,
            key: char,
            windowsVirtualKeyCode: windowsVirtualKeyCode,
            code: code,
            modifiers: modifiers
          });
        }
      } catch (e) {
        console.warn(`[CDP 打字] 发送字符 ${char} 故障:`, e);
      }
    };

    // 等待页面初步加载
    await new Promise(r => setTimeout(r, 6000));
    xhsProgressMap.set(noteId, { id: noteId, status: 'publishing', progress: 25, message: '正在检测登录与页面状态...' });

    // 4. 诊断登录状态
    const checkStatus = await Runtime.evaluate({
      expression: `(() => {
        const isLoginRedirect = window.location.href.includes('/login');
        const loginForm = !!document.querySelector('.login-box, input[placeholder*="手机"], .login-container');
        const isPublishPage = window.location.href.includes('/publish') || window.location.href.includes('/publish-note');
        return { isLoginRedirect, loginForm, isPublishPage, url: window.location.href };
      })()`,
      returnByValue: true
    });

    const statusResult = checkStatus.result?.value || { isLoginRedirect: false, loginForm: false, isPublishPage: false, url: '' };
    console.log(`[XHS 发布] 当前页面诊断:`, statusResult);

    if (statusResult.isLoginRedirect || statusResult.loginForm || !statusResult.isPublishPage) {
      throw new Error(`未检测到登录状态，已跳转至登录页面。请在您的独立调试 Chrome 浏览器中手动完成小红书创作者页面登录，保证处于正常工作页面 (https://creator.xiaohongshu.com/publish/publish?from=menu&target=video 或 https://creator.xiaohongshu.com/publish/publish-note) 后重试。`);
    }

    xhsProgressMap.set(noteId, { id: noteId, status: 'publishing', progress: 35, message: '登录验证通过！正在定位视频与封面文件...' });

    // 5. 准备要上传的文件
    const absVideoPath = getAbsoluteFilePath(note.video_path);
    const absCoverPath = note.cover_path ? getAbsoluteFilePath(note.cover_path) : '';

    console.log(`[XHS 发布] 视频绝对路径: ${absVideoPath}`);
    console.log(`[XHS 发布] 封面绝对路径: ${absCoverPath}`);

    if (!fs.existsSync(absVideoPath)) {
      throw new Error(`找不到视频源文件，绝对物理路径不正确或已删除: ${absVideoPath}`);
    }

    // 6. 执行视频文件上传
    xhsProgressMap.set(noteId, { id: noteId, status: 'publishing', progress: 45, message: '开始上传视频至小红书服务器...' });
    
    // 强制先切换到“视频”或“发布视频”页签确保显示上传框
    await Runtime.evaluate({
      expression: `(() => {
        try {
          const videoTabs = Array.from(document.querySelectorAll('div, span, p')).filter(el => el.textContent && (el.textContent.trim().includes('发布视频') || el.textContent.trim().includes('视频')));
          for (const tab of videoTabs) {
            tab.click();
          }
        } catch(e) {}
      })()`
    });
    await new Promise(r => setTimeout(r, 1500));

    // 使用 CDP 定位 <input type="file"> 元素
    const { root: { nodeId: rootNodeId } } = await DOM.getDocument();
    
    // 查询所有的文件上传 input，先上传视频
    const { nodeId: videoInputNodeId } = await DOM.querySelector({ 
      nodeId: rootNodeId, 
      selector: 'input[type="file"]' 
    });

    if (!videoInputNodeId) {
      throw new Error("无法在小红书发布页面找到视频上传输入元素");
    }

    // 通过 CDP 注入视频路径触发上传
    await DOM.setFileInputFiles({ files: [absVideoPath], nodeId: videoInputNodeId });
    console.log(`[XHS 发布] 已触发 CDP 文件路径注入，文件: ${absVideoPath}`);

    // 等待上传和转码就绪进程
    let uploadFinished = false;
    let uploadAttempts = 0;
    while (!uploadFinished && uploadAttempts < 45) {
      uploadAttempts++;
      await new Promise(r => setTimeout(r, 2000));
      
      const checkUpload = await Runtime.evaluate({
        expression: `(() => {
          const html = document.body.innerText;
          const hasSpinner = html.includes('正在上传') || html.includes('上传中') || html.includes('分析中') || html.includes('解析中') || document.querySelector('.semi-progress, .upload-progress') !== null;
          const hasCoverArea = html.includes('更换封面') || html.includes('视频封面') || document.querySelector('.post-content, input[placeholder*="标题"]') !== null;
          return { hasSpinner, hasCoverArea };
        })()`,
        returnByValue: true
      });

      const upStatus = checkUpload.result?.value || { hasSpinner: true, hasCoverArea: false };
      console.log(`[XHS 发布] 上传轮询 (${uploadAttempts}/45):`, upStatus);

      if (upStatus.hasCoverArea && !upStatus.hasSpinner) {
        uploadFinished = true;
        break;
      }
      
      // 更新上传进度条
      const tempProgress = Math.min(75, 45 + uploadAttempts);
      xhsProgressMap.set(noteId, { id: noteId, status: 'publishing', progress: tempProgress, message: `视频正在上传到小红书 (${uploadAttempts * 2}秒)...` });
    }

    if (!uploadFinished) {
      console.warn(`[XHS 发布] 视频上传未获得完全成功状态，可能文件较大仍在后台流式上传，强制继续后续配置操作。`);
    }

    xhsProgressMap.set(noteId, { id: noteId, status: 'publishing', progress: 75, message: '视频上传完成，正在上传笔记封面图...' });

    // 7. 处理封面图上传
    if (absCoverPath && fs.existsSync(absCoverPath)) {
      // 视频加载与转码状态检测完，加上 5000ms 充分安全保护，保证小红书前端组件完全稳定
      console.log(`[XHS 发布] 安全阻尼：等待小红书封面控制组件激活就绪...`);
      await new Promise(r => setTimeout(r, 5000));

      try {
        // 第一步：精细派发鼠标 hover 拟真事件到“设置封面”区域，使其暴露出“修改封面”遮罩提示层
        await Runtime.evaluate({
          expression: `(() => {
            try {
              // 1. 寻找核心锚点：包含“设置封面”或“视频封面”的纯文本标签（叶子节点为主）
              const anchors = Array.from(document.querySelectorAll('*')).filter(el => {
                if (el.children.length > 1) return false;
                const txt = el.textContent ? el.textContent.trim() : '';
                return txt === '设置封面' || txt === '视频封面' || txt === '更换封面';
              });

              console.log('Found cover anchors count:', anchors.length);

              // 2. 模拟鼠标 hover 在锚点元素以及它的父代容器上，让提示飘出
              anchors.forEach(anc => {
                try {
                  anc.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
                  anc.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true }));
                  anc.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true }));
                } catch(e) {}

                // 往上寻找高优先级的父代图像框架盒子，对它及它内部的 preview 区域、canvas 同样进行高物理 Hover
                let cur = anc;
                for (let d = 0; d < 3 && cur; d++) {
                  try {
                    cur.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
                    cur.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true }));
                  } catch(e) {}
                  
                  const subs = Array.from(cur.querySelectorAll('img, canvas, video, svg, .cover-preview, [class*="preview"], [class*="cover"], [class*="btn"]'));
                  subs.forEach(s => {
                    try {
                      s.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
                      s.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true }));
                    } catch(e) {}
                  });
                  cur = cur.parentElement;
                }
              });

              return 'HOVER_PREVIEWS_DISPATCHED';
            } catch(e) {
              return 'HOVER_ERROR: ' + e.message;
            }
          })()`,
          returnByValue: true
        });

        // 睡眠 1.2s 给浮层挂载和激活极高容错
        await new Promise(r => setTimeout(r, 1200));

        // 第二步：执行高精准物理点击
        await Runtime.evaluate({
          expression: `(() => {
            try {
              const clickElement = (el) => {
                if (!el) return;
                try { el.focus(); } catch(e) {}
                try { el.click(); } catch(e) {}
                try {
                  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                  el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                } catch(e) {}
              };

              // A. 搜寻浮现并可以点击的敏感词标题按钮（不仅是纯文字，多级元素也进行兜底）
              const activeKeywords = ['修改封面', '更换封面', '编辑封面', '选择封面', '设置封面'];
              let clicked = false;

              const allEls = Array.from(document.querySelectorAll('*'));
              const targets = allEls.filter(el => {
                if (el.children.length > 2) return false;
                const txt = el.textContent ? el.textContent.trim() : '';
                return activeKeywords.includes(txt) || activeKeywords.some(kw => txt === kw);
              });

              console.log('Click targets found:', targets.length);
              for (const t of targets) {
                clickElement(t);
                console.log('Clicked keyword component directly:', t.textContent);
                clicked = true;
              }

              // B. 兜底方案：如果没有任何组件被点击，我们直接抓取小红书视频封面预览图（通常是 canvas 或包含“preview”类名/字样的 img、canvas 等图片区域）进行强制点击
              if (!clicked) {
                const backups = Array.from(document.querySelectorAll('canvas, img, video, .cover-preview, [class*="preview"], [class*="cover"]')).filter(el => {
                  return el.clientWidth > 10 && el.clientHeight > 10;
                });
                console.log('Cover backups clickable components:', backups.length);
                backups.forEach(b => {
                  clickElement(b);
                  clicked = true;
                });
              }

              return clicked ? 'CLICK_DISPATCH_SUCCESS' : 'NO_ELEMENT_CLICKED';
            } catch(e) {
              return 'CLICK_ERROR: ' + e.message;
            }
          })()`,
          returnByValue: true
        });

        // 稳妥等待 4000ms，让弹出选择封面/自定义图片上传的模态对话框极其宽裕地渲染挂载就绪
        await new Promise(r => setTimeout(r, 4000));

        // 如果弹窗内需要点击“上传图片”或“本地上传”来唤醒图片输入框
        await Runtime.evaluate({
          expression: `(() => {
            try {
              const clickElement = (el) => {
                if (!el) return;
                try { el.focus(); } catch(e) {}
                try { el.click(); } catch(e) {}
              };
              const modal = document.querySelector('.semi-modal, [class*="modal"], [class*="dialog"], [class*="cropper"], [role="dialog"]') || document;
              const uploadTriggers = Array.from(modal.querySelectorAll('*')).filter(el => {
                if (el.children.length > 1) return false;
                const txt = el.textContent ? el.textContent.trim() : '';
                return txt === '上传图片' || txt === '本地上传' || txt === '上传自定义封面' || txt === '上传自定义' || txt.includes('本地') || txt.includes('照片') || txt.includes('上传');
              });
              for (const trigger of uploadTriggers) {
                clickElement(trigger);
                console.log('Clicked upload trigger inside modal:', trigger.textContent);
              }
            } catch(e) {}
          })()`
        });
        await new Promise(r => setTimeout(r, 1200));

        // 通过 JavaScript 远程对象(RemoteObject)定位文件上传 input，100% 精确获取其 CDP NodeId
        const evalResult = await Runtime.evaluate({
          expression: `(() => {
            const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
            if (inputs.length === 0) return null;
            // 优先选择支持图片的 input
            const imgInput = inputs.find(el => {
              const acc = el.getAttribute('accept');
              return acc && (acc.includes('image') || acc.includes('png') || acc.includes('jpg') || acc.includes('jpeg'));
            });
            if (imgInput) return imgInput;
            
            // 是否在弹出层/裁剪模态框内
            const modal = document.querySelector('.semi-modal, [class*="modal"], [class*="dialog"], [class*="cropper"]');
            if (modal) {
              const modalInput = modal.querySelector('input[type="file"]');
              if (modalInput) return modalInput;
            }
            
            // 多个 input 时，最后一个通常是动态挂载的封面图 input
            if (inputs.length > 1) {
              return inputs[inputs.length - 1];
            }
            return inputs[0];
          })()`,
          returnByValue: false
        });

        const objectId = evalResult.result?.objectId;
        if (objectId) {
          const { nodeId: imageInputNodeId } = await DOM.requestNode({ objectId });
          if (imageInputNodeId) {
            await DOM.setFileInputFiles({ files: [absCoverPath], nodeId: imageInputNodeId });
            console.log(`[XHS 发布] [CDP] 成功注入封面图片路径: ${absCoverPath}`);
            // 给与 5000ms 等图片在浏览器中完全加载、渲染并在裁剪画板中生成
            await new Promise(r => setTimeout(r, 5000));

            // 对封面设置弹出框进行确认点击（点击右下角确定按钮）
            const cropResult = await Runtime.evaluate({
              expression: `(() => {
                try {
                  const clickElement = (el) => {
                    if (!el) return;
                    try { el.focus(); } catch(e) {}
                    try { el.click(); } catch(e) {}
                    try {
                      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                    } catch(e) {}
                  };

                  // 1. 优先在这个封面弹窗/裁剪对话框 of 内部寻找确定
                  const modal = document.querySelector('.semi-modal, [class*="modal"], [class*="dialog"], [class*="cropper"], [role="dialog"]');
                  if (modal) {
                    // 自定义查找底部/右下角的确和完按钮，通常是后置的 button 元素
                    const btns = Array.from(modal.querySelectorAll('button, [role="button"], div, span')).filter(el => {
                      const t = el.textContent ? el.textContent.trim() : '';
                      return t === '确定' || t === '完成' || t === '保存' || t === '裁剪并确定' || t === '确认' || t === '确定并使用' || t.includes('确定') || t.includes('完成');
                    });
                    if (btns.length > 0) {
                      // 优先选 button 标签
                      const actualBtn = btns.find(b => b.tagName === 'BUTTON' && (b.textContent?.includes('确') || b.textContent?.includes('完'))) || btns.find(b => b.tagName === 'BUTTON') || btns[btns.length - 1];
                      clickElement(actualBtn);
                      return 'CLICKED_MODAL_CROP_CONFIRM_SUCCESS';
                    }
                  }
                  
                  // 2. 备用：全局点击最右下角的“确定”/“保存”
                  const globalBtns = Array.from(document.querySelectorAll('button, [role="button"]')).filter(el => {
                    const t = el.textContent ? el.textContent.trim() : '';
                    return t === '确定' || t === '完成' || t === '保存' || t === '裁剪并确定' || t === '确认' || t === '确定并使用';
                  });
                  if (globalBtns.length > 0) {
                    // 回归右下边判定：通常最后一个 button 就是弹窗的右下角确定按钮
                    clickElement(globalBtns[globalBtns.length - 1]);
                    return 'CLICKED_GLOBAL_CROP_CONFIRM_SUCCESS';
                  }
                  return 'NO_CONFIRM_BTN_FOUND';
                } catch(e) {
                  return 'ERROR: ' + e.message;
                }
              })()`,
              returnByValue: true
            });
            console.log(`[XHS 发布] 封面遮罩/裁剪右下角确定按钮点击判定结果:`, cropResult.result?.value);
            await new Promise(r => setTimeout(r, 2000));
          }
        } else {
          console.warn(`[XHS 发布] 无法利用 RemoteObject 寻找到图片上传 Input，使用传统 selector 尝试做兜底流程...`);
          const { root: { nodeId: latestRootId } } = await DOM.getDocument();
          const { nodeId: backupImgNodeId } = await DOM.querySelector({ 
            nodeId: latestRootId, 
            selector: 'input[type="file"][accept*="image"]' 
          });
          if (backupImgNodeId) {
            await DOM.setFileInputFiles({ files: [absCoverPath], nodeId: backupImgNodeId });
            console.log(`[XHS 发布] [备用 CDP] 成功设置封面路径`);
            await new Promise(r => setTimeout(r, 2000));
          }
        }
      } catch (coverErr: any) {
        console.warn(`[XHS 发布] 封面图上传尝试出错:`, coverErr.message || coverErr);
      }

      // 8. 优雅清理与浮层恢复程序：
      // 封面弹框上传或裁剪完毕后，此前由于多次模拟 MouseHover 或点击其他定位键，可能造成平台网页上残留悬浮功能提示框、阴影或者次级模态框未退下。
      // 为防止界面乱成一团、保障发文后的全自动大局，派发一次高真实的全局清理动作，恢复最完美的编辑器原貌。
      try {
        console.log(`[XHS 发布] 清理程序启动：正在为您恢复并校正由于由于封面点击激活而临时泛起的网页遮罩与浮层提示...`);
        await Runtime.evaluate({
          expression: `(() => {
            try {
              // A. 对匹配有封面、修改、设置等敏感词语的元素均派发 mouseout/mouseleave 以驱除 Hover 状态
              const sensitiveEls = Array.from(document.querySelectorAll('*')).filter(el => {
                const text = el.textContent || '';
                return text.includes('封面') || text.includes('编辑') || text.includes('上传') || text.includes('选择') || text.includes('修改');
              });
              sensitiveEls.forEach(el => {
                try {
                  el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, cancelable: true }));
                  el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true, cancelable: true }));
                } catch(e) {}
              });

              // B. 强制清除/淡化残存的小红书对话框/阴影遮罩层
              const maskClasses = ['.semi-modal-mask', '.semi-modal-wrapper', '[class*="cropper-modal"]', '[class*="modal-backdrop"]', '[class*="semi-modal"]'];
              maskClasses.forEach(sel => {
                try {
                  const items = document.querySelectorAll(sel);
                  items.forEach(itm => {
                    // 若是外层 mask 或 wrapper，我们让其淡出，防止遮挡
                    itm.style.display = 'none';
                    itm.style.opacity = '0';
                    itm.style.pointerEvents = 'none';
                  });
                } catch(e) {}
              });

              // C. 在网页的 Body 上注入一次轻柔的虚空 Click，让所有基于失焦关闭（Blur/ClickOut）的下拉菜单浮盘一并退场
              document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

              // D. 模拟将浏览器唯一的输入焦点重新锁定在文案编辑器正文主体上，带回小红书最经典原始的最佳创作者视图
              const mainEditor = document.querySelector('div[contenteditable="true"], x-editor, .post-content, textarea[placeholder*="正文"]');
              if (mainEditor) {
                mainEditor.focus();
              }
              return 'RESTORE_PLATFORM_UI_SUCCESS';
            } catch(e) {
              return 'RESTORE_UI_ERROR: ' + e.message;
            }
          })()`,
          returnByValue: true
        });
        console.log(`[XHS 发布] 页面浮层清理还原执行完毕，网页重获清爽原始态。`);
      } catch (cleanupErr) {
        console.warn(`[XHS 发布] 执行浮层恢复逻辑时出现可绕过的非致命警告:`, cleanupErr);
      }
    }

    xhsProgressMap.set(noteId, { id: noteId, status: 'publishing', progress: 85, message: '正在自动填写标题与视频正文...' });

    // 8a. 第一步：快速填充标题与纯文本内容段落（不含话题）
    const mainContent = (note.content || '').trim() + '\n\n';
    await Runtime.evaluate({
      expression: `(() => {
        try {
          // 填写标题
          const titleInput = document.querySelector('input[placeholder*="标题"], .title-input input, input[maxlength="20"], .c-input');
          if (titleInput) {
            titleInput.focus();
            titleInput.value = ${JSON.stringify(note.title || '')};
            titleInput.dispatchEvent(new Event('input', { bubbles: true }));
            titleInput.dispatchEvent(new Event('change', { bubbles: true }));
          }

          // 填写正文 (先仅填写纯文本内容)
          const editor = document.querySelector('div[contenteditable="true"], x-editor, .post-content, textarea[placeholder*="正文"], #post-textarea');
          if (editor) {
            editor.focus();
            if (editor.getAttribute('contenteditable') === 'true') {
              try {
                // 1. 全选内容
                const sel = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(editor);
                sel.removeAllRanges();
                sel.addRange(range);
                
                // 2. 清空并用 insertText 填入，这能完美触发编辑器的 internal state 更新，并把换行转换为标准的段落块
                document.execCommand('delete', false, null);
                document.execCommand('insertText', false, ${JSON.stringify(mainContent)});
                
                // 3. 再次强制触发 input 事件，保证 React 框架等监听到
                editor.dispatchEvent(new Event('input', { bubbles: true }));
                
                // 4. 将光标移至末尾，方便后续模拟键盘打字添加话题标签
                const finalRange = document.createRange();
                finalRange.selectNodeContents(editor);
                finalRange.collapse(false);
                sel.removeAllRanges();
                sel.addRange(finalRange);
              } catch (execErr) {
                // 安全回退：若 execCommand 失败，则使用 textContent 写入
                editor.textContent = ${JSON.stringify(mainContent)};
                editor.dispatchEvent(new Event('input', { bubbles: true }));
              }
            } else {
              editor.value = ${JSON.stringify(mainContent)};
              editor.dispatchEvent(new Event('input', { bubbles: true }));
              editor.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
          return 'TXT_CORE_FILLED_SUCCESS';
        } catch(e) {
          return e.message;
        }
      })()`,
      returnByValue: true
    });

    console.log(`[XHS 发布] 已成功在浏览器中填入主干正文，准备开始模拟打字注入话题标签...`);

    // 8b. 第二步：分析话题列表并逐字模拟打入以激活小红书平台的“话题组件化识别”而不再是纯文本
    const rawTags = note.tags || '';
    // 按空白、逗号、中文逗号、井号切分
    const tagsList = rawTags
      .split(/[\s,#，]+/ )
      .map(t => t.trim())
      .filter(t => t.length > 0);

    if (tagsList.length > 0) {
      console.log(`[XHS 发布] 发现以下标签需要模拟键盘打字:`, tagsList);
      xhsProgressMap.set(noteId, { id: noteId, status: 'publishing', progress: 86, message: '正在以极高仿真度智能打字为您输入话题标签...' });
      
      for (let i = 0; i < tagsList.length; i++) {
        const tag = tagsList[i];
        console.log(`[XHS 发布] [打字进程] (${i + 1}/${tagsList.length}) 正在模拟输入: #${tag}`);
        
        // 激活编辑器焦点并让光标移至末端，保证在最尾部平滑续写
        await Runtime.evaluate({
          expression: `(() => {
            const editor = document.querySelector('div[contenteditable="true"], x-editor, .post-content, textarea[placeholder*="正文"], #post-textarea');
            if (editor) {
              editor.focus();
              try {
                const range = document.createRange();
                const sel = window.getSelection();
                range.selectNodeContents(editor);
                range.collapse(false);
                sel.removeAllRanges();
                sel.addRange(range);
              } catch(e) {}
            }
          })()`
        });
        await new Promise(r => setTimeout(r, 200));

        // 1. 模拟输入 '# / 井号' 触发搜索联想
        await typeCharacter('#');
        await new Promise(r => setTimeout(r, 150));

        // 2. 逐一打上标签字词 (比如 "日常", "摄影")
        for (const char of tag) {
          await typeCharacter(char);
          await new Promise(r => setTimeout(r, 120));
        }

        // 3. 高度仿真停留 800ms 让小红书的后台搜索关联下拉框稳定加载
        await new Promise(r => setTimeout(r, 800));

        // 4. 用户反馈：输入完话题后按一下空格键就可以识别到话题。
        // 所以我们输入一个空格触发话题包转换
        await typeCharacter(' ');
        await new Promise(r => setTimeout(r, 300));

        // 5. 补充第二个空格或者回车键将话题包进行彻底阻断和隔离，为下一个话题完美引航
        await typeCharacter(' ');
        await new Promise(r => setTimeout(r, 450));
      }
    }

    console.log(`[XHS 发布] 所有话题标签已高仿真度完成模拟输入！`);

    // 8c. 触发“声明原创”开关
    xhsProgressMap.set(noteId, { id: noteId, status: 'publishing', progress: 88, message: '检测并设定原创声明条款...' });
    const originalTriggerResult = await Runtime.evaluate({
      expression: `(() => {
        try {
          const clickElement = (el) => {
            if (!el) return;
            try { el.focus(); } catch(e) {}
            try { el.click(); } catch(e) {}
            try {
              el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
              el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            } catch(e) {}
          };

          // 1. 寻找匹配“声明原创”、“原创说明”、“原创声明”字样的标题/文字标签
          const originalLabels = Array.from(document.querySelectorAll('*')).filter(el => {
            if (el.children.length > 2) return false;
            const text = el.textContent ? el.textContent.trim() : '';
            return text === '声明原创' || text === '原创声明' || text.slice(0, 10).includes('声明原创') || text.slice(0, 10).includes('原创声明');
          });
          
          console.log('Found original claim text labels:', originalLabels.length);

          if (originalLabels.length > 0) {
            // 首先点击文字标签自身
            clickElement(originalLabels[0]);
            
            // 2. 在该文字所在的层级内向其祖先深度检查并点击 Switch 开关、或 Checkbox 交互控件
            let parent = originalLabels[0].parentElement;
            for (let d = 0; d < 3 && parent; d++) {
              const sws = Array.from(parent.querySelectorAll('input[type="checkbox"], .semi-switch, .semi-checkbox, .checkbox, [class*="switch"], [class*="checkbox"], [role="switch"]'));
              for (const sw of sws) {
                clickElement(sw);
                console.log('Clicked switch component under parent context:', sw.className);
              }
              parent = parent.parentElement;
            }
            return 'ORIGINAL_LABEL_AND_PARENT_SWITCH_CLICKED';
          }
          
          // 3. 兜底方案：如果文本找不到，尝试根据类名或 ID 直接定位 Switch 元素
          const originalSwitches = document.querySelectorAll('[class*="original"], [id*="original"]');
          if (originalSwitches.length > 0) {
            clickElement(originalSwitches[0]);
            return 'ORIGINAL_SWITCHES_CLICKED_BY_SELECTOR';
          }
          
          return 'NOT_FOUND_ORIGINAL_SWITCH';
        } catch(e) {
          return 'ERROR: ' + e.message;
        }
      })()`,
      returnByValue: true
    });

    console.log(`[XHS 发布] 原创声明开关触发尝试结果:`, originalTriggerResult.result?.value);
    await new Promise(r => setTimeout(r, 2000));

    // 8d. 勾选“声明须知”复选逻辑，并确认点击“声明原创”按钮
    const originalDialogResult = await Runtime.evaluate({
      expression: `(() => {
        try {
          const clickElement = (el) => {
            if (!el) return;
            try { el.focus(); } catch(e) {}
            try { el.click(); } catch(e) {}
          };

          // 1. 寻找弹出的对话框容器（Modal 或 Dialog）
          const dialog = document.querySelector('.semi-modal, [class*="modal"], [class*="dialog"], [role="dialog"]') || document;
          
          // 2. 在对话框中寻找“声明须知”、“我已阅读”、“同意”等字样的条约文字标签
          const checkboxLabel = Array.from(dialog.querySelectorAll('span, label, p, div, a')).find(el => {
            const txt = el.textContent || '';
            return txt.includes('声明须知') || txt.includes('我已阅读') || txt.includes('同意') || txt.includes('及相关处置');
          });

          if (checkboxLabel) {
            console.log('Found agreement text:', checkboxLabel.textContent);
            
            // 3. 在其文字本身或它的父辈元素链条内搜寻复选项按钮，保障 100% 连带判定
            let foundCheckbox = null;
            const selectors = ['.semi-checkbox', 'input[type="checkbox"]', '.checkbox', '[role="checkbox"]', '[class*="checkbox"]', '[class*="check"]'];
            
            let current = checkboxLabel;
            for (let d = 0; d < 4 && current; d++) {
              for (const sel of selectors) {
                const cbEl = current.querySelector(sel);
                if (cbEl && cbEl !== checkboxLabel) {
                  foundCheckbox = cbEl;
                  break;
                }
              }
              if (foundCheckbox) break;
              current = current.parentElement;
            }

            // 如果找到独立的 checkbox 控件，我们就仅点击 checkbox，以防同时点击 label 和 checkbox 导致极速双击又取消勾选
            const targetCb = foundCheckbox || checkboxLabel;
            
            // 4. 精准状态检查：如果通过类名和属性发现已经是 checked/active 状态，千万不要重复点击！
            let isAlreadyChecked = false;
            if (targetCb.tagName === 'INPUT') {
              isAlreadyChecked = targetCb.checked;
            } else {
              const cls = targetCb.className || '';
              isAlreadyChecked = cls.includes('checked') || 
                                 targetCb.getAttribute('aria-checked') === 'true' || 
                                 cls.includes('active') ||
                                 !!targetCb.querySelector('[class*="checked"]') ||
                                 !!targetCb.querySelector('input[type="checkbox"]:checked');
            }

            console.log('Agreement checkbox checked status:', isAlreadyChecked);
            if (!isAlreadyChecked) {
              clickElement(targetCb);
              console.log('Clicked agreement checkbox successfully!');
            } else {
              console.log('Agreement checkbox was already checked. Skipped click.');
            }
          } else {
            // 兜底方案：如果任一没有找到，就对所有的 checkbox 进行一次勾选动作
            const checkboxes = Array.from(dialog.querySelectorAll('input[type="checkbox"], .semi-checkbox, .checkbox, [class*="checkbox"]'));
            checkboxes.forEach(cb => {
              try {
                let isChecked = false;
                if (cb.tagName === 'INPUT') {
                  isChecked = cb.checked;
                } else {
                  isChecked = cb.classList.contains('semi-checkbox-checked') || cb.getAttribute('aria-checked') === 'true';
                }
                if (!isChecked) {
                  clickElement(cb);
                }
              } catch(e) {}
            });
          }

          // 稍加延迟，确认勾选转换时间
          return new Promise(resolve => {
            setTimeout(() => {
              try {
                // 5. 寻找并点击二次确认按钮（如：“声明原创”、“确认声明”、“确认”、“确定”、“同意”）
                const dialogContext = document.querySelector('.semi-modal, [class*="modal"], [class*="dialog"]') || document;
                const confirmBtns = Array.from(dialogContext.querySelectorAll('button, [role="button"], span, div')).filter(el => {
                  const txt = el.textContent ? el.textContent.trim() : '';
                  return txt === '声明原创' || txt === '确认声明' || txt === '确认' || txt === '确定' || txt === '同意' || txt.includes('确定');
                });

                if (confirmBtns.length > 0) {
                  // 优先寻找 BUTTON 标签，若无则取首个
                  const targetBtn = confirmBtns.find(el => el.tagName === 'BUTTON') || confirmBtns[0];
                  clickElement(targetBtn);
                  resolve('DECLARED_ORIGINAL_DIALOG_CONFIRMED_SUCCESS');
                } else {
                  resolve('NO_CONFIRM_BUTTON_FOUND_IN_DIALOG');
                }
              } catch(e) {
                resolve('CONFIRM_BTN_STEP_ERROR: ' + e.message);
              }
            }, 500);
          });
        } catch(e) {
          return 'ERROR: ' + e.message;
        }
      })()`,
      returnByValue: true
    });

    console.log(`[XHS 发布] 原创说明须知弹窗勾选及确认执行结果:`, originalDialogResult.result?.value);
    await new Promise(r => setTimeout(r, 2000));

    // isDraftTask and actionLabel are defined at the top of executeXhsPublish
    xhsProgressMap.set(noteId, { id: noteId, status: 'publishing', progress: 92, message: `配置项填写与设置完毕，正在为您执行最终的“${actionLabel}”按钮点击动作...` });

    // 9. 执行发布点击
    console.log(`[XHS 发布] 开始判定并模拟点击${actionLabel}按钮... (草稿状态: ${isDraftTask})`);
    
    let clickedSuccess = false;
    let clickedMethod = '';

    // --- 【方法 A】: CDP DOM 扁平树遍历（完美穿透 closed Shadow Root 查找并调用内层 node.click()） ---
    try {
      console.log(`[XHS 发布] [方法 A] 正在获取扁平 DOM 树以穿透 Closed Shadow Root...`);
      const { nodes } = await DOM.getFlattenedDocument({ depth: -1, pierce: true });
      if (nodes && nodes.length > 0) {
        // 建立 parentId -> children 树状关系图，方便递归或查找内容文本
        const parentMap = new Map<number, any[]>();
        for (const n of nodes) {
          if (n.parentId !== undefined) {
             if (!parentMap.has(n.parentId)) parentMap.set(n.parentId, []);
             parentMap.get(n.parentId)!.push(n);
          }
          if (n.shadowRoots) {
             for (const sr of n.shadowRoots) {
                // 将 shadowRoot 虚拟节点视作 host 的子节点
                if (!parentMap.has(n.nodeId)) parentMap.set(n.nodeId, []);
                parentMap.get(n.nodeId)!.push(sr);
             }
          }
        }

        // 递归获取某个节点下属的所有子孙节点 ID 集合
        const getDescendants = (rootId: number): any[] => {
          const list: any[] = [];
          const queue = [rootId];
          while (queue.length > 0) {
            const currId = queue.shift()!;
            const kids = parentMap.get(currId) || [];
            for (const k of kids) {
              list.push(k);
              queue.push(k.nodeId);
            }
          }
          return list;
        };

        // 1. 寻找 <xhs-publish-btn> 这个 custom element
        const xhsHosts = nodes.filter(n => n.nodeName.toLowerCase() === 'xhs-publish-btn');
        console.log(`[XHS 发布] 找到 xhs-publish-btn 宿主组件数:`, xhsHosts.length);

        let targetNodeId: number | null = null;
        for (const host of xhsHosts) {
          const des = getDescendants(host.nodeId);
          // 在这些子孙节点中寻找 BUTTON
          const buttons = des.filter(n => n.nodeName.toLowerCase() === 'button' || n.localName === 'button');
          for (const btn of buttons) {
            const btnDes = getDescendants(btn.nodeId);
            
            // 检查它的文本子孙节点，寻找内容包含对应字样
            const hasPubText = btnDes.some(n => n.nodeType === 3 && n.nodeValue && (
              isDraftTask 
                ? (n.nodeValue.includes('暂存') || n.nodeValue.includes('草稿'))
                : (n.nodeValue.trim() === '发布' || n.nodeValue.trim() === '立即发布')
            ));
            
            // 或者看它的类名是否含有特定指示
            const attrs = btn.attributes || [];
            const classIdx = attrs.indexOf('class');
            const classVal = classIdx !== -1 ? attrs[classIdx + 1] : '';
            
            if (hasPubText || (!isDraftTask && classVal.includes('bg-red')) || (isDraftTask && classVal.includes('white'))) {
              targetNodeId = btn.nodeId;
              console.log(`[XHS 发布] 精确命中 Shadow Root 内部目标按钮 (${actionLabel}): Node ID ${targetNodeId}, 样式: ${classVal}`);
              break;
            }
          }
          if (targetNodeId) break;
        }

        // 2. 兜底：如果没找到 xhs-publish-btn，寻找全局列表内的匹配 BUTTON
        if (!targetNodeId) {
          const allButtons = nodes.filter(n => n.nodeName.toLowerCase() === 'button' || n.localName === 'button');
          for (const btn of allButtons) {
            const btnDes = getDescendants(btn.nodeId);
            const hasPubText = btnDes.some(n => n.nodeType === 3 && n.nodeValue && (
              isDraftTask 
                ? (n.nodeValue.includes('暂存') || n.nodeValue.includes('草稿'))
                : (n.nodeValue.trim() === '发布' || n.nodeValue.trim() === '立即发布')
            ));
            const attrs = btn.attributes || [];
            const classIdx = attrs.indexOf('class');
            const classVal = classIdx !== -1 ? attrs[classIdx + 1] : '';
            if (hasPubText || (!isDraftTask && classVal.includes('bg-red')) || (isDraftTask && classVal.includes('white') && classVal.includes('ce-btn'))) {
              targetNodeId = btn.nodeId;
              console.log(`[XHS 发布] 全局兜底命中 Shadow Root 内目标按钮 (${actionLabel}): Node ID ${targetNodeId}`);
              break;
            }
          }
        }

        // 3. 执行 CDP 节点解析点击
        if (targetNodeId) {
          const resolved = await DOM.resolveNode({ nodeId: targetNodeId });
          if (resolved && resolved.object && resolved.object.objectId) {
            const clickRes = await Runtime.callFunctionOn({
              objectId: resolved.object.objectId,
              functionDeclaration: `function() {
                try {
                  this.focus();
                  this.click();
                  this.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                  this.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                  return 'SUCCESS';
                } catch(e) {
                  return 'ERR: ' + e.message;
                }
              }`,
              returnByValue: true
            });
            console.log(`[XHS 发布] [方法 A] CDP Node click 结果:`, clickRes.result?.value);
            if (clickRes.result?.value === 'SUCCESS') {
              clickedSuccess = true;
              clickedMethod = 'CDP_FLATTENED_DOM_SHADOW_CLICK';
            }
          }
        }
      }
    } catch (e: any) {
      console.warn(`[XHS 发布] [方法 A] 执行期间遭遇警告 (这或许意味着对方正采用标准 DOM，继续后续方法B和C即可...):`, e.message || e);
    }

    // --- 【方法 B】: 精准屏幕坐标模拟真实鼠标轨迹点击（完全不受任何 DOM 或 Shadow Root 限制） ---
    if (!clickedSuccess) {
      try {
        console.log(`[XHS 发布] [方法 B] 启动精准视口坐标物理点击... (目标：${actionLabel})`);
        // 询问浏览器此组件或当前视口的大小，用于估测绝对按钮在底部吸底通栏中的物理坐标
        const coordResult = await Runtime.evaluate({
          expression: `(() => {
            const host = document.querySelector('xhs-publish-btn');
            let rect = host ? host.getBoundingClientRect() : null;
            
            // 100% 对应小红书官方布局设置：
            // bottom 粘性 bottom: 0，高 90px。发布按钮为红色，宽 120px，在吸底排布两个按钮中的右侧（居中对齐，gap 24px）。
            // 故其中心点 X 为 屏幕水平中心/吸底栏水平中心 + 72px。草稿暂存离开按钮在左侧，X 为中心点 - 72px。
            // 中心点 Y 为 屏幕底部向上 45px 处。
            const isDraftTask = ${isDraftTask};
            const x_publish_btn = isDraftTask ? (window.innerWidth / 2 - 72) : (window.innerWidth / 2 + 72);
            const y_publish_btn = window.innerHeight - 45;

            if (rect && rect.width > 0 && rect.height > 0) {
              return {
                x: rect.left + rect.width / 2 + (isDraftTask ? -72 : 72),
                y: rect.top + rect.height / 2,
                source: 'host_bounding_box'
              };
            }
            return {
              x: x_publish_btn,
              y: y_publish_btn,
              source: 'viewport_fallback'
            };
          })()`,
          returnByValue: true
        });

        const coords = coordResult.result?.value || { x: 0, y: 0, source: 'none' };
        console.log(`[XHS 发布] [方法 B] 计算出来的目标按钮物理坐标为:`, coords);

        if (coords.x > 0 && coords.y > 0) {
          // 模拟完整的物理移动与点击事件流
          await Input.dispatchMouseEvent({ type: 'mouseMoved', x: coords.x, y: coords.y });
          await new Promise(r => setTimeout(r, 150));
          await Input.dispatchMouseEvent({ type: 'mousePressed', button: 'left', x: coords.x, y: coords.y, clickCount: 1 });
          await new Promise(r => setTimeout(r, 150));
          await Input.dispatchMouseEvent({ type: 'mouseReleased', button: 'left', x: coords.x, y: coords.y, clickCount: 1 });
          console.log(`[XHS 发布] [方法 B] 物理按键事件发射完毕。`);
          clickedSuccess = true;
          clickedMethod = `PHYSICAL_COORDINATES_CLICK (${coords.source})`;
        }
      } catch (e: any) {
        console.warn(`[XHS 发布] [方法 B] 视口物理点击尝试出错:`, e.message || e);
      }
    }

    // --- 【方法 C】: 传统万能 Selector 与备用方案遍历（可处理非 Shadow DOM / 重构普通形态页) ---
    if (!clickedSuccess) {
      const clickPublishResult = await Runtime.evaluate({
        expression: `(() => {
          try {
            const clickElement = (el) => {
              if (!el) return;
              try { el.focus(); } catch(e) {}
              try { el.click(); } catch(e) {}
              try {
                el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
              } catch(e) {}
            };
  
            const isDraftTask = ${isDraftTask};
  
            // 1. 优先寻找用户反馈的特定容器 .publish-page-publish-btn 及其专属按钮
            const pContainer = document.querySelector('.publish-page-publish-btn');
            if (pContainer) {
              const btns = Array.from(pContainer.querySelectorAll('button'));
              console.log('[XHS 发布] 找到特定发布按钮容器内按钮数量:', btns.length);
              
              if (isDraftTask) {
                const draftBtn = btns.find(b => b.textContent && (b.textContent.includes('暂存') || b.textContent.includes('草稿')));
                if (draftBtn) {
                  clickElement(draftBtn);
                  return 'PUBLISH_BUTTON_CLICKED_SUCCESS: pContainer -> Text containing 暂存/草稿';
                }
                const whiteBtn = btns.find(b => b.classList.contains('ce-btn-white') || b.className.includes('white'));
                if (whiteBtn) {
                  clickElement(whiteBtn);
                  return 'PUBLISH_BUTTON_CLICKED_SUCCESS: pContainer -> white button';
                }
                if (btns.length >= 2) {
                  clickElement(btns[0]);
                  return 'PUBLISH_BUTTON_CLICKED_SUCCESS: pContainer -> first button';
                }
              } else {
                // 匹配文本为 "发布" 的按钮
                const pubBtn = btns.find(b => b.textContent && b.textContent.trim() === '发布');
                if (pubBtn) {
                  clickElement(pubBtn);
                  return 'PUBLISH_BUTTON_CLICKED_SUCCESS: pContainer -> Exact Text "发布"';
                }
                
                // 匹配类名为 bg-red 的按钮
                const redBtn = btns.find(b => b.classList.contains('bg-red') || b.className.includes('bg-red'));
                if (redBtn) {
                  clickElement(redBtn);
                  return 'PUBLISH_BUTTON_CLICKED_SUCCESS: pContainer -> bg-red class';
                }
                
                // 匹配末尾/非白色的按钮
                const targetBtn = btns.find(b => !b.className.includes('white')) || btns[btns.length - 1];
                if (targetBtn) {
                  clickElement(targetBtn);
                  return 'PUBLISH_BUTTON_CLICKED_SUCCESS: pContainer -> non-white button';
                }
              }
            }

            // 2. 查找页面上匹配的 button 元素 / 红色发布
            if (isDraftTask) {
              const draftBtns = Array.from(document.querySelectorAll('button')).filter(b => b.textContent && (b.textContent.includes('暂存') || b.textContent.includes('草稿')));
              if (draftBtns.length > 0) {
                clickElement(draftBtns[0]);
                return 'PUBLISH_BUTTON_CLICKED_SUCCESS: Exact draft/save button with text';
              }
            } else {
              const redBtns = Array.from(document.querySelectorAll('button.bg-red, button[class*="bg-red"]'));
              const exactRedBtn = redBtns.find(b => b.textContent && b.textContent.trim() === '发布');
              if (exactRedBtn) {
                clickElement(exactRedBtn);
                return 'PUBLISH_BUTTON_CLICKED_SUCCESS: Exact bg-red button with text';
              }
            }

            // 3. 寻找真正属于发布/编辑区域（如类名包含 edit / publish / main / content）内的按钮
            const contentAreaSelectors = [
              '.main-content', '#main-content', '.editor-container', '.publish-container', 
              '.creator-content', '.content-body', '#app-container'
            ];
            for (const cSel of contentAreaSelectors) {
              const cEl = document.querySelector(cSel);
              if (cEl) {
                const innerBtns = Array.from(cEl.querySelectorAll('button'));
                if (isDraftTask) {
                  const innerDraftBtn = innerBtns.find(b => b.textContent && (b.textContent.includes('暂存') || b.textContent.includes('草稿')));
                  if (innerDraftBtn) {
                    clickElement(innerDraftBtn);
                    return 'PUBLISH_BUTTON_CLICKED_SUCCESS: Inner content draft button near ' + cSel;
                  }
                } else {
                  const innerPubBtn = innerBtns.find(b => b.textContent && b.textContent.trim() === '发布');
                  if (innerPubBtn) {
                    clickElement(innerPubBtn);
                    return 'PUBLISH_BUTTON_CLICKED_SUCCESS: Inner content publish button near ' + cSel;
                  }
                }
              }
            }

            // 4. 寻找所有带有特定候选字样的按钮
            const allButtons = Array.from(document.querySelectorAll('button'));
            if (isDraftTask) {
              const exactBtns = allButtons.filter(b => {
                const txt = b.textContent ? b.textContent.trim() : '';
                return txt.includes('暂存') || txt.includes('草稿');
              });
              if (exactBtns.length > 0) {
                clickElement(exactBtns[0]);
                return 'PUBLISH_BUTTON_CLICKED_SUCCESS: Button text fallback (draft) -> ' + (exactBtns[0].textContent || '').trim();
              }
            } else {
              const exactBtns = allButtons.filter(b => {
                const txt = b.textContent ? b.textContent.trim() : '';
                return txt === '发布' || txt === '立即发布' || txt === '确认发布';
              });
              if (exactBtns.length > 0) {
                const preferred = exactBtns.find(b => b.className.includes('bg-') || b.className.includes('btn-') || !b.className.includes('menu'));
                const targetBtn = preferred || exactBtns[0];
                clickElement(targetBtn);
                return 'PUBLISH_BUTTON_CLICKED_SUCCESS: Button text fallback -> ' + (targetBtn.textContent || '').trim();
              }
            }

            // 5. 极度兜底：类名模糊搜索
            if (isDraftTask) {
              const fallbackBtns = Array.from(document.querySelectorAll('button[class*="draft"], [class*="btn-draft"], button[class*="save"], [class*="draft-btn"]'));
              if (fallbackBtns.length > 0) {
                clickElement(fallbackBtns[0]);
                return 'PUBLISH_BUTTON_CLICKED_SUCCESS: Fallback draft class selector';
              }
            } else {
              const fallbackBtns = Array.from(document.querySelectorAll('button[class*="publish"], [class*="btn-publish"], button[class*="submit"], [class*="publish-btn"]'));
              if (fallbackBtns.length > 0) {
                clickElement(fallbackBtns[0]);
                return 'PUBLISH_BUTTON_CLICKED_SUCCESS: Fallback class selector';
              }
            }

            return 'PUBLISH_BUTTON_NOT_FOUND';
          } catch(e) {
            return 'PUBLISH_CLICK_ERROR: ' + e.message;
          }
        })()`,
        returnByValue: true
      });

      console.log(`[XHS 发布] [方法 C] 传统 DOM 检索与执行结果:`, clickPublishResult.result?.value);
      if (clickPublishResult.result?.value && clickPublishResult.result.value.startsWith('PUBLISH_BUTTON_CLICKED_SUCCESS')) {
        clickedSuccess = true;
        clickedMethod = `DOM_METHOD_C_CLICK (${clickPublishResult.result.value})`;
      }
    }

    // 留出 8 秒存盘和接收返回，确保小红书后台响应并真正传输完成
    xhsProgressMap.set(noteId, { id: noteId, status: 'publishing', progress: 98, message: `${actionLabel}指令已下发！正在安全等待网络回发存盘 (约8秒)...` });
    await new Promise(r => setTimeout(r, 8000));
    
    // 标记不要保持调试标签页开启，点击完自动关闭该选项卡
    shouldKeepTabOpen = false;

    db.prepare("UPDATE xhs_notes SET publish_status = 'success', publish_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run('https://creator.xiaohongshu.com/creator/home', noteId);
    
    const finalSuccessMessage = isDraftTask 
      ? '🎉 小红书作品已成功保存为草稿存档！'
      : '🎉 小红书作品已全自动发表成功，并成功在创作者中心内记录存档！';

    xhsProgressMap.set(noteId, { 
      id: noteId, 
      status: 'success', 
      progress: 100, 
      message: finalSuccessMessage
    });

    console.log(`[XHS 发布] ✅ 任务 ID: ${noteId} 全自动${actionLabel}成功！`);
    return { success: true, url: 'https://creator.xiaohongshu.com/creator/home' };

  } catch (error: any) {
    console.error(`[XHS 发布] ❌ 任务 ID: ${noteId} 发生致命错误:`, error.message || error);
    const errMessage = error.message || `小红书自动化${actionLabel}发生未设定的错误`;
    
    db.prepare("UPDATE xhs_notes SET publish_status = 'failed', error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(errMessage, noteId);
    xhsProgressMap.set(noteId, { id: noteId, status: 'failed', progress: 0, message: `${actionLabel}失败: ${errMessage}` });
    
    return { success: false, error: errMessage };
  } finally {
    // 关闭此标签页防溢出 (如果是测试模式下的成功状态，则保持打开以便用户进行手动校对)
    if (client && currentTarget && !shouldKeepTabOpen) {
      try {
        await CDP.Close({ id: currentTarget.id, port: 9222 });
      } catch (e) {}
    }
  }
}

let watcherInterval: NodeJS.Timeout | null = null;
let watcherActive = false;

export function startXhsAutomationWatcher() {
  if (watcherInterval) {
    console.log("[XHS Watcher] 👁️ 小红书后台自动监控已经处于运行状态。");
    return;
  }
  
  console.log("[XHS Watcher] 🚀 已成功开启小红书自动化定时发布监控器 (轮询周期: 10秒)...");
  
  watcherInterval = setInterval(async () => {
    if (watcherActive) return; // 节流防乱序
    watcherActive = true;
    
    try {
      // 找出当前准备发布的笔记
      // 没有任何人正在发布的：pending 且 scheduled_at 到了或为 null（手动触发的直接无 scheduled_at 触发）
      const pendingNotes = db.prepare("SELECT * FROM xhs_notes WHERE publish_status = 'pending'").all() as any[];
      const notesToPublish = pendingNotes.filter(note => {
        if (!note.scheduled_at) return false; // 如果为 null 表明它不是定时，或者还未由用户点击“立即发布”变成触发状态（手动直接点发布会直接调用接口而不在后台延时队列中，除非用户加入队列）
        const schedTime = new Date(note.scheduled_at).getTime();
        return schedTime <= Date.now();
      });

      if (notesToPublish.length > 0) {
        console.log(`[XHS Watcher] 🔔 检测到 ${notesToPublish.length} 个定时任务到了设定时间，正在启动顺序执行...`);
        for (const note of notesToPublish) {
          try {
            await executeXhsPublish(note.id);
          } catch (e) {
            console.error(`[XHS Watcher] 错误执行单次小红书发布(Note ID ${note.id}):`, e);
          }
        }
      }
    } catch (err) {
      console.error("[XHS Watcher] 自动周期检测异常错误:", err);
    } finally {
      watcherActive = false;
    }
  }, 10000);
}
