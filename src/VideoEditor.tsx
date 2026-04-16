import React, { useState, useRef, useEffect } from 'react';
import { Plus, Trash2, Upload, Settings, X, Image as ImageIcon, Download, PlayCircle, Clock, CheckCircle2, Music, Scissors, Paintbrush, ArrowLeft, ArrowRight, Copy, Grid, Type, Film } from 'lucide-react';
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
  const [isProcessing, setIsProcessing] = useState(false);
  const [brushSize, setBrushSize] = useState(30);
  const [undoHistory, setUndoHistory] = useState<ImageData[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastPos = useRef<{x: number, y: number} | null>(null);
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
    if (isSmudging && editingImage && canvasRef.current) {
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      if (context) {
        const img = new Image();
        img.onload = () => {
          canvas.width = img.width;
          canvas.height = img.height;
          context.lineCap = 'round';
          context.lineJoin = 'round';
          setCtx(context);
          setUndoHistory([]); // Reset history on load
        };
        img.src = editingImage.image;
      }
    }
  }, [isSmudging, editingImage]);

  // Image Editor Logic
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isSmudging || !ctx || !canvasRef.current) return;
    
    // Prevent scrolling on touch
    if ('touches' in e) {
      if (e.cancelable) e.preventDefault();
    }
    
    setIsDrawing(true);

    // Save current state for undo
    const currentState = ctx.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height);
    setUndoHistory(prev => [...prev, currentState]);

    const rect = canvasRef.current.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;

    lastPos.current = { x, y };

    // Use a radial gradient for a softer brush edge
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
    ctx.lineWidth = brushSize;
    
    // Create a soft brush effect by using shadowBlur
    ctx.shadowBlur = brushSize / 2;
    ctx.shadowColor = 'rgba(255, 0, 0, 0.8)';
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !isSmudging || !ctx || !canvasRef.current || !lastPos.current) return;
    
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

    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(x, y);
    ctx.stroke();

    lastPos.current = { x, y };
  };

  const stopDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    lastPos.current = null;
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
    if (!ctx || !canvasRef.current) return;
    const currentState = ctx.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height);
    setUndoHistory(prev => [...prev, currentState]);
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
  };

  const saveEditedImage = async () => {
    if (isSmudging && canvasRef.current && editingImage && imageRef.current) {
      setIsProcessing(true);
      
      // Simulate backend processing delay for UX
      await new Promise(resolve => setTimeout(resolve, 800));

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) return;

      canvas.width = imageRef.current.naturalWidth;
      canvas.height = imageRef.current.naturalHeight;
      const width = canvas.width;
      const height = canvas.height;

      // 1. Draw original image
      context.drawImage(imageRef.current, 0, 0);

      // 2. Get mask data from the smudge canvas and scale to natural size
      const maskCtx = canvasRef.current.getContext('2d');
      if (!maskCtx) return;
      
      const tempMaskCanvas = document.createElement('canvas');
      tempMaskCanvas.width = width;
      tempMaskCanvas.height = height;
      const tempMaskCtx = tempMaskCanvas.getContext('2d');
      if (!tempMaskCtx) return;
      tempMaskCtx.drawImage(canvasRef.current, 0, 0, width, height);
      const maskData = tempMaskCtx.getImageData(0, 0, width, height);
      
      // 3. Optimized Iterative Boundary Diffusion Algorithm
      const originalData = context.getImageData(0, 0, width, height);
      const pixels = originalData.data;
      const maskPixels = maskData.data;
      
      // Create a hole map with dilation
      const hole = new Uint8Array(width * height);
      const initialHole = new Uint8Array(width * height);
      let holeCount = 0;

      for (let i = 0; i < width * height; i++) {
        if (maskPixels[i * 4 + 3] > 20) { // Lower threshold to catch soft edges
          initialHole[i] = 1;
        }
      }

      // Dilate mask by 3px to ensure watermark edges are covered
      const dilation = 3;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = y * width + x;
          if (initialHole[idx] === 1) {
            for (let dy = -dilation; dy <= dilation; dy++) {
              for (let dx = -dilation; dx <= dilation; dx++) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                  const nidx = ny * width + nx;
                  if (hole[nidx] === 0) {
                    hole[nidx] = 1;
                    holeCount++;
                  }
                }
              }
            }
          }
        }
      }

      // Initial boundary finding
      let boundary = [];
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = y * width + x;
          if (hole[idx] === 1) {
            let isBoundary = false;
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
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

      // Iterative Diffusion Loop
      let iterations = 0;
      const maxIterations = 400; 
      
      while (iterations < maxIterations && holeCount > 0 && boundary.length > 0) {
        const nextBoundary = new Set<number>();
        const filledThisIteration = [];

        for (const p of boundary) {
          let r = 0, g = 0, b = 0, count = 0;
          // 9x9 neighbor sampling for balanced performance and context
          const radius = 4;
          for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
              const nx = p.x + dx;
              const ny = p.y + dy;
              if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                const nidx = ny * width + nx;
                if (hole[nidx] === 0) {
                  const off = nidx * 4;
                  const weight = 1 / (dx * dx + dy * dy + 0.5);
                  r += pixels[off] * weight;
                  g += pixels[off+1] * weight;
                  b += pixels[off+2] * weight;
                  count += weight;
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

        // Update hole map and find next boundary
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
                if (hole[nidx] === 1) {
                  nextBoundary.add(nidx);
                }
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
      
      // 4. Post-processing: Smooth and Composite
      context.putImageData(originalData, 0, 0);
      
      const blurCanvas = document.createElement('canvas');
      blurCanvas.width = width;
      blurCanvas.height = height;
      const blurCtx = blurCanvas.getContext('2d');
      if (blurCtx) {
        blurCtx.filter = 'blur(2px)'; // User requested 2px blur
        blurCtx.drawImage(canvas, 0, 0);
        const blurredData = blurCtx.getImageData(0, 0, width, height);
        
        for (let i = 0; i < maskPixels.length; i += 4) {
          const alpha = maskPixels[i + 3];
          if (alpha > 20) {
            // Smooth blending based on alpha
            const blend = Math.min(1, alpha / 150); // Boost coverage in center
            pixels[i] = pixels[i] * (1 - blend) + blurredData.data[i] * blend;
            pixels[i+1] = pixels[i+1] * (1 - blend) + blurredData.data[i+1] * blend;
            pixels[i+2] = pixels[i+2] * (1 - blend) + blurredData.data[i+2] * blend;
          }
        }
        context.putImageData(originalData, 0, 0);
      }

      const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
      updateStoryboard(editingImage.id, { image: dataUrl });
      setEditingImage(null);
      setIsProcessing(false);
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
                <button onClick={() => setIsSmudging(!isSmudging)} className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-xs sm:text-sm font-medium flex items-center gap-1.5 sm:gap-2 transition ${isSmudging ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                  <Paintbrush size={14} className="sm:w-4 sm:h-4"/> 涂抹填充
                </button>
                <button onClick={() => setEditingImage(null)} className="p-1.5 sm:p-2 text-gray-400 hover:text-gray-600"><X size={20}/></button>
              </div>
            </div>
            <div className="flex-grow min-h-0 overflow-hidden bg-gray-100 flex items-center justify-center relative touch-none p-4 sm:p-8">
              {isSmudging ? (
                <div className="relative max-w-full max-h-full shadow-lg rounded-lg overflow-hidden flex items-center justify-center bg-white">
                  <img ref={imageRef} src={editingImage.image} className="max-w-full max-h-full object-contain pointer-events-none block" style={{ maxHeight: 'calc(90vh - 200px)' }} />
                  <canvas 
                    ref={canvasRef}
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                    onTouchStart={startDrawing}
                    onTouchMove={draw}
                    onTouchEnd={stopDrawing}
                    className="absolute inset-0 w-full h-full cursor-crosshair touch-none"
                  />
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
                  <div className="flex items-center gap-2 bg-gray-50 px-2 py-1 rounded-lg border border-gray-100">
                    <span className="text-[10px] sm:text-sm text-gray-500 font-medium">画笔:</span>
                    <input 
                      type="range" 
                      min="5" max="100" 
                      value={brushSize} 
                      onChange={(e) => setBrushSize(parseInt(e.target.value))}
                      className="w-20 sm:w-32 accent-blue-600 h-1.5 sm:h-2"
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
                      onClick={clearMask}
                      className="px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-xs sm:text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition border border-gray-200"
                    >
                      清空
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

