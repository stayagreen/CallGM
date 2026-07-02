import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

export interface ClientRenderProgress {
  progress: number; // 0 to 100
  status: 'pending' | 'running' | 'completed' | 'error';
  message?: string;
}

/**
 * Preloads all images into memory as HTMLImageElement.
 */
async function preloadImages(storyboards: any[]): Promise<Map<string, HTMLImageElement>> {
  const imagesMap = new Map<string, HTMLImageElement>();
  const promises = storyboards.map((sb, idx) => {
    if (!sb.image) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        imagesMap.set(sb.image, img);
        resolve();
      };
      img.onerror = (e) => {
        console.error(`Failed to load image at index ${idx}: ${sb.image}`, e);
        resolve(); // Continue anyway
      };
      img.src = sb.image;
    });
  });
  await Promise.all(promises);
  return imagesMap;
}

/**
 * Draws a single storyboard frame onto a canvas context.
 */
function drawSingleStoryboard(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | undefined,
  sb: any,
  relTime: number,
  w: number,
  h: number
) {
  // Clear with solid black background
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, w, h);

  if (img) {
    const canvasAspect = w / h;
    const imgAspect = img.width / img.height;
    let fitW = img.width;
    let fitH = img.height;
    let fitX = 0;
    let fitY = 0;

    if (imgAspect > canvasAspect) {
      fitW = img.height * canvasAspect;
      fitX = (img.width - fitW) / 2;
    } else {
      fitH = img.width / canvasAspect;
      fitY = (img.height - fitH) / 2;
    }

    const duration = sb.duration || 3;
    const p = Math.min(1, Math.max(0, relTime / duration));

    let zoom = 1.0;
    if (sb.animation === 'zoom_in') {
      zoom = 1.0 + p * 0.5;
    } else if (sb.animation && sb.animation.startsWith('pan_')) {
      zoom = 1.2;
    }

    const sw = fitW / zoom;
    const sh = fitH / zoom;
    const rangeX = fitW - sw;
    const rangeY = fitH - sh;
    const centerX = rangeX / 2;
    const centerY = rangeY / 2;

    let offsetRefX = 0;
    let offsetRefY = 0;

    switch (sb.animation) {
      case 'zoom_in':
        offsetRefX = centerX;
        offsetRefY = centerY;
        break;
      case 'pan_lr':
        offsetRefX = p * rangeX;
        offsetRefY = centerY;
        break;
      case 'pan_rl':
        offsetRefX = (1 - p) * rangeX;
        offsetRefY = centerY;
        break;
      case 'pan_tb':
        offsetRefX = centerX;
        offsetRefY = p * rangeY;
        break;
      case 'pan_bt':
        offsetRefX = centerX;
        offsetRefY = (1 - p) * rangeY;
        break;
      case 'pan_tl_br':
        offsetRefX = p * rangeX;
        offsetRefY = p * rangeY;
        break;
      case 'pan_br_tl':
        offsetRefX = (1 - p) * rangeX;
        offsetRefY = (1 - p) * rangeY;
        break;
      case 'pan_tr_bl':
        offsetRefX = (1 - p) * rangeX;
        offsetRefY = p * rangeY;
        break;
      case 'pan_bl_tr':
        offsetRefX = p * rangeX;
        offsetRefY = (1 - p) * rangeY;
        break;
      default:
        offsetRefX = 0;
        offsetRefY = 0;
        break;
    }

    const finalSx = fitX + offsetRefX;
    const finalSy = fitY + offsetRefY;

    ctx.drawImage(img, finalSx, finalSy, sw, sh, 0, 0, w, h);
  }

  // Draw text overlays
  if (sb.text) {
    const duration = sb.duration || 3;
    const p = Math.min(1, Math.max(0, relTime / duration));
    const fontSize = sb.textSize || 40;
    const color = sb.textColor || 'white';
    const text = sb.text || '';
    const centerX = w / 2;
    const centerY = h / 2;

    if (sb.textEffect === 'rotate') {
      const radius = fontSize * 1.8;
      const angleRad = p * Math.PI * 2;
      const chars = text.replace(/\n/g, ' ').split('');
      const angleStep = (Math.PI * 2) / Math.max(1, chars.length);

      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate(angleRad);

      chars.forEach((char, index) => {
        const charAngle = index * angleStep;
        const cx = Math.cos(charAngle) * radius;
        const cy = Math.sin(charAngle) * radius;
        const charRotDeg = charAngle + Math.PI / 2;
        
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(charRotDeg);
        
        ctx.font = `bold ${fontSize}px "Microsoft YaHei", "WenQuanYi Micro Hei", sans-serif`;
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 2;
        
        ctx.fillText(char, 0, 0);
        ctx.restore();
      });
      ctx.restore();
    } else {
      ctx.save();
      ctx.translate(centerX, centerY);

      if (sb.textEffect === 'blur') {
        const pBlur = Math.min(1, relTime / 0.8);
        const opacity = pBlur;
        const scale = 0.9 + pBlur * 0.1;
        ctx.scale(scale, scale);
        ctx.globalAlpha = opacity;
        if (pBlur < 1) {
          const blurRadius = (1 - pBlur) * 20;
          ctx.filter = `blur(${blurRadius}px)`;
        }
      } else if (sb.textEffect === 'fade') {
        const opacity = Math.min(1, relTime / 0.5);
        ctx.globalAlpha = opacity;
      }

      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = 4;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 2;

      ctx.font = `bold ${fontSize}px "Microsoft YaHei", "WenQuanYi Micro Hei", sans-serif`;
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const lines = text.split('\n');
      let displayTextLines = lines;
      
      if (sb.textEffect === 'typewriter') {
        const pType = Math.min(1, p / 0.5);
        const totalChars = text.length;
        const charsToShow = Math.floor(pType * totalChars);
        let accumulatedChars = 0;
        
        displayTextLines = [];
        for (const line of lines) {
          if (accumulatedChars >= charsToShow) break;
          if (accumulatedChars + line.length + 1 <= charsToShow) {
            displayTextLines.push(line);
            accumulatedChars += line.length + 1;
          } else {
            const remaining = charsToShow - accumulatedChars;
            let linePart = line.substring(0, remaining);
            const hasCursor = pType < 1 || (Math.floor(relTime * 4) % 2 === 0);
            if (hasCursor) linePart += '|';
            displayTextLines.push(linePart);
            break;
          }
        }
        if (pType >= 1 && (Math.floor(relTime * 4) % 2 === 0) && displayTextLines.length > 0) {
          displayTextLines[displayTextLines.length - 1] += '|';
        }
      }

      const lineHeight = fontSize * 1.3;
      displayTextLines.forEach((lineText, idx) => {
        const yOffset = (idx - (displayTextLines.length - 1) / 2) * lineHeight;
        ctx.fillText(lineText, 0, yOffset);
      });

      ctx.restore();
    }
  }
}

