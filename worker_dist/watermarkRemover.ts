import cv from 'opencv-wasm';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

/**
 * 使用 opencv-wasm 实现的高质量去水印方案
 * mode: 'performance' (500-800KB 视觉无损) | 'highQuality' (~2MB 高保真)
 */
export async function autoInpaint(
  filePath: string, 
  mode: 'performance' | 'highQuality' | 'fastSpeed' = 'performance'
): Promise<boolean> {
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

    let binary = new cvInst.Mat();
    let contours = new cvInst.MatVector();
    let hierarchy = new cvInst.Mat();
    let mask = cvInst.Mat.zeros(h, w, cvInst.CV_8UC1);
    let watermarkFound = false;
    const whiteScalar = new cvInst.Scalar(255, 255, 255, 255);
    const offsetPoint = new cvInst.Point(roiX, roiY);

    /**
     * 第一阶段：OTSU 自动阈值探测 (标准模式)
     * 适合水印与背景有明显区分度的情况
     */
    console.log(`📡 [第一阶段] 尝试 OTSU 自动阈值识别...`);
    cvInst.threshold(gray, binary, 0, 255, cvInst.THRESH_BINARY + cvInst.THRESH_OTSU);
    let kernel = cvInst.getStructuringElement(cvInst.MORPH_RECT, new cvInst.Size(3, 3));
    cvInst.dilate(binary, binary, kernel);
    cvInst.findContours(binary, contours, hierarchy, cvInst.RETR_EXTERNAL, cvInst.CHAIN_APPROX_SIMPLE);

    const checkContours = (stage: string) => {
      let foundInThisStage = false;
      for (let i = 0; i < contours.size(); ++i) {
        const cnt = contours.get(i);
        const area = cvInst.contourArea(cnt);
        const rect = cvInst.boundingRect(cnt);
        const aspect = rect.width / rect.height;
  
        // 星型水印面积通常在 40-1000 之间 (取决于原图分辨率)
        if (area >= 30 && area < 5000) {
          if (aspect > 0.3 && aspect < 3.0) {
            console.log(`✨ [${stage}] 匹配成功！目标 [${i}]: 面积=${Math.round(area)}, 比例=${aspect.toFixed(2)}`);
            cvInst.drawContours(mask, contours, i, whiteScalar, -1, cvInst.LINE_8, hierarchy, 0, offsetPoint);
            watermarkFound = true;
            foundInThisStage = true;
          }
        }
      }
      return foundInThisStage;
    };

    checkContours("第一阶段");

    /**
     * 第二阶段：局部对比度增强 (CLAHE/拉伸模式)
     * 针对“光亮背景+淡色水印”导致无法二值化的情况。
     * 手动拉伸亮部区域的动态范围，强行让水印轮廓浮现。
     */
    if (!watermarkFound) {
      console.log(`📡 [第二阶段] 激活对比度增强模式 (CLAHE)...`);
      let clGray = new cvInst.Mat();
      // 这里不使用内置 CLAHE 以防 WASM 版本不支持，手动进行局部增益处理
      // 我们对 ROI 进行极端的亮度平衡：找到最亮的和平均亮度，然后拉开差距
      let minMax = cvInst.minMaxLoc(gray);
      let alpha = 255 / (minMax.maxVal - minMax.minVal + 1);
      let beta = -minMax.minVal * alpha;
      gray.convertTo(clGray, -1, alpha * 1.5, beta); // 激进的对比度系数
      
      cvInst.threshold(clGray, binary, 200, 255, cvInst.THRESH_BINARY);
      cvInst.findContours(binary, contours, hierarchy, cvInst.RETR_EXTERNAL, cvInst.CHAIN_APPROX_SIMPLE);
      checkContours("第二阶段");
      clGray.delete();
    }

    /**
     * 第三阶段：梯度边缘检测 (Canny/直线骨架模式)
     * 如果前两阶段的“面”识别都失败（水印完全融入背景色），则通过检测水印的“笔直边缘”来抓取特征。
     * 星型水印具有非常强烈的几何直线特征。
     */
    if (!watermarkFound) {
      console.log(`📡 [第三阶段] 激活梯度边缘检测 (Canny)...`);
      let edges = new cvInst.Mat();
      // 使用 Canny 算子抓取高频边缘，忽略颜色深浅
      cvInst.Canny(gray, edges, 50, 150, 3);
      
      // 对边缘进行一次厚度扩张，让细小的直线连接
      let edgeKernel = cvInst.getStructuringElement(cvInst.MORPH_RECT, new cvInst.Size(5, 5));
      cvInst.dilate(edges, edges, edgeKernel);
      
      cvInst.findContours(edges, contours, hierarchy, cvInst.RETR_EXTERNAL, cvInst.CHAIN_APPROX_SIMPLE);
      
      // 第三阶段的面积判断稍微严格一点，防止误伤自然的纹理
      for (let i = 0; i < contours.size(); ++i) {
        const cnt = contours.get(i);
        const area = cvInst.contourArea(cnt);
        const rect = cvInst.boundingRect(cnt);
        const aspect = rect.width / rect.height;
        
        // 星型轮廓即便在边缘模式下，宽高比也应接近 1:1
        if (area >= 60 && area < 2000 && aspect > 0.6 && aspect < 1.6) {
          console.log(`✨ [第三阶段] 成功通过边缘匹配定位水印！`);
          cvInst.drawContours(mask, contours, i, whiteScalar, -1, cvInst.LINE_8, hierarchy, 0, offsetPoint);
          watermarkFound = true;
        }
      }
      edges.delete();
      edgeKernel.delete();
    }

    if (!watermarkFound) {
      console.log(`⚠️ [星型探测] 经过三阶段地毯式搜索，仍无法定位水印特征。`);
      src.delete(); roi.delete(); gray.delete(); binary.delete(); contours.delete(); hierarchy.delete(); mask.delete(); kernel.delete();
      return false;
    }

    // --- 极速膨胀 ---
    let dilatedMask = new cvInst.Mat();
    // 显著增加膨胀半径 (7x7 -> 15x15)，确保彻底覆盖水印周围的任何残余阴影、光晕或抗锯齿边缘
    let dKernel = cvInst.getStructuringElement(cvInst.MORPH_RECT, new cvInst.Size(15, 15)); 
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
    // 增加修复半径 (5 -> 7) 以获得更平滑的融合效果
    cvInst.inpaint(srcRGB, dilatedMask, dst, 7, cvInst.INPAINT_TELEA);

    // 7. 保存结果 (提供两种模式：极致性能 vs 高保真)
    const ext = path.extname(filePath).toLowerCase();
    
    const sharpInstance = sharp(Buffer.from(dst.data), {
      raw: { width: dst.cols, height: dst.rows, channels: dst.channels() }
    });
    
    let outBuffer: Buffer;
    if (mode === 'fastSpeed') {
      console.log(`⚡ [去水印-WASM] 采用极速模式 (强制转换 JPG 极小体积)`);
      // 极速模式：统一强制转为 JPEG，配合 75 质量。
      // 对于原本 6-7MB 的文件，不论原来是 PNG 还是什么，这能直接降压到 300-500KB。
      outBuffer = await sharpInstance.jpeg({ 
        quality: 75, 
        mozjpeg: true, 
        chromaSubsampling: '4:2:0',
        progressive: true
      }).toBuffer();
    } else if (mode === 'performance') {
      console.log(`🚀 [去水印-WASM] 采用极致性能模式 (视觉无损压缩)`);
      if (ext === '.jpg' || ext === '.jpeg') {
        // 82 质量 + 4:2:0 采样 + MozJPEG，体积通常能减小 60-70%，肉眼几乎无感
        outBuffer = await sharpInstance.jpeg({ 
          quality: 82, 
          mozjpeg: true, 
          chromaSubsampling: '4:2:0',
          progressive: true 
        }).toBuffer();
      } else if (ext === '.png') {
        // PNG 性能模式：开启有损压缩 (palette + quality 75)
        // 这是将 2MB PNG 压到 800KB 以下的关键
        outBuffer = await sharpInstance.png({ 
          compressionLevel: 9, 
          palette: true, 
          quality: 75,
          effort: 6
        }).toBuffer();
      } else {
        outBuffer = await sharpInstance.webp({ quality: 80 }).toBuffer();
      }
    } else {
      console.log(`🎨 [去水印-WASM] 采用高保真模式 (保持原始体感体积)`);
      if (ext === '.jpg' || ext === '.jpeg') {
        outBuffer = await sharpInstance.jpeg({ quality: 95, mozjpeg: true }).toBuffer();
      } else if (ext === '.png') {
        outBuffer = await sharpInstance.png({ compressionLevel: 6 }).toBuffer();
      } else {
        outBuffer = await sharpInstance.toFormat(ext.replace('.', '') as any).toBuffer();
      }
    }

    fs.writeFileSync(filePath, outBuffer);
    console.log(`✅ [去水印-WASM] 任务处理完成，文件已按 [${mode}] 模式写回。`);

    // 8. 严格内存释放
    src.delete(); roi.delete(); gray.delete(); binary.delete(); 
    contours.delete(); hierarchy.delete(); mask.delete(); 
    dilatedMask.delete(); kernel.delete(); dKernel.delete();
    srcRGB.delete(); dst.delete();
    
    return true;
  } catch (error) {
    console.error('❌ [去水印-WASM] 出错:', error);
    return false;
  }
}
