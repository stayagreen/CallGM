import React, { useState, useRef, useEffect } from 'react';
import { X, Crop, Play, Pause, Check, Sliders, Maximize2 } from 'lucide-react';

interface VideoCropperProps {
  videoUrl: string;
  videoPath: string;
  onClose: () => void;
  onCropComplete: () => void;
}

export const VideoCropper: React.FC<VideoCropperProps> = ({
  videoUrl,
  videoPath,
  onClose,
  onCropComplete,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Original pixel size of the video
  const [videoMeta, setVideoMeta] = useState<{ width: number; height: number } | null>(null);

  // Visual display size of the video element inside the modal
  const [displayBounds, setDisplayBounds] = useState<{ width: number; height: number } | null>(null);

  // Selected aspect ratio preset
  const [aspectRatio, setAspectRatio] = useState<'1:1' | '3:4' | '9:16' | 'custom'>('custom');

  // Crop box position and size (all in percentages, from 0 to 100)
  const [crop, setCrop] = useState({ x: 10, y: 10, w: 80, h: 80 });

  // Dragging states
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState<string | null>(null); // 'tl', 'tr', 'bl', 'br'
  const [dragStart, setDragStart] = useState({ mouseX: 0, mouseY: 0, cropX: 0, cropY: 0, cropW: 0, cropH: 0 });

  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Monitor video playback status
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleTimeUpdate = () => setCurrentTime(video.currentTime);
    const handleDurationChange = () => setDuration(video.duration);

    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('durationchange', handleDurationChange);

    return () => {
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('durationchange', handleDurationChange);
    };
  }, []);

  // Update display bounds when video loads or window resizes
  const updateDisplayBounds = () => {
    const video = videoRef.current;
    if (!video) return;

    // The display dimensions of the video track itself
    const rect = video.getBoundingClientRect();
    if (rect.width && rect.height) {
      setDisplayBounds({
        width: rect.width,
        height: rect.height,
      });
    }
  };

  useEffect(() => {
    window.addEventListener('resize', updateDisplayBounds);
    return () => window.removeEventListener('resize', updateDisplayBounds);
  }, []);

  const handleLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget;
    setVideoMeta({
      width: video.videoWidth,
      height: video.videoHeight,
    });
    setDuration(video.duration);
    setTimeout(updateDisplayBounds, 100);
  };

  // Center preset ratio box
  const applyRatioPreset = (preset: '1:1' | '3:4' | '9:16' | 'custom') => {
    setAspectRatio(preset);
    if (!videoMeta || !displayBounds) return;

    if (preset === 'custom') {
      setCrop({ x: 10, y: 10, w: 80, h: 80 });
      return;
    }

    let R = 1.0;
    if (preset === '1:1') R = 1.0;
    else if (preset === '3:4') R = 3 / 4;
    else if (preset === '9:16') R = 9 / 16;

    const videoAspect = videoMeta.width / videoMeta.height;

    let w = 80;
    let h = 80;

    // Calculate crop percentage keeping aspect ratio fixed
    // w / h = R / videoAspect => w = h * (R / videoAspect)
    const testW = 80 * (R / videoAspect);
    if (testW <= 90) {
      w = testW;
      h = 80;
    } else {
      w = 80;
      h = 80 * (videoAspect / R);
    }

    const x = (100 - w) / 2;
    const y = (100 - h) / 2;

    setCrop({
      x: Math.max(0, Math.min(100 - w, x)),
      y: Math.max(0, Math.min(100 - h, y)),
      w: Math.max(5, Math.min(100, w)),
      h: Math.max(5, Math.min(100, h)),
    });
  };

  // Trigger preset re-eval when metadata loads
  useEffect(() => {
    if (videoMeta && displayBounds) {
      applyRatioPreset(aspectRatio);
    }
  }, [videoMeta, displayBounds]);

  // Handle Play/Pause
  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (isPlaying) {
      video.pause();
    } else {
      video.play().catch(() => {});
    }
  };

  // Drag and Resize Handlers
  const handleMouseDown = (e: React.MouseEvent, type: string) => {
    e.preventDefault();
    if (!displayBounds) return;

    setDragStart({
      mouseX: e.clientX,
      mouseY: e.clientY,
      cropX: crop.x,
      cropY: crop.y,
      cropW: crop.w,
      cropH: crop.h,
    });

    if (type === 'move') {
      setIsDragging(true);
    } else {
      setIsResizing(type);
    }
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging && !isResizing) return;
    if (!displayBounds || !videoMeta) return;

    const deltaX = e.clientX - dragStart.mouseX;
    const deltaY = e.clientY - dragStart.mouseY;

    // Convert pixel delta to percentage
    const deltaPctX = (deltaX / displayBounds.width) * 100;
    const deltaPctY = (deltaY / displayBounds.height) * 100;

    if (isDragging) {
      // Moving the crop box around
      let newX = dragStart.cropX + deltaPctX;
      let newY = dragStart.cropY + deltaPctY;

      // Keep inside bounds
      newX = Math.max(0, Math.min(100 - dragStart.cropW, newX));
      newY = Math.max(0, Math.min(100 - dragStart.cropH, newY));

      setCrop(prev => ({ ...prev, x: newX, y: newY }));
    } else if (isResizing) {
      // Resizing from handles: 'tl', 'tr', 'bl', 'br'
      let newX = dragStart.cropX;
      let newY = dragStart.cropY;
      let newW = dragStart.cropW;
      let newH = dragStart.cropH;

      const videoAspect = videoMeta.width / videoMeta.height;
      let targetRatio = 1.0;
      if (aspectRatio === '1:1') targetRatio = 1.0;
      else if (aspectRatio === '3:4') targetRatio = 3 / 4;
      else if (aspectRatio === '9:16') targetRatio = 9 / 16;

      if (aspectRatio === 'custom') {
        if (isResizing.includes('r')) {
          newW = Math.max(5, Math.min(100 - dragStart.cropX, dragStart.cropW + deltaPctX));
        }
        if (isResizing.includes('l')) {
          const maxLeftShift = dragStart.cropX + dragStart.cropW - 5;
          const shift = Math.max(-dragStart.cropX, Math.min(maxLeftShift, deltaPctX));
          newX = dragStart.cropX + shift;
          newW = dragStart.cropW - shift;
        }
        if (isResizing.includes('b')) {
          newH = Math.max(5, Math.min(100 - dragStart.cropY, dragStart.cropH + deltaPctY));
        }
        if (isResizing.includes('t')) {
          const maxTopShift = dragStart.cropY + dragStart.cropH - 5;
          const shift = Math.max(-dragStart.cropY, Math.min(maxTopShift, deltaPctY));
          newY = dragStart.cropY + shift;
          newH = dragStart.cropH - shift;
        }
      } else {
        // Enforce aspect ratio resizing
        // w_pixels / h_pixels = targetRatio
        // w / h = targetRatio / videoAspect => h = w * (videoAspect / targetRatio)
        if (isResizing === 'br') {
          newW = Math.max(5, Math.min(100 - dragStart.cropX, dragStart.cropW + deltaPctX));
          newH = newW * (videoAspect / targetRatio);
          
          // If height exceeds bounds, clamp both
          if (dragStart.cropY + newH > 100) {
            newH = 100 - dragStart.cropY;
            newW = newH * (targetRatio / videoAspect);
          }
        } else if (isResizing === 'bl') {
          const maxLeftShift = dragStart.cropX + dragStart.cropW - 5;
          const shift = Math.max(-dragStart.cropX, Math.min(maxLeftShift, deltaPctX));
          newX = dragStart.cropX + shift;
          newW = dragStart.cropW - shift;
          newH = newW * (videoAspect / targetRatio);

          if (dragStart.cropY + newH > 100) {
            newH = 100 - dragStart.cropY;
            newW = newH * (targetRatio / videoAspect);
            newX = dragStart.cropX + (dragStart.cropW - newW);
          }
        } else if (isResizing === 'tr') {
          newW = Math.max(5, Math.min(100 - dragStart.cropX, dragStart.cropW + deltaPctX));
          newH = newW * (videoAspect / targetRatio);
          
          const shiftY = newH - dragStart.cropH;
          newY = dragStart.cropY - shiftY;

          if (newY < 0) {
            newY = 0;
            newH = dragStart.cropY + dragStart.cropH;
            newW = newH * (targetRatio / videoAspect);
          }
        } else if (isResizing === 'tl') {
          const maxLeftShift = dragStart.cropX + dragStart.cropW - 5;
          const shift = Math.max(-dragStart.cropX, Math.min(maxLeftShift, deltaPctX));
          newX = dragStart.cropX + shift;
          newW = dragStart.cropW - shift;
          newH = newW * (videoAspect / targetRatio);

          const shiftY = newH - dragStart.cropH;
          newY = dragStart.cropY - shiftY;

          if (newY < 0) {
            newY = 0;
            newH = dragStart.cropY + dragStart.cropH;
            newW = newH * (targetRatio / videoAspect);
            newX = dragStart.cropX + (dragStart.cropW - newW);
          }
        }
      }

      setCrop({
        x: Math.max(0, Math.min(95, newX)),
        y: Math.max(0, Math.min(95, newY)),
        w: Math.max(5, Math.min(100, newW)),
        h: Math.max(5, Math.min(100, newH)),
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    setIsResizing(null);
  };

  useEffect(() => {
    if (isDragging || isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, isResizing, dragStart, crop, aspectRatio, displayBounds, videoMeta]);

  // Touch support for tablets/mobiles
  const handleTouchStart = (e: React.TouchEvent, type: string) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    if (!displayBounds) return;

    setDragStart({
      mouseX: touch.clientX,
      mouseY: touch.clientY,
      cropX: crop.x,
      cropY: crop.y,
      cropW: crop.w,
      cropH: crop.h,
    });

    if (type === 'move') {
      setIsDragging(true);
    } else {
      setIsResizing(type);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    if (!isDragging && !isResizing) return;
    if (!displayBounds || !videoMeta) return;

    const deltaX = touch.clientX - dragStart.mouseX;
    const deltaY = touch.clientY - dragStart.mouseY;

    const deltaPctX = (deltaX / displayBounds.width) * 100;
    const deltaPctY = (deltaY / displayBounds.height) * 100;

    if (isDragging) {
      let newX = dragStart.cropX + deltaPctX;
      let newY = dragStart.cropY + deltaPctY;
      newX = Math.max(0, Math.min(100 - dragStart.cropW, newX));
      newY = Math.max(0, Math.min(100 - dragStart.cropH, newY));
      setCrop(prev => ({ ...prev, x: newX, y: newY }));
    } else if (isResizing) {
      let newX = dragStart.cropX;
      let newY = dragStart.cropY;
      let newW = dragStart.cropW;
      let newH = dragStart.cropH;

      const videoAspect = videoMeta.width / videoMeta.height;
      let targetRatio = 1.0;
      if (aspectRatio === '1:1') targetRatio = 1.0;
      else if (aspectRatio === '3:4') targetRatio = 3 / 4;
      else if (aspectRatio === '9:16') targetRatio = 9 / 16;

      if (aspectRatio === 'custom') {
        if (isResizing.includes('r')) newW = Math.max(5, Math.min(100 - dragStart.cropX, dragStart.cropW + deltaPctX));
        if (isResizing.includes('l')) {
          const shift = Math.max(-dragStart.cropX, Math.min(dragStart.cropX + dragStart.cropW - 5, deltaPctX));
          newX = dragStart.cropX + shift;
          newW = dragStart.cropW - shift;
        }
        if (isResizing.includes('b')) newH = Math.max(5, Math.min(100 - dragStart.cropY, dragStart.cropH + deltaPctY));
        if (isResizing.includes('t')) {
          const shift = Math.max(-dragStart.cropY, Math.min(dragStart.cropY + dragStart.cropH - 5, deltaPctY));
          newY = dragStart.cropY + shift;
          newH = dragStart.cropH - shift;
        }
      } else {
        if (isResizing === 'br') {
          newW = Math.max(5, Math.min(100 - dragStart.cropX, dragStart.cropW + deltaPctX));
          newH = newW * (videoAspect / targetRatio);
          if (dragStart.cropY + newH > 100) {
            newH = 100 - dragStart.cropY;
            newW = newH * (targetRatio / videoAspect);
          }
        } else if (isResizing === 'bl') {
          const shift = Math.max(-dragStart.cropX, Math.min(dragStart.cropX + dragStart.cropW - 5, deltaPctX));
          newX = dragStart.cropX + shift;
          newW = dragStart.cropW - shift;
          newH = newW * (videoAspect / targetRatio);
          if (dragStart.cropY + newH > 100) {
            newH = 100 - dragStart.cropY;
            newW = newH * (targetRatio / videoAspect);
            newX = dragStart.cropX + (dragStart.cropW - newW);
          }
        } else if (isResizing === 'tr') {
          newW = Math.max(5, Math.min(100 - dragStart.cropX, dragStart.cropW + deltaPctX));
          newH = newW * (videoAspect / targetRatio);
          const shiftY = newH - dragStart.cropH;
          newY = dragStart.cropY - shiftY;
          if (newY < 0) {
            newY = 0;
            newH = dragStart.cropY + dragStart.cropH;
            newW = newH * (targetRatio / videoAspect);
          }
        } else if (isResizing === 'tl') {
          const shift = Math.max(-dragStart.cropX, Math.min(dragStart.cropX + dragStart.cropW - 5, deltaPctX));
          newX = dragStart.cropX + shift;
          newW = dragStart.cropW - shift;
          newH = newW * (videoAspect / targetRatio);
          const shiftY = newH - dragStart.cropH;
          newY = dragStart.cropY - shiftY;
          if (newY < 0) {
            newY = 0;
            newH = dragStart.cropY + dragStart.cropH;
            newW = newH * (targetRatio / videoAspect);
            newX = dragStart.cropX + (dragStart.cropW - newW);
          }
        }
      }

      setCrop({
        x: Math.max(0, Math.min(95, newX)),
        y: Math.max(0, Math.min(95, newY)),
        w: Math.max(5, Math.min(100, newW)),
        h: Math.max(5, Math.min(100, newH)),
      });
    }
  };

  const executeCrop = async () => {
    if (!videoMeta) return;

    setIsProcessing(true);
    setErrorMessage(null);

    // Calculate actual pixel values for FFMPEG
    // crop percentages * original video metadata dimensions
    const realX = (crop.x / 100) * videoMeta.width;
    const realY = (crop.y / 100) * videoMeta.height;
    const realW = (crop.w / 100) * videoMeta.width;
    const realH = (crop.h / 100) * videoMeta.height;

    try {
      const response = await fetch('/api/videos/crop', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          videoPath,
          x: realX,
          y: realY,
          width: realW,
          height: realH,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || '裁剪视频时出错');
      }

      setIsProcessing(false);
      onCropComplete();
    } catch (err: any) {
      console.error('[VideoCropper] Error:', err);
      setErrorMessage(err.message || '网络或服务端执行失败，请重试');
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex flex-col items-center justify-center p-4 z-[2000] animate-fade-in text-white">
      {/* Container Card */}
      <div className="bg-gray-900 rounded-2xl shadow-2xl border border-gray-800 max-w-5xl w-full max-h-[92vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-800 flex justify-between items-center bg-gray-950/40">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-blue-500/20 text-blue-400 rounded-lg">
              <Crop size={18} />
            </div>
            <div>
              <h3 className="font-bold text-base text-gray-100">高画质无损视频裁剪</h3>
              <p className="text-[11px] text-gray-400 mt-0.5">
                支持高精度自定义及 1:1, 3:4, 9:16 黄金比例硬编码裁剪
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1.5 rounded-full hover:bg-gray-800 transition cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center justify-center min-h-0 bg-gray-950/20">
          {errorMessage && (
            <div className="w-full max-w-xl mb-4 bg-red-900/30 border border-red-500/50 text-red-200 px-4 py-3 rounded-xl text-xs font-semibold flex items-center justify-between">
              <span>{errorMessage}</span>
              <button onClick={() => setErrorMessage(null)} className="text-red-400 hover:text-red-200">
                <X size={14} />
              </button>
            </div>
          )}

          {/* Video Player Display Container */}
          <div
            ref={containerRef}
            className="relative w-full max-w-2xl bg-black rounded-xl overflow-hidden flex items-center justify-center border border-gray-800 select-none shadow-inner"
            style={{ minHeight: '320px', maxHeight: '52vh' }}
          >
            <video
              ref={videoRef}
              src={videoUrl}
              onLoadedMetadata={handleLoadedMetadata}
              className="max-h-[52vh] w-auto h-auto object-contain mx-auto block"
              playsInline
              muted
              loop
            />

            {/* Display overlay with crop rectangle */}
            {displayBounds && (
              <div
                className="absolute"
                style={{
                  width: `${displayBounds.width}px`,
                  height: `${displayBounds.height}px`,
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                }}
              >
                {/* Crop dimming overlays (Outer shaded regions) */}
                {/* Top Overlay */}
                <div
                  className="absolute bg-black/60 left-0 right-0 top-0"
                  style={{ height: `${crop.y}%` }}
                />
                {/* Bottom Overlay */}
                <div
                  className="absolute bg-black/60 left-0 right-0 bottom-0"
                  style={{ height: `${100 - crop.y - crop.h}%` }}
                />
                {/* Left Overlay */}
                <div
                  className="absolute bg-black/60 left-0"
                  style={{
                    top: `${crop.y}%`,
                    height: `${crop.h}%`,
                    width: `${crop.x}%`,
                  }}
                />
                {/* Right Overlay */}
                <div
                  className="absolute bg-black/60 right-0"
                  style={{
                    top: `${crop.y}%`,
                    height: `${crop.h}%`,
                    width: `${100 - crop.x - crop.w}%`,
                  }}
                />

                {/* Cropping box boundary box */}
                <div
                  className="absolute border-2 border-blue-400 shadow-2xl cursor-move flex items-center justify-center"
                  style={{
                    left: `${crop.x}%`,
                    top: `${crop.y}%`,
                    width: `${crop.w}%`,
                    height: `${crop.h}%`,
                  }}
                  onMouseDown={(e) => handleMouseDown(e, 'move')}
                  onTouchStart={(e) => handleTouchStart(e, 'move')}
                >
                  {/* Grid Lines within crop box */}
                  <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none opacity-40">
                    <div className="border-r border-b border-dashed border-white/50" />
                    <div className="border-r border-b border-dashed border-white/50" />
                    <div className="border-b border-dashed border-white/50" />
                    <div className="border-r border-b border-dashed border-white/50" />
                    <div className="border-r border-b border-dashed border-white/50" />
                    <div className="border-b border-dashed border-white/50" />
                  </div>

                  {/* Drag Handles */}
                  {/* Top-Left */}
                  <div
                    className="absolute w-5 h-5 -top-1.5 -left-1.5 border-t-4 border-l-4 border-blue-400 cursor-nwse-resize z-30"
                    onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, 'tl'); }}
                    onTouchStart={(e) => { e.stopPropagation(); handleTouchStart(e, 'tl'); }}
                  />
                  {/* Top-Right */}
                  <div
                    className="absolute w-5 h-5 -top-1.5 -right-1.5 border-t-4 border-r-4 border-blue-400 cursor-nesw-resize z-30"
                    onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, 'tr'); }}
                    onTouchStart={(e) => { e.stopPropagation(); handleTouchStart(e, 'tr'); }}
                  />
                  {/* Bottom-Left */}
                  <div
                    className="absolute w-5 h-5 -bottom-1.5 -left-1.5 border-b-4 border-l-4 border-blue-400 cursor-nesw-resize z-30"
                    onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, 'bl'); }}
                    onTouchStart={(e) => { e.stopPropagation(); handleTouchStart(e, 'bl'); }}
                  />
                  {/* Bottom-Right */}
                  <div
                    className="absolute w-5 h-5 -bottom-1.5 -right-1.5 border-b-4 border-r-4 border-blue-400 cursor-nwse-resize z-30"
                    onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, 'br'); }}
                    onTouchStart={(e) => { e.stopPropagation(); handleTouchStart(e, 'br'); }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Quick Coordinate slider adjustment block */}
          {displayBounds && videoMeta && (
            <div className="w-full max-w-xl mt-5 bg-gray-900/60 p-4 rounded-xl border border-gray-800/80 flex flex-col gap-3">
              <div className="flex items-center justify-between text-[11px] font-bold text-gray-400 tracking-wider">
                <span className="flex items-center gap-1"><Sliders size={12} className="text-blue-400" /> 微调参数</span>
                <span className="font-mono text-gray-300">
                  原尺寸: {videoMeta.width} × {videoMeta.height} | 裁后尺寸: {Math.round((crop.w / 100) * videoMeta.width)} × {Math.round((crop.h / 100) * videoMeta.height)}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                {/* X Position */}
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">横向起点 (X)</span>
                  <div className="flex items-center gap-2 w-32">
                    <input
                      type="range"
                      min="0"
                      max={100 - crop.w}
                      value={Math.round(crop.x)}
                      onChange={(e) => {
                        const nextX = parseInt(e.target.value, 10);
                        setCrop(prev => ({ ...prev, x: Math.max(0, Math.min(100 - prev.w, nextX)) }));
                      }}
                      className="w-full accent-blue-500 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                    />
                    <span className="font-mono text-gray-300 text-[10px] w-6 text-right">{Math.round(crop.x)}%</span>
                  </div>
                </div>

                {/* Y Position */}
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">纵向起点 (Y)</span>
                  <div className="flex items-center gap-2 w-32">
                    <input
                      type="range"
                      min="0"
                      max={100 - crop.h}
                      value={Math.round(crop.y)}
                      onChange={(e) => {
                        const nextY = parseInt(e.target.value, 10);
                        setCrop(prev => ({ ...prev, y: Math.max(0, Math.min(100 - prev.h, nextY)) }));
                      }}
                      className="w-full accent-blue-500 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                    />
                    <span className="font-mono text-gray-300 text-[10px] w-6 text-right">{Math.round(crop.y)}%</span>
                  </div>
                </div>

                {/* Width */}
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">裁剪宽度 (W)</span>
                  <div className="flex items-center gap-2 w-32">
                    <input
                      type="range"
                      min="5"
                      max={100 - crop.x}
                      value={Math.round(crop.w)}
                      onChange={(e) => {
                        const nextW = parseInt(e.target.value, 10);
                        if (aspectRatio === 'custom') {
                          setCrop(prev => ({ ...prev, w: Math.max(5, Math.min(100 - prev.x, nextW)) }));
                        } else {
                          const targetRatio = aspectRatio === '1:1' ? 1.0 : aspectRatio === '3:4' ? 3 / 4 : 9 / 16;
                          const videoAspect = videoMeta.width / videoMeta.height;
                          let nextH = nextW * (videoAspect / targetRatio);
                          if (crop.y + nextH <= 100) {
                            setCrop(prev => ({ ...prev, w: nextW, h: nextH }));
                          }
                        }
                      }}
                      className="w-full accent-blue-500 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                    />
                    <span className="font-mono text-gray-300 text-[10px] w-6 text-right">{Math.round(crop.w)}%</span>
                  </div>
                </div>

                {/* Height */}
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">裁剪高度 (H)</span>
                  <div className="flex items-center gap-2 w-32">
                    <input
                      type="range"
                      min="5"
                      max={100 - crop.y}
                      value={Math.round(crop.h)}
                      disabled={aspectRatio !== 'custom'}
                      onChange={(e) => {
                        if (aspectRatio === 'custom') {
                          const nextH = parseInt(e.target.value, 10);
                          setCrop(prev => ({ ...prev, h: Math.max(5, Math.min(100 - prev.y, nextH)) }));
                        }
                      }}
                      className={`w-full accent-blue-500 h-1 bg-gray-700 rounded-lg appearance-none ${aspectRatio === 'custom' ? 'cursor-pointer' : 'opacity-40 cursor-not-allowed'}`}
                    />
                    <span className="font-mono text-gray-300 text-[10px] w-6 text-right">{Math.round(crop.h)}%</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-800 bg-gray-950/40 flex justify-between items-center">
          {/* Preset Buttons */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-gray-400 tracking-wider uppercase mr-1">
              裁剪比例:
            </span>
            {[
              { label: '自由尺寸', key: 'custom' },
              { label: '1:1 方形', key: '1:1' },
              { label: '3:4 竖屏', key: '3:4' },
              { label: '9:16 短视频', key: '9:16' },
            ].map(preset => (
              <button
                key={preset.key}
                onClick={() => applyRatioPreset(preset.key as any)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer select-none ${
                  aspectRatio === preset.key
                    ? 'bg-blue-600 border-blue-500 text-white shadow-md shadow-blue-950/30 font-bold'
                    : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700 hover:text-white'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-3">
            {/* Play/Pause monitor assist */}
            <button
              onClick={togglePlay}
              className="px-4 py-2 text-xs font-semibold bg-gray-800 hover:bg-gray-750 text-gray-200 border border-gray-700 rounded-xl transition cursor-pointer flex items-center gap-1.5"
            >
              {isPlaying ? <Pause size={14} /> : <Play size={14} />}
              <span>{isPlaying ? '暂停预览' : '播放视频'}</span>
            </button>

            <button
              onClick={onClose}
              disabled={isProcessing}
              className="px-4 py-2 text-xs font-semibold bg-gray-800 hover:bg-gray-750 text-gray-300 border border-gray-700 rounded-xl transition disabled:opacity-50 cursor-pointer"
            >
              取消
            </button>

            <button
              onClick={executeCrop}
              disabled={isProcessing || !videoMeta}
              className="px-6 py-2 text-xs font-bold bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white rounded-xl transition disabled:opacity-50 shadow-md shadow-blue-950/40 flex items-center gap-1.5 cursor-pointer"
            >
              {isProcessing ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>正在渲染裁剪...</span>
                </>
              ) : (
                <>
                  <Check size={14} />
                  <span>确定裁剪</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
