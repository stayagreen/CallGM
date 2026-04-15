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
  onClose, 
  onSubmit, 
  galleryImages 
}: { 
  onClose: () => void, 
  onSubmit: (task: VideoTask) => void,
  galleryImages: string[]
}) {
  const [task, setTask] = useState<VideoTask>({
    id: Date.now().toString(),
    storyboards: [],
    introAnimation: 'none',
    outroAnimation: 'none',
    bgm: ''
  });

  const [bgmList, setBgmList] = useState<string[]>([]);
  const [playingBgm, setPlayingBgm] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [activeStoryboardId, setActiveStoryboardId] = useState<string | null>(null);
  const [editingImage, setEditingImage] = useState<{ id: string, image: string } | null>(null);

  // Image Editor State
  const [crop, setCrop] = useState<Crop>();
  const [isSmudging, setIsSmudging] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const blurredCanvasRef = useRef<HTMLCanvasElement | null>(null);
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

  const updateTask = (updates: Partial<VideoTask>) => setTask({ ...task, ...updates });

  const updateStoryboard = (id: string, updates: Partial<Storyboard>) => {
    setTask(prev => ({
      ...prev,
      storyboards: prev.storyboards.map(sb => sb.id === id ? { ...sb, ...updates } : sb)
    }));
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
          context.drawImage(img, 0, 0);
          setCtx(context);

          // Create blurred version for smudging
          const bCanvas = document.createElement('canvas');
          bCanvas.width = img.width;
          bCanvas.height = img.height;
          const bCtx = bCanvas.getContext('2d');
          if (bCtx) {
            bCtx.filter = 'blur(20px)';
            bCtx.drawImage(img, 0, 0);
            blurredCanvasRef.current = bCanvas;
          }
        };
        img.src = editingImage.image;
      }
    }
  }, [isSmudging, editingImage]);

  // Image Editor Logic
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isSmudging || !ctx || !canvasRef.current || !blurredCanvasRef.current) return;
    setIsDrawing(true);
    const rect = canvasRef.current.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;

    lastPos.current = { x, y };

    const pattern = ctx.createPattern(blurredCanvasRef.current, 'no-repeat');
    if (pattern) {
      ctx.strokeStyle = pattern;
      ctx.lineWidth = 40; // Thicker brush for smudging
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    }
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !isSmudging || !ctx || !canvasRef.current || !lastPos.current) return;
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
  };

  const saveEditedImage = () => {
    if (isSmudging && canvasRef.current && editingImage) {
      const dataUrl = canvasRef.current.toDataURL('image/jpeg', 0.9);
      updateStoryboard(editingImage.id, { image: dataUrl });
      setEditingImage(null);
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
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden flex flex-col h-full max-h-[85vh]">
      <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
        <h2 className="text-xl font-bold flex items-center gap-2"><Film className="text-blue-600"/> 视频生成任务</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={24}/></button>
      </div>

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
                {bgmList.map(bgm => <option key={bgm} value={bgm}>{bgm}</option>)}
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
                  <label className="w-full text-left px-4 py-3 hover:bg-gray-50 flex items-center gap-2 text-sm font-medium cursor-pointer">
                    <Grid size={16}/> 导入并4宫格分割
                    <input type="file" accept="image/*" multiple className="hidden" onChange={handle4GridSplit} />
                  </label>
                </div>
              )}
            </div>
          </div>

          <div className="flex overflow-x-auto pb-6 gap-4 snap-x">
            {task.storyboards.length === 0 ? (
              <div className="w-full py-12 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center text-gray-400">
                <Film size={48} className="mb-4 opacity-50"/>
                <p>暂无分镜，请点击右上角添加</p>
              </div>
            ) : (
              task.storyboards.map((sb, index) => (
                <div key={sb.id} className="w-[85vw] sm:w-[320px] bg-white border border-gray-200 rounded-2xl shadow-sm flex-shrink-0 snap-center overflow-hidden flex flex-col">
                  <div className="p-3 bg-gray-50 border-b border-gray-100 flex justify-between items-center">
                    <span className="font-bold text-gray-700">分镜 {index + 1}</span>
                    <div className="flex gap-1">
                      <button disabled={index === 0} onClick={() => moveStoryboard(index, -1)} className="p-1.5 text-gray-400 hover:text-blue-600 disabled:opacity-30"><ArrowLeft size={16}/></button>
                      <button disabled={index === task.storyboards.length - 1} onClick={() => moveStoryboard(index, 1)} className="p-1.5 text-gray-400 hover:text-blue-600 disabled:opacity-30"><ArrowRight size={16}/></button>
                      <button onClick={() => updateTask({ storyboards: task.storyboards.filter(s => s.id !== sb.id) })} className="p-1.5 text-gray-400 hover:text-red-600 ml-2"><Trash2 size={16}/></button>
                    </div>
                  </div>
                  
                  <div className="relative aspect-video bg-gray-100 flex items-center justify-center group">
                    {sb.image ? (
                      <>
                        <img src={sb.image} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                          <button onClick={() => setEditingImage({ id: sb.id, image: sb.image })} className="p-2 bg-white rounded-full text-gray-800 hover:bg-blue-50 hover:text-blue-600 transition"><Scissors size={20}/></button>
                          <label className="p-2 bg-white rounded-full text-gray-800 hover:bg-blue-50 hover:text-blue-600 transition cursor-pointer">
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
                          <button onClick={() => { setActiveStoryboardId(sb.id); setShowGallery(true); }} className="text-xs bg-white border border-gray-200 px-3 py-1.5 rounded-lg shadow-sm hover:bg-gray-50">从图库选择</button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="p-4 space-y-4 flex-grow bg-white">
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
                      <label className="text-xs font-bold text-gray-500 mb-2 flex items-center gap-1"><Type size={12}/> 添加文字</label>
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
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end">
        <button 
          onClick={() => onSubmit(task)}
          disabled={task.storyboards.length === 0}
          className="bg-blue-600 text-white px-8 py-3 rounded-xl font-bold hover:bg-blue-700 transition shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          <PlayCircle size={20}/> 提交视频渲染任务
        </button>
      </div>

      {/* Image Editor Modal */}
      {editingImage && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-[999]">
          <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full flex flex-col max-h-[90vh]">
            <div className="p-4 border-b border-gray-100 flex justify-between items-center">
              <h3 className="font-bold text-lg flex items-center gap-2"><Scissors size={20}/> 图片编辑</h3>
              <div className="flex gap-2">
                <button onClick={() => setIsSmudging(!isSmudging)} className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition ${isSmudging ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                  <Paintbrush size={16}/> 涂抹填充
                </button>
                <button onClick={() => setEditingImage(null)} className="p-2 text-gray-400 hover:text-gray-600"><X size={20}/></button>
              </div>
            </div>
            <div className="flex-grow overflow-auto p-6 bg-gray-100 flex items-center justify-center relative">
              {isSmudging ? (
                <canvas 
                  ref={canvasRef}
                  onMouseDown={startDrawing}
                  onMouseMove={draw}
                  onMouseUp={stopDrawing}
                  onMouseLeave={stopDrawing}
                  onTouchStart={startDrawing}
                  onTouchMove={draw}
                  onTouchEnd={stopDrawing}
                  className="max-w-full max-h-full object-contain cursor-crosshair shadow-lg"
                />
              ) : (
                <ReactCrop crop={crop} onChange={c => setCrop(c)}>
                  <img ref={imageRef} src={editingImage.image} className="max-w-full max-h-full object-contain shadow-lg" />
                </ReactCrop>
              )}
            </div>
            <div className="p-4 border-t border-gray-100 flex justify-end gap-3 bg-white">
              <button onClick={() => setEditingImage(null)} className="px-6 py-2.5 rounded-xl font-medium text-gray-600 bg-gray-100 hover:bg-gray-200">取消</button>
              <button onClick={saveEditedImage} className="px-6 py-2.5 rounded-xl font-medium text-white bg-blue-600 hover:bg-blue-700">保存修改</button>
            </div>
          </div>
        </div>
      )}

      {/* Gallery Picker Modal */}
      {showGallery && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-[999]">
          <div className="bg-white p-6 rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">从本地图库选择</h2>
              <button onClick={() => setShowGallery(false)} className="text-gray-400 hover:text-gray-600"><X size={24}/></button>
            </div>
            <div className="flex-grow overflow-y-auto mb-6 pr-2">
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                {galleryImages.map(img => (
                  <div 
                    key={img} 
                    onClick={() => {
                      if (activeStoryboardId) {
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

