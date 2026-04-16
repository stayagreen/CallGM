import cv from 'opencv-wasm';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

/**
 * 使用 opencv-wasm 实现的高质量去水印方案 (对标 Python OpenCV 逻辑)
 * 逻辑：ROI 提取 -> 二值化 -> 轮廓面积过滤 -> Telea 修复
 */
export async function autoInpaint(filePath: string): Promise<boolean> {
  const fileName = path.basename(filePath);
  console.log(`🔍 [去水印-WASM] 开始处理文件: ${fileName}`);

  try {
    // 0. 等待 OpenCV WASM 加载完成
    console.log(`📦 [去水印-WASM] 检查 OpenCV 运行环境...`);
    // @ts-ignore
    if (!cv.Mat || !cv.onRuntimeInitialized) {
      console.log(`⏳ [去水印-WASM] 等待运行时初始化...`);
      // @ts-ignore
      await new Promise((resolve, reject) => {
        // 设置超时，防止永久挂起
        const timeout = setTimeout(() => reject(new Error('OpenCV WASM 初始化超时')), 15000);
        // @ts-ignore
        cv.onRuntimeInitialized = () => {
          clearTimeout(timeout);
          console.log(`✅ [去水印-WASM] 运行时初始化成功`);
          resolve(true);
        };
        // 如果已经初始化过了，Mat 会存在
        // @ts-ignore
        if (cv.Mat) {
          clearTimeout(timeout);
          resolve(true);
        }
      });
    }
    console.log(`🚀 [去水印-WASM] 环境就绪，开始解码图片...`);

    // 1. 读取图片并转换为 OpenCV 格式
    const image = sharp(filePath);
    const { data: buffer, info } = await image.raw().toBuffer({ resolveWithObject: true });
    console.log(`及 [去水印-WASM] 图片解码完成: ${info.width}x${info.height}, 通道: ${info.channels}`);
    
    let src = new cv.Mat(info.height, info.width, cv.CV_8UC4);
    src.data.set(new Uint8ClampedArray(buffer));

    const h = src.rows;
    const w = src.cols;

    // 2. 锁定右下角 ROI 区域 (75% 处开始)
    const roiX = Math.floor(w * 0.75);
    const roiY = Math.floor(h * 0.85);
    console.log(`📍 [去水印-WASM] ROI 设定: 起点(${roiX}, ${roiY}), 大小(${w-roiX}x${h-roiY})`);
    
    let rect = new cv.Rect(roiX, roiY, w - roiX, h - roiY);
    let roi = src.roi(rect);

    // 3. 灰度化 + 二值化
    console.log(`🎨 [去水印-WASM] 正在提取颜色特征...`);
    let gray = new cv.Mat();
    cv.cvtColor(roi, gray, cv.COLOR_RGBA2GRAY);
    
    let binary = new cv.Mat();
    cv.threshold(gray, 240, 255, cv.THRESH_BINARY, binary);

    // 4. 轮廓检测
    console.log(`🔍 [去水印-WASM] 正在分析视觉形状...`);
    let contours = new cv.MatVector();
    let hierarchy = new cv.Mat();
    cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    
    let mask = cv.Mat.zeros(h, w, cv.CV_8UC1);
    let watermarkFound = false;

    for (let i = 0; i < contours.size(); ++i) {
      const cnt = contours.get(i);
      const area = cv.contourArea(cnt);
      if (area > 20 && area < 2500) {
        console.log(`✨ [去水印-WASM] 找到匹配目标! 索引:${i}, 面积:${Math.round(area)}`);
        cv.drawContours(mask, contours, i, new cv.Scalar(255), -1, cv.LINE_8, hierarchy, 0, new cv.Point(roiX, roiY));
        watermarkFound = true;
      }
    }

    if (!watermarkFound) {
      console.log(`⚠️ [去水印-WASM] 区域内未检测到水印形状，任务结束`);
      src.delete(); roi.delete(); gray.delete(); binary.delete();
      contours.delete(); hierarchy.delete(); mask.delete();
      return false;
    }

    console.log(`🛠️ [去水印-WASM] 正在应用 Telea 纹理修复算法...`);
    let srcRGB = new cv.Mat();
    cv.cvtColor(src, srcRGB, cv.COLOR_RGBA2RGB);

    let dst = new cv.Mat();
    cv.inpaint(srcRGB, mask, dst, 3, cv.INPAINT_TELEA);

    // 6. 将结果转回 Sharp 并保存
    console.log(`💾 [去水印-WASM] 修复完成，正在保存文件...`);
    const processedBuffer = Buffer.from(dst.data);
    await sharp(processedBuffer, {
      raw: { width: dst.cols, height: dst.rows, channels: 3 }
    })
    .toFile(filePath + '.tmp');

    fs.renameSync(filePath + '.tmp', filePath);
    console.log(`✅ [去水印-WASM] 处理成功，文件已覆盖`);

    // 7. 严格的内存清理 (WASM 必须手动 delete)
    src.delete(); roi.delete(); gray.delete(); binary.delete();
    contours.delete(); hierarchy.delete(); mask.delete(); 
    srcRGB.delete(); dst.delete();
    
    return true;
  } catch (error) {
    console.error('❌ [去水印-WASM] 出错:', error);
    return false;
  }
}
