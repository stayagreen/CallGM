import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import sharp from 'sharp';
import { execa } from 'execa';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
const FFMPEG_PATH = ffmpegInstaller.path;

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
            const files = fs.readdirSync(videoTaskDir).filter(f => f.endsWith('.json') && fs.statSync(path.join(videoTaskDir, f)).isFile());
            
            for (const file of files) {
                if (activeVideoJobs >= maxConcurrency) break;
                
                const filePath = path.join(videoTaskDir, file);
                // Check if already processing
                if (videoJobProgress.has(file) && videoJobProgress.get(file)?.status === 'running') continue;

                activeVideoJobs++;
                videoJobProgress.set(file, { progress: 0, status: 'running' });
                
                // Process async without blocking the loop
                processVideoTask(filePath, file).catch(err => {
                    console.error(`❌ 视频任务 ${file} 失败:`, err);
                    videoJobProgress.set(file, { progress: 0, status: 'error', error: err.message });
                    // Move to history even on error to keep record
                    try {
                        const taskData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                        taskData.status = 'error';
                        taskData.error = err.message;
                        fs.writeFileSync(path.join(videoHistoryDir, file), JSON.stringify(taskData, null, 2));
                        fs.unlinkSync(filePath);
                    } catch (e) {
                        console.error('Failed to move error task to history', e);
                        try { fs.renameSync(filePath, filePath + '.error'); } catch (e2) {}
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

async function processVideoTask(filePath: string, filename: string) {
    const taskData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const { storyboards, bgm, introAnimation, outroAnimation } = taskData;
    
    const outputFilename = `video_${Date.now()}.mp4`;
    const outputPath = path.join(videoDownloadDir, outputFilename);
    const thumbPath = path.join(videoThumbDir, outputFilename.replace('.mp4', '.jpg'));

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
                if (firstImgPath.startsWith('/uploads/')) firstImgPath = path.join(__dirname, 'uploads', firstImgPath.replace('/uploads/', ''));
                else if (firstImgPath.startsWith('/downloads/')) firstImgPath = path.join(__dirname, 'download', firstImgPath.replace('/downloads/', ''));
                metadata = await sharp(firstImgPath).metadata();
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
        videoJobProgress.set(filename, { progress: Math.floor((i / storyboards.length) * 40), status: 'running' });
    }

    // 2. Concatenate clips with transitions
    const concatPath = path.join(videoTaskDir, `temp_${filename}_concat.mp4`);
    let finalDuration = 0;
    await concatenateClips(clipPaths, storyboards, concatPath, (p) => {
        videoJobProgress.set(filename, { progress: 40 + Math.floor(p * 0.4), status: 'running' });
    }).then(duration => {
        finalDuration = duration;
    });

    // 3. Add BGM and Intro/Outro
    await addBgmAndFinalize(concatPath, finalDuration, bgm, introAnimation, outroAnimation, outputPath, (p) => {
        videoJobProgress.set(filename, { progress: 80 + Math.floor(p * 0.2), status: 'running' });
    });

    // 4. Generate Thumbnail
    await generateThumbnail(outputPath, thumbPath);

    // Cleanup temp files
    clipPaths.forEach(p => { if (fs.existsSync(p)) fs.unlinkSync(p); });
    if (fs.existsSync(concatPath)) fs.unlinkSync(concatPath);

    // Move task to history
    taskData.outputVideo = outputFilename;
    fs.writeFileSync(filePath, JSON.stringify(taskData, null, 2));
    fs.renameSync(filePath, path.join(videoHistoryDir, filename));
    
    videoJobProgress.set(filename, { progress: 100, status: 'completed' });
    console.log(`✅ 视频渲染完成: ${outputFilename}`);
}

async function generateClip(sb: any, outputPath: string, targetWidth: number, targetHeight: number): Promise<void> {
    // Resolve image path
    let imgPath = sb.image;
    if (imgPath.startsWith('/uploads/')) imgPath = path.join(__dirname, 'uploads', imgPath.replace('/uploads/', ''));
    else if (imgPath.startsWith('/downloads/')) imgPath = path.join(__dirname, 'download', imgPath.replace('/downloads/', ''));
    else if (imgPath.startsWith('data:image')) {
        // Base64
        const base64Data = imgPath.replace(/^data:image\/\w+;base64,/, "");
        imgPath = path.join(videoTaskDir, `temp_img_${Date.now()}.png`);
        fs.writeFileSync(imgPath, base64Data, 'base64');
    }

    const duration = sb.duration || 3;
    const fps = 30;
    const frames = Math.round(duration * fps);

    // Base scaling to target resolution
    const w = Math.floor(targetWidth / 2) * 2;
    const h = Math.floor(targetHeight / 2) * 2;
    
    // Build filter_complex
    // 1. Scale and Pad to target size
    let filterComplex = `[0:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv444p[v0]`;

    // 2. Add Animation (Zoompan)
    let panZoom = '';
    switch (sb.animation) {
        case 'zoom_in': panZoom = `zoompan=z='min(zoom+0.0015,1.5)':x='trunc(iw/2-(iw/zoom/2))':y='trunc(ih/2-(ih/zoom/2))':d=${frames}:s=${w}x${h}:fps=30`; break;
        case 'pan_lr': panZoom = `zoompan=z=1.2:x='trunc(min(max(0, (on/${frames})*(iw*0.2)), iw-iw/zoom))':y='trunc(ih*0.1)':d=${frames}:s=${w}x${h}:fps=30`; break;
        case 'pan_rl': panZoom = `zoompan=z=1.2:x='trunc(min(max(0, iw*0.2 - (on/${frames})*(iw*0.2)), iw-iw/zoom))':y='trunc(ih*0.1)':d=${frames}:s=${w}x${h}:fps=30`; break;
        case 'pan_tb': panZoom = `zoompan=z=1.2:x='trunc(iw*0.1)':y='trunc(min(max(0, (on/${frames})*(ih*0.2)), ih-ih/zoom))':d=${frames}:s=${w}x${h}:fps=30`; break;
        case 'pan_bt': panZoom = `zoompan=z=1.2:x='trunc(iw*0.1)':y='trunc(min(max(0, ih*0.2 - (on/${frames})*(ih*0.2)), ih-ih/zoom))':d=${frames}:s=${w}x${h}:fps=30`; break;
        case 'pan_tl_br': panZoom = `zoompan=z=1.2:x='trunc(min(max(0, (on/${frames})*(iw*0.2)), iw-iw/zoom))':y='trunc(min(max(0, (on/${frames})*(ih*0.2)), ih-ih/zoom))':d=${frames}:s=${w}x${h}:fps=30`; break;
        case 'pan_br_tl': panZoom = `zoompan=z=1.2:x='trunc(min(max(0, iw*0.2 - (on/${frames})*(iw*0.2)), iw-iw/zoom))':y='trunc(min(max(0, iw*0.2 - (on/${frames})*(iw*0.2)), iw-iw/zoom))':d=${frames}:s=${w}x${h}:fps=30`; break;
        case 'pan_tr_bl': panZoom = `zoompan=z=1.2:x='trunc(min(max(0, iw*0.2 - (on/${frames})*(iw*0.2)), iw-iw/zoom))':y='trunc(min(max(0, (on/${frames})*(ih*0.2)), ih-ih/zoom))':d=${frames}:s=${w}x${h}:fps=30`; break;
        case 'pan_bl_tr': panZoom = `zoompan=z=1.2:x='trunc(min(max(0, (on/${frames})*(iw*0.2)), iw-iw/zoom))':y='trunc(min(max(0, ih*0.2 - (on/${frames})*(ih*0.2)), ih-ih/zoom))':d=${frames}:s=${w}x${h}:fps=30`; break;
        default: panZoom = `zoompan=z=1:d=${frames}:s=${w}x${h}:fps=30`; break;
    }
    filterComplex += `;[v0]${panZoom},scale=${w}:${h}[v1]`;

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
        
        let textAlpha = '1';
        if (sb.textEffect === 'fade') textAlpha = `if(lt(t,1),t,1)`;
        
        filterComplex += `;${lastLabel}drawtext=text='${escapedText}':fontcolor=${color}:fontsize=${fontSize}:x=(w-text_w)/2:y=(h-text_h)/2:alpha='${textAlpha}'[v2]`;
        lastLabel = '[v2]';
    }

    filterComplex += `;${lastLabel}format=yuv420p[outv]`;

    const args = [
        '-loop', '1',
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
            const duration = storyboards[i-1].transition === 'fade' ? 1 : 0.1;
            const nextStream = `[v${i}]`;
            const outStream = `[xf${i}]`;
            
            const safeOffset = Math.max(0.1, offset - duration);
            filterComplex += `${currentStream}${nextStream}xfade=transition=${transition}:duration=${duration}:offset=${safeOffset}${outStream};`;
            currentStream = outStream;
            const sbDuration = storyboards[i].duration || 3;
            offset += sbDuration - duration;
            totalDuration += sbDuration - duration;
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

function addBgmAndFinalize(videoPath: string, totalDuration: number, bgm: string, intro: string, outro: string, outputPath: string, onProgress: (p: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
        let cmd = ffmpeg(videoPath);
        
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

        if (bgm) {
            const bgmPath = path.join(bgmDir, bgm);
            if (fs.existsSync(bgmPath)) {
                cmd = cmd.input(bgmPath);
                // Shorten audio to video length and fade out
                cmd.outputOptions([
                    '-map [v]',
                    '-map 1:a',
                    '-c:v libx264',
                    '-profile:v main',
                    '-level 3.1',
                    '-pix_fmt yuv420p',
                    '-c:a aac',
                    '-b:a 192k',
                    '-movflags +faststart',
                    '-shortest'
                ]);
            } else {
                cmd.outputOptions([
                    '-map [v]', 
                    '-c:v libx264',
                    '-profile:v main',
                    '-level 3.1',
                    '-pix_fmt yuv420p',
                    '-movflags +faststart'
                ]);
            }
        } else {
            cmd.outputOptions([
                '-map [v]', 
                '-c:v libx264',
                '-profile:v main',
                '-level 3.1',
                '-pix_fmt yuv420p',
                '-movflags +faststart'
            ]);
        }

        cmd.complexFilter(filterComplex, 'v')
            .save(outputPath)
            .on('progress', (p) => onProgress(p.percent || 0))
            .on('end', () => resolve())
            .on('error', reject);
    });
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
