import React, { useState, useRef, useEffect } from 'react';
import { Plus, Trash2, Upload, Settings, X, Image as ImageIcon, Download, PlayCircle, Clock, CheckCircle2, Music, Scissors, Paintbrush, ArrowLeft, ArrowRight, Copy, Grid, Type, Film, Target } from 'lucide-react';
import ReactCrop, { type Crop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';

export interface Storyboard {
  id: string;
  image: string;
  animation: string;
  transition: string;
  text: string;
  textSize: number;
  textColor: string;
  textEffect: string;
  duration: number;
}

export interface VideoTask {
  id: string;
  storyboards: Storyboard[];
  introAnimation: string;
  outroAnimation: string;
  bgm: string;
}

const ANIMATIONS = [
  { value: 'none', label: '无动画' },
  { value: 'zoom_in', label: '缓慢推镜头' },
  { value: 'pan_lr', label: '从左往右移动' },
  { value: 'pan_rl', label: '从右往左移动' },
  { value: 'pan_tb', label: '从上往下移动' },
  { value: 'pan_bt', label: '从下往上移动' },
  { value: 'pan_tl_br', label: '左上往右下移动' },
  { value: 'pan_br_tl', label: '右下往左上移动' },
  { value: 'pan_tr_bl', label: '右上往左下移动' },
  { value: 'pan_bl_tr', label: '左下往右上移动' }
];

const TRANSITIONS = [
  { value: 'none', label: '无转场' },
  { value: 'fade', label: '渐变转场' }
];

const TEXT_EFFECTS = [
  { value: 'none', label: '无效果' },
  { value: 'fade', label: '渐显' },
  { value: 'blur', label: '毛玻璃淡入' },
  { value: 'typewriter', label: '打字输入' },
  { value: 'rotate', label: '文字转圈' }
];

export default function VideoEditor({ 
  task,
  onChange,
  galleryImages 
}: { 
  task: VideoTask,
  onChange: (task: VideoTask) => void,
  galleryImages: string[]
}) {
  const [bgmList, setBgmList] = useState<string[]>([]);
  const [playingBgm, setPlayingBgm] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [galleryMode, setGalleryMode] = useState<'normal' | '4grid'>('normal');
  const [activeStoryboardId, setActiveStoryboardId] = useState<string | null>(null);
  const [activeStoryboardIndex, setActiveStoryboardIndex] = useState(0);
  const [editingImage, setEditingImage] = useState<{ id: string, image: string } | null>(null);

  // Image Editor State
  const [crop, setCrop] = useState<Crop>();
  const [isSmudging, setIsSmudging] = useState(false);
  const [smudgeMode, setSmudgeMode] = useState<'inpaint' | 'stamp'>('inpaint');
  const [stampSource, setStampSource] = useState<{x: number, y: number} | null>(null);
  const [isSelectingSource, setIsSelectingSource] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [brushSize, setBrushSize] = useState(40);
  const [brushFeather, setBrushFeather] = useState(20);
  const [undoHistory, setUndoHistory] = useState<ImageData[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const lastPos = useRef<{x: number, y: number} | null>(null);
  const startPos = useRef<{x: number, y: number} | null>(null);
  const stampOffset = useRef<{dx: number, dy: number} | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [ctx, setCtx] = useState<CanvasRenderingContext2D | null>(null);

  // Split Images State
  const [splitImages, setSplitImages] = useState<string[]>([]);
  const [selectedSplitIndices, setSelectedSplitIndices] = useState<number[]>([]);

  useEffect(() => {
    fetch('/api/bgm').then(res => res.json()).then(data => setBgmList(data));
  }, []);

  const updateTask = (updates: Partial<VideoTask>) => onChange({ ...task, ...updates });

  const updateStoryboard = (id: string, updates: Partial<Storyboard>) => {
    onChange({
      ...task,
      storyboards: task.storyboards.map(sb => sb.id === id ? { ...sb, ...updates } : sb)
    });
  };

  const addEmptyStoryboard = () => {
    const newSb: Storyboard = {
      id: Date.now().toString(),
      image: '',
      animation: 'none',
      transition: 'none',
      text: '',
      textSize: 20,
      textColor: '#ffffff',
      textEffect: 'none',
      duration: 3
    };
    updateTask({ storyboards: [...task.storyboards, newSb] });
    setShowAddMenu(false);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, sbId: string) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        updateStoryboard(sbId, { image: event.target?.result as string });
      };
      reader.readAsDataURL(file);
    }
  };

  const handle4GridSplit = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const processFile = (file: File): Promise<string[]> => {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (event) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            if (!context) return resolve([]);
            
            const w = img.width / 2;
            const h = img.height / 2;
            canvas.width = w;
            canvas.height = h;

            const quadrants = [
              { x: 0, y: 0 },
              { x: w, y: 0 },
              { x: 0, y: h },
              { x: w, y: h }
            ];

            const newImages = quadrants.map((q) => {
              context.clearRect(0, 0, w, h);
              context.drawImage(img, q.x, q.y, w, h, 0, 0, w, h);
              return canvas.toDataURL('image/jpeg', 0.9);
            });
            resolve(newImages);
          };
          img.src = event.target?.result as string;
        };
        reader.readAsDataURL(file);
      });
    };

    Promise.all(files.map(processFile)).then(results => {
      const allNewImages = results.flat();
      setSplitImages(allNewImages);
      setSelectedSplitIndices([]);
    });

    setShowAddMenu(false);
  };

  const applyToAll = (field: keyof Storyboard, value: any) => {
    updateTask({
      storyboards: task.storyboards.map(sb => ({ ...sb, [field]: value }))
    });
  };

  const moveStoryboard = (index: number, direction: 1 | -1) => {
    const newStoryboards = [...task.storyboards];
    const temp = newStoryboards[index];
    newStoryboards[index] = newStoryboards[index + direction];
    newStoryboards[index + direction] = temp;
    updateTask({ storyboards: newStoryboards });
  };

  const toggleBgm = (bgm: string) => {
    if (playingBgm === bgm) {
      audioRef.current?.pause();
      setPlayingBgm(null);
    } else {
      if (audioRef.current) {
        audioRef.current.src = `/bgm/${bgm}`;
        audioRef.current.play();
      } else {
        const audio = new Audio(`/bgm/${bgm}`);
        audio.play();
        audioRef.current = audio;
      }
      setPlayingBgm(bgm);
      updateTask({ bgm });
    }
  };

  useEffect(() => {
    if (!isSmudging || !editingImage || !canvasRef.current || !imageRef.current) return;

    const canvas = canvasRef.current;
    const img = imageRef.current;
    
    const updateCanvasSize = () => {
      const context = canvas.getContext('2d');
      if (!context) return;

      // Calculate actual rendered image dimensions (accounting for object-contain)
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

      // Match canvas internal resolution to image natural resolution
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      
      if (maskCanvasRef.current) {
        maskCanvasRef.current.width = img.naturalWidth;
        maskCanvasRef.current.height = img.naturalHeight;
        maskCanvasRef.current.style.width = `${renderWidth}px`;
        maskCanvasRef.current.style.height = `${renderHeight}px`;
      }
      
      // Match canvas display size to actual rendered image size
      canvas.style.width = `${renderWidth}px`;
      canvas.style.height = `${renderHeight}px`;
      
      context.lineCap = 'round';
      context.lineJoin = 'round';
      setCtx(context);
    };

    // Initial update
    updateCanvasSize();

    // Use ResizeObserver to handle window resizing or layout changes
    const observer = new ResizeObserver(updateCanvasSize);
    observer.observe(img);
    observer.observe(img.parentElement!);

    return () => observer.disconnect();
  }, [isSmudging, editingImage]);

  useEffect(() => {
    if (ctx && canvasRef.current) {
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      setUndoHistory([]);
      setStampSource(null);
    }
  }, [smudgeMode]);

  // Image Editor Logic
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
    setUndoHistory(prev => [...prev, currentState]);

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

  const handleUndo = () => {
    if (undoHistory.length === 0 || !ctx || !canvasRef.current) return;
    const previousState = undoHistory[undoHistory.length - 1];
    ctx.putImageData(previousState, 0, 0);
    setUndoHistory(prev => prev.slice(0, -1));
  };

  const clearMask = () => {
    if (!ctx || !canvasRef.current || !maskCanvasRef.current) return;
    const currentState = ctx.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height);
    setUndoHistory(prev => [...prev, currentState]);
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    const maskCtx = maskCanvasRef.current.getContext('2d');
    if (maskCtx) maskCtx.clearRect(0, 0, maskCanvasRef.current.width, maskCanvasRef.current.height);
  };

  const saveEditedImage = async () => {
    if (isSmudging && canvasRef.current && editingImage && imageRef.current) {
      setIsProcessing(true);
      
      // Use setTimeout to allow the UI to render the processing state
      setTimeout(async () => {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) {
          setIsProcessing(false);
          return;
        }

        canvas.width = imageRef.current!.naturalWidth;
        canvas.height = imageRef.current!.naturalHeight;
        const width = canvas.width;
        const height = canvas.height;

        // 1. Draw original image
        context.drawImage(imageRef.current!, 0, 0);

        if (smudgeMode === 'stamp') {
          // For stamp mode, we just draw the canvas content (which already contains cloned pixels)
          context.drawImage(canvasRef.current!, 0, 0);
        } else {
          // 1. Dual-Canvas Masking: Get mask data
          const maskCanvas = maskCanvasRef.current!;
          const maskCtx = maskCanvas.getContext('2d');
          if (!maskCtx) {
            setIsProcessing(false);
            return;
          }
          
          const maskData = maskCtx.getImageData(0, 0, width, height);
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
          const dilation = 4;
          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              if (hole[y * width + x] === 1) {
                for (let dy = -dilation; dy <= dilation; dy++) {
                  for (let dx = -dilation; dx <= dilation; dx++) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                      dilatedHole[ny * width + nx] = 1;
                    }
                  }
                }
              }
            }
          }
          hole.set(dilatedHole);
          for (let i = 0; i < width * height; i++) if (hole[i] === 1) holeCount++;

          if (holeCount === 0) {
            setIsProcessing(false);
            setEditingImage(null);
            return;
          }

          // Diffusion Loop (Max 500 iterations)
          let iterations = 0;
          const maxIterations = 500;
          
          // Find initial boundary
          let boundary = [];
          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              const idx = y * width + x;
              if (hole[idx] === 1) {
                let isBoundary = false;
                for (let dy = -1; dy <= 1; dy++) {
                  for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                      if (hole[ny * width + nx] === 0) {
                        isBoundary = true;
                        break;
                      }
                    }
                  }
                  if (isBoundary) break;
                }
                if (isBoundary) boundary.push({x, y, idx});
              }
            }
          }

          while (iterations < maxIterations && holeCount > 0 && boundary.length > 0) {
            const nextBoundary = new Set<number>();
            const filledThisIteration = [];

            for (const p of boundary) {
              let r = 0, g = 0, b = 0, count = 0;
              // 8-neighbor sampling (3x3 window)
              for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                  if (dx === 0 && dy === 0) continue;
                  const nx = p.x + dx;
                  const ny = p.y + dy;
                  if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                    const nidx = ny * width + nx;
                    if (hole[nidx] === 0) {
                      const off = nidx * 4;
                      r += pixels[off];
                      g += pixels[off+1];
                      b += pixels[off+2];
                      count++;
                    }
                  }
                }
              }

              if (count > 0) {
                const off = p.idx * 4;
                pixels[off] = r / count;
                pixels[off+1] = g / count;
                pixels[off+2] = b / count;
                filledThisIteration.push(p.idx);
              }
            }

            for (const idx of filledThisIteration) {
              hole[idx] = 0;
              holeCount--;
              const x = idx % width;
              const y = Math.floor(idx / width);
              for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                  const nx = x + dx;
                  const ny = y + dy;
                  if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                    const nidx = ny * width + nx;
                    if (hole[nidx] === 1) nextBoundary.add(nidx);
                  }
                }
              }
            }

            boundary = Array.from(nextBoundary).map(idx => ({
              x: idx % width,
              y: Math.floor(idx / width),
              idx
            }));
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
        }

        const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        updateStoryboard(editingImage!.id, { image: dataUrl });
        setEditingImage(null);
        setIsProcessing(false);
      }, 0);
    } else if (!isSmudging && crop && editingImage && imageRef.current) {
      const canvas = document.createElement('canvas');
      const scaleX = imageRef.current.naturalWidth / imageRef.current.width;
      const scaleY = imageRef.current.naturalHeight / imageRef.current.height;
      canvas.width = crop.width;
      canvas.height = crop.height;
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
          crop.width,
          crop.height
        );
        const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        updateStoryboard(editingImage.id, { image: dataUrl });
      }
      setEditingImage(null);
    } else {
      setEditingImage(null);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden flex flex-col h-full">
      <div className="flex-grow overflow-y-auto p-6 space-y-8">
        {/* Global Settings */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
            <label className="block text-sm font-bold text-gray-700 mb-2">进场动画 (首个分镜)</label>
            <select 
              className="w-full p-2.5 rounded-lg border border-gray-200 focus:ring-2 focus:ring-blue-500"
              value={task.introAnimation}
              onChange={e => updateTask({ introAnimation: e.target.value })}
            >
              <option value="none">无进场动画</option>
              <option value="fade_in">渐入</option>
            </select>
          </div>
          <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
            <label className="block text-sm font-bold text-gray-700 mb-2">出场动画 (末尾分镜)</label>
            <select 
              className="w-full p-2.5 rounded-lg border border-gray-200 focus:ring-2 focus:ring-blue-500"
              value={task.outroAnimation}
              onChange={e => updateTask({ outroAnimation: e.target.value })}
            >
              <option value="none">无出场动画</option>
              <option value="fade_out">渐出</option>
            </select>
          </div>
          <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
            <label className="block text-sm font-bold text-gray-700 mb-2">背景音乐 (BGM)</label>
            <div className="flex gap-2 items-center">
              <select 
                className="flex-grow p-2.5 rounded-lg border border-gray-200 focus:ring-2 focus:ring-blue-500"
                value={task.bgm}
                onChange={e => {
                  updateTask({ bgm: e.target.value });
                  if (audioRef.current) audioRef.current.pause();
                  setPlayingBgm(null);
                }}
              >
                <option value="">无背景音乐</option>
                {bgmList.map((bgm, idx) => <option key={bgm} value={bgm}>音乐 {idx + 1}</option>)}
              </select>
              {task.bgm && (
                <button onClick={() => toggleBgm(task.bgm)} className="p-2.5 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200">
                  {playingBgm === task.bgm ? <Clock className="animate-spin" size={20}/> : <PlayCircle size={20}/>}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Storyboards */}
        <div>
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-bold text-gray-800">分镜头列表 ({task.storyboards.length})</h3>
            <div className="relative">
              <button 
                onClick={() => setShowAddMenu(!showAddMenu)}
                className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition shadow-sm"
              >
                <Plus size={18}/> 添加分镜
              </button>
              {showAddMenu && (
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-gray-100 z-10 overflow-hidden">
                  <button onClick={addEmptyStoryboard} className="w-full text-left px-4 py-3 hover:bg-gray-50 flex items-center gap-2 text-sm font-medium border-b border-gray-50">
                    <ImageIcon size={16}/> 添加空分镜
                  </button>
                  <label className="w-full text-left px-4 py-3 hover:bg-gray-50 flex items-center gap-2 text-sm font-medium cursor-pointer border-b border-gray-50">
                    <Grid size={16}/> 导入并4宫格分割
                    <input type="file" accept="image/*" multiple className="hidden" onChange={handle4GridSplit} />
                  </label>
                  <button 
                    onClick={() => {
                      setGalleryMode('4grid');
                      setShowGallery(true);
                      setShowAddMenu(false);
                    }} 
                    className="w-full text-left px-4 py-3 hover:bg-gray-50 flex items-center gap-2 text-sm font-medium"
                  >
                    <ImageIcon size={16}/> 从图库选择4宫格
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-4">
            {task.storyboards.length === 0 ? (
              <div className="w-full py-12 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center text-gray-400">
                <Film size={48} className="mb-4 opacity-50"/>
                <p>暂无分镜，请点击右上角添加</p>
              </div>
            ) : (
              <>
                {/* Active Storyboard Card */}
                <div className="relative w-full max-w-[280px] sm:max-w-md mx-auto bg-white border border-gray-200 rounded-2xl shadow-sm flex flex-col">
                  {/* Navigation Arrows */}
                  {task.storyboards.length > 1 && (
                    <>
                      <button 
                        onClick={() => setActiveStoryboardIndex(prev => Math.max(0, prev - 1))}
                        disabled={activeStoryboardIndex === 0}
                        className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 z-10 p-2 bg-white rounded-full shadow-md border border-gray-100 text-gray-600 hover:text-blue-600 disabled:opacity-0 transition-all"
                      >
                        <ArrowLeft size={20}/>
                      </button>
                      <button 
                        onClick={() => setActiveStoryboardIndex(prev => Math.min(task.storyboards.length - 1, prev + 1))}
                        disabled={activeStoryboardIndex === task.storyboards.length - 1}
                        className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 z-10 p-2 bg-white rounded-full shadow-md border border-gray-100 text-gray-600 hover:text-blue-600 disabled:opacity-0 transition-all"
                      >
                        <ArrowRight size={20}/>
                      </button>
                    </>
                  )}

                  {(() => {
                    const index = activeStoryboardIndex;
                    const sb = task.storyboards[index];
                    if (!sb) return null;
                    return (
                      <>
                        <div className="p-3 bg-gray-50 border-b border-gray-100 flex justify-between items-center rounded-t-2xl">
                          <span className="font-bold text-gray-700">分镜 {index + 1} / {task.storyboards.length}</span>
                          <div className="flex gap-1">
                            <button disabled={index === 0} onClick={() => { moveStoryboard(index, -1); setActiveStoryboardIndex(index - 1); }} className="p-1.5 text-gray-400 hover:text-blue-600 disabled:opacity-30"><ArrowLeft size={16}/></button>
                            <button disabled={index === task.storyboards.length - 1} onClick={() => { moveStoryboard(index, 1); setActiveStoryboardIndex(index + 1); }} className="p-1.5 text-gray-400 hover:text-blue-600 disabled:opacity-30"><ArrowRight size={16}/></button>
                            <button onClick={() => {
                              updateTask({ storyboards: task.storyboards.filter(s => s.id !== sb.id) });
                              setActiveStoryboardIndex(Math.max(0, index - 1));
                            }} className="p-1.5 text-gray-400 hover:text-red-600 ml-2"><Trash2 size={16}/></button>
                          </div>
                        </div>
                        
                        <div className="relative aspect-video bg-gray-100 flex items-center justify-center group overflow-hidden">
                          {sb.image ? (
                            <>
                              <img src={sb.image} className="w-full h-full object-contain" />
                              <div className="absolute inset-0 bg-black/30 sm:bg-black/50 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                                <button onClick={() => setEditingImage({ id: sb.id, image: sb.image })} className="p-2.5 sm:p-2 bg-white rounded-full text-gray-800 hover:bg-blue-50 hover:text-blue-600 transition shadow-sm" title="编辑图片"><Scissors size={20}/></button>
                                <button 
                                  onClick={async (e) => {
                                    const btn = e.currentTarget;
                                    const originalContent = btn.innerHTML;
                                    btn.disabled = true;
                                    btn.innerHTML = '<div class="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>';
                                    
                                    // Immediate feedback
                                    const toast = document.createElement('div');
                                    toast.className = 'fixed top-4 left-1/2 -translate-x-1/2 bg-blue-600 text-white px-6 py-3 rounded-xl shadow-2xl z-[9999] font-bold animate-bounce';
                                    toast.innerText = '正在保存到本地图库...';
                                    document.body.appendChild(toast);

                                    try {
                                      const res = await fetch('/api/gallery/save', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ url: sb.image })
                                      });
                                      if (res.ok) {
                                        toast.innerText = '✅ 已成功保存到本地图库';
                                        toast.className = 'fixed top-4 left-1/2 -translate-x-1/2 bg-green-600 text-white px-6 py-3 rounded-xl shadow-2xl z-[9999] font-bold';
                                        setTimeout(() => toast.remove(), 2000);
                                      } else {
                                        const err = await res.json();
                                        toast.innerText = `❌ 保存失败: ${err.error || '未知错误'}`;
                                        toast.className = 'fixed top-4 left-1/2 -translate-x-1/2 bg-red-600 text-white px-6 py-3 rounded-xl shadow-2xl z-[9999] font-bold';
                                        setTimeout(() => toast.remove(), 3000);
                                      }
                                    } catch (e) {
                                      console.error('Save to gallery failed', e);
                                      toast.innerText = '❌ 网络错误，保存失败';
                                      toast.className = 'fixed top-4 left-1/2 -translate-x-1/2 bg-red-600 text-white px-6 py-3 rounded-xl shadow-2xl z-[9999] font-bold';
                                      setTimeout(() => toast.remove(), 3000);
                                    } finally {
                                      btn.disabled = false;
                                      btn.innerHTML = originalContent;
                                    }
                                  }}
                                  className="p-2.5 sm:p-2 bg-white rounded-full text-gray-800 hover:bg-blue-50 hover:text-blue-600 transition shadow-sm disabled:opacity-50" 
                                  title="保存到图库"
                                >
                                  <Download size={20}/>
                                </button>
                                <label className="p-2.5 sm:p-2 bg-white rounded-full text-gray-800 hover:bg-blue-50 hover:text-blue-600 transition cursor-pointer shadow-sm" title="更换图片">
                                  <Upload size={20}/>
                                  <input type="file" accept="image/*" className="hidden" onChange={(e) => handleImageUpload(e, sb.id)} />
                                </label>
                              </div>
                              {sb.text && (
                                <div className="absolute inset-0 flex items-center justify-center pointer-events-none p-4 text-center">
                                  <span style={{ fontSize: `${sb.textSize/2}px`, color: sb.textColor, textShadow: '0 2px 4px rgba(0,0,0,0.8)' }} className="font-bold">
                                    {sb.text}
                                  </span>
                                </div>
                              )}
                            </>
                          ) : (
                            <div className="text-center">
                              <label className="cursor-pointer inline-flex flex-col items-center text-gray-400 hover:text-blue-600 transition">
                                <Upload size={32} className="mb-2"/>
                                <span className="text-sm font-medium">上传图片</span>
                                <input type="file" accept="image/*" className="hidden" onChange={(e) => handleImageUpload(e, sb.id)} />
                              </label>
                              <div className="mt-4 flex gap-2 justify-center">
                                <button onClick={() => { 
                                  setActiveStoryboardId(sb.id); 
                                  setGalleryMode('normal');
                                  setShowGallery(true); 
                                }} className="text-xs bg-white border border-gray-200 px-3 py-1.5 rounded-lg shadow-sm hover:bg-gray-50">从图库选择</button>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="p-4 space-y-4 flex-grow bg-white rounded-b-2xl">
                          <div>
                            <div className="flex justify-between items-center mb-1">
                              <label className="text-xs font-bold text-gray-500">运镜动画</label>
                              <button onClick={() => applyToAll('animation', sb.animation)} className="text-[10px] text-blue-600 hover:underline">应用到全部</button>
                            </div>
                            <select className="w-full text-sm p-2 rounded border border-gray-200" value={sb.animation} onChange={e => updateStoryboard(sb.id, { animation: e.target.value })}>
                              {ANIMATIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                            </select>
                          </div>

                          {index < task.storyboards.length - 1 && (
                            <div>
                              <div className="flex justify-between items-center mb-1">
                                <label className="text-xs font-bold text-gray-500">下一镜转场</label>
                                <button onClick={() => applyToAll('transition', sb.transition)} className="text-[10px] text-blue-600 hover:underline">应用到全部</button>
                              </div>
                              <select className="w-full text-sm p-2 rounded border border-gray-200" value={sb.transition} onChange={e => updateStoryboard(sb.id, { transition: e.target.value })}>
                                {TRANSITIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                              </select>
                            </div>
                          )}

                          <div className="pt-2 border-t border-gray-100">
                            <div className="flex justify-between items-center mb-2">
                              <label className="text-xs font-bold text-gray-500 flex items-center gap-1"><Type size={12}/> 添加文字</label>
                              {sb.text && (
                                <button 
                                  onClick={() => {
                                    updateTask({
                                      storyboards: task.storyboards.map(s => ({
                                        ...s,
                                        text: sb.text,
                                        textColor: sb.textColor,
                                        textSize: sb.textSize,
                                        textEffect: sb.textEffect
                                      }))
                                    });
                                  }} 
                                  className="text-[10px] text-blue-600 hover:underline"
                                >
                                  应用样式到全部
                                </button>
                              )}
                            </div>
                            <input 
                              type="text" 
                              placeholder="输入分镜文字..." 
                              className="w-full text-sm p-2 rounded border border-gray-200 mb-2"
                              value={sb.text}
                              onChange={e => updateStoryboard(sb.id, { text: e.target.value })}
                            />
                            {sb.text && (
                              <div className="grid grid-cols-2 gap-2">
                                <input type="color" value={sb.textColor} onChange={e => updateStoryboard(sb.id, { textColor: e.target.value })} className="w-full h-8 rounded cursor-pointer" />
                                <input type="number" value={sb.textSize} onChange={e => updateStoryboard(sb.id, { textSize: parseInt(e.target.value) })} className="w-full text-sm p-1.5 rounded border border-gray-200" placeholder="大小" />
                                <select className="col-span-2 text-sm p-2 rounded border border-gray-200" value={sb.textEffect} onChange={e => updateStoryboard(sb.id, { textEffect: e.target.value })}>
                                  {TEXT_EFFECTS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                </select>
                              </div>
                            )}
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </div>

                {/* Thumbnails Strip */}
                <div className="flex gap-2 overflow-x-auto no-scrollbar py-2 px-4 max-w-full justify-start sm:justify-center">
                  {task.storyboards.map((sb, idx) => (
                    <div 
                      key={sb.id}
                      onClick={() => setActiveStoryboardIndex(idx)}
                      className={`relative w-20 h-20 flex-shrink-0 rounded-lg overflow-hidden cursor-pointer border-2 transition-all ${activeStoryboardIndex === idx ? 'border-blue-600 shadow-md scale-105' : 'border-transparent opacity-60 hover:opacity-100'}`}
                    >
                      {sb.image ? (
                        <img src={sb.image} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full bg-gray-100 flex items-center justify-center text-gray-400">
                          <ImageIcon size={20}/>
                        </div>
                      )}
                      <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[10px] text-center py-0.5">
                        {idx + 1}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Image Editor Modal */}
      {editingImage && (
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
                <button onClick={() => setEditingImage(null)} className="p-1.5 sm:p-2 text-gray-400 hover:text-gray-600"><X size={20}/></button>
              </div>
            </div>
            <div className="flex-grow min-h-0 overflow-hidden bg-gray-100 flex items-center justify-center relative touch-none p-4 sm:p-8">
              {isSmudging ? (
                <div className="relative max-w-full max-h-full shadow-lg rounded-lg overflow-hidden flex items-center justify-center bg-white">
                  <img 
                    ref={imageRef} 
                    src={editingImage.image} 
                    className="max-w-full max-h-full object-contain pointer-events-none block" 
                    style={{ maxHeight: 'calc(90vh - 200px)' }} 
                    onLoad={() => {
                      // Trigger re-render to update canvas size once image is loaded and sized
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
                    <img ref={imageRef} src={editingImage.image} className="max-w-full max-h-full object-contain shadow-lg block" style={{ maxHeight: 'calc(90vh - 200px)' }} />
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
                  <div className="flex gap-2">
                    <button 
                      onClick={handleUndo} 
                      disabled={undoHistory.length === 0}
                      className="px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-xs sm:text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition border border-gray-200"
                    >
                      撤销
                    </button>
                    <button 
                      onClick={() => {
                        if (ctx && canvasRef.current) {
                          ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
                          setUndoHistory([]);
                        }
                      }}
                      className="px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-xs sm:text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition border border-gray-200"
                    >
                      重置
                    </button>
                  </div>
                </div>
              ) : <div className="hidden sm:block"></div>}
              <div className="flex gap-2 sm:gap-3 w-full sm:w-auto justify-center sm:justify-end">
                <button onClick={() => setEditingImage(null)} className="flex-1 sm:flex-none px-4 sm:px-6 py-2 sm:py-2.5 rounded-xl font-medium text-gray-600 bg-gray-50 hover:bg-gray-100 transition border border-gray-200 text-sm sm:text-base">取消</button>
                <button onClick={saveEditedImage} disabled={isProcessing} className="flex-1 sm:flex-none px-4 sm:px-6 py-2 sm:py-2.5 rounded-xl font-medium text-white bg-blue-600 hover:bg-blue-700 transition shadow-md disabled:opacity-50 text-sm sm:text-base">
                  {isSmudging ? '确认去除水印' : '确认应用'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Gallery Picker Modal */}
      {showGallery && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-[999]">
          <div className="bg-white p-6 rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">从本地图库选择 {galleryMode === '4grid' ? '(4宫格)' : ''}</h2>
              <button onClick={() => setShowGallery(false)} className="text-gray-400 hover:text-gray-600"><X size={24}/></button>
            </div>
            <div className="flex-grow overflow-y-auto mb-6 pr-2">
              {galleryImages.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <ImageIcon className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p>图库中暂无图片</p>
                </div>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                  {galleryImages.map(img => (
                    <div 
                      key={img} 
                    onClick={() => {
                      if (galleryMode === '4grid') {
                        // Process 4-grid from gallery image
                        const imgUrl = `/downloads/${img}`;
                        const image = new Image();
                        image.onload = () => {
                          const canvas = document.createElement('canvas');
                          const context = canvas.getContext('2d');
                          if (!context) return;
                          
                          const w = image.width / 2;
                          const h = image.height / 2;
                          canvas.width = w;
                          canvas.height = h;

                          const quadrants = [
                            { x: 0, y: 0 },
                            { x: w, y: 0 },
                            { x: 0, y: h },
                            { x: w, y: h }
                          ];

                          const newImages = quadrants.map((q) => {
                            context.clearRect(0, 0, w, h);
                            context.drawImage(image, q.x, q.y, w, h, 0, 0, w, h);
                            return canvas.toDataURL('image/jpeg', 0.9);
                          });
                          
                          setSplitImages(newImages);
                          setSelectedSplitIndices([]);
                          setShowGallery(false);
                        };
                        image.src = imgUrl;
                      } else if (activeStoryboardId) {
                        updateStoryboard(activeStoryboardId, { image: `/downloads/${img}` });
                        setShowGallery(false);
                      }
                    }}
                    className="relative aspect-square rounded-lg overflow-hidden border-2 border-gray-200 hover:border-blue-500 cursor-pointer transition-all"
                  >
                    <img src={`/api/thumbnails/downloads/${img}`} className="w-full h-full object-cover" loading="lazy" />
                  </div>
                ))}
              </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Split Images Selection Modal */}
      {splitImages.length > 0 && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-[1000]">
          <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full flex flex-col max-h-[90vh]">
            <div className="p-4 border-b border-gray-100 flex justify-between items-center">
              <h3 className="font-bold text-lg">选择导入的分镜及顺序</h3>
              <button onClick={() => { setSplitImages([]); setSelectedSplitIndices([]); }} className="p-2 text-gray-400 hover:text-gray-600"><X size={20}/></button>
            </div>
            <div className="flex-grow overflow-auto p-6 bg-gray-50">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {splitImages.map((img, index) => {
                  const selectedOrder = selectedSplitIndices.indexOf(index);
                  const isSelected = selectedOrder !== -1;
                  return (
                    <div 
                      key={index}
                      onClick={() => {
                        if (isSelected) {
                          setSelectedSplitIndices(prev => prev.filter(i => i !== index));
                        } else {
                          setSelectedSplitIndices(prev => [...prev, index]);
                        }
                      }}
                      className={`relative aspect-square rounded-xl overflow-hidden border-4 cursor-pointer transition-all ${isSelected ? 'border-blue-500 shadow-md' : 'border-transparent hover:border-blue-300'}`}
                    >
                      <img src={img} className="w-full h-full object-cover" />
                      {isSelected && (
                        <div className="absolute top-2 right-2 w-8 h-8 bg-blue-500 text-white rounded-full flex items-center justify-center font-bold shadow-sm border-2 border-white">
                          {selectedOrder + 1}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="p-4 border-t border-gray-100 flex justify-end gap-3 bg-white">
              <button onClick={() => { setSplitImages([]); setSelectedSplitIndices([]); }} className="px-6 py-2.5 rounded-xl font-medium text-gray-600 bg-gray-100 hover:bg-gray-200">取消</button>
              <button 
                onClick={() => {
                  const newStoryboards = selectedSplitIndices.map(index => ({
                    id: Date.now().toString() + Math.random().toString(36).substring(7),
                    image: splitImages[index],
                    animation: 'none',
                    transition: 'none',
                    text: '',
                    textSize: 20,
                    textColor: '#ffffff',
                    textEffect: 'none',
                    duration: 3
                  }));
                  updateTask({ storyboards: [...task.storyboards, ...newStoryboards] });
                  setSplitImages([]);
                  setSelectedSplitIndices([]);
                }}
                disabled={selectedSplitIndices.length === 0}
                className="px-6 py-2.5 rounded-xl font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
              >
                确认导入 ({selectedSplitIndices.length})
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

