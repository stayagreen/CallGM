process.env.TZ = 'Asia/Shanghai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import sharp from 'sharp';
import { execa } from 'execa';
import db from './src/db/db.js';
import { GoogleGenAI, Type } from '@google/genai';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
let FFMPEG_PATH = 'ffmpeg'; // Default to system ffmpeg

// Check if system ffmpeg is available and supports required features
async function checkFfmpegSupport() {
    try {
        console.log('[FFmpeg] 正在检测系统 FFmpeg...');
        const { stdout: filters } = await execa('ffmpeg', ['-filters']);
        const { stdout: encoders } = await execa('ffmpeg', ['-encoders']);
        
        const hasXfade = filters.includes('xfade');
        const hasLibx264 = encoders.includes('libx264');
        
        if (hasLibx264) {
            console.log(`✅ 使用系统 FFmpeg (支持 libx264${hasXfade ? ', 支持 xfade' : ''})`);
            return { supported: true, xfade: hasXfade, path: 'ffmpeg' };
        } else {
            console.log('❌ 系统 FFmpeg 缺少 libx264 编码器');
        }
    } catch (e: any) {
        console.log(`❌ 系统 FFmpeg 检测失败: ${e.message}`);
    }
    
    console.log('⚠️ 回退到内置 FFmpeg 版本');
    return { supported: false, xfade: false, path: ffmpegInstaller.path };
}

let xfadeSupported = false;
checkFfmpegSupport().then(res => {
    xfadeSupported = res.xfade;
    FFMPEG_PATH = res.path;
    ffmpeg.setFfmpegPath(res.path);
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const videoTaskDir = path.join(__dirname, 'task_video');
const videoHistoryDir = path.join(videoTaskDir, 'history');
const videoDownloadDir = path.join(__dirname, 'download', 'videos');
const videoThumbDir = path.join(__dirname, 'thumbnails', 'videos');
const bgmDir = path.join(__dirname, 'bgm');

[videoTaskDir, videoHistoryDir, videoDownloadDir, videoThumbDir, bgmDir].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

export const videoJobProgress = new Map<string, { progress: number, status: string, error?: string }>();
export const cancelledVideoJobs = new Set<string>();

let activeVideoJobs = 0;

export function startVideoAutomationWatcher(getConcurrency: () => number) {
    console.log('🎬 视频渲染引擎已启动...');
    
    setInterval(async () => {
        const maxConcurrency = getConcurrency();
        if (activeVideoJobs >= maxConcurrency) return;

        try {
            // 获取所有视频任务目录（根 videoTaskDir 和用户子目录）
            let allDirs = [videoTaskDir];
            try {
                const subDirs = fs.readdirSync(videoTaskDir).filter(f => {
                    const p = path.join(videoTaskDir, f);
                    return fs.statSync(p).isDirectory() && f !== 'history';
                });
                allDirs = [...allDirs, ...subDirs.map(sd => path.join(videoTaskDir, sd))];
            } catch(e) {}

            const taskFiles: { path: string, filename: string }[] = [];
            for (const dir of allDirs) {
                if (!fs.existsSync(dir)) continue;
                const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && fs.statSync(path.join(dir, f)).isFile());
                if (files.length > 0) {
                    console.log(`[VideoEngine] 扫描到目录 ${dir} 下有 ${files.length} 个待处理任务`);
                }
                files.forEach(f => {
                    taskFiles.push({ path: path.join(dir, f), filename: f });
                });
            }
            
            for (const { path: filePath, filename: baseFilename } of taskFiles) {
                if (activeVideoJobs >= maxConcurrency) break;
                
                const jobId = baseFilename.replace('.json', '');
                // Check if already processing
                if (videoJobProgress.has(jobId) && videoJobProgress.get(jobId)?.status === 'running') continue;

                activeVideoJobs++;
                videoJobProgress.set(jobId, { progress: 0, status: 'running' });
                
                // Process async without blocking the loop
                processVideoTask(filePath, jobId).catch(err => {
                    console.error(`❌ 视频任务 ${baseFilename} 失败:`, err);
                    videoJobProgress.set(jobId, { progress: 0, status: 'error', error: err.message });
                    // Move to history even on error to keep record
                    try {
                        const taskData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                        taskData.status = 'error';
                        taskData.error = err.message;
                        
                        // 确定正确的 history 目录
                        const fileDir = path.dirname(filePath);
                        const relativeSubDir = path.relative(videoTaskDir, fileDir);
                        const targetHistoryDir = path.join(videoHistoryDir, relativeSubDir);
                        if (!fs.existsSync(targetHistoryDir)) fs.mkdirSync(targetHistoryDir, { recursive: true });

                        fs.writeFileSync(path.join(targetHistoryDir, baseFilename), JSON.stringify(taskData, null, 2));
                        fs.unlinkSync(filePath);
                    } catch (e) {
                        console.error('Failed to move error task to history', e);
                    }
                }).finally(() => {
                    activeVideoJobs--;
                });
            }
        } catch (err) {
            console.error('视频引擎轮询错误:', err);
        }
    }, 3000);
}

function getAppConfig() {
    try {
        const configRow = db.prepare('SELECT value FROM system_config WHERE key = ?').get('app_config') as any;
        if (configRow && configRow.value) {
            return JSON.parse(configRow.value);
        }
    } catch (e) {
        console.error('Failed to load app config in video_automation:', e);
    }
    return {};
}

function getXhsCoverImageBase64(xhsCoverImage: string, taskDir: string): { data: string; mimeType: string } | null {
    if (!xhsCoverImage) return null;
    
    // Strip query parameters like timestamp `?t=...`
    const cleanUrl = xhsCoverImage.split('?')[0];
    
    if (cleanUrl.startsWith('data:image/')) {
      const matches = cleanUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        return { mimeType: matches[1], data: matches[2] };
      }
      return null;
    }

    // Handle local path
    let relativePath = cleanUrl;
    if (relativePath.startsWith('/')) {
      relativePath = relativePath.substring(1);
    }

    let fullPath = '';
    if (relativePath.startsWith('uploads/')) {
      fullPath = path.join(process.cwd(), relativePath);
    } else if (relativePath.startsWith('downloads/')) {
      fullPath = path.join(process.cwd(), 'download', relativePath.substring('downloads/'.length));
    } else if (relativePath.startsWith('download/')) {
      fullPath = path.join(process.cwd(), relativePath);
    } else {
      const tryUploadPath = path.join(process.cwd(), 'uploads', relativePath);
      if (fs.existsSync(tryUploadPath)) {
        fullPath = tryUploadPath;
      } else {
        const tryDownloadPath = path.join(process.cwd(), 'download', relativePath);
        if (fs.existsSync(tryDownloadPath)) {
          fullPath = tryDownloadPath;
        } else {
          fullPath = path.join(process.cwd(), relativePath);
        }
      }
    }

    console.log(`[AI-GEN-BACKGROUND] Reading cover image from path: "${fullPath}"`);

    if (fs.existsSync(fullPath)) {
      try {
        const ext = path.extname(fullPath).toLowerCase().replace('.', '');
        let mimeType = 'image/jpeg';
        if (ext === 'png') mimeType = 'image/png';
        else if (ext === 'webp') mimeType = 'image/webp';
        else if (ext === 'gif') mimeType = 'image/gif';

        const fileBuffer = fs.readFileSync(fullPath);
        return {
          mimeType,
          data: fileBuffer.toString('base64'),
        };
      } catch (e) {
        console.error('[AI-GEN-BACKGROUND] Error reading local cover image:', e);
        return null;
      }
    }

    return null;
}

