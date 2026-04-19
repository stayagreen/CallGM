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
                const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && fs.statSync(path.join(dir, f)).isFile());
                files.forEach(f => {
                    taskFiles.push({ path: path.join(dir, f), filename: f });
                });
            }
            
            for (const { path: filePath, filename } of taskFiles) {
                if (activeVideoJobs >= maxConcurrency) break;
                
                // Check if already processing
                const relKey = path.relative(videoTaskDir, filePath).replace(/\\/g, '/');
                if (videoJobProgress.has(relKey) && videoJobProgress.get(relKey)?.status === 'running') continue;

                activeVideoJobs++;
                videoJobProgress.set(relKey, { progress: 0, status: 'running' });
                
                // Process async without blocking the loop
                processVideoTask(filePath, relKey).catch(err => {
                    console.error(`❌ 视频任务 ${filename} 失败:`, err);
                    videoJobProgress.set(relKey, { progress: 0, status: 'error', error: err.message });
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

                        fs.writeFileSync(path.join(targetHistoryDir, filename), JSON.stringify(taskData, null, 2));
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

    // Determine target resolution based on first image (1080p default)
    let targetWidth = 1920;
    let targetHeight = 1080;

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
                if (firstImgPath.startsWith('/uploads/')) {
                    localPath = path.join(__dirname, 'uploads', firstImgPath.replace('/uploads/', ''));
                } else if (firstImgPath.startsWith('/downloads/')) {
                    localPath = path.join(__dirname, 'download', firstImgPath.replace('/downloads/', ''));
                }
                metadata = await sharp(localPath).metadata();
            }
            
            if (metadata.width && metadata.height) {
                const aspect = metadata.width / metadata.height;
                if (metadata.width >= metadata.height) {
                    targetHeight = 1080;
                    targetWidth = Math.round((1080 * aspect) / 2) * 2; // Ensure even number
                } else {
                    targetWidth = 1080;
                    targetHeight = Math.round((1080 / aspect) / 2) * 2; // Ensure even number
                }
            }
        } catch (e) {
            console.error('Failed to get image metadata for resolution', e);
        }
    }

    // 1. Generate individual clips
    const clipPaths: string[] = [];
    for (let i = 0; i < storyboards.length; i++) {
        const sb = storyboards[i];
        const clipPath = path.join(videoTaskDir, `temp_${filename}_clip_${i}.mp4`);
        await generateClip(sb, clipPath, targetWidth, targetHeight);
        clipPaths.push(clipPath);
        videoJobProgress.set(jobKey, { progress: Math.floor((i / storyboards.length) * 40), status: 'running' });
    }

    // 2. Concatenate clips with transitions
    const concatPath = path.join(videoTaskDir, `temp_${filename}_concat.mp4`);
    let finalDuration = 0;
    await concatenateClips(clipPaths, storyboards, concatPath, (p) => {
        videoJobProgress.set(jobKey, { progress: 40 + Math.floor(p * 0.4), status: 'running' });
    }).then(duration => {
        finalDuration = duration;
    });

    // 3. Add BGM and Intro/Outro
    await addBgmAndFinalize(concatPath, finalDuration, bgm, introAnimation, outroAnimation, outputPath, (p) => {
        videoJobProgress.set(jobKey, { progress: 80 + Math.floor(p * 0.2), status: 'running' });
    });

    // 4. Generate Thumbnail
    await generateThumbnail(outputPath, thumbPath);

    // Cleanup temp files
    clipPaths.forEach(p => { if (fs.existsSync(p)) fs.unlinkSync(p); });
    if (fs.existsSync(concatPath)) fs.unlinkSync(concatPath);

    // Move task to history
    taskData.outputVideo = outputFilename;
    fs.writeFileSync(filePath, JSON.stringify(taskData, null, 2));
    
    // 确定正确的 history 目录
    const fileDir = path.dirname(filePath);
    const relativeSubDir = path.relative(videoTaskDir, fileDir);
    const targetHistoryDir = path.join(videoHistoryDir, relativeSubDir);
    if (!fs.existsSync(targetHistoryDir)) fs.mkdirSync(targetHistoryDir, { recursive: true });

    fs.renameSync(filePath, path.join(targetHistoryDir, filename));
    
    // Update DB: Final Status, Data and Asset registration
    const relativeAssetPath = userId ? `${userId}/${outputFilename}` : outputFilename;
    try {
        db.prepare('UPDATE tasks SET status = ?, progress = 100, data = ?, result_files = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
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
    } catch(e) {}

    videoJobProgress.set(jobKey, { progress: 100, status: 'completed' });
    
    // Cleanup progress map after delay
    setTimeout(() => {
        videoJobProgress.delete(jobKey);
        videoJobProgress.delete(filename); // compat
    }, 3000);

    console.log(`✅ 视频渲染完成: ${outputFilename} (User: ${userId || 'global'})`);
}