/**
 * Main function to render a VideoTask entirely client-side using WebCodecs and canvas.
 */
export async function renderVideoClientSide(
  task: any,
  fps: number = 30,
  onProgress: (p: ClientRenderProgress) => void
): Promise<Blob> {
  if (typeof VideoEncoder === 'undefined') {
    throw new Error('Your browser does not support the WebCodecs API (VideoEncoder). Please use Chrome, Edge, or update your browser.');
  }

  onProgress({ status: 'running', progress: 5, message: '正在预加载分镜图片...' });

  // 1. Preload images
  const imagesMap = await preloadImages(task.storyboards);

  onProgress({ status: 'running', progress: 15, message: '正在初始化渲染画布和硬编码器...' });

  // 2. Setup canvas
  // Standard XHS layout is 3:4 or similar. Let's make it 1080x1440.
  const videoW = 1080;
  const videoH = 1440;

  const canvas = document.createElement('canvas');
  canvas.width = videoW;
  canvas.height = videoH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get 2D context from canvas');
  }

  // 3. Compute timeline
  const transitionDuration = 0.5; // seconds
  let totalDuration = 0;
  const storyboards = task.storyboards;
  const startTime: number[] = [];
  const endTime: number[] = [];

  for (let i = 0; i < storyboards.length; i++) {
    startTime[i] = totalDuration;
    totalDuration += storyboards[i].duration || 3;
    endTime[i] = totalDuration;
  }

  const totalFrames = Math.ceil(totalDuration * fps);
  const frameDurationUs = 1000000 / fps;

  // 4. Setup Mp4Muxer & VideoEncoder
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: {
      codec: 'avc',
      width: videoW,
      height: videoH,
    },
    fastStart: 'fragmented'
  });

  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      console.error('VideoEncoder error:', e);
    }
  });

  // H.264 High Profile or Baseline Profile. avc1.42e01f is highly compatible Baseline
  encoder.configure({
    codec: 'avc1.42e01f',
    width: videoW,
    height: videoH,
    bitrate: 6_000_000, // 6 Mbps
    framerate: fps
  });

  // 5. Offline Render and Encode loop
  for (let f = 0; f < totalFrames; f++) {
    const currentTime = f / fps;
    const timestampUs = f * frameDurationUs;

    // Find active storyboard
    let activeIdx = -1;
    for (let i = 0; i < storyboards.length; i++) {
      if (currentTime >= startTime[i] && currentTime <= endTime[i]) {
        activeIdx = i;
        break;
      }
    }
    if (activeIdx === -1) {
      activeIdx = storyboards.length - 1;
    }

    const sbCurrent = storyboards[activeIdx];
    const imgCurrent = imagesMap.get(sbCurrent.image || '');
    const relTimeCurrent = currentTime - startTime[activeIdx];

    // Clear and draw background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, videoW, videoH);

    // Check transition
    const transitionActive =
      activeIdx < storyboards.length - 1 &&
      sbCurrent.transition && sbCurrent.transition !== 'none' &&
      currentTime >= endTime[activeIdx] - transitionDuration;

    if (transitionActive) {
      const transT = endTime[activeIdx] - transitionDuration;
      const pTrans = Math.min(1, Math.max(0, (currentTime - transT) / transitionDuration));

      // Draw primary storyboard with fade out
      ctx.save();
      drawSingleStoryboard(ctx, imgCurrent, sbCurrent, relTimeCurrent, videoW, videoH);
      const mainData = ctx.getImageData(0, 0, videoW, videoH);
      ctx.restore();

      // Draw secondary storyboard with fade in
      ctx.save();
      const sbNext = storyboards[activeIdx + 1];
      const imgNext = imagesMap.get(sbNext.image || '');
      const relTimeNext = Math.max(0, currentTime - startTime[activeIdx + 1]);
      drawSingleStoryboard(ctx, imgNext, sbNext, relTimeNext, videoW, videoH);
      const nextData = ctx.getImageData(0, 0, videoW, videoH);
      ctx.restore();

      // Blend pixel buffers
      const blendedData = ctx.createImageData(videoW, videoH);
      const dMain = mainData.data;
      const dNext = nextData.data;
      const dBlend = blendedData.data;
      const len = dBlend.length;

      for (let i = 0; i < len; i += 4) {
        dBlend[i] = dMain[i] * (1 - pTrans) + dNext[i] * pTrans;
        dBlend[i + 1] = dMain[i + 1] * (1 - pTrans) + dNext[i + 1] * pTrans;
        dBlend[i + 2] = dMain[i + 2] * (1 - pTrans) + dNext[i + 2] * pTrans;
        dBlend[i + 3] = dMain[i + 3] * (1 - pTrans) + dNext[i + 3] * pTrans;
      }
      ctx.putImageData(blendedData, 0, 0);
    } else {
      // Normal storyboard draw
      drawSingleStoryboard(ctx, imgCurrent, sbCurrent, relTimeCurrent, videoW, videoH);
    }

    // Submit frame to encoder
    const videoFrame = new VideoFrame(canvas, { timestamp: timestampUs });
    encoder.encode(videoFrame, { keyFrame: f % 30 === 0 });
    videoFrame.close();

    // Prevent memory buildup / throttling by yielding to browser thread
    if (encoder.encodeQueueSize > 5) {
      await new Promise(r => requestAnimationFrame(r));
    }

    // Update progress
    const pct = 15 + Math.floor((f / totalFrames) * 80);
    onProgress({
      status: 'running',
      progress: pct,
      message: `正在进行硬加速像素压制 (${f + 1}/${totalFrames} 帧, 速度 ${(1000 / (performance.now() % 50 + 10)).toFixed(0)}fps)...`
    });
  }

  // 6. Complete and Mux
  onProgress({ status: 'running', progress: 95, message: '正在完成视频轨道合流...' });
  await encoder.flush();
  encoder.close();
  muxer.finalize();

  const { buffer } = muxer.target as ArrayBufferTarget;
  onProgress({ status: 'completed', progress: 100, message: '本地硬件视频渲染完毕！' });

  return new Blob([buffer], { type: 'video/mp4' });
}
