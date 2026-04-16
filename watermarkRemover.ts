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
    console.log(`📦 [去水印-WASM] 正在探测 OpenCV 环境... 类型: ${typeof cv}`);
    
    let opencv: any = cv;
    
    // 适配方案 1: 如果是工厂函数 (直接执行)
    if (typeof cv === 'function') {
      console.log(`⏳ [去水印-WASM] 检测到工厂函数，正在启动实例...`);
      opencv = await (cv as any)();
    } 
    // 适配方案 2: 如果是 Promise (await 解析)
    else if (opencv && typeof opencv.then === 'function') {
      console.log(`⏳ [去水印-WASM] 检测到异步对象，正在等待 Promise...`);
      opencv = await opencv;
    }

    // 适配方案 3: 检查 ready 属性 (常用于 WASM 包)
    if (opencv && opencv.ready && typeof opencv.ready.then === 'function') {
      console.log(`⏳ [去水印-WASM] 等待 opencv.ready...`);
      await opencv.ready;
    }

    // 轮询检查关键构造函数 (最终防波)
    if (!opencv.Mat) {
      console.log(`⏳ [去水印-WASM] 关键构造函数缺失，开始 10s 轮询...`);
      const start = Date.now();
      while (!opencv.Mat && Date.now() - start < 10000) {
        // 部分实现需要给事件循环机会
        await new Promise(r => setTimeout(r, 200));
        // 如果 global 有 cv 也可以尝试
        if (!opencv.Mat && (global as any).cv) {
          opencv = (global as any).cv;
        }
      }
    }

    if (!opencv.Mat) {
      console.error(`❌ [去水印-WASM] 初始化失败。对象当前状态:`, Object.keys(opencv || {}));
      throw new Error('无法定位 OpenCV Mat 构造函数。请确认 package.json 中的版本是否与代码匹配。');
    }

    console.log(`🚀 [去水印-WASM] 环境就绪 (使用核心版本: ${opencv.getBuildInformation ? '已加载' : '轻量版'})`);
    const cvInst = opencv; // 使用确定的实例

    // 1. 读取图片并转换为 OpenCV 格式
    const image = sharp(filePath);
    const { data: buffer, info } = await image.raw().toBuffer({ resolveWithObject: true });
    console.log(`🖼️ [去水印-WASM] 图片解码完成: ${info.width}x${info.height}`);
    
    let src = new cvInst.Mat(info.height, info.width, cvInst.CV_8UC4);
    src.data.set(new Uint8ClampedArray(buffer));

    const h = src.rows;
    const w = src.cols;

    // 2. 锁定右下角 ROI 区域 (75% 处开始)
    const roiX = Math.floor(w * 0.75);
    const roiY = Math.floor(h * 0.85);
    console.log(`📍 [去水印-WASM] ROI 设定: 起点(${roiX}, ${roiY})`);
    
    let rect = new cvInst.Rect(roiX, roiY, w - roiX, h - roiY);
    let roi = src.roi(rect);

    // 3. 灰度化 + 二值化
    console.log(`🎨 [去水印-WASM] 提取颜色特征...`);
    let gray = new cvInst.Mat();
    cvInst.cvtColor(roi, gray, cvInst.COLOR_RGBA2GRAY);
    
    let binary = new cvInst.Mat();
    cvInst.threshold(gray, 240, 255, cvInst.THRESH_BINARY, binary);

    // 4. 轮廓检测
    console.log(`🔍 [去水印-WASM] 分析视觉形状...`);
    let contours = new cvInst.MatVector();
    let hierarchy = new cvInst.Mat();
    cvInst.findContours(binary, contours, hierarchy, cvInst.RETR_EXTERNAL, cvInst.CHAIN_APPROX_SIMPLE);
    
    let mask = cvInst.Mat.zeros(h, w, cvInst.CV_8UC1);
    let watermarkFound = false;

    for (let i = 0; i < contours.size(); ++i) {
      const cnt = contours.get(i);
      const area = cvInst.contourArea(cnt);
      if (area > 20 && area < 2500) {
        console.log(`✨ [去水印-WASM] 锁定目标! 面积:${Math.round(area)}`);
        cvInst.drawContours(mask, contours, i, new cvInst.Scalar(255), -1, cvInst.LINE_8, hierarchy, 0, new cvInst.Point(roiX, roiY));
        watermarkFound = true;
      }
    }

    if (!watermarkFound) {
      console.log(`⚠️ [去水印-WASM] 未发现水印形状，跳过。`);
      src.delete(); roi.delete(); gray.delete(); binary.delete();
      contours.delete(); hierarchy.delete(); mask.delete();
      return false;
    }

    console.log(`🛠️ [去水印-WASM] 执行 Telea 修复算法...`);
    let srcRGB = new cvInst.Mat();
    cvInst.cvtColor(src, srcRGB, cvInst.COLOR_RGBA2RGB);

    let dst = new cvInst.Mat();
    cvInst.inpaint(srcRGB, mask, dst, 3, cvInst.INPAINT_TELEA);

    // 6. 将结果转回 Sharp 并保存
    console.log(`💾 [去水印-WASM] 正在回写图片数据...`);
    const processedBuffer = Buffer.from(dst.data);
    await sharp(processedBuffer, {
      raw: { width: dst.cols, height: dst.rows, channels: 3 }
    })
    .toFile(filePath + '.tmp');

    fs.renameSync(filePath + '.tmp', filePath);
    console.log(`✅ [去水印-WASM] 修复成功！`);

    // 7. 严格清理
    src.delete(); roi.delete(); gray.delete(); binary.delete();
    contours.delete(); hierarchy.delete(); mask.delete(); 
    srcRGB.delete(); dst.delete();
    
    return true;
  } catch (error) {
    console.error('❌ [去水印-WASM] 出错:', error);
    return false;
  }
}