async function generateClip(sb: any, outputPath: string, targetWidth: number, targetHeight: number): Promise<void> {
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
    console.log(`[FFmpeg] Generating clip with duration: ${duration}, sb.duration: ${sb.duration}`);
    const fps = 30;
    const frames = Math.round(duration * fps);

    // Base scaling to target resolution
    const w = Math.floor(targetWidth / 2) * 2;
    const h = Math.floor(targetHeight / 2) * 2;
    
    // Build filter_complex
    // 1. Scale and Pad to a LARGER size for better zoom quality (2x target)
    const scaleW = w * 2;
    const scaleH = h * 2;
    let filterComplex = `[0:v]scale=${scaleW}:${scaleH}:force_original_aspect_ratio=decrease,pad=${scaleW}:${scaleH}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv444p[v0]`;

    // 2. Add Animation (Zoompan)
    let panZoom = '';
    
    // Exact range and progress calculation to avoid pauses at start/end
    const rangeX = '(iw-iw/zoom)';
    const rangeY = '(ih-ih/zoom)';
    const progress = `(on-1)/(${frames}-1)`; // Use literal frames instead of 'd' for compatibility
    const centerX = `(${rangeX}/2)`;
    const centerY = `(${rangeY}/2)`;

    switch (sb.animation) {
        case 'zoom_in': 
            panZoom = `zoompan=z='min(zoom+0.0015,1.5)':x='trunc(iw/2-(iw/zoom/2))':y='trunc(ih/2-(ih/zoom/2))':d=${frames}:s=${w}x${h}:fps=30`; 
            break;
        case 'pan_lr': 
            panZoom = `zoompan=z=1.2:x='trunc(${progress}*${rangeX})':y='trunc(${centerY})':d=${frames}:s=${w}x${h}:fps=30`; 
            break;
        case 'pan_rl': 
            panZoom = `zoompan=z=1.2:x='trunc((1-${progress})*${rangeX})':y='trunc(${centerY})':d=${frames}:s=${w}x${h}:fps=30`; 
            break;
        case 'pan_tb': 
            panZoom = `zoompan=z=1.2:x='trunc(${centerX})':y='trunc(${progress}*${rangeY})':d=${frames}:s=${w}x${h}:fps=30`; 
            break;
        case 'pan_bt': 
            panZoom = `zoompan=z=1.2:x='trunc(${centerX})':y='trunc((1-${progress})*${rangeY})':d=${frames}:s=${w}x${h}:fps=30`; 
            break;
        case 'pan_tl_br': 
            panZoom = `zoompan=z=1.2:x='trunc(${progress}*${rangeX})':y='trunc(${progress}*${rangeY})':d=${frames}:s=${w}x${h}:fps=30`; 
            break;
        case 'pan_br_tl': 
            panZoom = `zoompan=z=1.2:x='trunc((1-${progress})*${rangeX})':y='trunc((1-${progress})*${rangeY})':d=${frames}:s=${w}x${h}:fps=30`; 
            break;
        case 'pan_tr_bl': 
            panZoom = `zoompan=z=1.2:x='trunc((1-${progress})*${rangeX})':y='trunc(${progress}*${rangeY})':d=${frames}:s=${w}x${h}:fps=30`; 
            break;
        case 'pan_bl_tr': 
            panZoom = `zoompan=z=1.2:x='trunc(${progress}*${rangeX})':y='trunc((1-${progress})*${rangeY})':d=${frames}:s=${w}x${h}:fps=30`; 
            break;
        default: 
            panZoom = `zoompan=z=1:d=${frames}:s=${w}x${h}:fps=30`; 
            break;
    }
    // Add setpts and ensure exact frame count to avoid pauses
    filterComplex += `;[v0]${panZoom},setpts=PTS-STARTPTS,trim=duration=${duration},fps=30[v1]`;

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

        let textParams = `text='${escapedText}':fontcolor=${color}:fontsize=${fontSize}:x=(w-text_w)/2:y=(h-text_h)/2:fontfile='${fontPath}'`;
        
        // Implement effects
        if (sb.textEffect === 'fade') {
            textParams += `:alpha='min(t/1,1)'`; // 1s fade in
            filterComplex += `;${lastLabel}drawtext=${textParams}[v2]`;
        } else if (sb.textEffect === 'blur') {
            // 毛玻璃淡入: 使用固定模糊半径并淡出
            filterComplex += `;${lastLabel}split[v_pre_blur][v_blur_layer];[v_blur_layer]boxblur=20,fade=t=out:st=0:d=0.8:alpha=1[v_blurred];[v_pre_blur][v_blurred]overlay=format=auto[v_overlayed]`;
            // 重新应用文字绘制到 v_overlayed 的输出，并最终命名为 [v2]
            filterComplex += `;[v_overlayed]drawtext=${textParams}:alpha='min(t/0.8,1)'[v2]`;
        } else if (sb.textEffect === 'typewriter') {
            // 打字机
            const revealSpeed = 10; // chars per second
            const revealDuration = Math.min(duration, sb.text.length / revealSpeed);
            const textX = '(w-text_w)/2';
            const textY = '(h-text_h)/2';
            
            filterComplex += `;color=c=black@0:s=${w}x${h}[txt_canvas];`;
            filterComplex += `[txt_canvas]drawtext=${textParams}:text='${escapedText}':x=${textX}:y=${textY}[txt_full];`;
            filterComplex += `[txt_full]drawtext=text='|':x=${textX}+text_w:y=${textY}:fontfile='${fontPath}':fontsize=${fontSize}:fontcolor=${color}:alpha='if(lt(mod(t,0.5),0.25),1,0)'[txt_full_cursor];`;
            filterComplex += `[txt_full_cursor]crop=w='iw*min(1, t/${revealDuration})':h=ih:x=0:y=0[txt_reveal];`;
            filterComplex += `;${lastLabel}[txt_reveal]overlay=x=0:y=0:format=auto[v2]`;
        } else if (sb.textEffect === 'rotate') {
            // 文字转圈
            textParams += `:rotation='t*360/2'`;
            filterComplex += `;${lastLabel}drawtext=${textParams}[v2]`;
        } else {
            // 无特效
            filterComplex += `;${lastLabel}drawtext=${textParams}[v2]`;
        }
        lastLabel = '[v2]';
    }

    filterComplex += `;${lastLabel}format=yuv420p[outv]`;

    const args = [
        '-i', imgPath,
        '-filter_complex', filterComplex,
        '-map', '[outv]',
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '23',
        '-t', duration.toString(),
        '-r', '30',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        '-y',
        outputPath
    ];

    console.log(`[FFmpeg] Executing: ${FFMPEG_PATH} ${args.join(' ')}`);
    
    try {
        await execa(FFMPEG_PATH, args);
    } catch (err: any) {
        console.error(`[FFmpeg] Error generating clip: ${err.stderr || err.message}`);
        throw err;
    }
}

