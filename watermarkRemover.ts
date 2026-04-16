import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

/**
 * 自动检测右下角水印并进行去水印处理 (非AI传统算法)
 */
export async function autoInpaint(filePath: string): Promise<boolean> {
  console.log(`🔍 [去水印Debug] 开始处理文件: ${path.basename(filePath)}`);
  try {
    const image = sharp(filePath);
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height) {
      console.log(`❌ [去水印Debug] 无法获取图片元数据`);
      return false;
    }

    const { width, height } = metadata;
    console.log(`📏 [去水印Debug] 图片尺寸: ${width}x${height}`);

    // 1. 获取像素数据
    const { data, info } = await image
      .raw()
      .toBuffer({ resolveWithObject: true });

    // 2. 识别遮罩 (Mask)
    // 目标区域：右下角 (宽度 30%, 高度 15%) - 稍作扩大以防万一
    const roiW = Math.floor(width * 0.30);
    const roiH = Math.floor(height * 0.15);
    const startX = width - roiW;
    const startY = height - roiH;
    console.log(`🎯 [去水印Debug] 检测区域(ROI): x=${startX}-${width}, y=${startY}-${height}`);

    const hole = new Uint8Array(width * height);
    let detectedPixels = 0;

    // 水印检测算法：寻找高亮/高对比度像素
    for (let y = startY; y < height; y++) {
      for (let x = startX; x < width; x++) {
        const idx = y * width + x;
        const off = idx * info.channels;
        
        const r = data[off];
        const g = data[off+1];
        const b = data[off+2];
        const brightness = (r + g + b) / 3;

        // 阈值检测
        if (brightness > 200) { // 稍微降低阈值以增加检测敏感度
          hole[idx] = 1;
          detectedPixels++;
        }
      }
    }

    console.log(`✨ [去水印Debug] 初步检测到疑似水印像素: ${detectedPixels} 个`);

    if (detectedPixels === 0) {
      console.log(`⚠️ [去水印Debug] 未在指定区域检测到高亮像素，跳过处理`);
      return false;
    }

    // 3. 统计检测到的连通域分布情况 (可选，增加智能度)
    // ...

    // 膨胀遮罩 (Dilation): 保证覆盖完整
    const dilation = 5;
    const dilatedHole = new Uint8Array(width * height);
    let finalHoleCount = 0;
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
    console.log(`📢 [去水印Debug] 遮罩扩充(Dilation)完成，最终待修复面积: ${finalHoleCount} 像素`);

    // 4. 智能填充算法 (Smart Fill: Boundary Average -> Diffusion -> Blur Blending)
    const pixels = new Uint8ClampedArray(data);
    const channels = info.channels;
    let holeCount = finalHoleCount;

    // 4.1 预填充：使用边界像素的平均值进行初步填充，防止残留过深颜色
    let sumR = 0, sumG = 0, sumB = 0, boundaryCount = 0;
    for (let i = 0; i < width * height; i++) {
      if (hole[i] === 1) {
        const x = i % width;
        const y = Math.floor(i / width);
        let isBoundary = false;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              if (hole[ny * width + nx] === 0) {
                const nidx = ny * width + nx;
                const off = nidx * channels;
                sumR += pixels[off];
                sumG += pixels[off+1];
                sumB += pixels[off+2];
                boundaryCount++;
                isBoundary = true;
              }
            }
          }
        }
      }
    }
    
    if (boundaryCount > 0) {
      const avgR = sumR / boundaryCount;
      const avgG = sumG / boundaryCount;
      const avgB = sumB / boundaryCount;
      for (let i = 0; i < width * height; i++) {
        if (hole[i] === 1) {
          const off = i * channels;
          pixels[off] = avgR;
          pixels[off+1] = avgG;
          pixels[off+2] = avgB;
        }
      }
    }

    // 4.2 扩散循环 (Diffusion Loop)
    let iterations = 0;
    const maxIterations = 500;
    
    // 找出包围盒以缩小处理范围
    let minX = width, minY = height, maxX = 0, maxY = 0;
    for (let i = 0; i < width * height; i++) {
      if (hole[i] === 1) {
        const x = i % width;
        const y = Math.floor(i / width);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    minX = Math.max(0, minX - 2);
    minY = Math.max(0, minY - 2);
    maxX = Math.min(width - 1, maxX + 2);
    maxY = Math.min(height - 1, maxY + 2);

    // 找到初始边界
    let boundary: number[] = [];
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
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

    console.log(`🖌️ [去水印Debug] 修复算法启动，初始边界点: ${boundary.length}`);

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
            const off = nidx * channels;
            r += pixels[off];
            g += pixels[off+1];
            b += pixels[off+2];
            count++;
          }
        }

        if (count > 0) {
          const off = idx * channels;
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

    console.log(`✅ [去水印Debug] 扩散修复完成，共迭代 ${iterations} 次`);

    // 5. 保存处理后的图像
    const extension = path.extname(filePath).toLowerCase();
    
    let processedImage = sharp(Buffer.from(pixels), {
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
    console.log(`💾 [去水印Debug] 文件已覆盖保存: ${filePath}`);
    return true;
  } catch (error) {
    console.error('❌ [去水印Debug] 严重错误:', error);
    return false;
  }
}
