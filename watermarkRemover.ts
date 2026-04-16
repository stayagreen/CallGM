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

    // 目标区域：收缩到右下角极小范围 (宽度 20%, 高度 12%) - 避开中心灯具干扰
    const roiW = Math.floor(width * 0.20);
    const roiH = Math.floor(height * 0.12);
    const startX = width - roiW;
    const startY = height - roiH;

    const hole = new Uint8Array(width * height);
    let detectedPixels = 0;

    // 💡 改进检测：寻找最亮的“小”连通域
    let brightPixels: {x: number, y: number}[] = [];
    for (let y = startY; y < height; y++) {
      for (let x = startX; x < width; x++) {
        const off = (y * width + x) * channels;
        const r = data[off];
        const g = data[off+1];
        const b = data[off+2];
        const brightness = (r + g + b) / 3;
        
        // 增加白色权重：R,G,B 必须都很高且接近
        if (brightness > 225 && Math.abs(r - g) < 20 && Math.abs(g - b) < 20) {
          brightPixels.push({x, y});
        }
      }
    }

    console.log(`✨ [去水印Debug] 区域内检测到高亮像素: ${brightPixels.length}`);

    let bestX = -1, bestY = -1;
    let scale = 0.2; 

    if (brightPixels.length > 5) {
      // 找到高亮点的中心
      let sx = 0, sy = 0;
      let minX = width, minY = height, maxX = 0, maxY = 0;
      for (const p of brightPixels) {
        sx += p.x; sy += p.y;
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      }
      const cx = sx / brightPixels.length;
      const cy = sy / brightPixels.length;
      const blobW = maxX - minX;
      const blobH = maxY - minY;

      console.log(`🎯 [去水印Debug] 锁定高亮中心: (${Math.round(cx)}, ${Math.round(cy)}), 尺寸: ${blobW}x${blobH}`);

      // 尝试加载模板
      if (fs.existsSync(TEMPLATE_PATH)) {
        try {
          const { data: tData, info: tInfo } = await sharp(TEMPLATE_PATH).raw().toBuffer({ resolveWithObject: true });
          const tw = tInfo.width;
          const th = tInfo.height;
          const tc = tInfo.channels;

          // 计算缩放：以高亮区块为基准，给 1.5 倍余量封顶
          scale = Math.min(1.0, Math.max(0.05, Math.max(blobW / tw, blobH / th) * 1.5));
          console.log(`📏 [去水印Debug] 根据实际水印尺寸计算缩放: ${scale.toFixed(2)}`);

          const tGray = new Float32Array(tw * th);
          for (let i = 0; i < tw * th; i++) {
            tGray[i] = (tData[i * tc] + tData[i * tc + 1] + tData[i * tc + 2]) / 3;
          }

          for (let ty = 0; ty < th; ty++) {
            for (let tx = 0; tx < tw; tx++) {
              if (tGray[ty * tw + tx] > 128) {
                // 以中心对齐进行缩放
                const ox = Math.round((tx - tw/2) * scale);
                const oy = Math.round((ty - th/2) * scale);
                const fx = Math.round(cx + ox);
                const fy = Math.round(cy + oy);
                if (fx >= 0 && fx < width && fy >= 0 && fy < height) {
                  hole[fy * width + fx] = 1;
                  detectedPixels++;
                }
              }
            }
          }
        } catch (e) {
          console.error(`⚠️ [去水印Debug] 模板处理失败:`, e);
        }
      }
    }

    // 后备方案
    if (detectedPixels === 0 && brightPixels.length > 0) {
      console.log(`💡 [去水印Debug] 回退到点阵扩展模式`);
      for (const p of brightPixels) {
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const ny = p.y + dy, nx = p.x + dx;
            if (nx >= startX && nx < width && ny >= startY && ny < height) {
              hole[ny * width + nx] = 1;
              detectedPixels++;
            }
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
