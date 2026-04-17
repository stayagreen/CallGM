import React, { useState, useRef, useEffect } from 'react';
import { X, Scissors, Target, Undo2 } from 'lucide-react';
import ReactCrop, { type Crop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';

export interface ImageEditorProps {
  image: string;
  onSave: (newImage: string) => void;
  onCancel: () => void;
  onProcessStart?: () => void;
}

export default function ImageEditor({ image, onSave, onCancel, onProcessStart }: ImageEditorProps) {
  const [crop, setCrop] = useState<Crop>();
  const [isSmudging, setIsSmudging] = useState(false);
  const [smudgeMode, setSmudgeMode] = useState<'inpaint' | 'stamp'>('inpaint');
  const [brushSize, setBrushSize] = useState(40);
  const [brushFeather, setBrushFeather] = useState(20);
  const [isDrawing, setIsDrawing] = useState(false);
  const [undoHistory, setUndoHistory] = useState<{main: ImageData, mask: ImageData}[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSelectingSource, setIsSelectingSource] = useState(false);
  const [stampSource, setStampSource] = useState<{x: number, y: number} | null>(null);
  const [ctx, setCtx] = useState<CanvasRenderingContext2D | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const lastPos = useRef<{x: number, y: number} | null>(null);
  const startPos = useRef<{x: number, y: number} | null>(null);
  const stampOffset = useRef<{dx: number, dy: number} | null>(null);

  useEffect(() => {
    if (!isSmudging || !canvasRef.current || !imageRef.current) return;

    const canvas = canvasRef.current;
    const img = imageRef.current;
    
    const updateCanvasSize = () => {
      const context = canvas.getContext('2d');
      if (!context) return;

      const naturalRatio = img.naturalWidth / img.naturalHeight;
      const clientRatio = img.clientWidth / img.clientHeight;
      
      let renderWidth, renderHeight;
      if (naturalRatio > clientRatio) {
        renderWidth = img.clientWidth;
        renderHeight = img.clientWidth / naturalRatio;
      } else {
        renderHeight = img.clientHeight;
        renderWidth = img.clientHeight * naturalRatio;
      }

      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      
      if (maskCanvasRef.current) {
        maskCanvasRef.current.width = img.naturalWidth;
        maskCanvasRef.current.height = img.naturalHeight;
        maskCanvasRef.current.style.width = `${renderWidth}px`;
        maskCanvasRef.current.style.height = `${renderHeight}px`;
      }
      
      canvas.style.width = `${renderWidth}px`;
      canvas.style.height = `${renderHeight}px`;
      
      context.lineCap = 'round';
      context.lineJoin = 'round';
      setCtx(context);
    };

    updateCanvasSize();

    const observer = new ResizeObserver(updateCanvasSize);
    observer.observe(img);
    if (img.parentElement) observer.observe(img.parentElement);

    return () => observer.disconnect();
  }, [isSmudging]);

  useEffect(() => {
    if (ctx && canvasRef.current) {
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      if (maskCanvasRef.current) {
        const maskCtx = maskCanvasRef.current.getContext('2d');
        if (maskCtx) {
          maskCtx.clearRect(0, 0, maskCanvasRef.current.width, maskCanvasRef.current.height);
        }
      }
      setUndoHistory([]);
      setStampSource(null);
    }
  }, [smudgeMode, ctx]);

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isSmudging || !ctx || !canvasRef.current || !imageRef.current || !maskCanvasRef.current) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;

    if (isSelectingSource) {
      setStampSource({ x, y });
      setIsSelectingSource(false);
      return;
    }

    // Prevent scrolling on touch
    if ('touches' in e) {
      if (e.cancelable) e.preventDefault();
    }
    
    setIsDrawing(true);

    // Save current state for undo
    const currentState = ctx.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height);
    const maskCtx = maskCanvasRef.current.getContext('2d');
    const currentMaskState = maskCtx ? maskCtx.getImageData(0, 0, maskCanvasRef.current.width, maskCanvasRef.current.height) : new ImageData(maskCanvasRef.current.width, maskCanvasRef.current.height);
    setUndoHistory(prev => [...prev, { main: currentState, mask: currentMaskState }]);

    lastPos.current = { x, y };
    startPos.current = { x, y };

    if (smudgeMode === 'stamp' && stampSource) {
      stampOffset.current = {
        dx: stampSource.x - x,
        dy: stampSource.y - y
      };
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    if (smudgeMode === 'inpaint') {
      ctx.strokeStyle = 'rgba(0, 100, 255, 0.3)'; // Blue overlay
      ctx.shadowBlur = brushFeather;
      ctx.shadowColor = 'rgba(0, 100, 255, 0.3)';
    } else {
      ctx.shadowBlur = brushFeather;
      ctx.shadowColor = 'rgba(0,0,0,0.2)';
    }
    ctx.lineWidth = brushSize;
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !isSmudging || !ctx || !canvasRef.current || !lastPos.current || !imageRef.current || !maskCanvasRef.current) return;
    
    // Prevent scrolling on touch
    if ('touches' in e) {
      if (e.cancelable) e.preventDefault();
    }

    const rect = canvasRef.current.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;

    if (smudgeMode === 'inpaint') {
      // Main Canvas: Blue overlay
      ctx.beginPath();
      ctx.moveTo(lastPos.current.x, lastPos.current.y);
      ctx.lineTo(x, y);
      ctx.stroke();

      // Mask Canvas: White mask
      const maskCtx = maskCanvasRef.current.getContext('2d');
      if (maskCtx) {
        maskCtx.beginPath();
        maskCtx.moveTo(lastPos.current.x, lastPos.current.y);
        maskCtx.lineTo(x, y);
        maskCtx.strokeStyle = 'white';
        maskCtx.lineWidth = brushSize;
        maskCtx.lineCap = 'round';
        maskCtx.lineJoin = 'round';
        maskCtx.stroke();
      }
    } else if (smudgeMode === 'stamp' && stampOffset.current) {
      // Clone Stamp implementation with feathering
      const brushCanvas = document.createElement('canvas');
      brushCanvas.width = brushSize;
      brushCanvas.height = brushSize;
      const bCtx = brushCanvas.getContext('2d');
      if (!bCtx) return;

      // 1. Draw the source pixels
      bCtx.drawImage(
        imageRef.current,
        x + stampOffset.current.dx - brushSize/2,
        y + stampOffset.current.dy - brushSize/2,
        brushSize, brushSize,
        0, 0, brushSize, brushSize
      );

      // 2. Apply radial gradient for feathering
      bCtx.globalCompositeOperation = 'destination-in';
      const grad = bCtx.createRadialGradient(
        brushSize / 2, brushSize / 2, (brushSize / 2) * (1 - brushFeather / 100),
        brushSize / 2, brushSize / 2, brushSize / 2
      );
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      bCtx.fillStyle = grad;
      bCtx.fillRect(0, 0, brushSize, brushSize);

      // 3. Draw to main canvas
      ctx.drawImage(brushCanvas, x - brushSize/2, y - brushSize/2);
    }

    lastPos.current = { x, y };
  };

  const stopDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    lastPos.current = null;
    startPos.current = null;
    stampOffset.current = null;
    if (ctx) {
      ctx.shadowBlur = 0; // Reset shadow
    }
  };

  const undo = () => {
    if (undoHistory.length === 0 || !ctx || !canvasRef.current || !maskCanvasRef.current) return;
    const previousState = undoHistory[undoHistory.length - 1];
    ctx.putImageData(previousState.main, 0, 0);
    const maskCtx = maskCanvasRef.current.getContext('2d');
    if (maskCtx) {
      maskCtx.putImageData(previousState.mask, 0, 0);
    }
    setUndoHistory(prev => prev.slice(0, -1));
  };

  const handleSave = async () => {
    if (isSmudging && canvasRef.current && imageRef.current) {
      if (smudgeMode === 'inpaint') {
        setIsProcessing(true);
        
        // Capture all necessary data before timeout, allowing parent to unmount this safely
        const naturalWidth = imageRef.current.naturalWidth;
        const naturalHeight = imageRef.current.naturalHeight;
        const sourceImg = imageRef.current;
        
        const maskCanvas = maskCanvasRef.current!;
        const maskCtx = maskCanvas.getContext('2d');
        if (!maskCtx) return;
        const maskData = maskCtx.getImageData(0, 0, naturalWidth, naturalHeight);
        
        if (onProcessStart) onProcessStart();

        setTimeout(() => {
          try {
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            if (!context) return;

            canvas.width = naturalWidth;
            canvas.height = naturalHeight;
            const width = canvas.width;
            const height = canvas.height;

            // 1. Draw original image
            context.drawImage(sourceImg, 0, 0);
            
            const maskPixels = maskData.data;
            
            // 2. Iterative Boundary Diffusion
            const originalData = context.getImageData(0, 0, width, height);
            const pixels = originalData.data;
            
            const hole = new Uint8Array(width * height);
            let holeCount = 0;

            // Hole Positioning (Threshold 50)
            for (let i = 0; i < width * height; i++) {
              if (maskPixels[i * 4 + 3] > 50) {
                hole[i] = 1;
              }
            }

            // Dilation: Expand hole to sample from a wider area
            const dilatedHole = new Uint8Array(width * height);
            const dilation = Math.max(3, Math.floor(brushSize / 10)); // Dynamic dilation
            if (dilation > 0) {
              for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                  if (hole[y * width + x] === 1) {
                    const minY = Math.max(0, y - dilation);
                    const maxY = Math.min(height - 1, y + dilation);
                    const minX = Math.max(0, x - dilation);
                    const maxX = Math.min(width - 1, x + dilation);
                    for (let dy = minY; dy <= maxY; dy++) {
                      for (let dx = minX; dx <= maxX; dx++) {
                        dilatedHole[dy * width + dx] = 1;
                      }
                    }
                  }
                }
              }
              hole.set(dilatedHole);
            }
            
            holeCount = 0;
            for (let i = 0; i < width * height; i++) if (hole[i] === 1) holeCount++;

            if (holeCount === 0) {
              setIsProcessing(false);
              // If no hole, just save the original image as data URL
              const outCanvas = document.createElement('canvas');
              outCanvas.width = width;
              outCanvas.height = height;
              const outCtx = outCanvas.getContext('2d');
              if (outCtx) {
                outCtx.drawImage(imageRef.current!, 0, 0);
                onSave(outCanvas.toDataURL('image/png'));
              } else {
                onCancel();
              }
              return;
            }

            // Pre-fill: Fill the hole with the average color of the boundary pixels
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
                        const off = nidx * 4;
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
                  const off = i * 4;
                  pixels[off] = avgR;
                  pixels[off+1] = avgG;
                  pixels[off+2] = avgB;
                }
              }
            }

            // Diffusion Loop
            let iterations = 0;
            const maxIterations = 350; // Increased iterations for larger holes
            
            // Optimization: Only process relevant bounding box
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
            
            // Expand bbox slightly
            minX = Math.max(0, minX - 2);
            minY = Math.max(0, minY - 2);
            maxX = Math.min(width - 1, maxX + 2);
            maxY = Math.min(height - 1, maxY + 2);

            // Find initial boundary
            let boundary: number[] = [];
            for (let y = minY; y <= maxY; y++) {
              for (let x = minX; x <= maxX; x++) {
                const idx = y * width + x;
                if (hole[idx] === 1) {
                  let isBoundary = false;
                  // Check 4-connectivity for speed
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

            while (iterations < maxIterations && holeCount > 0 && boundary.length > 0) {
              const nextBoundary = new Set<number>();
              const filledThisIteration = [];

              for (const idx of boundary) {
                const x = idx % width;
                const y = Math.floor(idx / width);
                let r = 0, g = 0, b = 0, count = 0;
                
                // 4-neighborhood for speed
                const neighbors = [
                  (x > 0) ? idx - 1 : -1,
                  (x < width - 1) ? idx + 1 : -1,
                  (y > 0) ? idx - width : -1,
                  (y < height - 1) ? idx + width : -1
                ];

                for (const nidx of neighbors) {
                  if (nidx !== -1 && hole[nidx] === 0) {
                    const off = nidx * 4;
                    r += pixels[off];
                    g += pixels[off+1];
                    b += pixels[off+2];
                    count++;
                  }
                }

                if (count > 0) {
                  const off = idx * 4;
                  pixels[off] = r / count;
                  pixels[off+1] = g / count;
                  pixels[off+2] = b / count;
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

            // 3. Post-processing: Smooth and Blend
            const workCanvas = document.createElement('canvas');
            workCanvas.width = width;
            workCanvas.height = height;
            const workCtx = workCanvas.getContext('2d');
            if (!workCtx) {
              setIsProcessing(false);
              return;
            }

            // Put the filled data into work canvas
            const filledData = new ImageData(new Uint8ClampedArray(pixels), width, height);
            workCtx.putImageData(filledData, 0, 0);

            // Apply 2px blur
            const blurCanvas = document.createElement('canvas');
            blurCanvas.width = width;
            blurCanvas.height = height;
            const blurCtx = blurCanvas.getContext('2d');
            if (!blurCtx) {
              setIsProcessing(false);
              return;
            }
            blurCtx.filter = 'blur(2px)';
            blurCtx.drawImage(workCanvas, 0, 0);

            // Clip to mask shape using destination-in
            const finalPatchCanvas = document.createElement('canvas');
            finalPatchCanvas.width = width;
            finalPatchCanvas.height = height;
            const finalPatchCtx = finalPatchCanvas.getContext('2d');
            if (!finalPatchCtx) {
              setIsProcessing(false);
              return;
            }

            finalPatchCtx.drawImage(blurCanvas, 0, 0);
            finalPatchCtx.globalCompositeOperation = 'destination-in';
            finalPatchCtx.drawImage(maskCanvas, 0, 0);

            // Final Composite: Overlay on original
            context.drawImage(finalPatchCanvas, 0, 0);

            // Use high quality PNG by default to preserve file size/detail
            const dataUrl = canvas.toDataURL('image/png');
            onSave(dataUrl);
          } catch (error) {
            console.error('Inpainting error:', error);
            // If we've already closed the modal (onProcessStart), we can't alert easily, but we should log it
          } finally {
            setIsProcessing(false);
          }
        }, 30);
      } else {
        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = canvasRef.current.width;
        finalCanvas.height = canvasRef.current.height;
        const finalCtx = finalCanvas.getContext('2d')!;
        
        finalCtx.drawImage(imageRef.current, 0, 0);
        finalCtx.drawImage(canvasRef.current, 0, 0);
        
        const dataUrl = finalCanvas.toDataURL('image/png');
        onSave(dataUrl);
      }
    } else if (!isSmudging && crop && imageRef.current) {
      const canvas = document.createElement('canvas');
      const scaleX = imageRef.current.naturalWidth / imageRef.current.width;
      const scaleY = imageRef.current.naturalHeight / imageRef.current.height;
      canvas.width = crop.width * scaleX;
      canvas.height = crop.height * scaleY;
      const ctx = canvas.getContext('2d');

      if (ctx) {
        ctx.drawImage(
          imageRef.current,
          crop.x * scaleX,
          crop.y * scaleY,
          crop.width * scaleX,
          crop.height * scaleY,
          0,
          0,
          crop.width * scaleX,
          crop.height * scaleY
        );
        const dataUrl = canvas.toDataURL('image/png');
        onSave(dataUrl);
      }
    } else {
      onCancel();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center sm:p-4 z-[999]">
      <div className="bg-white rounded-none sm:rounded-2xl shadow-2xl w-full h-full sm:h-auto sm:max-w-4xl sm:max-h-[90vh] flex flex-col overflow-hidden">
        <div className="p-3 sm:p-4 border-b border-gray-100 flex justify-between items-center bg-white">
          <h3 className="font-bold text-base sm:text-lg flex items-center gap-2"><Scissors size={18} className="sm:w-5 sm:h-5"/> 图片编辑</h3>
          <div className="flex gap-1.5 sm:gap-2">
            <div className="flex bg-gray-100 p-1 rounded-xl">
              <button 
                onClick={() => { setIsSmudging(true); setSmudgeMode('inpaint'); }} 
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${isSmudging && smudgeMode === 'inpaint' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
              >
                智能填充
              </button>
              <button 
                onClick={() => { setIsSmudging(true); setSmudgeMode('stamp'); }} 
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${isSmudging && smudgeMode === 'stamp' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
              >
                克隆图章
              </button>
            </div>
            <button onClick={onCancel} className="p-1.5 sm:p-2 text-gray-400 hover:text-gray-600"><X size={20}/></button>
          </div>
        </div>
        <div className="flex-grow min-h-0 overflow-hidden bg-gray-100 flex items-center justify-center relative touch-none p-4 sm:p-8">
          {isSmudging ? (
            <div className="relative max-w-full max-h-full shadow-lg rounded-lg overflow-hidden flex items-center justify-center bg-white">
              <img 
                ref={imageRef} 
                src={image} 
                crossOrigin="anonymous"
                className="max-w-full max-h-full object-contain pointer-events-none block" 
                style={{ maxHeight: 'calc(90vh - 200px)' }} 
                onLoad={() => {
                  if (isSmudging) setUndoHistory(prev => [...prev]); 
                }}
              />
              <canvas 
                ref={canvasRef}
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
                onTouchStart={startDrawing}
                onTouchMove={draw}
                onTouchEnd={stopDrawing}
                className={`absolute cursor-crosshair touch-none ${isSelectingSource ? 'cursor-copy' : ''}`}
                style={{
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  zIndex: 10
                }}
              />
              <canvas 
                ref={maskCanvasRef}
                className="absolute pointer-events-none"
                style={{
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  zIndex: 5,
                  opacity: 0
                }}
              />
              {isSelectingSource && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-blue-600 text-white px-4 py-2 rounded-full text-xs font-bold shadow-lg animate-bounce z-20">
                  请点击图片选择采样点
                </div>
              )}
              {stampSource && canvasRef.current && smudgeMode === 'stamp' && (
                <div 
                  className="absolute border-2 border-blue-600 rounded-full w-6 h-6 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-20 shadow-lg"
                  style={{
                    left: `calc(50% + ${(stampSource.x - canvasRef.current.width/2) / canvasRef.current.width * parseFloat(canvasRef.current.style.width)}px)`,
                    top: `calc(50% + ${(stampSource.y - canvasRef.current.height/2) / canvasRef.current.height * parseFloat(canvasRef.current.style.height)}px)`
                  }}
                >
                  <div className="absolute inset-0 border border-white rounded-full flex items-center justify-center">
                    <div className="w-1 h-1 bg-blue-600 rounded-full"></div>
                  </div>
                </div>
              )}
              {isProcessing && (
                <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center z-10">
                  <div className="w-10 h-10 sm:w-12 sm:h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-3 sm:mb-4"></div>
                  <p className="text-blue-800 font-bold text-sm sm:text-base">后台智能处理中...</p>
                </div>
              )}
            </div>
          ) : (
            <div className="max-w-full max-h-full flex items-center justify-center overflow-hidden">
              <ReactCrop crop={crop} onChange={c => setCrop(c)}>
                <img ref={imageRef} src={image} className="max-w-full max-h-full object-contain shadow-lg block" style={{ maxHeight: 'calc(90vh - 200px)' }} />
              </ReactCrop>
            </div>
          )}
        </div>
        <div className="p-3 sm:p-4 border-t border-gray-100 flex flex-col sm:flex-row justify-between items-center bg-white gap-3 sm:gap-4">
          {isSmudging ? (
            <div className="flex items-center gap-2 sm:gap-4 flex-wrap justify-center sm:justify-start w-full sm:w-auto">
              {smudgeMode === 'stamp' && (
                <button 
                  onClick={() => setIsSelectingSource(true)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition ${isSelectingSource ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'}`}
                >
                  <Target size={14}/> {stampSource ? '重新采样' : '选择采样点'}
                </button>
              )}
              <div className="flex items-center gap-2 bg-gray-50 px-2 py-1 rounded-lg border border-gray-100">
                <span className="text-[10px] sm:text-sm text-gray-500 font-medium">画笔:</span>
                <input 
                  type="range" 
                  min="5" max="100" 
                  value={brushSize} 
                  onChange={(e) => setBrushSize(parseInt(e.target.value))}
                  className="w-16 sm:w-24 accent-blue-600 h-1.5 sm:h-2"
                />
              </div>
              <div className="flex items-center gap-2 bg-gray-50 px-2 py-1 rounded-lg border border-gray-100">
                <span className="text-[10px] sm:text-sm text-gray-500 font-medium">羽化:</span>
                <input 
                  type="range" 
                  min="0" max="100" 
                  value={brushFeather} 
                  onChange={(e) => setBrushFeather(parseInt(e.target.value))}
                  className="w-16 sm:w-24 accent-blue-600 h-1.5 sm:h-2"
                />
              </div>
              <button 
                onClick={undo}
                disabled={undoHistory.length === 0}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition ${undoHistory.length === 0 ? 'text-gray-300 cursor-not-allowed' : 'text-gray-600 hover:bg-gray-100'}`}
              >
                <Undo2 size={16}/> 撤销
              </button>
            </div>
          ) : (
            <div className="text-xs sm:text-sm text-gray-500 font-medium">
              拖动边缘调整裁剪区域
            </div>
          )}
          <div className="flex gap-2 w-full sm:w-auto">
            <button onClick={onCancel} className="flex-1 sm:flex-none px-4 sm:px-6 py-2 rounded-xl font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 transition text-sm sm:text-base">取消</button>
            <button 
              onClick={handleSave} 
              disabled={isProcessing}
              className="flex-1 sm:flex-none px-4 sm:px-6 py-2 rounded-xl font-bold text-white bg-blue-600 hover:bg-blue-700 transition shadow-md hover:shadow-lg disabled:opacity-50 text-sm sm:text-base"
            >
              {isProcessing ? '处理中...' : '确认修改'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
