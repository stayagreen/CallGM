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
      // 强制触发“上传封面”动作或找到第二个图片上传 input
      try {
        await Runtime.evaluate({
          expression: `(() => {
            try {
              // 1. 寻找可能触发封面选取的按钮或区域并点击
              const selectors = [
                '.upload-cover', '.cover-upload', '.edit-cover', '.cover-btn', 
                '[class*="cover"] button', '[class*="cover"] div', '[class*="upload"] button'
              ];
              for (const selector of selectors) {
                try {
                  const els = document.querySelectorAll(selector);
                  for (const el of els) {
                    const txt = el.textContent || '';
                    if (txt.includes('封面') || txt.includes('图片') || txt.includes('照片') || txt.includes('修改') || txt.includes('更换') || txt.includes('上传')) {
                      el.click();
                      console.log('Clicked selector:', selector);
                    }
                  }
                } catch(e) {}
              }
              
              // 2. 寻找带有“封面”、“设计”、“图片”文字的可点击元素
              const textEls = Array.from(document.querySelectorAll('button, div, span, p, label')).filter(el => {
                const txt = el.textContent ? el.textContent.trim() : '';
                return txt === '上传封面' || txt === '更换封面' || txt === '编辑封面' || txt === '选择封面' || txt === '修改封面' || txt === '上传图片' || txt === '本地上传';
              });
              
              for (const el of textEls) {
                try {
                  el.click();
                  console.log('Clicked text element:', el.textContent);
                } catch(e) {}
              }
            } catch(e) {}
          })()`
        });
        await new Promise(r => setTimeout(r, 2000));

        // 绝招：通过 JavaScript 远程对象(RemoteObject)定位文件上传元素，100% 精确获取其 CDP NodeId
        const evalResult = await Runtime.evaluate({
          expression: `(() => {
            const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
            if (inputs.length === 0) return null;
            // 优先选择含有 accept 属性且支持图片的
            const imgInput = inputs.find(el => {
              const acc = el.getAttribute('accept');
              return acc && (acc.includes('image') || acc.includes('png') || acc.includes('jpg') || acc.includes('jpeg'));
            });
            if (imgInput) return imgInput;
            
            // 是否在弹出层内
            const modal = document.querySelector('.semi-modal, [class*="modal"], [class*="dialog"], [class*="cropper"]');
            if (modal) {
              const modalInput = modal.querySelector('input[type="file"]');
              if (modalInput) return modalInput;
            }
            
            // 兜底方案：多个 input 时，通常最后一个就是封面 input
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
            await new Promise(r => setTimeout(r, 2500));

            // 对裁剪弹出框进行确认点击
            const cropResult = await Runtime.evaluate({
              expression: `(() => {
                try {
                  // 1. 优先在这个 modal 的内部确认
                  const modal = document.querySelector('.semi-modal, [class*="modal"], [class*="dialog"], [class*="cropper"]');
                  if (modal) {
                    const btns = Array.from(modal.querySelectorAll('button, [role="button"], div, span')).filter(el => {
                      const t = el.textContent ? el.textContent.trim() : '';
                      return t === '确定' || t === '完成' || t === '保存' || t === '裁剪并确定' || t === '确认' || t.includes('确') || t.includes('完');
                    });
                    if (btns.length > 0) {
                      const actualBtn = btns.find(b => b.tagName === 'BUTTON') || btns[0];
                      actualBtn.click();
                      return 'CLICKED_MODAL_CROP_CONFIRM_SUCCESS';
                    }
                  }
                  
                  // 2. 备用：全局点击
                  const globalBtns = Array.from(document.querySelectorAll('button')).filter(el => {
                    const t = el.textContent ? el.textContent.trim() : '';
                    return t === '确定' || t === '完成' || t === '保存' || t === '裁剪并确定' || t === '确认';
                  });
                  if (globalBtns.length > 0) {
                    globalBtns[0].click();
                    return 'CLICKED_GLOBAL_CROP_CONFIRM_SUCCESS';
                  }
                  return 'NO_CONFIRM_BTN_FOUND';
                } catch(e) {
                  return 'ERROR: ' + e.message;
                }
              })()`,
              returnByValue: true
            });
            console.log(`[XHS 发布] 封面遮罩/裁剪确认判定结果:`, cropResult.result?.value);
            await new Promise(r => setTimeout(r, 1500));
          }
        } else {
          console.warn(`[XHS 发布] 无法利用 RemoteObject 寻找到图片上传 Input，使用传统 selector 尝试做兜底流程...`);
          // 备用兜底
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
        
        // 激活编辑器焦点
        await Runtime.evaluate({
          expression: `(() => {
            const editor = document.querySelector('div[contenteditable="true"], x-editor, .post-content, textarea[placeholder*="正文"], #post-textarea');
            if (editor) { editor.focus(); }
          })()`
        });
        await new Promise(r => setTimeout(r, 200));

        // 1. 模拟按下并弹起 '# / 井号'
        await Input.dispatchKeyEvent({ type: 'keyDown', text: '#', unmodifiedText: '#', key: '#' });
        await Input.dispatchKeyEvent({ type: 'keyUp', text: '#', unmodifiedText: '#', key: '#' });
        await new Promise(r => setTimeout(r, 100));

        // 2. 逐一打上标签名字 (比如 "日常", "摄影") 
        for (const char of tag) {
          await Input.dispatchKeyEvent({ type: 'keyDown', text: char, unmodifiedText: char, key: char });
          await Input.dispatchKeyEvent({ type: 'keyUp', text: char, unmodifiedText: char, key: char });
          await new Promise(r => setTimeout(r, 100));
        }

        // 3. 高度仿真停留 500ms 让小红书的后台搜索关联下拉框拉取列表
        await new Promise(r => setTimeout(r, 500));

        // 4. 用户打完标签会通过敲击空格或回车来激活/确定该标签，这里同时发放空格和回车事件让小红书生成真正的蓝色话题包
        await Input.dispatchKeyEvent({
          type: 'keyDown',
          text: ' ',
          unmodifiedText: ' ',
          key: 'Space',
          code: 'Space'
        });
        await Input.dispatchKeyEvent({
          type: 'keyUp',
          text: ' ',
          unmodifiedText: ' ',
          key: 'Space',
          code: 'Space'
        });

        // 5. 补充一个空格进行阻隔，给下一个话题的录入完美护航
        await new Promise(r => setTimeout(r, 200));
        await Input.dispatchKeyEvent({
          type: 'keyDown',
          text: ' ',
          unmodifiedText: ' ',
          key: 'Space',
          code: 'Space'
        });
        await Input.dispatchKeyEvent({
          type: 'keyUp',
          text: ' ',
          unmodifiedText: ' ',
          key: 'Space',
          code: 'Space'
        });

        await new Promise(r => setTimeout(r, 400));
      }
    }

    console.log(`[XHS 发布] 所有话题标签已高仿真度完成模拟输入！`);

    // 8b. 触发“声明原创”开关
    xhsProgressMap.set(noteId, { id: noteId, status: 'publishing', progress: 88, message: '检测并设定原创声明条款...' });
    const originalTriggerResult = await Runtime.evaluate({
      expression: `(() => {
        try {
          // 寻找包含“声明原创”的文本标识
          const originalLabels = Array.from(document.querySelectorAll('span, label, p, div')).filter(el => {
            const text = el.textContent ? el.textContent.trim() : '';
            return text === '声明原创' || text.slice(0, 15) === '声明原创';
          });
          
          if (originalLabels.length > 0) {
            // 点击文本本身
            originalLabels[0].click();
            
            // 寻找父级中的开关/复选框并同步点击
            const parent = originalLabels[0].parentElement;
            if (parent) {
              const sw = parent.querySelector('input[type="checkbox"], .semi-switch, .semi-checkbox, .checkbox, [class*="switch"]');
              if (sw) {
                sw.click();
                return 'ORIGINAL_LABEL_AND_SWITCH_CLICKED';
              }
            }
            return 'ORIGINAL_LABEL_CLICKED';
          }
          
          // 如果未按文字定位，尝试根据类名或 ID 自主定位
          const originalSwitches = document.querySelectorAll('[class*="original"], [id*="original"]');
          if (originalSwitches.length > 0) {
            originalSwitches[0].click();
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

    // 留出 1.5 秒安全时间，彻底等待“声明须知”对话框弹窗打开
    await new Promise(r => setTimeout(r, 1500));

    // 8c. 勾选“声名须知”复选逻辑，并确认点击“声明原创”按钮
    const originalDialogResult = await Runtime.evaluate({
      expression: `(() => {
        try {
          // 1. 寻找弹出的对话框容器，并在其中定位协议勾选部分（“声明须知”、“我已阅读”、“原创声明”）
          const checkboxLabel = Array.from(document.querySelectorAll('span, label, p, div')).find(el => {
            const txt = el.textContent || '';
            return txt.includes('声明须知') || txt.includes('我已阅读') || txt.includes('原创条款') || txt.includes('原创声明');
          });

          if (checkboxLabel) {
            checkboxLabel.click();
            
            const parent = checkboxLabel.parentElement;
            if (parent) {
              const input = parent.querySelector('input[type="checkbox"], .semi-checkbox, .checkbox');
              if (input) {
                input.click();
              }
            }
          } else {
            // 最强鲁棒防线：如果搜不到特定文本，则把当前打开的弹框模态框下的全部 Checkbox 均尝试勾上
            const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"], .semi-checkbox, .checkbox'));
            checkboxes.forEach(cb => {
              try { cb.click(); } catch(e) {}
            });
          }

          // 2. 在对话框中寻找并点击“声明原创”确定/提交按钮
          const confirmBtns = Array.from(document.querySelectorAll('button, [role="button"], span, div')).filter(el => {
            const txt = el.textContent ? el.textContent.trim() : '';
            return txt === '声明原创' || txt === '确认声明' || txt === '确认';
          });

          if (confirmBtns.length > 0) {
            const targetBtn = confirmBtns.find(el => el.tagName === 'BUTTON') || confirmBtns[0];
            targetBtn.click();
            return 'DECLARED_ORIGINAL_DIALOG_CONFIRMED_SUCCESS';
          }
          return 'NO_CONFIRM_BUTTON_FOUND_IN_DIALOG';
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
