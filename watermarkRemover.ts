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
    // 0. 地毯式探测 OpenCV WASM 加载完成
    console.log(`📦 [去水印-WASM] 探测导入入口... 类型: ${typeof cv}`);
    
    let cvInst: any = null;

    // 探测路径 0: 针对发现的 [ 'cv', 'cvTranslateError' ] 结构进行提取
    let potentialCv: any = cv;
    // 如果根对象有 cv 属性，说明它是包装版本
    if (potentialCv && potentialCv.cv) {
      console.log(`🔎 [去水印-WASM] 发现包装好的 .cv 属性，提取中...`);
      potentialCv = potentialCv.cv;
    } 
    // 常规解包
    else if (potentialCv && potentialCv.default) {
      console.log(`🔎 [去水印-WASM] 发现 .default 嵌套，深入解包...`);
      potentialCv = potentialCv.default;
    }

    // 探测路径 2: 检查是否是工厂函数
    if (typeof potentialCv === 'function') {
      console.log(`⏳ [去水印-WASM] 检测到工厂函数，执行并解析...`);
      try {
        // 调用工厂函数
        const result = potentialCv();
        if (result && typeof result.then === 'function') {
          cvInst = await result;
          console.log(`✅ [去水印-WASM] 工厂 Promise 解析成功`);
        } else {
          cvInst = result;
          console.log(`✅ [去水印-WASM] 工厂同步调用成功`);
        }
      } catch (e) {
        console.log(`⚠️ [去水印-WASM] 工厂模式启动失败: ${e}`);
      }
    } else {
      cvInst = potentialCv;
    }

    // 方案 B: 检查 ready 属性 (WASM 标准)
    if (cvInst && cvInst.ready && typeof cvInst.ready.then === 'function') {
      console.log(`⏳ [去水印-WASM] 检测到 .ready 属性，等待中...`);
      await cvInst.ready;
    }

    // 方案 C: 终极轮询 (10秒)
    if (!cvInst || !cvInst.Mat) {
      console.log(`⏳ [去水印-WASM] 关键 API (Mat) 仍缺失，开始 10s 轮询...`);
      const start = Date.now();
      while ((!cvInst || !cvInst.Mat) && Date.now() - start < 10000) {
        await new Promise(r => setTimeout(r, 200));
        // 特别探测：有些包会挂在全图
        if ((global as any).cv) {
          cvInst = (global as any).cv;
          if (cvInst.Mat) break;
        }
      }
    }

    if (!cvInst || !cvInst.Mat) {
      console.error(`❌ [去水印-WASM] 初始化失败。`);
      console.error(`- 根对象 Key:`, Object.keys(cv || {}));
      if (cv && (cv as any).default) console.error(`- .default 对象 Key:`, Object.keys((cv as any).default));
      throw new Error('无法定位 OpenCV Mat 构造函数。请确保依赖已正确安装并在本地运行 npm install。');
    }

    console.log(`🚀 [去水印-WASM] 环境就绪 (API版本: ${cvInst.version || '未知'})，开始像素操作...`);

    // 1. 读取图片
    const image = sharp(filePath);
    const { data: buffer, info } = await image.raw().toBuffer({ resolveWithObject: true });
    console.log(`🖼️ [去水印-WASM] 图片信息: ${info.width}x${info.height}, 通道: ${info.channels}`);
    
    // 2. 创建 Mat 并载入数据 (适配 3 或 4 通道)
    let src = new cvInst.Mat(info.height, info.width, info.channels === 4 ? cvInst.CV_8UC4 : cvInst.CV_8UC3);
    src.data.set(new Uint8Array(buffer));

    const h = src.rows;
    const w = src.cols;

    // 3. ROI 区域锁定 (稍微放宽一点点，确保不同比例下的水印都在范围内)
    const roiW = Math.floor(w * 0.15); 
    const roiH = Math.floor(h * 0.10); 
    const roiX = w - roiW - Math.floor(w * 0.01);
    const roiY = h - roiH - Math.floor(h * 0.01);
    
    const roiRect = new cvInst.Rect(roiX, roiY, roiW, roiH);
    let roi = src.roi(roiRect);
    console.log(`📍 [星型探测] ROI 区域: ${roiW}x${roiH} @ (${roiX}, ${roiY})`);

    // 4. 预处理
    let gray = new cvInst.Mat();
    if (info.channels === 4) {
      cvInst.cvtColor(roi, gray, cvInst.COLOR_RGBA2GRAY);
    } else {
      cvInst.cvtColor(roi, gray, cvInst.COLOR_RGB2GRAY);
    }
    
    // 归一化增强对比度
    cvInst.normalize(gray, gray, 0, 255, cvInst.NORM_MINMAX);

    // 关键：使用 OTSU 自动寻找该区域的最佳二值化分割点
    let binary = new cvInst.Mat();
    cvInst.threshold(gray, binary, 0, 255, cvInst.THRESH_BINARY + cvInst.THRESH_OTSU);

    // 形态学膨胀：让纤细的星角变粗，防止被面积过滤掉
    let kSize = new cvInst.Size(3, 3);
    let kernel = cvInst.getStructuringElement(cvInst.MORPH_RECT, kSize);
    cvInst.dilate(binary, binary, kernel);

    // 5. 轮廓提取
    let contours = new cvInst.MatVector();
    let hierarchy = new cvInst.Mat();
    cvInst.findContours(binary, contours, hierarchy, cvInst.RETR_EXTERNAL, cvInst.CHAIN_APPROX_SIMPLE);
    
    console.log(`🔍 [星型探测] 区域内候选轮廓数: ${contours.size()}`);
    
    let mask = cvInst.Mat.zeros(h, w, cvInst.CV_8UC1);
    let watermarkFound = false;

    const whiteScalar = new cvInst.Scalar(255, 255, 255, 255);
    const offsetPoint = new cvInst.Point(roiX, roiY);

    for (let i = 0; i < contours.size(); ++i) {
      const cnt = contours.get(i);
      const area = cvInst.contourArea(cnt);
      const rect = cvInst.boundingRect(cnt);
      const aspect = rect.width / rect.height;

      // 诊断：记录所有中等大小的轮廓以便分析为何失败
      if (area > 20 && area < 5000) {
        console.log(`📎 [星型探测] 候选 [${i}]: 面积=${Math.round(area)}, 比例=${aspect.toFixed(2)}, 坐标=(${rect.x}, ${rect.y})`);
      }

      // 星型水印指纹 (放宽准入标准):
      // 1. 面积从 40 开启 (适配小水印)
      // 2. 长宽比在 0.4 - 2.5 之间
      if (area >= 40 && area < 4000) {
        if (aspect > 0.4 && aspect < 2.5) {
          console.log(`✨ [星型探测] 匹配成功！目标 [${i}] 正在生成蒙版...`);
          cvInst.drawContours(mask, contours, i, whiteScalar, -1, cvInst.LINE_8, hierarchy, 0, offsetPoint);
          watermarkFound = true;
        }
      }
    }

    if (!watermarkFound) {
      console.log(`⚠️ [星型探测] 无法定位符合几何指纹的形状，跳过。`);
      src.delete(); roi.delete(); gray.delete(); binary.delete(); contours.delete(); hierarchy.delete(); mask.delete(); kernel.delete();
      return false;
    }

    // --- 极速膨胀 ---
    let dilatedMask = new cvInst.Mat();
    let dKernel = cvInst.getStructuringElement(cvInst.MORPH_RECT, new cvInst.Size(7, 7)); // 覆盖尖角阴影
    cvInst.dilate(mask, dilatedMask, dKernel);
    
    console.log(`🎭 [星型探测] 修复蒙版大小: ${cvInst.countNonZero(dilatedMask)} 像素`);

    // 6. 核心：Telea 修复
    console.log(`🛠️ [星型探测] 正在执行智能填充算法...`);
    let srcRGB = new cvInst.Mat();
    if (info.channels === 4) {
      cvInst.cvtColor(src, srcRGB, cvInst.COLOR_RGBA2RGB);
    } else {
      src.copyTo(srcRGB);
    }

    let dst = new cvInst.Mat();
    cvInst.inpaint(srcRGB, dilatedMask, dst, 5, cvInst.INPAINT_TELEA);

    // 7. 保存结果
    const processedBuffer = Buffer.from(dst.data);
    const ext = path.extname(filePath).toLowerCase();
    const tempPath = filePath.replace(ext, `.tmp${ext}`);
    
    const sharpInstance = sharp(processedBuffer, {
      raw: { width: dst.cols, height: dst.rows, channels: 3 }
    });

    if (ext === '.jpg' || ext === '.jpeg') {
      await sharpInstance.jpeg({ quality: 95, mozjpeg: true }).toFile(tempPath);
    } else if (ext === '.png') {
      await sharpInstance.png({ compressionLevel: 9, effort: 10 }).toFile(tempPath);
    } else {
      await sharpInstance.toFormat(ext.replace('.', '') as any).toFile(tempPath);
    }

    fs.renameSync(tempPath, filePath);
    console.log(`✅ [去水印-WASM] 任务处理完成，画质已同步。`);

    // 8. 严格内存释放
    src.delete(); roi.delete(); gray.delete(); binary.delete(); 
    contours.delete(); hierarchy.delete(); mask.delete(); 
    dilatedMask.delete(); kernel.delete();
    srcRGB.delete(); dst.delete();
    
    return true;
  } catch (error) {
    console.error('❌ [去水印-WASM] 出错:', error);
    return false;
  }
}
