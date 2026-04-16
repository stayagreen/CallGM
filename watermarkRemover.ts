import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

/**
 * 自动检测右下角水印并进行去水印处理 (非AI传统算法)
 */
export async function autoInpaint(filePath: string): Promise<boolean> {
  try {
    const image = sharp(filePath);
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height) return false;

    const { width, height } = metadata;

    // 1. 获取像素数据
    const { data, info } = await image
      .raw()
      .toBuffer({ resolveWithObject: true });

    // 2. 识别遮罩 (Mask)
    // 目标区域：右下角 (宽度 25%, 高度 12%)
    const roiW = Math.floor(width * 0.25);
    const roiH = Math.floor(height * 0.12);
    const startX = width - roiW;
    const startY = height - roiH;

    const hole = new Uint8Array(width * height);
    let holeCount = 0;

    // 水印检测算法：寻找高亮/高对比度像素 (通常水印是白色或浅灰色)
    for (let y = startY; y < height; y++) {
      for (let x = startX; x < width; x++) {
        const idx = y * width + x;
        const off = idx * info.channels;
        
        // 简单的亮度检测 (R+G+B)/3
        const r = data[off];
        const g = data[off+1];
        const b = data[off+2];
        const brightness = (r + g + b) / 3;

        // 阈值检测：亮度较高且与周围有一定对比度，或者纯高亮
        if (brightness > 210) { 
          hole[idx] = 1;
        }
      }
    }

    // 膨胀遮罩 (Dilation): 保证覆盖完整
    const dilation = 4;
    const dilatedHole = new Uint8Array(width * height);
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
              dilatedHole[dy * width + dx] = 1;
            }
          }
        }
      }
    }
    hole.set(dilatedHole);

    for (let i = 0; i < width * height; i++) if (hole[i] === 1) holeCount++;

    if (holeCount === 0) return false;

    // 3. 扩散修复算法 (Diffusion Inpainting)
    const pixels = new Uint8ClampedArray(data);
    let iterations = 0;
    const maxIterations = 300;

    // 初始边界
    let boundary: number[] = [];
    const minX_bbox = startX - dilation;
    const minY_bbox = startY - dilation;

    for (let y = minY_bbox; y < height; y++) {
      if (y < 0) continue;
      for (let x = minX_bbox; x < width; x++) {
        if (x < 0) continue;
        const idx = y * width + x;
        if (hole[idx] === 1) {
          let isBoundary = false;
          const check = [
            (x > 0) ? idx - 1 : -1,
            (x < width - 1) ? idx + 1 : -1,
            (y > 0) ? idx - width : -1,
            (y < height - 1) ? idx + width : -1
          ];
          for (const nidx of check) {
            if (nidx !== -1 && hole[nidx] === 0) {
              isBoundary = true;
              break;
            }
          }
          if (isBoundary) boundary.push(idx);
        }
      }
    }

    while (iterations < maxIterations && holeCount > 0 && boundary.length > 0) {
      const nextBoundary = new Set<number>();
      const filledThisIteration = [];

      for (const idx of boundary) {
        const x = idx % width;
        const y = Math.floor(idx / width);
        let r = 0, g = 0, b = 0, count = 0;
        
        const neighbors = [
          (x > 0) ? idx - 1 : -1,
          (x < width - 1) ? idx + 1 : -1,
          (y > 0) ? idx - width : -1,
          (y < height - 1) ? idx + width : -1
        ];

        for (const nidx of neighbors) {
          if (nidx !== -1 && hole[nidx] === 0) {
            const off = nidx * info.channels;
            r += pixels[off];
            g += pixels[off+1];
            b += pixels[off+2];
            count++;
          }
        }

        if (count > 0) {
          const off = idx * info.channels;
          pixels[off] = Math.round(r / count);
          pixels[off+1] = Math.round(g / count);
          pixels[off+2] = Math.round(b / count);
          filledThisIteration.push(idx);
        }
      }

      for (const idx of filledThisIteration) {
        hole[idx] = 0;
        holeCount--;
        const x = idx % width;
        const y = Math.floor(idx / width);
        
        const neighbors = [
          (x > 0) ? idx - 1 : -1,
          (x < width - 1) ? idx + 1 : -1,
          (y > 0) ? idx - width : -1,
          (y < height - 1) ? idx + width : -1
        ];
        for (const nidx of neighbors) {
          if (nidx !== -1 && hole[nidx] === 1) nextBoundary.add(nidx);
        }
      }

      boundary = Array.from(nextBoundary);
      iterations++;
    }

    // 4. 保存处理后的图像
    const buffer = Buffer.from(pixels);
    const extension = path.extname(filePath).toLowerCase();
    
    let processedImage = sharp(buffer, {
      raw: {
        width: info.width,
        height: info.height,
        channels: info.channels
      }
    });

    if (extension === '.png') {
      processedImage = processedImage.png();
    } else if (extension === '.webp') {
      processedImage = processedImage.webp();
    } else {
      processedImage = processedImage.jpeg({ quality: 95 });
    }

    await processedImage.toFile(filePath + '.tmp');

    fs.renameSync(filePath + '.tmp', filePath);
    return true;
  } catch (error) {
    console.error('Auto inpaint failed:', error);
    return false;
  }
}
