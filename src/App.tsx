import React, { useState, useRef, useEffect } from 'react';
import { Plus, Minus, Trash2, Upload, Settings, X, History, Image as ImageIcon, Download, ExternalLink, List as ListIcon, CheckCircle2, Clock, PlayCircle, Edit2, Camera, ChevronDown, ChevronUp, Film, Scissors, Mic, MicOff, Paintbrush, Target, Sparkles, Crop, Share2, Calendar, Link, Eye, User, Chrome, FolderPlus, Folder, Search, Music, Cpu, CheckSquare, Square } from 'lucide-react';
import ImageEditor from './ImageEditor';
import VideoEditor, { VideoTask } from './VideoEditor';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Login } from './components/Login';
import { ImageCropper } from './components/ImageCropper';
import { VideoCropper } from './components/VideoCropper';
import { VideoBgmChanger } from './components/VideoBgmChanger';
import { XhsPhonePreview } from './components/XhsPhonePreview';

// Shared type interfaces
interface Task {
  id: string;
  prompt: string;
  images: string[];
  count: number;
  download: boolean;
  downloadedFiles?: string[];
  executor?: 'js' | 'cdp';
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'error' | 'paused';
}

interface Job {
  id: string;
  timestamp: number;
  tasks: Task[];
  status: 'pending' | 'running' | 'completed' | 'failed' | 'error' | 'paused';
  progress: number;
  statusMessage?: string;
  resultFiles?: string[];
  data?: any;
  userId?: number;
  username?: string;
}

