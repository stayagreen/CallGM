import React, { useState, useRef, useEffect } from 'react';
import { Plus, Trash2, Upload, Settings, X, History, Image as ImageIcon, Download, ExternalLink, List as ListIcon, CheckCircle2, Clock, PlayCircle, Edit2, Camera, ChevronDown, ChevronUp, Film, Scissors, Mic, MicOff, Paintbrush } from 'lucide-react';
import ImageEditor from './ImageEditor';
import VideoEditor, { VideoTask } from './VideoEditor';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Login } from './components/Login';

// Shared type interfaces
interface Task {
  id: string;
  prompt: string;
  images: string[];
  count: number;
  download: boolean;
  downloadedFiles?: string[];
  executor?: 'js' | 'cdp';
  status?: 'pending' | 'running' | 'completed' | 'failed';
}

interface Job {
  id: string;
  timestamp: number;
  tasks: Task[];
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  statusMessage?: string;
}

interface Template {
  id: string;
  name: string;
  prompt: string;
}

interface HistoryItem {
  id: string;
  timestamp: number;
  tasks: Task[];
}

const JobItem = React.memo(({ 
  job, 
  isSelected, 
  isExpanded, 
  onToggleSelect, 
  onToggleExpand, 
  onViewImage, 
  onImportTask,
  galleryUpdateToken
}: { 
  job: Job, 
  isSelected: boolean, 
  isExpanded: boolean, 
  onToggleSelect: (id: string, checked: boolean) => void, 
  onToggleExpand: (id: string) => void, 
  onViewImage: (url: string) => void, 
  onImportTask: (task: Task) => void,
  galleryUpdateToken?: number
}) => {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start gap-4">
        <div className="pt-1">
          <input 
            type="checkbox" 
            checked={isSelected} 
            onChange={(e) => onToggleSelect(job.id, e.target.checked)} 
            className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer" 
          />
        </div>
        
        <div className="flex-grow">
          <div 
            className="cursor-pointer select-none"
            onClick={() => onToggleExpand(job.id)}
          >
            <div className="flex justify-between items-center mb-3">
              <div className="flex items-center gap-3">
                <span className="font-bold text-gray-900 text-lg">{new Date(job.timestamp).toLocaleString()}</span>
                <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold ${
                  job.status === 'completed' ? 'bg-green-100 text-green-700' : 
                  job.status === 'running' ? 'bg-blue-100 text-blue-700' : 
                  job.status === 'failed' ? 'bg-red-100 text-red-700' :
                  'bg-yellow-100 text-yellow-700'
                }`}>
                  {job.status === 'completed' && <CheckCircle2 size={14} />}
                  {job.status === 'running' && <PlayCircle size={14} className="animate-pulse" />}
                  {job.status === 'pending' && <Clock size={14} />}
                  {job.status === 'failed' && <X size={14} />}
                  {job.status === 'completed' ? '已完成' : job.status === 'running' ? '执行中' : job.status === 'failed' ? '执行失败' : '待执行'}
                </span>
              </div>
              <div className="text-sm text-gray-500 font-medium flex items-center gap-1">
                {isExpanded ? <><ChevronUp size={16}/> 收起详情</> : <><ChevronDown size={16}/> 查看详情</>}
              </div>
            </div>
            
            {job.status === 'running' && (
              <div className="w-full bg-gray-100 rounded-full h-3 mb-3 overflow-hidden border border-gray-200">
                <div className="bg-blue-500 h-full transition-all duration-500 relative" style={{ width: `${job.progress}%` }}>
                  <div className="absolute inset-0 bg-white/20 animate-[shimmer_1s_infinite] w-full"></div>
                </div>
              </div>
            )}
            
            <div className="text-sm text-gray-600 flex flex-wrap items-center gap-x-4 gap-y-1">
              <span>包含 {job.tasks.length} 个任务项</span>
              {job.status === 'running' && (
                <>
                  <span className="font-bold text-blue-600">总进度: {job.progress}%</span>
                  {job.statusMessage && (
                    <span className="text-blue-500 animate-pulse bg-blue-50 px-2 py-0.5 rounded border border-blue-100">
                      {job.statusMessage}
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
          
          {isExpanded && (
            <div className="mt-5 pt-5 border-t border-gray-100 space-y-4">
              {job.tasks.map((t: any, idx: number) => (
                <div key={idx} className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                  <div className="flex justify-between items-start mb-3">
                    <p className="text-sm font-bold text-gray-800 flex-grow">任务 {idx + 1}: <span className="font-normal text-gray-600">{t.prompt}</span></p>
                    <div className="flex gap-2">
                      <span className={`text-xs font-bold px-2 py-1 rounded ${
                        t.status === 'completed' ? 'bg-green-100 text-green-600' :
                        t.status === 'failed' ? 'bg-red-100 text-red-600' :
                        'bg-gray-200 text-gray-600'
                      }`}>
                        {t.status === 'completed' ? '已完成' : t.status === 'failed' ? '失败' : '未执行'}
                      </span>
                      <span className="text-xs font-medium text-gray-500 bg-gray-200 px-2 py-1 rounded">循环 {t.count} 次</span>
                    </div>
                  </div>
                  
                  {t.images && t.images.length > 0 && (
                    <div className="mb-4">
                      <p className="text-xs font-bold text-gray-500 mb-2 flex items-center gap-1"><ImageIcon size={14}/> 参考图片:</p>
                      <div className="flex gap-2 flex-wrap">
                        {t.images.map((img: string, i: number) => (
                          <img key={i} src={img.startsWith('/uploads/') ? img.replace('/uploads/', '/api/thumbnails/uploads/') : img} onClick={() => onViewImage(img)} className="w-16 h-16 object-cover rounded-lg border border-gray-300 shadow-sm cursor-pointer hover:opacity-80" loading="lazy" />
                        ))}
                      </div>
                    </div>
                  )}
                  
                  <button 
                    onClick={() => onImportTask(t)}
                    className="text-xs font-bold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition flex items-center gap-1"
                  >
                    <Plus size={14}/> 导入此任务
                  </button>
                  
                  {t.downloadedFiles && t.downloadedFiles.length > 0 && (
                    <div className="mt-4">
                      <p className="text-xs font-bold text-green-600 mb-2 flex items-center gap-1"><Download size={14}/> 生成的图片 ({t.downloadedFiles.length}):</p>
                      <div className="flex gap-2 flex-wrap">
                        {t.downloadedFiles.map((img: string, i: number) => (
                          <div key={i} onClick={() => onViewImage(`/downloads/${img}`)} className="block w-20 h-20 rounded-lg border border-gray-300 overflow-hidden hover:border-blue-500 transition-colors shadow-sm relative group cursor-pointer">
                            <img src={`/api/thumbnails/downloads/${img}?t=${galleryUpdateToken}`} className="w-full h-full object-cover" loading="lazy" />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

// Shared type interfaces
interface Task {
  id: string;
  prompt: string;
  images: string[];
  count: number;
  download: boolean;
  downloadedFiles?: string[];
  executor?: 'js' | 'cdp';
  status?: 'pending' | 'running' | 'completed' | 'failed';
}

interface Job {
  id: string;
  timestamp: number;
  tasks: Task[];
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  statusMessage?: string;
}

interface Template {
  id: string;
  name: string;
  prompt: string;
}

// ... rest of the code ...

export default function AppContent() {
  const { user, loading, logout } = useAuth();
  
  if (loading) return <div>加载中...</div>;
  if (!user) return <Login />;

  return (
    <>
      <div className="p-6 max-w-4xl mx-auto bg-gray-50 min-h-screen">
          <div className="flex justify-between items-center mb-4 bg-white p-4 rounded-xl shadow-sm border border-gray-200">
            <h1 className="text-xl font-bold">欢迎, {user.username} ({user.role})</h1>
            <button onClick={logout} className="bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600 transition">登出</button>
          </div>
          <MainApp />
      </div>
    </>
  );
}

// Rename original App to MainApp to keep existing functionality intact
function MainApp() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string>('');
  const [videoTasks, setVideoTasks] = useState<VideoTask[]>([]);
  const [activeVideoTaskId, setActiveVideoTaskId] = useState<string>('');
  const [showAddTaskMenu, setShowAddTaskMenu] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'tasks' | 'video_tasks' | 'records' | 'video_records' | 'gallery' | 'video_gallery'>('tasks');
  const [showNavDropdown, setShowNavDropdown] = useState<'tasks' | 'records' | 'gallery' | null>(null);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [systemConfig, setSystemConfig] = useState({ 
    systemDownloadsDir: '', 
    chromePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    userDataDir: 'C:\\ChromeDebug',
    pasteMin: 5, 
    pasteMax: 5, 
    clickMin: 8, 
    clickMax: 8, 
    downloadMin: 120, 
    downloadMax: 120, 
    taskMin: 5, 
    taskMax: 5,
    downloadCheckDelay: 1,
    downloadRetries: 3,
    videoConcurrency: 3,
    imageQuality: 'performance'
  });
  const [jobs, setJobs] = useState<Job[]>([]);
  const [videoJobs, setVideoJobs] = useState<Job[]>([]);
  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set());
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set());
  const [galleryImages, setGalleryImages] = useState<string[]>([]);
  const [videoGallery, setVideoGallery] = useState<string[]>([]);
  const [viewingImage, setViewingImage] = useState<string | null>(null);
  const [viewingVideo, setViewingVideo] = useState<string | null>(null);
  const [viewingVideoJobDetails, setViewingVideoJobDetails] = useState<Job | null>(null);
  const [processingGalleryImages, setProcessingGalleryImages] = useState<Set<string>>(new Set());
  const manualProcessingImages = useRef<Set<string>>(new Set());
  const [galleryUpdateToken, setGalleryUpdateToken] = useState<number>(Date.now());
  const [editingGalleryImage, setEditingGalleryImage] = useState<{ filename: string, url: string } | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    // Initialize SpeechRecognition if available
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true; // allow continuous dictation
      recognitionRef.current.interimResults = true; // show interim results
      // Setting language to zh-CN covers Mandarin, but modern recognition models often handle mixed EN/ZH well.
      recognitionRef.current.lang = 'zh-CN'; 
      
      recognitionRef.current.onresult = (event: any) => {
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          }
        }
        
        if (finalTranscript && activeTaskId) {
          setTasks(prev => prev.map(t => {
            if (t.id === activeTaskId) {
              return { ...t, prompt: t.prompt + (t.prompt && !t.prompt.endsWith(' ') ? ' ' : '') + finalTranscript };
            }
            return t;
          }));
        }
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error('Speech recognition error', event.error);
        if (event.error !== 'no-speech') {
          setIsRecording(false);
        }
      };
      recognitionRef.current.onend = () => {
        setIsRecording(false);
      };
    }
  }, [activeTaskId]);

  const startRecording = (e?: React.MouseEvent | React.TouchEvent) => {
    e?.preventDefault();
    if (isRecording) return;
    if (!recognitionRef.current) {
      alert('您的浏览器不支持语音输入 (请尝试使用 Chrome 浏览器)');
      return;
    }
    try {
      recognitionRef.current.start();
      setIsRecording(true);
    } catch (err) {
      console.error(err);
    }
  };

  const stopRecording = (e?: React.MouseEvent | React.TouchEvent) => {
    e?.preventDefault();
    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
    }
  };

  const handleOneClickWatermark = async (filename: string) => {
    if (window.confirm('确认要对该图片进行一键去水印吗？\n系统将尝试自动识别并移除右下角的星型水印。')) {
      // 记录处理中状态
      setProcessingGalleryImages(prev => new Set(prev).add(filename));
      
      try {
        const res = await fetch('/api/gallery/auto-watermark', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename, imageQuality: systemConfig.imageQuality })
        });
        
        const data = await res.json();
        if (data.status === 'ok') {
          // 成功处理，强制刷新缩略图
          setGalleryUpdateToken(Date.now());
        } else if (data.status === 'ignored') {
          alert('未检测到明显的水印特征，已跳过。');
        } else {
          alert('处理失败：' + (data.error || '未知错误'));
        }
      } catch (err) {
        console.error('One-click watermark failed:', err);
        alert('网络请求失败，请稍后再试。');
      } finally {
        // 移除处理中状态
        setProcessingGalleryImages(prev => {
          const next = new Set(prev);
          next.delete(filename);
          return next;
        });
      }
    }
  };
  const [showUploadMenu, setShowUploadMenu] = useState(false);
  const [showGalleryUploadMenu, setShowGalleryUploadMenu] = useState(false);
  const [showGalleryPicker, setShowGalleryPicker] = useState(false);
  const [selectedGalleryImages, setSelectedGalleryImages] = useState<Set<string>>(new Set());
  const [isMobile, setIsMobile] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [submittingJobs, setSubmittingJobs] = useState<Job[]>([]);
  const [submittingVideoJobs, setSubmittingVideoJobs] = useState<Job[]>([]);
  const [uploadingCount, setUploadingCount] = useState(0);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showUploadMenu && !(event.target as HTMLElement).closest('.upload-container')) {
        setShowUploadMenu(false);
      }
      if (showGalleryUploadMenu && !(event.target as HTMLElement).closest('.gallery-upload-container')) {
        setShowGalleryUploadMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showUploadMenu]);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent));
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    fetch('/api/config').then(res => res.json()).then(data => setSystemConfig(data));
    fetch('/api/templates').then(res => res.json()).then(data => setTemplates(data));
  }, []);

  const saveTemplates = async (newTemplates: Template[]) => {
    setTemplates(newTemplates);
    await fetch('/api/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newTemplates)
    });
  };

  const fetchJobs = async () => {
    try {
      const res = await fetch('/api/jobs');
      const data = await res.json();
      setJobs(data);
    } catch (error) {
      console.error('Failed to fetch jobs:', error);
    }
  };

  const fetchVideoJobs = async () => {
    try {
      const res = await fetch('/api/video/jobs');
      const data = await res.json();
      setVideoJobs(data);
    } catch (error) {
      console.error('Failed to fetch video jobs:', error);
    }
  };

  const fetchProcessingStatus = async () => {
    try {
      const res = await fetch('/api/processing-status');
      const backendProcessing = await res.json() as string[];
      
      setProcessingGalleryImages(prev => {
        // Merge manual edits (client-side) and auto-removal (server-side)
        const combined = new Set(backendProcessing);
        manualProcessingImages.current.forEach(img => combined.add(img));
        
        // If the set hasn't changed its size or content significantly, we can just return or construct new
        return combined;
      });
    } catch (error) {
      console.error('Failed to fetch processing status:', error);
    }
  };

  useEffect(() => {
    let interval: any;
    if (activeTab === 'records') {
      fetchJobs();
      const hasActiveJobs = jobs.some(j => j.status === 'pending' || j.status === 'running');
      interval = setInterval(fetchJobs, hasActiveJobs ? 2000 : 5000);
    } else if (activeTab === 'video_records') {
      fetchVideoJobs();
      const hasActiveJobs = videoJobs.some(j => j.status === 'pending' || j.status === 'running');
      interval = setInterval(fetchVideoJobs, hasActiveJobs ? 2000 : 5000);
    } else if (activeTab === 'gallery') {
      fetchGallery();
      fetchProcessingStatus();
      interval = setInterval(() => {
        fetchGallery();
        fetchProcessingStatus();
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [activeTab, jobs, videoJobs]);

  const fetchGallery = async () => {
    try {
      const res = await fetch('/api/images');
      const data = await res.json();
      setGalleryImages(data);
      setGalleryUpdateToken(Date.now());
    } catch (error) {
      console.error('Failed to fetch gallery:', error);
    }
  };

  const fetchVideoGallery = async () => {
    try {
      const res = await fetch('/api/videos');
      const data = await res.json();
      if (Array.isArray(data)) {
        setVideoGallery(data);
      } else {
        console.error('Video gallery data is not an array:', data);
        setVideoGallery([]);
      }
    } catch (error) {
      console.error('Failed to fetch video gallery:', error);
      setVideoGallery([]);
    }
  };

  useEffect(() => {
    if (activeTab === 'gallery' || activeTab === 'video_tasks') fetchGallery();
    if (activeTab === 'video_gallery') fetchVideoGallery();
  }, [activeTab]);

  const deleteSelectedJobs = async () => {
    if (selectedJobs.size === 0) return;
    if (!window.confirm(`确定要删除选中的 ${selectedJobs.size} 条记录吗？\n(生成的图片不会被删除)`)) return;
    
    try {
      await fetch('/api/jobs/delete', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filenames: Array.from(selectedJobs) })
      });
      setSelectedJobs(new Set());
      fetchJobs();
    } catch (error) {
      console.error('Failed to delete jobs:', error);
    }
  };

  const deleteGalleryImage = async (filename: string) => {
    if (!window.confirm('确定要删除这张图片吗？这将会从本地硬盘中彻底删除该文件。')) return;
    
    try {
      await fetch(`/api/images/${filename}`, { method: 'DELETE' });
      fetchGallery();
    } catch (error) {
      console.error('Failed to delete image:', error);
    }
  };

  const activeTask = tasks.find(t => t.id === activeTaskId) || tasks[0];

  const updateTask = (updates: Partial<Task>) => {
    if (!activeTaskId) return;
    setTasks(tasks.map(t => t.id === activeTaskId ? { ...t, ...updates } : t));
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    const promises = files.map(f => {
      return new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (ev) => resolve(ev.target?.result as string);
        reader.readAsDataURL(f);
      });
    });
    const base64Images = await Promise.all(promises);
    updateTask({ images: [...activeTask.images, ...base64Images].slice(0, 10) });
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const galleryFileInputRef = useRef<HTMLInputElement>(null);
  const galleryCameraInputRef = useRef<HTMLInputElement>(null);

  const addTask = () => {
    const newTask: Task = { id: Date.now().toString(), prompt: '', images: [], count: 1, download: true, executor: 'cdp' };
    setTasks([...tasks, newTask]);
    setActiveTaskId(newTask.id);
  };

  const removeTask = (e: React.MouseEvent, idToRemove: string) => {
    e.stopPropagation();
    const newTasks = tasks.filter(t => t.id !== idToRemove);
    setTasks(newTasks);
    if (activeTaskId === idToRemove) {
      setActiveTaskId(newTasks.length > 0 ? newTasks[0].id : '');
    }
  };

  const cameraInputRef = useRef<HTMLInputElement>(null);

  const handlePaste = async (e: React.ClipboardEvent<HTMLDivElement>) => {
    const items = e.clipboardData.items;
    const promises: Promise<string>[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          promises.push(new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = (ev) => resolve(ev.target?.result as string);
            reader.readAsDataURL(file);
          }));
        }
      }
    }
    if (promises.length > 0) {
      const base64Images = await Promise.all(promises);
      updateTask({ images: [...activeTask.images, ...base64Images].slice(0, 10) });
    }
  };

  const handlePasteFromMenu = async () => {
    setShowUploadMenu(false);
    alert('请直接在页面上按 Ctrl+V 进行粘贴');
  };

  const selectFromGallery = async () => {
    const filenames = Array.from(selectedGalleryImages);
    try {
      const response = await fetch('/api/images/copy-to-uploads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filenames })
      });
      const data = await response.json();
      if (data.success) {
        updateTask({ images: [...activeTask.images, ...data.urls].slice(0, 10) });
      }
    } catch (error) {
      console.error('Failed to copy gallery images to uploads:', error);
    }
    setShowGalleryPicker(false);
    setSelectedGalleryImages(new Set());
  };

  const handleGalleryImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (files.length === 0) return;
    
    setUploadingCount(prev => prev + files.length);
    setShowGalleryUploadMenu(false);

    const promises = files.map(f => {
      return new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (ev) => resolve(ev.target?.result as string);
        reader.readAsDataURL(f);
      });
    });
    const base64Images = await Promise.all(promises);
    
    try {
      await fetch('/api/images/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: base64Images })
      });
      fetchGallery();
    } catch (error) {
      console.error('Upload failed:', error);
      alert('图片上传失败，请检查网络');
    } finally {
      setUploadingCount(prev => Math.max(0, prev - files.length));
    }
  };

  const handleGalleryPaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    const promises: Promise<string>[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          promises.push(new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = (ev) => resolve(ev.target?.result as string);
            reader.readAsDataURL(file);
          }));
        }
      }
    }
    if (promises.length > 0) {
      setUploadingCount(prev => prev + promises.length);
      setShowGalleryUploadMenu(false);
      const base64Images = await Promise.all(promises);
      try {
        await fetch('/api/images/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ images: base64Images })
        });
        fetchGallery();
      } catch (error) {
        console.error('Paste upload failed:', error);
        alert('图片上传失败，请检查网络');
      } finally {
        setUploadingCount(prev => Math.max(0, prev - promises.length));
      }
    }
  };

  const handleExecute = async () => {
    const validTasks = tasks.filter(t => t.prompt.trim() !== '');
    if (validTasks.length === 0) {
      alert('没有有效的任务！');
      return;
    }
    
    // setIsExecuting(true); // 不再禁用按钮，允许连续提交
    
    // 创建一个乐观UI的任务记录
    const tempId = `submitting_${Date.now()}`;
    const optimisticJob: Job = {
      id: tempId,
      timestamp: Date.now(),
      tasks: [...validTasks],
      status: 'pending',
      progress: 0
    };

    // 立即更新UI，让用户感觉任务已经提交
    setSubmittingJobs(prev => [optimisticJob, ...prev]);
    setTasks([]);
    setActiveTaskId('');
    setActiveTab('records');

    try {
      const response = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasks: validTasks }),
      });

      if (response.ok) {
        // 提交成功后，触发一次刷新，并移除乐观UI记录
        await fetchJobs();
      } else {
        alert('任务提交失败，请检查网络');
      }
    } catch (error) {
      console.error('Execution failed:', error);
      alert('任务提交失败，请检查网络');
    } finally {
      // setIsExecuting(false);
      setSubmittingJobs(prev => prev.filter(j => j.id !== tempId));
    }
  };

  const saveConfig = async () => {
    setIsSavingConfig(true);
    try {
      // Clean up systemDownloadsDir to remove invisible characters (like LRM from Windows Explorer) and trim whitespace
      const cleanedConfig = {
        ...systemConfig,
        systemDownloadsDir: systemConfig.systemDownloadsDir ? systemConfig.systemDownloadsDir.replace(/[\u200B-\u200D\uFEFF\u200E\u200F]/g, '').trim() : '',
        chromePath: systemConfig.chromePath?.trim() || '',
        userDataDir: systemConfig.userDataDir?.trim() || ''
      };
      
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cleanedConfig)
      });
      setSystemConfig(cleanedConfig);
      
      // Artificial delay so the loading UI is actually visible to users indicating that work was done.
      await new Promise(resolve => setTimeout(resolve, 800));
      
      setShowConfigModal(false);
    } catch (e) {
      console.error(e);
      alert('保存失败，请检查网络');
    } finally {
      setIsSavingConfig(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto bg-gray-50 min-h-screen">
      <div className="flex justify-between items-end border-b border-gray-200 mb-6 relative">
        <div className="flex gap-6 w-full">
          {/* Tasks Dropdown */}
          <div className="relative">
            <button 
              onClick={() => setShowNavDropdown(showNavDropdown === 'tasks' ? null : 'tasks')} 
              className={`pb-3 font-medium transition-colors whitespace-nowrap flex items-center gap-1 ${['tasks', 'video_tasks'].includes(activeTab) ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-800'}`}
            >
              任务 <ChevronDown size={16}/>
            </button>
            {showNavDropdown === 'tasks' && (
              <div className="absolute top-full left-0 mt-1 w-32 bg-white border border-gray-100 shadow-lg rounded-xl overflow-hidden z-50">
                <button 
                  onClick={() => { setActiveTab('tasks'); setShowNavDropdown(null); }}
                  className={`w-full text-left px-4 py-2.5 text-sm hover:bg-blue-50 ${activeTab === 'tasks' ? 'text-blue-600 font-bold' : 'text-gray-700'}`}
                >
                  生图任务
                </button>
                <button 
                  onClick={() => { setActiveTab('video_tasks'); setShowNavDropdown(null); }}
                  className={`w-full text-left px-4 py-2.5 text-sm hover:bg-blue-50 ${activeTab === 'video_tasks' ? 'text-blue-600 font-bold' : 'text-gray-700'}`}
                >
                  视频任务
                </button>
              </div>
            )}
          </div>

          {/* Records Dropdown */}
          <div className="relative">
            <button 
              onClick={() => setShowNavDropdown(showNavDropdown === 'records' ? null : 'records')} 
              className={`pb-3 font-medium transition-colors whitespace-nowrap flex items-center gap-1 ${['records', 'video_records'].includes(activeTab) ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-800'}`}
            >
              任务记录 <ChevronDown size={16}/>
            </button>
            {showNavDropdown === 'records' && (
              <div className="absolute top-full left-0 mt-1 w-32 bg-white border border-gray-100 shadow-lg rounded-xl overflow-hidden z-50">
                <button 
                  onClick={() => { setActiveTab('records'); setShowNavDropdown(null); }}
                  className={`w-full text-left px-4 py-2.5 text-sm hover:bg-blue-50 ${activeTab === 'records' ? 'text-blue-600 font-bold' : 'text-gray-700'}`}
                >
                  生图记录
                </button>
                <button 
                  onClick={() => { setActiveTab('video_records'); setShowNavDropdown(null); }}
                  className={`w-full text-left px-4 py-2.5 text-sm hover:bg-blue-50 ${activeTab === 'video_records' ? 'text-blue-600 font-bold' : 'text-gray-700'}`}
                >
                  视频记录
                </button>
              </div>
            )}
          </div>

          {/* Gallery Dropdown */}
          <div className="relative">
            <button 
              onClick={() => setShowNavDropdown(showNavDropdown === 'gallery' ? null : 'gallery')} 
              className={`pb-3 font-medium transition-colors whitespace-nowrap flex items-center gap-1 ${['gallery', 'video_gallery'].includes(activeTab) ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-800'}`}
            >
              素材库 <ChevronDown size={16}/>
            </button>
            {showNavDropdown === 'gallery' && (
              <div className="absolute top-full left-0 mt-1 w-32 bg-white border border-gray-100 shadow-lg rounded-xl overflow-hidden z-50">
                <button 
                  onClick={() => { setActiveTab('gallery'); setShowNavDropdown(null); }}
                  className={`w-full text-left px-4 py-2.5 text-sm hover:bg-blue-50 ${activeTab === 'gallery' ? 'text-blue-600 font-bold' : 'text-gray-700'}`}
                >
                  本地图库
                </button>
                <button 
                  onClick={() => { setActiveTab('video_gallery'); setShowNavDropdown(null); }}
                  className={`w-full text-left px-4 py-2.5 text-sm hover:bg-blue-50 ${activeTab === 'video_gallery' ? 'text-blue-600 font-bold' : 'text-gray-700'}`}
                >
                  本地视频库
                </button>
              </div>
            )}
          </div>
        </div>
        <button 
          onClick={() => setShowConfigModal(true)} 
          className="mb-2 p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition flex items-center gap-2 flex-shrink-0" 
          title="系统设置"
        >
          <Settings size={18} />
          <span className="text-sm font-medium hidden sm:inline">系统设置</span>
        </button>
      </div>
      
      {activeTab === 'tasks' && (
        <>
          <div className="flex items-center gap-2 mb-6">
            <div className="flex gap-2 overflow-x-auto pb-2 flex-grow">
              {tasks.map((t, index) => (
                <div 
                  key={t.id} 
                  onClick={() => setActiveTaskId(t.id)}
                  className={`flex items-center gap-2 px-5 py-2 rounded-full font-medium transition cursor-pointer select-none flex-shrink-0 ${activeTaskId === t.id ? 'bg-blue-600 text-white shadow-md' : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-100'}`}
                >
                  <span>任务 {index + 1}</span>
                  <button 
                    onClick={(e) => removeTask(e, t.id)} 
                    className={`p-0.5 rounded-full transition ${activeTaskId === t.id ? 'hover:bg-blue-500 text-white' : 'hover:bg-gray-200 text-gray-500'}`}
                    title="关闭任务"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
            <div className="relative flex-shrink-0 mb-2">
              <button onClick={addTask} className="p-2 bg-blue-100 text-blue-600 rounded-full hover:bg-blue-200 transition shadow-sm" title="新建生图任务"><Plus /></button>
            </div>
          </div>

      {tasks.length === 0 ? (
        <div className="bg-white p-12 rounded-2xl shadow-sm border border-gray-100 text-center">
          <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <Plus className="text-blue-400 w-10 h-10" />
          </div>
          <h3 className="text-xl font-bold text-gray-800 mb-2">开始创建任务</h3>
          <p className="text-gray-500 mb-6">点击上方的加号按钮，选择任务类型开始创作</p>
          <button onClick={addTask} className="bg-blue-600 text-white px-8 py-3 rounded-xl font-bold hover:bg-blue-700 transition shadow-lg shadow-blue-200">创建第一个任务</button>
        </div>
      ) : (
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <div className="mb-6">
          <label className="block mb-2 font-semibold text-gray-700">提示词模板：</label>
          <div className="flex gap-2">
            <select className="flex-grow p-3 border border-gray-200 rounded-xl bg-gray-50" onChange={(e) => updateTask({ prompt: e.target.value })}>
              <option value="">-- 选择模板 --</option>
              {templates.map(t => <option key={t.id} value={t.prompt}>{t.name}</option>)}
            </select>
            <button onClick={() => setShowTemplateModal(true)} className="p-3 bg-gray-100 rounded-xl hover:bg-gray-200"><Settings size={20}/></button>
          </div>
        </div>

        <div className="relative mb-6">
          <textarea
            className="w-full p-4 pr-12 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
            placeholder="输入提示词..."
            rows={4}
            value={activeTask?.prompt || ''}
            onChange={(e) => updateTask({ prompt: e.target.value })}
          />
          <button 
            onMouseDown={startRecording}
            onMouseUp={stopRecording}
            onMouseLeave={stopRecording}
            onTouchStart={startRecording}
            onTouchEnd={stopRecording}
            onTouchCancel={stopRecording}
            onContextMenu={(e) => e.preventDefault()}
            className={`absolute right-3 bottom-3 p-2 rounded-full transition shadow-sm select-none touch-none ${isRecording ? 'bg-red-500 text-white animate-pulse scale-110' : 'bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-blue-500'}`}
            title="按压即说"
          >
            {isRecording ? <Mic /> : <MicOff />}
          </button>
        </div>

        <div className="mb-6">
          <input type="file" multiple onChange={handleImageUpload} className="hidden" ref={fileInputRef} accept="image/*" />
          <input type="file" capture="environment" accept="image/*" className="hidden" ref={cameraInputRef} onChange={handleImageUpload} />
          
          <div className="relative upload-container">
            <div 
              tabIndex={0}
              onPaste={handlePaste}
              onClick={() => setShowUploadMenu(!showUploadMenu)}
              className="cursor-pointer bg-gray-50 p-6 block rounded-2xl border-2 border-dashed border-gray-200 text-center hover:border-blue-300 focus:border-blue-500 focus:bg-blue-50 outline-none transition"
              title="点击选择上传方式"
            >
              <Upload className="mx-auto text-gray-400 mb-2" />
              <span className="text-gray-600 font-medium">点击此处选择上传图片 (最多 10 张)</span>
            </div>

            {showUploadMenu && (
              <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 w-56 bg-white rounded-xl shadow-2xl border border-gray-100 z-50 overflow-hidden py-1">
                {!isMobile ? (
                  <>
                    <button 
                      onClick={handlePasteFromMenu}
                      className="w-full text-left px-4 py-3 text-sm font-medium text-gray-700 hover:bg-blue-50 hover:text-blue-600 transition flex items-center gap-3"
                    >
                      <History size={18} className="text-gray-400" /> 粘贴图片 (Ctrl+V)
                    </button>
                    <button 
                      onClick={() => {
                        fileInputRef.current?.click();
                        setShowUploadMenu(false);
                      }}
                      className="w-full text-left px-4 py-3 text-sm font-medium text-gray-700 hover:bg-blue-50 hover:text-blue-600 transition flex items-center gap-3"
                    >
                      <Upload size={18} className="text-gray-400" /> 电脑上传 (可多选)
                    </button>
                  </>
                ) : (
                  <>
                    <button 
                      onClick={() => {
                        cameraInputRef.current?.click();
                        setShowUploadMenu(false);
                      }}
                      className="w-full text-left px-4 py-3 text-sm font-medium text-gray-700 hover:bg-blue-50 hover:text-blue-600 transition flex items-center gap-3"
                    >
                      <Camera size={18} className="text-gray-400" /> 拍照上传
                    </button>
                    <button 
                      onClick={() => {
                        fileInputRef.current?.click();
                        setShowUploadMenu(false);
                      }}
                      className="w-full text-left px-4 py-3 text-sm font-medium text-gray-700 hover:bg-blue-50 hover:text-blue-600 transition flex items-center gap-3"
                    >
                      <ImageIcon size={18} className="text-gray-400" /> 图册上传 (可多选)
                    </button>
                  </>
                )}
                <button 
                  onClick={() => {
                    fetchGallery();
                    setShowGalleryPicker(true);
                    setShowUploadMenu(false);
                  }}
                  className="w-full text-left px-4 py-3 text-sm font-medium text-gray-700 hover:bg-blue-50 hover:text-blue-600 transition border-t border-gray-50 flex items-center gap-3"
                >
                  <History size={18} className="text-gray-400" /> 本地图库上传 (可多选)
                </button>
              </div>
            )}
          </div>
          <div className="flex gap-3 mt-4 flex-wrap">
            {activeTask?.images.map((img, i) => (
              <div key={i} className="relative group">
                <img src={img} className="h-20 w-20 object-cover rounded-lg border border-gray-200" />
                <button 
                  onClick={() => updateTask({ images: activeTask.images.filter((_, index) => index !== i) })}
                  className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 transition shadow-sm z-10"
                  title="删除图片"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-6 mb-6 text-gray-700 items-center flex-wrap">
          <label className="flex items-center gap-2">模式: 
            <select 
              value={activeTask?.executor || 'cdp'} 
              onChange={(e) => updateTask({ executor: e.target.value as 'js' | 'cdp' })}
              className="border border-gray-200 p-2 rounded-lg bg-gray-50 font-bold text-blue-600"
            >
              <option value="cdp">CDP (推荐)</option>
              <option value="js">JS (旧版)</option>
            </select>
          </label>
          <label className="flex items-center gap-2">执行次数: <input type="number" value={activeTask?.count || 1} onChange={(e) => updateTask({ count: parseInt(e.target.value) })} className="w-20 border border-gray-200 p-2 rounded-lg" /></label>
        </div>

        <button 
          onClick={handleExecute} 
          disabled={isExecuting}
          className={`w-full bg-blue-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-blue-700 transition shadow-lg shadow-blue-200 ${isExecuting ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {isExecuting ? '正在提交任务...' : '执行所有任务'}
        </button>
      </div>
      )}
      </>
      )}

      {activeTab === 'video_tasks' && (
        <>
          <div className="flex items-center gap-2 mb-6">
            <div className="flex gap-2 overflow-x-auto pb-2 flex-grow">
              {videoTasks.map((t, index) => (
                <div 
                  key={t.id} 
                  onClick={() => setActiveVideoTaskId(t.id)}
                  className={`flex items-center gap-2 px-5 py-2 rounded-full font-medium transition cursor-pointer select-none flex-shrink-0 ${activeVideoTaskId === t.id ? 'bg-blue-600 text-white shadow-md' : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-100'}`}
                >
                  <span>视频任务 {index + 1}</span>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      const newTasks = videoTasks.filter(task => task.id !== t.id);
                      setVideoTasks(newTasks);
                      if (activeVideoTaskId === t.id) {
                        setActiveVideoTaskId(newTasks.length > 0 ? newTasks[0].id : '');
                      }
                    }} 
                    className={`p-0.5 rounded-full transition ${activeVideoTaskId === t.id ? 'hover:bg-blue-500 text-white' : 'hover:bg-gray-200 text-gray-500'}`}
                    title="关闭任务"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
            <button 
              onClick={() => {
                const newTask: VideoTask = {
                  id: Date.now().toString(),
                  storyboards: [],
                  introAnimation: 'none',
                  outroAnimation: 'none',
                  bgm: ''
                };
                setVideoTasks([...videoTasks, newTask]);
                setActiveVideoTaskId(newTask.id);
              }}
              className="p-2 bg-blue-100 text-blue-600 rounded-full hover:bg-blue-200 transition shadow-sm flex-shrink-0"
              title="新建视频任务"
            >
              <Plus size={24}/>
            </button>
          </div>

          {videoTasks.length === 0 ? (
            <div className="text-center py-20 bg-white rounded-2xl border-2 border-dashed border-gray-200">
              <Film className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <h3 className="text-xl font-bold text-gray-700 mb-2">暂无视频任务</h3>
              <p className="text-gray-500 mb-6">点击上方按钮创建一个新的视频生成任务</p>
              <button 
                onClick={() => {
                  const newTask: VideoTask = {
                    id: Date.now().toString(),
                    storyboards: [],
                    introAnimation: 'none',
                    outroAnimation: 'none',
                    bgm: ''
                  };
                  setVideoTasks([newTask]);
                  setActiveVideoTaskId(newTask.id);
                }}
                className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-blue-700 transition shadow-md hover:shadow-lg"
              >
                <Plus size={20}/> 创建第一个视频任务
              </button>
            </div>
          ) : (
            <>
              {videoTasks.map(t => (
                <div key={t.id} className={activeVideoTaskId === t.id ? 'block' : 'hidden'}>
                  <VideoEditor 
                    task={t}
                    onChange={(updatedTask) => {
                      setVideoTasks(prev => prev.map(pt => pt.id === updatedTask.id ? updatedTask : pt));
                    }}
                    galleryImages={galleryImages}
                    galleryUpdateToken={galleryUpdateToken}
                  />
                </div>
              ))}
              
              <div className="mt-6 flex justify-end">
                <button 
                  onClick={async () => {
                    const validTasks = videoTasks.filter(t => t.storyboards.length > 0);
                    if (validTasks.length === 0) {
                      alert('没有可提交的有效视频任务（需至少包含一个分镜）');
                      return;
                    }
                    
                    // Optimistic UI: Immediately clear tasks and switch tab
                    const currentTasks = [...validTasks];
                    const tempJobs = currentTasks.map(task => ({
                      id: task.id,
                      timestamp: Date.now(),
                      status: 'pending' as const,
                      progress: 0,
                      data: task
                    }));
                    
                    setSubmittingVideoJobs(prev => [...tempJobs, ...prev]);
                    setVideoTasks([]);
                    setActiveVideoTaskId('');
                    setActiveTab('video_records');

                    // Process submissions in background with immediate job list update
                    Promise.all(currentTasks.map(async (task) => {
                      try {
                        const res = await fetch('/api/video/execute', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(task)
                        });
                        const data = await res.json();
                        return { taskId: task.id, success: true };
                      } catch (e) {
                        console.error('Submission failed', e);
                        return { taskId: task.id, success: false };
                      }
                    })).then(async () => {
                      // Refresh job list immediately after all requests sent
                      const res = await fetch('/api/video/jobs');
                      const data = await res.json();
                      setVideoJobs(data);
                      setSubmittingVideoJobs([]); // Clear all optimistic jobs
                    });
                  }}
                  disabled={!videoTasks.some(t => t.storyboards.length > 0)}
                  className="flex items-center gap-2 bg-blue-600 text-white px-8 py-3.5 rounded-xl font-bold hover:bg-blue-700 transition shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed text-lg"
                >
                  <PlayCircle size={24}/> 提交所有视频任务 ({videoTasks.filter(t => t.storyboards.length > 0).length})
                </button>
              </div>
            </>
          )}
        </>
      )}

      {activeTab === 'records' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-gray-800">执行进度与记录</h2>
            <div className="flex gap-2">
              <button 
                onClick={() => {
                  if (selectedJobs.size === jobs.length && jobs.length > 0) setSelectedJobs(new Set());
                  else setSelectedJobs(new Set(jobs.map(j => j.id)));
                }} 
                className="px-4 py-2 text-sm font-medium bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition shadow-sm"
              >
                {selectedJobs.size === jobs.length && jobs.length > 0 ? '取消全选' : '全选'}
              </button>
              <button 
                onClick={deleteSelectedJobs} 
                disabled={selectedJobs.size === 0} 
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-red-50 text-red-600 border border-red-100 rounded-lg hover:bg-red-100 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              >
                <Trash2 size={16} />
                批量删除 ({selectedJobs.size})
              </button>
            </div>
          </div>
          
          {jobs.length === 0 && submittingJobs.length === 0 ? (
            <div className="text-center py-12 text-gray-500 bg-white rounded-2xl border border-gray-200 border-dashed">
              <ListIcon className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>暂无任务记录</p>
            </div>
          ) : (
            <>
              {submittingJobs.map(job => (
                <div key={job.id} className="bg-white border border-blue-200 rounded-2xl p-5 shadow-sm opacity-70 animate-pulse">
                  <div className="flex items-start gap-4">
                    <div className="pt-1">
                      <div className="w-5 h-5 rounded border-gray-200 bg-gray-100" />
                    </div>
                    <div className="flex-grow">
                      <div className="flex justify-between items-start mb-4">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-bold text-gray-800">正在提交新任务...</span>
                            <span className="px-2 py-0.5 rounded text-xs font-bold bg-blue-100 text-blue-600 flex items-center gap-1">
                              <Clock size={12} className="animate-spin" /> 等待中
                            </span>
                          </div>
                          <p className="text-xs text-gray-400">{new Date(job.timestamp).toLocaleString()}</p>
                        </div>
                      </div>
                      <div className="space-y-2">
                        {job.tasks.map((t, idx) => (
                          <div key={idx} className="text-sm text-gray-500 bg-gray-50 p-2 rounded">
                            任务 {idx + 1}: {t.prompt}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              {jobs.map(job => (
                <JobItem 
                  key={job.id}
                  job={job}
                  isSelected={selectedJobs.has(job.id)}
                  isExpanded={expandedJobs.has(job.id)}
                  onToggleSelect={(id, checked) => {
                    const newSet = new Set(selectedJobs);
                    if (checked) newSet.add(id);
                    else newSet.delete(id);
                    setSelectedJobs(newSet);
                  }}
                  onToggleExpand={(id) => {
                    const newSet = new Set(expandedJobs);
                    if (newSet.has(id)) newSet.delete(id);
                    else newSet.add(id);
                    setExpandedJobs(newSet);
                  }}
                  onViewImage={setViewingImage}
                  onImportTask={(t) => {
                    const newTask = { id: Date.now().toString(), prompt: t.prompt, images: t.images || [], count: 1, download: true };
                    setTasks([...tasks, newTask]);
                    setActiveTaskId(newTask.id);
                    setActiveTab('tasks');
                  }}
                  galleryUpdateToken={galleryUpdateToken}
                />
              ))}
            </>
          )}
        </div>
      )}

      {activeTab === 'gallery' && (
        <div className="space-y-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-gray-800">本地图库</h2>
            <div className="flex gap-2">
              <div className="relative gallery-upload-container">
                <input type="file" multiple onChange={handleGalleryImageUpload} className="hidden" ref={galleryFileInputRef} accept="image/*" />
                <input type="file" capture="environment" accept="image/*" className="hidden" ref={galleryCameraInputRef} onChange={handleGalleryImageUpload} />
                
                <button 
                  onClick={() => setShowGalleryUploadMenu(!showGalleryUploadMenu)}
                  className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition shadow-sm flex items-center gap-2"
                >
                  <Upload size={16} /> 上传图片
                </button>

                {showGalleryUploadMenu && (
                  <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-xl shadow-2xl border border-gray-100 z-50 overflow-hidden py-1">
                    {!isMobile ? (
                      <>
                        <div className="px-4 py-2 text-xs font-bold text-gray-400 uppercase tracking-wider bg-gray-50 border-b border-gray-100 mb-1">电脑端选项</div>
                        <button 
                          onClick={() => {
                            alert('请在图库页面直接按 Ctrl+V 进行粘贴');
                            setShowGalleryUploadMenu(false);
                          }}
                          className="w-full text-left px-4 py-3 text-sm font-medium text-gray-700 hover:bg-blue-50 hover:text-blue-600 transition flex items-center gap-3"
                        >
                          <History size={18} className="text-gray-400" /> 粘贴图片 (Ctrl+V)
                        </button>
                        <button 
                          onClick={() => {
                            galleryFileInputRef.current?.click();
                            setShowGalleryUploadMenu(false);
                          }}
                          className="w-full text-left px-4 py-3 text-sm font-medium text-gray-700 hover:bg-blue-50 hover:text-blue-600 transition flex items-center gap-3"
                        >
                          <Upload size={18} className="text-gray-400" /> 电脑上传 (可多选)
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="px-4 py-2 text-xs font-bold text-gray-400 uppercase tracking-wider bg-gray-50 border-b border-gray-100 mb-1">手机端选项</div>
                        <button 
                          onClick={() => {
                            galleryCameraInputRef.current?.click();
                            setShowGalleryUploadMenu(false);
                          }}
                          className="w-full text-left px-4 py-3 text-sm font-medium text-gray-700 hover:bg-blue-50 hover:text-blue-600 transition flex items-center gap-3"
                        >
                          <Camera size={18} className="text-gray-400" /> 拍照上传
                        </button>
                        <button 
                          onClick={() => {
                            galleryFileInputRef.current?.click();
                            setShowGalleryUploadMenu(false);
                          }}
                          className="w-full text-left px-4 py-3 text-sm font-medium text-gray-700 hover:bg-blue-50 hover:text-blue-600 transition flex items-center gap-3"
                        >
                          <ImageIcon size={18} className="text-gray-400" /> 图册上传 (可多选)
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
              <button onClick={fetchGallery} className="px-4 py-2 text-sm font-medium bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition shadow-sm">刷新图库</button>
            </div>
          </div>
          
          <div 
            onPaste={handleGalleryPaste}
            tabIndex={0}
            className="outline-none"
          >
            {galleryImages.length === 0 && uploadingCount === 0 ? (
            <div className="text-center py-16 text-gray-500 bg-white rounded-2xl border border-gray-200 border-dashed">
              <ImageIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <p className="text-lg font-medium text-gray-600">暂无下载的图片</p>
              <p className="text-sm mt-2">执行带有开启下载选项的任务后，图片会显示在这里</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {Array.from({ length: uploadingCount }).map((_, i) => (
                <div key={`uploading-${i}`} className="group relative bg-white p-2 rounded-xl border border-blue-200 shadow-sm animate-pulse">
                  <div className="block aspect-[9/16] overflow-hidden rounded-lg bg-gray-50 flex items-center justify-center">
                    <div className="flex flex-col items-center gap-2">
                      <Clock className="w-8 h-8 text-blue-400 animate-spin" />
                      <span className="text-[10px] text-blue-500 font-bold">正在上传...</span>
                    </div>
                  </div>
                  <div className="mt-3 h-4 bg-gray-100 rounded w-2/3 mx-auto"></div>
                </div>
              ))}
              {galleryImages.map(img => (
                <div key={img} className="group relative bg-white p-2 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-all">
                  <div onClick={() => !processingGalleryImages.has(img) && setViewingImage(`/downloads/${img}?t=${galleryUpdateToken}`)} className="block aspect-[9/16] overflow-hidden rounded-lg bg-gray-100 relative cursor-pointer">
                    <img src={`/api/thumbnails/downloads/${img}?t=${galleryUpdateToken}`} alt={img} className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300" loading="lazy" />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                      <ImageIcon className="w-8 h-8 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-md" />
                    </div>
                    {processingGalleryImages.has(img) && (
                      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center p-2 z-10">
                        <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mb-2"></div>
                        <span className="text-[10px] text-white font-bold">正在去水印...</span>
                      </div>
                    )}
                  </div>
                  <div className="mt-3 flex items-center justify-between px-1">
                    <span className="text-xs text-gray-500 truncate pr-2 font-medium" title={img}>{img}</span>
                    <div className="flex gap-1">
                      <button
                        onClick={() => !processingGalleryImages.has(img) && setEditingGalleryImage({ filename: img, url: `/downloads/${img}?t=${galleryUpdateToken}` })}
                        disabled={processingGalleryImages.has(img)}
                        className={`p-1.5 rounded-md transition-colors ${processingGalleryImages.has(img) ? 'text-gray-300' : 'text-purple-500 hover:bg-purple-50'}`}
                        title="智能填充 (手动去水印)"
                      >
                        <Paintbrush className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => !processingGalleryImages.has(img) && handleOneClickWatermark(img)}
                        disabled={processingGalleryImages.has(img)}
                        className={`p-1.5 rounded-md transition-colors ${processingGalleryImages.has(img) ? 'text-gray-300' : 'text-blue-500 hover:bg-blue-50'}`}
                        title="一键去水印"
                      >
                        <Scissors className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => !processingGalleryImages.has(img) && deleteGalleryImage(img)}
                        disabled={processingGalleryImages.has(img)}
                        className={`p-1.5 rounded-md transition-colors ${processingGalleryImages.has(img) ? 'text-gray-300' : 'text-red-500 hover:bg-red-50'}`}
                        title="彻底删除源文件"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          </div>
        </div>
      )}

      {activeTab === 'video_records' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2"><Film className="text-blue-600"/> 视频渲染记录</h2>
            <div className="flex gap-3">
              <button onClick={fetchVideoJobs} className="px-4 py-2 text-sm font-medium bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition shadow-sm">刷新记录</button>
            </div>
          </div>
          
          {videoJobs.length === 0 && submittingVideoJobs.length === 0 ? (
            <div className="text-center py-16 text-gray-500 bg-white rounded-2xl border border-gray-200 border-dashed">
              <History className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <p className="text-lg font-medium text-gray-600">暂无视频渲染记录</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {submittingVideoJobs.map(job => (
                <div key={job.id} className="bg-white border border-blue-200 rounded-2xl p-5 shadow-sm opacity-70 animate-pulse">
                  <div className="flex justify-between items-center mb-3">
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-gray-900 text-lg">{new Date(job.timestamp).toLocaleString()}</span>
                      <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold bg-blue-100 text-blue-700">
                        <Clock size={14} /> 提交中...
                      </span>
                    </div>
                  </div>
                  <div className="text-sm text-gray-600">
                    正在同步到服务器...
                  </div>
                </div>
              ))}
              {videoJobs.map(job => (
                <div key={job.id} className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
                  <div className="flex justify-between items-center mb-3">
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-gray-900 text-lg">{new Date(job.timestamp).toLocaleString()}</span>
                      <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold ${
                        job.status === 'completed' ? 'bg-green-100 text-green-700' : 
                        job.status === 'running' ? 'bg-blue-100 text-blue-700' : 
                        job.status === 'error' ? 'bg-red-100 text-red-700' :
                        'bg-yellow-100 text-yellow-700'
                      }`}>
                        {job.status === 'completed' && <CheckCircle2 size={14} />}
                        {job.status === 'running' && <PlayCircle size={14} className="animate-pulse" />}
                        {job.status === 'pending' && <Clock size={14} />}
                        {job.status === 'error' && <X size={14} />}
                        {job.status === 'completed' ? '已完成' : job.status === 'running' ? '渲染中' : job.status === 'error' ? '失败' : '待执行'}
                      </span>
                    </div>
                    <button 
                      onClick={async () => {
                        if (confirm('确定要删除这条视频渲染记录吗？')) {
                          try {
                            const res = await fetch(`/api/video/jobs/${job.id}`, { method: 'DELETE' });
                            if (res.ok) fetchVideoJobs();
                          } catch (e) {
                            console.error('Failed to delete video job', e);
                          }
                        }
                      }}
                      className="p-1.5 text-gray-400 hover:text-red-600 transition-colors"
                      title="删除记录"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                  
                  {job.status === 'running' && (
                    <div className="w-full bg-gray-100 rounded-full h-3 mb-3 overflow-hidden border border-gray-200">
                      <div className="bg-blue-500 h-full transition-all duration-500 relative" style={{ width: `${job.progress}%` }}>
                        <div className="absolute inset-0 bg-white/20 animate-[shimmer_1s_infinite] w-full"></div>
                      </div>
                    </div>
                  )}

                  {job.status === 'error' && (
                    <div className="text-red-500 text-sm mb-3 bg-red-50 p-3 rounded-lg">
                      视频渲染失败
                    </div>
                  )}
                  
                  <div className="flex justify-between items-center">
                    <div className="text-sm text-gray-600">
                      包含 {job.data.storyboards?.length || 0} 个分镜
                    </div>
                    <button 
                      onClick={() => setViewingVideoJobDetails(job)}
                      className="text-sm text-blue-600 font-medium hover:underline"
                    >
                      查看详情
                    </button>
                  </div>

                  {job.status === 'completed' && job.data.outputVideo && (
                    <div className="mt-4 flex gap-3">
                      <button 
                        onClick={() => setViewingVideo(`/downloads/videos/${job.data.outputVideo}`)}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 rounded-lg font-medium hover:bg-blue-100 transition"
                      >
                        <PlayCircle size={16}/> 预览视频
                      </button>
                      <a 
                        href={`/downloads/videos/${job.data.outputVideo}`} 
                        download
                        className="flex items-center gap-2 px-4 py-2 bg-gray-50 text-gray-700 rounded-lg font-medium hover:bg-gray-100 transition border border-gray-200"
                      >
                        <Download size={16}/> 下载视频
                      </a>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'video_gallery' && (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2"><Film className="text-blue-600"/> 本地视频库</h2>
            <div className="flex gap-2">
              <button onClick={fetchVideoGallery} className="px-4 py-2 text-sm font-medium bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition shadow-sm">刷新视频库</button>
            </div>
          </div>
          
          {videoGallery.length === 0 ? (
            <div className="text-center py-16 text-gray-500 bg-white rounded-2xl border border-gray-200 border-dashed">
              <Film className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <p className="text-lg font-medium text-gray-600">暂无视频</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {videoGallery.map(vid => (
                <div key={vid} className="group relative bg-white p-2 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-all">
                  <div onClick={() => setViewingVideo(`/downloads/videos/${vid}`)} className="block aspect-[9/16] overflow-hidden rounded-lg bg-gray-100 relative cursor-pointer">
                    <img src={`/api/thumbnails/videos/${vid.replace(/\.[^/.]+$/, ".jpg")}`} alt={vid} className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                    <div className="absolute inset-0 bg-black/20 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                      <PlayCircle className="w-12 h-12 text-white opacity-80 group-hover:opacity-100 transition-opacity drop-shadow-md" />
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between px-1">
                    <span className="text-xs text-gray-500 truncate pr-2 font-medium" title={vid}>{vid}</span>
                    <button
                      onClick={async () => {
                        if (!window.confirm('确定要删除这个视频吗？')) return;
                        await fetch(`/api/videos/${vid}`, { method: 'DELETE' });
                        fetchVideoGallery();
                      }}
                      className="p-1.5 text-red-500 hover:bg-red-50 rounded-md transition-colors"
                      title="彻底删除源文件"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {editingGalleryImage && (
        <div className="fixed inset-0 bg-black z-50 flex flex-col">
          <ImageEditor
            image={editingGalleryImage.url}
            onSave={async (newImage) => {
              // Convert base64 to File or just send to a new endpoint to overwrite
              try {
                setProcessingGalleryImages(prev => new Set(prev).add(editingGalleryImage.filename));
                setEditingGalleryImage(null);
                
                const response = await fetch('/api/gallery/save-manual-edit', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    filename: editingGalleryImage.filename,
                    base64: newImage
                  })
                });
                
                if (response.ok) {
                  setGalleryUpdateToken(Date.now());
                } else {
                  alert('保存图片失败');
                }
              } catch (e) {
                console.error(e);
                alert('网络请求失败');
              } finally {
                setProcessingGalleryImages(prev => {
                  const next = new Set(prev);
                  next.delete(editingGalleryImage.filename);
                  return next;
                });
              }
            }}
            onCancel={() => setEditingGalleryImage(null)}
          />
        </div>
      )}

      {showTemplateModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md">
            <h2 className="text-2xl font-bold mb-6">模板管理</h2>
            {templates.map(t => (
              <div key={t.id} className="flex flex-col mb-3 p-3 bg-gray-50 rounded-lg">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-medium">{t.name}</span>
                  <div className="flex gap-2">
                    <button onClick={() => {
                      (document.getElementById('new-t-name') as HTMLInputElement).value = t.name;
                      (document.getElementById('new-t-prompt') as HTMLTextAreaElement).value = t.prompt;
                      saveTemplates(templates.filter(x => x.id !== t.id));
                    }} className="text-blue-500 hover:bg-blue-50 p-1 rounded"><Edit2 size={18}/></button>
                    <button onClick={() => saveTemplates(templates.filter(x => x.id !== t.id))} className="text-red-500 hover:bg-red-50 p-1 rounded"><Trash2 size={18}/></button>
                  </div>
                </div>
                <p className="text-sm text-gray-600 truncate">{t.prompt}</p>
              </div>
            ))}
            <input className="w-full p-3 border border-gray-200 rounded-xl mb-3" placeholder="模板名称" id="new-t-name" />
            <textarea className="w-full p-3 border border-gray-200 rounded-xl mb-4" placeholder="提示词内容" id="new-t-prompt" />
            <button 
              onClick={() => {
                const name = (document.getElementById('new-t-name') as HTMLInputElement).value;
                const prompt = (document.getElementById('new-t-prompt') as HTMLTextAreaElement).value;
                if (name && prompt) {
                  saveTemplates([...templates, { id: Date.now().toString(), name, prompt }]);
                  (document.getElementById('new-t-name') as HTMLInputElement).value = '';
                  (document.getElementById('new-t-prompt') as HTMLTextAreaElement).value = '';
                }
              }}
              className="bg-blue-600 text-white px-6 py-3 rounded-xl w-full font-bold hover:bg-blue-700"
            >保存模板</button>
            <button onClick={() => setShowTemplateModal(false)} className="mt-3 w-full text-gray-500 hover:text-gray-700">关闭</button>
          </div>
        </div>
      )}
      {showConfigModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-[999]">
          <div className="relative bg-white p-8 rounded-2xl shadow-xl w-full max-w-lg">
            {isSavingConfig && (
              <div className="absolute inset-0 bg-white/80 backdrop-blur-[2px] flex flex-col items-center justify-center z-50 rounded-2xl">
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent mb-4"></div>
                <p className="text-blue-600 font-medium text-lg shadow-sm">正在保存设置...</p>
              </div>
            )}
            
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-800">系统设置</h2>
              <button disabled={isSavingConfig} onClick={() => setShowConfigModal(false)} className="text-gray-400 hover:text-gray-600 disabled:opacity-50"><X size={24}/></button>
            </div>
            <div className="mb-6 space-y-4 max-h-[60vh] overflow-y-auto pr-2">
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label className="block mb-1 font-semibold text-gray-700">Chrome 程序路径 (.exe)：</label>
                  <input
                    type="text"
                    className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                    value={systemConfig.chromePath}
                    onChange={(e) => setSystemConfig({...systemConfig, chromePath: e.target.value})}
                    placeholder="例如: C:\Program Files\Google\Chrome\Application\chrome.exe"
                  />
                </div>
                <div>
                  <label className="block mb-1 font-semibold text-gray-700">浏览器用户数据目录 (UserData)：</label>
                  <input
                    type="text"
                    className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                    value={systemConfig.userDataDir}
                    onChange={(e) => setSystemConfig({...systemConfig, userDataDir: e.target.value})}
                    placeholder="例如: C:\ChromeDebug"
                  />
                  <p className="text-xs text-gray-400 mt-1">※ 重要：请确保此目录未被其它浏览器窗口占用。若出现崩溃，请尝试更换此路径。</p>
                </div>
              </div>
              <div>
                <label className="block mb-1 font-semibold text-gray-700">浏览器默认下载目录 (绝对路径)：</label>
                <input
                  type="text"
                  className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                  value={systemConfig.systemDownloadsDir}
                  onChange={(e) => setSystemConfig({...systemConfig, systemDownloadsDir: e.target.value})}
                  placeholder="例如: C:\Users\YourName\Downloads"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1 font-semibold text-gray-700">粘贴图后等待(秒):</label>
                  <div className="flex gap-1">
                    <input type="number" className="w-full p-2 border border-gray-200 rounded-lg" value={systemConfig.pasteMin || 5} onChange={(e) => setSystemConfig({...systemConfig, pasteMin: parseInt(e.target.value)})} />
                    <input type="number" className="w-full p-2 border border-gray-200 rounded-lg" value={systemConfig.pasteMax || 5} onChange={(e) => setSystemConfig({...systemConfig, pasteMax: parseInt(e.target.value)})} />
                  </div>
                </div>
                <div>
                  <label className="block mb-1 font-semibold text-gray-700">图片出现后等待(秒):</label>
                  <div className="flex gap-1">
                    <input type="number" className="w-full p-2 border border-gray-200 rounded-lg" value={systemConfig.clickMin || 8} onChange={(e) => setSystemConfig({...systemConfig, clickMin: parseInt(e.target.value)})} />
                    <input type="number" className="w-full p-2 border border-gray-200 rounded-lg" value={systemConfig.clickMax || 8} onChange={(e) => setSystemConfig({...systemConfig, clickMax: parseInt(e.target.value)})} />
                  </div>
                </div>
                <div>
                  <label className="block mb-1 font-semibold text-gray-700">下载超时等待(秒):</label>
                  <div className="flex gap-1">
                    <input type="number" className="w-full p-2 border border-gray-200 rounded-lg" value={systemConfig.downloadMin || 120} onChange={(e) => setSystemConfig({...systemConfig, downloadMin: parseInt(e.target.value)})} />
                    <input type="number" className="w-full p-2 border border-gray-200 rounded-lg" value={systemConfig.downloadMax || 120} onChange={(e) => setSystemConfig({...systemConfig, downloadMax: parseInt(e.target.value)})} />
                  </div>
                </div>
                <div>
                  <label className="block mb-1 font-semibold text-gray-700">任务间隔等待(秒):</label>
                  <div className="flex gap-1">
                    <input type="number" className="w-full p-2 border border-gray-200 rounded-lg" value={systemConfig.taskMin || 5} onChange={(e) => setSystemConfig({...systemConfig, taskMin: parseInt(e.target.value)})} />
                    <input type="number" className="w-full p-2 border border-gray-200 rounded-lg" value={systemConfig.taskMax || 5} onChange={(e) => setSystemConfig({...systemConfig, taskMax: parseInt(e.target.value)})} />
                  </div>
                </div>
                <div>
                  <label className="block mb-1 font-semibold text-gray-700">点击下载后等待(秒):</label>
                  <input type="number" className="w-full p-2 border border-gray-200 rounded-lg" value={systemConfig.downloadCheckDelay || 1} onChange={(e) => setSystemConfig({...systemConfig, downloadCheckDelay: parseInt(e.target.value)})} />
                </div>
                <div>
                  <label className="block mb-1 font-semibold text-gray-700">图片下载重试次数:</label>
                  <input type="number" className="w-full p-2 border border-gray-200 rounded-lg" value={systemConfig.downloadRetries || 3} onChange={(e) => setSystemConfig({...systemConfig, downloadRetries: parseInt(e.target.value)})} />
                </div>
                <div>
                  <label className="block mb-1 font-semibold text-gray-700">视频渲染并发数:</label>
                  <input type="number" className="w-full p-2 border border-gray-200 rounded-lg" value={systemConfig.videoConcurrency || 3} onChange={(e) => setSystemConfig({...systemConfig, videoConcurrency: parseInt(e.target.value)})} />
                </div>
                <div>
                  <label className="block mb-1 font-semibold text-gray-700">图片质量模式:</label>
                  <select 
                    className="w-full p-2 border border-gray-200 rounded-lg bg-white" 
                    value={systemConfig.imageQuality || 'performance'} 
                    onChange={(e) => setSystemConfig({...systemConfig, imageQuality: e.target.value as any})}
                  >
                    <option value="fastSpeed">极速</option>
                    <option value="performance">平衡</option>
                    <option value="highQuality">保真</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="flex gap-3">
              <button disabled={isSavingConfig} onClick={() => setShowConfigModal(false)} className="flex-1 py-3 rounded-xl font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition disabled:opacity-50">取消</button>
              <button disabled={isSavingConfig} onClick={saveConfig} className="flex-1 py-3 rounded-xl font-medium text-white bg-blue-600 hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed">
                {isSavingConfig ? '保存中...' : '保存设置'}
              </button>
            </div>
          </div>
        </div>
      )}
      {showGalleryPicker && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white p-6 rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">从本地图库选择</h2>
              <button onClick={() => setShowGalleryPicker(false)} className="text-gray-400 hover:text-gray-600"><X size={24}/></button>
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
                        const newSet = new Set(selectedGalleryImages);
                        if (newSet.has(img)) newSet.delete(img);
                        else newSet.add(img);
                        setSelectedGalleryImages(newSet);
                      }}
                      className={`relative aspect-[9/16] rounded-lg overflow-hidden border-2 cursor-pointer transition-all ${selectedGalleryImages.has(img) ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200 hover:border-blue-300'}`}
                    >
                      <img src={`/api/thumbnails/downloads/${img}?t=${galleryUpdateToken}`} className="w-full h-full object-contain" loading="lazy" />
                      {selectedGalleryImages.has(img) && (
                        <div className="absolute inset-0 bg-blue-500/20 flex items-center justify-center">
                          <CheckCircle2 className="text-white drop-shadow-md" size={32} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            <div className="flex gap-3">
              <button onClick={() => setShowGalleryPicker(false)} className="flex-1 py-3 rounded-xl font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition">取消</button>
              <button 
                onClick={selectFromGallery} 
                disabled={selectedGalleryImages.size === 0}
                className="flex-1 py-3 rounded-xl font-medium text-white bg-blue-600 hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                确认选择 ({selectedGalleryImages.size})
              </button>
            </div>
          </div>
        </div>
      )}
      {viewingVideoJobDetails && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[999]" onClick={() => setViewingVideoJobDetails(null)}>
          <div className="bg-white p-6 rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">视频任务详情</h2>
              <button onClick={() => setViewingVideoJobDetails(null)} className="text-gray-400 hover:text-gray-600"><X size={24}/></button>
            </div>
            <div className="flex-grow overflow-y-auto mb-6 pr-2 text-sm text-gray-700 space-y-2">
              <p><strong>渲染时间:</strong> {new Date(viewingVideoJobDetails.timestamp).toLocaleString()}</p>
              <p><strong>分镜数量:</strong> {viewingVideoJobDetails.data.storyboards?.length || 0}</p>
              <div className="mt-4">
                <strong>分镜详情:</strong>
                {viewingVideoJobDetails.data.storyboards?.map((sb: any, i: number) => (
                  <div key={i} className="mt-2 p-3 bg-gray-50 rounded-lg border border-gray-100">
                    <p>分镜 {i + 1}: {sb.text || '无文字'}</p>
                    <p className="text-xs text-gray-500">动画: {sb.animation}, 转场: {sb.transition}, 时长: {sb.duration}s</p>
                  </div>
                ))}
              </div>
            </div>
            <button 
              onClick={() => {
                const newTask: VideoTask = {
                  id: Date.now().toString(),
                  storyboards: viewingVideoJobDetails.data.storyboards || [],
                  bgm: viewingVideoJobDetails.data.bgm || '',
                  introAnimation: viewingVideoJobDetails.data.introAnimation || 'none',
                  outroAnimation: viewingVideoJobDetails.data.outroAnimation || 'none'
                };
                setVideoTasks([...videoTasks, newTask]);
                setActiveVideoTaskId(newTask.id);
                setActiveTab('video_tasks');
                setViewingVideoJobDetails(null);
              }}
              className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition"
            >
              导入任务
            </button>
          </div>
        </div>
      )}
      
      {viewingImage && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 z-[999]" onClick={() => setViewingImage(null)}>
          <div className="relative max-w-4xl w-full max-h-[90vh] flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
            <div className="relative w-full flex justify-center">
              <img src={viewingImage} className="max-w-full max-h-[75vh] object-contain rounded-lg shadow-2xl" />
              <button 
                onClick={() => setViewingImage(null)}
                className="absolute -top-4 -right-4 w-10 h-10 bg-white text-gray-900 rounded-full flex items-center justify-center shadow-xl hover:bg-gray-100 transition-colors z-[1001]"
              >
                <X size={24} />
              </button>
            </div>
            
            <div className="mt-6 flex flex-col items-center gap-4 w-full">
              <div className="flex justify-center gap-4 w-full">
                <a href={viewingImage} download className="flex-1 max-w-[160px] bg-white text-gray-900 px-6 py-3 rounded-full font-bold hover:bg-gray-100 transition shadow-lg text-center">下载图片</a>
                <button onClick={() => setViewingImage(null)} className="flex-1 max-w-[160px] bg-gray-800 text-white px-6 py-3 rounded-full font-bold hover:bg-gray-700 transition shadow-lg">关闭预览</button>
              </div>
              
              {isMobile && (
                <p className="text-white/60 text-xs bg-white/10 px-4 py-2 rounded-full backdrop-blur-sm">
                  提示：iOS 用户请长按图片选择「保存到相册」
                </p>
              )}
            </div>
          </div>
        </div>
      )}
      
      {viewingVideo && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 z-[999]" onClick={() => setViewingVideo(null)}>
          <div className="relative max-w-4xl w-full max-h-[90vh] flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
            <div className="relative w-full flex justify-center">
              <video src={viewingVideo} controls autoPlay className="max-w-full max-h-[75vh] object-contain rounded-lg shadow-2xl" />
              <button 
                onClick={() => setViewingVideo(null)}
                className="absolute -top-4 -right-4 w-10 h-10 bg-white text-gray-900 rounded-full flex items-center justify-center shadow-xl hover:bg-gray-100 transition-colors z-[1001]"
              >
                <X size={24} />
              </button>
            </div>
            
            <div className="mt-6 flex flex-col items-center gap-4 w-full">
              <div className="flex justify-center gap-4 w-full">
                <a href={viewingVideo} download className="flex-1 max-w-[160px] bg-white text-gray-900 px-6 py-3 rounded-full font-bold hover:bg-gray-100 transition shadow-lg text-center">下载视频</a>
                <button onClick={() => setViewingVideo(null)} className="flex-1 max-w-[160px] bg-gray-800 text-white px-6 py-3 rounded-full font-bold hover:bg-gray-700 transition shadow-lg">关闭预览</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
