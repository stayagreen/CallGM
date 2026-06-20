import React, { useState, useRef, useEffect } from 'react';
import { X, RotateCcw, Check, Sparkles, Sliders } from 'lucide-react';

interface ImageAdjusterProps {
  imageSrc: string;
  onClose: () => void;
  onAdjustComplete: (base64Url: string) => void;
}

export const ImageAdjuster: React.FC<ImageAdjusterProps> = ({
  imageSrc,
  onClose,
  onAdjustComplete
}) => {
  const [brightness, setBrightness] = useState<number>(0); // -100 to 100
  const [saturation, setSaturation] = useState<number>(0); // -100 to 100
  const [contrast, setContrast] = useState<number>(0);     // -100 to 100
  const [sharpness, setSharpness] = useState<number>(0);   // 0 to 100

  const [imageLoaded, setImageLoaded] = useState<boolean>(false);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [displaySize, setDisplaySize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Load Image
  useEffect(() => {
    if (!imageSrc) return;
    const img = new Image();
    if (imageSrc.startsWith('http') && !imageSrc.includes('localhost') && !imageSrc.includes('127.0.0.1')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => {
      setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
      setImageLoaded(true);

      // Calculate safe display dimensions within viewport
      const maxW = Math.min(window.innerWidth - 64, 400);
      const maxH = Math.min(window.innerHeight - 340, 400);
      const ratio = img.naturalWidth / img.naturalHeight;

      let w = maxW;
      let h = maxW / ratio;

      if (h > maxH) {
        h = maxH;
        w = maxH * ratio;
      }

      setDisplaySize({ w, h });
    };
    img.src = imageSrc;
  }, [imageSrc]);

  // Apply real-time canvas preview of basic settings (brightness, saturation, contrast) and sharpening
  useEffect(() => {
    if (!imageLoaded || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    if (imageSrc.startsWith('http') && !imageSrc.includes('localhost') && !imageSrc.includes('127.0.0.1')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => {
      canvas.width = displaySize.w;
      canvas.height = displaySize.h;

      // 1. Render brightness, contrast, saturation using canvas engine filter
      const bFilter = 100 + brightness;
      const cFilter = 100 + contrast;
      const sFilter = 100 + saturation;
      ctx.filter = `brightness(${bFilter}%) contrast(${cFilter}%) saturate(${sFilter}%)`;
      
      ctx.drawImage(img, 0, 0, displaySize.w, displaySize.h);

      // 2. Clear filter
      ctx.filter = 'none';

      // 3. Apply sharpness if > 0 via highly optimized kernel convolution
      if (sharpness > 0) {
        const imageData = ctx.getImageData(0, 0, displaySize.w, displaySize.h);
        const k = (sharpness / 100) * 0.8; // kernel scale factor
        const weights = [
          0,  -k,   0,
          -k, 1 + 4*k, -k,
          0,  -k,   0
        ];
        applyConvolution(imageData, weights);
        ctx.putImageData(imageData, 0, 0);
      }
    };
    img.src = imageSrc;
  }, [imageLoaded, brightness, saturation, contrast, sharpness, displaySize, imageSrc]);

  // Highly optimized CPU kernel convolution matrix
  const applyConvolution = (imageData: ImageData, weights: number[]) => {
    const src = imageData.data;
    const sw = imageData.width;
    const sh = imageData.height;
    const output = new Uint8ClampedArray(src.length);

    // 3x3 kernel hardcoded outer boundary
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const dstOff = (y * sw + x) * 4;
        let r = 0, g = 0, b = 0;

        // Perform fast standard neighborhood grid loop
        for (let cy = 0; cy < 3; cy++) {
          const dy = Math.min(sh - 1, Math.max(0, y + cy - 1));
          const rowOff = dy * sw;
          
          for (let cx = 0; cx < 3; cx++) {
            const dx = Math.min(sw - 1, Math.max(0, x + cx - 1));
            const srcOff = (rowOff + dx) * 4;
            const wt = weights[cy * 3 + cx];

            r += src[srcOff] * wt;
            g += src[srcOff + 1] * wt;
            b += src[srcOff + 2] * wt;
          }
        }

        output[dstOff] = r < 0 ? 0 : (r > 255 ? 255 : r);
        output[dstOff + 1] = g < 0 ? 0 : (g > 255 ? 255 : g);
        output[dstOff + 2] = b < 0 ? 0 : (b > 255 ? 255 : b);
        output[dstOff + 3] = src[dstOff + 3]; // preserve original alpha
      }
    }

    // Copy modified buffer back safely
    for (let i = 0; i < src.length; i++) {
      src[i] = output[i];
    }
  };

  const handleSaveAdjust = () => {
    if (!imageLoaded) return;

    // Export using high resolution (natural sizes) to maintain image crispness
    const canvas = document.createElement('canvas');
    canvas.width = naturalSize.w;
    canvas.height = naturalSize.h;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      alert('导出由于内存或配置原因失败，请重试');
      return;
    }

    const img = new Image();
    if (imageSrc.startsWith('http') && !imageSrc.includes('localhost') && !imageSrc.includes('127.0.0.1')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => {
      // 1. Draw base high contrast/brightness/saturation image
      const bFilter = 100 + brightness;
      const cFilter = 100 + contrast;
      const sFilter = 100 + saturation;
      ctx.filter = `brightness(${bFilter}%) contrast(${cFilter}%) saturate(${sFilter}%)`;
      ctx.drawImage(img, 0, 0, naturalSize.w, naturalSize.h);
      ctx.filter = 'none';

      // 2. Apply high-res kernel convolution for absolute perfection
      if (sharpness > 0) {
        const imageData = ctx.getImageData(0, 0, naturalSize.w, naturalSize.h);
        const k = (sharpness / 100) * 1.2; // stronger strength on high-res to notice difference
        const weights = [
          0,  -k,   0,
          -k, 1 + 4*k, -k,
          0,  -k,   0
        ];
        applyConvolution(imageData, weights);
        ctx.putImageData(imageData, 0, 0);
      }

      // 3. Export high-res jpg
      try {
        const base64Url = canvas.toDataURL('image/jpeg', 0.95);
        onAdjustComplete(base64Url);
      } catch (e) {
        console.error('Error saving adjusted photo:', e);
        alert('导出失败：存在外部图片跨域安全限制，请更换其他分镜或封面图片重试。');
      }
    };
    img.src = imageSrc;
  };

  const resetAll = () => {
    setBrightness(0);
    setSaturation(0);
    setContrast(0);
    setSharpness(0);
  };

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex flex-col justify-between p-4 z-[2000] select-none text-white animate-fade-in">
      {/* Header */}
      <div className="flex justify-between items-center max-w-lg mx-auto w-full pt-1">
        <div>
          <h3 className="font-bold text-lg flex items-center gap-2 text-purple-100">
            <Sliders className="text-purple-400" size={20} /> 调整封面画质与表现
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">微调封面亮度、对比度、色彩，让封面在小红书信息流中更吸睛✨</p>
        </div>
        <button 
          onClick={onClose}
          className="p-2 hover:bg-white/10 rounded-full text-gray-400 hover:text-white transition-all"
        >
          <X size={22} />
        </button>
      </div>

      {/* Preview Screen area */}
      <div 
        ref={containerRef}
        className="flex-grow flex items-center justify-center relative w-full h-full max-h-[48vh] sm:max-h-[52vh] md:max-h-[56vh] select-none"
      >
        {!imageLoaded ? (
          <div className="flex flex-col items-center gap-3">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-purple-500 border-t-transparent"></div>
            <p className="text-sm text-gray-400">正在获取封面细节并校准图像中...</p>
          </div>
        ) : (
          <div className="relative border-4 border-white/10 rounded-xl overflow-hidden shadow-2xl bg-zinc-950 flex items-center justify-center">
            <canvas 
              ref={canvasRef} 
              style={{
                width: `${displaySize.w}px`,
                height: `${displaySize.h}px`,
              }}
              className="max-w-full block"
            />
          </div>
        )}
      </div>

      {/* Controllers Area */}
      <div className="max-w-lg mx-auto w-full flex flex-col gap-3 pb-4">
        <div className="bg-zinc-900/85 p-4 rounded-xl border border-white/5 space-y-3 shadow-lg">
          
          {/* Brightness */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-zinc-300">
              <span className="font-semibold flex items-center gap-1">亮度 (Brightness)</span>
              <span className="font-mono text-xs">{brightness > 0 ? `+${brightness}` : brightness}</span>
            </div>
            <input 
              type="range"
              min="-60"
              max="60"
              step="1"
              disabled={!imageLoaded}
              className="w-full accent-purple-500 h-1.5 rounded-lg bg-zinc-800 cursor-pointer"
              value={brightness}
              onChange={(e) => setBrightness(parseInt(e.target.value, 10))}
            />
          </div>

          {/* Contrast */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-zinc-300">
              <span className="font-semibold flex items-center gap-1">对比度 (Contrast)</span>
              <span className="font-mono text-xs">{contrast > 0 ? `+${contrast}` : contrast}</span>
            </div>
            <input 
              type="range"
              min="-60"
              max="60"
              step="1"
              disabled={!imageLoaded}
              className="w-full accent-purple-500 h-1.5 rounded-lg bg-zinc-800 cursor-pointer"
              value={contrast}
              onChange={(e) => setContrast(parseInt(e.target.value, 10))}
            />
          </div>

          {/* Saturation */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-zinc-300">
              <span className="font-semibold flex items-center gap-1">饱和度 (Saturation)</span>
              <span className="font-mono text-xs">{saturation > 0 ? `+${saturation}` : saturation}</span>
            </div>
            <input 
              type="range"
              min="-60"
              max="60"
              step="1"
              disabled={!imageLoaded}
              className="w-full accent-purple-500 h-1.5 rounded-lg bg-zinc-800 cursor-pointer"
              value={saturation}
              onChange={(e) => setSaturation(parseInt(e.target.value, 10))}
            />
          </div>

          {/* Sharpness */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-zinc-300">
              <span className="font-semibold flex items-center gap-1">锐度 (Sharpness)</span>
              <span className="font-mono text-xs">+{sharpness}</span>
            </div>
            <input 
              type="range"
              min="0"
              max="100"
              step="1"
              disabled={!imageLoaded}
              className="w-full accent-purple-500 h-1.5 rounded-lg bg-zinc-800 cursor-pointer"
              value={sharpness}
              onChange={(e) => setSharpness(parseInt(e.target.value, 10))}
            />
          </div>

        </div>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            onClick={resetAll}
            disabled={!imageLoaded || (brightness === 0 && saturation === 0 && contrast === 0 && sharpness === 0)}
            className="flex items-center justify-center gap-1 px-4 py-3 border border-white/10 rounded-xl bg-white/5 hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-30 text-sm font-semibold transition-colors flex-grow cursor-pointer"
          >
            <RotateCcw size={16} />
            重置参数
          </button>
          
          <button
            onClick={handleSaveAdjust}
            disabled={!imageLoaded}
            className="flex items-center justify-center gap-1.5 px-6 py-3 rounded-xl bg-purple-600 hover:bg-purple-700 active:bg-purple-800 text-sm font-bold shadow-lg shadow-purple-600/20 text-white transition-colors flex-grow cursor-pointer"
          >
            <Check size={16} />
            应用调整
          </button>
        </div>
      </div>
    </div>
  );
};
