import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

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
      // 算法 A: 模板匹配 (基于滑动窗口的简单灰度相关性)
      const tw = templateInfo.width;
      const th = templateInfo.height;
      const tc = templateInfo.channels;

      // 预计算模板灰度
      const tGray = new Float32Array(tw * th);
      let tSum = 0;
      for (let i = 0; i < tw * th; i++) {
        const r = templateData[i * tc];
        const g = templateData[i * tc + 1];
        const b = templateData[i * tc + 2];
        tGray[i] = (r + g + b) / 3;
        tSum += tGray[i];
      }
      const tAvg = tSum / (tw * th);

      console.log(`🎯 [去水印Debug] 正在执行模板匹配...`);
      let maxCorr = -1;
      let bestX = -1, bestY = -1;

      // 只在 ROI 区域搜索
      for (let y = startY; y < height - th; y += 2) {
        for (let x = startX; x < width - tw; x += 2) {
          let corr = 0;
          for (let ty = 0; ty < th; ty++) {
            for (let tx = 0; tx < tw; tx++) {
              const tidx = ty * tw + tx;
              const sidx = (y + ty) * width + (x + tx);
              const soff = sidx * channels;
              const sGray = (data[soff] + data[soff+1] + data[soff+2]) / 3;
              // 简单的互相关
              corr += (sGray - 128) * (tGray[tidx] - 128);
            }
          }
          if (corr > maxCorr) {
            maxCorr = corr;
            bestX = x;
            bestY = y;
          }
        }
      }

      // 如果匹配度足够高 (这里是一个经验比例值)
      if (maxCorr > 0) {
        console.log(`✨ [去水印Debug] 模板匹配成功! 坐标: (${bestX}, ${bestY})`);
        // 标记遮罩：将模板中较亮的区域标记为待修复
        for (let ty = 0; ty < th; ty++) {
          for (let tx = 0; tx < tw; tx++) {
            const tidx = ty * tw + tx;
            if (tGray[tidx] > 100) { // 模板中属于水印的部分
              const sidx = (bestY + ty) * width + (bestX + tx);
              hole[sidx] = 1;
              detectedPixels++;
            }
          }
        }
      }
    } 

    // 如果没有模板或匹配失败，回退到亮度检测
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
