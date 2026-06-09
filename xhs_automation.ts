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
    path.join(__dirname, 'uploads', cleanPath.replace(/^uploads\//, '')),
    path.join(__dirname, 'download', cleanPath.replace(/^downloads\//, '').replace(/^download\//, '')),
    path.join(process.cwd(), 'uploads', cleanPath.replace(/^uploads\//, '')),
    path.join(process.cwd(), 'download', cleanPath.replace(/^downloads\//, '').replace(/^download\//, ''))
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

  try {
    // 2. 确保浏览器已打开
    await ensureBrowserLaunched();
    xhsProgressMap.set(noteId, { id: noteId, status: 'publishing', progress: 15, message: '浏览器就绪，创建新标签页并导航至创作者中心...' });

    // 3. 打开小红书后台发布页面
    // 用 9222 端口建立 CDP 连接
    currentTarget = await CDP.New({ url: 'https://creator.xiaohongshu.com/publish/publish-note', port: 9222 });
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
        const isPublishPage = window.location.href.includes('/publish-note');
        return { isLoginRedirect, loginForm, isPublishPage, url: window.location.href };
      })()`,
      returnByValue: true
    });

    const statusResult = checkStatus.result?.value || { isLoginRedirect: false, loginForm: false, isPublishPage: false, url: '' };
    console.log(`[XHS 发布] 当前页面诊断:`, statusResult);

    if (statusResult.isLoginRedirect || statusResult.loginForm || !statusResult.isPublishPage) {
      throw new Error(`未检测到登录状态，已跳转至登录页面。请在您的独立调试 Chrome 浏览器中手动完成小红书创作者页面登录，保证处于正常工作页面 (https://creator.xiaohongshu.com/publish/publish-note) 后重试。`);
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
              // 寻找包含上传封面或类似文字的元素并点击
              const els = Array.from(document.querySelectorAll('div, span, button')).filter(el => el.textContent && (el.textContent.includes('上传封面') || el.textContent.includes('更换封面')));
              if (els.length > 0) {
                els[0].click();
              }
            } catch(e) {}
          })()`
        });
        await new Promise(r => setTimeout(r, 1500));

        // 重新获取最新 DOM
        const { root: { nodeId: latestRootId } } = await DOM.getDocument();
        // 尝试寻找接受图片的 file 元素或者最新的 type="file" 元素。我们往往选择带有 accept*="image" 的上传框
        let imageInputNodeId = 0;
        try {
          const queryRes = await DOM.querySelector({ 
            nodeId: latestRootId, 
            selector: 'input[type="file"][accept*="image"]' 
          });
          imageInputNodeId = queryRes.nodeId;
        } catch(e) {
          // 如果没有特殊的，寻找所有的 input[type="file"] 取最后一个
          const queryAll = await Runtime.evaluate({
            expression: `(() => {
              const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
              return inputs.length;
            })()`,
            returnByValue: true
          });
          const inputCount = queryAll.result?.value || 1;
          console.log(`[XHS 发布] 发现 ${inputCount} 个上传框，尝试使用后排元素...`);
          // CDP 对最后一个进行定位
          // 在 DOM 树中重新筛选
        }

        if (imageInputNodeId) {
          await DOM.setFileInputFiles({ files: [absCoverPath], nodeId: imageInputNodeId });
          console.log(`[XHS 发布] 成功注入封面图片路径: ${absCoverPath}`);
          await new Promise(r => setTimeout(r, 2000));

          // 寻找是否有“确定/完成”剪裁遮罩弹窗并点击
          await Runtime.evaluate({
            expression: `(() => {
              try {
                const btns = Array.from(document.querySelectorAll('button, div, span')).filter(el => {
                  const t = el.textContent ? el.textContent.trim() : '';
                  return t === '确定' || t === '完成' || t === '保存' || t === '裁剪并确定';
                });
                if (btns.length > 0) {
                  btns[0].click();
                  console.log('点击了裁剪确定按钮');
                }
              } catch(e) {}
            })()`
          });
          await new Promise(r => setTimeout(r, 1500));
        }
      } catch (coverErr) {
        console.warn(`[XHS 发布] 封面图上传尝试出错，可能小红书自动提取了第一帧，我们将不中止流程:`, coverErr);
      }
    }

    xhsProgressMap.set(noteId, { id: noteId, status: 'publishing', progress: 85, message: '正在填写标题、正文及话题...' });

    // 8. 填写标题、正文及话题，并声明原创
    const fullContent = `${note.content || ''}\n\n${note.tags || ''}`.trim();
    
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

          // 填写正文
          const editor = document.querySelector('div[contenteditable="true"], x-editor, .post-content, textarea[placeholder*="正文"], #post-textarea');
          if (editor) {
            editor.focus();
            if (editor.getAttribute('contenteditable') === 'true' || editor.id === 'post-textarea') {
              editor.textContent = ${JSON.stringify(fullContent)};
              editor.dispatchEvent(new Event('input', { bubbles: true }));
              editor.dispatchEvent(new Event('blur', { bubbles: true }));
            } else {
              editor.value = ${JSON.stringify(fullContent)};
              editor.dispatchEvent(new Event('input', { bubbles: true }));
              editor.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }

          // 声明原创
          const originalTexts = Array.from(document.querySelectorAll('span, label, p, div')).filter(el => el.textContent && el.textContent.includes('声明原创'));
          for (const el of originalTexts) {
            el.click();
            const parent = el.parentElement;
            if (parent) {
              const chek = parent.querySelector('input[type="checkbox"], .semi-switch');
              if (chek) chek.click();
            }
          }
          return true;
        } catch(e) {
          return e.message;
        }
      })()`,
      returnByValue: true
    });

    await new Promise(r => setTimeout(r, 2000));
    xhsProgressMap.set(noteId, { id: noteId, status: 'publishing', progress: 90, message: '配置项填写完毕，正在执行最终发布动作...' });

    // 9. 执行发布点击
    await Runtime.evaluate({
      expression: `(() => {
        try {
          const btns = Array.from(document.querySelectorAll('button')).filter(el => {
            const txt = el.textContent ? el.textContent.trim() : '';
            return txt === '发布' || txt === '确认发布' || txt === '立即发布';
          });
          if (btns.length > 0) {
            btns[0].click();
            return 'CLICKED_PUBLISH';
          }
          return 'NO_PUBLISH_BUTTON_FOUND';
        } catch(e) {
          return e.message;
        }
      })()`,
      returnByValue: true
    });

    console.log(`[XHS 发布] 已触发立即发布按钮，安全等待成功跳转...`);
    
    // 10. 循环诊断发布成败及回填页面链接
    let publishSuccess = false;
    let publishUrlResult = '';
    
    for (let check = 0; check < 15; check++) {
      await new Promise(r => setTimeout(r, 2000));
      
      const checkResult = await Runtime.evaluate({
        expression: `(() => {
          const url = window.location.href;
          // 若跳转至创作管理页面(或者包含 notes / creator/home)，说明发布已经提交或跳转
          const published = url.includes('/creator/home') || url.includes('/posts') || document.body.innerText.includes('发布成功') || document.body.innerText.includes('审核中');
          
          let noteUrl = '';
          if (published) {
            // 尝试提取刚刚发布成功的笔记地址
            const firstLink = document.querySelector('a[href*="/discovery/detail/"], a[href*="/explore/"]');
            if (firstLink) {
              noteUrl = firstLink.href;
            }
          }
          return { published, noteUrl, currentUrl: url };
        })()`,
        returnByValue: true
      });

      const verify = checkResult.result?.value || { published: false, noteUrl: '', currentUrl: '' };
      console.log(`[XHS 发布] 发布验证结果 (${check + 1}/15):`, verify);

      if (verify.published) {
        publishSuccess = true;
        publishUrlResult = verify.noteUrl;
        if (publishUrlResult) {
          break; // 拿到了链接提前结束
        }
      }
    }

    if (publishSuccess) {
      const finalUrl = publishUrlResult || 'https://creator.xiaohongshu.com/creator/home';
      db.prepare("UPDATE xhs_notes SET publish_status = 'success', publish_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(finalUrl, noteId);
      
      xhsProgressMap.set(noteId, { 
        id: noteId, 
        status: 'success', 
        progress: 100, 
        message: '🎉 笔记已成功发布，并已记录发布记录。' 
      });

      console.log(`[XHS 发布] ✅ 任务 ID: ${noteId} 发布成功！回填链接: ${finalUrl}`);
      return { success: true, url: finalUrl };
    } else {
      throw new Error("点击发布后，小红书系统未在限时内返回发布成功响应或未能检测到页面正常跳转（可能后台正在进行严格的安全限流拦截）。");
    }

  } catch (error: any) {
    console.error(`[XHS 发布] ❌ 任务 ID: ${noteId} 发生致命错误:`, error.message || error);
    const errMessage = error.message || "小红书自动化发布发生未设定的错误";
    
    db.prepare("UPDATE xhs_notes SET publish_status = 'failed', error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(errMessage, noteId);
    xhsProgressMap.set(noteId, { id: noteId, status: 'failed', progress: 0, message: `发布失败: ${errMessage}` });
    
    return { success: false, error: errMessage };
  } finally {
    // 关闭此标签页防溢出
    if (client && currentTarget) {
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
