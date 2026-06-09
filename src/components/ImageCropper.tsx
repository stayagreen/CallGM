import React, { useState, useRef, useEffect } from 'react';
import { X, ZoomIn, ZoomOut, RotateCcw, Crop, Minimize, Maximize } from 'lucide-react';

interface ImageCropperProps {
  imageSrc: string;
  aspectRatio: string; // "3:4" | "4:3" | "9:16" | "16:9"
  onClose: () => void;
  onCropComplete: (base64Url: string) => void;
}

export const ImageCropper: React.FC<ImageCropperProps> = ({
  imageSrc,
  aspectRatio,
  onClose,
  onCropComplete
}) => {
  const [scale, setScale] = useState<number>(1);
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [imageLoaded, setImageLoaded] = useState<boolean>(false);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [cropBoxSize, setCropBoxSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [initSize, setInitSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [initPos, setInitPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isMuted, setIsMuted] = useState<boolean>(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  // Parse aspect ratio value
  const getAspectValue = (): number => {
    if (!aspectRatio) return 3 / 4;
    const parts = aspectRatio.split(':');
    if (parts.length === 2) {
      const w = parseFloat(parts[0]);
      const h = parseFloat(parts[1]);
      if (w > 0 && h > 0) return w / h;
    }
    return 3 / 4;
  };

  const aspectVal = getAspectValue();

  // Calculate sizes on container sizing and image loaded
  useEffect(() => {
    if (!imageSrc) return;
    
    const imgObj = new Image();
    // Support proxy and cors
    if (imageSrc.startsWith('http') && !imageSrc.includes('localhost') && !imageSrc.includes('127.0.0.1')) {
      imgObj.crossOrigin = 'anonymous';
    }
    imgObj.src = imageSrc;
    imgObj.onload = () => {
      setNaturalSize({ w: imgObj.naturalWidth, h: imgObj.naturalHeight });
      setImageLoaded(true);
      setScale(1);
      setOffset({ x: 0, y: 0 });
    };
  }, [imageSrc]);

  // Adjust crop box size inside responsive window viewport
  useEffect(() => {
    if (!imageLoaded) return;

    // We constrain the crop box to stay neatly within the viewport (max width 340px, max height 340px)
    const cropMax = Math.min(window.innerWidth - 60, 340);
    let boxW = cropMax;
    let boxH = cropMax;

    if (aspectVal > 1) { // Landscape
      boxW = cropMax;
      boxH = cropMax / aspectVal;
    } else { // Portrait
      boxH = cropMax;
      boxW = cropMax * aspectVal;
    }

    setCropBoxSize({ w: boxW, h: boxH });

    // Calculate initial fill scale (image must cover the entire crop box area)
    const imgAspect = naturalSize.w / naturalSize.h;
    let initialW = 0;
    let initialH = 0;

    if (imgAspect > aspectVal) {
      // Image is wider, stretch height to fill crop box, crop width
      initialH = boxH;
      initialW = boxH * imgAspect;
    } else {
      // Image is narrower, stretch width to fill crop box, crop height
      initialW = boxW;
      initialH = boxW / imgAspect;
    }

    setInitSize({ w: initialW, h: initialH });

    // Center image inside crop box initially
    setInitPos({
      x: (boxW - initialW) / 2,
      y: (boxH - initialH) / 2
    });

  }, [imageLoaded, aspectVal, naturalSize, aspectRatio]);

  // Drag handlers (Mouse + Touch)
  const handleStart = (clientX: number, clientY: number) => {
    setIsDragging(true);
    setDragStart({
      x: clientX - offset.x,
      y: clientY - offset.y
    });
  };

  const handleMove = (clientX: number, clientY: number) => {
    if (!isDragging) return;
    
    const nextX = clientX - dragStart.x;
    const nextY = clientY - dragStart.y;

    // Constraint boundary so the image doesn't slide completely off the view
    // Allow generous bounds for flexibility
    const boundX = initSize.w * scale / 2;
    const boundY = initSize.h * scale / 2;

    setOffset({
      x: Math.max(-boundX, Math.min(boundX, nextX)),
      y: Math.max(-boundY, Math.min(boundY, nextY))
    });
  };

  const handleEnd = () => {
    setIsDragging(false);
  };

  // Perform canvas cropping and emit Base64 image
  const handleSaveCrop = () => {
    if (!imageLoaded) return;

    // Set nice high-res target output size depending on selection (e.g. 1200px height for 3:4)
    let outputW = 900;
    let outputH = 1200;

    if (aspectVal > 1) {
      outputW = 1200;
      outputH = Math.round(1200 / aspectVal);
    } else {
      outputH = 1200;
      outputW = Math.round(1200 * aspectVal);
    }

    const canvas = document.createElement('canvas');
    canvas.width = outputW;
    canvas.height = outputH;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      alert('无法创建绘图上下文，请重试');
      return;
    }

    const img = new Image();
    if (imageSrc.startsWith('http') && !imageSrc.includes('localhost')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => {
      // Clear canvas with white background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, outputW, outputH);

      // The multiplier mapping factor from screen space to canvas output workspace
      const ratio = outputW / cropBoxSize.w;

      const w = initSize.w * ratio;
      const h = initSize.h * ratio;

      // Draw original image relative to the center of output workspace
      ctx.save();
      ctx.translate(outputW / 2, outputH / 2);
      ctx.translate(offset.x * ratio, offset.y * ratio);
      ctx.scale(scale, scale);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      ctx.restore();

      // Export as high quality JPEG
      try {
        const resultBase64 = canvas.toDataURL('image/jpeg', 0.9);
        onCropComplete(resultBase64);
      } catch (err) {
        console.error('Error generating cropped canvas image:', err);
        alert('裁剪导出失败，原因可能由于原图资源跨域安全限制导致，请尝试使用别的图片素材。');
      }
    };
    img.src = imageSrc;
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex flex-col justify-between p-4 z-[2000] select-none text-white animate-fade-in">
      {/* Header */}
      <div className="flex justify-between items-center max-w-lg mx-auto w-full pt-2">
        <div>
          <h3 className="font-bold text-lg flex items-center gap-2 text-red-100">
            <Crop className="text-red-500" size={20} /> 裁剪小红书封面
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">将图片拖拽并缩放到理想视窗范围，生成完美专属封面</p>
        </div>
        <button 
          onClick={onClose}
          className="p-2 hover:bg-white/10 rounded-full text-gray-400 hover:text-white transition-all"
        >
          <X size={22} />
        </button>
      </div>

      {/* Main Interactive Stage */}
      <div 
        ref={containerRef}
        className="flex-grow flex items-center justify-center relative w-full h-full max-h-[50vh] sm:max-h-[55vh] md:max-h-[60vh] select-none"
      >
        {!imageLoaded ? (
          <div className="flex flex-col items-center gap-3">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-red-500 border-t-transparent"></div>
            <p className="text-sm text-gray-400">正在加载并准备您的封面资源...</p>
          </div>
        ) : (
          /* Spotlight Container */
          <div className="relative flex items-center justify-center w-full h-full">
            {/* The fixed size responsive visual crop bounding box */}
            <div 
              className="relative overflow-hidden cursor-move border-2 border-red-500 shadow-2xl bg-zinc-950 shadow-black/80"
              style={{
                width: `${cropBoxSize.w}px`,
                height: `${cropBoxSize.h}px`,
              }}
              onMouseDown={(e) => handleStart(e.clientX, e.clientY)}
              onMouseMove={(e) => handleMove(e.clientX, e.clientY)}
              onMouseUp={handleEnd}
              onMouseLeave={handleEnd}
              onTouchStart={(e) => {
                if (e.touches.length === 1) {
                  handleStart(e.touches[0].clientX, e.touches[0].clientY);
                }
              }}
              onTouchMove={(e) => {
                if (e.touches.length === 1) {
                  handleMove(e.touches[0].clientX, e.touches[0].clientY);
                }
              }}
              onTouchEnd={handleEnd}
            >
              {/* Target Image overlay rendered inside box boundaries */}
              <div
                className="absolute origin-center will-change-transform pointer-events-none"
                style={{
                  width: `${initSize.w}px`,
                  height: `${initSize.h}px`,
                  left: `${initPos.x}px`,
                  top: `${initPos.y}px`,
                  transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                }}
              >
                <img
                  ref={imageRef}
                  src={imageSrc}
                  className="w-full h-full object-fill pointer-events-none"
                  alt="Crop Target"
                  draggable={false}
                />
              </div>

              {/* Composition Guideline lines (Rule of third) */}
              <div className="absolute inset-0 pointer-events-none grid grid-cols-3 grid-rows-3 border border-white/20">
                <div className="border-r border-b border-white/10"></div>
                <div className="border-r border-b border-white/10"></div>
                <div className="border-b border-white/10"></div>
                <div className="border-r border-b border-white/10"></div>
                <div className="border-r border-b border-white/10"></div>
                <div className="border-b border-white/10"></div>
                <div className="border-r border-white/10"></div>
                <div className="border-r border-white/10"></div>
                <div></div>
              </div>
            </div>
            
            {/* Context Info Label on Aspect ratio */}
            <div className="absolute bottom-2 bg-black/70 px-3 py-1 rounded text-xs font-mono font-bold tracking-wide border border-white/10 pointer-events-none">
              比例：{aspectRatio}
            </div>
          </div>
        )}
      </div>

      {/* Control Panel Area */}
      <div className="max-w-lg mx-auto w-full flex flex-col gap-5 pb-6">
        {/* Zoom adjustment slide controller */}
        <div className="bg-zinc-900/60 p-4 rounded-xl border border-white/5 backdrop-blur">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-300 font-bold flex items-center gap-1.5 leading-none">
              <ZoomOut size={14} className="text-gray-400" />
              缩放调节
              <ZoomIn size={14} className="text-gray-400" />
            </span>
            <span className="text-xs font-mono text-gray-400 leading-none">
              {Math.round(scale * 100)}%
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button 
              disabled={!imageLoaded || scale <= 0.8}
              onClick={() => setScale(prev => Math.max(0.8, prev - 0.1))}
              className="p-1 px-2.5 rounded bg-white/5 hover:bg-white/10 active:bg-white/20 text-sm font-bold disabled:opacity-40 transition-colors"
            >
              -
            </button>
            <input 
              type="range"
              min="0.8"
              max="4"
              step="0.01"
              disabled={!imageLoaded}
              className="flex-grow accent-red-500 h-1.5 rounded-lg bg-gray-700 cursor-pointer"
              value={scale}
              onChange={(e) => setScale(parseFloat(e.target.value))}
            />
            <button 
              disabled={!imageLoaded || scale >= 4}
              onClick={() => setScale(prev => Math.min(4, prev + 0.1))}
              className="p-1 px-2.5 rounded bg-white/5 hover:bg-white/10 active:bg-white/20 text-sm font-bold disabled:opacity-40 transition-colors"
            >
              +
            </button>
          </div>
        </div>

        {/* Action button triggers */}
        <div className="flex justify-between items-center gap-3">
          <button
            onClick={() => {
              setScale(1);
              setOffset({ x: 0, y: 0 });
            }}
            disabled={!imageLoaded}
            className="flex items-center justify-center gap-1.5 px-4 py-3 border border-white/10 rounded-xl bg-white/5 hover:bg-white/10 active:bg-white/20 text-sm font-semibold transition-colors flex-grow"
          >
            <RotateCcw size={16} />
            重置居中
          </button>
          
          <button
            onClick={handleSaveCrop}
            disabled={!imageLoaded}
            className="flex items-center justify-center gap-1.5 px-6 py-3 rounded-xl bg-red-500 hover:bg-red-600 active:bg-red-700 text-sm font-bold shadow-lg shadow-red-500/20 text-white transition-colors flex-grow"
          >
            <Crop size={16} />
            确认裁剪
          </button>
        </div>
      </div>
    </div>
  );
};
