import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const TEMPLATE_PATH = path.join(process.cwd(), 'watermark_template.png');

/**
 * 自动检测右下角水印并进行去水印处理 (非AI传统算法)
 * 支持基于模板的精准匹配 (如果存在 watermark_template.png)
 */
export async function autoInpaint(filePath: string): Promise<boolean> {
  const fileName = path.basename(filePath);
  const extension = path.extname(filePath).toLowerCase();
  console.log(`🔍 [去水印Debug] 开始处理文件: ${fileName}`);
  
  try {
    const image = sharp(filePath);
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height) {
      console.log(`❌ [去水印Debug] 无法获取图片元数据`);
      return false;
    }

    const { width, height } = metadata;
    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
    const channels = info.channels;

    // 目标区域：右下角 (宽度 30%, 高度 15%)
    const roiW = Math.floor(width * 0.30);
    const roiH = Math.floor(height * 0.15);
    const startX = width - roiW;
    const startY = height - roiH;

    const hole = new Uint8Array(width * height);
    let detectedPixels = 0;

    // 💡 预筛选：先寻找 ROI 区域内的“亮度重心”
    let sumX = 0, sumY = 0, brightCount = 0;
    let minBX = width, minBY = height, maxBX = 0, maxBY = 0;
    
    for (let y = startY; y < height; y++) {
      for (let x = startX; x < width; x++) {
        const off = (y * width + x) * channels;
        const b = (data[off] + data[off+1] + data[off+2]) / 3;
        if (b > 190) { // 寻找显著亮点 (水印通常很亮)
          sumX += x; sumY += y;
          brightCount++;
          if (x < minBX) minBX = x; if (x > maxBX) maxBX = x;
          if (y < minBY) minBY = y; if (y > maxBY) maxBY = y;
        }
      }
    }

    let centroidX = -1, centroidY = -1;
    if (brightCount > 10) {
      centroidX = sumX / brightCount;
      centroidY = sumY / brightCount;
      console.log(`💡 [去水印Debug] 发现亮度区块中心: (${Math.round(centroidX)}, ${Math.round(centroidY)}), 包含像素: ${brightCount}`);
    }

    // 尝试加载模板
    let templateData: Buffer | null = null;
    let templateInfo: sharp.OutputInfo | null = null;
    
    if (fs.existsSync(TEMPLATE_PATH)) {
      try {
        const { data: tData, info: tInfo } = await sharp(TEMPLATE_PATH).raw().toBuffer({ resolveWithObject: true });
        templateData = tData;
        templateInfo = tInfo;
        console.log(`🖼️ [去水印Debug] 已加载水印模板: ${templateInfo.width}x${templateInfo.height}`);
      } catch (e) {
        console.error(`⚠️ [去水印Debug] 加载模板失败:`, e);
      }
    }

    if (templateData && templateInfo) {
      // 算法 A: 模板匹配 (带权重的滑动窗口)
      const tw = templateInfo.width;
      const th = templateInfo.height;
      const tc = templateInfo.channels;

      const tGray = new Float32Array(tw * th);
      for (let i = 0; i < tw * th; i++) {
        const r = templateData[i * tc];
        const g = templateData[i * tc + 1];
        const b = templateData[i * tc + 2];
        tGray[i] = (r + g + b) / 3;
      }

      console.log(`🎯 [去水印Debug] 正在执行模板匹配...`);
      let maxCorr = -1;
      let bestX = -1, bestY = -1;

      // 搜索范围：在 ROI 内搜索，且重点关注亮度重心附近
      for (let y = startY; y < height - th; y += 4) {
        for (let x = startX; x < width - tw; x += 4) {
          let corr = 0;
          let localBrightness = 0;
          for (let ty = 0; ty < th; ty += 2) {
            for (let tx = 0; tx < tw; tx += 2) {
              const tidx = ty * tw + tx;
              const sidx = (y + ty) * width + (x + tx);
              const soff = sidx * channels;
              const sGray = (data[soff] + data[soff+1] + data[soff+2]) / 3;
              corr += (sGray - 128) * (tGray[tidx] - 128);
              if (sGray > 200) localBrightness++;
            }
          }
          
          // 如果该区域完全没有亮点，则即便纹理相似也降低权重 (这就是防止在墙面误判的关键)
          if (localBrightness < 5) corr = -1000000;

          if (corr > maxCorr) {
            maxCorr = corr;
            bestX = x;
            bestY = y;
          }
        }
      }

      // 如果匹配结果远离亮度重心，则可能误判
      if (centroidX !== -1 && centroidY !== -1) {
        const dist = Math.sqrt(Math.pow(bestX + tw/2 - centroidX, 2) + Math.pow(bestY + th/2 - centroidY, 2));
        if (dist > roiW * 0.5) {
          console.log(`⚠️ [去水印Debug] 模板匹配结果偏离重心 (${Math.round(dist)}px)，采用重心锚点替代`);
          bestX = Math.round(centroidX - tw/2);
          bestY = Math.round(centroidY - th/2);
        }
      }

      if (maxCorr > -1000 || (centroidX !== -1)) {
        console.log(`✨ [去水印Debug] 最终锁定位置: (${bestX}, ${bestY})`);
        
        // 自动缩放机制：如果发现亮点区块比模板显著小，则缩小 Mask
        let scale = 1.0;
        if (centroidX !== -1 && brightCount > 0) {
          const blobW = maxBX - minBX;
          const blobH = maxBY - minBY;
          // 如果亮点连通域比模板小很多，说明缩放不一致
          if (blobW < tw * 0.6 || blobH < th * 0.6) {
             scale = Math.max(0.1, Math.min(blobW / tw, blobH / th) * 2.0); // 稍微留点余量
             console.log(`📏 [去水印Debug] 检测到尺寸差异，Mask 自动缩放: ${scale.toFixed(2)}`);
          }
        }

        for (let ty = 0; ty < th; ty++) {
          for (let tx = 0; tx < tw; tx++) {
            const tidx = ty * tw + tx;
            if (tGray[tidx] > 100) {
              // 应用缩放后的偏移
              const ox = Math.round((tx - tw/2) * scale + tw/2);
              const oy = Math.round((ty - th/2) * scale + th/2);
              const sx = bestX + ox;
              const sy = bestY + oy;
              if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
                hole[sy * width + sx] = 1;
                detectedPixels++;
              }
            }
          }
        }
      }
    } 

    // 后备方案：如果没有模板或识别彻底失败，仍使用纯亮度点
    if (detectedPixels === 0) {
      console.log(`💡 [去水印Debug] 回退到亮度检测模式...`);
      for (let y = startY; y < height; y++) {
        for (let x = startX; x < width; x++) {
          const idx = y * width + x;
          const off = idx * channels;
          const brightness = (data[off] + data[off+1] + data[off+2]) / 3;
          if (brightness > 190) { // 更激进的阈值
            hole[idx] = 1;
            detectedPixels++;
          }
        }
      }
    }

    if (detectedPixels === 0) {
      console.log(`⚠️ [去水印Debug] 未检测到水印区域，跳过处理`);
      return false;
    }

    console.log(`✨ [去水印Debug] 检测到待修复像素: ${detectedPixels}`);

    // 膨胀遮罩 (Dilation)
    const dilation = 5;
    const dilatedHole = new Uint8Array(width * height);
    let finalHoleCount = 0;
    // ... 膨胀逻辑 ...
    for (let y = startY - dilation; y < height; y++) {
      if (y < 0) continue;
      for (let x = startX - dilation; x < width; x++) {
        if (x < 0) continue;
        if (hole[y * width + x] === 1) {
          const minY = Math.max(0, y - dilation);
          const maxY = Math.min(height - 1, y + dilation);
          const minX = Math.max(0, x - dilation);
          const maxX = Math.min(width - 1, x + dilation);
          for (let dy = minY; dy <= maxY; dy++) {
            for (let dx = minX; dx <= maxX; dx++) {
              if (dilatedHole[dy * width + dx] === 0) {
                dilatedHole[dy * width + dx] = 1;
                finalHoleCount++;
              }
            }
          }
        }
      }
    }
    hole.set(dilatedHole);

    // 4. 智能填充 (Smart Fill)
    const pixels = new Uint8ClampedArray(data);
    let holeCount = finalHoleCount;

    // 预填充边界平均值
    let sumR = 0, sumG = 0, sumB = 0, boundaryCount = 0;
    for (let i = 0; i < width * height; i++) {
      if (hole[i] === 1) {
        const x = i % width;
        const y = Math.floor(i / width);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height && hole[ny * width + nx] === 0) {
              const off = (ny * width + nx) * channels;
              sumR += pixels[off]; sumG += pixels[off+1]; sumB += pixels[off+2];
              boundaryCount++;
            }
          }
        }
      }
    }
    if (boundaryCount > 0) {
      const avgR = sumR / boundaryCount, avgG = sumG / boundaryCount, avgB = sumB / boundaryCount;
      for (let i = 0; i < width * height; i++) {
        if (hole[i] === 1) {
          const off = i * channels;
          pixels[off] = avgR; pixels[off+1] = avgG; pixels[off+2] = avgB;
        }
      }
    }

    // 扩散修复
    let iterations = 0;
    const maxIterations = 500;
    let boundary: number[] = [];
    for (let i = 0; i < width * height; i++) {
      if (hole[i] === 1) {
        let isB = false;
        const x = i % width, y = Math.floor(i / width);
        const neighbors = [(x>0)?i-1:-1, (x<width-1)?i+1:-1, (y>0)?i-width:-1, (y<height-1)?i+width:-1];
        for (const n of neighbors) if (n !== -1 && hole[n] === 0) { isB = true; break; }
        if (isB) boundary.push(i);
      }
    }

    while (iterations < maxIterations && holeCount > 0 && boundary.length > 0) {
      const nextB = new Set<number>();
      for (const idx of boundary) {
        const x = idx % width, y = Math.floor(idx / width);
        let r=0, g=0, b=0, c=0;
        const neighbors = [(x>0)?idx-1:-1, (x<width-1)?idx+1:-1, (y>0)?idx-width:-1, (y<height-1)?idx+width:-1];
        for (const n of neighbors) {
          if (n !== -1 && hole[n] === 0) {
            const off = n * channels;
            r += pixels[off]; g += pixels[off+1]; b += pixels[off+2]; c++;
          }
        }
        if (c > 0) {
          const off = idx * channels;
          pixels[off] = r / c; pixels[off+1] = g / c; pixels[off+2] = b / c;
          hole[idx] = 0; holeCount--;
          for (const n of neighbors) if (n !== -1 && hole[n] === 1) nextB.add(n);
        }
      }
      boundary = Array.from(nextB);
      iterations++;
    }

    // 保存图像
    const processedImage = sharp(Buffer.from(pixels), {
      raw: { width, height, channels }
    });

    const outPath = filePath + '.tmp';
    if (extension === '.png') await processedImage.png().toFile(outPath);
    else if (extension === '.webp') await processedImage.webp().toFile(outPath);
    else await processedImage.jpeg({ quality: 95 }).toFile(outPath);

    fs.renameSync(outPath, filePath);
    console.log(`✅ [去水印Debug] 修复完成，文件已更新`);
    return true;
  } catch (error) {
    console.error('❌ [去水印Debug] 失败:', error);
    return false;
  }
}