interface GalleryAsset {
  id: number;
  path: string;
  userId: number;
  username: string;
  groupId: number | null;
  createdAt?: string;
  jobId?: string;
  taskData?: VideoTask;
  resolutionTag?: string;
  isPublished?: number;
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
                  job.status === 'paused' ? 'bg-orange-100 text-orange-700 border border-orange-200' :
                  job.status === 'failed' ? 'bg-red-100 text-red-700' :
                  'bg-yellow-100 text-yellow-700'
                }`}>
                  {job.status === 'completed' && <CheckCircle2 size={14} />}
                  {job.status === 'running' && <PlayCircle size={14} className="animate-pulse" />}
                  {job.status === 'paused' && <Clock size={14} />}
                  {job.status === 'pending' && <Clock size={14} />}
                  {job.status === 'failed' && <X size={14} />}
                  {job.status === 'completed' ? '已完成' : job.status === 'running' ? '执行中' : job.status === 'paused' ? '已暂停' : job.status === 'failed' ? '执行失败' : '待执行'}
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
                  
                  {(t.downloadedFiles || (job.status === 'completed' && idx === 0 ? job.resultFiles : [])) && (t.downloadedFiles?.length || (job.status === 'completed' && idx === 0 ? job.resultFiles?.length : 0)) > 0 && (
                    <div className="mt-4">
                      <p className="text-xs font-bold text-green-600 mb-2 flex items-center gap-1"><Download size={14}/> 生成的图片 ({(t.downloadedFiles || (idx === 0 ? job.resultFiles : [])).length}):</p>
                      <div className="flex gap-2 flex-wrap">
                        {(t.downloadedFiles || (idx === 0 ? job.resultFiles : [])).map((img: string, i: number) => (
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

function UserManagement() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [formData, setFormData] = useState({ username: '', password: '', role: 'user' });

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/users');
      const data = await res.json();
      setUsers(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = editingUser ? `/api/admin/users/${editingUser.id}` : '/api/admin/users';
    const method = editingUser ? 'PUT' : 'POST';
    
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      if (res.ok) {
        setShowModal(false);
        fetchUsers();
      } else {
        const data = await res.json();
        alert(data.error || '操作失败');
      }
    } catch (e) {
      alert('发生错误');
    }
  };

  const deleteUser = async (id: number) => {
    if (!confirm('确定要删除该用户吗？')) return;
    try {
      const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' });
      if (res.ok) fetchUsers();
      else {
        const data = await res.json();
        alert(data.error || '删除失败');
      }
    } catch (e) {
      alert('发生错误');
    }
  };

  return (
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">用户管理</h2>
        <button 
          onClick={() => {
            setEditingUser(null);
            setFormData({ username: '', password: '', role: 'user' });
            setShowModal(true);
          }}
          className="bg-blue-600 text-white px-4 py-2 rounded-xl font-bold hover:bg-blue-700 transition"
        >
          新增用户
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">加载中...</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="py-3 px-4 text-xs font-bold text-gray-400 uppercase tracking-wider">用户名</th>
                <th className="py-3 px-4 text-xs font-bold text-gray-400 uppercase tracking-wider">权限</th>
                <th className="py-3 px-4 text-xs font-bold text-gray-400 uppercase tracking-wider text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className="border-b border-gray-50 hover:bg-gray-50 transition">
                  <td className="py-4 px-4 font-medium text-gray-800">{u.username}</td>
                  <td className="py-4 px-4 text-sm">
                    <span className={`px-2 py-1 rounded text-xs font-bold ${u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                      {u.role === 'admin' ? '管理员' : '普通用户'}
                    </span>
                  </td>
                  <td className="py-4 px-4 text-right space-x-2">
                    <button 
                      onClick={() => {
                        setEditingUser(u);
                        setFormData({ username: u.username, password: '', role: u.role });
                        setShowModal(true);
                      }}
                      className="text-blue-600 hover:text-blue-800 text-sm font-bold"
                    >编辑</button>
                    <button 
                      onClick={() => deleteUser(u.id)}
                      className="text-red-600 hover:text-red-800 text-sm font-bold"
                    >删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-[999]">
          <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-sm">
            <h3 className="text-xl font-bold mb-6">{editingUser ? '编辑用户' : '新增用户'}</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">用户名</label>
                <input 
                  type="text" 
                  value={formData.username}
                  onChange={e => setFormData({ ...formData, username: e.target.value })}
                  className="w-full p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">密码 {editingUser && '(留空代表不修改)'}</label>
                <input 
                  type="password" 
                  value={formData.password}
                  onChange={e => setFormData({ ...formData, password: e.target.value })}
                  className="w-full p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                  required={!editingUser}
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">权限</label>
                <select 
                  value={formData.role}
                  onChange={e => setFormData({ ...formData, role: e.target.value })}
                  className="w-full p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="user">普通用户</option>
                  <option value="admin">管理员</option>
                </select>
              </div>
              <div className="flex gap-4 pt-4">
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 py-3 bg-gray-100 rounded-xl font-bold text-gray-600 hover:bg-gray-200">取消</button>
                <button type="submit" className="flex-1 py-3 bg-blue-600 rounded-xl font-bold text-white hover:bg-blue-700">提交</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function WorkersManagement() {
  const [workers, setWorkers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingWorker, setEditingWorker] = useState<any>(null);
  const [formData, setFormData] = useState({ name: '', concurrency: 1, capabilities: ['gemini_image'], config: {} });

  const fetchWorkers = async () => {
    try {
      const res = await fetch('/api/admin/workers');
      const data = await res.json();
      if (Array.isArray(data)) setWorkers(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWorkers();
    const interval = setInterval(fetchWorkers, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const url = editingWorker ? `/api/admin/workers/${editingWorker.id}` : '/api/admin/workers';
      const method = editingWorker ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      if (res.ok) {
        setShowModal(false);
        fetchWorkers();
      } else {
        alert('保存失败');
      }
    } catch (e) {
      alert('保存失败');
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('确定要删除此节点吗？')) return;
    try {
      const res = await fetch(`/api/admin/workers/${id}`, { method: 'DELETE' });
      if (res.ok) fetchWorkers();
    } catch (e) {
      alert('删除失败');
    }
  };

  return (
    <div className="bg-white p-6 justify-between flex flex-col rounded-2xl shadow-sm border border-gray-100 min-h-[500px]">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">分布式节点管理</h2>
          <p className="text-sm text-gray-500 mt-1">局域网分布式任务执行器监控与配制</p>
        </div>
        <button 
          onClick={() => { setEditingWorker(null); setFormData({ name: '', concurrency: 1, capabilities: ['gemini_image'], config: { downloadDir: '' } }); setShowModal(true); }}
          className="bg-blue-600 text-white px-4 py-2 rounded-xl font-bold hover:bg-blue-700 transition"
        >
          添加节点
        </button>
      </div>

      {loading ? (
        <div className="text-gray-500">加载中...</div>
      ) : workers.length === 0 ? (
        <div className="text-gray-500 py-12 text-center bg-gray-50 rounded-xl border border-dashed border-gray-300">暂无节点记录</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                <th className="p-4 font-bold border-b rounded-tl-xl">节点名称</th>
                <th className="p-4 font-bold border-b">Token密钥</th>
                <th className="p-4 font-bold border-b">IP地址</th>
                <th className="p-4 font-bold border-b">状态</th>
                <th className="p-4 font-bold border-b">配置额度</th>
                <th className="p-4 font-bold border-b text-right rounded-tr-xl">操作</th>
              </tr>
            </thead>
            <tbody className="text-sm">
                  {workers.map((worker: any) => (
                 <tr key={worker.id} className="border-b border-gray-100 hover:bg-gray-50/50">
                    <td className="p-4 font-bold text-gray-800">{worker.name}</td>
                    <td 
                        className="p-4 font-mono text-xs text-blue-600 max-w-[120px] truncate cursor-pointer hover:text-blue-800 relative group"
                        title="点击复制"
                        onClick={(e) => {
                           navigator.clipboard.writeText(worker.token);
                           const target = e.currentTarget as HTMLElement;
                           const original = worker.token;
                           target.innerText = '已复制!';
                           setTimeout(() => target.innerText = original, 1500);
                        }}
                     >
                       {worker.token}
                     </td>
                    <td className="p-4 text-gray-600">{worker.ip_address || '-'}</td>
                    <td className="p-4">
                      {worker.status === 'running' ? <span className="text-blue-600 bg-blue-50 px-2 py-1 rounded-md text-xs font-bold border border-blue-200">执行中</span> : 
                       worker.status === 'idle' ? <span className="text-green-600 bg-green-50 px-2 py-1 rounded-md text-xs font-bold border border-green-200">空闲</span> : 
                       <span className="text-gray-500 bg-gray-100 px-2 py-1 rounded-md text-xs font-bold border border-gray-200">离线</span>}
                    </td>
                    <td className="p-4 text-gray-600">{worker.concurrency} 并发</td>
                    <td className="p-4 text-right flex justify-end items-center gap-3">
                      {worker.id !== 'local-server-id' ? (
                        <>
                          {worker.status !== 'offline' && (
                            <>
                              <button onClick={async () => {
                                  try {
                                      await fetch(`/api/admin/workers/${worker.id}/command`, { 
                                          method: 'POST', 
                                          headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify({ action: 'update' })
                                      });
                                      alert('已发送更新并重启指令');
                                  } catch(e) { alert('发送失败'); }
                              }} className="text-purple-600 hover:text-purple-800 font-bold text-xs transition-colors" title="从 GitHub 拉取代码并强制重启">拉取更新</button>
                              
                              <button onClick={async () => {
                                  try {
                                      await fetch(`/api/admin/workers/${worker.id}/command`, { 
                                          method: 'POST', 
                                          headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify({ action: 'restart' })
                                      });
                                      alert('已发送重启指令');
                                  } catch(e) { alert('发送失败'); }
                              }} className="text-orange-500 hover:text-orange-700 font-bold text-xs transition-colors">重启</button>
                              
                              <button onClick={async () => {
                                  if (!window.confirm('这会导致虚拟机上的接单进程被永久强制关闭！确定？')) return;
                                  try {
                                      await fetch(`/api/admin/workers/${worker.id}/command`, { 
                                          method: 'POST', 
                                          headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify({ action: 'stop' })
                                      });
                                      alert('已发送永久停止指令');
                                  } catch(e) { alert('发送失败'); }
                              }} className="text-red-500 hover:text-red-700 font-bold text-xs transition-colors mr-2">停止守护</button>
                            </>
                          )}
                          <button onClick={() => { setEditingWorker(worker); setFormData({ name: worker.name, concurrency: worker.concurrency, capabilities: JSON.parse(worker.capabilities || '[]'), config: JSON.parse(worker.config || '{}') }); setShowModal(true); }} className="text-blue-600 hover:text-blue-800 font-bold transition-colors">设置</button>
                          <button onClick={() => handleDelete(worker.id)} className="text-gray-400 hover:text-red-700 font-bold transition-colors">删除</button>
                        </>
                      ) : (
                        <span className="text-xs font-bold text-gray-400 italic">系统专属节点 (只读)</span>
                      )}
                    </td>
                 </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden">
            <div className="bg-gray-50 p-4 border-b border-gray-100 flex justify-between items-center shrink-0">
              <h3 className="font-bold text-gray-800 text-lg">{editingWorker ? '编辑节点' : '添加节点'}</h3>
              <button type="button" onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">节点名称</label>
                <input type="text" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} className="w-full p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" required />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">并发执行数</label>
                <input type="number" min="1" value={formData.concurrency} onChange={e => setFormData({ ...formData, concurrency: parseInt(e.target.value) || 1 })} className="w-full p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" required />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">为该节点启用的功能</label>
                
                {/* Gemini 自动化生图 */}
                <div className="mb-4 border border-gray-100 rounded-xl p-4 bg-gray-50/50">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input 
                       type="checkbox" 
                       className="w-4 h-4 text-blue-600 rounded"
                       checked={formData.capabilities.includes('gemini_image')} 
                       onChange={e => {
                         if (e.target.checked) setFormData({ ...formData, capabilities: [...formData.capabilities, 'gemini_image'] });
                         else setFormData({ ...formData, capabilities: formData.capabilities.filter(c => c !== 'gemini_image') });
                       }} 
                    />
                    <span className="font-bold text-gray-800">🖼️ Gemini 自动化生图</span>
                  </label>
                  
                  {formData.capabilities.includes('gemini_image') && (
                    <div className="mt-3 pl-7 space-y-3">
                       <div>
                         <label className="block text-xs font-bold text-gray-600 mb-1">图片下载回推路径 (选填)</label>
                         <input 
                           type="text" 
                           placeholder="例如: C:\Outputs\Images"
                           value={(formData.config as any).gemini_download_dir || ''}
                           onChange={e => setFormData({ ...formData, config: { ...formData.config, gemini_download_dir: e.target.value } })}
                           className="w-full text-sm p-2 border border-gray-200 rounded-lg outline-none focus:border-blue-500" 
                         />
                         <p className="text-[10px] text-gray-500 mt-1">留空则图片生成后将只传回主服务器数据库中</p>
                       </div>
                    </div>
                  )}
                </div>

                {/* 视频提取 */}
                <div className="mb-4 border border-gray-100 rounded-xl p-4 bg-gray-50/50">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input 
                       type="checkbox" 
                       className="w-4 h-4 text-blue-600 rounded"
                       checked={formData.capabilities.includes('video_automation')} 
                       onChange={e => {
                         if (e.target.checked) setFormData({ ...formData, capabilities: [...formData.capabilities, 'video_automation'] });
                         else setFormData({ ...formData, capabilities: formData.capabilities.filter(c => c !== 'video_automation') });
                       }} 
                    />
                    <span className="font-bold text-gray-800">🎬 视频自动化截取与提取</span>
                  </label>

                  {formData.capabilities.includes('video_automation') && (
                    <div className="mt-3 pl-7 space-y-3">
                       <div>
                         <label className="block text-xs font-bold text-gray-600 mb-1">视频挂载目录 (选填)</label>
                         <input 
                           type="text" 
                           placeholder="例如: D:\Data\Videos"
                           value={(formData.config as any).video_mount_dir || ''}
                           onChange={e => setFormData({ ...formData, config: { ...formData.config, video_mount_dir: e.target.value } })}
                           className="w-full text-sm p-2 border border-gray-200 rounded-lg outline-none focus:border-blue-500" 
                         />
                       </div>
                    </div>
                  )}
                </div>

                {/* 功能扩充桩 */}
                <div className="border border-gray-100 rounded-xl p-4 bg-gray-50/50 opacity-60">
                  <label className="flex items-center gap-3 cursor-pointer cursor-not-allowed">
                    <input type="checkbox" disabled className="w-4 h-4 rounded" />
                    <span className="font-bold text-gray-500">✨ AI 无痕去水印 (开发中...)</span>
                  </label>
                </div>
              </div>

              {/* 节点专属：基础环境与路径配置 */}
              <div className="border border-gray-200/60 rounded-xl p-4 bg-blue-50/30 space-y-4">
                <div className="font-bold text-gray-800 text-sm flex items-center gap-2 border-b border-gray-100 pb-2">
                  <span>🖥️</span>
                  <span>节点基础环境与路径个人设置 (优先于全局)</span>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1">
                      首选 Chrome 浏览器绝对路径 (选填)
                    </label>
                    <input 
                      type="text" 
                      placeholder="留空则自动搜索系统默认路径。例如: C:\Program Files\Google\Chrome\Application\chrome.exe"
                      value={(formData.config as any).chromePath || ''}
                      onChange={e => setFormData({ ...formData, config: { ...formData.config, chromePath: e.target.value } })}
                      className="w-full text-sm p-2 bg-white border border-gray-200 rounded-lg outline-none focus:border-blue-500" 
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1">
                      浏览器用户数据目录 (UserDataDir 选填)
                    </label>
                    <input 
                      type="text" 
                      placeholder="留空则使用默认配置：C:\ChromeDebug"
                      value={(formData.config as any).userDataDir || ''}
                      onChange={e => setFormData({ ...formData, config: { ...formData.config, userDataDir: e.target.value } })}
                      className="w-full text-sm p-2 bg-white border border-gray-200 rounded-lg outline-none focus:border-blue-500" 
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1">
                      系统默认下载文件夹绝对路径 (Downloads 选填)
                    </label>
                    <input 
                      type="text" 
                      placeholder="留空则使用本地默认 Downloads 目录"
                      value={(formData.config as any).systemDownloadsDir || ''}
                      onChange={e => setFormData({ ...formData, config: { ...formData.config, systemDownloadsDir: e.target.value } })}
                      className="w-full text-sm p-2 bg-white border border-gray-200 rounded-lg outline-none focus:border-blue-500" 
                    />
                  </div>
                  <div>
                    <label className="flex items-center gap-2 cursor-pointer mt-1">
                      <input 
                        type="checkbox" 
                        className="w-4 h-4 text-blue-600 rounded"
                        checked={(formData.config as any).headless !== false} 
                        onChange={e => setFormData({ ...formData, config: { ...formData.config, headless: e.target.checked } })} 
                      />
                      <span className="text-xs font-bold text-gray-600">为此节点启用 Chrome 静态/无头模式 (Headless)</span>
                    </label>
                  </div>
                </div>
              </div>

              <div className="flex gap-4 pt-4">
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 py-3 bg-gray-100 rounded-xl font-bold text-gray-600 hover:bg-gray-200">取消</button>
                <button type="submit" className="flex-1 py-3 bg-blue-600 rounded-xl font-bold text-white hover:bg-blue-700">提交</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function ProxyManagement() {
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [formData, setFormData] = useState({ username: '', password: '' });
  const [isSaving, setIsSaving] = useState(false);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/admin/proxy/status');
      const data = await res.json();
      setStatus(data);
      setFormData(prev => ({ ...prev, username: data.username }));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const res = await fetch('/api/admin/proxy/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      if (res.ok) {
        alert('配置已更新，下次连接时生效');
        fetchStatus();
      }
    } catch (e) {
      alert('保存失败');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">远程加速 (P2P 打洞代理)</h2>
          <p className="text-sm text-gray-500 mt-1">无需公网IP，iPhone 直连服务器，延迟更低</p>
        </div>
        <div className={`px-3 py-1 rounded-full text-xs font-bold ${status?.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
          {status?.isActive ? '服务运行中' : '服务已停止'}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        <div className="space-y-6">
          <div className="bg-blue-50 p-6 rounded-2xl border border-blue-100">
            <h3 className="text-sm font-bold text-blue-800 mb-4 flex items-center gap-2">
              <ExternalLink size={16} /> iPhone 接入信息
            </h3>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-blue-600 font-medium">代理服务器 (Server)</p>
                <p className="text-lg font-mono font-bold text-gray-900 select-all">{status?.publicIp || '获取中...'}</p>
              </div>
              <div>
                <p className="text-xs text-blue-600 font-medium">端口 (Port)</p>
                <p className="text-lg font-mono font-bold text-gray-900 select-all">{status?.publicPort || '获取中...'}</p>
              </div>
              <div className="pt-2 border-t border-blue-100 mt-2">
                <p className="text-[10px] text-blue-400 font-bold uppercase mb-1">Debug 信息:</p>
                <div className="bg-blue-900/10 p-2 rounded text-[11px] font-mono text-blue-700 break-all leading-tight">
                  {status?.debugInfo || '等待中...'}
                </div>
              </div>
              <div className="pt-2">
                <p className="text-[10px] text-blue-500">※ 提示：如果公网IP为空，请检查服务器网络。手机与电脑需开启 UDP 通信。</p>
              </div>
            </div>
          </div>

          <div className="bg-gray-50 p-6 rounded-2xl border border-gray-100">
            <h3 className="text-sm font-bold text-gray-800 mb-4 flex items-center gap-2">
              <Settings size={16} /> 认证设置
            </h3>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">代理用户名</label>
                <input 
                  type="text" 
                  value={formData.username}
                  onChange={e => setFormData({ ...formData, username: e.target.value })}
                  className="w-full p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">代理密码</label>
                <input 
                  type="password" 
                  value={formData.password}
                  placeholder="******"
                  onChange={e => setFormData({ ...formData, password: e.target.value })}
                  className="w-full p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  required
                />
              </div>
              <button 
                type="submit" 
                disabled={isSaving}
                className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition shadow-md disabled:opacity-50"
              >
                {isSaving ? '正在保存...' : '更新认证信息'}
              </button>
            </form>
          </div>
        </div>

        <div className="space-y-6">
          <div className="prose prose-sm text-gray-600">
            <h4 className="text-gray-900 font-bold mb-2">使用教程 (iPhone):</h4>
            <ol className="list-decimal list-inside space-y-2 text-sm">
              <li>确保 iPhone 已连接网络（4G/5G 或任意 WiFi）。</li>
              <li>打开 <strong>设置</strong> → <strong>WLAN</strong>。</li>
              <li>点击当前连接的 WiFi 旁边的 <strong>(i)</strong>。</li>
              <li>拉到最下面点击 <strong>配置代理</strong> → <strong>手动</strong>。</li>
              <li><strong>服务器：</strong> 填写左侧显示的公网 IP。</li>
              <li><strong>端口：</strong> 填写左侧显示的端口号。</li>
              <li><strong>认证：</strong> 开启开关。</li>
              <li><strong>用户名/密码：</strong> 填写你上方设置的信息。</li>
              <li>保存后，即可直连办公室内网。</li>
            </ol>
            <div className="mt-6 p-4 bg-yellow-50 rounded-xl border border-yellow-100 italic text-xs text-yellow-800">
              提示：STUN 打洞受限于路由器 NAT 类型。如果打洞失败或地址无法访问，建议在路由器中开启 UPnP 功能。
            </div>
          </div>
        </div>
      </div>
    </div>
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
  const [activeTab, setActiveTab] = useState<'tasks' | 'video_tasks' | 'records' | 'video_records' | 'gallery' | 'video_gallery' | 'users' | 'proxy' | 'workers' | 'xhs_notes'>('tasks');
  const [xhsNotesList, setXhsNotesList] = useState<any[]>([]);
  const [xhsSearchText, setXhsSearchText] = useState('');
  const [xhsSelectedUser, setXhsSelectedUser] = useState('全部');
  const [isXhsNotesLoading, setIsXhsNotesLoading] = useState(false);
  const [scheduledPublishTime, setScheduledPublishTime] = useState('');
  const [xhsIsDraft, setXhsIsDraft] = useState(false);
  const [publishingXhsNoteId, setPublishingXhsNoteId] = useState<number | null>(null);
  const [xhsPublishProgress, setXhsPublishProgress] = useState<any>(null);
  const [editingXhsNote, setEditingXhsNote] = useState<any | null>(null);
  const [previewingXhsNoteId, setPreviewingXhsNoteId] = useState<any | null>(null);
  const [showNavDropdown, setShowNavDropdown] = useState<'tasks' | 'records' | 'gallery' | 'admin' | null>(null);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [personalXhsUrl, setPersonalXhsUrl] = useState('');
  const [personalBoundWorkerId, setPersonalBoundWorkerId] = useState('');
  const [availableWorkers, setAvailableWorkers] = useState<any[]>([]);
  const [copiedInstall, setCopiedInstall] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [systemConfig, setSystemConfig] = useState<any>({ 
    systemDownloadsDir: '', 
    xhsHomepageUrl: '',
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
    videoConcurrency: 1,
    videoRenderScheme: 'server',
    imageQuality: 'performance',
    watermarkRoiWPercent: 15,
    watermarkRoiHPercent: 10,
    dispatchStrategy: 'server',
    globalConcurrency: 3,
    headless: true,
    openCodeApiKey: '',
    openCodeApiUrl: '',
    openCodeModel: '',
    realesrganPath: 'realesrgan-ncnn-vulkan',
    videoFps: 60,
    videoQualityMode: 'highSharpen',
    videoColorProtection: 'bt709',
    xhsPrompt: `【核心要求：请务必深度结合我上传的“小红书封面图片”以及下方的视频分镜描述来创作。你生成的一切内容（包含标题、正文、情感基调与话题）都应该与这张封面图的视觉主题、画面主体、配色、情绪和文字标签高度契合，体现出根据封面图量身定制的原生质感。】

你是一个小红书爆款文案专家。请结合我上传的封面图片，并根据以下提供的视频分镜画面描述，为我制作一个小红书发布的标题、正文和话题标签：

视频分镜详情：
{storyboardTexts}

请遵循以下极严限制：
1. **标题**（xhsTitle）：标题必须短小精悍且极具吸引力（例如使用爆款问句、感叹句、情绪词、emoji），且**总字数（包含文字、标点、特殊符号 and emoji）绝对不能超过20字**（严格 ≤ 20字）。
2. **正文**（xhsBody）：正文要求生动活泼，语气要像小红书个人博主日常分享，分段清晰，善用表情符号/emoji。**绝对不能出现任何营销、导流、推广、购买、加好友、链接、加微信等政治敏感/营销广告引导语**，以天然真实原生态分享为主。
3. **话题**（xhsTags）：精选**刚好 10 个**极具热度和深度相关的爆款小红书话题。格式为“#话题1 #话题2 ...”，每个话题带#号，空格隔开，严格返回正好 10 个，不能多也不能少。

请使用以下标准的纯JSON格式返回：
{
  "xhsTitle": "20字内极富吸引力小红书标题",
  "xhsBody": "元气活泼的小红书正文...",
  "xhsTags": "#话题1 #话题2 #话题3 #话题4 #话题5 #话题6 #话题7 #话题8 #话题9 #话题10"
}`
  });
  const [jobs, setJobs] = useState<Job[]>([]);
  const [videoJobs, setVideoJobs] = useState<Job[]>([]);
  const sortedVideoJobs = [...videoJobs].sort((a, b) => {
    const aTime = typeof a.timestamp === 'number' ? a.timestamp : new Date(a.timestamp).getTime();
    const bTime = typeof b.timestamp === 'number' ? b.timestamp : new Date(b.timestamp).getTime();
    return bTime - aTime;
  });
  const [videoThumbErrors, setVideoThumbErrors] = useState<Record<string, boolean>>({});
  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set());
  const [showBatchDropdown, setShowBatchDropdown] = useState(false);
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set());
  const [galleryImages, setGalleryImages] = useState<GalleryAsset[]>([]);
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());
  const [showBatchMoveMenu, setShowBatchMoveMenu] = useState(false);
  const [assetGroups, setAssetGroups] = useState<any[]>([]);
  const [selectedGroupFilterIds, setSelectedGroupFilterIds] = useState<number[]>([]);
  const [groupFilterSearch, setGroupFilterSearch] = useState('');
  const [isGroupDropdownOpen, setIsGroupDropdownOpen] = useState(false);
  const knownGroupIdsRef = useRef<Set<number>>(new Set());
  
  const [createGroupType, setCreateGroupType] = useState<'image' | 'video'>('image');
  const [selectedVideoGroupFilterIds, setSelectedVideoGroupFilterIds] = useState<number[]>([]);
  const [videoGroupFilterSearch, setVideoGroupFilterSearch] = useState('');
  const [isVideoGroupDropdownOpen, setIsVideoGroupDropdownOpen] = useState(false);
  const [expandedVideoGroups, setExpandedVideoGroups] = useState<Set<number | 'unassigned'>>(new Set(['unassigned']));
  const knownVideoGroupIdsRef = useRef<Set<number>>(new Set());

  // Auto-select newly created groups and initialize on first load
  useEffect(() => {
    if (assetGroups.length > 0) {
      setSelectedGroupFilterIds(prev => {
        const next = [...prev];
        let changed = false;
        assetGroups.forEach(g => {
          if (!knownGroupIdsRef.current.has(g.id)) {
            knownGroupIdsRef.current.add(g.id);
            if (!next.includes(g.id)) {
              next.push(g.id);
              changed = true;
            }
          }
        });
        return changed ? next : prev;
      });

      // Same for video groups
      const videoGrps = assetGroups.filter(g => g.type === 'video');
      if (videoGrps.length > 0) {
        setSelectedVideoGroupFilterIds(prev => {
          const next = [...prev];
          let changed = false;
          videoGrps.forEach(g => {
            if (!knownVideoGroupIdsRef.current.has(g.id)) {
              knownVideoGroupIdsRef.current.add(g.id);
              if (!next.includes(g.id)) {
                next.push(g.id);
                changed = true;
              }
            }
          });
          return changed ? next : prev;
        });
      }
    }
  }, [assetGroups]);

  const [expandedGroups, setExpandedGroups] = useState<Set<number | 'unassigned'>>(new Set());
  const [imageGroupLimits, setImageGroupLimits] = useState<Record<string, number>>({});
  const [videoGroupLimits, setVideoGroupLimits] = useState<Record<string, number>>({});
  const [croppingVideo, setCroppingVideo] = useState<GalleryAsset | null>(null);
  const [changingBgmVideo, setChangingBgmVideo] = useState<GalleryAsset | null>(null);
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [selectedUploadGroupId, setSelectedUploadGroupId] = useState<number | null>(null);
  const [movingAssetPath, setMovingAssetPath] = useState<string | null>(null);
  const [videoGallery, setVideoGallery] = useState<GalleryAsset[]>([]);
  const [isBatchSelectMode, setIsBatchSelectMode] = useState(false);
  const [selectedVideoPaths, setSelectedVideoPaths] = useState<string[]>([]);
  const [isBatchDownloading, setIsBatchDownloading] = useState(false);
  const [selectedVideoUploadGroupId, setSelectedVideoUploadGroupId] = useState<number | null>(null);
  const [showVideoUploadMenu, setShowVideoUploadMenu] = useState(false);
  const [showVideoUrlModal, setShowVideoUrlModal] = useState(false);
  const [videoUrlInput, setVideoUrlInput] = useState('');
  const [videoUploading, setVideoUploading] = useState(false);
  const [videoUploadProgress, setVideoUploadProgress] = useState('');
  const [isDragOverVideo, setIsDragOverVideo] = useState(false);
  const videoFileInputRef = useRef<HTMLInputElement | null>(null);
  const [viewingImage, setViewingImage] = useState<string | null>(null);
  const [imgZoom, setImgZoom] = useState<number>(1);
  const [imgOffset, setImgOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [imgIsDragging, setImgIsDragging] = useState<boolean>(false);
  const [imgDragStart, setImgDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const viewingContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Reset zoom and offset when opening/closing or switching image
    setImgZoom(1);
    setImgOffset({ x: 0, y: 0 });
  }, [viewingImage]);

  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (!viewingImage) return;
      e.preventDefault();
      
      const zoomFactor = 0.12;
      let direction = e.deltaY < 0 ? 1 : -1;
      
      setImgZoom(prev => {
        const nextZoom = Math.max(0.5, Math.min(15, prev + direction * zoomFactor * prev));
        return nextZoom;
      });
    };

    const containerElement = viewingContainerRef.current;
    if (containerElement) {
      containerElement.addEventListener('wheel', handleWheel, { passive: false });
    }
    return () => {
      if (containerElement) {
        containerElement.removeEventListener('wheel', handleWheel);
      }
    };
  }, [viewingImage]);

  const [viewingVideo, setViewingVideo] = useState<string | null>(null);
  const [viewingVideoJobDetails, setViewingVideoJobDetails] = useState<Job | null>(null);
  const [viewingXhsNotes, setViewingXhsNotes] = useState<{ videoId: string, jobId?: string, taskData: VideoTask } | null>(null);
  const [showXhsGalleryPicker, setShowXhsGalleryPicker] = useState(false);
  const [showXhsStoryboardCoverPicker, setShowXhsStoryboardCoverPicker] = useState(false);
  const [cropperImageSrc, setCropperImageSrc] = useState<string | null>(null);
  const [processingGalleryImages, setProcessingGalleryImages] = useState<Set<string>>(new Set());
  const [upscalingAssetIds, setUpscalingAssetIds] = useState<Set<number>>(new Set());
  const manualProcessingImages = useRef<Set<string>>(new Set());
  const [galleryUpdateToken, setGalleryUpdateToken] = useState<number>(Date.now());
  const [editingGalleryImage, setEditingGalleryImage] = useState<{ filename: string, url: string } | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef<any>(null);

  const { user, refreshUser } = useAuth();
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set([user?.username || 'admin']));

  const [cdpStatus, setCdpStatus] = useState<'detecting' | 'ready' | 'launching' | 'failed' | 'not_running'>('detecting');
  const [cdpMessage, setCdpMessage] = useState('正在为您自动体检并配置 CDP 调试环境...');

  const checkAndLaunchCDP = async () => {
    try {
      setCdpStatus('detecting');
      setCdpMessage('正在检测当前环境 CDP 端口 (9222)...');
      
      const res = await fetch('/api/chrome/status');
      const data = await res.json();
      
      if (data.localCdpActive) {
        setCdpStatus('ready');
        setCdpMessage('CDP 远程操控环境已就绪，Chrome 正常响应中！');
        return;
      }
      
      // If not active, trigger auto-launch!
      setCdpStatus('launching');
      setCdpMessage('未见激活的调试端口，正在为您自动初始化并拉起 Chrome 浏览器...');
      
      const launchRes = await fetch('/api/chrome/launch', { method: 'POST' });
      const launchData = await launchRes.json();
      
      // Wait 4 seconds to let Chrome boot, then check status again
      setCdpMessage('已发出唤醒命令，正在等待 Chrome 进程初始化并监听端口 9222...');
      await new Promise(r => setTimeout(r, 4000));
      
      const finalRes = await fetch('/api/chrome/status');
      const finalData = await finalRes.json();
      
      if (finalData.localCdpActive) {
        setCdpStatus('ready');
        setCdpMessage('自动配置成功！Chrome 浏览器已被成功打开并可受控。');
      } else if (finalData.onlineWorkersCount > 0) {
        setCdpStatus('ready');
        setCdpMessage('已成功向您的本地 Worker 节点广播调起指令，请检查本地电脑客户端运行。');
      } else {
        setCdpStatus('not_running');
        setCdpMessage('无可用连接。如果您在本地客户端运行，请点击此处重新进行自检/唤醒。');
      }
    } catch (e: any) {
      setCdpStatus('failed');
      setCdpMessage('诊断 CDP 失败，请确认服务器网络状态：' + e.message);
    }
  };

  const effectiveXhsHomepageUrl = user?.xhs_homepage_url || systemConfig?.xhsHomepageUrl || '';

  useEffect(() => {
    if (user) {
      setPersonalXhsUrl(user.xhs_homepage_url || '');
      setPersonalBoundWorkerId(user.bound_worker_id || '');
      checkAndLaunchCDP();
    }
  }, [user]);

  useEffect(() => {
    if (showProfileModal) {
      fetch('/api/workers')
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) {
            setAvailableWorkers(data);
          }
        })
        .catch(err => console.error('Failed to load workers list for binding', err));
    }
  }, [showProfileModal]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (user?.role !== 'admin') {
      if (!personalBoundWorkerId) {
        alert('普通用户必须绑定一台当前在线的本地电脑 / 虚拟机，无法选择“不绑定”！');
        return;
      }
      if (personalBoundWorkerId === 'local-server-id') {
        alert('普通用户不能绑定内置的服务器本地(Local Server)节点，请选择您的本地在线电脑 / 虚拟机！');
        return;
      }
    }
    try {
      setIsSavingProfile(true);
      const res = await fetch('/api/user/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          xhsHomepageUrl: personalXhsUrl.trim(),
          boundWorkerId: personalBoundWorkerId
        }),
      });
      const data = await res.json();
      if (data.success) {
        await refreshUser();
        setShowProfileModal(false);
      } else {
        alert(data.error || '保存失败');
      }
    } catch (err: any) {
      alert('保存异常: ' + err.message);
    } finally {
      setIsSavingProfile(false);
    }
  };

  const toggleUserExpand = (username: string) => {
    setExpandedUsers(prev => {
      const next = new Set(prev);
      if (next.has(username)) next.delete(username);
      else next.add(username);
      return next;
    });
  };

  const groupByUser = <T extends { username?: string }>(items: T[]) => {
    const defaultUser = user?.username || 'Unknown';
    const groups: Record<string, T[]> = {};
    items.forEach(item => {
      const uname = item.username || defaultUser;
      if (!groups[uname]) groups[uname] = [];
      groups[uname].push(item);
    });
    return groups;
  };

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

  const handleUpscaleImage = async (imgData: GalleryAsset) => {
    if (imgData.resolutionTag === '4K') {
      alert('该图片已是 4K 高清分辨率，无需继续超分！');
      return;
    }
    
    if (window.confirm('确认要对该图片进行 2 倍超分吗？\n超分处理可能需要一些时间，超分后的图将作为新图片保存在该图组下。')) {
      setUpscalingAssetIds(prev => new Set(prev).add(imgData.id));
      
      try {
        const res = await fetch('/api/images/upscale', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assetId: imgData.id })
        });
        
        const data = await res.json();
        if (res.ok && data.success) {
          alert('超分成功！新图片已添加至您的图库中。');
          await fetchGallery();
        } else {
          alert('超分失败：' + (data.error || '未知错误'));
        }
      } catch (err) {
        console.error('Super-resolution upscale request failed:', err);
        alert('超分请求失败，请确保后台服务正常且已正确配置 Real-ESRGAN 环境。');
      } finally {
        setUpscalingAssetIds(prev => {
          const next = new Set(prev);
          next.delete(imgData.id);
          return next;
        });
      }
    }
  };

  const [isSettingUpESRGAN, setIsSettingUpESRGAN] = useState(false);

  const handleDownloadRealESRGAN = async () => {
    if (window.confirm('确认要一键部署/下载 Real-ESRGAN Windows 离线包吗？\n后台将直接从 GitHub 下载官方发布的 Windows 离线版本（约 25MB）并自动解压配置，无需您手动操作，这可以彻底解决“命令或文件未找到”的报错！')) {
      setIsSettingUpESRGAN(true);
      try {
        const res = await fetch('/api/admin/realesrgan/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        if (res.ok && data.success) {
          alert('部署成功！\n\nReal-ESRGAN Windows 离线环境已配置完成！\n超分执行路径已自动更新为: ' + data.path + '\n\n现在您可以随时使用超分功能了。若本地部署到其他机器，GitHub 更新后此路径及依赖也将一并保留！');
          setSystemConfig(prev => ({ ...prev, realesrganPath: data.path }));
        } else {
          alert('部署失败：' + (data.error || '未知错误'));
        }
      } catch (err) {
        console.error('Real-ESRGAN automatic setup failed:', err);
        alert('自动部署请求失败，请检查网络是否通畅（GitHub 连接状况）。');
      } finally {
        setIsSettingUpESRGAN(false);
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
  const [isGeneratingXhs, setIsGeneratingXhs] = useState(false);
  const [isPackagingZip, setIsPackagingZip] = useState(false);

  const handleDownloadXhsPackage = async () => {
    if (!viewingXhsNotes) return;
    
    setIsPackagingZip(true);
    try {
      const coverImage = viewingXhsNotes.taskData?.xhsCoverImage || (viewingXhsNotes.taskData?.storyboards && viewingXhsNotes.taskData.storyboards[0]?.image);
      const payload = {
        videoPath: viewingXhsNotes.videoId,
        coverPath: coverImage || '',
        title: viewingXhsNotes.taskData?.xhsTitle || '',
        content: viewingXhsNotes.taskData?.xhsBody || '',
        tags: viewingXhsNotes.taskData?.xhsTags || ''
      };

      const response = await fetch('/api/videos/xhs/download-package', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const text = await response.text();
        let errMsg = '打包下载失败';
        try {
          const errData = JSON.parse(text);
          errMsg = errData.error || errMsg;
        } catch (_) {
          errMsg = text || errMsg;
        }
        throw new Error(errMsg);
      }

      const data = await response.json();
      if (!data.downloadUrl) {
        throw new Error('未返回下载链接');
      }

      const a = document.createElement('a');
      a.href = data.downloadUrl;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e: any) {
      console.error(e);
      alert(e.message || '打包下载失败，请重试');
    } finally {
      setIsPackagingZip(false);
    }
  };

  const handleBatchDownloadXhsPackage = async () => {
    if (selectedVideoPaths.length === 0) {
      alert('请先选择至少一个视频进行打包下载');
      return;
    }
    
    setIsBatchDownloading(true);
    try {
      const response = await fetch('/api/videos/xhs/download-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoPaths: selectedVideoPaths })
      });

      if (!response.ok) {
        const text = await response.text();
        let errMsg = '批量打包下载失败';
        try {
          const errData = JSON.parse(text);
          errMsg = errData.error || errMsg;
        } catch (_) {
          errMsg = text || errMsg;
        }
        throw new Error(errMsg);
      }

      const data = await response.json();
      if (!data.downloadUrl) {
        throw new Error('未返回下载链接');
      }

      const a = document.createElement('a');
      a.href = data.downloadUrl;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      // Successfully downloaded, clear selections and exit batch select mode
      setSelectedVideoPaths([]);
      setIsBatchSelectMode(false);
    } catch (e: any) {
      console.error(e);
      alert(e.message || '批量打包下载失败，请重试');
    } finally {
      setIsBatchDownloading(false);
    }
  };

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
      if (isGroupDropdownOpen && !(event.target as HTMLElement).closest('.group-filter-container')) {
        setIsGroupDropdownOpen(false);
      }
      if (showVideoUploadMenu && !(event.target as HTMLElement).closest('.video-upload-menu-container')) {
        setShowVideoUploadMenu(false);
      }
      if (isVideoGroupDropdownOpen && !(event.target as HTMLElement).closest('.video-group-filter-container')) {
        setIsVideoGroupDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showUploadMenu, showGalleryUploadMenu, isGroupDropdownOpen, showVideoUploadMenu, isVideoGroupDropdownOpen]);

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
      if (Array.isArray(data)) {
        setJobs(data);
      } else {
        console.error('Invalid jobs data:', data);
        setJobs([]);
      }
    } catch (error) {
      console.error('Failed to fetch jobs:', error);
      setJobs([]);
    }
  };

  const getJobCoverSrc = (job: any) => {
    const isFailedVideoThumb = videoThumbErrors[job.id];
    if (isFailedVideoThumb || job.status !== 'completed') {
      let coverImg = job.data?.xhsCoverImage || job.data?.storyboards?.[0]?.image;
      if (!coverImg) return '';
      let cleanedImg = coverImg;
      if (cleanedImg.startsWith('/')) cleanedImg = cleanedImg.substring(1);
      if (cleanedImg.startsWith('uploads/')) {
        return `/api/thumbnails/uploads/${cleanedImg.substring(8)}${galleryUpdateToken ? `?t=${galleryUpdateToken}` : ''}`;
      } else if (cleanedImg.startsWith('downloads/')) {
        return `/api/thumbnails/downloads/${cleanedImg.substring(10)}${galleryUpdateToken ? `?t=${galleryUpdateToken}` : ''}`;
      }
      return coverImg;
    }
    
    let videoPath = job.resultFiles?.[0] || job.data?.outputVideo;
    if (videoPath) {
      let cleanedVideo = videoPath;
      if (cleanedVideo.startsWith('/')) cleanedVideo = cleanedVideo.substring(1);
      if (cleanedVideo.startsWith('downloads/videos/')) {
        cleanedVideo = cleanedVideo.substring(17);
      }
      return `/api/thumbnails/videos/${cleanedVideo.replace(/\.[^/.]+$/, ".jpg")}${galleryUpdateToken ? `?t=${galleryUpdateToken}` : ''}`;
    }
    return '';
  };

  const fetchVideoJobs = async () => {
    try {
      const res = await fetch('/api/video/jobs');
      const data = await res.json();
      if (Array.isArray(data)) {
        // Keep any client-side jobs from the current local state so they are not wiped out by server poll until the server has them
        setVideoJobs(prev => {
          const clientSideJobs = prev.filter(j => j.id.startsWith('task_video_') && !data.some((sj: any) => sj.id === j.id));
          const filteredData = data.filter((serverJob: any) => !clientSideJobs.some(cj => cj.id === serverJob.id));
          return [...clientSideJobs, ...filteredData];
        });
      } else {
        console.error('Invalid video jobs data:', data);
        setVideoJobs(prev => prev.filter(j => j.id.startsWith('task_video_')));
      }
    } catch (error) {
      console.error('Failed to fetch video jobs:', error);
      setVideoJobs(prev => prev.filter(j => j.id.startsWith('task_video_')));
    }
  };

  const fetchProcessingStatus = async () => {
    try {
      const res = await fetch('/api/processing-status');
      const backendProcessing = await res.json() as string[];
      
      if (Array.isArray(backendProcessing)) {
        setProcessingGalleryImages(prev => {
          // Merge manual edits (client-side) and auto-removal (server-side)
          const combined = new Set(backendProcessing);
          manualProcessingImages.current.forEach(img => combined.add(img));
          
          return combined;
        });
      }
    } catch (error) {
      console.error('Failed to fetch processing status:', error);
    }
  };

  useEffect(() => {
    let interval: any;
    if (activeTab === 'records') {
      fetchJobs();
      interval = setInterval(fetchJobs, 3000);
    } else if (activeTab === 'video_records') {
      fetchVideoJobs();
      interval = setInterval(fetchVideoJobs, 3000);
    } else if (activeTab === 'gallery') {
      fetchGallery();
      fetchProcessingStatus();
      interval = setInterval(() => {
        fetchGallery();
        fetchProcessingStatus();
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [activeTab]);

  const fetchAssetGroups = async () => {
    try {
      const res = await fetch('/api/groups');
      const data = await res.json();
      if (Array.isArray(data)) {
        setAssetGroups(data);
      }
    } catch (e) {
      console.error('Failed to fetch groups:', e);
    }
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return;
    try {
      const res = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newGroupName.trim(), type: createGroupType }),
      });
      const data = await res.json();
      if (res.ok) {
        setNewGroupName('');
        setShowCreateGroupModal(false);
        fetchGallery();
        fetchVideoGallery();
      } else {
        alert(data.error || '创建组失败');
      }
    } catch (err) {
      console.error('Failed to create group:', err);
    }
  };

  const handleRenameGroup = async (groupId: number, currentName: string) => {
    const newName = window.prompt('请输入新的组名:', currentName);
    if (newName === null) return; // Cancelled
    if (!newName.trim()) {
      alert('组名不能为空');
      return;
    }
    try {
      const res = await fetch(`/api/groups/${groupId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        fetchAssetGroups();
      } else {
        alert(data.error || '修改组名失败');
      }
    } catch (err) {
      console.error('Failed to rename group:', err);
    }
  };

  const handleMoveToGroup = async (filePath: string, groupId: number | null, assetType: 'image' | 'video' = 'image') => {
    try {
      const res = await fetch('/api/groups/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath, groupId, type: assetType }),
      });
      const data = await res.json();
      if (res.ok) {
        setMovingAssetPath(null);
        if (assetType === 'image') {
          fetchGallery();
        } else {
          fetchVideoGallery();
        }
      } else {
        alert(data.error || '移动失败');
      }
    } catch (err) {
      console.error('Failed to move asset:', err);
    }
  };

  const handleDeleteGroup = async (groupId: number) => {
    const imagesInThisGroup = galleryImages.filter(img => img.groupId === groupId);
    const videosInThisGroup = videoGallery.filter(vid => vid.groupId === groupId);
    if (imagesInThisGroup.length > 0 || videosInThisGroup.length > 0) {
      alert('该分组内还存在资源，不支持删除，请先将资源移动至其他分组。');
      return;
    }
    if (!window.confirm('确定要删除此分组吗？')) return;
    try {
      const res = await fetch(`/api/groups/${groupId}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (res.ok) {
        fetchGallery();
        fetchVideoGallery();
      } else {
        alert(data.error || '删除分组失败');
      }
    } catch (err) {
      console.error('Failed to delete group:', err);
    }
  };

  const handleBatchDownload = async () => {
    if (selectedImages.size === 0) return;
    try {
      const res = await fetch('/api/images/batch-download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePaths: Array.from(selectedImages) }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || '批量下载失败');
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `images_export_${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to batch download images:', err);
      alert('打包下载传输出现错误，请检查网络');
    }
  };

  const handleBatchMoveToGroup = async (groupId: number | null) => {
    if (selectedImages.size === 0) return;
    try {
      const res = await fetch('/api/groups/batch-move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePaths: Array.from(selectedImages), groupId }),
      });
      const data = await res.json();
      if (res.ok) {
        setSelectedImages(new Set());
        setShowBatchMoveMenu(false);
        fetchGallery();
      } else {
        alert(data.error || '批量移动失败');
      }
    } catch (err) {
      console.error('Failed to batch move:', err);
    }
  };

  const handleBatchDeleteImages = async () => {
    if (selectedImages.size === 0) return;
    if (!window.confirm(`确定要彻底删除这 ${selectedImages.size} 张图片吗？此操作将从磁盘上安全抹除这些源文件且不可恢复。`)) return;
    
    try {
      const paths = Array.from(selectedImages);
      await Promise.all(paths.map(async (filename) => {
        const strFilename = filename as string;
        const encodedFilename = strFilename.split('/').map(encodeURIComponent).join('/');
        await fetch(`/api/images/${encodedFilename}`, { method: 'DELETE' });
      }));
      setSelectedImages(new Set());
      fetchGallery();
    } catch (err) {
      console.error('Failed to batch delete images:', err);
      alert('部分图片删除失败，请刷新后再试');
    }
  };

  const fetchGallery = async () => {
    try {
      fetchAssetGroups();
      const res = await fetch('/api/images');
      const data = await res.json();
      if (Array.isArray(data)) {
        setGalleryImages(data);
      } else {
        console.error('Invalid gallery images data:', data);
        setGalleryImages([]);
      }
      setGalleryUpdateToken(Date.now());
    } catch (error) {
      console.error('Failed to fetch gallery:', error);
      setGalleryImages([]);
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

  const fetchXhsNotes = async () => {
    setIsXhsNotesLoading(true);
    try {
      const res = await fetch('/api/xhs-notes');
      const data = await res.json();
      if (Array.isArray(data)) {
        setXhsNotesList(data);
      }
    } catch (e) {
      console.error('Failed to fetch XHS notes list:', e);
    } finally {
      setIsXhsNotesLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'gallery' || activeTab === 'video_tasks') fetchGallery();
    if (activeTab === 'video_gallery') fetchVideoGallery();
    if (activeTab === 'xhs_notes') fetchXhsNotes();
  }, [activeTab]);

  useEffect(() => {
    if (!viewingXhsNotes) {
      setScheduledPublishTime('');
      setXhsIsDraft(false);
    }
  }, [viewingXhsNotes]);

  const uploadVideoFile = async (file: File, groupId: number | null) => {
    setVideoUploading(true);
    setVideoUploadProgress('正在读取视频文件...');
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (ev) => resolve(ev.target?.result as string);
        reader.onerror = (err) => reject(err);
        reader.readAsDataURL(file);
      });

      setVideoUploadProgress('正在上传并处理视频（生成封面）...');
      const response = await fetch('/api/videos/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoBase64: base64,
          filename: file.name,
          groupId: groupId
        })
      });
      const data = await response.json();
      if (response.ok && data.success) {
        fetchVideoGallery();
      } else {
        alert(data.error || '视频上传失败');
      }
    } catch (error: any) {
      console.error('Video upload failed:', error);
      alert('视频上传失败：' + (error.message || error));
    } finally {
      setVideoUploading(false);
      setVideoUploadProgress('');
    }
  };

  const downloadVideoFromUrl = async (url: string, groupId: number | null) => {
    setVideoUploading(true);
    setVideoUploadProgress('正在从指定网址下载视频...');
    try {
      const response = await fetch('/api/videos/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl: url,
          groupId: groupId
        })
      });
      const data = await response.json();
      if (response.ok && data.success) {
        fetchVideoGallery();
      } else {
        alert(data.error || '视频网址导入失败');
      }
    } catch (error: any) {
      console.error('Video import failed:', error);
      alert('视频网址导入失败：' + (error.message || error));
    } finally {
      setVideoUploading(false);
      setVideoUploadProgress('');
    }
  };

  const handleVideoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (files.length === 0) return;
    await uploadVideoFile(files[0], selectedVideoUploadGroupId);
    if (videoFileInputRef.current) videoFileInputRef.current.value = '';
  };

  // Global paste handler when on Gallery tab to target-upload to active group
  useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
      if (activeTab !== 'gallery') return;
      
      const target = e.target as HTMLElement;
      if (
        target &&
        (target.tagName === 'INPUT' ||
         target.tagName === 'TEXTAREA' ||
         target.isContentEditable)
      ) {
        return;
      }
      
      const items = e.clipboardData?.items;
      if (!items) return;
      
      let hasImage = false;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          hasImage = true;
          break;
        }
      }
      
      if (hasImage) {
        e.preventDefault();
        handlePasteImageItems(items);
      }
    };
    
    window.addEventListener('paste', handleGlobalPaste);
    return () => {
      window.removeEventListener('paste', handleGlobalPaste);
    };
  }, [activeTab, selectedUploadGroupId]);

  // Global paste handler when on Video Gallery tab to target-upload to active video group
  useEffect(() => {
    const handleGlobalVideoPaste = async (e: ClipboardEvent) => {
      if (activeTab !== 'video_gallery') return;
      
      const target = e.target as HTMLElement;
      if (
        target &&
        (target.tagName === 'INPUT' ||
         target.tagName === 'TEXTAREA' ||
         target.isContentEditable)
      ) {
        return;
      }
      
      const items = e.clipboardData?.items;
      const text = e.clipboardData?.getData('text');

      // 1. If paste contains a video file
      if (items) {
        let hasVideo = false;
        let videoFile: File | null = null;
        for (let i = 0; i < items.length; i++) {
          if (items[i].type.indexOf('video') !== -1) {
            hasVideo = true;
            videoFile = items[i].getAsFile();
            break;
          }
        }
        if (hasVideo && videoFile) {
          e.preventDefault();
          await uploadVideoFile(videoFile, selectedVideoUploadGroupId);
          return;
        }
      }

      // 2. If paste contains text (potential video URL)
      if (text && (text.startsWith('http://') || text.startsWith('https://'))) {
        e.preventDefault();
        const confirmDownload = window.confirm(`检测到剪贴板中的视频网址:\n${text}\n\n是否立即导入到当前视频库/视频组？`);
        if (confirmDownload) {
          await downloadVideoFromUrl(text, selectedVideoUploadGroupId);
        }
      }
    };
    
    window.addEventListener('paste', handleGlobalVideoPaste);
    return () => {
      window.removeEventListener('paste', handleGlobalVideoPaste);
    };
  }, [activeTab, selectedVideoUploadGroupId]);

  // Polling for Xiaohongshu Publishing progress
  useEffect(() => {
    if (publishingXhsNoteId === null) {
      setXhsPublishProgress(null);
      return;
    }

    let isSubscribed = true;
    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/videos/xhs/publish/status/${publishingXhsNoteId}`);
        const data = await res.json();
        if (isSubscribed) {
          setXhsPublishProgress(data);
          if (data.status === 'success' || data.status === 'failed') {
            clearInterval(pollInterval);
            // Refresh list
            fetchXhsNotes();
          }
        }
      } catch (err) {
        console.error('Failed to poll XHS publish status:', err);
      }
    }, 1000);

    return () => {
      isSubscribed = false;
      clearInterval(pollInterval);
    };
  }, [publishingXhsNoteId]);

  const handleBatchAction = async (action: 'pause' | 'pause_delete' | 'delete') => {
    if (selectedJobs.size === 0) return;
    
    const taskIds = Array.from(selectedJobs).map((f: string) => f.replace('.json', ''));
    
    let actionName = action === 'pause' ? '批量暂停' : action === 'delete' ? '批量删除' : '批量暂停并删除';
    let confirmMsg = `确定要执行 ${actionName} (${selectedJobs.size} 条记录) 吗？`;
    
    if (action === 'delete' || action === 'pause_delete') {
      confirmMsg += '\n注意：记录删除后将无法恢复。';
    }

    if (!window.confirm(confirmMsg)) return;

    try {
      await fetch('/api/jobs/batch-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskIds, action })
      });
      setSelectedJobs(new Set());
      fetchJobs();
      if (activeTab === 'video_tasks') fetchVideoJobs();
      setShowBatchDropdown(false);
    } catch (error) {
      console.error('Batch action failed:', error);
      alert('批量操作失败，请重试');
    }
  };

  const deleteSelectedJobs = async () => {
    if (selectedJobs.size === 0) return;
    
    // Check if any selected jobs are running
    const runningJobsCount = Array.from(selectedJobs).filter((filename: string) => {
      const jobId = filename.replace('.json', '');
      const job = (activeTab === 'video_tasks' ? videoJobs : jobs).find(j => j.id === jobId);
      return job && job.status === 'running';
    }).length;

    let confirmMsg = `确定要删除选中的 ${selectedJobs.size} 条记录吗？\n(生成的图片/视频不会被删除)`;
    if (runningJobsCount > 0) {
      confirmMsg = `选中的记录中包含 ${runningJobsCount} 条正在执行的任务。\n停止这些正在执行的任务并删除记录，确定继续吗？`;
    }

    if (!window.confirm(confirmMsg)) return;
    
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
      // Split the path and encode components to preserve '/' slashes.
      // E.g. '1/my_image.png' -> '1/my_image.png' cleanly in the URL path.
      const encodedFilename = filename.split('/').map(encodeURIComponent).join('/');
      await fetch(`/api/images/${encodedFilename}`, { method: 'DELETE' });
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
    const newTask: Task = { id: Date.now().toString(), prompt: '', images: [], count: 1, download: true, executor: 'js' };
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

  const uploadBase64Images = async (base64Images: string[], targetGroupId: number | null) => {
    setUploadingCount(prev => prev + base64Images.length);
    try {
      const response = await fetch('/api/images/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: base64Images, groupId: targetGroupId })
      });
      const data = await response.json();
      if (response.ok && data.success) {
        fetchGallery();
      } else {
        alert(data.error || '图片上传失败');
      }
    } catch (error) {
      console.error('Upload failed:', error);
      alert('图片上传失败，请检查网络');
    } finally {
      setUploadingCount(prev => Math.max(0, prev - base64Images.length));
    }
  };

  const handleGalleryImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (files.length === 0) return;
    
    setShowGalleryUploadMenu(false);

    const promises = files.map(f => {
      return new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (ev) => resolve(ev.target?.result as string);
        reader.readAsDataURL(f);
      });
    });
    const base64Images = await Promise.all(promises);
    await uploadBase64Images(base64Images, selectedUploadGroupId);
  };

  const handlePasteImageItems = async (items: DataTransferItemList) => {
    const promises: Promise<string>[] = [];
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.indexOf('image') !== -1) {
          const file = item.getAsFile();
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
      setShowGalleryUploadMenu(false);
      const base64Images = await Promise.all(promises);
      await uploadBase64Images(base64Images, selectedUploadGroupId);
    }
  };

  const handleGalleryPaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    await handlePasteImageItems(items);
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
    if (!systemConfig.xhsPrompt || !systemConfig.xhsPrompt.trim()) {
      alert('小红书笔记提示词不能为空！');
      return;
    }
    setIsSavingConfig(true);
    try {
      console.log('Original config:', systemConfig);
      // Clean up systemDownloadsDir to remove invisible characters (like LRM from Windows Explorer) and trim whitespace
      const cleanedConfig = {
        ...systemConfig,
        systemDownloadsDir: systemConfig.systemDownloadsDir ? systemConfig.systemDownloadsDir.replace(/[\u200B-\u200D\uFEFF\u200E\u200F]/g, '').trim() : '',
        chromePath: systemConfig.chromePath?.trim() || '',
        userDataDir: systemConfig.userDataDir?.trim() || ''
      };
      
      console.log('Sending config to server:', cleanedConfig);
      
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cleanedConfig)
      });
      
      if (!response.ok) {
          throw new Error('Server responded with ' + response.status);
      }
      
      const result = await response.json();
      console.log('Server response:', result);

      setSystemConfig(cleanedConfig);
      
      // Artificial delay so the loading UI is actually visible to users indicating that work was done.
      await new Promise(resolve => setTimeout(resolve, 800));
      
      setShowConfigModal(false);
      alert('系统设置已保存！');
    } catch (e: any) {
      console.error(e);
      alert('保存失败: ' + e.message);
    } finally {
      setIsSavingConfig(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto bg-gray-50 min-h-screen">
      <div className="flex flex-col md:flex-row md:justify-between md:items-end border-b border-gray-200 mb-6 pb-2 md:pb-0 gap-3 relative">
        <div className="flex flex-wrap gap-x-2 gap-y-1.5 md:gap-6 items-center w-full md:w-auto">
          {/* Tasks Dropdown */}
          <div className="relative">
            <button 
              onClick={() => setShowNavDropdown(showNavDropdown === 'tasks' ? null : 'tasks')} 
              className={`text-sm font-medium transition-all whitespace-nowrap flex items-center gap-1 cursor-pointer rounded-lg md:rounded-none px-2.5 py-1.5 md:px-0 md:py-0 md:pb-3 ${
                ['tasks', 'video_tasks'].includes(activeTab) 
                  ? 'bg-blue-50 text-blue-600 md:bg-transparent md:border-b-2 md:border-blue-600 font-semibold' 
                  : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800 md:hover:bg-transparent'
              }`}
            >
              任务 <ChevronDown size={14}/>
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
              className={`text-sm font-medium transition-all whitespace-nowrap flex items-center gap-1 cursor-pointer rounded-lg md:rounded-none px-2.5 py-1.5 md:px-0 md:py-0 md:pb-3 ${
                ['records', 'video_records'].includes(activeTab) 
                  ? 'bg-blue-50 text-blue-600 md:bg-transparent md:border-b-2 md:border-blue-600 font-semibold' 
                  : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800 md:hover:bg-transparent'
              }`}
            >
              任务记录 <ChevronDown size={14}/>
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
              className={`text-sm font-medium transition-all whitespace-nowrap flex items-center gap-1 cursor-pointer rounded-lg md:rounded-none px-2.5 py-1.5 md:px-0 md:py-0 md:pb-3 ${
                ['gallery', 'video_gallery'].includes(activeTab) 
                  ? 'bg-blue-50 text-blue-600 md:bg-transparent md:border-b-2 md:border-blue-600 font-semibold' 
                  : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800 md:hover:bg-transparent'
              }`}
            >
              素材库 <ChevronDown size={14}/>
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

          {/* Xiaohongshu Notes Publishing Summaries (小红书发布) */}
          <button 
            type="button"
            onClick={() => { setActiveTab('xhs_notes'); setShowNavDropdown(null); }}
            className={`text-sm font-medium transition-all whitespace-nowrap flex items-center gap-1 cursor-pointer rounded-lg md:rounded-none px-2.5 py-1.5 md:px-0 md:py-0 md:pb-3 ${
              activeTab === 'xhs_notes' 
                ? 'bg-red-50 text-red-600 md:bg-transparent md:border-b-2 md:border-red-500 md:text-red-500 font-semibold' 
                : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800 md:hover:bg-transparent'
            }`}
          >
            小红书发布
          </button>

          {/* Admin Dropdown */}
          {user?.role === 'admin' && (
            <div className="relative">
              <button 
                onClick={() => setShowNavDropdown(showNavDropdown === 'admin' ? null : 'admin')} 
                className={`text-sm font-medium transition-all whitespace-nowrap flex items-center gap-1 cursor-pointer rounded-lg md:rounded-none px-2.5 py-1.5 md:px-0 md:py-0 md:pb-3 ${
                  ['users', 'proxy', 'workers'].includes(activeTab) 
                    ? 'bg-blue-50 text-blue-600 md:bg-transparent md:border-b-2 md:border-blue-600 font-semibold' 
                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800 md:hover:bg-transparent'
                }`}
              >
                管理员 <ChevronDown size={14}/>
              </button>
              {showNavDropdown === 'admin' && (
                <div className="absolute top-full left-0 mt-1 w-32 bg-white border border-gray-100 shadow-lg rounded-xl overflow-hidden z-50">
                  <button 
                    onClick={() => { setActiveTab('users'); setShowNavDropdown(null); }}
                    className={`w-full text-left px-4 py-2.5 text-sm hover:bg-blue-50 ${activeTab === 'users' ? 'text-blue-600 font-bold' : 'text-gray-700'}`}
                  >
                    用户管理
                  </button>
                  <button 
                    onClick={() => { setActiveTab('workers'); setShowNavDropdown(null); }}
                    className={`w-full text-left px-4 py-2.5 text-sm hover:bg-blue-50 ${activeTab === 'workers' ? 'text-blue-600 font-bold' : 'text-gray-700'}`}
                  >
                    节点管理
                  </button>
                  <button 
                    onClick={() => { setActiveTab('proxy'); setShowNavDropdown(null); }}
                    className={`w-full text-left px-4 py-2.5 text-sm hover:bg-blue-50 ${activeTab === 'proxy' ? 'text-blue-600 font-bold' : 'text-gray-700'}`}
                  >
                    远程加速 (P2P)
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5 items-center w-full md:w-auto justify-end md:justify-start">
          {/* Chrome CDP 智能诊断状态组件 */}
          <button
            onClick={checkAndLaunchCDP}
            disabled={cdpStatus === 'detecting' || cdpStatus === 'launching'}
            className={`md:mb-2 px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow-sm cursor-pointer ${
              cdpStatus === 'ready' 
                ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'
                : cdpStatus === 'detecting' || cdpStatus === 'launching'
                ? 'bg-amber-50 text-amber-700 animate-pulse border border-amber-200'
                : 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-200'
            }`}
            title={cdpMessage}
          >
            <Chrome size={14} className={cdpStatus === 'detecting' || cdpStatus === 'launching' ? 'animate-spin' : ''} />
            <span className="hidden md:inline">
              {cdpStatus === 'ready' && 'Chrome调试 (CDP) 就绪'}
              {(cdpStatus === 'detecting' || cdpStatus === 'launching') && '配置/唤醒 Chrome 中...'}
              {(cdpStatus === 'failed' || cdpStatus === 'not_running') && 'CDP 环境未就绪 (点击极速配置)'}
            </span>
            <span className="inline md:hidden">
              {cdpStatus === 'ready' ? 'CDP就绪' : 'CDP错误/自检'}
            </span>
          </button>

          <button 
            onClick={() => setShowProfileModal(true)} 
            className="md:mb-2 p-1.5 md:p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition flex items-center gap-1.5" 
            title="个人设置"
          >
            <User size={18} />
            <span className="text-sm font-medium hidden sm:inline">个人设置</span>
          </button>
          {user?.role === 'admin' && (
            <button 
              onClick={() => setShowConfigModal(true)} 
              className="md:mb-2 p-1.5 md:p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition flex items-center gap-1.5" 
              title="系统设置"
            >
              <Settings size={18} />
              <span className="text-sm font-medium hidden sm:inline">系统设置</span>
            </button>
          )}
        </div>
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
              value={activeTask?.executor || 'js'} 
              onChange={(e) => updateTask({ executor: e.target.value as 'js' | 'cdp' })}
              className="border border-gray-200 p-2 rounded-lg bg-gray-50 font-bold text-blue-600"
            >
              <option value="js">JS (旧版) [推荐]</option>
              <option value="cdp">CDP</option>
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
                    
                    const currentTasks = [...validTasks];

                    if (systemConfig.videoRenderScheme === 'client') {
                      // ====== CLIENT-SIDE WEBCODECS RENDERING SCHEME ======
                      setVideoTasks([]);
                      setActiveVideoTaskId('');
                      setActiveTab('video_records');

                      // 1. Create client rendering job objects
                      const jobsToRender: Job[] = currentTasks.map(task => {
                        const jobId = `task_video_${user?.id || 'anon'}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
                        return {
                          id: jobId,
                          timestamp: Date.now(),
                          tasks: [],
                          status: 'client_rendering' as any, // Visual status for client rendering
                          progress: 0,
                          statusMessage: '等待中...',
                          data: { ...task, id: jobId },
                          username: user?.username || 'admin'
                        };
                      });

                      // Prepended to videoJobs list so they show up immediately
                      setVideoJobs(prev => [...jobsToRender, ...prev]);

                      // Auto-expand the current user's video records accordion so that it is visible immediately
                      setExpandedUsers(prev => {
                        const next = new Set(prev);
                        next.add((user?.username || 'admin') + '_video');
                        return next;
                      });

                      // 2. Sequential execution loop (One finishes, then next begins, never concurrent!)
                      (async () => {
                        const { renderVideoClientSide } = await import('./clientRenderer');

                        for (const job of jobsToRender) {
                          try {
                            // Update job to active rendering state
                            setVideoJobs(prev => prev.map(j => j.id === job.id ? { 
                              ...j, 
                              status: 'client_rendering' as any, 
                              statusMessage: '准备画布与分镜素材...' 
                            } : j));

                            // Start rendering
                            const silentBlob = await renderVideoClientSide(
                              job.data,
                              systemConfig.videoFps || 60,
                              (progressUpdate) => {
                                setVideoJobs(prev => prev.map(j => j.id === job.id ? { 
                                  ...j, 
                                  progress: progressUpdate.progress, 
                                  statusMessage: progressUpdate.message 
                                } : j));
                              },
                              {
                                videoQualityMode: systemConfig.videoQualityMode || 'highSharpen'
                              }
                            );

                             // Upload silent MP4 video as Base64 to server to finalize audio merge
                             const isAudioMerged = (silentBlob as any).isAudioMerged === true;
                             setVideoJobs(prev => prev.map(j => j.id === job.id ? { 
                                 ...j, 
                                 statusMessage: isAudioMerged ? '正在保存视频并生成封面和数据...' : '正在上传渲染流并合成背景音乐...' 
                             } : j));

                             const reader = new FileReader();
                             const base64Promise = new Promise<string>((resolve) => {
                               reader.onloadend = () => {
                                 const base64data = reader.result as string;
                                 const base64 = base64data.split(',')[1];
                                 resolve(base64);
                               };
                               reader.readAsDataURL(silentBlob);
                             });
                             
                             const videoBase64 = await base64Promise;

                             const res = await fetch('/api/video/client-render-complete', {
                               method: 'POST',
                               headers: { 'Content-Type': 'application/json' },
                               body: JSON.stringify({
                                 jobId: job.id,
                                 taskData: job.data,
                                 videoBase64: videoBase64,
                                 isAudioMerged: isAudioMerged
                               })
                             });

                            const data = await res.json();
                            if (res.ok && data.status === 'ok') {
                              setVideoJobs(prev => prev.map(j => j.id === job.id ? { 
                                ...j, 
                                status: 'completed' as any, 
                                progress: 100, 
                                statusMessage: '渲染完成！视频文件已保存。',
                                data: { ...j.data, outputVideo: data.outputVideo }
                              } : j));
                              fetchVideoGallery();
                              fetchGallery();
                            } else {
                              throw new Error(data.error || '服务器合流背景音乐失败！');
                            }
                          } catch (err: any) {
                            console.error(`Local render failed for job ${job.id}:`, err);
                            
                            // Send error report to the server to display in command line logs and save to DB
                            try {
                              await fetch('/api/video/client-render-failed', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  jobId: job.id,
                                  error: err.message || String(err)
                                })
                              });
                            } catch (reportErr) {
                              console.error('Failed to report render failure to server:', reportErr);
                            }

                            setVideoJobs(prev => prev.map(j => j.id === job.id ? { 
                              ...j, 
                              status: 'error' as any, 
                              statusMessage: `渲染失败: ${err.message}` 
                            } : j));
                          }
                        }
                      })();

                    } else {
                      // ====== SERVER-SIDE FFMEG RENDERING SCHEME (ORIGINAL) ======
                      // Optimistic UI: Immediately clear tasks and switch tab
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
                    }
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
              
              <div className="relative">
                <button 
                  onClick={() => setShowBatchDropdown(!showBatchDropdown)}
                  disabled={selectedJobs.size === 0} 
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-red-50 text-red-600 border border-red-100 rounded-lg hover:bg-red-100 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                >
                  <Trash2 size={16} />
                  批量操作 ({selectedJobs.size})
                  <ChevronDown size={14} className={`transition-transform duration-200 ${showBatchDropdown ? 'rotate-180' : ''}`} />
                </button>
                
                {showBatchDropdown && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowBatchDropdown(false)} />
                    <div className="absolute right-0 mt-2 w-48 bg-white border border-gray-100 rounded-xl shadow-xl z-20 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                      <button 
                        onClick={() => handleBatchAction('pause')}
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                      >
                        <Clock size={14} className="text-orange-500" /> 批量暂停任务
                      </button>
                      <button 
                        onClick={() => handleBatchAction('pause_delete')}
                        className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 border-t border-gray-50"
                      >
                        <Trash2 size={14} /> 批量暂停并删除
                      </button>
                      <button 
                        onClick={() => handleBatchAction('delete')}
                        className="w-full text-left px-4 py-2 text-sm text-gray-400 hover:bg-gray-50 flex items-center gap-2 border-t border-gray-50"
                      >
                        <Trash2 size={14} /> 仅批量删除记录
                      </button>
                    </div>
                  </>
                )}
              </div>
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
              {user?.role === 'admin' ? (
                Object.entries(groupByUser(jobs)).map(([uname, userJobs]: [string, any[]]) => (
                  <div key={uname} className="mb-6 bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
                    <div 
                      onClick={() => toggleUserExpand(uname)}
                      className="bg-gray-50 px-6 py-4 cursor-pointer flex justify-between items-center border-b border-gray-200 hover:bg-gray-100 transition"
                    >
                      <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                        <span>👤 {uname}</span>
                        <span className="bg-blue-100 text-blue-700 text-xs px-2 py-1 rounded-full font-bold">{userJobs.length} 条记录</span>
                      </h3>
                      {expandedUsers.has(uname) ? <ChevronUp size={20} className="text-gray-500" /> : <ChevronDown size={20} className="text-gray-500" />}
                    </div>
                    {expandedUsers.has(uname) && (
                      <div className="p-4 space-y-4 bg-gray-50/50">
                        {userJobs.map((job: any) => (
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
                      </div>
                    )}
                  </div>
                ))
              ) : (
                jobs.map(job => (
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
                ))
              )}
            </>
          )}
        </div>
      )}

      {activeTab === 'gallery' && (
        <div className="space-y-6">
          <div className="flex justify-between items-center mb-4">
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
              <button 
                onClick={() => {
                  setCreateGroupType('image');
                  setShowCreateGroupModal(true);
                }} 
                className="px-4 py-2 text-sm font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition shadow-sm flex items-center gap-1.5"
              >
                <FolderPlus size={16} /> 新建图组
              </button>
              <button 
                onClick={() => {
                  const allIds: (number | 'unassigned')[] = [...assetGroups.map(g => g.id), 'unassigned'];
                  setExpandedGroups(new Set(allIds));
                }}
                className="px-3 py-2 text-sm font-medium bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-700 transition shadow-sm flex items-center gap-1.5"
                title="一键展开所有图组列表"
              >
                <ChevronDown size={16} className="text-gray-500" /> 全部展开
              </button>
              <button 
                onClick={() => {
                  setExpandedGroups(new Set());
                }}
                className="px-3 py-2 text-sm font-medium bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-700 transition shadow-sm flex items-center gap-1.5"
                title="一键折叠所有图组列表"
              >
                <ChevronUp size={16} className="text-gray-500" /> 全部折叠
              </button>
              <button onClick={fetchGallery} className="px-4 py-2 text-sm font-medium bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition shadow-sm">刷新图库</button>
            </div>
          </div>
          
          <div className="bg-gradient-to-r from-purple-500/10 to-indigo-505/10 border border-purple-200/50 rounded-2xl px-5 py-4 text-xs text-purple-900 flex items-start gap-3 shadow-sm">
            <Sparkles size={16} className="text-purple-600 mt-0.5 shrink-0 animate-pulse" />
            <div className="space-y-1 text-left">
              <p className="font-bold text-sm text-purple-950">💡 智能相册分组粘贴与外部上传</p>
              <p className="text-purple-800 leading-relaxed">
                点击下方任何一个<strong>【相册图组】或【未分组图片】其对应头部</strong>，即可将其高亮激活设为 📌 粘贴/上传目标。随后你可以在<strong>网页任一处直接按 Ctrl+V 粘贴图片</strong>或点击上方<strong>上传控制</strong>，新存入的图片全都会被精准同步至选中的分类相册组中！
              </p>
            </div>
          </div>
          
          {/* Searchable Multi-Select Dropdown for Image Groups */}
          <div className="bg-white border border-gray-150 rounded-2xl p-5 shadow-sm space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span className="text-sm font-bold text-gray-800 flex items-center gap-1.5 select-none">
                <Folder className="w-4 h-4 text-purple-600" /> 展示分类图组范围过滤
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const allIds = assetGroups.map(g => g.id);
                    setSelectedGroupFilterIds(allIds);
                    // Also expand them
                    const newSet = new Set(expandedGroups);
                    allIds.forEach(id => newSet.add(id));
                    setExpandedGroups(newSet);
                  }}
                  className="px-2.5 py-1 text-xs font-semibold bg-purple-50 text-purple-700 rounded-lg hover:bg-purple-100 transition cursor-pointer select-none"
                >
                  全部展示
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedGroupFilterIds([])}
                  className="px-2.5 py-1 text-xs font-semibold bg-gray-50 text-gray-600 rounded-lg hover:bg-gray-100 transition cursor-pointer select-none"
                >
                  全部隐藏
                </button>
              </div>
            </div>

            <div className="relative w-full group-filter-container">
              {/* Trigger Button / Display selected tags */}
              <div
                onClick={() => setIsGroupDropdownOpen(!isGroupDropdownOpen)}
                className="w-full min-h-[44px] bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 cursor-pointer flex items-center justify-between transition hover:bg-gray-100/50 hover:border-gray-300"
              >
                <div className="flex flex-wrap gap-1.5 max-w-[90%] items-center">
                  {selectedGroupFilterIds.length === 0 ? (
                    <span className="text-xs text-gray-400 font-medium select-none flex items-center gap-1.5 py-1">
                      <FolderPlus className="w-3.5 h-3.5 text-gray-400 animate-bounce" /> 
                      点击在此选择想要显示的图组相册列表...（未选中任何其它图组，仅展示未分组图片）
                    </span>
                  ) : (
                    selectedGroupFilterIds.map(id => {
                      const grp = assetGroups.find(g => g.id === id);
                      if (!grp) return null;
                      const count = galleryImages.filter(img => img.groupId === id).length;
                      return (
                        <span 
                          key={id}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedGroupFilterIds(prev => prev.filter(x => x !== id));
                          }}
                          className="inline-flex items-center gap-1.5 bg-purple-50 text-purple-700 text-xs font-bold px-2.5 py-1 rounded-full border border-purple-100 hover:bg-red-50 hover:text-red-700 hover:border-red-100 transition-all cursor-pointer group"
                          title="点击快速移除此图组"
                        >
                          <Folder className="w-3.5 h-3.5 text-purple-500 group-hover:text-red-500" />
                          <span>{grp.name} ({count} 张)</span>
                          <X className="w-3 h-3 text-purple-400 group-hover:text-red-500 transition text-center" />
                        </span>
                      );
                    })
                  )}
                </div>
                <div className="text-gray-400 shrink-0">
                  {isGroupDropdownOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </div>
              </div>

              {/* Dropdown Menu */}
              {isGroupDropdownOpen && (
                <div className="absolute left-0 right-0 mt-1.5 bg-white rounded-xl shadow-2xl border border-gray-150 z-[1000] overflow-hidden py-1">
                  {/* Search inside Dropdown */}
                  <div className="px-3 pb-2 pt-2 border-b border-gray-100 flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                      <input
                        type="text"
                        placeholder="检索图组名称..."
                        value={groupFilterSearch}
                        onChange={(e) => setGroupFilterSearch(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-purple-500/25 transition"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                    {groupFilterSearch && (
                      <button 
                        type="button" 
                        onClick={(e) => { e.stopPropagation(); setGroupFilterSearch(''); }}
                        className="text-xs text-purple-600 hover:text-purple-800 font-bold px-2 py-1 hover:bg-purple-50 rounded"
                      >
                        清除检索
                      </button>
                    )}
                  </div>

                  {/* List of groups */}
                  <div className="max-h-60 overflow-y-auto pt-1 bg-white">
                    {(() => {
                      const filtered = assetGroups.filter(grp => 
                        grp.name.toLowerCase().includes(groupFilterSearch.toLowerCase())
                      );

                      if (filtered.length === 0) {
                        return (
                          <div className="text-center py-6 text-gray-400 text-xs font-medium select-none">
                            没有找到匹配的图组
                          </div>
                        );
                      }

                      return filtered.map(grp => {
                        const isChecked = selectedGroupFilterIds.includes(grp.id);
                        const count = galleryImages.filter(img => img.groupId === grp.id).length;
                        return (
                          <div
                            key={grp.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isChecked) {
                                setSelectedGroupFilterIds(prev => prev.filter(x => x !== grp.id));
                              } else {
                                setSelectedGroupFilterIds(prev => [...prev, grp.id]);
                                // Auto expand it so they see it
                                const newSet = new Set(expandedGroups);
                                newSet.add(grp.id);
                                setExpandedGroups(newSet);
                              }
                            }}
                            className={`px-4 py-2.5 flex items-center justify-between cursor-pointer text-xs font-medium transition-colors ${
                              isChecked ? 'bg-purple-50/40 text-purple-900 hover:bg-purple-50/70' : 'text-gray-700 hover:bg-gray-50'
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {}} // handled by div click
                                className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500 cursor-pointer pointer-events-none"
                              />
                              <Folder className={`w-4 h-4 shrink-0 ${isChecked ? 'text-purple-600' : 'text-gray-400'}`} />
                              <span className="truncate pr-2 font-semibold">{grp.name}</span>
                            </div>
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              isChecked ? 'bg-purple-100 text-purple-700' : 'bg-gray-150 text-gray-500'
                            }`}>
                              {count} 张图片
                            </span>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              )}
            </div>
          </div>
          
          <div 
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
            <div className="flex flex-col gap-6 w-full">
              {uploadingCount > 0 && (
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
                </div>
              )}
              {(() => {
                const renderGalleryItem = (imgData: GalleryAsset) => {
                  const img = imgData.path;
                  return (
                    <div key={img} className="group relative bg-white p-2 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-all">
                      <div onClick={() => !processingGalleryImages.has(img) && setViewingImage(`/downloads/${img}?t=${galleryUpdateToken}`)} className="block aspect-[9/16] overflow-hidden rounded-lg bg-gray-100 relative cursor-pointer">
                        <img src={`/api/thumbnails/downloads/${img}?t=${galleryUpdateToken}`} alt={img} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
                        
                        {/* Resolution Tag Pill */}
                        {imgData.resolutionTag && (
                          <div className={`absolute top-2 left-2 z-10 px-2 py-0.5 rounded text-[10px] font-bold text-white shadow-sm pointer-events-none uppercase tracking-wider ${
                            imgData.resolutionTag === '4K' ? 'bg-red-600/90' :
                            imgData.resolutionTag === '2K' ? 'bg-blue-600/90' :
                            'bg-gray-700/80'
                          }`}>
                            {imgData.resolutionTag}
                          </div>
                        )}

                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                          <ImageIcon className="w-8 h-8 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-md" />
                        </div>

                        {/* Beautiful selection checkbox */}
                        <div 
                          onClick={(e) => {
                            e.stopPropagation();
                            const next = new Set(selectedImages);
                            if (next.has(img)) {
                              next.delete(img);
                            } else {
                              next.add(img);
                            }
                            setSelectedImages(next);
                          }}
                          className={`absolute top-2 right-2 z-20 w-6 h-6 rounded-full flex items-center justify-center border transition-all duration-200 cursor-pointer ${
                            selectedImages.has(img)
                              ? 'bg-purple-600 border-purple-600 text-white scale-110 shadow-md shadow-purple-500/30 opacity-100'
                              : 'bg-white/80 backdrop-blur-sm border-gray-300 hover:bg-white text-transparent opacity-0 group-hover:opacity-100 scale-95 hover:scale-100'
                          }`}
                        >
                          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="4">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        </div>

                        {processingGalleryImages.has(img) && (
                          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center p-2 z-10">
                            <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mb-2"></div>
                            <span className="text-[10px] text-white font-bold">正在去水印...</span>
                          </div>
                        )}

                        {upscalingAssetIds.has(imgData.id) && (
                          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex flex-col items-center justify-center p-2 z-10">
                            <div className="w-6 h-6 border-2 border-purple-400 border-t-transparent rounded-full animate-spin mb-2 text-purple-400"></div>
                            <span className="text-[10px] text-white font-bold animate-pulse">正在超分2x...</span>
                          </div>
                        )}
                      </div>
                      <div className="mt-3 px-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-500 truncate pr-2 font-medium" title={img}>{img.split('/').pop()}</span>
                          {(() => {
                            const isBusy = processingGalleryImages.has(img) || upscalingAssetIds.has(imgData.id);
                            return (
                              <div className="flex gap-1 relative">
                                {/* 2倍超分按钮 (4K图片不可点击) */}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (!isBusy) {
                                      handleUpscaleImage(imgData);
                                    }
                                  }}
                                  disabled={isBusy || imgData.resolutionTag === '4K'}
                                  className={`p-1.5 rounded-md transition-colors ${
                                    imgData.resolutionTag === '4K' 
                                      ? 'text-gray-200 cursor-not-allowed opacity-50' 
                                      : isBusy 
                                        ? 'text-gray-300 animate-pulse' 
                                        : 'text-indigo-600 hover:bg-indigo-50'
                                  }`}
                                  title={imgData.resolutionTag === '4K' ? "4K图片已是最高画质" : "2倍高清超分"}
                                >
                                  <Sparkles className="w-4 h-4" />
                                </button>

                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (!isBusy) {
                                      setEditingGalleryImage({ filename: img, url: `/downloads/${img}?t=${galleryUpdateToken}` });
                                    }
                                  }}
                                  disabled={isBusy}
                                  className={`p-1.5 rounded-md transition-colors ${isBusy ? 'text-gray-300' : 'text-purple-500 hover:bg-purple-50'}`}
                                  title="智能填充 (手动去水印)"
                                >
                                  <Paintbrush className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (!isBusy) {
                                      handleOneClickWatermark(img);
                                    }
                                  }}
                                  disabled={isBusy}
                                  className={`p-1.5 rounded-md transition-colors ${isBusy ? 'text-gray-300' : 'text-blue-500 hover:bg-blue-50'}`}
                                  title="一键去水印"
                                >
                                  <Scissors className="w-4 h-4" />
                                </button>
                                
                                {/* 移动至相册/图组菜单 */}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (!isBusy) {
                                      setMovingAssetPath(movingAssetPath === img ? null : img);
                                    }
                                  }}
                                  disabled={isBusy}
                                  className={`p-1.5 rounded-md transition-colors relative ${movingAssetPath === img ? 'text-purple-700 bg-purple-100' : 'text-amber-600 hover:bg-amber-50'}`}
                                  title="移动到图组"
                                >
                                  <Folder className="w-4 h-4" />
                                  
                                  {movingAssetPath === img && (
                                    <div 
                                      className="absolute right-0 bottom-full mb-2 w-48 bg-white rounded-xl shadow-2xl border border-gray-200 z-50 overflow-hidden py-1 text-left" 
                                      onClick={e => e.stopPropagation()}
                                    >
                                      <div className="px-3 py-1.5 text-[10px] font-bold text-gray-400 border-b border-gray-100 uppercase bg-gray-50 flex items-center gap-1">
                                        <Folder size={10} /> 移动至图组...
                                      </div>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handleMoveToGroup(img, null); }}
                                        className={`w-full text-left px-3 py-2 text-xs font-medium transition flex items-center gap-1.5 ${!imgData.groupId ? 'text-purple-600 bg-purple-50 font-bold' : 'text-gray-600 hover:bg-purple-50'}`}
                                      >
                                        <Folder size={12} className={!imgData.groupId ? "text-purple-600" : "text-gray-400"} /> 未分组 (默认)
                                      </button>
                                      {assetGroups.map(grp => (
                                        <button
                                          key={grp.id}
                                          onClick={(e) => { e.stopPropagation(); handleMoveToGroup(img, grp.id); }}
                                          className={`w-full text-left px-3 py-2 text-xs font-medium transition flex items-center gap-1.5 truncate ${imgData.groupId === grp.id ? 'text-purple-600 bg-purple-50 font-bold' : 'text-gray-600 hover:bg-purple-50'}`}
                                          title={grp.name}
                                        >
                                          <Folder size={12} className={imgData.groupId === grp.id ? "text-purple-600" : "text-gray-400"} /> {grp.name}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </button>

                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (!isBusy) {
                                      deleteGalleryImage(img);
                                    }
                                  }}
                                  disabled={isBusy}
                                  className={`p-1.5 rounded-md transition-colors ${isBusy ? 'text-gray-300' : 'text-red-500 hover:bg-red-50'}`}
                                  title="彻底删除源文件"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            );
                          })()}
                        </div>
                        {imgData.createdAt && (
                          <div className="flex items-center justify-between gap-1 mt-1 text-[10px] text-gray-400 font-medium">
                            <div className="flex items-center gap-1">
                              <Clock size={10} />
                              {(() => {
                                const d = new Date(imgData.createdAt.endsWith('Z') ? imgData.createdAt : imgData.createdAt.replace(' ', 'T') + 'Z');
                                return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                              })()}
                            </div>
                            {user?.role === 'admin' && imgData.username && (
                              <span className="text-[9px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded font-bold">
                                👤 {imgData.username}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                };

                return (
                  <div className="flex flex-col gap-6 w-full">
                    {/* 1. Unassigned default gallery (ALWAYS PINNED TO TOP) */}
                    {(() => {
                      const unassignedImages = galleryImages.filter(img => !img.groupId);
                      const isUnassignedCollapsed = !expandedGroups.has('unassigned');
                      
                      return (
                        <div 
                          className={`bg-white border rounded-2xl shadow-sm overflow-hidden transition-all duration-200 ${
                            selectedUploadGroupId === null 
                              ? 'ring-2 ring-blue-500 border-blue-500' 
                              : 'border-gray-200'
                          }`}
                        >
                          <div 
                            onClick={() => {
                              setSelectedUploadGroupId(null);
                              const newSet = new Set(expandedGroups);
                              newSet.add('unassigned');
                              setExpandedGroups(newSet);
                            }}
                            className={`px-6 py-4 flex justify-between items-center border-b cursor-pointer transition-all duration-200 ${
                              selectedUploadGroupId === null 
                                ? 'bg-blue-50/60 border-blue-100' 
                                : 'bg-gray-50 border-gray-100 hover:bg-gray-100/60'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <ImageIcon className={`w-5 h-5 ${selectedUploadGroupId === null ? 'text-blue-600' : 'text-gray-400'}`} />
                              <span className="text-base font-bold text-gray-800">未分组图片</span>
                              <span className="bg-blue-100 text-blue-700 text-xs px-2.5 py-0.5 rounded-full font-semibold">
                                {unassignedImages.length} 张图片
                              </span>
                              {selectedUploadGroupId === null && (
                                <span className="flex items-center gap-1 bg-blue-600 text-white text-[11px] px-2.5 py-0.5 rounded-full font-bold animate-pulse shadow-sm shadow-blue-500/20">
                                  📌 当前粘贴/上传目标 (默认)
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-4" onClick={e => e.stopPropagation()}>
                              <div 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const newSet = new Set(expandedGroups);
                                  if (newSet.has('unassigned')) {
                                    newSet.delete('unassigned');
                                  } else {
                                    newSet.add('unassigned');
                                  }
                                  setExpandedGroups(newSet);
                                }}
                                className="text-gray-400 hover:text-gray-600 cursor-pointer"
                              >
                                {isUnassignedCollapsed ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
                              </div>
                            </div>
                          </div>
                          
                          {!isUnassignedCollapsed && (
                            <div className="p-4 bg-gray-50/10">
                              {unassignedImages.length === 0 ? (
                                <div className="text-center py-12 text-gray-400 text-sm">
                                  各张图片均已划分至相对应的图组相册中，点击上方图组头部可随时切回各组或未分组
                                </div>
                              ) : (() => {
                                const limit = imageGroupLimits['unassigned'] || 20;
                                const sliced = unassignedImages.slice(0, limit);
                                return (
                                  <>
                                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                                      {sliced.map(renderGalleryItem)}
                                    </div>
                                    {unassignedImages.length > limit && (
                                      <div className="flex justify-center mt-6">
                                        <button
                                          onClick={() => {
                                            setImageGroupLimits(prev => ({
                                              ...prev,
                                              unassigned: limit + 40
                                            }));
                                          }}
                                          className="px-6 py-2 bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 text-xs font-semibold rounded-xl transition shadow-sm hover:shadow flex items-center gap-1.5 cursor-pointer"
                                        >
                                          <span>加载更多图片 (还有 {unassignedImages.length - limit} 张)</span>
                                          <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                                        </button>
                                      </div>
                                    )}
                                  </>
                                );
                              })()}
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* 2. Custom groups (ONLY SHOW DIRECTLY SELECTED ONES) */}
                    {assetGroups
                      .filter(grp => selectedGroupFilterIds.includes(grp.id))
                      .map(grp => {
                        const grpImages = galleryImages.filter(img => img.groupId === grp.id);
                        const isCollapsed = !expandedGroups.has(grp.id);
                        const isSelected = selectedUploadGroupId === grp.id;
                        
                        return (
                          <div 
                            key={grp.id} 
                            className={`bg-white border rounded-2xl shadow-sm overflow-hidden transition-all duration-200 ${
                              isSelected 
                                ? 'ring-2 ring-purple-500 border-purple-500' 
                                : 'border-gray-200'
                            }`}
                          >
                            {/* Group Header */}
                            <div 
                              onClick={() => {
                                setSelectedUploadGroupId(grp.id);
                                const newSet = new Set(expandedGroups);
                                newSet.add(grp.id);
                                setExpandedGroups(newSet);
                              }}
                              className={`px-6 py-4 cursor-pointer flex justify-between items-center border-b transition-all duration-200 ${
                                isSelected 
                                  ? 'bg-purple-50/80 border-purple-100' 
                                  : 'bg-purple-50/10 border-gray-100 hover:bg-purple-50/40'
                              }`}
                            >
                              <div className="flex items-center gap-3">
                                <Folder className={`w-5 h-5 ${isSelected ? 'text-purple-600' : 'text-gray-400'}`} />
                                <span className="text-base font-bold text-gray-800">{grp.name}</span>
                                <span className="bg-purple-100 text-purple-700 text-xs px-2.5 py-0.5 rounded-full font-semibold">{grpImages.length} 张图片</span>
                                {isSelected && (
                                  <span className="flex items-center gap-1 bg-purple-600 text-white text-[11px] px-2.5 py-0.5 rounded-full font-bold animate-pulse shadow-sm shadow-purple-500/20">
                                    📌 当前粘贴/上传目标
                                  </span>
                                )}
                              </div>
                              
                              <div className="flex items-center gap-4" onClick={e => e.stopPropagation()}>
                                <button
                                  onClick={() => handleRenameGroup(grp.id, grp.name)}
                                  className="p-1.5 rounded-md text-amber-500 hover:bg-amber-50 transition-colors cursor-pointer"
                                  title="修改组名"
                                >
                                  <Edit2 size={16} />
                                </button>
                                <button
                                  onClick={() => handleDeleteGroup(grp.id)}
                                  disabled={grpImages.length > 0}
                                  className={`p-1.5 rounded-md transition-colors ${grpImages.length > 0 ? 'text-gray-400 opacity-40 cursor-not-allowed' : 'text-red-500 hover:bg-red-50'}`}
                                  title={grpImages.length > 0 ? '图组存在图片时不支持删除' : '删除图组'}
                                >
                                  <Trash2 size={16} />
                                </button>
                                <div 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const newSet = new Set(expandedGroups);
                                    if (newSet.has(grp.id)) {
                                      newSet.delete(grp.id);
                                    } else {
                                      newSet.add(grp.id);
                                    }
                                    setExpandedGroups(newSet);
                                  }}
                                  className="text-gray-400 hover:text-gray-600 cursor-pointer"
                                >
                                  {isCollapsed ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
                                </div>
                              </div>
                            </div>
                            
                            {/* Group Body */}
                            {!isCollapsed && (
                              <div className="p-4 bg-gray-50/30">
                                {grpImages.length === 0 ? (
                                  <div className="text-center py-8 text-gray-400 text-xs flex flex-col items-center justify-center gap-1">
                                    <Folder className="w-8 h-8 text-gray-200 animate-pulse" />
                                    <span>当前图组暂无图片，点击该组头部设为目标，即可直接 Ctrl+V 粘贴/上传新图至本组</span>
                                  </div>
                                ) : (() => {
                                  const limit = imageGroupLimits[String(grp.id)] || 20;
                                  const sliced = grpImages.slice(0, limit);
                                  return (
                                    <>
                                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                                        {sliced.map(renderGalleryItem)}
                                      </div>
                                      {grpImages.length > limit && (
                                        <div className="flex justify-center mt-6">
                                          <button
                                            onClick={() => {
                                              setImageGroupLimits(prev => ({
                                                ...prev,
                                                [String(grp.id)]: limit + 40
                                              }));
                                            }}
                                            className="px-6 py-2 bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 text-xs font-semibold rounded-xl transition shadow-sm hover:shadow flex items-center gap-1.5 cursor-pointer"
                                          >
                                            <span>加载更多图片 (还有 {grpImages.length - limit} 张)</span>
                                            <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                                          </button>
                                        </div>
                                      )}
                                    </>
                                  );
                                })()}
                              </div>
                            )}
                          </div>
                        );
                      })}

                    {/* Notification if some groups are hidden */}
                    {selectedGroupFilterIds.length === 0 && assetGroups.length > 0 && (
                      <div className="text-center py-10 bg-gray-50/50 border border-dashed border-gray-200 rounded-2xl text-gray-400 text-xs shadow-sm">
                        <Folder className="w-8 h-8 text-gray-250 mx-auto mb-2 animate-pulse" />
                        <span>已折叠并隐藏所有相册图组。请在上方输入或点击【选择相册图组范围】多选框选择想要展示哪些相册。</span>
                      </div>
                    )}
                  </div>
                );
              })()}
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
          
          {sortedVideoJobs.length === 0 && submittingVideoJobs.length === 0 ? (
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
              {user?.role === 'admin' ? Object.entries(groupByUser(sortedVideoJobs)).map(([uname, jobs]: [string, any[]]) => (
                <div key={uname} className="mb-6 bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
                  <div 
                    onClick={() => toggleUserExpand(uname + '_video')}
                    className="bg-gray-50 px-6 py-4 cursor-pointer flex justify-between items-center border-b border-gray-200 hover:bg-gray-100 transition"
                  >
                    <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                      <span>👤 {uname}</span>
                      <span className="bg-blue-100 text-blue-700 text-xs px-2 py-1 rounded-full font-bold">{jobs.length} 条记录</span>
                    </h3>
                    {expandedUsers.has(uname + '_video') ? <ChevronUp size={20} className="text-gray-500" /> : <ChevronDown size={20} className="text-gray-500" />}
                  </div>
                  {expandedUsers.has(uname + '_video') && (
                    <div className="p-4 space-y-4 bg-gray-50/50">
                      {jobs.map((job: any) => (
                        <div key={job.id} className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all">
                          <div className="flex flex-col sm:flex-row gap-5">
                            {/* Cover Thumbnail */}
                            <div className="relative aspect-[3/4] w-full sm:w-28 bg-gray-950 rounded-xl overflow-hidden shadow-md shrink-0 flex items-center justify-center group/thumb">
                              {getJobCoverSrc(job) ? (
                                <img 
                                  src={getJobCoverSrc(job)} 
                                  alt="视频封面" 
                                  className="w-full h-full object-cover transition-transform duration-300 group-hover/thumb:scale-105"
                                  onError={() => {
                                    setVideoThumbErrors(prev => ({ ...prev, [job.id]: true }));
                                  }}
                                  loading="lazy"
                                />
                              ) : (
                                <Film className="w-10 h-10 text-gray-750" />
                              )}
                              
                              {(job.status === 'running' || job.status === 'client_rendering') && (
                                <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center text-white gap-1.5 p-2">
                                  <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                  <span className="text-[10px] font-bold tracking-wider">{job.progress}%</span>
                                </div>
                              )}
                              
                              {job.status === 'completed' && (
                                <div 
                                  onClick={() => {
                                    let videoPath = job.resultFiles?.[0] || job.data?.outputVideo;
                                    if (videoPath && !videoPath.startsWith('/')) videoPath = `/downloads/videos/${videoPath}`;
                                    setViewingVideo(videoPath);
                                  }}
                                  className="absolute inset-0 bg-black/30 opacity-0 group-hover/thumb:opacity-100 flex items-center justify-center cursor-pointer transition-opacity duration-200"
                                >
                                  <PlayCircle size={32} className="text-white drop-shadow" />
                                </div>
                              )}
                              
                              <div className="absolute bottom-1.5 right-1.5 bg-black/75 px-1.5 py-0.5 rounded text-[10px] text-white font-medium">
                                {job.data?.storyboards?.length || 0}P
                              </div>
                            </div>

                            {/* Info */}
                            <div className="flex-grow flex flex-col justify-between">
                              <div>
                                <div className="flex justify-between items-start mb-2 gap-2">
                                  <div className="flex items-center gap-3 flex-wrap">
                                    <span className="font-bold text-gray-900 text-base sm:text-lg">{new Date(job.timestamp).toLocaleString()}</span>
                                    <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold ${
                                      job.status === 'completed' ? 'bg-green-100 text-green-700' : 
                                      job.status === 'client_rendering' ? 'bg-indigo-100 text-indigo-700 border border-indigo-200 shadow-sm animate-pulse' : 
                                      job.status === 'running' ? 'bg-blue-100 text-blue-700' : 
                                      job.status === 'error' ? 'bg-red-100 text-red-700' :
                                      'bg-yellow-100 text-yellow-700'
                                    }`}>
                                      {job.status === 'completed' && <CheckCircle2 size={14} />}
                                      {job.status === 'client_rendering' && <Cpu size={14} className="animate-spin" />}
                                      {job.status === 'running' && <PlayCircle size={14} className="animate-pulse" />}
                                      {job.status === 'pending' && <Clock size={14} />}
                                      {job.status === 'error' && <X size={14} />}
                                      {job.status === 'completed' ? '已完成' : job.status === 'client_rendering' ? '本地压制中' : job.status === 'running' ? '渲染中' : job.status === 'error' ? '失败' : '待执行'}
                                    </span>
                                  </div>
                                  
                                  <button 
                                    onClick={async () => {
                                      if (confirm('确定要删除这条视频渲染记录吗？')) {
                                        try {
                                          // Optimistically filter from state to instantly refresh UI and prevent reinstatement
                                          setVideoJobs(prev => prev.filter(j => j.id !== job.id));
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

                                {job.data?.xhsTitle && (
                                  <p className="text-sm font-bold text-gray-800 mb-1 line-clamp-1">标题: {job.data.xhsTitle}</p>
                                )}
                                {job.data?.bgm && (
                                  <p className="text-xs text-gray-500 flex items-center gap-1 mb-2">
                                    <Music size={12} /> BGM: {job.data.bgm}
                                  </p>
                                )}

                                {(job.status === 'running' || job.status === 'client_rendering') && (
                                  <div className="mb-3">
                                    <div className="w-full bg-gray-150 rounded-full h-2 mb-1.5 overflow-hidden border border-gray-200">
                                      <div className="bg-blue-500 h-full transition-all duration-300 relative" style={{ width: `${job.progress}%` }}>
                                        <div className="absolute inset-0 bg-white/20 animate-[shimmer_1s_infinite] w-full"></div>
                                      </div>
                                    </div>
                                    {job.statusMessage && (
                                      <p className="text-[10px] text-blue-600 font-mono flex items-center gap-1 animate-fade-in">
                                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500 animate-ping"></span>
                                        {job.statusMessage}
                                      </p>
                                    )}
                                  </div>
                                )}

                                {job.status === 'error' && (
                                  <div className="text-red-500 text-xs mb-3 bg-red-50 p-2.5 rounded-lg border border-red-100 flex items-center gap-1.5">
                                    <X size={14} />
                                    <span>视频渲染失败</span>{job.statusMessage && <span className="block text-[10px] text-red-600 font-mono mt-1 break-all whitespace-pre-wrap">{job.statusMessage}</span>}
                                  </div>
                                )}
                              </div>

                              <div className="flex justify-between items-center mt-3 pt-3 border-t border-gray-100">
                                <span className="text-xs text-gray-500">ID: {job.id.substring(11)}</span>
                                <div className="flex gap-3">
                                  <button 
                                    onClick={() => setViewingVideoJobDetails(job)}
                                    className="text-xs font-bold text-gray-600 hover:text-blue-600 bg-gray-50 hover:bg-blue-50 border border-gray-200 hover:border-blue-200 px-3 py-1.5 rounded-lg transition-all"
                                  >
                                    查看详情
                                  </button>
                                  
                                  {((job.status === 'completed' && job.data?.outputVideo) || (job.status === 'completed' && job.resultFiles && job.resultFiles.length > 0)) && (
                                    <>
                                      <button 
                                        onClick={() => {
                                          let videoPath = job.resultFiles?.[0] || job.data?.outputVideo;
                                          if (videoPath && !videoPath.startsWith('/')) videoPath = `/downloads/videos/${videoPath}`;
                                          setViewingVideo(videoPath);
                                        }}
                                        className="flex items-center gap-1 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-xs font-bold hover:bg-blue-100 transition border border-blue-100"
                                      >
                                        <PlayCircle size={14}/> 预览视频
                                      </button>
                                      <a 
                                        href={(() => {
                                          const rawPath = job.resultFiles?.[0] || job.data?.outputVideo || '';
                                          const cleanPath = rawPath.startsWith('/downloads/videos/') 
                                            ? rawPath.substring('/downloads/videos/'.length) 
                                            : rawPath;
                                          return `/api/video/download-apple?videoPath=${encodeURIComponent(cleanPath)}`;
                                        })()} 
                                        download
                                        className="flex items-center gap-1 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-bold hover:bg-emerald-100 transition border border-emerald-100"
                                      >
                                        <Download size={14}/> 下载视频
                                      </a>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )) : sortedVideoJobs.map(job => (
                <div key={job.id} className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all">
                  <div className="flex flex-col sm:flex-row gap-5">
                    {/* Cover Thumbnail */}
                    <div className="relative aspect-[3/4] w-full sm:w-28 bg-gray-950 rounded-xl overflow-hidden shadow-md shrink-0 flex items-center justify-center group/thumb">
                      {getJobCoverSrc(job) ? (
                        <img 
                          src={getJobCoverSrc(job)} 
                          alt="视频封面" 
                          className="w-full h-full object-cover transition-transform duration-300 group-hover/thumb:scale-105"
                          onError={() => {
                            setVideoThumbErrors(prev => ({ ...prev, [job.id]: true }));
                          }}
                          loading="lazy"
                        />
                      ) : (
                        <Film className="w-10 h-10 text-gray-750" />
                      )}
                      
                      {(job.status === 'running' || job.status === 'client_rendering') && (
                        <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center text-white gap-1.5 p-2">
                          <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                          <span className="text-[10px] font-bold tracking-wider">{job.progress}%</span>
                        </div>
                      )}
                      
                      {job.status === 'completed' && (
                        <div 
                          onClick={() => {
                            let videoPath = job.resultFiles?.[0] || job.data?.outputVideo;
                            if (videoPath && !videoPath.startsWith('/')) videoPath = `/downloads/videos/${videoPath}`;
                            setViewingVideo(videoPath);
                          }}
                          className="absolute inset-0 bg-black/30 opacity-0 group-hover/thumb:opacity-100 flex items-center justify-center cursor-pointer transition-opacity duration-200"
                        >
                          <PlayCircle size={32} className="text-white drop-shadow" />
                        </div>
                      )}
                      
                      <div className="absolute bottom-1.5 right-1.5 bg-black/75 px-1.5 py-0.5 rounded text-[10px] text-white font-medium">
                        {job.data?.storyboards?.length || 0}P
                      </div>
                    </div>

                    {/* Info */}
                    <div className="flex-grow flex flex-col justify-between">
                      <div>
                        <div className="flex justify-between items-start mb-2 gap-2">
                          <div className="flex items-center gap-3 flex-wrap">
                            <span className="font-bold text-gray-900 text-base sm:text-lg">{new Date(job.timestamp).toLocaleString()}</span>
                            <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold ${
                              job.status === 'completed' ? 'bg-green-100 text-green-700' : 
                              job.status === 'client_rendering' ? 'bg-indigo-100 text-indigo-700 border border-indigo-200 shadow-sm animate-pulse' : 
                              job.status === 'running' ? 'bg-blue-100 text-blue-700' : 
                              job.status === 'error' ? 'bg-red-100 text-red-700' :
                              'bg-yellow-100 text-yellow-700'
                            }`}>
                              {job.status === 'completed' && <CheckCircle2 size={14} />}
                              {job.status === 'client_rendering' && <Cpu size={14} className="animate-spin" />}
                              {job.status === 'running' && <PlayCircle size={14} className="animate-pulse" />}
                              {job.status === 'pending' && <Clock size={14} />}
                              {job.status === 'error' && <X size={14} />}
                              {job.status === 'completed' ? '已完成' : job.status === 'client_rendering' ? '本地压制中' : job.status === 'running' ? '渲染中' : job.status === 'error' ? '失败' : '待执行'}
                            </span>
                          </div>
                          
                          <button 
                            onClick={async () => {
                              if (confirm('确定要删除这条视频渲染记录吗？')) {
                                try {
                                  // Optimistically filter from state to instantly refresh UI and prevent reinstatement
                                  setVideoJobs(prev => prev.filter(j => j.id !== job.id));
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

                        {job.data?.xhsTitle && (
                          <p className="text-sm font-bold text-gray-800 mb-1 line-clamp-1">标题: {job.data.xhsTitle}</p>
                        )}
                        {job.data?.bgm && (
                          <p className="text-xs text-gray-500 flex items-center gap-1 mb-2">
                            <Music size={12} /> BGM: {job.data.bgm}
                          </p>
                        )}

                        {(job.status === 'running' || job.status === 'client_rendering') && (
                          <div className="mb-3">
                            <div className="w-full bg-gray-150 rounded-full h-2 mb-1.5 overflow-hidden border border-gray-200">
                              <div className="bg-blue-500 h-full transition-all duration-300 relative" style={{ width: `${job.progress}%` }}>
                                <div className="absolute inset-0 bg-white/20 animate-[shimmer_1s_infinite] w-full"></div>
                              </div>
                            </div>
                            {job.statusMessage && (
                              <p className="text-[10px] text-blue-600 font-mono flex items-center gap-1 animate-fade-in">
                                <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500 animate-ping"></span>
                                {job.statusMessage}
                              </p>
                            )}
                          </div>
                        )}

                        {job.status === 'error' && (
                          <div className="text-red-500 text-xs mb-3 bg-red-50 p-2.5 rounded-lg border border-red-100 flex items-center gap-1.5">
                            <X size={14} />
                            <span>视频渲染失败</span>{job.statusMessage && <span className="block text-[10px] text-red-600 font-mono mt-1 break-all whitespace-pre-wrap">{job.statusMessage}</span>}
                          </div>
                        )}
                      </div>

                      <div className="flex justify-between items-center mt-3 pt-3 border-t border-gray-100">
                        <span className="text-xs text-gray-500">ID: {job.id.substring(11)}</span>
                        <div className="flex gap-3">
                          <button 
                            onClick={() => setViewingVideoJobDetails(job)}
                            className="text-xs font-bold text-gray-600 hover:text-blue-600 bg-gray-50 hover:bg-blue-50 border border-gray-200 hover:border-blue-200 px-3 py-1.5 rounded-lg transition-all"
                          >
                            查看详情
                          </button>
                          
                          {((job.status === 'completed' && job.data?.outputVideo) || (job.status === 'completed' && job.resultFiles && job.resultFiles.length > 0)) && (
                            <>
                              <button 
                                onClick={() => {
                                  let videoPath = job.resultFiles?.[0] || job.data?.outputVideo;
                                  if (videoPath && !videoPath.startsWith('/')) videoPath = `/downloads/videos/${videoPath}`;
                                  setViewingVideo(videoPath);
                                }}
                                className="flex items-center gap-1 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-xs font-bold hover:bg-blue-100 transition border border-blue-100"
                              >
                                <PlayCircle size={14}/> 预览视频
                              </button>
                              <a 
                                href={(() => {
                                  const rawPath = job.resultFiles?.[0] || job.data?.outputVideo || '';
                                  const cleanPath = rawPath.startsWith('/downloads/videos/') 
                                    ? rawPath.substring('/downloads/videos/'.length) 
                                    : rawPath;
                                  return `/api/video/download-apple?videoPath=${encodeURIComponent(cleanPath)}`;
                                })()} 
                                download
                                className="flex items-center gap-1 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-bold hover:bg-emerald-100 transition border border-emerald-100"
                              >
                                <Download size={14}/> 下载视频
                              </a>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'video_gallery' && (
        <div 
          className="space-y-6 relative"
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOverVideo(true);
          }}
          onDragLeave={() => setIsDragOverVideo(false)}
          onDrop={async (e) => {
            e.preventDefault();
            setIsDragOverVideo(false);
            const files = Array.from(e.dataTransfer.files) as File[];
            const videoFile = files.find(f => f.type.startsWith('video/'));
            if (videoFile) {
              await uploadVideoFile(videoFile, selectedVideoUploadGroupId);
            } else {
              alert('拖放的文件不是有效的视频文件');
            }
          }}
        >
          {isDragOverVideo && (
            <div className="absolute inset-0 bg-blue-50/85 backdrop-blur-sm border-4 border-dashed border-blue-500 rounded-2xl flex flex-col items-center justify-center z-50 pointer-events-none animate-fade-in">
              <Upload className="w-16 h-16 text-blue-600 animate-bounce mb-3" />
              <p className="text-xl font-bold text-blue-800">松开鼠标即可上传视频</p>
              <p className="text-sm text-blue-600 mt-1">
                目标：{selectedVideoUploadGroupId === null ? '未分类视频' : assetGroups.find(g => g.id === selectedVideoUploadGroupId)?.name || '未分类视频'}
              </p>
            </div>
          )}

          <input 
            type="file" 
            onChange={handleVideoFileChange} 
            className="hidden" 
            ref={videoFileInputRef} 
            accept="video/*" 
          />

          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
              <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                <Film className="text-blue-600"/> 本地视频库
              </h2>
              <div className="flex flex-wrap gap-2 items-center">
                <div className="relative video-upload-menu-container">
                  <button 
                    onClick={() => setShowVideoUploadMenu(!showVideoUploadMenu)}
                    className="px-4 py-2 text-sm font-medium bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg hover:from-blue-700 hover:to-indigo-700 transition shadow-sm flex items-center gap-1.5 cursor-pointer"
                  >
                    <Upload size={16} /> 上传 / 粘贴视频
                  </button>
                  {showVideoUploadMenu && (
                    <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-xl shadow-2xl border border-gray-150 z-[1100] overflow-hidden py-1 text-left">
                      <div className="px-4 py-2 text-xs font-bold text-gray-400 uppercase tracking-wider bg-gray-50 border-b border-gray-100 mb-1">视频库上传与粘贴</div>
                      <button 
                        onClick={() => {
                          videoFileInputRef.current?.click();
                          setShowVideoUploadMenu(false);
                        }}
                        className="w-full text-left px-4 py-3 text-sm font-medium text-gray-700 hover:bg-blue-50 hover:text-blue-600 transition flex items-center gap-3 cursor-pointer"
                      >
                        <Upload size={18} className="text-gray-400" /> 选择本地视频文件
                      </button>
                      <button 
                        onClick={() => {
                          setShowVideoUrlModal(true);
                          setShowVideoUploadMenu(false);
                        }}
                        className="w-full text-left px-4 py-3 text-sm font-medium text-gray-700 hover:bg-blue-50 hover:text-blue-600 transition flex items-center gap-3 cursor-pointer"
                      >
                        <Link size={18} className="text-gray-400" /> 导入视频 URL 链接
                      </button>
                      <div className="px-4 py-2 text-[11px] text-gray-500 border-t border-gray-100 bg-gray-50/50 mt-1 leading-relaxed">
                        💡 提示：也可以在视频库页面直接按 <b>Ctrl+V</b> 粘贴剪贴板中的视频文件或视频网址
                      </div>
                    </div>
                  )}
                </div>

                <button 
                  onClick={() => {
                    setCreateGroupType('video');
                    setShowCreateGroupModal(true);
                  }}
                  className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition shadow-sm flex items-center gap-1.5 cursor-pointer"
                >
                  <FolderPlus size={16} /> 新建视频组
                </button>
                <button 
                  onClick={() => {
                    const allIds: (number | 'unassigned')[] = [...assetGroups.filter(g => g.type === 'video').map(g => g.id), 'unassigned'];
                    setExpandedVideoGroups(new Set(allIds));
                  }}
                  className="px-3 py-2 text-sm font-medium bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-700 transition shadow-sm flex items-center gap-1.5 cursor-pointer"
                  title="一键展开所有视频组列表"
                >
                  <ChevronDown size={16} className="text-gray-500" /> 全部展开
                </button>
                <button 
                  onClick={() => {
                    setExpandedVideoGroups(new Set());
                  }}
                  className="px-3 py-2 text-sm font-medium bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-700 transition shadow-sm flex items-center gap-1.5 cursor-pointer"
                  title="一键折叠所有视频组列表"
                >
                  <ChevronUp size={16} className="text-gray-500" /> 全部折叠
                </button>
                <button 
                  onClick={fetchVideoGallery} 
                  className="px-4 py-2 text-sm font-medium bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition shadow-sm cursor-pointer"
                >
                  刷新视频库
                </button>
                <button 
                  onClick={() => {
                    setIsBatchSelectMode(!isBatchSelectMode);
                    setSelectedVideoPaths([]);
                  }}
                  className={`px-4 py-2 text-sm font-medium rounded-lg transition shadow-sm flex items-center gap-1.5 cursor-pointer ${
                    isBatchSelectMode 
                      ? 'bg-purple-600 text-white hover:bg-purple-700' 
                      : 'bg-white border border-gray-200 text-purple-700 hover:bg-purple-50 hover:border-purple-200'
                  }`}
                  title="批量选择视频打包下载笔记、封面及文案"
                >
                  <CheckSquare size={16} />
                  <span>{isBatchSelectMode ? '退出批量选择' : '批量打包笔记'}</span>
                </button>
              </div>
            </div>

            {isBatchSelectMode && (
              <div className="bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-150 rounded-2xl p-5 mb-6 flex flex-col sm:flex-row items-center justify-between gap-4 animate-fade-in shadow-inner">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-purple-100 rounded-xl text-purple-700">
                    <CheckSquare className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-purple-950">批量打包下载模式</h4>
                    <p className="text-xs text-purple-700 mt-0.5 font-medium">
                      已选择 <span className="font-black text-base px-1 text-purple-900">{selectedVideoPaths.length}</span> 个视频笔记资源（包含视频、封面及文案）
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 items-center w-full sm:w-auto justify-end">
                  <button
                    onClick={() => {
                      const visiblePaths = videoGallery.map(v => v.path);
                      setSelectedVideoPaths(visiblePaths);
                    }}
                    className="px-3.5 py-2 text-xs font-bold bg-white border border-purple-200 text-purple-800 rounded-xl hover:bg-purple-100 transition cursor-pointer shadow-sm"
                  >
                    全部选择 ({videoGallery.length})
                  </button>
                  <button
                    onClick={() => setSelectedVideoPaths([])}
                    className="px-3.5 py-2 text-xs font-bold bg-white border border-gray-200 text-gray-700 rounded-xl hover:bg-gray-100 transition cursor-pointer shadow-sm"
                  >
                    清除选择
                  </button>
                  <button
                    onClick={handleBatchDownloadXhsPackage}
                    disabled={selectedVideoPaths.length === 0 || isBatchDownloading}
                    className="px-4 py-2 text-xs font-bold bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl transition shadow-md flex items-center gap-1.5 cursor-pointer"
                  >
                    {isBatchDownloading ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        <span>打包中...</span>
                      </>
                    ) : (
                      <>
                        <Download size={14} />
                        <span>打包下载笔记资源</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Searchable Multi-Select Dropdown for Video Groups */}
            <div className="bg-white border border-gray-150 rounded-2xl p-5 shadow-sm space-y-3 mb-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <span className="text-sm font-bold text-gray-800 flex items-center gap-1.5 select-none">
                  <Folder className="w-4 h-4 text-blue-600" /> 展示分类视频组范围过滤
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const allIds = assetGroups.filter(g => g.type === 'video').map(g => g.id);
                      setSelectedVideoGroupFilterIds(allIds);
                      // Also expand them
                      const newSet = new Set(expandedVideoGroups);
                      allIds.forEach(id => newSet.add(id));
                      setExpandedVideoGroups(newSet);
                    }}
                    className="px-2.5 py-1 text-xs font-semibold bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition cursor-pointer select-none"
                  >
                    全部展示
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedVideoGroupFilterIds([])}
                    className="px-2.5 py-1 text-xs font-semibold bg-gray-50 text-gray-600 rounded-lg hover:bg-gray-100 transition cursor-pointer select-none"
                  >
                    全部隐藏
                  </button>
                </div>
              </div>

              <div className="relative w-full video-group-filter-container">
                {/* Trigger Button / Display selected tags */}
                <div
                  onClick={() => setIsVideoGroupDropdownOpen(!isVideoGroupDropdownOpen)}
                  className="w-full min-h-[44px] bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 cursor-pointer flex items-center justify-between transition hover:bg-gray-100/50 hover:border-gray-300"
                >
                  <div className="flex flex-wrap gap-1.5 max-w-[90%] items-center">
                    {selectedVideoGroupFilterIds.length === 0 ? (
                      <span className="text-xs text-gray-400 font-medium select-none flex items-center gap-1.5 py-1">
                        <FolderPlus className="w-3.5 h-3.5 text-gray-400 animate-bounce" /> 
                        点击在此选择想要显示的视频组列表...（未选中任何其它视频组，仅展示未分组视频）
                      </span>
                    ) : (
                      selectedVideoGroupFilterIds.map(id => {
                        const grp = assetGroups.find(g => g.id === id);
                        if (!grp) return null;
                        const count = videoGallery.filter(vid => vid.groupId === id).length;
                        return (
                          <span 
                            key={id}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedVideoGroupFilterIds(prev => prev.filter(x => x !== id));
                            }}
                            className="inline-flex items-center gap-1.5 bg-blue-50 text-blue-700 text-xs font-bold px-2.5 py-1 rounded-full border border-blue-100 hover:bg-red-50 hover:text-red-700 hover:border-red-100 transition-all cursor-pointer group"
                            title="点击快速移除此视频组"
                          >
                            <Folder className="w-3.5 h-3.5 text-blue-500 group-hover:text-red-500" />
                            <span>{grp.name} ({count} 个)</span>
                            <X className="w-3 h-3 text-blue-400 group-hover:text-red-500 transition text-center" />
                          </span>
                        );
                      })
                    )}
                  </div>
                  <div className="text-gray-400 shrink-0">
                    {isVideoGroupDropdownOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </div>
                </div>

                {/* Dropdown Menu */}
                {isVideoGroupDropdownOpen && (
                  <div className="absolute left-0 right-0 mt-1.5 bg-white rounded-xl shadow-2xl border border-gray-150 z-[1000] overflow-hidden py-1">
                    {/* Search inside Dropdown */}
                    <div className="px-3 pb-2 pt-2 border-b border-gray-100 flex items-center gap-2">
                      <div className="relative flex-1">
                        <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                        <input
                          type="text"
                          placeholder="检索视频组名称..."
                          value={videoGroupFilterSearch}
                          onChange={(e) => setVideoGroupFilterSearch(e.target.value)}
                          className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/25 transition"
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                      {videoGroupFilterSearch && (
                        <button 
                          type="button" 
                          onClick={(e) => { e.stopPropagation(); setVideoGroupFilterSearch(''); }}
                          className="text-xs text-blue-600 hover:text-blue-800 font-bold px-2 py-1 hover:bg-blue-50 rounded"
                        >
                          清除检索
                        </button>
                      )}
                    </div>

                    {/* List of groups */}
                    <div className="max-h-60 overflow-y-auto pt-1 bg-white">
                      {(() => {
                        const filtered = assetGroups.filter(grp => 
                          grp.type === 'video' && grp.name.toLowerCase().includes(videoGroupFilterSearch.toLowerCase())
                        );

                        if (filtered.length === 0) {
                          return (
                            <div className="text-center py-6 text-gray-400 text-xs font-medium select-none">
                              没有找到匹配的视频组
                            </div>
                          );
                        }

                        return filtered.map(grp => {
                          const isChecked = selectedVideoGroupFilterIds.includes(grp.id);
                          const count = videoGallery.filter(vid => vid.groupId === grp.id).length;
                          return (
                            <div
                              key={grp.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (isChecked) {
                                  setSelectedVideoGroupFilterIds(prev => prev.filter(x => x !== grp.id));
                                } else {
                                  setSelectedVideoGroupFilterIds(prev => [...prev, grp.id]);
                                  // Auto expand it so they see it
                                  const newSet = new Set(expandedVideoGroups);
                                  newSet.add(grp.id);
                                  setExpandedVideoGroups(newSet);
                                }
                              }}
                              className={`px-4 py-2.5 flex items-center justify-between cursor-pointer text-xs font-medium transition-colors ${
                                isChecked ? 'bg-blue-50/40 text-blue-900 hover:bg-blue-50/70' : 'text-gray-700 hover:bg-gray-50'
                              }`}
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => {}} // handled by div click
                                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer pointer-events-none"
                                />
                                <Folder className={`w-4 h-4 shrink-0 ${isChecked ? 'text-blue-600' : 'text-gray-400'}`} />
                                <span className="truncate pr-2 font-semibold">{grp.name}</span>
                              </div>
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                isChecked ? 'bg-blue-100 text-blue-700' : 'bg-gray-150 text-gray-500'
                              }`}>
                                {count} 个视频
                              </span>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Video Paste and Upload Help Banner */}
            <div className="bg-blue-50/50 border border-blue-100 rounded-2xl p-5 flex items-start gap-3.5 mb-6">
              <span className="p-2 bg-blue-100 rounded-xl text-blue-600 shrink-0">
                <Sparkles className="w-5 h-5" />
              </span>
              <div>
                <p className="font-bold text-sm text-blue-955">💡 智能视频组粘贴与外部导入</p>
                <p className="text-xs text-blue-700/80 leading-relaxed mt-1">
                  点击下方任何一个<strong>【视频组】或【未分类视频】头部</strong>，即可将其激活高亮并设定为 📌 粘贴/上传目标。随后你可以在<strong>网页任何地方直接按 Ctrl+V 粘贴视频文件或视频网址</strong>，或者直接拖拽本地视频到当前页面中，视频都会被自动存入到指定的视频分类中！
                </p>
              </div>
            </div>

            {/* Video Upload Processing Progress */}
            {videoUploading && (
              <div className="bg-blue-50 border border-blue-150 rounded-2xl p-5 mb-6 flex items-center justify-between shadow-md animate-pulse">
                <div className="flex items-center gap-3">
                  <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin shrink-0"></div>
                  <div>
                    <p className="font-bold text-sm text-blue-950">正在处理并上传您的视频...</p>
                    <p className="text-xs text-blue-600 font-mono mt-0.5">{videoUploadProgress}</p>
                  </div>
                </div>
              </div>
            )}

            {(() => {
              const renderVideoItem = (vidData: GalleryAsset) => {
                const vid = vidData.path;
                const isSelected = selectedVideoPaths.includes(vid);
                const toggleSelectVideo = (path: string) => {
                  setSelectedVideoPaths(prev => {
                    if (prev.includes(path)) {
                      return prev.filter(p => p !== path);
                    } else {
                      return [...prev, path];
                    }
                  });
                };

                return (
                  <div 
                    key={vid} 
                    className={`group relative bg-white p-2.5 rounded-xl border transition-all duration-200 flex gap-3 ${
                      isBatchSelectMode && isSelected
                        ? 'border-purple-500 ring-2 ring-purple-500/30 shadow-md'
                        : 'border-gray-200 shadow-sm hover:shadow-md'
                    }`}
                  >
                    {/* Left: Cover Image Container */}
                    <div 
                      onClick={() => {
                        if (isBatchSelectMode) {
                          toggleSelectVideo(vid);
                        } else {
                          setViewingVideo(`/downloads/videos/${vid}`);
                        }
                      }} 
                      className="w-24 sm:w-28 shrink-0 aspect-[9/16] overflow-hidden rounded-lg bg-gray-100 relative cursor-pointer shadow-inner"
                    >
                      <img 
                        src={`/api/thumbnails/videos/${vid.replace(/\.[^/.]+$/, ".jpg")}`} 
                        alt={vid} 
                        className="w-full h-full object-fill group-hover:scale-105 transition-transform duration-300 bg-gray-100" 
                        loading="lazy" 
                        onError={(e) => { e.currentTarget.style.display = 'none'; }} 
                      />
                      
                      {vidData.resolutionTag && (
                        <div className={`absolute top-1.5 left-1.5 z-10 px-1.5 py-0.5 rounded text-[9px] font-bold text-white shadow-sm pointer-events-none uppercase tracking-wider ${
                          vidData.resolutionTag.toUpperCase().includes('1080P') || vidData.resolutionTag.toUpperCase().includes('4K')
                            ? 'bg-emerald-600/90' : 'bg-blue-600/90'
                        }`}>
                          {vidData.resolutionTag}
                        </div>
                      )}

                      {/* Batch Selection Checkbox overlay */}
                      {isBatchSelectMode && (
                        <div className="absolute top-1.5 right-1.5 z-30">
                          {isSelected ? (
                            <div className="p-1 bg-purple-600 rounded-lg text-white shadow-md border border-purple-500">
                              <CheckSquare className="w-4 h-4" />
                            </div>
                          ) : (
                            <div className="p-1 bg-black/50 hover:bg-black/70 rounded-lg text-white/85 shadow-md border border-white/20">
                              <Square className="w-4 h-4" />
                            </div>
                          )}
                        </div>
                      )}
                      
                      {/* Play Icon Overlay */}
                      {!isBatchSelectMode && (
                        <div className="absolute inset-0 bg-black/10 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                          <PlayCircle className="w-9 h-9 text-white opacity-85 group-hover:opacity-100 transition-opacity drop-shadow-md" />
                        </div>
                      )}
                    </div>

                    {/* Right: Details & Operations Container */}
                    <div className="flex-1 min-w-0 flex flex-col justify-between py-1">
                      <div className="space-y-1.5">
                        <div className="text-xs font-bold text-gray-850 line-clamp-2 break-all leading-snug" title={vid}>
                          {vid.split('/').pop()}
                        </div>

                        {vidData.createdAt && (
                          <div className="flex items-center gap-1 text-[10px] text-gray-400 font-medium">
                            <Clock size={9} />
                            {(() => {
                              const d = new Date(vidData.createdAt.endsWith('Z') ? vidData.createdAt : vidData.createdAt.replace(' ', 'T') + 'Z');
                              return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                            })()}
                          </div>
                        )}

                        {/* Published Status Badge */}
                        {!isBatchSelectMode && (
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              const nextPublished = vidData.isPublished ? 0 : 1;
                              try {
                                const res = await fetch('/api/videos/toggle-published', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ videoPath: vidData.path, isPublished: nextPublished === 1 })
                                });
                                if (res.ok) {
                                  fetchVideoGallery();
                                }
                              } catch (err) {
                                console.error('Failed to toggle published status:', err);
                              }
                            }}
                            className={`inline-flex px-2 py-0.5 rounded text-[9px] font-bold items-center gap-1 transition cursor-pointer select-none border ${
                              vidData.isPublished 
                                ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100' 
                                : 'bg-gray-50 border-gray-250 text-gray-500 hover:bg-gray-100'
                            }`}
                            title={vidData.isPublished ? "已标记发布：点击标记为未发布" : "未标记发布：点击标记为已发布"}
                          >
                            <span className={`w-1 h-1 rounded-full ${vidData.isPublished ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'}`}></span>
                            <span>{vidData.isPublished ? '已发布' : '未发布'}</span>
                          </button>
                        )}
                      </div>

                      {/* Action buttons on the right of the cover image */}
                      <div className="mt-2 pt-2 border-t border-gray-100">
                        {isBatchSelectMode ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSelectVideo(vid);
                            }}
                            className={`w-full py-1.5 rounded-lg text-[10px] font-bold cursor-pointer transition select-none flex items-center justify-center gap-1 border ${
                              isSelected
                                ? 'bg-purple-100 text-purple-700 border-purple-200'
                                : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-purple-50 hover:text-purple-650 hover:border-purple-200'
                            }`}
                          >
                            {isSelected ? (
                              <>
                                <CheckSquare size={12} />
                                <span>已选定打包</span>
                              </>
                            ) : (
                              <>
                                <Square size={12} />
                                <span>选择打包</span>
                              </>
                            )}
                          </button>
                        ) : (
                          <div className="flex flex-wrap gap-1 items-center relative">
                            <button
                              onClick={() => {
                                fetchGallery();
                                setViewingXhsNotes({ videoId: vidData.path, jobId: vidData.jobId, taskData: vidData.taskData || {} as VideoTask });
                              }}
                              className="p-1.5 text-red-500 hover:bg-red-50 hover:text-red-650 rounded-md transition-colors"
                              title="小红书配置"
                            >
                              <Target className="w-4 h-4" />
                            </button>

                            <button
                              onClick={() => {
                                setCroppingVideo(vidData);
                              }}
                              className="p-1.5 text-blue-600 hover:bg-blue-50 hover:text-blue-700 rounded-md transition-colors animate-fade-in"
                              title="裁剪视频"
                            >
                              <Crop className="w-4 h-4" />
                            </button>

                            <button
                              onClick={() => {
                                setChangingBgmVideo(vidData);
                              }}
                              className="p-1.5 text-purple-600 hover:bg-purple-50 hover:text-purple-700 rounded-md transition-colors animate-fade-in"
                              title="更换背景音乐"
                            >
                              <Music className="w-4 h-4" />
                            </button>
                            
                            {/* Move to video group */}
                            <div className="relative">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setMovingAssetPath(movingAssetPath === vid ? null : vid);
                                }}
                                className={`p-1.5 rounded-md transition-colors relative ${movingAssetPath === vid ? 'text-blue-700 bg-blue-100' : 'text-amber-650 hover:bg-amber-50'}`}
                                title="移动到视频组"
                              >
                                <Folder className="w-4 h-4" />
                              </button>

                              {movingAssetPath === vid && (
                                <div 
                                  className="absolute right-0 bottom-full mb-2 w-48 bg-white rounded-xl shadow-2xl border border-gray-200 z-50 overflow-hidden py-1 text-left" 
                                  onClick={e => e.stopPropagation()}
                                >
                                  <div className="px-3 py-1.5 text-[10px] font-bold text-gray-400 border-b border-gray-100 uppercase bg-gray-50 flex items-center gap-1">
                                    <Folder size={10} /> 移动至视频组...
                                  </div>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleMoveToGroup(vid, null, 'video'); }}
                                    className={`w-full text-left px-3 py-2 text-xs font-medium transition flex items-center gap-1.5 ${!vidData.groupId ? 'text-blue-600 bg-blue-50 font-bold' : 'text-gray-600 hover:bg-blue-50'}`}
                                  >
                                    <Folder size={12} className={!vidData.groupId ? "text-blue-600" : "text-gray-400"} /> 未分组 (默认)
                                  </button>
                                  {assetGroups.filter(g => g.type === 'video').map(grp => (
                                    <button
                                      key={grp.id}
                                      onClick={(e) => { e.stopPropagation(); handleMoveToGroup(vid, grp.id, 'video'); }}
                                      className={`w-full text-left px-3 py-2 text-xs font-medium transition flex items-center gap-1.5 truncate ${vidData.groupId === grp.id ? 'text-blue-600 bg-blue-50 font-bold' : 'text-gray-600 hover:bg-blue-50'}`}
                                      title={grp.name}
                                    >
                                      <Folder size={12} className={vidData.groupId === grp.id ? "text-blue-600" : "text-gray-400"} /> {grp.name}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>

                            <button
                              onClick={async () => {
                                if (!window.confirm('确定要删除这个视频吗？')) return;
                                await fetch(`/api/videos/${vid}`, { method: 'DELETE' });
                                fetchVideoGallery();
                              }}
                              className="p-1.5 text-red-500 hover:bg-red-50 hover:text-red-600 rounded-md transition-colors"
                              title="彻底删除源文件"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              };

              const unassignedVideos = videoGallery.filter(vid => !vid.groupId || !assetGroups.some(g => g.id === vid.groupId));
              const isUnassignedCollapsed = !expandedVideoGroups.has('unassigned');
              const isUnassignedSelected = selectedVideoUploadGroupId === null;

              return (
                <div className="flex flex-col gap-6 w-full">
                  {/* Unassigned videos */}
                  <div className={`bg-white border rounded-2xl shadow-sm overflow-hidden transition-all duration-250 ${isUnassignedSelected ? 'ring-2 ring-blue-500 border-blue-500 shadow-md' : 'border-gray-200'}`}>
                    <div 
                      onClick={() => {
                        setSelectedVideoUploadGroupId(null);
                        const newSet = new Set(expandedVideoGroups);
                        newSet.add('unassigned');
                        setExpandedVideoGroups(newSet);
                      }}
                      className={`px-6 py-4 cursor-pointer flex justify-between items-center border-b transition-all duration-250 ${isUnassignedSelected ? 'bg-blue-50/80 border-blue-100' : 'bg-gray-50 border-gray-200 hover:bg-gray-100'}`}
                    >
                      <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                        <Folder className={`w-5 h-5 ${isUnassignedSelected ? 'text-blue-600' : 'text-gray-400'}`} />
                        <span>未分类视频</span>
                        <span className="bg-blue-100 text-blue-700 text-xs px-2.5 py-0.5 rounded-full font-semibold">{unassignedVideos.length} 个视频</span>
                        {isUnassignedSelected && (
                          <span className="text-[10px] bg-blue-600 text-white font-bold px-2 py-0.5 rounded animate-pulse shadow-sm">
                            📌 当前粘贴/上传目标
                          </span>
                        )}
                      </h3>
                      <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => {
                            const newSet = new Set(expandedVideoGroups);
                            if (newSet.has('unassigned')) {
                              newSet.delete('unassigned');
                            } else {
                              newSet.add('unassigned');
                            }
                            setExpandedVideoGroups(newSet);
                          }}
                          className="p-1.5 rounded-md hover:bg-gray-200/50 text-gray-500 transition-colors cursor-pointer"
                        >
                          {isUnassignedCollapsed ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
                        </button>
                      </div>
                    </div>
                    
                    {!isUnassignedCollapsed && (
                      <div className="p-4 bg-gray-50/10">
                        {unassignedVideos.length === 0 ? (
                          <div className="text-center py-12 text-gray-400 text-sm">
                            各个视频均已划分至相对应的视频组中
                          </div>
                        ) : (() => {
                          const limit = videoGroupLimits['unassigned'] || 12;
                          const sliced = unassignedVideos.slice(0, limit);
                          return (
                            <>
                              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                                {sliced.map(renderVideoItem)}
                              </div>
                              {unassignedVideos.length > limit && (
                                <div className="flex justify-center mt-6">
                                  <button
                                    onClick={() => {
                                      setVideoGroupLimits(prev => ({
                                        ...prev,
                                        unassigned: limit + 24
                                      }));
                                    }}
                                    className="px-6 py-2 bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 text-xs font-semibold rounded-xl transition shadow-sm hover:shadow flex items-center gap-1.5 cursor-pointer"
                                  >
                                    <span>加载更多视频 (还有 {unassignedVideos.length - limit} 个)</span>
                                    <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                                  </button>
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    )}
                  </div>

                  {/* Video groups */}
                  {assetGroups
                    .filter(grp => grp.type === 'video' && selectedVideoGroupFilterIds.includes(grp.id))
                    .map(grp => {
                      const grpVideos = videoGallery.filter(vid => vid.groupId === grp.id);
                      const isCollapsed = !expandedVideoGroups.has(grp.id);
                      const isSelected = selectedVideoUploadGroupId === grp.id;
                      
                      return (
                        <div key={grp.id} className={`bg-white border rounded-2xl shadow-sm overflow-hidden transition-all duration-250 ${isSelected ? 'ring-2 ring-blue-500 border-blue-500 shadow-md' : 'border-gray-200'}`}>
                          <div 
                            onClick={() => {
                              setSelectedVideoUploadGroupId(grp.id);
                              const newSet = new Set(expandedVideoGroups);
                              newSet.add(grp.id);
                              setExpandedVideoGroups(newSet);
                            }}
                            className={`px-6 py-4 cursor-pointer flex justify-between items-center border-b transition-all duration-250 ${isSelected ? 'bg-blue-50/80 border-blue-100' : 'bg-blue-50/10 border-gray-100 hover:bg-blue-50/20'}`}
                          >
                            <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                              <Folder className={`w-5 h-5 ${isSelected ? 'text-blue-600' : 'text-blue-500'}`} />
                              <span>{grp.name}</span>
                              <span className="bg-blue-100 text-blue-700 text-xs px-2.5 py-0.5 rounded-full font-semibold">{grpVideos.length} 个视频</span>
                              {isSelected && (
                                <span className="text-[10px] bg-blue-600 text-white font-bold px-2 py-0.5 rounded animate-pulse shadow-sm">
                                  📌 当前粘贴/上传目标
                                </span>
                              )}
                            </h3>
                            <div className="flex items-center gap-4" onClick={e => e.stopPropagation()}>
                              <button
                                onClick={() => handleRenameGroup(grp.id, grp.name)}
                                className="p-1.5 rounded-md text-amber-500 hover:bg-amber-50 transition-colors cursor-pointer"
                                title="修改组名"
                              >
                                <Edit2 size={16} />
                              </button>
                              <button
                                onClick={() => handleDeleteGroup(grp.id)}
                                disabled={grpVideos.length > 0}
                                className={`p-1.5 rounded-md transition-colors ${grpVideos.length > 0 ? 'text-gray-400 opacity-40 cursor-not-allowed' : 'text-red-500 hover:bg-red-50 cursor-pointer'}`}
                                title={grpVideos.length > 0 ? '视频组存在视频时不支持删除' : '删除视频组'}
                              >
                                <Trash2 size={16} />
                              </button>
                              <button
                                onClick={() => {
                                  const newSet = new Set(expandedVideoGroups);
                                  if (newSet.has(grp.id)) {
                                    newSet.delete(grp.id);
                                  } else {
                                    newSet.add(grp.id);
                                  }
                                  setExpandedVideoGroups(newSet);
                                }}
                                className="p-1.5 rounded-md hover:bg-gray-200/50 text-gray-500 transition-colors cursor-pointer"
                              >
                                {isCollapsed ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
                              </button>
                            </div>
                          </div>
                          
                          {!isCollapsed && (
                            <div className="p-4 bg-gray-50/10">
                              {grpVideos.length === 0 ? (
                                <div className="text-center py-8 text-gray-400 text-xs">
                                  <span>当前视频组暂无视频，请在视频卡片上点击移动按钮将其归纳至此组</span>
                                </div>
                              ) : (() => {
                                const limit = videoGroupLimits[String(grp.id)] || 12;
                                const sliced = grpVideos.slice(0, limit);
                                return (
                                  <>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                                      {sliced.map(renderVideoItem)}
                                    </div>
                                    {grpVideos.length > limit && (
                                      <div className="flex justify-center mt-6">
                                        <button
                                          onClick={() => {
                                            setVideoGroupLimits(prev => ({
                                              ...prev,
                                              [String(grp.id)]: limit + 24
                                            }));
                                          }}
                                          className="px-6 py-2 bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 text-xs font-semibold rounded-xl transition shadow-sm hover:shadow flex items-center gap-1.5 cursor-pointer"
                                        >
                                          <span>加载更多视频 (还有 {grpVideos.length - limit} 个)</span>
                                          <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                                        </button>
                                      </div>
                                    )}
                                  </>
                                );
                              })()}
                            </div>
                          )}
                        </div>
                      );
                    })}

                  {/* Notification if some groups are hidden */}
                  {selectedVideoGroupFilterIds.length === 0 && assetGroups.filter(g => g.type === 'video').length > 0 && (
                    <div className="text-center py-10 bg-gray-50/50 border border-dashed border-gray-200 rounded-2xl text-gray-400 text-xs shadow-sm">
                      <Folder className="w-8 h-8 text-gray-250 mx-auto mb-2 animate-pulse" />
                      <span>已折叠并隐藏所有视频分类。请在上方输入或点击多选框选择想要展示哪些视频分类。</span>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {showVideoUrlModal && (
            <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-[1150] animate-fade-in">
              <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-gray-150 p-6 space-y-4 text-gray-800">
                <div className="flex justify-between items-center pb-2 border-b border-gray-100">
                  <h3 className="text-lg font-bold text-gray-900 flex items-center gap-1.5">
                    <Link className="w-5 h-5 text-blue-600 animate-pulse" />
                    导入视频 URL 网址
                  </h3>
                  <button 
                    onClick={() => {
                      setShowVideoUrlModal(false);
                      setVideoUrlInput('');
                    }}
                    className="p-1 rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">
                    目标视频组
                  </label>
                  <div className="p-3 bg-gray-50 border border-gray-150 rounded-xl flex items-center gap-2 text-sm font-semibold text-gray-700">
                    <Folder className="w-4 h-4 text-blue-600 animate-bounce" />
                    <span>
                      {selectedVideoUploadGroupId === null 
                        ? '未分类视频 (默认)' 
                        : assetGroups.find(g => g.id === selectedVideoUploadGroupId)?.name || '未分类视频'
                      }
                    </span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">
                    视频链接地址 (MP4/WebM)
                  </label>
                  <input
                    type="url"
                    value={videoUrlInput}
                    onChange={(e) => setVideoUrlInput(e.target.value)}
                    placeholder="https://example.com/video.mp4"
                    className="w-full p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm font-medium transition"
                  />
                  <p className="text-[11px] text-gray-400 leading-relaxed">
                    请输入可直接指向视频文件的完整下载 URL 地址（支持 mp4 或 webm 格式）。
                  </p>
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowVideoUrlModal(false);
                      setVideoUrlInput('');
                    }}
                    className="px-4 py-2.5 text-sm font-bold text-gray-500 hover:bg-gray-100 rounded-xl transition cursor-pointer"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={!videoUrlInput.trim()}
                    onClick={async () => {
                      const url = videoUrlInput.trim();
                      if (!url) return;
                      setShowVideoUrlModal(false);
                      setVideoUrlInput('');
                      await downloadVideoFromUrl(url, selectedVideoUploadGroupId);
                    }}
                    className={`px-5 py-2.5 text-sm font-bold text-white rounded-xl transition cursor-pointer flex items-center gap-1.5 ${
                      videoUrlInput.trim() 
                        ? 'bg-blue-600 hover:bg-blue-700 shadow-md' 
                        : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    }`}
                  >
                    开始导入
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'xhs_notes' && (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
            <div>
              <h2 className="text-xl font-bold text-gray-800">小红书发布管理与汇总</h2>
              <p className="text-xs text-gray-500 mt-1">汇总全部本地定时及立即发布的小红书笔记（支持查看发布进度与回传链接）。</p>
            </div>
            
            <div className="flex bg-gray-100 p-0.5 rounded-lg border border-gray-200 items-center gap-1.5">
              {effectiveXhsHomepageUrl && (
                <a
                  href={effectiveXhsHomepageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1.5 text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 rounded-md flex items-center gap-1 cursor-pointer transition"
                >
                  <ExternalLink size={12} />
                  打开小红书账号主页 ↗
                </a>
              )}
              <button 
                type="button"
                onClick={fetchXhsNotes}
                className="px-3 py-1.5 text-xs font-semibold bg-white rounded-md shadow-sm hover:bg-gray-50 flex items-center gap-1 cursor-pointer"
              >
                刷新记录
              </button>
            </div>
          </div>

          {/* Search bar & Username Classification */}
          <div className="space-y-3">
            <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm flex items-center gap-3">
              <input 
                type="text" 
                placeholder="搜索标题或正文关键字..." 
                value={xhsSearchText}
                onChange={e => setXhsSearchText(e.target.value)}
                className="flex-grow px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:border-red-400 transition"
              />
            </div>

            {/* Username categorization tabs */}
            {(() => {
              const uniqueUsers = Array.from(new Set(xhsNotesList.map(n => n.username || '未知用户')));
              if (uniqueUsers.length <= 1) return null;

              return (
                <div className="flex gap-2 flex-wrap items-center bg-gray-100/60 p-1.5 rounded-xl border border-gray-150">
                  <span className="text-xs font-bold text-gray-500 px-2.5">按用户名分类:</span>
                  <button
                    onClick={() => setXhsSelectedUser('全部')}
                    className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                      xhsSelectedUser === '全部' 
                        ? 'bg-red-500 text-white shadow-sm' 
                        : 'text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    全部 ({xhsNotesList.length})
                  </button>
                  {uniqueUsers.map(uname => {
                    const count = xhsNotesList.filter(n => (n.username || '未知用户') === uname).length;
                    return (
                      <button
                        key={uname}
                        onClick={() => setXhsSelectedUser(uname)}
                        className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                          xhsSelectedUser === uname 
                            ? 'bg-red-500 text-white shadow-sm' 
                            : 'text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        👤 {uname} ({count})
                      </button>
                    );
                  })}
                </div>
              );
            })()}
          </div>

          {isXhsNotesLoading ? (
            <div className="flex flex-col items-center justify-center py-24 text-gray-400">
              <div className="animate-spin h-8 w-8 border-3 border-red-500 rounded-full border-t-transparent mb-3"></div>
              <span>正在获取发布摘要列表...</span>
            </div>
          ) : (() => {
            const filteredList = xhsNotesList.filter(note => {
              const matchesSearch = !xhsSearchText || 
                (note.title && note.title.toLowerCase().includes(xhsSearchText.toLowerCase())) ||
                (note.content && note.content.toLowerCase().includes(xhsSearchText.toLowerCase()));
              
              const matchesUser = xhsSelectedUser === '全部' || (note.username || '未知用户') === xhsSelectedUser;
              
              return matchesSearch && matchesUser;
            });

            if (filteredList.length === 0) {
              return (
                <div className="text-center py-16 bg-white border border-gray-150 rounded-2xl">
                  <Share2 className="w-12 h-12 mx-auto mb-3 text-red-400" />
                  <p className="text-sm font-medium text-gray-500">暂无符合条件的小红书发布记录</p>
                  <p className="text-xs text-gray-400 mt-1">您可以在“素材库” - “本地视频库”中选择视频，点击“小红书配置”进行发布或定时计划。</p>
                </div>
              );
            }

            const groups = groupByUser(filteredList);

            return (
              <div className="space-y-6">
                {Object.entries(groups).map(([uname, groupNotes]: [string, any[]]) => {
                  const key = uname + '_xhs';
                  const isExpanded = expandedUsers.has(key) || 
                                     uname === user?.username || 
                                     xhsSelectedUser === uname || 
                                     Object.keys(groups).length <= 1;

                  return (
                    <div key={uname} className="space-y-4">
                      {/* Section header for user classification */}
                      {Object.keys(groups).length > 1 && (
                        <div 
                          onClick={() => toggleUserExpand(key)}
                          className="flex justify-between items-center bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 cursor-pointer hover:bg-gray-100 transition shadow-sm"
                        >
                          <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                            <span className="text-red-500">👤</span>
                            <span>{uname}</span>
                            <span className="bg-red-50 text-red-600 text-[11px] px-2 py-0.5 rounded-full font-bold border border-red-100">
                              {groupNotes.length} 个笔记
                            </span>
                          </h3>
                          <div className="flex items-center text-gray-400">
                            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                          </div>
                        </div>
                      )}

                      {/* Notes grid */}
                      {isExpanded && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {groupNotes.map(note => {
                            let coverUrl = '/placeholder_cover.jpg';
                            if (note.cover_path) {
                              if (note.cover_path.startsWith('data:') || note.cover_path.startsWith('http')) {
                                coverUrl = note.cover_path;
                              } else {
                                coverUrl = note.cover_path.startsWith('/') ? note.cover_path : `/${note.cover_path}`;
                              }
                            }
                            
                            return (
                              <div key={note.id} className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm hover:shadow-md transition flex flex-col justify-between sm:flex-row gap-4">
                                {/* Left side info block with preview */}
                                <div className="flex gap-4 flex-grow min-w-0">
                                  {/* Cover preview */}
                                  <div className="w-24 h-32 rounded-lg overflow-hidden bg-gray-100 border border-gray-150 relative flex-shrink-0">
                                    <img 
                                      referrerPolicy="no-referrer"
                                      src={coverUrl} 
                                      alt="cover" 
                                      className="w-full h-full object-cover" 
                                      onError={(e) => { e.currentTarget.src = '/placeholder_cover.jpg'; }}
                                    />
                                    <div className="absolute top-1 left-1 bg-black/60 px-1 py-0.5 rounded text-[10px] text-white font-mono">
                                      ID: {note.id}
                                    </div>
                                  </div>

                                  {/* Text fields & badges */}
                                  <div className="flex-grow min-w-0 flex flex-col justify-between">
                                    <div>
                                      <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                                        {/* Status badge */}
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                            note.publish_status === 'success' ? 'bg-green-50 text-green-700 border border-green-200' :
                                            note.publish_status === 'failed' ? 'bg-rose-50 text-rose-700 border border-rose-200' :
                                            note.publish_status === 'publishing' ? 'bg-amber-50 text-amber-700 border border-amber-200 animate-pulse' :
                                            'bg-gray-50 text-gray-600 border border-gray-200'
                                          }`}>
                                            {note.publish_status === 'success' ? '已发布' :
                                             note.publish_status === 'failed' ? '发布失败' :
                                             note.publish_status === 'publishing' ? '发布中...' : '定时发布 / 任务排队中'}
                                          </span>
                                          {note.is_draft === 1 && (
                                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-600 border border-amber-500/20">
                                              草稿
                                            </span>
                                          )}
                                        </div>
                                        
                                        {/* User indicator for admin */}
                                        {note.username && (
                                          <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-medium">
                                            👤 {note.username}
                                          </span>
                                        )}
                                      </div>

                                      <h3 className="font-bold text-gray-800 text-sm truncate" title={note.title}>{note.title || '（未命名标题）'}</h3>
                                      <p className="text-xs text-gray-500 line-clamp-2 mt-1 whitespace-pre-line" title={note.content}>{note.content || '（无描述正文）'}</p>
                                      {note.tags && (
                                        <p className="text-[10px] text-red-500 font-medium truncate mt-1">
                                          {note.tags.split(/[\s,，]+/).map((t: string) => t.startsWith('#') ? t : `#${t}`).join(' ')}
                                        </p>
                                      )}
                                    </div>

                                    <div className="mt-2 pt-2 border-t border-gray-50">
                                      {/* Schedule/Publish time */}
                                      <div className="flex items-center gap-1 text-[10px] text-gray-400 mb-1 font-mono">
                                        <Clock size={11} />
                                        <span>
                                          {note.scheduled_at 
                                            ? `计划发布: ${new Date(note.scheduled_at).toLocaleString()}` 
                                            : `发布提交: ${new Date(note.created_at).toLocaleString()}`}
                                        </span>
                                      </div>

                                      {/* Show error if failed */}
                                      {note.publish_status === 'failed' && note.error_message && (
                                        <p className="text-[10px] text-rose-500 font-medium truncate max-w-full" title={note.error_message}>
                                          ⚠️ 错误: {note.error_message}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                {/* Right/Bottom side action buttons */}
                                <div className="flex sm:flex-col justify-end gap-1.5 min-w-[100px] border-t sm:border-t-0 pt-2 sm:pt-0 sm:border-l sm:pl-3 border-gray-100">
                                  {note.publish_url && (
                                    <a 
                                      href={note.publish_url} 
                                      target="_blank" 
                                      rel="noreferrer" 
                                      className="flex-grow py-1 px-2 text-[11px] font-bold text-red-500 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg flex items-center justify-center gap-1 cursor-pointer transition hover:scale-[1.02]"
                                    >
                                      <ExternalLink size={11} />
                                      打开笔记
                                    </a>
                                  )}

                                  <button 
                                    type="button"
                                    onClick={() => setPreviewingXhsNoteId(note.id)}
                                    className="flex-grow py-1 px-2 text-[11px] font-bold text-emerald-600 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg flex items-center justify-center gap-1 cursor-pointer transition hover:scale-[1.02]"
                                  >
                                    <Eye size={11} />
                                    排版预览
                                  </button>

                                  <button 
                                    type="button"
                                    onClick={() => setEditingXhsNote({ ...note })}
                                    className="flex-grow py-1 px-2 text-[11px] font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg flex items-center justify-center gap-1 cursor-pointer transition hover:scale-[1.02]"
                                  >
                                    <Edit2 size={11} />
                                    编辑笔记
                                  </button>

                                  {(note.publish_status === 'failed' || note.publish_status === 'pending') && (
                                    <button 
                                      type="button"
                                      onClick={async () => {
                                        try {
                                          setPublishingXhsNoteId(note.id);
                                          const res = await fetch('/api/videos/xhs/publish', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({
                                              videoPath: note.video_path,
                                              coverPath: note.cover_path,
                                              title: note.title,
                                              content: note.content,
                                              tags: note.tags,
                                              isDraft: note.is_draft
                                            })
                                          });
                                          const result = await res.json();
                                          if (result.success) {
                                            setPublishingXhsNoteId(result.noteId);
                                          } else {
                                            alert('发布触发失败: ' + result.error);
                                            setPublishingXhsNoteId(null);
                                          }
                                        } catch (err: any) {
                                          alert('重试触发异常: ' + (err.message || err));
                                          setPublishingXhsNoteId(null);
                                        }
                                      }}
                                      className="flex-grow py-1 px-2 text-[11px] font-bold text-amber-600 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg flex items-center justify-center gap-1 cursor-pointer transition hover:scale-[1.02]"
                                    >
                                      <Share2 size={11} />
                                      {note.publish_status === 'failed' ? '重新发布' : '立即发布'}
                                    </button>
                                  )}

                                  <button 
                                    type="button"
                                    onClick={async () => {
                                      const isPending = note.publish_status !== 'success' && note.publish_status !== 'failed';
                                      const confirmMessage = isPending
                                        ? '您确定要删除这档定时发布的小红书作品记录吗？此任务还未发布，删除该记录将【同步取消并彻底删除定时发布任务】，到点将不再自动执行发布。'
                                        : '确定要删除这档已发布的小红书发布记录吗？';
                                      
                                      if (!window.confirm(confirmMessage)) return;
                                      try {
                                        await fetch('/api/xhs-notes/delete', {
                                          method: 'POST',
                                          headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify({ id: note.id })
                                        });
                                        fetchXhsNotes();
                                      } catch (e) {
                                        alert('删除失败');
                                      }
                                    }}
                                    className="py-1 px-2 text-[11px] font-medium text-gray-500 hover:text-red-500 hover:bg-red-50 border border-transparent hover:border-red-150 rounded-lg cursor-pointer flex items-center justify-center gap-1 transition"
                                  >
                                    <Trash2 size={11} />
                                    删除记录
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}


      {activeTab === 'users' && user?.role === 'admin' && (
        <UserManagement />
      )}

      {activeTab === 'workers' && user?.role === 'admin' && (
        <WorkersManagement />
      )}

      {activeTab === 'proxy' && user?.role === 'admin' && (
        <ProxyManagement />
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
          <div className="bg-white p-6 rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex justify-between items-center mb-4 pb-2 border-b">
              <h2 className="text-lg font-bold text-gray-800">模板管理</h2>
              <button type="button" onClick={() => setShowTemplateModal(false)} className="text-gray-400 hover:text-gray-600 cursor-pointer"><X size={20}/></button>
            </div>
            <div className="max-h-[35vh] overflow-y-auto pr-1 space-y-2 mb-4">
              {templates.map(t => (
                <div key={t.id} className="flex flex-col p-3 bg-gray-50 rounded-xl border border-gray-100">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-semibold text-sm text-gray-700">{t.name}</span>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => {
                        const nameEl = document.getElementById('new-t-name') as HTMLInputElement;
                        const promptEl = document.getElementById('new-t-prompt') as HTMLTextAreaElement;
                        if (nameEl && promptEl) {
                          nameEl.value = t.name;
                          promptEl.value = t.prompt;
                        }
                        saveTemplates(templates.filter(x => x.id !== t.id));
                      }} className="text-blue-500 hover:bg-blue-50 p-1 rounded-lg cursor-pointer"><Edit2 size={16}/></button>
                      <button type="button" onClick={() => saveTemplates(templates.filter(x => x.id !== t.id))} className="text-red-500 hover:bg-red-50 p-1 rounded-lg cursor-pointer"><Trash2 size={16}/></button>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 line-clamp-2">{t.prompt}</p>
                </div>
              ))}
            </div>

            <div className="space-y-3 border-t pt-3">
              <h3 className="text-xs font-bold text-gray-700">添加/修改模板</h3>
              <input
                id="new-t-name"
                placeholder="模板名称 (如: 小红书穿搭风)"
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-blue-400"
              />
              <textarea
                id="new-t-prompt"
                placeholder="模板内容提示词"
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs h-20 outline-none focus:ring-2 focus:ring-blue-400 resize-none"
              />
              <button
                type="button"
                onClick={() => {
                  const nameEl = document.getElementById('new-t-name') as HTMLInputElement;
                  const promptEl = document.getElementById('new-t-prompt') as HTMLTextAreaElement;
                  if (nameEl && promptEl && nameEl.value.trim() && promptEl.value.trim()) {
                    saveTemplates([...templates, { id: Date.now().toString(), name: nameEl.value.trim(), prompt: promptEl.value.trim() }]);
                    nameEl.value = '';
                    promptEl.value = '';
                  } else {
                    alert('请完整填写名称 and 内容');
                  }
                }}
                className="w-full py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-xs font-bold transition shadow-sm cursor-pointer"
              >
                保存模板
              </button>
            </div>
          </div>
        </div>
      )}

      {editingXhsNote && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-[999]">
          <div className="bg-white p-6 rounded-2xl shadow-xl w-full lg:max-w-5xl md:max-w-4xl max-w-lg flex flex-col max-h-[90vh] overflow-hidden">
            <div className="flex justify-between items-center mb-4 pb-2 border-b">
              <h2 className="text-lg font-bold text-gray-800">编辑小红书笔记配置</h2>
              <button type="button" onClick={() => setEditingXhsNote(null)} className="text-gray-400 hover:text-gray-600 cursor-pointer"><X size={20}/></button>
            </div>
            <form onSubmit={async (e) => {
              e.preventDefault();
              try {
                const res = await fetch('/api/xhs-notes/update', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    id: editingXhsNote.id,
                    title: editingXhsNote.title,
                    content: editingXhsNote.content,
                    tags: editingXhsNote.tags,
                    scheduledAt: editingXhsNote.scheduled_at,
                    publishUrl: editingXhsNote.publish_url
                  })
                });
                if (res.ok) {
                  setEditingXhsNote(null);
                  fetchXhsNotes();
                } else {
                  const data = await res.json();
                  alert(data.error || '保存失败');
                }
              } catch (err) {
                alert('请求失败');
              }
            }} className="flex-grow overflow-y-auto flex flex-col justify-between">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start pb-4">
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">笔记标题 (Title)</label>
                    <input
                      type="text"
                      value={editingXhsNote.title || ''}
                      onChange={e => setEditingXhsNote({ ...editingXhsNote, title: e.target.value })}
                      placeholder="请输入笔记标题"
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-400 focus:border-red-400 outline-none text-sm transition"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">笔记说明/正文 (Content)</label>
                    <textarea
                      rows={4}
                      value={editingXhsNote.content || ''}
                      onChange={e => setEditingXhsNote({ ...editingXhsNote, content: e.target.value })}
                      placeholder="请输入笔记说明/正文描述"
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-400 focus:border-red-400 outline-none text-sm transition h-24"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">正文话题标签 (Tags)</label>
                    <input
                      type="text"
                      value={editingXhsNote.tags || ''}
                      onChange={e => setEditingXhsNote({ ...editingXhsNote, tags: e.target.value })}
                      placeholder="用逗号分隔，如: 穿搭,日常,好物分享"
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-400 focus:border-red-400 outline-none text-sm transition"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">计划发布时间 (Scheduled Release Time)</label>
                    <input
                      type="datetime-local"
                      value={editingXhsNote.scheduled_at ? new Date(new Date(editingXhsNote.scheduled_at).getTime() - new Date().getTimezoneOffset()*60000).toISOString().slice(0, 16) : ''}
                      onChange={e => {
                        const val = e.target.value;
                        setEditingXhsNote({ ...editingXhsNote, scheduled_at: val ? new Date(val).getTime() : null });
                      }}
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-400 focus:border-red-400 outline-none text-sm transition"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">已发布笔记 URL (Publish Note Link)</label>
                    <input
                      type="text"
                      value={editingXhsNote.publish_url || ''}
                      onChange={e => setEditingXhsNote({ ...editingXhsNote, publish_url: e.target.value })}
                      placeholder="https://www.xiaohongshu.com/explore/xxxxxxxx"
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-400 focus:border-red-400 outline-none text-sm transition"
                    />
                  </div>

                  <div className="bg-yellow-50 border border-yellow-100 p-3 rounded-lg text-[11px] text-yellow-800">
                    ⚠️ 注意：该编辑功能允许您优化笔记说明与修正外部回传链接。“绑定视频”、“绑定封面”以及当前的“自动化发布状态”由于底层数据流锁定，当前面板不提供手动覆盖。
                  </div>
                </div>

                {/* Right column: live preview */}
                <div className="flex flex-col justify-start items-center bg-gray-50 border border-gray-150 p-4 rounded-2xl shadow-inner max-h-[65vh] overflow-y-auto">
                  <div className="text-xs font-bold text-gray-500 mb-3 flex items-center gap-1.5 self-start select-none">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                    小红书真机排版模拟预览 (1:1 还原)
                  </div>
                  <XhsPhonePreview 
                    title={editingXhsNote.title || ''}
                    content={editingXhsNote.content || ''}
                    tags={editingXhsNote.tags || ''}
                    coverImage={editingXhsNote.cover_path || ''}
                    aspectRatio="3:4"
                    authorName={editingXhsNote.username || user?.username || '小红书创作者'}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setEditingXhsNote(null)}
                  className="px-4 py-2 border border-gray-200 text-gray-700 bg-white hover:bg-gray-50 rounded-xl text-sm font-medium transition cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-red-500 hover:bg-red-600 active:scale-95 text-white rounded-xl text-sm font-bold shadow-sm transition cursor-pointer"
                >
                  保存配置
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {previewingXhsNoteId && (() => {
        const noteToPreview = xhsNotesList.find(n => n.id === previewingXhsNoteId);
        if (!noteToPreview) return null;
        return (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-[999]" onClick={() => setPreviewingXhsNoteId(null)}>
            <div className="bg-white p-5 rounded-3xl shadow-2xl w-full max-w-sm flex flex-col items-center relative animate-in fade-in zoom-in-95 duration-150" onClick={e => e.stopPropagation()}>
              <button 
                type="button" 
                onClick={() => setPreviewingXhsNoteId(null)} 
                className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 bg-gray-100 hover:bg-gray-200 p-1.5 rounded-full cursor-pointer transition"
              >
                <X size={18}/>
              </button>
              
              <div className="text-xs font-bold text-gray-500 mb-4 flex items-center gap-1.5 self-start select-none pl-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                小红书笔记真机排版预览 (1:1 还原)
              </div>
              
              <XhsPhonePreview 
                title={noteToPreview.title || ''}
                content={noteToPreview.content || ''}
                tags={noteToPreview.tags || ''}
                coverImage={noteToPreview.cover_path || ''}
                aspectRatio="3:4"
                authorName={noteToPreview.username || user?.username || '小红书创作者'}
              />
            </div>
          </div>
        );
      })()}

      {showProfileModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-[999]">
          <div className="relative bg-white p-6 rounded-2xl shadow-xl w-full max-w-md animate-in fade-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center mb-4 pb-2 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                <User className="text-red-500" size={18} />
                个人设置
              </h2>
              <button 
                type="button"
                onClick={() => setShowProfileModal(false)}
                className="text-gray-400 hover:text-gray-600 transition cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">您的小红书账号主页链接 (Personal Homepage URL)</label>
                <input
                  type="text"
                  value={personalXhsUrl}
                  onChange={e => setPersonalXhsUrl(e.target.value)}
                  placeholder="例如: https://www.xiaohongshu.com/user/profile/xxxxxxxxxxxx"
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-400 focus:border-red-400 outline-none text-sm transition font-sans"
                />
                <p className="text-[11px] text-gray-400 mt-2">
                  ※ 填入您的小红书个人主页链接。设置后，发布操作中将自动关联并支持一键跳转到您对应的小红书账号，方便手动/自动提取最新笔记链接。
                </p>
                {systemConfig.xhsHomepageUrl && (
                  <p className="text-[10px] text-amber-600 mt-1">
                    系统默认全局主页为：<span className="break-all underline">{systemConfig.xhsHomepageUrl}</span>。您在此处设置的链接将优先于系统全局设置。
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">绑定本地电脑 / 虚拟机 (Device / Worker Binding)</label>
                <select
                  value={personalBoundWorkerId}
                  onChange={e => setPersonalBoundWorkerId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-400 focus:border-blue-400 outline-none text-sm transition bg-white"
                  required={user?.role !== 'admin'}
                >
                  {user?.role === 'admin' ? (
                    <>
                      <option value="">- 不绑定电脑 (默认：服务器本地或动态匹配任意在线节点) -</option>
                      {availableWorkers.map(w => (
                        <option key={w.id} value={w.id}>
                          {w.name} ({w.status === 'offline' ? '离线' : '在线'})
                        </option>
                      ))}
                    </>
                  ) : (
                    <>
                      <option value="" disabled>-- 请选择一个当前在线的本地电脑 / 虚拟机 --</option>
                      {availableWorkers.filter(w => w.status !== 'offline' && w.id !== 'local-server-id').map(w => (
                        <option key={w.id} value={w.id}>
                          {w.name} (在线)
                        </option>
                      ))}
                      {availableWorkers.filter(w => w.status === 'offline' && w.id === user?.bound_worker_id && w.id !== 'local-server-id').map(w => (
                        <option key={w.id} value={w.id} disabled>
                          {w.name} (当前绑定制，但处于离线)
                        </option>
                      ))}
                    </>
                  )}
                </select>
                <p className="text-[11px] text-gray-400 mt-1.5 border-b pb-3 border-gray-100">
                  ※ 多账号隔离防封号：绑定后，本账号产生的<b>生图任务/文案生成</b>与<b>小红书自动/遥控发布</b>命令，将精准定向发送给您的这台本地设备，在您本地的 Chrome 浏览器及 CDP 端口中真实操作，完全符合防风控 and 单人单机需求。
                  {user?.role !== 'admin' && (
                    <span className="block text-red-500 font-semibold mt-1">
                      ⚠️ 提示：普通用户不能设置“不绑定”或“服务器本地”，必须绑定任一在线的本地 Worker 设备。
                    </span>
                  )}
                </p>
              </div>

              {/* 绑定部署与极速绑定说明/下载 */}
              <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-100 flex flex-col gap-2.5 shadow-inner">
                <span className="text-xs font-bold text-blue-800 flex items-center gap-1.5">
                  <Chrome size={14} className="text-blue-500" />
                  新电脑极速绑定 & Worker 部署指南
                </span>
                
                <p className="text-[11px] text-gray-600 leading-relaxed">
                  在您用来运行小红书账号并登录的电脑上，部署并开启 <b>Worker 客户端</b>，系统会自动实现脚本同步，零配置托管发布。
                </p>

                <div className="flex gap-2">
                  <a
                    href="/api/worker/download"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 text-center py-2 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold shadow-sm transition flex items-center justify-center gap-1 hover:no-underline cursor-pointer"
                  >
                    <Download size={13} />
                    下载最新版 Worker 客户端 (.zip)
                  </a>
                </div>

                <div className="pt-2 border-t border-blue-100/70">
                  <span className="block text-[11px] font-semibold text-blue-800 mb-1">
                    或者：用 PowerShell 命令行一键自动安装 (极速推荐)
                  </span>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      readOnly
                      value={`iwr -useb ${window.location.protocol}//${window.location.host}/worker_install.ps1 | iex`}
                      className="flex-1 px-2.5 py-1.5 text-[10px] font-mono bg-white border border-blue-200 rounded-lg text-gray-600 outline-none select-all"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(`iwr -useb ${window.location.protocol}//${window.location.host}/worker_install.ps1 | iex`);
                        setCopiedInstall(true);
                        setTimeout(() => setCopiedInstall(false), 2000);
                      }}
                      className="px-3 py-1.5 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded-lg text-xs font-bold transition flex items-center justify-center whitespace-nowrap cursor-pointer"
                    >
                      {copiedInstall ? '已复制！' : '复制命令'}
                    </button>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1.5 leading-snug">
                    ※ 操作步骤：在目标电脑上打开 <b>PowerShell</b> 窗口，粘贴此命令按下回车。它将自动创建 <code>~/AI_Worker</code>、拉取客户端并连接此服务器。完成后在此界面下拉菜单刷新即可选择。
                  </p>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowProfileModal(false)}
                  className="px-4 py-2 border border-gray-200 text-gray-600 bg-white hover:bg-gray-50 rounded-xl text-sm font-medium transition cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isSavingProfile}
                  className="px-5 py-2 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white rounded-xl text-sm font-bold shadow-sm transition cursor-pointer"
                >
                  {isSavingProfile ? '保存中...' : '保存修改'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showConfigModal && user?.role === 'admin' && (
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
            <div className="mb-6 space-y-4 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
              <details className="group border border-gray-200 rounded-xl bg-white overflow-hidden shadow-sm" open>
                <summary className="font-bold text-gray-800 bg-gray-50 p-4 cursor-pointer list-none flex justify-between items-center hover:bg-gray-100 transition-colors">
                  <div className="flex items-center gap-2"><Settings size={18} className="text-blue-500"/> 基础环境与路径配置</div>
                  <ChevronDown className="w-5 h-5 text-gray-400 group-open:rotate-180 transition-transform" />
                </summary>
                <div className="p-5 border-t border-gray-200 space-y-4">
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
                  <div>
                    <label className="block mb-1 font-semibold text-gray-700">Real-ESRGAN 超分执行文件路径 (.exe / Command)：</label>
                    <input
                      type="text"
                      className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                      value={systemConfig.realesrganPath || ''}
                      onChange={(e) => setSystemConfig({...systemConfig, realesrganPath: e.target.value})}
                      placeholder="例如: realesrgan-ncnn-vulkan.exe 或 F:\tools\realesrgan-ncnn-vulkan.exe"
                    />
                    <p className="text-xs text-gray-400 mt-1">※ 若留空，将默认在项目根目录、bin、tools、realesrgan目录内寻找，或读取系统 PATH 环境。推荐在此配置您的本地绝对路径。</p>
                    <div className="mt-2 flex items-center gap-3">
                      <button
                        type="button"
                        disabled={isSettingUpESRGAN}
                        onClick={handleDownloadRealESRGAN}
                        className={`px-4 py-2 text-xs font-semibold rounded-lg shadow-sm transition flex items-center gap-1.5 ${
                          isSettingUpESRGAN 
                            ? 'bg-gray-100 text-gray-400 cursor-not-allowed animate-pulse' 
                            : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                        }`}
                      >
                        <Sparkles size={14} className={isSettingUpESRGAN ? "animate-spin text-indigo-400" : "text-indigo-600"} />
                        {isSettingUpESRGAN ? '正在下载部署，请勿关闭页面(耗时约15-30秒)...' : '📦 一键从 GitHub 下载并自动部署 Real-ESRGAN Windows 离线环境'}
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="checkbox"
                      id="headless"
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 cursor-pointer"
                      checked={systemConfig.headless !== false}
                      onChange={(e) => setSystemConfig({...systemConfig, headless: e.target.checked})}
                    />
                    <label htmlFor="headless" className="font-semibold text-gray-700 cursor-pointer text-sm select-none">
                      无头模式 (后台运行浏览器，取消勾选可在虚拟机/执行端显示浏览器界面)
                    </label>
                  </div>
                </div>
              </details>

              <details className="group border border-gray-200 rounded-xl bg-white overflow-hidden shadow-sm">
                <summary className="font-bold text-gray-800 bg-gray-50 p-4 cursor-pointer list-none flex justify-between items-center hover:bg-gray-100 transition-colors">
                  <div className="flex items-center gap-2"><Settings size={18} className="text-blue-500"/> 任务分配与并发配置</div>
                  <ChevronDown className="w-5 h-5 text-gray-400 group-open:rotate-180 transition-transform" />
                </summary>
                <div className="p-5 border-t border-gray-200 space-y-4">
                  <div className="grid grid-cols-2 gap-4 bg-white">
                    <div>
                      <label className="block mb-1 font-semibold text-gray-700">全局任务分配方式:</label>
                      <select 
                        className="w-full p-2 border border-gray-200 rounded-lg outline-none bg-white font-medium text-blue-700"
                        value={systemConfig.dispatchStrategy || 'server'}
                        onChange={(e) => setSystemConfig({...systemConfig, dispatchStrategy: e.target.value})}
                      >
                        <option value="server">本地服务器执行</option>
                        <option value="worker">仅节点虚拟机执行</option>
                        <option value="all">所有设备通过抢单执行</option>
                      </select>
                    </div>
                    <div>
                      <label className="block mb-1 font-semibold text-gray-700">全局任务最大并发数:</label>
                      <input type="number" min="1" className="w-full p-2 border border-gray-200 rounded-lg outline-none font-medium text-gray-800" value={systemConfig.globalConcurrency || 3} onChange={(e) => setSystemConfig({...systemConfig, globalConcurrency: parseInt(e.target.value) || 1})} />
                    </div>
                    <div>
                      <label className="block mb-1 font-semibold text-gray-700 flex items-center gap-1.5">
                        视频渲染并发数:
                        <span className="text-[10px] font-medium text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-100">排队单通道</span>
                      </label>
                      <input 
                        type="number" 
                        disabled 
                        className="w-full p-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-400 cursor-not-allowed font-medium" 
                        value={1} 
                      />
                      <p className="text-[10px] text-gray-400 mt-1">※ 已锁定为“单任务排队执行”机制，一个完成再接下一个，保障服务器/电脑性能与稳定。</p>
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
                    <div>
                      <label className="block mb-1 font-semibold text-gray-700">去水印探测区域宽度占比 (%):</label>
                      <input 
                        type="number" 
                        min="1" 
                        max="100" 
                        className="w-full p-2 border border-gray-200 rounded-lg outline-none font-medium text-gray-800" 
                        value={systemConfig.watermarkRoiWPercent !== undefined ? systemConfig.watermarkRoiWPercent : 15} 
                        onChange={(e) => setSystemConfig({...systemConfig, watermarkRoiWPercent: parseInt(e.target.value) || 0})} 
                      />
                    </div>
                    <div>
                      <label className="block mb-1 font-semibold text-gray-700">去水印探测区域高度占比 (%):</label>
                      <input 
                        type="number" 
                        min="1" 
                        max="100" 
                        className="w-full p-2 border border-gray-200 rounded-lg outline-none font-medium text-gray-800" 
                        value={systemConfig.watermarkRoiHPercent !== undefined ? systemConfig.watermarkRoiHPercent : 10} 
                        onChange={(e) => setSystemConfig({...systemConfig, watermarkRoiHPercent: parseInt(e.target.value) || 0})} 
                      />
                    </div>
                  </div>
                </div>
              </details>

              <details className="group border border-gray-200 rounded-xl bg-white overflow-hidden shadow-sm">
                <summary className="font-bold text-gray-800 bg-gray-50 p-4 cursor-pointer list-none flex justify-between items-center hover:bg-gray-100 transition-colors">
                  <div className="flex items-center gap-2"><Clock size={18} className="text-blue-500"/> 自动化时间与重试配置</div>
                  <ChevronDown className="w-5 h-5 text-gray-400 group-open:rotate-180 transition-transform" />
                </summary>
                <div className="p-5 border-t border-gray-200 space-y-4">
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
                  </div>
                </div>
              </details>

              <details className="group border border-gray-200 rounded-xl bg-white overflow-hidden shadow-sm" open>
                <summary className="font-bold text-gray-800 bg-gray-50 p-4 cursor-pointer list-none flex justify-between items-center hover:bg-gray-100 transition-colors">
                  <div className="flex items-center gap-2"><Sparkles size={18} className="text-purple-500"/> AI 大模型配置</div>
                  <ChevronDown className="w-5 h-5 text-gray-400 group-open:rotate-180 transition-transform" />
                </summary>
                <div className="p-5 border-t border-gray-200 space-y-4">
                  <div>
                    <label className="block mb-1 font-semibold text-gray-700">OpenCode API Base URL（API 接口地址）：</label>
                    <input
                      type="text"
                      className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 outline-none text-sm"
                      value={systemConfig.openCodeApiUrl || ''}
                      onChange={(e) => setSystemConfig({...systemConfig, openCodeApiUrl: e.target.value})}
                      placeholder="https://opencode.ai/zen/go/v1"
                    />
                    <p className="text-xs text-gray-400 mt-2">※ 默认为 https://opencode.ai/zen/go/v1。系统会自动识别您的模型分类（如 MiniMax、Qwen 等）来兼容 /messages 端点或 /chat/completions 格式。</p>
                  </div>
                  <div>
                    <label className="block mb-1 font-semibold text-gray-700">OpenCode API Key（API 密钥）：</label>
                    <input
                      type="password"
                      className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 outline-none text-sm"
                      value={systemConfig.openCodeApiKey || ''}
                      onChange={(e) => setSystemConfig({...systemConfig, openCodeApiKey: e.target.value})}
                      placeholder="sk-..."
                    />
                  </div>
                  <div>
                    <label className="block mb-1 font-semibold text-gray-700">大模型 Model Name（模型名称）：</label>
                    <input
                      type="text"
                      className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 outline-none text-sm"
                      value={systemConfig.openCodeModel || ''}
                      onChange={(e) => setSystemConfig({...systemConfig, openCodeModel: e.target.value})}
                      placeholder="opencode-go/minimax-m3"
                    />
                    <p className="text-xs text-indigo-500 mt-2 font-medium">※ 默认模型为 opencode-go/minimax-m3，同时支持各种 MiniMax、OpenCode 等兼容的模型名称（如 minimax-m3，abab6.5s-chat ）。</p>
                  </div>
                </div>
              </details>

              <details className="group border border-gray-200 rounded-xl bg-white overflow-hidden shadow-sm" open>
                <summary className="font-bold text-gray-800 bg-gray-50 p-4 cursor-pointer list-none flex justify-between items-center hover:bg-gray-100 transition-colors">
                  <div className="flex items-center gap-2"><Film size={18} className="text-orange-500"/> 视频渲染与音视频质量配置</div>
                  <ChevronDown className="w-5 h-5 text-gray-400 group-open:rotate-180 transition-transform" />
                </summary>
                <div className="p-5 border-t border-gray-200 space-y-4 bg-white">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block mb-1 font-semibold text-gray-700">视频渲染核心引擎方案：</label>
                      <select 
                        className="w-full p-2.5 border border-gray-200 rounded-lg outline-none bg-white font-medium text-orange-700"
                        value={systemConfig.videoRenderScheme || 'server'}
                        onChange={(e) => setSystemConfig({...systemConfig, videoRenderScheme: e.target.value})}
                      >
                        <option value="server">服务端 FFmpeg 引擎 (排队单通道)</option>
                        <option value="client">客户端 WebCodecs 引擎 (显卡GPU本地极限压制 · 极力推荐)</option>
                      </select>
                      <p className="text-xs text-gray-400 mt-1">
                        ※ <strong>客户端 WebCodecs</strong> 方案使用您本机的显卡和 GPU 硬解码和编码，秒级完成 1080P 渲染。服务器零压力，稳定度 100%。
                      </p>
                    </div>
                    <div>
                      <label className="block mb-1 font-semibold text-gray-700">合成视频帧率 (FPS)：</label>
                      <select 
                        className="w-full p-2.5 border border-gray-200 rounded-lg outline-none bg-white font-medium text-orange-700 animate-fade-in"
                        value={systemConfig.videoFps !== undefined ? systemConfig.videoFps : 60}
                        onChange={(e) => setSystemConfig({...systemConfig, videoFps: parseInt(e.target.value) || 60})}
                      >
                        <option value={60}>60 FPS (德味超丝滑 · 默认)</option>
                        <option value={30}>30 FPS (常规流畅)</option>
                      </select>
                      <p className="text-xs text-gray-400 mt-1">※ 60 帧会让平移、缩放（Pan/Zoom）及视频切片转场流畅度提升一倍，适合精致细节展示。</p>
                    </div>
                    <div>
                      <label className="block mb-1 font-semibold text-gray-700">1080P/2K 视频压缩与码率：</label>
                      <select 
                        className="w-full p-2.5 border border-gray-200 rounded-lg outline-none bg-white font-medium text-orange-700"
                        value={systemConfig.videoQualityMode || 'highSharpen'}
                        onChange={(e) => setSystemConfig({...systemConfig, videoQualityMode: e.target.value})}
                      >
                        <option value="highSharpen">强制高清晰度 (CRF 17 + 15M~25M高码率 · 默认)</option>
                        <option value="standard">标准清晰度 (常规 CRF + 8M~18M码率)</option>
                      </select>
                      <p className="text-xs text-gray-400 mt-1">※ 开启高清晰度会强制将 CRF 压缩参数设定为 17 并提高码率，即使经过小红书压缩依旧保持超高锐度。</p>
                    </div>
                  </div>
                  <div>
                    <label className="block mb-1 font-semibold text-gray-700">Rec.709 (BT.709) 色彩空间与色域保护：</label>
                    <select 
                      className="w-full p-2.5 border border-gray-200 rounded-lg outline-none bg-white font-medium text-orange-700"
                      value={systemConfig.videoColorProtection || 'bt709'}
                      onChange={(e) => setSystemConfig({...systemConfig, videoColorProtection: e.target.value})}
                    >
                      <option value="bt709">开启保护 (锁定 Rec. 709 与 YUV420P 色域 · 默认)</option>
                      <option value="none">关闭保护 (使用默认色彩空间)</option>
                    </select>
                    <p className="text-xs text-gray-400 mt-1">※ 开启后，在 FFmpeg 合成滤镜中自动应用 BT.709 色彩映射和格式转换，能确保 HDR/10-bit 等素材在手机端/小红书里看到的亮度和色彩质感与您在电脑上看到的一致，防止饱和度下降和色彩断层。</p>
                  </div>
                </div>
              </details>

              <details className="group border border-gray-200 rounded-xl bg-white overflow-hidden shadow-sm" open>
                <summary className="font-bold text-gray-800 bg-gray-50 p-4 cursor-pointer list-none flex justify-between items-center hover:bg-gray-100 transition-colors">
                  <div className="flex items-center gap-2"><Folder size={18} className="text-emerald-500"/> 背景音乐 (BGM) 目录配置</div>
                  <ChevronDown className="w-5 h-5 text-gray-400 group-open:rotate-180 transition-transform" />
                </summary>
                <div className="p-5 border-t border-gray-200 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between bg-emerald-50/50 p-4 rounded-xl border border-emerald-100 gap-3">
                    <div>
                      <h4 className="font-semibold text-emerald-900 text-sm flex items-center gap-1">打开音频资源存放目录</h4>
                      <p className="text-xs text-emerald-700/80 mt-1 leading-relaxed">
                        点击右侧/下方按钮将调用所在主机的默认资源管理器打开背景音乐存放文件夹（`bgm`）。您可以将 `.mp3` 或 `.wav` 音频文件直接放入该文件夹中。
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const res = await fetch('/api/config/open-bgm', { method: 'POST' });
                          const data = await res.json();
                          if (res.ok) {
                            alert(`📂 成功打开背景音乐目录!\n路径: ${data.path || ''}`);
                          } else {
                            alert(`❌ 无法打开目录: ${data.error || '未知错误'}`);
                          }
                        } catch (err: any) {
                          alert(`❌ 请求失败: ${err.message}`);
                        }
                      }}
                      className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-bold rounded-xl transition-colors shadow-sm flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
                    >
                      <Folder size={14} /> 一键打开 BGM 目录
                    </button>
                  </div>
                </div>
              </details>

              <details className="group border border-gray-200 rounded-xl bg-white overflow-hidden shadow-sm" open>
                <summary className="font-bold text-gray-800 bg-gray-50 p-4 cursor-pointer list-none flex justify-between items-center hover:bg-gray-100 transition-colors">
                  <div className="flex items-center gap-2"><Share2 size={18} className="text-red-500"/> 小红书平台配置</div>
                  <ChevronDown className="w-5 h-5 text-gray-400 group-open:rotate-180 transition-transform" />
                </summary>
                <div className="p-5 border-t border-gray-200 space-y-4">
                  <div>
                    <label className="block mb-1 font-semibold text-gray-700">小红书作者主页链接 (Homepage URL)：</label>
                    <input
                      type="text"
                      className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 outline-none text-sm font-sans"
                      value={systemConfig.xhsHomepageUrl || ''}
                      onChange={(e) => setSystemConfig({...systemConfig, xhsHomepageUrl: e.target.value})}
                      placeholder="例如: https://www.xiaohongshu.com/user/profile/xxxxxxxxxxxx"
                    />
                    <p className="text-xs text-gray-400 mt-2">※ 用于在视频发布成功或发布异常时，一键跳转到您对应的小红书主页，以便手动/自动提取并回填最新发布的笔记链接。</p>
                  </div>
                  
                  <div className="pt-2 border-t border-dashed border-gray-200">
                    <label className="block mb-1 font-semibold text-gray-700 flex items-center justify-between">
                      <span>小红书AI文案提示词模板：</span>
                      <span className="text-xs font-normal text-red-500 font-mono">* 必填且不能为空</span>
                    </label>
                    <textarea
                      rows={8}
                      className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 outline-none text-xs font-sans leading-relaxed bg-zinc-50"
                      value={systemConfig.xhsPrompt || ''}
                      onChange={(e) => setSystemConfig({...systemConfig, xhsPrompt: e.target.value})}
                      placeholder="输入生成小红书笔记文案的提示词模板..."
                    />
                    <p className="text-xs text-gray-500 mt-1.5 leading-relaxed bg-zinc-50 p-2.5 rounded-lg border border-zinc-150">
                      💡 默认值已预设。您可以在您的自定义模版中使用 <span className="bg-amber-100 text-amber-800 px-1 py-0.5 rounded border border-amber-200 font-semibold font-mono text-[11px]">{'{storyboardTexts}'}</span> 作为分镜占位。生成时系统会用真实的分镜脚本或视频大纲文本自动替换此部分。
                    </p>
                  </div>
                </div>
              </details>
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
                  {galleryImages.map(imgData => {
                    const img = imgData.path;
                    return (
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
                      <img 
                        src={`/api/thumbnails/${img.startsWith('uploads/') ? 'uploads' : 'downloads'}/${img.replace(/^uploads\//, '')}?t=${galleryUpdateToken}`} 
                        className="w-full h-full object-contain" 
                        loading="lazy" 
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      />
                      {imgData.resolutionTag && (
                        <div className={`absolute top-1.5 left-1.5 z-10 px-1.5 py-0.5 rounded text-[8px] font-bold text-white shadow-sm pointer-events-none uppercase tracking-wider ${
                          imgData.resolutionTag === '4K' ? 'bg-red-600/90' :
                          imgData.resolutionTag === '2K' ? 'bg-blue-600/90' :
                          'bg-gray-700/80'
                        }`}>
                          {imgData.resolutionTag}
                        </div>
                      )}
                      {selectedGalleryImages.has(img) && (
                        <div className="absolute inset-0 bg-blue-500/20 flex items-center justify-center">
                          <CheckCircle2 className="text-white drop-shadow-md" size={32} />
                        </div>
                      )}
                    </div>
                  )})}
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
              {/* Interactive Zoom/Pan Viewport */}
              <div 
                ref={viewingContainerRef}
                className="relative w-full h-[70vh] overflow-hidden bg-neutral-900 rounded-xl flex items-center justify-center cursor-grab active:cursor-grabbing border border-neutral-800 shadow-2xl select-none"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setImgIsDragging(true);
                  setImgDragStart({ x: e.clientX - imgOffset.x, y: e.clientY - imgOffset.y });
                }}
                onMouseMove={(e) => {
                  if (!imgIsDragging) return;
                  e.preventDefault();
                  setImgOffset({
                    x: e.clientX - imgDragStart.x,
                    y: e.clientY - imgDragStart.y
                  });
                }}
                onMouseUp={() => setImgIsDragging(false)}
                onMouseLeave={() => setImgIsDragging(false)}
                onTouchStart={(e) => {
                  if (e.touches.length === 1) {
                    setImgIsDragging(true);
                    const touch = e.touches[0];
                    setImgDragStart({ x: touch.clientX - imgOffset.x, y: touch.clientY - imgOffset.y });
                  }
                }}
                onTouchMove={(e) => {
                  if (!imgIsDragging || e.touches.length !== 1) return;
                  const touch = e.touches[0];
                  setImgOffset({
                    x: touch.clientX - imgDragStart.x,
                    y: touch.clientY - imgDragStart.y
                  });
                }}
                onTouchEnd={() => setImgIsDragging(false)}
              >
                <img 
                  src={viewingImage} 
                  style={{
                    transform: `translate(${imgOffset.x}px, ${imgOffset.y}px) scale(${imgZoom})`,
                    transition: imgIsDragging ? 'none' : 'transform 0.1s ease-out',
                    maxHeight: '100%',
                    maxWidth: '100%',
                    objectFit: 'contain'
                  }}
                  className="pointer-events-none rounded shadow-lg" 
                  alt="Preview"
                />

                {/* Floating Controller Panel overlay */}
                <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex items-center gap-2 bg-neutral-950/85 backdrop-blur-md px-4 py-2 rounded-full border border-neutral-800 text-white select-none shadow-xl">
                  <button 
                    onClick={() => setImgZoom(prev => Math.max(0.5, prev - 0.25))}
                    className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-neutral-800 transition active:scale-90"
                    title="缩小"
                  >
                    <Minus size={16} />
                  </button>
                  <span className="font-mono text-xs px-2 min-w-[50px] text-center text-neutral-300">
                    {Math.round(imgZoom * 100)}%
                  </span>
                  <button 
                    onClick={() => setImgZoom(prev => Math.min(15, prev + 0.25))}
                    className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-neutral-800 transition active:scale-90"
                    title="放大"
                  >
                    <Plus size={16} />
                  </button>
                  <div className="w-[1px] h-4 bg-neutral-800 mx-1"></div>
                  <button 
                    onClick={() => { setImgZoom(1); setImgOffset({ x: 0, y: 0 }); }}
                    className="px-3 py-1 text-xs font-semibold rounded-full bg-neutral-800 hover:bg-neutral-700 transition active:scale-90 text-neutral-200"
                  >
                    重置
                  </button>
                </div>
              </div>

              {/* Close Button on top corner */}
              <button 
                onClick={() => setViewingImage(null)}
                className="absolute -top-3 -right-3 w-10 h-10 bg-white text-gray-900 rounded-full flex items-center justify-center shadow-xl hover:bg-gray-100 transition-colors z-[1001]"
              >
                <X size={24} />
              </button>
            </div>
            
            <div className="mt-4 flex flex-col items-center gap-3 w-full">
              <div className="flex justify-center gap-4 w-full">
                <a href={viewingImage} download className="flex-1 max-w-[160px] bg-white text-gray-900 px-6 py-2.5 rounded-full font-bold hover:bg-gray-100 transition shadow-lg text-center text-sm">下载图片</a>
                <button onClick={() => setViewingImage(null)} className="flex-1 max-w-[160px] bg-gray-800 text-white px-6 py-2.5 rounded-full font-bold hover:bg-gray-700 transition shadow-lg text-sm">关闭预览</button>
              </div>
              
              <p className="text-white/40 text-xs text-center">
                💡 提示：在图片框内滚动 <b>鼠标滑轮</b> 可自由放大/缩小，<b>按住左键拖拽</b> 可以移动画面。
              </p>
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
                <a 
                  href={(() => {
                    if (!viewingVideo) return '';
                    const cleanPath = viewingVideo.startsWith('/downloads/videos/')
                      ? viewingVideo.substring('/downloads/videos/'.length)
                      : viewingVideo;
                    return `/api/video/download-apple?videoPath=${encodeURIComponent(cleanPath)}`;
                  })()} 
                  download 
                  className="flex-1 max-w-[160px] bg-white text-gray-900 px-6 py-3 rounded-full font-bold hover:bg-gray-100 transition shadow-lg text-center"
                >
                  下载视频
                </a>
                <button onClick={() => setViewingVideo(null)} className="flex-1 max-w-[160px] bg-gray-800 text-white px-6 py-3 rounded-full font-bold hover:bg-gray-700 transition shadow-lg">关闭预览</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {viewingXhsNotes && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[999]" onClick={() => setViewingXhsNotes(null)}>
          <div className="relative bg-white w-full lg:max-w-6xl md:max-w-4xl max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <div className="bg-red-50 p-4 border-b border-red-100 flex justify-between items-center">
              <h2 className="text-xl font-bold text-red-600 flex items-center gap-2"><Target size={24}/> 小红书笔记详情</h2>
              <div className="flex items-center gap-2">
                <button 
                  disabled={isGeneratingXhs}
                  onClick={async () => {
                    const coverImage = viewingXhsNotes.taskData?.xhsCoverImage || (viewingXhsNotes.taskData?.storyboards && viewingXhsNotes.taskData.storyboards[0]?.image);
                    if (!coverImage) {
                      alert('请先上传或生成至少一个视频分镜，或在右侧设置“小红书封面图”！本系统会把图片提供给大模型参考，生成更契合封面风格的爆款标题、正文与话题。');
                      return;
                    }
                    setIsGeneratingXhs(true);
                    try {
                      const response = await fetch('/api/videos/xhs/generate', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          storyboards: viewingXhsNotes.taskData?.storyboards || [],
                          videoName: viewingXhsNotes.videoId.split('/').pop() || '',
                          xhsCoverImage: coverImage
                        })
                      });
                      const resData = await response.json();
                      if (!response.ok) {
                        throw new Error(resData.error || 'AI 自动生成错误');
                      }
                      setViewingXhsNotes({
                        ...viewingXhsNotes,
                        taskData: {
                          ...viewingXhsNotes.taskData,
                          xhsTitle: resData.xhsTitle || '',
                          xhsBody: resData.xhsBody || '',
                          xhsTags: resData.xhsTags || ''
                        }
                      });
                    } catch (e: any) {
                      console.error(e);
                      alert(e.message || 'AI 生成失败，请重试');
                    } finally {
                      setIsGeneratingXhs(false);
                    }
                  }}
                  className="px-3 py-1.5 flex items-center gap-1 text-sm font-bold bg-indigo-50 text-indigo-600 border border-indigo-200 hover:bg-indigo-100 transition-colors rounded-lg disabled:opacity-50"
                >
                  <Sparkles size={16} className={isGeneratingXhs ? "animate-spin text-indigo-500" : ""}/>
                  {isGeneratingXhs ? "生成中..." : "AI 自动生成"}
                </button>
                <button onClick={() => setViewingXhsNotes(null)} className="text-red-400 hover:text-red-600 p-1"><X size={24}/></button>
              </div>
            </div>
            
            <div className="p-6 overflow-y-auto w-full grid grid-cols-1 lg:grid-cols-3 gap-6 bg-gray-50">
              <div className="space-y-4 lg:col-span-1">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">小红书标题</label>
                  <input
                    type="text"
                    placeholder="填写吸引人的标题..."
                    value={viewingXhsNotes.taskData?.xhsTitle || ''}
                    onChange={e => setViewingXhsNotes({ ...viewingXhsNotes, taskData: { ...viewingXhsNotes.taskData, xhsTitle: e.target.value } })}
                    className="w-full p-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-red-500 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">小红书话题</label>
                  <input
                    type="text"
                    placeholder="#摄影 #日常 ..."
                    value={viewingXhsNotes.taskData?.xhsTags || ''}
                    onChange={e => setViewingXhsNotes({ ...viewingXhsNotes, taskData: { ...viewingXhsNotes.taskData, xhsTags: e.target.value } })}
                    className="w-full p-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-red-500 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">小红书正文</label>
                  <textarea
                    rows={6}
                    placeholder="填写笔记正文内容..."
                    value={viewingXhsNotes.taskData?.xhsBody || ''}
                    onChange={e => setViewingXhsNotes({ ...viewingXhsNotes, taskData: { ...viewingXhsNotes.taskData, xhsBody: e.target.value } })}
                    className="w-full p-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-red-500 text-sm"
                  ></textarea>
                </div>
              </div>

              <div className="lg:col-span-1">
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm font-bold text-gray-700">笔记封面图</label>
                  <select 
                    className="text-xs p-1.5 rounded border border-gray-200 bg-white"
                    value={viewingXhsNotes.taskData?.xhsCoverAspectRatio || '3:4'}
                    onChange={e => setViewingXhsNotes({ ...viewingXhsNotes, taskData: { ...viewingXhsNotes.taskData, xhsCoverAspectRatio: e.target.value as any } })}
                  >
                    <option value="3:4">3:4 (推荐)</option>
                    <option value="4:3">4:3</option>
                    <option value="9:16">9:16 (竖屏)</option>
                    <option value="16:9">16:9 (横屏)</option>
                  </select>
                </div>
                <div className="relative w-[200px] sm:w-[240px] mx-auto bg-gray-200 rounded-lg overflow-hidden border-2 border-dashed border-gray-300 flex items-center justify-center flex-col shadow-sm cursor-pointer hover:border-red-400 group transition-all"
                     onClick={() => { setShowXhsStoryboardCoverPicker(true); }}
                     style={{
                       aspectRatio: viewingXhsNotes.taskData?.xhsCoverAspectRatio === '16:9' ? '16/9' :
                                    viewingXhsNotes.taskData?.xhsCoverAspectRatio === '4:3' ? '4/3' :
                                    viewingXhsNotes.taskData?.xhsCoverAspectRatio === '9:16' ? '9/16' : '3/4'
                     }}
                >
                  {viewingXhsNotes.taskData?.xhsCoverImage || (viewingXhsNotes.taskData?.storyboards && viewingXhsNotes.taskData.storyboards.length > 0 && viewingXhsNotes.taskData.storyboards[0].image) ? (
                    <>
                      <img 
                        src={(() => {
                          const url = viewingXhsNotes.taskData.xhsCoverImage || (viewingXhsNotes.taskData.storyboards && viewingXhsNotes.taskData.storyboards[0]?.image);
                          if (!url) return '';
                          if (url.startsWith('data:')) return url;
                          if (url.startsWith('/downloads/') || url.startsWith('/uploads/')) return `${url}?t=${Date.now()}`;
                          if (!url.startsWith('http')) return url;
                          return `/api/proxy?url=${encodeURIComponent(url)}`.replace('&', '%26');
                        })()}
                        className="absolute inset-0 w-full h-full object-cover" 
                        alt="Cover"
                      />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all">
                        <p className="text-white font-bold text-sm bg-black/60 px-3 py-1.5 rounded-lg flex items-center gap-1"><ImageIcon size={14}/> 更换封面</p>
                      </div>
                    </>
                  ) : (
                    <div className="text-gray-400 flex flex-col items-center">
                      <ImageIcon size={32} className="mb-2 opacity-50" />
                      <span className="text-xs font-medium">点击设置封面图</span>
                    </div>
                  )}
                </div>
                <div className="flex justify-center gap-2 mt-3">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowXhsStoryboardCoverPicker(true);
                    }}
                    className="px-3 py-1.5 bg-gray-50 hover:bg-gray-100 active:bg-gray-200 text-gray-700 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1 border border-gray-200 shadow-sm"
                  >
                    <ImageIcon size={13} /> 更换封面
                  </button>
                  {(viewingXhsNotes.taskData?.xhsCoverImage || (viewingXhsNotes.taskData?.storyboards && viewingXhsNotes.taskData.storyboards.length > 0 && viewingXhsNotes.taskData.storyboards[0].image)) && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const url = viewingXhsNotes.taskData.xhsCoverImage || (viewingXhsNotes.taskData?.storyboards && viewingXhsNotes.taskData.storyboards[0]?.image);
                        if (url) {
                          setCropperImageSrc(url);
                        }
                      }}
                      className="px-3 py-1.5 bg-red-50 hover:bg-red-100 active:bg-red-200 text-red-600 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1 border border-red-200 shadow-sm animate-pulse-subtle"
                    >
                      <Crop size={13} /> 裁剪封面
                    </button>
                  )}
                </div>
              </div>

              {/* Column 3: Xiaohongshu Real Mobile Live Preview */}
              <div className="lg:col-span-1 lg:row-span-2 flex flex-col justify-start items-center bg-white border border-gray-150 p-4 rounded-2xl shadow-inner max-h-[75vh]">
                <div className="text-xs font-bold text-gray-500 mb-3 flex items-center gap-1.5 self-start select-none">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                  小红书真机排版模拟预览 (1:1 还原)
                </div>
                <div className="overflow-y-auto w-full scrollbar-none flex justify-center">
                  <XhsPhonePreview 
                    title={viewingXhsNotes.taskData?.xhsTitle || ''}
                    content={viewingXhsNotes.taskData?.xhsBody || ''}
                    tags={viewingXhsNotes.taskData?.xhsTags || ''}
                    coverImage={viewingXhsNotes.taskData?.xhsCoverImage || (viewingXhsNotes.taskData?.storyboards && viewingXhsNotes.taskData.storyboards[0]?.image)}
                    aspectRatio={viewingXhsNotes.taskData?.xhsCoverAspectRatio || '3:4'}
                    authorName={user?.username || '小红书创作者'}
                  />
                </div>
              </div>

              {/* Timing/Publish Settings (小红书定时与发布) */}
              <div className="lg:col-span-2 pt-4 mt-2 border-t border-gray-100">
                <h3 className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-1.5">
                  <span className="w-1.5 h-3 bg-red-500 rounded-full"></span>
                  定时发布及立即发布设置
                </h3>
                
                <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                  <div className="mb-4 flex items-center gap-2 border-b border-gray-50 pb-3">
                    <label className="flex items-center gap-2 text-xs font-bold text-gray-750 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={xhsIsDraft}
                        onChange={e => {
                          const val = e.target.checked;
                          setXhsIsDraft(val);
                          if (val) {
                            setScheduledPublishTime('');
                          }
                        }}
                        className="w-4 h-4 text-red-500 border-gray-300 rounded focus:ring-red-400 accent-red-500 cursor-pointer"
                        id="modal-xhs-is-draft-checkbox"
                      />
                      <span className="flex items-center gap-1.5 text-red-600 font-bold text-sm">
                        📦 仅存为小红书草稿 (勾选后自动禁用定时，启动后自动化将点击“暂存离开”)
                      </span>
                    </label>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <label className="block text-xs font-bold text-gray-700 flex items-center gap-1">
                          <Calendar size={13} />
                          选择定时发布时间 (不选则为立即开始自动化发布)
                        </label>
                        {xhsIsDraft && (
                          <span className="text-[10px] text-amber-600 font-semibold bg-amber-50 px-1.5 py-0.5 rounded">
                            草稿已禁用定时
                          </span>
                        )}
                      </div>
                      <input 
                        type="datetime-local" 
                        value={xhsIsDraft ? '' : scheduledPublishTime}
                        onChange={e => setScheduledPublishTime(e.target.value)}
                        disabled={xhsIsDraft}
                        className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:border-red-400 transition ${
                          xhsIsDraft ? 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed' : 'bg-gray-50 border-gray-200'
                        }`}
                      />
                    </div>
                    
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          if (!viewingXhsNotes.taskData?.xhsTitle) {
                            alert('请输入笔记标题后再操作');
                            return;
                          }
                          try {
                            setIsSavingConfig(true);
                            // 1. First save metadata configuration
                            const saveRes = await fetch('/api/videos/xhs', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ videoPath: viewingXhsNotes.videoId, taskData: viewingXhsNotes.taskData })
                            });
                            const saveResult = await saveRes.json();
                            const resolvedCoverPath = saveResult.coverImage || viewingXhsNotes.taskData.xhsCoverImage || (viewingXhsNotes.taskData?.storyboards && viewingXhsNotes.taskData.storyboards[0]?.image);
                            
                            // 2. Trigger Publish API
                            const res = await fetch('/api/videos/xhs/publish', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                videoPath: viewingXhsNotes.videoId,
                                coverPath: resolvedCoverPath,
                                title: viewingXhsNotes.taskData.xhsTitle,
                                content: viewingXhsNotes.taskData.xhsBody,
                                tags: viewingXhsNotes.taskData.xhsTags,
                                scheduledAt: xhsIsDraft ? null : (scheduledPublishTime ? new Date(scheduledPublishTime).toISOString() : null),
                                isDraft: xhsIsDraft
                              })
                            });
                            const result = await res.json();
                            if (result.success) {
                              if (result.scheduled) {
                                alert(`成功加入小红书定时发布队列！计划发布时间: ${scheduledPublishTime}`);
                                setViewingXhsNotes(null);
                              } else {
                                // Close setting modal and open immediate progress visualizer
                                setViewingXhsNotes(null);
                                setPublishingXhsNoteId(result.noteId);
                              }
                            } else {
                              alert('发布失败: ' + result.error);
                            }
                          } catch (err: any) {
                            alert('操作异常: ' + (err.message || err));
                          } finally {
                            setIsSavingConfig(false);
                            setScheduledPublishTime('');
                          }
                        }}
                        className="flex-1 py-2 px-4 text-sm font-bold text-white bg-red-500 hover:bg-red-600 active:bg-red-700 rounded-lg transition shadow-sm flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Share2 size={16}/>
                        {xhsIsDraft ? '立即暂存为草稿' : (scheduledPublishTime ? '确认定时发布' : '立即开始自动化发布')}
                      </button>
                      {scheduledPublishTime && (
                        <button
                          type="button"
                          onClick={() => setScheduledPublishTime('')}
                          className="px-3 py-2 text-sm text-gray-500 hover:bg-gray-100 rounded-lg font-medium transition"
                        >
                          重置为立即发布
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-gray-100 bg-white flex justify-end gap-3 rounded-b-2xl">
              <button 
                onClick={handleDownloadXhsPackage}
                className="px-4 py-2 font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors flex items-center gap-2 border border-indigo-200 mr-auto disabled:opacity-50"
                disabled={isPackagingZip}
                title="一键打包下载：视频文件、封面图片和文本格式的标题、正文、话题文案"
              >
                {isPackagingZip ? (
                  <div className="animate-spin h-4 w-4 border-2 border-indigo-600 rounded-full border-t-transparent"></div>
                ) : (
                  <Download size={18}/>
                )}
                打包下载笔记资源
              </button>
              <button 
                onClick={() => setViewingXhsNotes(null)}
                className="px-4 py-2 font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                disabled={isSavingConfig}
              >
                取消
              </button>
              <button 
                onClick={async () => {
                  try {
                    setIsSavingConfig(true);
                    await fetch('/api/videos/xhs', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ videoPath: viewingXhsNotes.videoId, taskData: viewingXhsNotes.taskData })
                    });
                    setViewingXhsNotes(null);
                    fetchVideoGallery();
                  } catch(e) {
                    alert('保存失败');
                  } finally {
                    setIsSavingConfig(false);
                  }
                }}
                className="px-4 py-2 font-bold text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors flex items-center gap-2"
                disabled={isSavingConfig}
              >
                {isSavingConfig ? <div className="animate-spin h-4 w-4 border-2 border-white rounded-full border-t-transparent"></div> : <CheckCircle2 size={18}/>}
                保存配置
              </button>
            </div>
          </div>
        </div>
      )}

      {showXhsStoryboardCoverPicker && viewingXhsNotes && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-[1000]" id="xhs-storyboard-cover-picker-modal">
          <div className="bg-white p-6 rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col relative animate-in fade-in zoom-in-95 duration-150">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <ImageIcon className="text-red-500 w-5 h-5" /> 
                从分镜中选择封面图
              </h2>
              <button 
                onClick={() => setShowXhsStoryboardCoverPicker(false)} 
                className="text-gray-400 hover:text-gray-600 p-1.5 hover:bg-gray-50 rounded-full transition"
              >
                <X size={20}/>
              </button>
            </div>
            
            <div className="flex-grow overflow-y-auto mb-4 pr-2">
              {(!viewingXhsNotes.taskData?.storyboards || viewingXhsNotes.taskData.storyboards.filter(sb => sb.image).length === 0) ? (
                <div className="text-center py-16 text-gray-500 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                  <ImageIcon className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p className="font-semibold text-gray-700">暂无可用的分镜图片</p>
                  <p className="text-xs text-gray-400 mt-1">此任务分镜中还没有图片，无法直接选择</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {viewingXhsNotes.taskData.storyboards
                    .map((sb, idx) => {
                      if (!sb.image) return null;
                      const isCurrentCover = viewingXhsNotes.taskData.xhsCoverImage === sb.image;
                      
                      // Resolve image url
                      const imgUrl = (() => {
                        const url = sb.image;
                        if (url.startsWith('data:')) return url;
                        if (url.startsWith('/downloads/') || url.startsWith('/uploads/')) return url;
                        if (!url.startsWith('http')) return url;
                        return `/api/proxy?url=${encodeURIComponent(url)}`.replace('&', '%26');
                      })();

                      return (
                        <div 
                          key={sb.id || idx} 
                          onClick={() => {
                            setViewingXhsNotes({
                              ...viewingXhsNotes,
                              taskData: {
                                ...viewingXhsNotes.taskData,
                                xhsCoverImage: sb.image
                              }
                            });
                            setCropperImageSrc(imgUrl);
                            setShowXhsStoryboardCoverPicker(false);
                          }}
                          className={`group relative aspect-[3/4] rounded-xl overflow-hidden border-2 cursor-pointer transition-all ${
                            isCurrentCover ? 'border-red-500 shadow-md ring-2 ring-red-500/25' : 'border-gray-150 hover:border-red-400'
                          }`}
                        >
                          <img 
                            src={imgUrl} 
                            className="w-full h-full object-cover transition-transform duration-350 group-hover:scale-105" 
                            loading="lazy" 
                          />
                          <div className="absolute top-2 left-2 z-10 bg-black/60 backdrop-blur-sm text-white px-2 py-0.5 rounded text-[10px] font-bold">
                            分镜 {idx + 1}
                          </div>
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all">
                            <span className="text-white text-xs font-bold bg-red-600 px-2.5 py-1.5 rounded-lg shadow flex items-center gap-1">
                              <Crop size={12} /> 裁剪设为封面
                            </span>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
            
            <div className="flex justify-end pt-2 border-t border-gray-50">
              <button 
                onClick={() => setShowXhsStoryboardCoverPicker(false)} 
                className="px-4 py-2 text-xs font-bold text-gray-600 bg-gray-50 border border-gray-200 hover:bg-gray-100 rounded-lg transition"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {showXhsGalleryPicker && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-[1000]">
          <div className="bg-white p-6 rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">选择笔记封面图</h2>
              <button onClick={() => setShowXhsGalleryPicker(false)} className="text-gray-400 hover:text-gray-600"><X size={24}/></button>
            </div>
            
            <div className="flex-grow overflow-y-auto mb-6 pr-2">
              {galleryImages.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <ImageIcon className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p>图库中暂无图片</p>
                </div>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                  {galleryImages.map(imgData => {
                    const img = imgData.path;
                    return (
                    <div 
                      key={img} 
                      onClick={() => {
                        const finalImageUrl = img.startsWith('uploads/') ? `/${img}` : `/downloads/${img}`;
                        setCropperImageSrc(finalImageUrl);
                        setShowXhsGalleryPicker(false);
                      }}
                      className="relative aspect-square rounded-lg overflow-hidden border-2 cursor-pointer transition-all border-gray-200 hover:border-red-400"
                    >
                      <img 
                        src={`/api/thumbnails/${img.startsWith('uploads/') ? 'uploads' : 'downloads'}/${img.replace(/^uploads\//, '')}?t=${galleryUpdateToken}`} 
                        className="w-full h-full object-cover" 
                        loading="lazy" 
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      />
                      {imgData.resolutionTag && (
                        <div className={`absolute top-1.5 left-1.5 z-10 px-1.5 py-0.5 rounded text-[8px] font-bold text-white shadow-sm pointer-events-none uppercase tracking-wider ${
                          imgData.resolutionTag === '4K' ? 'bg-red-600/90' :
                          imgData.resolutionTag === '2K' ? 'bg-blue-600/90' :
                          'bg-gray-700/80'
                        }`}>
                          {imgData.resolutionTag}
                        </div>
                      )}
                    </div>
                  )})}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {cropperImageSrc && viewingXhsNotes && (
        <ImageCropper
          imageSrc={cropperImageSrc}
          aspectRatio={viewingXhsNotes.taskData?.xhsCoverAspectRatio || '3:4'}
          onClose={() => setCropperImageSrc(null)}
          onCropComplete={(base64Url) => {
            setViewingXhsNotes({
              ...viewingXhsNotes,
              taskData: {
                ...viewingXhsNotes.taskData,
                xhsCoverImage: base64Url
              }
            });
            setCropperImageSrc(null);
          }}
        />
      )}

      {croppingVideo && (
        <VideoCropper
          videoUrl={`/downloads/videos/${croppingVideo.path}`}
          videoPath={croppingVideo.path}
          onClose={() => setCroppingVideo(null)}
          onCropComplete={() => {
            setCroppingVideo(null);
            fetchVideoGallery();
          }}
        />
      )}

      {changingBgmVideo && (
        <VideoBgmChanger
          videoUrl={`/downloads/videos/${changingBgmVideo.path}`}
          videoPath={changingBgmVideo.path}
          onClose={() => setChangingBgmVideo(null)}
          onComplete={() => {
            setChangingBgmVideo(null);
            fetchVideoGallery();
          }}
        />
      )}

      {/* Xiaohongshu Publishing Progress Overlay Dialog */}
      {publishingXhsNoteId !== null && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-[2000] animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden border border-gray-100">
            {/* Header */}
            <div className="bg-gradient-to-r from-red-500 to-rose-600 p-5 text-white flex items-center gap-2.5">
              <Share2 className="animate-pulse" size={22} />
              <div>
                <h3 className="font-bold text-base">小红书 CDP 自动化发布引擎</h3>
                <p className="text-[10px] text-red-100 mt-0.5">正在使用 Chrome DevTools 协议模拟人工提审流程</p>
              </div>
            </div>

            {/* Body */}
            <div className="p-6 flex flex-col items-center">
              {/* Spinning / Circle progress */}
              <div className="relative w-24 h-24 flex items-center justify-center mb-5">
                <div className="absolute inset-0 border-4 border-gray-100 rounded-full"></div>
                <div className="absolute inset-0 border-4 border-red-500 rounded-full border-t-transparent animate-spin"></div>
                <div className="text-red-500 text-lg font-black font-mono">
                  {xhsPublishProgress?.progress || 0}%
                </div>
              </div>

              {/* Status information */}
              <h4 className="font-bold text-gray-800 text-sm mb-1.5">
                {xhsPublishProgress?.status === 'success' ? '🎉 发布成功！' :
                 xhsPublishProgress?.status === 'failed' ? '❌ 发布失败' :
                 '🚀 自动化执行中...'}
              </h4>
              <p className="text-xs text-gray-500 text-center bg-gray-50 border border-gray-100 px-4 py-2.5 rounded-xl font-medium w-full min-h-[3.5rem] flex items-center justify-center leading-relaxed">
                {xhsPublishProgress?.message || '正在初始化发布队列状态...'}
              </p>

              {/* Success links / Error messages */}
              {xhsPublishProgress?.status === 'success' && xhsPublishProgress?.progress === 100 && (
                <div className="mt-4 w-full text-center">
                  <p className="text-xs text-green-600 font-bold mb-2">恭喜，笔记已成功提交。你可以通过下方链接查看：</p>
                  <a 
                    href={xhsPublishProgress?.url || 'https://creator.xiaohongshu.com/creator/home'} 
                    target="_blank" 
                    rel="noreferrer" 
                    className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:underline"
                  >
                    <ExternalLink size={12} />
                    查看小红书笔记链接
                  </a>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-gray-50 bg-gray-50/50 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setPublishingXhsNoteId(null);
                  setXhsPublishProgress(null);
                  fetchXhsNotes();
                }}
                disabled={xhsPublishProgress?.status === 'publishing'}
                className="px-4 py-1.5 text-xs font-bold text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed shadow-sm cursor-pointer"
              >
                {xhsPublishProgress?.status === 'publishing' ? '后台静默发布中...' : '关闭弹窗'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreateGroupModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-[1000]">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-gray-100 p-6 animate-scale-in">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-gray-950 flex items-center gap-2">
                <FolderPlus className={`${createGroupType === 'video' ? 'text-blue-600' : 'text-purple-600'} w-5 h-5`} />
                新建{createGroupType === 'video' ? '视频' : '图片'}分组目录
              </h3>
              <button 
                onClick={() => setShowCreateGroupModal(false)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-50 transition"
              >
                <X size={20} />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                  中文{createGroupType === 'video' ? '视频组' : '图组'}名称
                </label>
                <input 
                  type="text"
                  placeholder={createGroupType === 'video' ? "如：宣传视频、素材备用..." : "如：工作日常、产品图库..."}
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  className={`w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:bg-white focus:ring-2 ${createGroupType === 'video' ? 'focus:ring-blue-500 focus:border-blue-500' : 'focus:ring-purple-500 focus:border-purple-500'} outline-none transition`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateGroup();
                  }}
                  autoFocus
                />
              </div>
              
              <div className="flex gap-3 justify-end pt-2">
                <button 
                  onClick={() => setShowCreateGroupModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50 border border-gray-200 rounded-lg transition"
                >
                  取消
                </button>
                <button 
                  onClick={handleCreateGroup}
                  disabled={!newGroupName.trim()}
                  className={`px-5 py-2 text-xs font-bold text-white rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed shadow-md ${
                    createGroupType === 'video' 
                      ? 'bg-blue-600 hover:bg-blue-700 shadow-blue-100' 
                      : 'bg-purple-600 hover:bg-purple-700 shadow-purple-100'
                  }`}
                >
                  创建并保存
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 批量操作浮动状态栏 */}
      {selectedImages.size > 0 && (
        <div className="fixed bottom-6 left-6 right-6 md:left-1/2 md:right-auto md:-translate-x-1/2 z-[100] bg-gray-950/95 backdrop-blur-md text-white px-5 py-3.5 rounded-2xl shadow-2xl border border-gray-800 flex flex-wrap items-center justify-between gap-4 max-w-4xl w-[calc(100%-3rem)] md:w-max md:min-w-[700px] animate-fade-in">
          <div className="flex items-center gap-3">
            <span className="bg-purple-600 text-white font-bold text-xs px-2.5 py-1 rounded-full animate-pulse">
              已选 {selectedImages.size}
            </span>
            <span className="text-xs font-semibold text-gray-300">项资源已选中</span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => {
                const allCurrentPaths = galleryImages.map(img => img.path);
                if (selectedImages.size === galleryImages.length) {
                  setSelectedImages(new Set());
                } else {
                  setSelectedImages(new Set(allCurrentPaths));
                }
              }}
              className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 transition rounded-lg text-xs font-semibold"
            >
              {selectedImages.size === galleryImages.length ? '取消全选' : '选择全部'}
            </button>

            <button
              onClick={handleBatchDownload}
              className="px-4 py-1.5 bg-purple-600 hover:bg-purple-700 transition rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-purple-950/40"
            >
              <Download size={14} /> 批量打包下载 (.zip)
            </button>

            {/* 批量移动下拉菜单 */}
            <div className="relative">
              <button
                onClick={() => setShowBatchMoveMenu(!showBatchMoveMenu)}
                className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-amber-300 transition rounded-lg text-xs font-semibold flex items-center gap-1"
              >
                <Folder size={14} /> 批量移动
                <ChevronUp size={12} className={`transition-transform duration-200 ${showBatchMoveMenu ? 'rotate-180' : ''}`} />
              </button>

              {showBatchMoveMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowBatchMoveMenu(false)} />
                  <div className="absolute bottom-full right-0 mb-3 w-52 bg-gray-900 rounded-xl shadow-2xl border border-gray-800 z-50 overflow-hidden py-1 text-left">
                    <div className="px-3 py-1.5 text-[9px] font-bold text-gray-400 border-b border-gray-800 uppercase flex items-center gap-1 bg-gray-950/50">
                      <Folder size={10} /> 批量归档至此组...
                    </div>
                    <button
                      onClick={() => handleBatchMoveToGroup(null)}
                      className="w-full text-left px-3 py-2 text-xs font-medium text-gray-200 hover:bg-gray-800 transition flex items-center gap-1.5"
                    >
                      <Folder size={12} className="text-gray-400" /> 未分组 (默认)
                    </button>
                    {assetGroups.map(grp => (
                      <button
                        key={grp.id}
                        onClick={() => handleBatchMoveToGroup(grp.id)}
                        className="w-full text-left px-3 py-2 text-xs font-medium text-gray-200 hover:bg-gray-800 transition flex items-center gap-1.5 truncate"
                        title={grp.name}
                      >
                        <Folder size={12} className="text-purple-400" /> {grp.name}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            <button
              onClick={handleBatchDeleteImages}
              className="px-3 py-1.5 bg-red-600/90 hover:bg-red-600 transition rounded-lg text-xs font-bold flex items-center gap-1.5"
              title="一键彻底清空已选资源"
            >
              <Trash2 size={14} /> 批量彻底删除
            </button>

            <div className="w-[1px] h-4 bg-gray-800 mx-1"></div>

            <button
              onClick={() => setSelectedImages(new Set())}
              className="px-2.5 py-1.5 text-gray-400 hover:text-white transition text-xs font-semibold"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
