/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect } from 'react';
import { Plus, Trash2, Upload, Settings, X, History, Image as ImageIcon, Download, ExternalLink } from 'lucide-react';

interface Task {
  id: string;
  prompt: string;
  images: string[];
  count: number;
  download: boolean;
  downloadedFiles?: string[];
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

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([{ id: '1', prompt: '', images: [], count: 1, download: false }]);
  const [activeTaskId, setActiveTaskId] = useState<string>('1');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showGalleryModal, setShowGalleryModal] = useState(false);
  const [galleryImages, setGalleryImages] = useState<string[]>([]);
  
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    const saved = localStorage.getItem('task_history');
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    localStorage.setItem('task_history', JSON.stringify(history));
  }, [history]);

  const fetchHistory = async () => {
    try {
      const res = await fetch('/api/history');
      const data = await res.json();
      // Update local history with backend data (which includes downloadedFiles)
      const formattedHistory = data.map((item: any) => ({
        id: item.filename,
        timestamp: item.timestamp,
        tasks: item.tasks
      }));
      setHistory(formattedHistory);
    } catch (error) {
      console.error('Failed to fetch history:', error);
    }
  };

  const fetchGallery = async () => {
    try {
      const res = await fetch('/api/images');
      const data = await res.json();
      setGalleryImages(data);
    } catch (error) {
      console.error('Failed to fetch gallery:', error);
    }
  };

  useEffect(() => {
    if (showHistoryModal) fetchHistory();
  }, [showHistoryModal]);

  useEffect(() => {
    if (showGalleryModal) fetchGallery();
  }, [showGalleryModal]);

  const deleteHistory = async (filename: string) => {
    if (!window.confirm('确定要删除这条历史记录吗？')) return;
    
    const deleteFiles = window.confirm('是否同时删除相关的本地图片源文件？\n\n点击"确定"删除源文件，点击"取消"仅删除历史记录。');
    
    try {
      await fetch(`/api/history/${filename}?deleteFiles=${deleteFiles}`, { method: 'DELETE' });
      fetchHistory();
    } catch (error) {
      console.error('Failed to delete history:', error);
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
    setTasks(tasks.map(t => t.id === activeTaskId ? { ...t, ...updates } : t));
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const newImages = files.map(f => URL.createObjectURL(f));
    updateTask({ images: [...activeTask.images, ...newImages].slice(0, 10) });
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  const addTask = () => {
    const newTask = { id: Date.now().toString(), prompt: '', images: [], count: 1, download: false };
    setTasks([...tasks, newTask]);
    setActiveTaskId(newTask.id);
  };

  const removeTask = (e: React.MouseEvent, idToRemove: string) => {
    e.stopPropagation();
    if (tasks.length === 1) {
      alert('至少保留一个任务！');
      return;
    }
    const newTasks = tasks.filter(t => t.id !== idToRemove);
    setTasks(newTasks);
    if (activeTaskId === idToRemove) {
      setActiveTaskId(newTasks[0].id);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const items = e.clipboardData.items;
    const newImages: string[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const blob = items[i].getAsFile();
        if (blob) {
          newImages.push(URL.createObjectURL(blob));
        }
      }
    }
    if (newImages.length > 0) {
      updateTask({ images: [...activeTask.images, ...newImages].slice(0, 10) });
    }
  };

  const handleExecute = async () => {
    const response = await fetch('/api/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tasks }),
    });

    if (response.ok) {
      const newHistoryItem = { id: Date.now().toString(), timestamp: Date.now(), tasks: JSON.parse(JSON.stringify(tasks)) };
      setHistory([newHistoryItem, ...history]);
      alert('任务已保存到 task 目录，自动化脚本将自动执行！');
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto bg-gray-50 min-h-screen">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-extrabold text-gray-900">CallGM 任务管理器</h1>
        <div className="flex gap-2">
          <button 
            onClick={() => setShowGalleryModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl text-gray-700 hover:bg-gray-50 shadow-sm transition font-medium"
          >
            <ImageIcon size={18} />
            图库
          </button>
          <button 
            onClick={() => setShowHistoryModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl text-gray-700 hover:bg-gray-50 shadow-sm transition font-medium"
          >
            <History size={18} />
            历史记录
          </button>
        </div>
      </div>
      
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
        {tasks.map((t, index) => (
          <div 
            key={t.id} 
            onClick={() => setActiveTaskId(t.id)}
            className={`flex items-center gap-2 px-5 py-2 rounded-full font-medium transition cursor-pointer select-none ${activeTaskId === t.id ? 'bg-blue-600 text-white shadow-md' : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-100'}`}
          >
            <span>任务 {index + 1}</span>
            {tasks.length > 1 && (
              <button 
                onClick={(e) => removeTask(e, t.id)} 
                className={`p-0.5 rounded-full transition ${activeTaskId === t.id ? 'hover:bg-blue-500 text-white' : 'hover:bg-gray-200 text-gray-500'}`}
                title="关闭任务"
              >
                <X size={14} />
              </button>
            )}
          </div>
        ))}
        <button onClick={addTask} className="p-2 bg-blue-100 text-blue-600 rounded-full hover:bg-blue-200"><Plus /></button>
      </div>

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

        <textarea
          className="w-full p-4 border border-gray-200 rounded-xl mb-6 focus:ring-2 focus:ring-blue-500 outline-none"
          placeholder="输入提示词..."
          rows={4}
          value={activeTask.prompt}
          onChange={(e) => updateTask({ prompt: e.target.value })}
        />

        <div className="mb-6">
          <input type="file" multiple onChange={handleImageUpload} className="hidden" ref={fileInputRef} accept="image/*" />
          <div 
            tabIndex={0}
            onPaste={handlePaste}
            onDoubleClick={() => fileInputRef.current?.click()}
            className="cursor-pointer bg-gray-50 p-6 block rounded-2xl border-2 border-dashed border-gray-200 text-center hover:border-blue-300 focus:border-blue-500 focus:bg-blue-50 outline-none transition"
            title="单击选中后按 Ctrl+V 粘贴，双击选择文件"
          >
            <Upload className="mx-auto text-gray-400 mb-2" />
            <span className="text-gray-600 font-medium">单击此处后按 Ctrl+V 粘贴，或双击上传图片 (最多 10 张)</span>
          </div>
          <div className="flex gap-3 mt-4 flex-wrap">
            {activeTask.images.map((img, i) => (
              <div key={i} className="relative group">
                <img src={img} className="h-20 w-20 object-cover rounded-lg border border-gray-200" />
                <button 
                  onClick={() => updateTask({ images: activeTask.images.filter((_, index) => index !== i) })}
                  className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition shadow-sm"
                  title="删除图片"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-6 mb-6 text-gray-700">
          <label className="flex items-center gap-2">执行次数: <input type="number" value={activeTask.count} onChange={(e) => updateTask({ count: parseInt(e.target.value) })} className="w-20 border border-gray-200 p-2 rounded-lg" /></label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={activeTask.download} onChange={(e) => updateTask({ download: e.target.checked })} className="w-5 h-5" /> 自动下载</label>
        </div>

        <button onClick={handleExecute} className="w-full bg-blue-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-blue-700 transition shadow-lg shadow-blue-200">执行所有任务</button>
      </div>

      {showHistoryModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] overflow-y-auto">
            <h2 className="text-2xl font-bold mb-6">执行历史记录</h2>
            {history.length === 0 ? (
              <p className="text-gray-500 text-center py-4">暂无历史记录</p>
            ) : (
              history.map(h => (
                <div key={h.id} className="flex justify-between items-center mb-3 p-4 bg-gray-50 rounded-xl border border-gray-100">
                  <div>
                    <div className="font-bold text-gray-800">{new Date(h.timestamp).toLocaleString()}</div>
                    <div className="text-sm text-gray-500">包含 {h.tasks.length} 个任务</div>
                    
                    {/* Display downloaded files for this history record */}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {h.tasks.map(t => t.downloadedFiles?.map(img => (
                        <a key={img} href={`/downloads/${img}`} target="_blank" rel="noreferrer" className="block w-12 h-12 rounded border border-gray-200 overflow-hidden hover:border-blue-500 transition-colors shadow-sm">
                          <img src={`/downloads/${img}`} alt="downloaded" className="w-full h-full object-cover" />
                        </a>
                      )))}
                    </div>
                  </div>
                  <div className="flex gap-2 items-start">
                    <button 
                      onClick={() => {
                        setTasks(h.tasks);
                        setActiveTaskId(h.tasks[0].id);
                        setShowHistoryModal(false);
                      }} 
                      className="px-4 py-2 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 font-medium transition"
                    >
                      重载此任务
                    </button>
                    <button 
                      onClick={() => deleteHistory(h.id)} 
                      className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition"
                      title="删除记录"
                    >
                      <Trash2 size={18}/>
                    </button>
                  </div>
                </div>
              ))
            )}
            <button onClick={() => setShowHistoryModal(false)} className="mt-4 w-full text-gray-500 hover:text-gray-700 py-2 font-medium">关闭</button>
          </div>
        </div>
      )}

      {showGalleryModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-4xl max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold">本地图库</h2>
              <button onClick={fetchGallery} className="text-sm text-blue-600 hover:text-blue-700 font-medium">刷新图库</button>
            </div>
            
            {galleryImages.length === 0 ? (
              <div className="text-center py-12 text-gray-500 bg-gray-50 rounded-lg border border-gray-200 border-dashed">
                <ImageIcon className="w-12 h-12 mx-auto mb-3 text-gray-400" />
                <p>暂无下载的图片</p>
                <p className="text-sm mt-1">执行带有开启下载选项的任务后，图片会显示在这里</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {galleryImages.map(img => (
                  <div key={img} className="group relative bg-white p-2 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-all">
                    <a href={`/downloads/${img}`} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden rounded bg-gray-100 relative">
                      <img src={`/downloads/${img}`} alt={img} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                        <ExternalLink className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-md" />
                      </div>
                    </a>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-xs text-gray-500 truncate pr-2 font-medium" title={img}>{img}</span>
                      <button
                        onClick={() => deleteGalleryImage(img)}
                        className="p-1.5 text-red-500 hover:bg-red-50 rounded transition-colors"
                        title="彻底删除源文件"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button onClick={() => setShowGalleryModal(false)} className="mt-6 w-full text-gray-500 hover:text-gray-700 py-2 font-medium">关闭</button>
          </div>
        </div>
      )}

      {showTemplateModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md">
            <h2 className="text-2xl font-bold mb-6">模板管理</h2>
            {templates.map(t => (
              <div key={t.id} className="flex justify-between items-center mb-3 p-3 bg-gray-50 rounded-lg">
                <span className="font-medium">{t.name}</span>
                <button onClick={() => setTemplates(templates.filter(x => x.id !== t.id))} className="text-red-500 hover:bg-red-50 p-1 rounded"><Trash2 size={18}/></button>
              </div>
            ))}
            <input className="w-full p-3 border border-gray-200 rounded-xl mb-3" placeholder="模板名称" id="new-t-name" />
            <textarea className="w-full p-3 border border-gray-200 rounded-xl mb-4" placeholder="提示词内容" id="new-t-prompt" />
            <button 
              onClick={() => {
                const name = (document.getElementById('new-t-name') as HTMLInputElement).value;
                const prompt = (document.getElementById('new-t-prompt') as HTMLTextAreaElement).value;
                if (name && prompt) {
                  setTemplates([...templates, { id: Date.now().toString(), name, prompt }]);
                  (document.getElementById('new-t-name') as HTMLInputElement).value = '';
                  (document.getElementById('new-t-prompt') as HTMLTextAreaElement).value = '';
                }
              }}
              className="bg-blue-600 text-white px-6 py-3 rounded-xl w-full font-bold hover:bg-blue-700"
            >添加模板</button>
            <button onClick={() => setShowTemplateModal(false)} className="mt-3 w-full text-gray-500 hover:text-gray-700">关闭</button>
          </div>
        </div>
      )}
    </div>
  );
}
