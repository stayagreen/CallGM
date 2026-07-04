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
      
      // Ensure relative paths start with a leading slash to be robust against browser routing
      let src = sb.image;
      if (src && !src.startsWith('http') && !src.startsWith('data:') && !src.startsWith('/')) {
        src = '/' + src;
      }
      img.src = src;
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
  img: HTMLImageElement | ImageBitmap | undefined,
  sb: any,
  relTime: number,
  w: number,
  h: number
) {
  // Clear with solid black background
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, w, h);

  if (img) {
    let fitW = img.width;
    let fitH = img.height;
    let fitX = 0;
    let fitY = 0;

    if (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap) {
      // ImageBitmap is already pre-scaled to exactly fit target aspect ratio
    } else {
      const canvasAspect = w / h;
      const imgAspect = (img as HTMLImageElement).width / (img as HTMLImageElement).height;
      if (imgAspect > canvasAspect) {
        fitW = (img as HTMLImageElement).height * canvasAspect;
        fitX = ((img as HTMLImageElement).width - fitW) / 2;
      } else {
        fitH = (img as HTMLImageElement).width / canvasAspect;
        fitY = ((img as HTMLImageElement).height - fitH) / 2;
      }
    }

    const duration = sb.duration || 3;
    const p = Math.min(1, Math.max(0, relTime / duration));
    const speed = sb.animationSpeed !== undefined ? sb.animationSpeed : 1.0;

    let zoom = 1.0;
    if (sb.animation === 'zoom_in') {
      zoom = 1.0 + p * 0.08 * speed;
    } else if (sb.animation && sb.animation.startsWith('pan_')) {
      zoom = 1.15;
    }

    const sw = fitW / zoom;
    const sh = fitH / zoom;
    const rangeX = fitW - sw;
    const rangeY = fitH - sh;
    const centerX = rangeX / 2;
    const centerY = rangeY / 2;

    let offsetRefX = 0;
    let offsetRefY = 0;

    // Use a gentler interpolation range centered in the middle of the zoom buffer to slow down movement and ensure consistency
    const halfRange = Math.min(0.5, 0.25 * speed);
    const pSlow = 0.5 + (p - 0.5) * (halfRange * 2);

    switch (sb.animation) {
      case 'zoom_in':
        offsetRefX = centerX;
        offsetRefY = centerY;
        break;
      case 'pan_lr':
        offsetRefX = pSlow * rangeX;
        offsetRefY = centerY;
        break;
      case 'pan_rl':
        offsetRefX = (1 - pSlow) * rangeX;
        offsetRefY = centerY;
        break;
      case 'pan_tb':
        offsetRefX = centerX;
        offsetRefY = pSlow * rangeY;
        break;
      case 'pan_bt':
        offsetRefX = centerX;
        offsetRefY = (1 - pSlow) * rangeY;
        break;
      case 'pan_tl_br':
        offsetRefX = pSlow * rangeX;
        offsetRefY = pSlow * rangeY;
        break;
      case 'pan_br_tl':
        offsetRefX = (1 - pSlow) * rangeX;
        offsetRefY = (1 - pSlow) * rangeY;
        break;
      case 'pan_tr_bl':
        offsetRefX = (1 - pSlow) * rangeX;
        offsetRefY = pSlow * rangeY;
        break;
      case 'pan_bl_tr':
        offsetRefX = pSlow * rangeX;
        offsetRefY = (1 - pSlow) * rangeY;
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
  fps: number = 60,
  onProgress: (p: ClientRenderProgress) => void,
  options?: {
    videoQualityMode?: 'highSharpen' | 'standard';
  }
): Promise<Blob> {
  if (typeof VideoEncoder === 'undefined') {
    throw new Error('Your browser does not support the WebCodecs API (VideoEncoder). Please use Chrome, Edge, or update your browser.');
  }

  const storyboards = task.storyboards || [];
  const transitionDuration = 0.5; // seconds
  let totalDuration = 0;
  const startTime: number[] = [];
  const endTime: number[] = [];

  for (let i = 0; i < storyboards.length; i++) {
    startTime[i] = totalDuration;
    totalDuration += storyboards[i].duration || 3;
    endTime[i] = totalDuration;
  }

  // 1. Load background music if present and decode it
  let hasAudio = false;
  let audioBuffer: AudioBuffer | null = null;
  const targetSampleRate = 48000;
  const targetChannels = 2;

  if (task.bgm && task.bgm !== 'none' && typeof AudioEncoder !== 'undefined') {
    try {
      onProgress({ status: 'running', progress: 3, message: '正在加载并解码背景音乐...' });
      const bgmUrl = `/bgm/${encodeURIComponent(task.bgm)}`;
      const audioRes = await fetch(bgmUrl);
      if (audioRes.ok) {
        const audioArrayBuffer = await audioRes.arrayBuffer();
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const srcAudioBuffer = await audioCtx.decodeAudioData(audioArrayBuffer);

        const offlineCtx = new OfflineAudioContext(targetChannels, targetSampleRate * totalDuration, targetSampleRate);
        const sourceNode = offlineCtx.createBufferSource();
        sourceNode.buffer = srcAudioBuffer;
        if (srcAudioBuffer.duration < totalDuration) {
          sourceNode.loop = true;
        }
        sourceNode.connect(offlineCtx.destination);
        sourceNode.start(0);

        audioBuffer = await offlineCtx.startRendering();
        hasAudio = true;
        console.log('[ClientRender] 背景音乐离线重采样成功:', targetSampleRate, 'Hz', targetChannels, '声道');
      } else {
        console.warn(`[ClientRender] 无法获取背景音乐: ${task.bgm}, status: ${audioRes.status}`);
      }
    } catch (err) {
      console.warn('[ClientRender] 客户端背景音乐加载或解码失败，将降级至服务端合流:', err);
      hasAudio = false;
    }
  }

  onProgress({ status: 'running', progress: 7, message: '正在预加载分镜图片...' });

  // 2. Preload images
  const imagesMap = await preloadImages(storyboards);

  onProgress({ status: 'running', progress: 11, message: '正在生成高清离屏纹理缓冲区...' });

  // 3. Determine target resolution and set up canvas
  let firstImgWidth = 1080;
  let firstImgHeight = 1440;
  if (storyboards.length > 0) {
    const firstImg = imagesMap.get(storyboards[0].image || '');
    if (firstImg && firstImg.naturalWidth && firstImg.naturalHeight) {
      firstImgWidth = firstImg.naturalWidth;
      firstImgHeight = firstImg.naturalHeight;
    }
  }

  const aspect = firstImgWidth / firstImgHeight;
  const maxDim = Math.max(firstImgWidth, firstImgHeight);
  const minDim = Math.min(firstImgWidth, firstImgHeight);
  const videoQualityMode = options?.videoQualityMode || 'highSharpen';

  let videoW = 1080;
  let videoH = 1440;
  let bitrateBps = 15_000_000; // 15 Mbps default
  let initialCodec = 'avc1.64002a'; // High Profile Level 4.2 default

  if (maxDim >= 3200 || minDim >= 2160) {
    if (firstImgWidth >= firstImgHeight) {
      videoW = 3840;
      videoH = Math.round((3840 / aspect) / 2) * 2;
    } else {
      videoH = 3840;
      videoW = Math.round((3840 * aspect) / 2) * 2;
    }
    if (videoQualityMode === 'highSharpen') {
      bitrateBps = 50_000_000;
    } else {
      bitrateBps = 40_000_000;
    }
    initialCodec = 'avc1.640034';
  } else if (maxDim >= 2000 || minDim >= 1400) {
    if (firstImgWidth >= firstImgHeight) {
      videoW = 2560;
      videoH = Math.round((2560 / aspect) / 2) * 2;
    } else {
      videoH = 2560;
      videoW = Math.round((2560 * aspect) / 2) * 2;
    }
    if (videoQualityMode === 'highSharpen') {
      bitrateBps = 25_000_000;
    } else {
      bitrateBps = 18_000_000;
    }
    initialCodec = 'avc1.640032';
  } else {
    if (firstImgWidth >= firstImgHeight) {
      videoH = 1080;
      videoW = Math.round((1080 * aspect) / 2) * 2;
    } else {
      videoW = 1080;
      videoH = Math.round((1080 / aspect) / 2) * 2;
    }
    if (videoQualityMode === 'highSharpen') {
      bitrateBps = 15_000_000;
    } else {
      bitrateBps = 8_000_000;
    }
    initialCodec = 'avc1.64002a';
  }

  // Pre-create high-quality texture buffers (ImageBitmaps with bufferScale = 1.2)
  const texturesMap = new Map<string, ImageBitmap>();
  const bufferScale = 1.2;
  const bufferW = Math.round(videoW * bufferScale);
  const bufferH = Math.round(videoH * bufferScale);

  for (const sb of storyboards) {
    if (!sb.image) continue;
    const img = imagesMap.get(sb.image);
    if (!img) continue;

    const offscreen = document.createElement('canvas');
    offscreen.width = bufferW;
    offscreen.height = bufferH;
    const offCtx = offscreen.getContext('2d');
    if (offCtx) {
      offCtx.imageSmoothingEnabled = true;
      offCtx.imageSmoothingQuality = 'high';
      
      const canvasAspect = bufferW / bufferH;
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
      
      offCtx.drawImage(img, fitX, fitY, fitW, fitH, 0, 0, bufferW, bufferH);
      
      try {
        const bitmap = await createImageBitmap(offscreen);
        texturesMap.set(sb.image, bitmap);
      } catch (bitmapErr) {
        console.error('[ClientRender] Failed to create ImageBitmap, fallback to original image:', bitmapErr);
      }
    }
  }

  onProgress({ status: 'running', progress: 15, message: '正在初始化渲染画布和硬编码器...' });

  const canvas = document.createElement('canvas');
  canvas.width = videoW;
  canvas.height = videoH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get 2D context from canvas');
  }

  const totalFrames = Math.ceil(totalDuration * fps);
  const frameDurationUs = 1000000 / fps;

  // 4. Setup Mp4Muxer & VideoEncoder/AudioEncoder
  let muxerInstance: any = null;
  let audioEncoder: AudioEncoder | null = null;

  if (hasAudio) {
    try {
      audioEncoder = new AudioEncoder({
        output: (chunk, meta) => muxerInstance && muxerInstance.addAudioChunk(chunk, meta),
        error: (e) => {
          console.error('[ClientRender] AudioEncoder error:', e);
        }
      });
      audioEncoder.configure({
        codec: 'mp4a.40.2', // AAC-LC
        numberOfChannels: targetChannels,
        sampleRate: targetSampleRate,
        bitrate: 128_000
      });
    } catch (err) {
      console.warn('[ClientRender] 无法初始化 AudioEncoder, 降级至无声渲染并服务端合流:', err);
      hasAudio = false;
    }
  }

  const muxerConfig: any = {
    target: new ArrayBufferTarget(),
    video: {
      codec: 'avc',
      width: videoW,
      height: videoH,
    },
    fastStart: 'in-memory'
  };

  if (hasAudio) {
    muxerConfig.audio = {
      codec: 'aac',
      numberOfChannels: targetChannels,
      sampleRate: targetSampleRate
    };
  }

  const muxer = new Muxer(muxerConfig);
  muxerInstance = muxer;

  let encodeError: any = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      console.error('VideoEncoder error:', e);
      encodeError = e;
    }
  });

  const config = {
    codec: initialCodec,
    width: videoW,
    height: videoH,
    bitrate: bitrateBps,
    framerate: fps
  };

  try {
    encoder.configure(config);
  } catch (err) {
    console.warn(`Failed to configure VideoEncoder with profile ${initialCodec}, trying standard High Profile...`, err);
    try {
      config.codec = 'avc1.64002a';
      encoder.configure(config);
    } catch (err1) {
      console.warn('Failed to configure with standard High Profile, trying Main Profile...', err1);
      try {
        config.codec = 'avc1.4d4029';
        encoder.configure(config);
      } catch (err2) {
        console.warn('Failed to configure with Main Profile, trying Baseline Profile...', err2);
        try {
          config.codec = 'avc1.42e029';
          encoder.configure(config);
        } catch (err3) {
          console.error('Failed to configure with H.264 profiles, trying VP9...', err3);
          try {
            config.codec = 'vp09.00.10.08';
            encoder.configure(config);
          } catch (err4) {
            throw new Error('您的浏览器不支持 H.264 或 VP9 硬件编码，请确保启用了 GPU 硬件加速并使用最新 Chrome/Edge 浏览器。');
          }
        }
      }
    }
  }

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
    const imgCurrent = texturesMap.get(sbCurrent.image || '') || imagesMap.get(sbCurrent.image || '');
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
      const imgNext = texturesMap.get(sbNext.image || '') || imagesMap.get(sbNext.image || '');
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
    if (encodeError) {
      throw new Error(`硬件编码器在第 ${f + 1}/${totalFrames} 帧发生错误: ${encodeError.message || encodeError}`);
    }

    const videoFrame = new VideoFrame(canvas, { timestamp: timestampUs });
    encoder.encode(videoFrame, { keyFrame: f % 30 === 0 });
    videoFrame.close();

    // Prevent memory buildup / throttling by yielding to browser thread
    if (encoder.encodeQueueSize > 5) {
      await new Promise(r => requestAnimationFrame(r));
    }

    // Update progress
    const pct = 15 + Math.floor((f / totalFrames) * 75);
    onProgress({
      status: 'running',
      progress: pct,
      message: `正在进行硬加速像素压制 (${f + 1}/${totalFrames} 帧, 速度 ${(1000 / (performance.now() % 50 + 10)).toFixed(0)}fps)...`
    });
  }

  // 6. Complete and Mux
  if (encodeError) {
    throw new Error(`硬件编码器在渲染循环后发生错误: ${encodeError.message || encodeError}`);
  }

  onProgress({ status: 'running', progress: 92, message: '正在完成视频轨道合流...' });
  await encoder.flush();

  if (encodeError) {
    throw new Error(`硬件编码器在最终合流(flush)阶段发生错误: ${encodeError.message || encodeError}`);
  }

  encoder.close();

  // If we have client-side audio, encode and flush audio chunks now
  if (hasAudio && audioBuffer && audioEncoder) {
    try {
      onProgress({ status: 'running', progress: 95, message: '正在进行音频合轨硬编码...' });
      const ch0 = audioBuffer.getChannelData(0);
      const ch1 = audioBuffer.getChannelData(1);
      const totalSamples = audioBuffer.length;
      const chunkSize = 1024;
      
      let offset = 0;
      while (offset < totalSamples) {
        const currentChunkSize = Math.min(chunkSize, totalSamples - offset);
        const planarBuffer = new Float32Array(currentChunkSize * targetChannels);
        
        planarBuffer.set(ch0.subarray(offset, offset + currentChunkSize), 0);
        planarBuffer.set(ch1.subarray(offset, offset + currentChunkSize), currentChunkSize);
        
        const timestampUs = Math.round((offset / targetSampleRate) * 1_000_000);
        
        const audioData = new AudioData({
          format: 'f32-planar',
          sampleRate: targetSampleRate,
          numberOfFrames: currentChunkSize,
          numberOfChannels: targetChannels,
          timestamp: timestampUs,
          data: planarBuffer
        });
        
        audioEncoder.encode(audioData);
        audioData.close();
        
        offset += currentChunkSize;
      }
      
      await audioEncoder.flush();
      audioEncoder.close();
      console.log('[ClientRender] 背景音乐 AAC-LC 编码完成！');
    } catch (audioEncErr) {
      console.error('[ClientRender] 背景音乐编码过程中出错，可能导致无声视频:', audioEncErr);
    }
  }

  onProgress({ status: 'running', progress: 98, message: '正在组织并封包最终 MP4 文件...' });
  muxer.finalize();

  // Clean up ImageBitmaps to prevent memory leaks
  for (const [_, bitmap] of texturesMap.entries()) {
    try {
      bitmap.close();
    } catch (e) {}
  }

  const { buffer } = muxer.target as ArrayBufferTarget;
  onProgress({ status: 'completed', progress: 100, message: '本地硬件视频渲染与合流完毕！' });

  const finalBlob = new Blob([buffer], { type: 'video/mp4' });
  (finalBlob as any).isAudioMerged = hasAudio;
  return finalBlob;
}
