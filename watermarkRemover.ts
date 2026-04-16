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
    // 0. 智能等待 OpenCV WASM 加载完成
    console.log(`📦 [去水印-WASM] 探测导入入口... 类型: ${typeof cv}`);
    
    let cvInst: any = cv;

    // 方案 A: 检查是否需要调用工厂函数 (4.3.0 常见模式)
    try {
      if (typeof cv === 'function') {
        console.log(`⏳ [去水印-WASM] 执行工厂函数 cv()...`);
        const result = (cv as any)();
        if (result && typeof result.then === 'function') {
          cvInst = await result;
          console.log(`✅ [去水印-WASM] 工厂 Promise 解析成功`);
        } else {
          cvInst = result;
          console.log(`✅ [去水印-WASM] 工厂同步返回成功`);
        }
      }
    } catch (e) {
      console.log(`⚠️ [去水印-WASM] 工厂模式调用失败，尝试直接使用: ${e}`);
    }

    // 方案 B: 检查 ready 属性
    if (cvInst && cvInst.ready && typeof cvInst.ready.then === 'function') {
      console.log(`⏳ [去水印-WASM] 检测到 .ready 属性，等待中...`);
      await cvInst.ready;
    }

    // 方案 C: 轮询探测关键 API (Mat)
    if (!cvInst || !cvInst.Mat) {
      console.log(`⏳ [去水印-WASM] 关键构造函数未就绪，开始 5s 高频轮询...`);
      const start = Date.now();
      while ((!cvInst || !cvInst.Mat) && Date.now() - start < 5000) {
        await new Promise(r => setTimeout(r, 100));
        // 尝试从全局获取 (某些版本会自动挂载)
        if ((global as any).cv) cvInst = (global as any).cv;
      }
    }

    if (!cvInst || !cvInst.Mat) {
      console.error(`❌ [去水印-WASM] 无法初始化 OpenCV。可用键:`, Object.keys(cvInst || {}));
      throw new Error('OpenCV WASM 初始化失败或 API 不兼容。');
    }

    console.log(`🚀 [去水印-WASM] 环境就绪，准备处理像素...`);

    // 1. 读取图片
    const image = sharp(filePath);
    const { data: buffer, info } = await image.raw().toBuffer({ resolveWithObject: true });
    
    // 2. 创建 Mat 并载入数据 (4.3.0 标准写法)
    let src = new cvInst.Mat(info.height, info.width, cvInst.CV_8UC4);
    src.data.set(new Uint8Array(buffer)); // 使用 Uint8Array 提高兼容性

    const h = src.rows;
    const w = src.cols;

    // 3. ROI 区域锁定 (右下角)
    const roiX = Math.floor(w * 0.75);
    const roiY = Math.floor(h * 0.85);
    const roiRect = new cvInst.Rect(roiX, roiY, w - roiX, h - roiY);
    let roi = src.roi(roiRect);

    // 4. 颜色空间转换与二值化
    let gray = new cvInst.Mat();
    cvInst.cvtColor(roi, gray, cvInst.COLOR_RGBA2GRAY);
    
    let binary = new cvInst.Mat();
    cvInst.threshold(gray, 240, 255, cvInst.THRESH_BINARY);

    // 5. 轮廓提取
    let contours = new cvInst.MatVector();
    let hierarchy = new cvInst.Mat();
    cvInst.findContours(binary, contours, hierarchy, cvInst.RETR_EXTERNAL, cvInst.CHAIN_APPROX_SIMPLE);
    
    let mask = cvInst.Mat.zeros(h, w, cvInst.CV_8UC1);
    let watermarkFound = false;

    for (let i = 0; i < contours.size(); ++i) {
      const cnt = contours.get(i);
      const area = cvInst.contourArea(cnt);
      
      // 这里的逻辑必须非常精确：面积筛选
      if (area > 20 && area < 3000) {
        console.log(`✨ [去水印-WASM] 锁定目标轮廓 [${i}], 面积: ${Math.round(area)}`);
        // 注意：4.3.0 的 Scalar 需要指定全部 4 个值
        cvInst.drawContours(mask, contours, i, new cvInst.Scalar(255, 255, 255, 255), -1, cvInst.LINE_8, hierarchy, 0, new cvInst.Point(roiX, roiY));
        watermarkFound = true;
      }
    }

    if (!watermarkFound) {
      console.log(`⚠️ [去水印-WASM] 未发现符合形状的水印，跳过修复`);
      src.delete(); roi.delete(); gray.delete(); binary.delete(); contours.delete(); hierarchy.delete(); mask.delete();
      return false;
    }

    // 6. 核心：Telea 修复 (4.3.0 JS API 对齐)
    console.log(`🛠️ [去水印-WASM] 应用 Telea 修复算法...`);
    let srcRGB = new cvInst.Mat();
    cvInst.cvtColor(src, srcRGB, cvInst.COLOR_RGBA2RGB);

    let dst = new cvInst.Mat();
    cvInst.inpaint(srcRGB, mask, dst, 3, cvInst.INPAINT_TELEA);

    // 7. 保存结果
    const processedBuffer = Buffer.from(dst.data);
    await sharp(processedBuffer, {
      raw: { width: dst.cols, height: dst.rows, channels: 3 }
    })
    .toFile(filePath + '.tmp');

    fs.renameSync(filePath + '.tmp', filePath);
    console.log(`✅ [去水印-WASM] 修复成功！`);

    // 8. 严格内存释放 (4.3.0 JS 极易 OOM)
    src.delete(); roi.delete(); gray.delete(); binary.delete(); 
    contours.delete(); hierarchy.delete(); mask.delete(); 
    srcRGB.delete(); dst.delete();
    
    return true;
    
    return true;
  } catch (error) {
    console.error('❌ [去水印-WASM] 出错:', error);
    return false;
  }
}