async function concatenateClips(clipPaths: string[], storyboards: any[], outputPath: string, onProgress: (p: number) => void): Promise<number> {
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
    
    console.log(`[FFmpeg] Concatenating clips. Storyboards: ${JSON.stringify(storyboards.map(sb => sb.duration))}`);
    
    // Fallback if xfade is not supported by the current ffmpeg version
    if (hasTransitions && !xfadeSupported) {
        console.log('⚠️ 当前 FFmpeg 版本不支持 xfade，将使用普通拼接');
        hasTransitions = false;
    }
    
    if (!hasTransitions) {
        clipPaths.forEach((_, i) => { filterComplex += `[${i}:v]settb=AVTB,setpts=PTS-STARTPTS[v${i}];`; });
        clipPaths.forEach((_, i) => { filterComplex += `[v${i}]`; });
        filterComplex += `concat=n=${clipPaths.length}:v=1:a=0,format=yuv420p[outv]`;
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
        filterComplex += `${currentStream}format=yuv420p[outv]`;
    }

    args.push('-filter_complex', filterComplex);
    args.push('-map', '[outv]');
    args.push('-c:v', 'libx264');
    args.push('-preset', 'medium');
    args.push('-crf', '23');
    args.push('-pix_fmt', 'yuv420p');
    args.push('-movflags', '+faststart');
    args.push('-y');
    args.push(outputPath);

    console.log(`[FFmpeg] Executing Concat: ${FFMPEG_PATH} ${args.join(' ')}`);

    try {
        await execa(FFMPEG_PATH, args);
        return totalDuration;
    } catch (err: any) {
        console.error(`[FFmpeg] Error concatenating clips: ${err.stderr || err.message}`);
        throw err;
    }
}

async function addBgmAndFinalize(videoPath: string, totalDuration: number, bgm: string, intro: string, outro: string, outputPath: string, onProgress: (p: number) => void): Promise<void> {
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
        filterComplex += filters.join(',') + ',format=yuv420p[v]';
    } else {
        filterComplex += 'format=yuv420p[v]';
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
        '-preset', 'medium',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
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

function generateThumbnail(videoPath: string, thumbPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        ffmpeg(videoPath)
            .screenshots({
                timestamps: ['00:00:01.000'],
                filename: path.basename(thumbPath),
                folder: path.dirname(thumbPath),
                size: '320x240'
            })
            .on('end', () => resolve())
            .on('error', (err) => {
                console.error('Thumbnail error:', err);
                resolve(); // Don't fail the whole job
            });
    });
}