function extractJSON(text: string): any {
    const cleaned = text.trim();
    
    try {
      return JSON.parse(cleaned);
    } catch (e) {}

    const markdownRegex = /```(?:json|JSON)?\s*([\s\S]*?)\s*```/;
    const match = cleaned.match(markdownRegex);
    if (match) {
      const blockContent = match[1].trim();
      try {
        return JSON.parse(blockContent);
      } catch (e) {}
    }

    const firstOpen = cleaned.indexOf('{');
    const lastClose = cleaned.lastIndexOf('}');
    if (firstOpen !== -1 && lastClose !== -1 && lastClose > firstOpen) {
      const jsonCandidate = cleaned.substring(firstOpen, lastClose + 1);
      try {
        return JSON.parse(jsonCandidate);
      } catch (e) {}

      let fuzzyClean = jsonCandidate.trim();
      fuzzyClean = fuzzyClean.replace(/,\s*([\]}])/g, '$1');
      try {
        return JSON.parse(fuzzyClean);
      } catch (e) {}
    }

    try {
      const xhsTitleMatch = text.match(/(?:xhsTitle|标题|Title)["'：\s]+([^"'\n]+)/i);
      const xhsTagsMatch = text.match(/(?:xhsTags|标签|话题|Tags)["'：\s]+([^"'\n]+)/i);
      
      let xhsBody = '';
      const bodyMatch = text.match(/(?:xhsBody|正文|内容|Body)["'：\s]+([\s\S]+?)(?=(?:"?xhsTags|标签|话题|Tags|$))/i);
      if (bodyMatch) {
        xhsBody = bodyMatch[1].trim();
        xhsBody = xhsBody.replace(/^["'\s]+|["'\s]+$/g, '');
      } else {
        xhsBody = text;
      }

      if (xhsTitleMatch) {
        return {
          xhsTitle: xhsTitleMatch[1].trim().replace(/^["'\s]+|["'\s]+$/g, ''),
          xhsBody: xhsBody,
          xhsTags: xhsTagsMatch ? xhsTagsMatch[1].trim().replace(/^["'\s]+|["'\s]+$/g, '') : "#话题"
        };
      }
    } catch (e) {}

    throw new Error("无法从回复中解析出具有标准结构的 JSON 文档。原始内容为: " + text);
}

async function generateXhsCopyBackground(taskData: any): Promise<any> {
    const storyboards = taskData.storyboards || [];
    const videoName = taskData.videoName || '';
    
    let coverUrl = taskData.xhsCoverImage;
    if (!coverUrl && storyboards && storyboards.length > 0) {
        coverUrl = storyboards[0]?.image;
    }

    if (!coverUrl) {
        console.warn("[AI-GEN-BACKGROUND] No cover URL or storyboards to generate from, skipping background copy generation");
        return null;
    }

    const imgData = getXhsCoverImageBase64(coverUrl, videoTaskDir);
    if (!imgData) {
        console.warn("[AI-GEN-BACKGROUND] Could not read cover image file, skipping background copy generation");
        return null;
    }

    let config: any = {};
    try {
        const configRow = db.prepare('SELECT value FROM system_config WHERE key = ?').get('app_config') as any;
        if (configRow && configRow.value) {
            config = JSON.parse(configRow.value);
        }
    } catch(e) {}

    const defaultPromptTemplate = `【核心要求：请务必深度结合我上传的“小红书封面图片”以及下方的视频分镜描述来创作。你生成的一切内容（包含标题、正文、情感基调与话题）都应该与这张封面图的视觉主题、画面主体、配色、情绪和文字标签高度契合，体现出根据封面图量身定制的原生质感。】

你是一个小红书爆款文案专家。请结合我上传的封面图片，并根据以下提供的视频分镜画面描述，为我制作一个小红书发布的标题、正文和话题标签：

视频分镜详情：
{storyboardTexts}

请遵循以下极严限制：
1. **标题**（xhsTitle）：标题必须短小精悍且极具吸引力（例如使用爆款问句、感叹句、情绪词、emoji），且**总字数（包含文字、标点、特殊符号和emoji）绝对不能超过20字**（严格 ≤ 20字）。
2. **正文**（xhsBody）：正文要求生动活泼，语气要像小红书个人博主日常分享，分段清晰，善用表情符号/emoji。**绝对不能出现任何营销、导流、推广、购买、加好友、链接、加微信等政治敏感/营销广告引导语**，以天然真实原生态分享为主。
3. **话题**（xhsTags）：精选**刚好 10 个**极具热度和深度相关的爆款小红书话题。格式为“#话题1 #话题2 ...”，每个话题带#号，空格隔开，严格返回正好 10 个，不能多也不能少。

请使用以下标准的纯JSON格式返回：
{
  "xhsTitle": "20字内极富吸引力小红书标题",
  "xhsBody": "元气活泼的小红书正文...",
  "xhsTags": "#话题1 #话题2 #话题3 #话题4 #话题5 #话题6 #话题7 #话题8 #话题9 #话题10"
}`;

    const xhsPromptTemplate = config.xhsPrompt || defaultPromptTemplate;

    let storyboardTexts = '';
    if (storyboards && Array.isArray(storyboards) && storyboards.length > 0) {
      storyboardTexts = storyboards.map((s: any, idx: number) => {
        return `分镜 ${idx + 1}: ${s.text || '（无描述）'}`;
      }).join('\n');
    } else if (videoName) {
      storyboardTexts = `视频名称/场景内容: ${videoName}`;
    } else {
      storyboardTexts = `视频场景内容: 这是一个精美的创意视频作品`;
    }

    let prompt = xhsPromptTemplate;
    if (prompt.includes('{storyboardTexts}')) {
      prompt = prompt.split('{storyboardTexts}').join(storyboardTexts);
    } else if (prompt.includes('${storyboardTexts}')) {
      prompt = prompt.split('${storyboardTexts}').join(storyboardTexts);
    } else {
      prompt = prompt + `\n\n视频分镜详情：\n${storyboardTexts}`;
    }

    const openCodeApiKey = config.openCodeApiKey || '';
    const openCodeApiUrl = config.openCodeApiUrl || '';
    const openCodeModel = config.openCodeModel || '';

    if (!openCodeApiKey) {
        console.log(`[AI-GEN-BACKGROUND] 未配置 OpenCode API Key，将尝试使用内置 Gemini 服务直接生成...`);
        const key = process.env.GEMINI_API_KEY;
        if (!key) {
            console.warn("[AI-GEN-BACKGROUND] GEMINI_API_KEY 环境变量未设置且未配置 OpenCode API Key，跳过后台小红书文案生成");
            return null;
        }

        const ai = new GoogleGenAI({
          apiKey: key,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            }
          }
        });

        const response = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: {
            parts: [
              {
                inlineData: {
                  data: imgData.data,
                  mimeType: imgData.mimeType
                }
              },
              {
                text: prompt
              }
            ]
          },
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                xhsTitle: {
                  type: Type.STRING,
                  description: "小红书爆款标题，不超过20个字"
                },
                xhsBody: {
                  type: Type.STRING,
                  description: "符合人设要求的小红书正文，不带广告、加微等引流用语"
                },
                xhsTags: {
                  type: Type.STRING,
                  description: "10个爆款话题标签，格式固定为：#话题1 #话题2 #话题3 #话题4 #话题5 #话题6 #话题7 #话题8 #话题9 #话题10，正好十个，空格隔开"
                }
              },
              required: ["xhsTitle", "xhsBody", "xhsTags"]
            }
          }
        });

        const resultText = response.text;
        if (!resultText) {
          throw new Error("Gemini API 返回了空内容。");
        }
        
        const parsed = extractJSON(resultText);
        if (parsed && parsed.xhsTitle && parsed.xhsTitle.length > 20) {
          parsed.xhsTitle = parsed.xhsTitle.substring(0, 20);
        }
        return parsed;
    }

    // Use OpenCode / custom API Key
    let baseUrl = (openCodeApiUrl || 'https://opencode.ai/zen/go/v1').trim();
    if (baseUrl.endsWith('/')) {
      baseUrl = baseUrl.substring(0, baseUrl.length - 1);
    }

    const actualModel = (openCodeModel || 'minimax-m3').trim();
    let cleanModel = actualModel;
    if (cleanModel.startsWith('opencode-go/')) {
      cleanModel = cleanModel.substring(12);
    }

    const isAnthropicStyle = cleanModel.includes('minimax') || cleanModel.includes('qwen') || baseUrl.includes('/messages');

    let formattedBase = baseUrl;
    const completionsSuffix = '/chat/completions';
    const messagesSuffix = '/messages';

    if (formattedBase.endsWith(completionsSuffix)) {
      formattedBase = formattedBase.substring(0, formattedBase.length - completionsSuffix.length);
    } else if (formattedBase.endsWith(messagesSuffix)) {
      formattedBase = formattedBase.substring(0, formattedBase.length - messagesSuffix.length);
    }
    if (formattedBase.endsWith('/')) {
      formattedBase = formattedBase.substring(0, formattedBase.length - 1);
    }

    let apiEndpoint = '';
    let requestBody: any = {};

    if (isAnthropicStyle) {
      apiEndpoint = `${formattedBase}/messages`;
      requestBody = {
        model: cleanModel,
        system: "You are a professional social media marketing assistant for Xiaohongshu.",
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: imgData.mimeType,
                  data: imgData.data
                }
              },
              {
                type: 'text',
                text: prompt
              }
            ]
          }
        ],
        max_tokens: 4096,
        temperature: 0.7
      };
    } else {
      apiEndpoint = `${formattedBase}/chat/completions`;
      requestBody = {
        model: cleanModel,
        messages: [
          { role: 'system', content: 'You are a professional social media marketing assistant for Xiaohongshu.' },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: prompt
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${imgData.mimeType};base64,${imgData.data}`
                }
              }
            ]
          }
        ],
        temperature: 0.7
      };
    }

    console.log(`[AI-GEN-BACKGROUND] API generating content via OpenCode. Model: "${cleanModel}" via ${apiEndpoint}...`);
    const apiResponse = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openCodeApiKey}`,
          ...(isAnthropicStyle ? {
            'x-api-key': openCodeApiKey,
            'anthropic-version': '2023-06-01'
          } : {})
        },
        body: JSON.stringify(requestBody)
    });

    if (!apiResponse.ok) {
        const errText = await apiResponse.text();
        throw new Error(`OpenCode API 返回了非 200 状态码 (${apiResponse.status}): ${errText}`);
    }

    const rawText = await apiResponse.text();
    const data = JSON.parse(rawText);
    
    let content = '';
    if (data.content && Array.isArray(data.content)) {
      const textParts = data.content
        .filter((part: any) => part && (part.type === 'text' || part.text))
        .map((part: any) => part.text || '');
      content = textParts.join('\n').trim();
    }

    if (!content && data.choices && Array.isArray(data.choices) && data.choices.length > 0) {
      const choice = data.choices[0];
      if (choice) {
        if (choice.message) {
          if (typeof choice.message.content === 'string') {
            content = choice.message.content.trim();
          } else if (Array.isArray(choice.message.content)) {
            const textParts = choice.message.content
              .filter((part: any) => part && (part.type === 'text' || part.text))
              .map((part: any) => part.text || '');
            content = textParts.join('\n').trim();
          }
        } else if (typeof choice.text === 'string') {
          content = choice.text.trim();
        }
      }
    }

    if (!content) {
      const foundTexts: string[] = [];
      const deepSearch = (obj: any) => {
        if (!obj || typeof obj !== 'object') return;
        if (obj.type === 'text' && typeof obj.text === 'string') {
          foundTexts.push(obj.text);
          return;
        }
        for (const key of Object.keys(obj)) {
          const val = obj[key];
          if (key === 'content' && typeof val === 'string') {
            foundTexts.push(val);
          } else if (key === 'text' && typeof val === 'string') {
            foundTexts.push(val);
          } else if (typeof val === 'object') {
            deepSearch(val);
          }
        }
      };
      deepSearch(data);
      if (foundTexts.length > 0) {
        content = foundTexts.join('\n').trim();
      }
    }

    if (!content) {
      throw new Error(`OpenCode API 解析成功，但未能提取到对话回复正文。`);
    }

    const parsed = extractJSON(content);
    if (parsed && parsed.xhsTitle && parsed.xhsTitle.length > 20) {
      parsed.xhsTitle = parsed.xhsTitle.substring(0, 20);
    }
    return parsed;
}

