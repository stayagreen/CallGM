/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { Plus, Trash2, Upload, Settings, X, History, Image as ImageIcon, Download, ExternalLink, List as ListIcon, CheckCircle2, Clock, PlayCircle } from 'lucide-react';

interface Task {
  id: string;
  prompt: string;
  images: string[];
  count: number;
  download: boolean;
  downloadedFiles?: string[];
}

interface Job {
  id: string;
  timestamp: number;
  tasks: Task[];
  status: 'pending' | 'running' | 'completed';
  progress: number;
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
  const [activeTab, setActiveTab] = useState<'tasks' | 'records' | 'gallery'>('tasks');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set());
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set());
  const [galleryImages, setGalleryImages] = useState<string[]>([]);

  const fetchJobs = async () => {
    try {
      const res = await fetch('/api/jobs');
      const data = await res.json();
      setJobs(data);
    } catch (error) {
      console.error('Failed to fetch jobs:', error);
    }
  };

  useEffect(() => {
    let interval: any;
    if (activeTab === 'records') {
      fetchJobs();
      interval = setInterval(fetchJobs, 2000);
    }
    return () => clearInterval(interval);
  }, [activeTab]);

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
    if (activeTab === 'gallery') fetchGallery();
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
    setTasks(tasks.map(t => t.id === activeTaskId ? { ...t, ...updates } : t));
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
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
      setTasks([{ id: '1', prompt: '', images: [], count: 1, download: false }]);
      setActiveTaskId('1');
      setActiveTab('records');
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto bg-gray-50 min-h-screen">
      <div className="flex gap-4 border-b border-gray-200 mb-6">
        <button 
          onClick={() => setActiveTab('tasks')} 
          className={`pb-3 px-2 font-medium transition-colors ${activeTab === 'tasks' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-800'}`}
        >
          创建任务
        </button>
        <button 
          onClick={() => setActiveTab('records')} 
          className={`pb-3 px-2 font-medium transition-colors ${activeTab === 'records' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-800'}`}
        >
          任务记录
        </button>
        <button 
          onClick={() => setActiveTab('gallery')} 
          className={`pb-3 px-2 font-medium transition-colors ${activeTab === 'gallery' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-800'}`}
        >
          本地图库
        </button>
      </div>
      
      {activeTab === 'tasks' && (
        <>
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
          
          {jobs.length === 0 ? (
            <div className="text-center py-12 text-gray-500 bg-white rounded-2xl border border-gray-200 border-dashed">
              <ListIcon className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>暂无任务记录</p>
            </div>
          ) : (
            jobs.map(job => (
              <div key={job.id} className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-start gap-4">
                  <div className="pt-1">
                    <input 
                      type="checkbox" 
                      checked={selectedJobs.has(job.id)} 
                      onChange={(e) => {
                        const newSet = new Set(selectedJobs);
                        if (e.target.checked) newSet.add(job.id);
                        else newSet.delete(job.id);
                        setSelectedJobs(newSet);
                      }} 
                      className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer" 
                    />
                  </div>
                  
                  <div className="flex-grow">
                    <div 
                      className="cursor-pointer select-none"
                      onClick={() => {
                        const newSet = new Set(expandedJobs);
                        if (newSet.has(job.id)) newSet.delete(job.id);
                        else newSet.add(job.id);
                        setExpandedJobs(newSet);
                      }}
                    >
                      <div className="flex justify-between items-center mb-3">
                        <div className="flex items-center gap-3">
                          <span className="font-bold text-gray-900 text-lg">{new Date(job.timestamp).toLocaleString()}</span>
                          <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold ${
                            job.status === 'completed' ? 'bg-green-100 text-green-700' : 
                            job.status === 'running' ? 'bg-blue-100 text-blue-700' : 
                            'bg-yellow-100 text-yellow-700'
                          }`}>
                            {job.status === 'completed' && <CheckCircle2 size={14} />}
                            {job.status === 'running' && <PlayCircle size={14} className="animate-pulse" />}
                            {job.status === 'pending' && <Clock size={14} />}
                            {job.status === 'completed' ? '已完成' : job.status === 'running' ? '执行中' : '排队中'}
                          </span>
                        </div>
                        <div className="text-sm text-gray-500 font-medium">
                          {expandedJobs.has(job.id) ? '收起详情' : '查看详情'}
                        </div>
                      </div>
                      
                      {job.status === 'running' && (
                        <div className="w-full bg-gray-100 rounded-full h-3 mb-3 overflow-hidden border border-gray-200">
                          <div className="bg-blue-500 h-full transition-all duration-500 relative" style={{ width: `${job.progress}%` }}>
                            <div className="absolute inset-0 bg-white/20 animate-[shimmer_1s_infinite] w-full"></div>
                          </div>
                        </div>
                      )}
                      
                      <div className="text-sm text-gray-600 flex items-center gap-4">
                        <span>包含 {job.tasks.length} 个任务项</span>
                        {job.status === 'running' && <span className="font-bold text-blue-600">总进度: {job.progress}%</span>}
                      </div>
                    </div>
                    
                    {expandedJobs.has(job.id) && (
                      <div className="mt-5 pt-5 border-t border-gray-100 space-y-4">
                        {job.tasks.map((t: any, idx: number) => (
                          <div key={idx} className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                            <div className="flex justify-between items-start mb-3">
                              <p className="text-sm font-bold text-gray-800 flex-grow">任务 {idx + 1}: <span className="font-normal text-gray-600">{t.prompt}</span></p>
                              <span className="text-xs font-medium text-gray-500 bg-gray-200 px-2 py-1 rounded">循环 {t.count} 次</span>
                            </div>
                            
                            {t.images && t.images.length > 0 && (
                              <div className="mb-4">
                                <p className="text-xs font-bold text-gray-500 mb-2 flex items-center gap-1"><ImageIcon size={14}/> 参考图片:</p>
                                <div className="flex gap-2 flex-wrap">
                                  {t.images.map((img: string, i: number) => (
                                    <img key={i} src={img} className="w-16 h-16 object-cover rounded-lg border border-gray-300 shadow-sm" />
                                  ))}
                                </div>
                              </div>
                            )}
                            
                            {t.downloadedFiles && t.downloadedFiles.length > 0 && (
                              <div>
                                <p className="text-xs font-bold text-green-600 mb-2 flex items-center gap-1"><Download size={14}/> 生成的图片 ({t.downloadedFiles.length}):</p>
                                <div className="flex gap-2 flex-wrap">
                                  {t.downloadedFiles.map((img: string, i: number) => (
                                    <a key={i} href={`/downloads/${img}`} target="_blank" rel="noreferrer" className="block w-20 h-20 rounded-lg border border-gray-300 overflow-hidden hover:border-blue-500 transition-colors shadow-sm relative group">
                                      <img src={`/downloads/${img}`} className="w-full h-full object-cover" />
                                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                                        <ExternalLink className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-md" />
                                      </div>
                                    </a>
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
            ))
          )}
        </div>
      )}

      {activeTab === 'gallery' && (
        <div className="space-y-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-gray-800">本地图库</h2>
            <button onClick={fetchGallery} className="px-4 py-2 text-sm font-medium bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition shadow-sm">刷新图库</button>
          </div>
          
          {galleryImages.length === 0 ? (
            <div className="text-center py-16 text-gray-500 bg-white rounded-2xl border border-gray-200 border-dashed">
              <ImageIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <p className="text-lg font-medium text-gray-600">暂无下载的图片</p>
              <p className="text-sm mt-2">执行带有开启下载选项的任务后，图片会显示在这里</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {galleryImages.map(img => (
                <div key={img} className="group relative bg-white p-2 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-all">
                  <a href={`/downloads/${img}`} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden rounded-lg bg-gray-100 relative">
                    <img src={`/downloads/${img}`} alt={img} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                      <ExternalLink className="w-8 h-8 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-md" />
                    </div>
                  </a>
                  <div className="mt-3 flex items-center justify-between px-1">
                    <span className="text-xs text-gray-500 truncate pr-2 font-medium" title={img}>{img}</span>
                    <button
                      onClick={() => deleteGalleryImage(img)}
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
