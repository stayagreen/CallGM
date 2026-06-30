process.env.TZ = 'Asia/Shanghai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import sharp from 'sharp';
import { execa } from 'execa';
import db from './src/db/db.js';

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

async function processVideoTask(filePath: string, jobKey: string) {
    const filename = path.basename(filePath);
    const jobId = filename.replace('.json', '');
    const taskData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const { storyboards, bgm, introAnimation, outroAnimation, userId } = taskData;
    
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
            // 毛玻璃淡入: 双图层交叉淡入模糊
            filterComplex += `;color=c=black@0:s=${w}x${h}[txt_canvas_blur];`;
            filterComplex += `[txt_canvas_blur]drawtext=text='${escapedText}':fontcolor=${color}:fontsize=${fontSize}:fontfile='${fontPath}':x=(w-text_w)/2:y=(h-text_h)/2:borderw=2:bordercolor=black@0.6[txt_full_blur];`;
            filterComplex += `[txt_full_blur]split[txt_to_blur][txt_sharp];`;
            filterComplex += `[txt_to_blur]boxblur=15,fade=t=out:st=0:d=1.0:alpha=1[txt_blurred];`;
            filterComplex += `[txt_sharp]fade=t=in:st=0:d=1.0:alpha=1[txt_sharp_faded];`;
            filterComplex += `;${lastLabel}[txt_blurred]overlay=x=0:y=0:format=auto[v_temp_blur];`;
            filterComplex += `[v_temp_blur][txt_sharp_faded]overlay=x=0:y=0:format=auto[v2]`;
        } else if (sb.textEffect === 'typewriter') {
            // 打字机
            const revealSpeed = 10; // chars per second
            const revealDuration = Math.min(duration, sb.text.length / revealSpeed);
            
            filterComplex += `;color=c=black@0:s=${w}x${h}[txt_canvas];`;
            filterComplex += `[txt_canvas]drawtext=text='${escapedText}':fontcolor=${color}:fontsize=${fontSize}:fontfile='${fontPath}':x=(w-text_w)/2:y=(h-text_h)/2:borderw=2:bordercolor=black@0.6[txt_full];`;
            filterComplex += `[txt_full]crop=w='max(1, (${w}-${textW})/2 + ${textW}*min(1, t/${revealDuration}))':h=ih:x=0:y=0[txt_reveal];`;
            filterComplex += `;${lastLabel}[txt_reveal]overlay=x=0:y=0:format=auto[v_with_text];`;
            filterComplex += `[v_with_text]drawtext=text='|':fontcolor=${color}:fontsize=${fontSize}:fontfile='${fontPath}':x='(${w}-${textW})/2 + ${textW}*min(1, t/${revealDuration})':y='(h-text_h)/2':alpha='if(lt(t, ${revealDuration}), 1, if(lt(mod(t,0.5),0.25),1,0))'[v2]`;
        } else if (sb.textEffect === 'rotate') {
            // 文字旋转进入
            filterComplex += `;color=c=black@0:s=${w}x${h}[txt_canvas_rot];`;
            filterComplex += `[txt_canvas_rot]drawtext=text='${escapedText}':fontcolor=${color}:fontsize=${fontSize}:fontfile='${fontPath}':x=(w-text_w)/2:y=(h-text_h)/2:borderw=2:bordercolor=black@0.6[txt_full_rot];`;
            filterComplex += `[txt_full_rot]rotate=a='if(lt(t,1), (1-t)*2*PI, 0)':c=black@0,fade=t=in:st=0:d=1.0:alpha=1[txt_rotated];`;
            filterComplex += `;${lastLabel}[txt_rotated]overlay=x=0:y=0:format=auto[v2]`;
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