async function processVideoTask(filePath: string, jobKey: string) {
    const filename = path.basename(filePath);
    const jobId = filename.replace('.json', '');
    const taskData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const { storyboards, bgm, introAnimation, outroAnimation, userId } = taskData;
    
    // Start generating XHS copy concurrently if it doesn't exist
    let xhsGenPromise: Promise<any> = Promise.resolve();
    const hasCopy = taskData.xhsTitle || taskData.xhsBody;
    if (!hasCopy) {
        console.log(`[AI-GEN-BACKGROUND] 检测到当前视频没有小红书文案，启动后台 AI 自动生成...`);
        xhsGenPromise = generateXhsCopyBackground(taskData).then(result => {
            if (result) {
                taskData.xhsTitle = result.xhsTitle;
                taskData.xhsBody = result.xhsBody;
                taskData.xhsTags = result.xhsTags;
                console.log(`[AI-GEN-BACKGROUND] 后台 AI 小红书文案生成成功：标题="${result.xhsTitle}"`);
            }
        }).catch(err => {
            console.error(`[AI-GEN-BACKGROUND] 后台 AI 小红书文案生成失败:`, err);
        });
    }
    
    // Update DB: Status -> Running
    try {
        db.prepare('UPDATE tasks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('running', jobId);
    } catch(e) {}

    // Ensure user directories exist
    const userVideoDownloadDir = userId ? path.join(videoDownloadDir, userId.toString()) : videoDownloadDir;
    const userVideoThumbDir = userId ? path.join(videoThumbDir, userId.toString()) : videoThumbDir;
    
    if (!fs.existsSync(userVideoDownloadDir)) fs.mkdirSync(userVideoDownloadDir, { recursive: true });
    if (!fs.existsSync(userVideoThumbDir)) fs.mkdirSync(userVideoThumbDir, { recursive: true });

    const outputFilename = `video_${Date.now()}.mp4`;
    const outputPath = path.join(userVideoDownloadDir, outputFilename);
    const thumbPath = path.join(userVideoThumbDir, outputFilename.replace('.mp4', '.jpg'));

    // Fetch config options (Defaults are the new upgraded settings)
    const config = getAppConfig();
    const videoFps = config.videoFps !== undefined ? parseInt(config.videoFps) : 60; // Default 60 fps
    const videoQualityMode = config.videoQualityMode || 'highSharpen'; // Default highSharpen
    const videoColorProtection = config.videoColorProtection || 'bt709'; // Default bt709

    // Determine target resolution based on first image (1080p default)
    let targetWidth = 1920;
    let targetHeight = 1080;
    let crf = '17'; // Upgraded default CRF
    let videoBitrate = '15M'; // Upgraded default bitrate (15M-20M)
    let maxRate = '20M';
    let bufSize = '30M';

    if (storyboards.length > 0) {
        let firstImgPath = storyboards[0].image;
        try {
            let metadata;
            if (firstImgPath.startsWith('data:image')) {
                const base64Data = firstImgPath.replace(/^data:image\/\w+;base64,/, "");
                const buffer = Buffer.from(base64Data, 'base64');
                metadata = await sharp(buffer).metadata();
            } else {
                let localPath = firstImgPath;
                let fallbackDir = '';
                if (firstImgPath.startsWith('/uploads/')) {
                    localPath = path.join(__dirname, 'uploads', firstImgPath.replace('/uploads/', ''));
                    fallbackDir = path.join(__dirname, 'uploads');
                } else if (firstImgPath.startsWith('/downloads/')) {
                    localPath = path.join(__dirname, 'download', firstImgPath.replace('/downloads/', ''));
                    fallbackDir = path.join(__dirname, 'download');
                }
                
                if (fallbackDir && !fs.existsSync(localPath)) {
                    const fallbackPath = path.join(fallbackDir, path.basename(firstImgPath));
                    if (fs.existsSync(fallbackPath)) {
                        localPath = fallbackPath;
                    }
                }
                
                metadata = await sharp(localPath).metadata();
            }
            
            if (metadata.width && metadata.height) {
                const aspect = metadata.width / metadata.height;
                const maxDim = Math.max(metadata.width, metadata.height);
                const minDim = Math.min(metadata.width, metadata.height);

                if (maxDim >= 3200 || minDim >= 2160) {
                    // 4K Target
                    if (metadata.width >= metadata.height) {
                        targetWidth = 3840;
                        targetHeight = Math.round((3840 / aspect) / 2) * 2;
                    } else {
                        targetHeight = 3840;
                        targetWidth = Math.round((3840 * aspect) / 2) * 2;
                    }
                    
                    if (videoQualityMode === 'highSharpen') {
                        crf = '16';
                        videoBitrate = '50M';
                        maxRate = '60M';
                        bufSize = '100M';
                    } else {
                        crf = '18';
                        videoBitrate = '40M';
                        maxRate = '50M';
                        bufSize = '80M';
                    }
                    console.log(`[VideoEngine] 🚀 检测到 4K 原图分辨率 (${metadata.width}x${metadata.height}), 自动适配为 4K 输出: ${targetWidth}x${targetHeight}, 码率: ${videoBitrate}`);
                } else if (maxDim >= 2000 || minDim >= 1400) {
                    // 2K Target
                    if (metadata.width >= metadata.height) {
                        targetWidth = 2560;
                        targetHeight = Math.round((2560 / aspect) / 2) * 2;
                    } else {
                        targetHeight = 2560;
                        targetWidth = Math.round((2560 * aspect) / 2) * 2;
                    }
                    
                    if (videoQualityMode === 'highSharpen') {
                        crf = '17'; // 强制 CRF=17
                        videoBitrate = '25M'; // 并将输出码率提高
                        maxRate = '30M';
                        bufSize = '50M';
                    } else {
                        crf = '20';
                        videoBitrate = '18M';
                        maxRate = '25M';
                        bufSize = '40M';
                    }
                    console.log(`[VideoEngine] 🚀 检测到 2K 原图分辨率 (${metadata.width}x${metadata.height}), 自动适配为 2K 输出: ${targetWidth}x${targetHeight}, 码率: ${videoBitrate}`);
                } else {
                    // 1080P Target
                    if (metadata.width >= metadata.height) {
                        targetHeight = 1080;
                        targetWidth = Math.round((1080 * aspect) / 2) * 2;
                    } else {
                        targetWidth = 1080;
                        targetHeight = Math.round((1080 / aspect) / 2) * 2;
                    }
                    
                    if (videoQualityMode === 'highSharpen') {
                        crf = '17'; // 强制将 CRF 压到 17
                        videoBitrate = '15M'; // 并将输出码率提高到 15M - 20Mbps
                        maxRate = '20M';
                        bufSize = '30M';
                    } else {
                        crf = '23';
                        videoBitrate = '8M';
                        maxRate = '12M';
                        bufSize = '16M';
                    }
                    console.log(`[VideoEngine] 🚀 使用标准 1080P 渲染: ${targetWidth}x${targetHeight}, 码率: ${videoBitrate}, CRF: ${crf}`);
                }
            }
        } catch (e) {
            console.error('Failed to get image metadata for resolution', e);
        }
    }

    // 1. Generate individual clips
    const clipPaths: string[] = [];
    for (let i = 0; i < storyboards.length; i++) {
        if (cancelledVideoJobs.has(jobId)) throw new Error('CANCELLED');
        const sb = storyboards[i];
        const clipPath = path.join(videoTaskDir, `temp_${filename}_clip_${i}.mp4`);
        await generateClip(sb, clipPath, targetWidth, targetHeight, crf, videoBitrate, maxRate, bufSize, videoFps, videoColorProtection, videoQualityMode);
        clipPaths.push(clipPath);
        videoJobProgress.set(jobKey, { progress: Math.floor((i / storyboards.length) * 40), status: 'running' });
    }

    // 2. Concatenate clips with transitions
    if (cancelledVideoJobs.has(jobId)) throw new Error('CANCELLED');
    const concatPath = path.join(videoTaskDir, `temp_${filename}_concat.mp4`);
    let finalDuration = 0;
    await concatenateClips(clipPaths, storyboards, concatPath, (p) => {
        videoJobProgress.set(jobKey, { progress: 40 + Math.floor(p * 0.4), status: 'running' });
    }, crf, videoBitrate, maxRate, bufSize, videoFps, videoColorProtection, videoQualityMode).then(duration => {
        finalDuration = duration;
    });

    // 3. Add BGM and Intro/Outro
    if (cancelledVideoJobs.has(jobId)) throw new Error('CANCELLED');
    await addBgmAndFinalize(concatPath, finalDuration, bgm, introAnimation, outroAnimation, outputPath, (p) => {
        videoJobProgress.set(jobKey, { progress: 80 + Math.floor(p * 0.2), status: 'running' });
    }, crf, videoBitrate, maxRate, bufSize, videoFps, videoColorProtection, videoQualityMode);

    // 4. Generate Thumbnail
    await generateThumbnail(outputPath, thumbPath);

    // Cleanup temp files
    clipPaths.forEach(p => { if (fs.existsSync(p)) fs.unlinkSync(p); });
    if (fs.existsSync(concatPath)) fs.unlinkSync(concatPath);

    // Ensure background AI copy generation completes before finalizing task data
    try {
        await xhsGenPromise;
    } catch(e) {
        console.error('[AI-GEN-BACKGROUND] Wait for background XHS generation failed:', e);
    }

    // Move task to history
    const relativeAssetPath = userId ? `${userId}/${outputFilename}` : outputFilename;
    taskData.outputVideo = relativeAssetPath;
    if (fs.existsSync(filePath)) {
        try {
            fs.writeFileSync(filePath, JSON.stringify(taskData, null, 2));
            const fileDir = path.dirname(filePath);
            const relativeSubDir = path.relative(videoTaskDir, fileDir);
            const targetHistoryDir = path.join(videoHistoryDir, relativeSubDir);
            if (!fs.existsSync(targetHistoryDir)) fs.mkdirSync(targetHistoryDir, { recursive: true });
            fs.renameSync(filePath, path.join(targetHistoryDir, filename));
        } catch(e) {}
    }
    
    // Update DB: Final Status, Data and Asset registration
    try {
        db.prepare('UPDATE tasks SET status = ?, progress = ?, data = ?, result_files = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
            'completed',
            100,
            JSON.stringify(taskData),
            JSON.stringify([relativeAssetPath]),
            jobId
        );
        
        db.prepare('INSERT OR IGNORE INTO assets (user_id, job_id, type, file_path) VALUES (?, ?, ?, ?)').run(
            userId || 1,
            jobId,
            'video',
            relativeAssetPath
        );
        console.log(`✅ [Database] Updated video job ${jobId} status to completed`);
    } catch(e) {
        console.error(`❌ [Database] Failed to update video job ${jobId}`, e);
    }

    videoJobProgress.set(jobKey, { progress: 100, status: 'completed' });
    
    // Cleanup progress map after delay
    setTimeout(() => {
        cancelledVideoJobs.delete(jobId);
        videoJobProgress.delete(jobKey);
        videoJobProgress.delete(filename); // compat
    }, 3000);

    console.log(`✅ 视频渲染完成: ${outputFilename} (User: ${userId || 'global'})`);
}

async function generateClip(sb: any, outputPath: string, targetWidth: number, targetHeight: number, crf: string = '23', bitrate: string = '8M', maxRate: string = '12M', bufSize: string = '16M', fps: number = 60, videoColorProtection: string = 'bt709', videoQualityMode: string = 'highSharpen'): Promise<void> {
    // Resolve image path
    let imgPath = sb.image;
    if (imgPath.startsWith('/uploads/')) {
        imgPath = path.join(__dirname, 'uploads', imgPath.replace('/uploads/', ''));
    } else if (imgPath.startsWith('/downloads/')) {
        imgPath = path.join(__dirname, 'download', imgPath.replace('/downloads/', ''));
    } else if (imgPath.startsWith('data:image')) {
        // Base64
        const base64Data = imgPath.replace(/^data:image\/\w+;base64,/, "");
        imgPath = path.join(videoTaskDir, `temp_img_${Date.now()}.png`);
        fs.writeFileSync(imgPath, base64Data, 'base64');
    }

    const duration = sb.duration || 3;
    console.log(`[FFmpeg] Generating clip with duration: ${duration}, sb.duration: ${sb.duration}, fps: ${fps}`);
    const frames = Math.round(duration * fps);

    // Base scaling to target resolution
    const w = Math.floor(targetWidth / 2) * 2;
    const h = Math.floor(targetHeight / 2) * 2;
    
    // Build filter_complex
    // 1. Scale and Pad to a LARGER size for better zoom quality (2x target)
    const scaleW = w * 2;
    const scaleH = h * 2;
    let filterComplex = `[0:v]scale=${scaleW}:${scaleH}:force_original_aspect_ratio=decrease:flags=lanczos+accurate_rnd,pad=${scaleW}:${scaleH}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv444p[v0]`;

    // 2. Add Animation (Zoompan)
    let panZoom = '';
    
    // Exact range and progress calculation to avoid pauses at start/end
    const rangeX = '(iw-iw/zoom)';
    const rangeY = '(ih-ih/zoom)';
    const progress = `(on-1)/(${frames}-1)`; // Use literal frames instead of 'd' for compatibility
    const centerX = `(${rangeX}/2)`;
    const centerY = `(${rangeY}/2)`;

    // Scale the zoom increment visually according to the framerate so speed matches standard 30fps zoom speed perfectly
    const zoomStep = (0.0015 * (30 / fps)).toFixed(6);

    switch (sb.animation) {
        case 'zoom_in': 
            panZoom = `zoompan=z='min(zoom+${zoomStep},1.5)':x='trunc(iw/2-(iw/zoom/2))':y='trunc(ih/2-(ih/zoom/2))':d=${frames}:s=${w}x${h}:fps=${fps}`; 
            break;
        case 'pan_lr': 
            panZoom = `zoompan=z=1.2:x='trunc(${progress}*${rangeX})':y='trunc(${centerY})':d=${frames}:s=${w}x${h}:fps=${fps}`; 
            break;
        case 'pan_rl': 
            panZoom = `zoompan=z=1.2:x='trunc((1-${progress})*${rangeX})':y='trunc(${centerY})':d=${frames}:s=${w}x${h}:fps=${fps}`; 
            break;
        case 'pan_tb': 
            panZoom = `zoompan=z=1.2:x='trunc(${centerX})':y='trunc(${progress}*${rangeY})':d=${frames}:s=${w}x${h}:fps=${fps}`; 
            break;
        case 'pan_bt': 
            panZoom = `zoompan=z=1.2:x='trunc(${centerX})':y='trunc((1-${progress})*${rangeY})':d=${frames}:s=${w}x${h}:fps=${fps}`; 
            break;
        case 'pan_tl_br': 
            panZoom = `zoompan=z=1.2:x='trunc(${progress}*${rangeX})':y='trunc(${progress}*${rangeY})':d=${frames}:s=${w}x${h}:fps=${fps}`; 
            break;
        case 'pan_br_tl': 
            panZoom = `zoompan=z=1.2:x='trunc((1-${progress})*${rangeX})':y='trunc((1-${progress})*${rangeY})':d=${frames}:s=${w}x${h}:fps=${fps}`; 
            break;
        case 'pan_tr_bl': 
            panZoom = `zoompan=z=1.2:x='trunc((1-${progress})*${rangeX})':y='trunc(${progress}*${rangeY})':d=${frames}:s=${w}x${h}:fps=${fps}`; 
            break;
        case 'pan_bl_tr': 
            panZoom = `zoompan=z=1.2:x='trunc(${progress}*${rangeX})':y='trunc((1-${progress})*${rangeY})':d=${frames}:s=${w}x${h}:fps=${fps}`; 
            break;
        default: 
            panZoom = `zoompan=z=1:d=${frames}:s=${w}x${h}:fps=${fps}`; 
            break;
    }
    // Add setpts and ensure exact frame count to avoid pauses
    filterComplex += `;[v0]${panZoom},setpts=PTS-STARTPTS,trim=duration=${duration},fps=${fps}[v1]`;

    // 3. Text Overlay
    let lastLabel = '[v1]';
    if (sb.text) {
        const fontSize = sb.textSize || 40; 
        const color = sb.textColor || 'white';
        const escapedText = sb.text
            .replace(/\\/g, "\\\\\\\\")
            .replace(/:/g, "\\\\:")
            .replace(/'/g, "'\\\\\\''")
            .replace(/%/g, "\\\\%");
        
        // Font path for Chinese support (Windows & Linux)
        const fontPath = process.platform === 'win32' 
            ? 'C\\:/Windows/Fonts/msyh.ttc' 
            : '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc';

        let textParams = `text='${escapedText}':fontcolor=${color}:fontsize=${fontSize}:x=(w-text_w)/2:y=(h-text_h)/2:fontfile='${fontPath}':borderw=2:bordercolor=black@0.6`;
        
        let estimatedTextWidth = 0;
        for (const char of sb.text) {
            if (/[\u4e00-\u9fa5]/.test(char)) {
                estimatedTextWidth += fontSize;
            } else if (/[a-zA-Z0-9]/.test(char)) {
                estimatedTextWidth += fontSize * 0.55;
            } else {
                estimatedTextWidth += fontSize * 0.4;
            }
        }
        const textW = Math.max(10, Math.round(estimatedTextWidth));

        // Implement effects
        if (sb.textEffect === 'fade') {
            filterComplex += `;${lastLabel}drawtext=${textParams}:alpha='min(1,t/0.5)'[v2]`;
        } else if (sb.textEffect === 'blur') {
            const blurDuration = duration;
            let blurChain = [];
            blurChain.push(`color=c=black@0:s=${w}x${h}:r=${fps}:d=${blurDuration}[canvas_blur]`);
            blurChain.push(`[canvas_blur]drawtext=text='${escapedText}':fontcolor=${color}:fontsize=${fontSize}:fontfile='${fontPath}':x=(w-text_w)/2:y=(h-text_h)/2:borderw=2:bordercolor=black@0.6[text_blur_full]`);
            blurChain.push(`[text_blur_full]split[to_blur][to_sharp]`);
            blurChain.push(`[to_blur]gblur=sigma=12,fade=t=out:st=0:d=1.0:alpha=1[blurred]`);
            blurChain.push(`[to_sharp]fade=t=in:st=0:d=1.0:alpha=1[sharp_faded]`);
            blurChain.push(`${lastLabel}[blurred]overlay=x=0:y=0:shortest=1:format=auto[v_temp_blur]`);
            blurChain.push(`[v_temp_blur][sharp_faded]overlay=x=0:y=0:shortest=1:format=auto[v2]`);
            
            filterComplex += `;${blurChain.join(';')}`;
        } else if (sb.textEffect === 'typewriter') {
            const textStr = sb.text;
            const revealDuration = Math.min(1.5, duration * 0.5);
            const charDuration = revealDuration / Math.max(1, textStr.length);
            
            let typewriterChain = [];
            for (let i = 1; i <= textStr.length; i++) {
                const subStr = textStr.substring(0, i);
                const escapedSubStr = subStr
                    .replace(/\\/g, "\\\\\\\\")
                    .replace(/:/g, "\\\\:")
                    .replace(/'/g, "'\\\\\\''")
                    .replace(/%/g, "\\\\%");
                
                const startTime = (i - 1) * charDuration;
                const endTime = i * charDuration;
                const showCursor = i < textStr.length ? '|' : '';
                const displayText = escapedSubStr + showCursor;
                
                const enableCond = i === textStr.length
                    ? `gte(t,${startTime.toFixed(3)})`
                    : `between(t,${startTime.toFixed(3)},${endTime.toFixed(3)})`;
                
                typewriterChain.push(`drawtext=text='${displayText}':fontcolor=${color}:fontsize=${fontSize}:fontfile='${fontPath}':x=(w-text_w)/2:y=(h-text_h)/2:borderw=2:bordercolor=black@0.6:enable='${enableCond}'`);
            }
            
            filterComplex += `;${lastLabel}${typewriterChain.join(',')}[v2]`;
        } else if (sb.textEffect === 'rotate') {
            const rotDuration = duration;
            let rotChain = [];
            rotChain.push(`color=c=black@0:s=${w}x${h}:r=${fps}:d=${rotDuration}[canvas_rot]`);
            rotChain.push(`[canvas_rot]drawtext=text='${escapedText}':fontcolor=${color}:fontsize=${fontSize}:fontfile='${fontPath}':x=(w-text_w)/2:y=(h-text_h)/2:borderw=2:bordercolor=black@0.6[text_rot]`);
            rotChain.push(`[text_rot]rotate=a='if(lt(t,1.0), (1.0-t)*2*PI, 0)':fillcolor=black@0,fade=t=in:st=0:d=1.0:alpha=1[text_rotated]`);
            rotChain.push(`${lastLabel}[text_rotated]overlay=x=0:y=0:shortest=1:format=auto[v2]`);
            
            filterComplex += `;${rotChain.join(';')}`;
        } else {
            // 无特效
            filterComplex += `;${lastLabel}drawtext=${textParams}[v2]`;
        }
        lastLabel = '[v2]';
    }

    let finalLabel = lastLabel;
    if (videoQualityMode === 'highSharpen') {
        filterComplex += `;${lastLabel}unsharp=luma_msize_x=5:luma_msize_y=5:luma_amount=0.5:chroma_msize_x=5:chroma_msize_y=5:chroma_amount=0.0[v_sharp]`;
        finalLabel = '[v_sharp]';
    }

    if (videoColorProtection === 'bt709') {
        filterComplex += `;${finalLabel}scale=w=iw:h=ih:out_color_matrix=bt709:flags=lanczos+accurate_rnd,format=yuv420p[outv]`;
    } else {
        filterComplex += `;${finalLabel}format=yuv420p[outv]`;
    }

    const args = [
        '-i', imgPath,
        '-filter_complex', filterComplex,
        '-map', '[outv]',
        '-c:v', 'libx264',
        '-preset', videoQualityMode === 'highSharpen' ? 'slow' : 'medium',
        '-crf', crf,
        '-b:v', bitrate,
        '-maxrate', maxRate,
        '-bufsize', bufSize,
        '-t', duration.toString(),
        '-r', fps.toString(),
        '-pix_fmt', 'yuv420p',
    ];

    if (videoColorProtection === 'bt709') {
        args.push('-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709');
    }

    if (videoQualityMode === 'highSharpen') {
        args.push('-tune', 'stillimage', '-profile:v', 'high');
    }

    args.push(
        '-movflags', '+faststart',
        '-y',
        outputPath
    );

    console.log(`[FFmpeg] Executing: ${FFMPEG_PATH} ${args.join(' ')}`);
    
    try {
        await execa(FFMPEG_PATH, args);
    } catch (err: any) {
        console.error(`[FFmpeg] Error generating clip: ${err.stderr || err.message}`);
        throw err;
    }
}

async function concatenateClips(clipPaths: string[], storyboards: any[], outputPath: string, onProgress: (p: number) => void, crf: string = '23', bitrate: string = '8M', maxRate: string = '12M', bufSize: string = '16M', fps: number = 60, videoColorProtection: string = 'bt709', videoQualityMode: string = 'highSharpen'): Promise<number> {
    if (clipPaths.length === 1) {
        fs.copyFileSync(clipPaths[0], outputPath);
        return storyboards[0].duration || 3;
    }

    let filterComplex = '';
    const args = [];
    
    clipPaths.forEach((p, i) => {
        args.push('-i', p);
    });

    let totalDuration = 0;
    let hasTransitions = storyboards.some(sb => sb.transition === 'fade');
    
    console.log(`[FFmpeg] Concatenating clips. Storyboards: ${JSON.stringify(storyboards.map(sb => sb.duration))}, fps: ${fps}`);
    
    // Fallback if xfade is not supported by the current ffmpeg version
    if (hasTransitions && !xfadeSupported) {
        console.log('⚠️ 当前 FFmpeg 版本不支持 xfade，将使用普通拼接');
        hasTransitions = false;
    }
    
    if (!hasTransitions) {
        clipPaths.forEach((_, i) => { filterComplex += `[${i}:v]settb=AVTB,setpts=PTS-STARTPTS[v${i}];`; });
        clipPaths.forEach((_, i) => { filterComplex += `[v${i}]`; });
        filterComplex += `concat=n=${clipPaths.length}:v=1:a=0`;
        if (videoColorProtection === 'bt709') {
            filterComplex += `,scale=w=iw:h=ih:out_color_matrix=bt709:flags=lanczos+accurate_rnd,format=yuv420p[outv]`;
        } else {
            filterComplex += `,format=yuv420p[outv]`;
        }
        totalDuration = storyboards.reduce((acc, sb) => acc + (sb.duration || 3), 0);
    } else {
        clipPaths.forEach((_, i) => { filterComplex += `[${i}:v]settb=AVTB,setpts=PTS-STARTPTS[v${i}];`; });
        
        let currentStream = '[v0]';
        let offset = storyboards[0].duration || 3;
        totalDuration = offset;
        
        for (let i = 1; i < clipPaths.length; i++) {
            const transition = storyboards[i-1].transition === 'fade' ? 'fade' : 'dissolve';
            const transitionDuration = storyboards[i-1].transition === 'fade' ? 0.5 : 0.1; // Fixed transition duration
            const nextStream = `[v${i}]`;
            const outStream = `[xf${i}]`;
            
            // Offset is the start time of the transition.
            // We want the transition to occur at the end of the previous storyboard.
            // Previous storyboard duration is storyboards[i-1].duration
            const previousStoryboardDuration = storyboards[i-1].duration || 3;
            const offset = totalDuration - transitionDuration;
            
            filterComplex += `${currentStream}${nextStream}xfade=transition=${transition}:duration=${transitionDuration}:offset=${offset}${outStream};`;
            currentStream = outStream;
            
            const currentStoryboardDuration = storyboards[i].duration || 3;
            totalDuration += currentStoryboardDuration - transitionDuration;
        }
        if (videoColorProtection === 'bt709') {
            filterComplex += `${currentStream}scale=w=iw:h=ih:out_color_matrix=bt709:flags=lanczos+accurate_rnd,format=yuv420p[outv]`;
        } else {
            filterComplex += `${currentStream}format=yuv420p[outv]`;
        }
    }

    args.push('-filter_complex', filterComplex);
    args.push('-map', '[outv]');
    args.push('-c:v', 'libx264');
    args.push('-preset', videoQualityMode === 'highSharpen' ? 'slow' : 'medium');
    args.push('-crf', crf);
    args.push('-b:v', bitrate);
    args.push('-maxrate', maxRate);
    args.push('-bufsize', bufSize);
    args.push('-pix_fmt', 'yuv420p');
    args.push('-r', fps.toString());
    
    if (videoColorProtection === 'bt709') {
        args.push('-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709');
    }

    if (videoQualityMode === 'highSharpen') {
        args.push('-tune', 'stillimage', '-profile:v', 'high');
    }

    args.push(
        '-movflags', '+faststart',
        '-y',
        outputPath
    );

    console.log(`[FFmpeg] Executing Concat: ${FFMPEG_PATH} ${args.join(' ')}`);

    try {
        await execa(FFMPEG_PATH, args);
        return totalDuration;
    } catch (err: any) {
        console.error(`[FFmpeg] Error concatenating clips: ${err.stderr || err.message}`);
        throw err;
    }
}

async function addBgmAndFinalize(videoPath: string, totalDuration: number, bgm: string, intro: string, outro: string, outputPath: string, onProgress: (p: number) => void, crf: string = '23', bitrate: string = '8M', maxRate: string = '12M', bufSize: string = '16M', fps: number = 60, videoColorProtection: string = 'bt709', videoQualityMode: string = 'highSharpen'): Promise<void> {
    const args = ['-i', videoPath];
    
    let filters = [];
    if (intro === 'fade_in') {
        filters.push('fade=t=in:st=0:d=1');
    }
    if (outro === 'fade_out') {
        filters.push(`fade=t=out:st=${Math.max(0, totalDuration - 1)}:d=1`);
    }
    
    let filterComplex = '[0:v]';
    if (filters.length > 0) {
        filterComplex += filters.join(',');
    }
    
    if (videoColorProtection === 'bt709') {
        filterComplex += ',scale=w=iw:h=ih:out_color_matrix=bt709:flags=lanczos+accurate_rnd,format=yuv420p[v]';
    } else {
        filterComplex += ',format=yuv420p[v]';
    }

    const bgmPath = bgm ? path.join(bgmDir, bgm) : null;
    const hasBgm = bgmPath && fs.existsSync(bgmPath);

    if (hasBgm) {
        args.push('-i', bgmPath);
        args.push('-filter_complex', filterComplex);
        args.push('-map', '[v]', '-map', '1:a');
        args.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
    } else {
        args.push('-filter_complex', filterComplex);
        args.push('-map', '[v]');
    }

    args.push(
        '-c:v', 'libx264',
        '-preset', videoQualityMode === 'highSharpen' ? 'slow' : 'medium',
        '-crf', crf,
        '-b:v', bitrate,
        '-maxrate', maxRate,
        '-bufsize', bufSize,
        '-pix_fmt', 'yuv420p',
        '-r', fps.toString(),
    );

    if (videoColorProtection === 'bt709') {
        args.push('-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709');
    }

    if (videoQualityMode === 'highSharpen') {
        args.push('-tune', 'stillimage', '-profile:v', 'high');
    }

    args.push(
        '-movflags', '+faststart',
        '-y',
        outputPath
    );

    console.log(`[FFmpeg] Executing Finalize: ${FFMPEG_PATH} ${args.join(' ')}`);

    try {
        await execa(FFMPEG_PATH, args);
    } catch (err: any) {
        console.error(`[FFmpeg] Error finalizing video: ${err.stderr || err.message}`);
        throw err;
    }
}

async function generateThumbnail(videoPath: string, thumbPath: string): Promise<void> {
    try {
        const args = [
            '-ss', '00:00:01.000',
            '-i', videoPath,
            '-vframes', '1',
            '-q:v', '2', // High quality jpeg
            '-y',
            thumbPath
        ];
        console.log(`[FFmpeg] Generating Thumbnail: ${FFMPEG_PATH} ${args.join(' ')}`);
        await execa(FFMPEG_PATH, args);
    } catch (err: any) {
        console.error('❌ Thumbnail error:', err.stderr || err.message);
        // Don't throw, let the job complete even if thumbnail fails
    }
}
