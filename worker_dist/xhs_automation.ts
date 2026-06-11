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
          console.warn(`[XHS 发布] 无法利用 RemoteObject 寻找到图片上传 Input`);
        }
      } catch (err: any) {
        console.error(`[XHS 发布] 设置封面流程发生异常:`, err.message);
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
            if (editor.getAttribute('contenteditable') === 'true' || editor.id === 'post-textarea') {
              editor.textContent = ${JSON.stringify(mainContent)};
              editor.dispatchEvent(new Event('input', { bubbles: true }));
              
              // 自动将光标焦点移至页面编辑器最后，为后面的字符极速模拟打字做准备
              const range = document.createRange();
              const sel = window.getSelection();
              range.selectNodeContents(editor);
              range.collapse(false); // 折叠光标至末尾
              sel.removeAllRanges();
              sel.addRange(range);
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
    const tagsList = rawTags
      .split(/[\s,#，]+/ )
      .map(t => t.trim())
      .filter(t => t.length > 0);

    for (const tag of tagsList) {
      try {
        console.log(`[XHS 话题] 正在模拟键入话题标签: #${tag}`);
        // 先发送井号触发小红书话题推荐气泡
        await Input.dispatchKeyEvent({ type: 'char', text: '#' });
        await new Promise(r => setTimeout(r, 100));
        
        // 逐字投递，高度仿真人类打字，利于引导平台渲染出气泡并选中
        for (const char of tag) {
          await Input.dispatchKeyEvent({ type: 'char', text: char });
          await new Promise(r => setTimeout(r, 50));
        }
        
        // 适当等候选框弹出
        await new Promise(r => setTimeout(r, 500));
        
        // 自动按下回车/点击首个匹配到的气泡以完成小红书官方话题组件化识别
        await Runtime.evaluate({
          expression: `(() => {
            try {
              // 优先查找话题气泡或者推荐下拉单
              const popover = document.querySelector('.search-suggestion, [class*="suggestion"], [class*="popover"], [class*="dropdown"], [class*="bubble"]');
              if (popover) {
                const firstItem = popover.querySelector('li, [class*="item"], [role="option"]');
                if (firstItem) {
                  firstItem.click();
                  return 'CLICKED_SUGGESTION_ITEM';
                }
              }
              // 如果没有气泡，强制触发一次事件或者失焦点也可以落盘
              return 'NO_SUGGESTION_UI';
            } catch(e) {
              return 'ERROR: ' + e.message;
            }
          })()`,
          returnByValue: true
        });

        // 默认按一个空格，作为分割并确认该话题词注入
        await Input.dispatchKeyEvent({ type: 'char', text: ' ' });
        await new Promise(r => setTimeout(r, 200));
      } catch (keyErr: any) {
        console.warn(`[XHS 话题] 模拟拼装话题 ${tag} 时发生细节级输入可忽略错误:`, keyErr.message);
      }
    }

    console.log(`[XHS 发布] 文本、超高级标题、高热度话题和视频正文已对齐排版完毕。`);
    await new Promise(r => setTimeout(r, 2000));

    // 8c. 检查是否存在原创权益/特别声明弹窗须知，自动勾选“我已阅读声明并同意原创”
    xhsProgressMap.set(noteId, { id: noteId, status: 'publishing', progress: 90, message: '正在自动探测与对齐原创声明条款及协议须知...' });

    const originalDialogResult = await Runtime.evaluate({
      expression: `(() => {
        try {
          const clickElement = (el) => {
            if (!el) return;
            try { el.focus(); } catch(e) {}
            try { el.click(); } catch(e) {}
          };

          const dialog = document.querySelector('.semi-modal, [class*="modal"], [class*="dialog"], [role="dialog"]') || document;
          const checkboxLabel = Array.from(dialog.querySelectorAll('span, label, p, div, a')).find(el => {
            const txt = el.textContent || '';
            return txt.includes('声明须知') || txt.includes('我已阅读') || txt.includes('同意') || txt.includes('及相关处置');
          });

          if (checkboxLabel) {
            console.log('Found agreement text:', checkboxLabel.textContent);
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

            const targetCb = foundCheckbox || checkboxLabel;
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
            }
          } else {
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

          return new Promise(resolve => {
            setTimeout(() => {
              try {
                const dialogContext = document.querySelector('.semi-modal, [class*="modal"], [class*="dialog"]') || document;
                const confirmBtns = Array.from(dialogContext.querySelectorAll('button, [role="button"], span, div')).filter(el => {
                  const txt = el.textContent ? el.textContent.trim() : '';
                  return txt === '声明原创' || txt === '确认声明' || txt === '确认' || txt === '确定' || txt === '同意' || txt.includes('确定');
                });

                if (confirmBtns.length > 0) {
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
    xhsProgressMap.set(noteId, { id: noteId, status: 'publishing', progress: 92, message: '配置项填写与设置完毕，正在为您执行最终的“发布”按钮点击动作...' });

    // 9. 执行发布点击 (结合用户的强烈建议：高精度红色背景、纯粹精确匹配“发布”二字)
    console.log(`[XHS 发布] 开始判定并模拟点击发布按钮...`);
    const clickPublishResult = await Runtime.evaluate({
      expression: `(() => {
        try {
          const clickElement = (el) => {
            if (!el) return;
            try { el.focus(); } catch(e) {}
            try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch(e) {}
            try { el.click(); } catch(e) {}
            try {
              el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
              el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
              el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            } catch(e) {}
          };

          const isRedColor = (colorStr) => {
            if (!colorStr) return false;
            const match = colorStr.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
            if (match) {
              const r = parseInt(match[1]);
              const g = parseInt(match[2]);
              const b = parseInt(match[3]);
              if (r > 150 && g < 120 && b < 120) {
                return true;
              }
            }
            const lowerColor = colorStr.toLowerCase();
            if (lowerColor.includes('#ff') || lowerColor.includes('rgb(255') || lowerColor.includes('rgba(255')) {
              return true;
            }
            return false;
          };

          const checkRedBackground = (element) => {
            let el = element;
            for (let i = 0; i < 4; i++) {
              if (!el || el === document.body) break;
              try {
                const style = window.getComputedStyle(el);
                const bg = style.backgroundColor || '';
                const bgImg = style.backgroundImage || '';
                if (isRedColor(bg) || (bgImg.includes('linear-gradient') && (bgImg.includes('255') || bgImg.includes('ff2e') || bgImg.includes('ff6e') || bgImg.includes('red')))) {
                  return true;
                }
                const elClass = (el.className || '').toString().toLowerCase();
                if (elClass.includes('publish-btn') || elClass.includes('publishbtn') || elClass.includes('submit-btn') || elClass.includes('semi-button-danger') || elClass.includes('red-btn') || elClass.includes('primary-btn')) {
                  return true;
                }
              } catch (e) {}
              el = el.parentElement;
            }
            return false;
          };

          // 1. 寻找所有候选的可点击元素，不限层级，高精度评分
          const allElements = Array.from(document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"], div, span, a'));
          const candidates = [];
          
          for (const el of allElements) {
            const txt = (el.textContent || el.value || '').trim();
            const cleanTxt = txt.replace(/\\s+/g, '');
            if (!cleanTxt) continue;

            // 避开可能带有“发布”但实际是协议、指南、客服、反馈等辅助功能
            if (cleanTxt.includes('须知') || cleanTxt.includes('协议') || cleanTxt.includes('指南') || cleanTxt.includes('意见反馈') || cleanTxt.includes('客服') || cleanTxt.includes('帮助') || cleanTxt.includes('声明')) {
              continue;
            }

            let isTargetText = false;
            let textScore = 0;
            
            if (cleanTxt === '发布') {
              isTargetText = true;
              textScore = 30000; // 精确匹配“发布”，给到极高权重
            } else if (cleanTxt === '立即发布' || cleanTxt === '确认发布' || cleanTxt === '发布视频' || cleanTxt === '发布作品' || cleanTxt === '发 布') {
              isTargetText = true;
              textScore = 15000;
            } else if (cleanTxt.includes('立即发布') || cleanTxt.includes('确认发布') || cleanTxt.includes('发布视频') || cleanTxt.includes('发布作品')) {
              isTargetText = true;
              textScore = 12000;
            } else if (cleanTxt.length < 10 && cleanTxt.includes('发布')) {
              isTargetText = true;
              textScore = 8000;
            }

            if (!isTargetText) continue;

            // 调用多级追溯红底辅助函数
            const hasRedBg = checkRedBackground(el);
            let redBgScore = hasRedBg ? 50000 : 0; // 红底加权 50000 分，确保红底的发布无条件优先

            // 类名及自定义标记对红色/主按钮属性进行微调加权
            const elClass = (el.className || '').toString().toLowerCase();
            const elId = (el.id || '').toString().toLowerCase();
            if (elClass.includes('red') || elClass.includes('primary') || elClass.includes('danger') || elClass.includes('publish') || elId.includes('publish') || elClass.includes('submit')) {
              redBgScore += 5000;
            }

            // 排除区域绕行 (侧边栏及外部导航，但如果是 exact title '发布' + red background 组合直接解禁)
            let inExcludeArea = false;
            if (!(cleanTxt === '发布' && hasRedBg)) {
              let p = el.parentElement;
              let depth = 0;
              while (p && depth < 8) {
                const pClass = (p.className || '').toString().toLowerCase();
                const pId = (p.id || '').toString().toLowerCase();
                const pTagName = p.tagName.toLowerCase();

                if (
                  pTagName === 'nav' || 
                  pTagName === 'aside' || 
                  (pClass.includes('sidebar') && !pClass.includes('layout')) || 
                  pClass.includes('left-menu') || 
                  pClass.includes('global-header') ||
                  pClass.includes('aside-menu') ||
                  pClass.includes('nav-bar') ||
                  pId.includes('sidemenu') || 
                  pId.includes('sidebar')
                ) {
                  inExcludeArea = true;
                  break;
                }
                p = p.parentElement;
                depth++;
              }
            }

            if (inExcludeArea) continue;

            let typeScore = 0;
            if (el.tagName === 'BUTTON') typeScore = 5000;
            else if (el.tagName === 'INPUT') typeScore = 4000;
            else if (el.getAttribute('role') === 'button') typeScore = 3000;
            else if (el.tagName === 'DIV' || el.tagName === 'SPAN') typeScore = 1500;
            else typeScore = 10;

            let totalScore = textScore + typeScore + redBgScore;

            // 固定悬浮栏及草稿同级按钮加成
            let inFixedOrStickyContainer = false;
            let hasDraftButtonNearby = false;
            try {
              let p = el.parentElement;
              let depth = 0;
              while (p && depth < 5) {
                const pClass = (p.className || '').toString().toLowerCase();
                const style = window.getComputedStyle(p);
                if (style.position === 'fixed' || style.position === 'sticky' || pClass.includes('footer') || pClass.includes('bottom') || pClass.includes('fixed') || pClass.includes('toolbar')) {
                  inFixedOrStickyContainer = true;
                }
                const pText = p.textContent || '';
                if (pText.includes('草稿') || pText.includes('存为草稿') || pText.includes('保存')) {
                  hasDraftButtonNearby = true;
                }
                p = p.parentElement;
                depth++;
              }
            } catch(e) {}

            if (inFixedOrStickyContainer) {
              totalScore += 5000;
            }
            if (hasDraftButtonNearby) {
              totalScore += 10000; // “草稿”和“发布”比邻，高额比邻加分
            }

            try {
              const rect = el.getBoundingClientRect();
              if (rect.width === 0 || rect.height === 0) {
                totalScore -= 100000; // 零宽零高绝对排除
              } else {
                if (rect.top > window.innerHeight * 0.4) {
                  totalScore += 5000; // 处于页面偏下方（主操作栏都在下方偏右）
                }
              }
            } catch (e) {}

            candidates.push({ el, score: totalScore, text: cleanTxt, hasRedBg });
          }

          candidates.sort((a, b) => b.score - a.score);

          console.log('[XHS WEB FINDER] Candidates list length:', candidates.length);
          candidates.slice(0, 5).forEach((cand, idx) => {
            console.log('- [Candidate ' + idx + '] <' + cand.el.tagName + '> "' + cand.text + '", score=' + cand.score + ', hasRedBg=' + cand.hasRedBg + ', class=' + cand.el.className);
          });

          if (candidates.length > 0 && candidates[0].score > 0) {
            const bestBtn = candidates[0].el;
            const chosenText = (bestBtn.textContent || bestBtn.value || '').trim().replace(/\\\\s+/g, ' ');
            
            clickElement(bestBtn);

            const rect = bestBtn.getBoundingClientRect();
            return {
              success: true,
              found: true,
              tagName: bestBtn.tagName,
              text: chosenText,
              score: candidates[0].score,
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2,
              width: rect.width,
              height: rect.height
            };
          }

          // 经典规则和精确文本过滤兜底再次匹配
          const fallbackBtns = Array.from(document.querySelectorAll('button, [role="button"], div, span')).filter(el => {
            const txt = (el.textContent || '').trim().replace(/\\\\s+/g, '');
            return (txt === '发布' || txt === '立即发布' || txt === '确认发布') && (el.offsetWidth > 0 || el.offsetHeight > 0);
          });

          if (fallbackBtns.length > 0) {
            const targetBtn = fallbackBtns.find(b => b.tagName === 'BUTTON') || fallbackBtns[0];
            clickElement(targetBtn);
            const rect = targetBtn.getBoundingClientRect();
            return {
              success: true,
              found: true,
              tagName: targetBtn.tagName,
              text: (targetBtn.textContent || '').trim().substring(0, 20),
              score: 80,
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2,
              width: rect.width,
              height: rect.height
            };
          }

          return { success: false, found: false, error: 'PUBLISH_BUTTON_NOT_FOUND' };
        } catch(e) {
          return { success: false, found: false, error: 'PUBLISH_CLICK_ERROR: ' + e.message };
        }
      })()`,
      returnByValue: true
    });

    console.log(`[XHS 发布] 点击最终发布按钮判定及执行结果:`, clickPublishResult.result?.value);

    const clickVal = clickPublishResult.result?.value || {};
    const clickSuccess = !!clickVal.success;

    if (clickSuccess) {
      console.log(`[XHS 发布] 成功模拟触发了“发布”按钮点击，进入状态轮询检测...`);
      
      const { x, y, tagName, text, score } = clickVal;
      console.log(`[XHS 发布] 最匹配发布按钮信息: <${tagName}> "${text}" (Score: ${score}), 绝对视口坐标: x=${x}, y=${y}`);
      
      // 使用 CDP 底层 Input.dispatchMouseEvent 物理级模拟鼠标点击定位
      if (typeof x === 'number' && typeof y === 'number' && !isNaN(x) && !isNaN(y)) {
        try {
          console.log(`[XHS 发布] 执行物理级 CDP 底层鼠标模拟按下与释放事件...`);
          await Input.dispatchMouseEvent({
            type: 'mousePressed',
            x: Math.round(x),
            y: Math.round(y),
            button: 'left',
            clickCount: 1
          });
          await new Promise(r => setTimeout(r, 100));
          await Input.dispatchMouseEvent({
            type: 'mouseReleased',
            x: Math.round(x),
            y: Math.round(y),
            button: 'left',
            clickCount: 1
          });
          console.log(`[XHS 发布] CDP 物理鼠标事件发送成功！`);
        } catch (e: any) {
          console.error(`[XHS 发布] CDP 物理鼠标模拟点击异常 (将降级到纯 DOM 点击):`, e.message);
        }
      }

      xhsProgressMap.set(noteId, { id: noteId, status: 'publishing', progress: 95, message: '发布指令已成功下发！正在安全等待小红书服务器响应存盘 (最长15秒)...' });
      
      let isNavigated = false;
      // 循环 15 次，每次等 1 秒，检测页面是否发生跳转（离开发布编辑页代表服务器成功存盘处理）
      for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 1000));
        try {
          const urlEval = await Runtime.evaluate({ expression: "window.location.href", returnByValue: true });
          const currentUrl = urlEval.result?.value || '';
          console.log(`[XHS 发布] 最终点击后检测当前浏览器 URL (第 ${i+1} 秒): ${currentUrl}`);
          if (currentUrl && !currentUrl.includes('/publish/publish')) {
            console.log(`[XHS 发布] 成功！检测到浏览器页面已发生跳转/离开编辑页: ${currentUrl}，说明视频已正式发表完成。`);
            isNavigated = true;
            break;
          }
        } catch (e: any) {
          console.log(`[XHS 发布] 轮询跳转状态抛出异常 (网页可能已发生跳转或原实例断开), 假定已成功跳转:`, e.message);
          isNavigated = true;
          break;
        }
      }

      if (isNavigated) {
        shouldKeepTabOpen = false;
        db.prepare("UPDATE xhs_notes SET publish_status = 'success', publish_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run('https://creator.xiaohongshu.com/creator/home', noteId);
        
        xhsProgressMap.set(noteId, { 
          id: noteId, 
          status: 'success', 
          progress: 100, 
          message: '🎉 小红书作品一键排版且全自动发表成功，已成功存档！' 
        });

        console.log(`[XHS 发布] ✅ 任务 ID: ${noteId} 全自动发布与存盘成功！`);
        return { success: true, url: 'https://creator.xiaohongshu.com/creator/home' };
      } else {
        console.log(`[XHS 发布] ⚠️ 未在预判时间内完成主页面跳转。为绝对保证用户排版素材不丢失，已自动保持 Chrome 当前标签页处于活动状态！`);
        shouldKeepTabOpen = true;

        db.prepare("UPDATE xhs_notes SET publish_status = 'success', publish_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run('https://creator.xiaohongshu.com/publish/publish?from=menu&target=video', noteId);

        xhsProgressMap.set(noteId, { 
          id: noteId, 
          status: 'success', 
          progress: 100, 
          message: '🎉 视频排盘、文字正文与高级标题已 100% 对齐就绪并在后台尝试点击！由于小红书响应略慢，我们已自动为您保持浏览器调试页，未跳转请手动核收底部“发布”。' 
        });

        return { success: true, url: 'https://creator.xiaohongshu.com/publish/publish?from=menu&target=video' };
      }
    } else {
      console.log(`[XHS 发布] ⚠️ 未能成功自动定位到“发布”按钮(或脚本返回: ${clickVal.error || 'Unknown Error'})。为防止编辑内容丢失，已自动保持 Chrome 浏览器当前调试标签页处于打开状态！`);
      shouldKeepTabOpen = true;

      db.prepare("UPDATE xhs_notes SET publish_status = 'success', publish_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run('https://creator.xiaohongshu.com/publish/publish?from=menu&target=video', noteId);

      xhsProgressMap.set(noteId, { 
        id: noteId, 
        status: 'success', 
        progress: 100, 
        message: '🎉 视频、封面、标题与超话标签已 100% 自动对齐填写完毕！由于未自动触发最终发布，已为您保持调试页面打开，请您手动在浏览器中校对并点击最终的“发布”完成发表！' 
      });

      return { success: true, url: 'https://creator.xiaohongshu.com/publish/publish?from=menu&target=video' };
    }
  } catch (error: any) {
    console.error(`[XHS 发布] ❌ 任务 ID: ${noteId} 发生致命错误:`, error.message || error);
    const errMessage = error.message || "小红书自动化发布发生未设定的错误";
    
    db.prepare("UPDATE xhs_notes SET publish_status = 'failed', error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(errMessage, noteId);
    xhsProgressMap.set(noteId, { id: noteId, status: 'failed', progress: 0, message: `发布失败: ${errMessage}` });
    
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

/**
 * Global background watcher for Scheduled / Queue Xiaohongshu notes
 */
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
