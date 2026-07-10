import React, { useState, useEffect, useRef } from 'react';
import { X, Music, Play, Pause, Check, VolumeX, Volume2, SkipBack, SkipForward, AlertCircle } from 'lucide-react';

interface VideoBgmChangerProps {
  videoUrl: string;
  videoPath: string;
  onClose: () => void;
  onComplete: () => void;
}

export const VideoBgmChanger: React.FC<VideoBgmChangerProps> = ({
  videoUrl,
  videoPath,
  onClose,
  onComplete,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [bgmList, setBgmList] = useState<string[]>([]);
  const [selectedBgm, setSelectedBgm] = useState<string>('');
  const [playingBgm, setPlayingBgm] = useState<string | null>(null);

  const [muteOriginal, setMuteOriginal] = useState<boolean>(true);
  const [isVideoPlaying, setIsVideoPlaying] = useState<boolean>(false);

  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Fetch BGM list on mount
  useEffect(() => {
    fetch('/api/bgm')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setBgmList(data);
        }
      })
      .catch(err => {
        console.error('Failed to load bgm list', err);
        setErrorMessage('加载背景音乐列表失败');
      });
  }, []);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  // Handle BGM Audition play/pause
  const toggleBgmPlay = (bgm: string) => {
    if (!bgm) return;

    if (playingBgm === bgm) {
      // Pause
      if (audioRef.current) {
        audioRef.current.pause();
      }
      setPlayingBgm(null);
    } else {
      // Play
      if (audioRef.current) {
        audioRef.current.pause();
      }

      const audio = new Audio(`/bgm/${bgm}`);
      audio.loop = true;
      audio.play().catch(e => {
        console.error('Failed to play audition audio', e);
      });
      audioRef.current = audio;
      setPlayingBgm(bgm);
      setSelectedBgm(bgm);
    }
  };

  const playPreviousBgm = () => {
    if (bgmList.length === 0) return;
    let newIndex = bgmList.length - 1;
    if (selectedBgm) {
      const idx = bgmList.indexOf(selectedBgm);
      if (idx !== -1) {
        newIndex = (idx - 1 + bgmList.length) % bgmList.length;
      }
    }
    const nextBgm = bgmList[newIndex];
    setSelectedBgm(nextBgm);
    
    // Auto-play the new one if we were playing, or just update the audio source
    if (audioRef.current) {
      audioRef.current.pause();
    }
    const audio = new Audio(`/bgm/${nextBgm}`);
    audio.loop = true;
    audio.play().catch(() => {});
    audioRef.current = audio;
    setPlayingBgm(nextBgm);
  };

  const playNextBgm = () => {
    if (bgmList.length === 0) return;
    let newIndex = 0;
    if (selectedBgm) {
      const idx = bgmList.indexOf(selectedBgm);
      if (idx !== -1) {
        newIndex = (idx + 1) % bgmList.length;
      }
    }
    const nextBgm = bgmList[newIndex];
    setSelectedBgm(nextBgm);

    if (audioRef.current) {
      audioRef.current.pause();
    }
    const audio = new Audio(`/bgm/${nextBgm}`);
    audio.loop = true;
    audio.play().catch(() => {});
    audioRef.current = audio;
    setPlayingBgm(nextBgm);
  };

  // Video preview playback toggle
  const toggleVideoPlay = () => {
    const video = videoRef.current;
    if (!video) return;

    if (isVideoPlaying) {
      video.pause();
      setIsVideoPlaying(false);
    } else {
      // If we are auditioning BGM, let's play video together
      video.play().catch(() => {});
      setIsVideoPlaying(true);
    }
  };

  // Sync mute setting to preview video element
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = muteOriginal;
    }
  }, [muteOriginal]);

  // Execute background music replacement on server
  const handleConfirm = async () => {
    setIsProcessing(true);
    setErrorMessage(null);

    // Stop audition audio
    if (audioRef.current) {
      audioRef.current.pause();
      setPlayingBgm(null);
    }

    try {
      const response = await fetch('/api/videos/change-bgm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          videoPath,
          bgmName: selectedBgm,
          muteOriginal,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || '更换背景音乐失败');
      }

      setIsProcessing(false);
      onComplete();
    } catch (err: any) {
      console.error('[VideoBgmChanger] error:', err);
      setErrorMessage(err.message || '更换背景音乐失败，请重试');
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex flex-col items-center justify-center p-4 z-[2000] animate-fade-in text-white">
      {/* Container Card */}
      <div className="bg-gray-900 rounded-2xl shadow-2xl border border-gray-800 max-w-4xl w-full max-h-[92vh] overflow-hidden flex flex-col">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-800 flex justify-between items-center bg-gray-950/40">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-purple-500/20 text-purple-400 rounded-lg">
              <Music size={18} />
            </div>
            <div>
              <h3 className="font-bold text-base text-gray-100">视频更换背景音乐 (BGM)</h3>
              <p className="text-[11px] text-gray-400 mt-0.5">
                支持屏蔽原声、选择新BGM或进行音频混合，即时试听与生成
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
        <div className="flex-1 overflow-y-auto p-6 flex flex-col md:flex-row gap-6 bg-gray-950/20 min-h-0">
          
          {/* Left Column: Video Preview and Mute Option */}
          <div className="flex-1 flex flex-col gap-4">
            <span className="text-xs font-bold text-gray-400 tracking-wider uppercase">视频预览</span>
            
            <div className="relative flex-1 bg-black rounded-xl overflow-hidden flex items-center justify-center border border-gray-800 shadow-inner min-h-[220px]">
              <video
                ref={videoRef}
                src={videoUrl}
                className="max-h-[38vh] w-auto h-auto object-contain block"
                playsInline
                loop
                muted={muteOriginal}
                onPlay={() => setIsVideoPlaying(true)}
                onPause={() => setIsVideoPlaying(false)}
              />
              
              {/* Play Overlay Button */}
              <button
                onClick={toggleVideoPlay}
                className="absolute p-4 bg-black/60 hover:bg-black/80 rounded-full text-white backdrop-blur-sm transition border border-white/10 hover:scale-105 active:scale-95 cursor-pointer"
              >
                {isVideoPlaying ? <Pause size={24} /> : <Play size={24} />}
              </button>
            </div>

            {/* Audio Options Card */}
            <div className="bg-gray-900/60 p-4 rounded-xl border border-gray-800/80 flex flex-col gap-3">
              <span className="text-[11px] font-bold text-gray-400 tracking-wider uppercase">声音设置</span>
              
              <label className="flex items-center gap-3 p-3 bg-gray-950/40 rounded-lg border border-gray-800/60 cursor-pointer hover:bg-gray-950/60 transition select-none">
                <input
                  type="checkbox"
                  checked={muteOriginal}
                  onChange={(e) => setMuteOriginal(e.target.checked)}
                  className="w-4.5 h-4.5 accent-purple-500 rounded text-purple-600 focus:ring-purple-500 bg-gray-800 border-gray-700"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-gray-200">
                    {muteOriginal ? <VolumeX size={14} className="text-red-400" /> : <Volume2 size={14} className="text-green-400" />}
                    <span>屏蔽原视频声音</span>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    勾选后视频原有声音将被完全消除；不勾选则将新背景音乐与原视频声音进行智能混合。
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* Right Column: BGM List and Selector */}
          <div className="w-full md:w-96 flex flex-col gap-4">
            <span className="text-xs font-bold text-gray-400 tracking-wider uppercase flex items-center justify-between">
              <span>选择新背景音乐</span>
              <span className="text-[10px] text-gray-500 font-normal">共 {bgmList.length} 首</span>
            </span>

            {/* Selected Info & Controls */}
            <div className="bg-purple-950/15 border border-purple-800/30 p-4 rounded-xl flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-purple-500/10 text-purple-400 rounded-lg mt-0.5">
                  <Music size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">当前已选 BGM</span>
                  <p className="text-xs font-bold text-gray-100 truncate mt-0.5" title={selectedBgm || '无'}>
                    {selectedBgm || '无 (保持静音或原视频声音)'}
                  </p>
                </div>
              </div>

              {/* Audition Player Panel */}
              <div className="flex items-center justify-between bg-gray-950/40 px-3 py-2 rounded-lg border border-gray-800/60 gap-2">
                <span className="text-[10px] text-gray-400 font-medium">试听控制</span>
                <div className="flex gap-1.5 items-center">
                  {/* Previous Button */}
                  <button
                    type="button"
                    title="上一首"
                    onClick={playPreviousBgm}
                    disabled={bgmList.length === 0}
                    className="p-1 px-1.5 bg-gray-800 hover:bg-purple-900/30 text-gray-400 hover:text-purple-300 rounded border border-gray-750 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center justify-center"
                  >
                    <SkipBack size={13} />
                  </button>

                  {/* Play / Pause button */}
                  <button
                    type="button"
                    title={playingBgm && playingBgm === selectedBgm ? "暂停试听" : "播放试听"}
                    onClick={() => {
                      if (selectedBgm) {
                        toggleBgmPlay(selectedBgm);
                      } else if (bgmList.length > 0) {
                        toggleBgmPlay(bgmList[0]);
                      }
                    }}
                    disabled={bgmList.length === 0}
                    className={`p-1 px-2.5 rounded border text-[11px] font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center justify-center gap-1 ${
                      playingBgm && playingBgm === selectedBgm
                        ? 'bg-purple-600/20 text-purple-300 border-purple-500/40 hover:bg-purple-600/30' 
                        : 'bg-blue-600/20 text-blue-300 border-blue-500/40 hover:bg-blue-600/30'
                    }`}
                  >
                    {playingBgm && playingBgm === selectedBgm ? (
                      <>
                        <Pause size={12} />
                        <span>暂停</span>
                      </>
                    ) : (
                      <>
                        <Play size={12} />
                        <span>试听</span>
                      </>
                    )}
                  </button>

                  {/* Next Button */}
                  <button
                    type="button"
                    title="下一首"
                    onClick={playNextBgm}
                    disabled={bgmList.length === 0}
                    className="p-1 px-1.5 bg-gray-800 hover:bg-purple-900/30 text-gray-400 hover:text-purple-300 rounded border border-gray-750 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center justify-center"
                  >
                    <SkipForward size={13} />
                  </button>
                </div>
              </div>
            </div>

            {/* BGM Selection List (Scrollable grid) */}
            <div className="flex-1 overflow-y-auto border border-gray-800 rounded-xl bg-gray-950/30 max-h-[280px]">
              {bgmList.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-8 text-center text-gray-500 h-full">
                  <AlertCircle size={24} className="mb-2 text-gray-600" />
                  <p className="text-xs">暂无可用背景音乐</p>
                  <p className="text-[10px] mt-1">可在系统设置一键打开BGM文件夹进行添加</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-800/60">
                  {/* None option */}
                  <div
                    onClick={() => {
                      setSelectedBgm('');
                      if (audioRef.current) {
                        audioRef.current.pause();
                      }
                      setPlayingBgm(null);
                    }}
                    className={`flex items-center justify-between p-3 cursor-pointer transition text-xs font-semibold ${
                      selectedBgm === '' ? 'bg-purple-500/10 text-purple-400' : 'hover:bg-gray-800/40 text-gray-300'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <VolumeX size={14} className="opacity-60" />
                      <span>不添加新背景音乐</span>
                    </div>
                    {selectedBgm === '' && <Check size={14} className="text-purple-400" />}
                  </div>

                  {/* BGM items */}
                  {bgmList.map((bgmName, idx) => {
                    const isSelected = selectedBgm === bgmName;
                    const isBgmPlaying = playingBgm === bgmName;

                    return (
                      <div
                        key={bgmName}
                        onClick={() => {
                          setSelectedBgm(bgmName);
                          // If playing, play the new clicked one directly
                          if (playingBgm) {
                            if (audioRef.current) {
                              audioRef.current.pause();
                            }
                            const audio = new Audio(`/bgm/${bgmName}`);
                            audio.loop = true;
                            audio.play().catch(() => {});
                            audioRef.current = audio;
                            setPlayingBgm(bgmName);
                          }
                        }}
                        className={`flex items-center justify-between p-3 cursor-pointer transition text-xs font-semibold ${
                          isSelected ? 'bg-purple-500/10 text-purple-300' : 'hover:bg-gray-800/40 text-gray-300'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1 pr-2">
                          <Music size={13} className={isSelected ? 'text-purple-400' : 'text-gray-500'} />
                          <span className="truncate" title={bgmName}>{bgmName}</span>
                        </div>
                        <div className="flex items-center gap-2.5">
                          {/* Item Audio Play Action */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleBgmPlay(bgmName);
                            }}
                            className={`p-1 rounded hover:bg-gray-800 transition ${isBgmPlaying ? 'text-purple-400' : 'text-gray-500 hover:text-white'}`}
                          >
                            {isBgmPlaying ? <Pause size={12} /> : <Play size={12} />}
                          </button>
                          {isSelected && <Check size={14} className="text-purple-400" />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Global Error Notice if any */}
        {errorMessage && (
          <div className="mx-6 mb-4 bg-red-900/30 border border-red-500/50 text-red-200 px-4 py-3 rounded-xl text-xs font-semibold flex items-center justify-between">
            <span>{errorMessage}</span>
            <button onClick={() => setErrorMessage(null)} className="text-red-400 hover:text-red-200">
              <X size={14} />
            </button>
          </div>
        )}

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-800 bg-gray-950/40 flex justify-end items-center gap-3">
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="px-4 py-2 text-xs font-semibold bg-gray-800 hover:bg-gray-750 text-gray-300 border border-gray-700 rounded-xl transition disabled:opacity-50 cursor-pointer"
          >
            取消
          </button>

          <button
            onClick={handleConfirm}
            disabled={isProcessing}
            className="px-6 py-2 text-xs font-bold bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 text-white rounded-xl transition disabled:opacity-50 shadow-md shadow-purple-950/40 flex items-center gap-1.5 cursor-pointer"
          >
            {isProcessing ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>正在重新合成音频...</span>
              </>
            ) : (
              <>
                <Check size={14} />
                <span>确定更换</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
