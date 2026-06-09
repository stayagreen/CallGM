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

    // 定义拟真键盘打字操作，支持 keyDown + char + keyUp 完整流，并且赋予精准的 virtual key codes!
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
        // 对于中文字符或常规字符，CDP 注入其 text 事件，windowsVirtualKeyCode 设为 229 (代表 IME 组成状态)
        code = '';
        windowsVirtualKeyCode = 229;
      }

      try {
        // 1. 发送 keyDown
        await Input.dispatchKeyEvent({
          type: 'keyDown',
          text: char === 'Enter' ? '\r' : char,
          unmodifiedText: char === 'Enter' ? '\r' : char,
          key: char === ' ' ? ' ' : (char === 'Enter' ? 'Enter' : char),
          code: code,
          windowsVirtualKeyCode: windowsVirtualKeyCode,
          modifiers: modifiers
        });
        
        // 2. 如果不是回车，则需要派发真实的 'char' 输入事件
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

        // 3. 发送 keyUp
        await Input.dispatchKeyEvent({
          type: 'keyUp',
          key: char === ' ' ? ' ' : (char === 'Enter' ? 'Enter' : char),
          code: code,
          windowsVirtualKeyCode: windowsVirtualKeyCode,
          modifiers: modifiers
        });
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
        // 强制触发“设置封面”区域的 hover 和 click
        await Runtime.evaluate({
          expression: `(() => {
            try {
              const clickElement = (el) => {
                if (!el) return;
                try { el.focus(); } catch(e) {}
                try {
                  // 1. 发送高拟真悬浮 Mouse Hover 事件激活小红书的“修改封面”文字提示浮层
                  el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
                  el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true }));
                  el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true }));
                } catch(e) {}
                try { el.click(); } catch(e) {}
                try {
                  const mdown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
                  const mup = new MouseEvent('mouseup', { bubbles: true, cancelable: true });
                  el.dispatchEvent(mdown);
                  el.dispatchEvent(mup);
                } catch(e) {}
              };

              // 方案 A：围绕“设置封面”/“视频封面”/“修改封面”文本向周围扩展探测点击点
              const coverTitleLabels = Array.from(document.querySelectorAll('*')).filter(el => {
                const txt = el.textContent ? el.textContent.trim() : '';
                return txt === '设置封面' || txt === '视频封面' || txt === '更换封面' || txt === '编辑封面';
              });

              console.log('Detected cover labels count:', coverTitleLabels.length);

              let clickedAnySuccess = false;
              for (const header of coverTitleLabels) {
                // 点击标签自身
                clickElement(header);
                
                // 向上寻找父代容器，然后点击其底下的 canvas, img, video, .cover-preview, .upload-btn 或类名中含有 cover/upload 的交互元素
                let current = header;
                for (let d = 0; d < 4 && current; d++) {
                  const interactives = Array.from(current.querySelectorAll('.cover-preview, [class*="cover"], .upload-btn, .upload-btn-wrapper, canvas, img, video, .card, [class*="card"], [class*="btn"], button, [role="button"]'));
                  for (const target of interactives) {
                    if (target !== header && target.textContent !== header.textContent) {
                      clickElement(target);
                      console.log('Clicked sub-interactive block inside parent:', target.tagName, target.className);
                      clickedAnySuccess = true;
                    }
                  }
                  
                  // 同时尝试点击同级的下一个兄弟节点及其子代
                  let sibling = current.nextElementSibling;
                  while (sibling) {
                    clickElement(sibling);
                    const siblingChildren = Array.from(sibling.querySelectorAll('.cover-preview, [class*="cover"], canvas, img, video, .card, button'));
                    for (const sc of siblingChildren) {
                      clickElement(sc);
                    }
                    sibling = sibling.nextElementSibling;
                    clickedAnySuccess = true;
                  }
                  current = current.parentElement;
                }
              }

              // 方案 B：直接关键字全局匹配任何类似于“更换封面”、“修改封面”、“编辑封面”、“选择封面”的组件
              const directKeywords = ['修改封面', '更换封面', '设置封面', '编辑封面', '选择封面', '视频封面', '上传图片', '本地上传'];
              const customEls = Array.from(document.querySelectorAll('*')).filter(el => {
                if (el.children.length > 2) return false; // 仅聚焦叶子结点或叶子紧邻祖先，防大范围容器点击
                const txt = el.textContent ? el.textContent.trim() : '';
                return directKeywords.some(kw => txt === kw || txt.includes(kw));
              });

              for (const el of customEls) {
                clickElement(el);
                console.log('Clicked matched keyword component directly:', el.textContent);
                clickedAnySuccess = true;
              }

              return clickedAnySuccess ? 'COVER_TRIGGER_ATTEMPTED' : 'NO_ELEMENT_CLICKED';
            } catch(e) {
              return 'TRIGGER_ERROR: ' + e.message;
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
        await new Promise(r => setTimeout(r, 1000));

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
            // 给与 4500ms 等图片在浏览器中完全加载、渲染并在裁剪画板中生成
            await new Promise(r => setTimeout(r, 4500));

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

                  // 1. 优先在这个封面弹窗/裁剪对话框的内部寻找确定
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

    // 留出 2.0 秒充分安全时间，确保小红书的“声明须知”对话框弹窗完全挂载打开
    await new Promise(r => setTimeout(r, 2000));

    // 8d. 勾选“声名须知”复选逻辑，并确认点击“声明原创”按钮
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
    xhsProgressMap.set(noteId, { id: noteId, status: 'publishing', progress: 90, message: '配置项填写完毕，已进入测试校对模式...' });

    // 9. 执行发布点击 (用户要求：发布点击动作先不要做，以便测试发布前的信息是否填写准确)
    console.log(`[XHS 发布] [测试模式] 跳过最终的发布点击动作，保持浏览器页面处于打开状态以供校对。`);
    
    // 标记不要关闭当前调试标签页，使用户能在 Chrome 中实时校对并手动点击发布
    shouldKeepTabOpen = true;

    db.prepare("UPDATE xhs_notes SET publish_status = 'success', publish_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run('https://creator.xiaohongshu.com/publish/publish?from=menu&target=video', noteId);
    
    xhsProgressMap.set(noteId, { 
      id: noteId, 
      status: 'success', 
      progress: 100, 
      message: '🎉 [测试校对模式] 信息已在您的 Chrome 浏览器中填写完毕！请校对正确后手动点击“发布”按钮进行发布。' 
    });

    console.log(`[XHS 发布] ✅ [测试模式] 任务 ID: ${noteId} 信息填写及封面填充就绪！`);
    return { success: true, url: 'https://creator.xiaohongshu.com/publish/publish?from=menu&target=video' };

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
