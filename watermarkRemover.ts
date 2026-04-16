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
    // @ts-ignore
    if (!cv.Mat) {
      // @ts-ignore
      await new Promise(resolve => cv.onRuntimeInitialized = resolve);
    }

    // 1. 读取图片并转换为 OpenCV 格式
    // 注意：opencv-wasm readImage 主要是处理像素 buffer
    const image = sharp(filePath);
    const { data: buffer, info } = await image.raw().toBuffer({ resolveWithObject: true });
    
    // 创建 OpenCV Mat (RGBA)
    let src = new cv.Mat(info.height, info.width, cv.CV_8UC4);
    src.data.set(new Uint8ClampedArray(buffer));

    const h = src.rows;
    const w = src.cols;

    // 2. 锁定右下角 ROI 区域 (75% 处开始)
    const roiX = Math.floor(w * 0.75);
    const roiY = Math.floor(h * 0.85);
    const roiW = w - roiX;
    const roiH = h - roiY;
    
    let rect = new cv.Rect(roiX, roiY, roiW, roiH);
    let roi = src.roi(rect);

    // 3. 灰度化 + 二值化
    let gray = new cv.Mat();
    cv.cvtColor(roi, gray, cv.COLOR_RGBA2GRAY);
    
    let binary = new cv.Mat();
    cv.threshold(gray, 240, 255, cv.THRESH_BINARY, binary);

    // 4. 轮廓检测
    let contours = new cv.MatVector();
    let hierarchy = new cv.Mat();
    cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    
    // 初始化掩码 mask (必须是单通道 8UC1)
    let mask = cv.Mat.zeros(h, w, cv.CV_8UC1);

    let watermarkFound = false;

    for (let i = 0; i < contours.size(); ++i) {
      const cnt = contours.get(i);
      const area = cv.contourArea(cnt);
      
      // 过滤特征：面积在 20~2500 像素之间
      if (area > 20 && area < 2500) {
        console.log(`✨ [去水印-WASM] 发现候选轮廓 [${i}], 面积: ${Math.round(area)}`);
        
        // 由于没有原生 translate 方法，手动在全图 Mask 上根据坐标偏移绘制
        // 我们创建一个临时向量来存放偏移后的轮廓 (或者在 draw 时候加 offset)
        // WASM 版的 drawContours 支持 offset 参数
        cv.drawContours(mask, contours, i, new cv.Scalar(255), -1, cv.LINE_8, hierarchy, 0, new cv.Point(roiX, roiY));
        watermarkFound = true;
      }
    }

    if (!watermarkFound) {
      console.log(`⚠️ [去水印-WASM] 角落 ROI 内未匹配到水印形状，跳过`);
      // 资源清理
      src.delete(); roi.delete(); gray.delete(); binary.delete();
      contours.delete(); hierarchy.delete(); mask.delete();
      return false;
    }

    // 将 src 转为 RGB (inpaint 只支持 1 或 3 通道)
    let srcRGB = new cv.Mat();
    cv.cvtColor(src, srcRGB, cv.COLOR_RGBA2RGB);

    // 5. 核心：Telea 修复
    let dst = new cv.Mat();
    cv.inpaint(srcRGB, mask, dst, 3, cv.INPAINT_TELEA);

    // 6. 将结果转回 Sharp 并保存
    const processedBuffer = Buffer.from(dst.data);
    await sharp(processedBuffer, {
      raw: {
        width: dst.cols,
        height: dst.rows,
        channels: 3
      }
    })
    .toFile(filePath + '.tmp');

    fs.renameSync(filePath + '.tmp', filePath);
    console.log(`✅ [去水印-WASM] 修复完成并覆盖原图`);

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
