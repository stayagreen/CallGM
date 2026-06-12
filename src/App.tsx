import React, { useState, useRef, useEffect } from 'react';
import { Plus, Trash2, Upload, Settings, X, History, Image as ImageIcon, Download, ExternalLink, List as ListIcon, CheckCircle2, Clock, PlayCircle, Edit2, Camera, ChevronDown, ChevronUp, Film, Scissors, Mic, MicOff, Paintbrush, Target, Sparkles, Crop, Share2, Calendar, Link, Eye, User, Chrome, FolderPlus, Folder } from 'lucide-react';
import ImageEditor from './ImageEditor';
import VideoEditor, { VideoTask } from './VideoEditor';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Login } from './components/Login';
import { ImageCropper } from './components/ImageCropper';

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
    videoConcurrency: 3,
    imageQuality: 'performance',
    watermarkRoiWPercent: 15,
    watermarkRoiHPercent: 10,
    dispatchStrategy: 'server',
    globalConcurrency: 3,
    headless: true,
    openCodeApiKey: '',
    openCodeApiUrl: '',
    openCodeModel: ''
  });
  const [jobs, setJobs] = useState<Job[]>([]);
  const [videoJobs, setVideoJobs] = useState<Job[]>([]);
  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set());
  const [showBatchDropdown, setShowBatchDropdown] = useState(false);
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set());
  const [galleryImages, setGalleryImages] = useState<GalleryAsset[]>([]);
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());
  const [showBatchMoveMenu, setShowBatchMoveMenu] = useState(false);
  const [assetGroups, setAssetGroups] = useState<any[]>([]);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<number>>(new Set());
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [selectedUploadGroupId, setSelectedUploadGroupId] = useState<number | null>(null);
  const [movingAssetPath, setMovingAssetPath] = useState<string | null>(null);
  const [videoGallery, setVideoGallery] = useState<GalleryAsset[]>([]);
  const [viewingImage, setViewingImage] = useState<string | null>(null);
  const [viewingVideo, setViewingVideo] = useState<string | null>(null);
  const [viewingVideoJobDetails, setViewingVideoJobDetails] = useState<Job | null>(null);
  const [viewingXhsNotes, setViewingXhsNotes] = useState<{ videoId: string, jobId?: string, taskData: VideoTask } | null>(null);
  const [showXhsGalleryPicker, setShowXhsGalleryPicker] = useState(false);
  const [cropperImageSrc, setCropperImageSrc] = useState<string | null>(null);
  const [processingGalleryImages, setProcessingGalleryImages] = useState<Set<string>>(new Set());
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
  const [showUploadMenu, setShowUploadMenu] = useState(false);
  const [showGalleryUploadMenu, setShowGalleryUploadMenu] = useState(false);
  const [showGalleryPicker, setShowGalleryPicker] = useState(false);
  const [selectedGalleryImages, setSelectedGalleryImages] = useState<Set<string>>(new Set());
  const [isMobile, setIsMobile] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [isGeneratingXhs, setIsGeneratingXhs] = useState(false);
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

  const fetchVideoJobs = async () => {
    try {
      const res = await fetch('/api/video/jobs');
      const data = await res.json();
      if (Array.isArray(data)) {
        setVideoJobs(data);
      } else {
        console.error('Invalid video jobs data:', data);
        setVideoJobs([]);
      }
    } catch (error) {
      console.error('Failed to fetch video jobs:', error);
      setVideoJobs([]);
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
        body: JSON.stringify({ name: newGroupName.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setNewGroupName('');
        setShowCreateGroupModal(false);
        fetchGallery();
      } else {
        alert(data.error || '创建图组失败');
      }
    } catch (err) {
      console.error('Failed to create group:', err);
    }
  };

  const handleMoveToGroup = async (filePath: string, groupId: number | null) => {
    try {
      const res = await fetch('/api/groups/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath, groupId }),
      });
      const data = await res.json();
      if (res.ok) {
        setMovingAssetPath(null);
        fetchGallery();
      } else {
        alert(data.error || '移动图片失败');
      }
    } catch (err) {
      console.error('Failed to move image:', err);
    }
  };

  const handleDeleteGroup = async (groupId: number) => {
    const imagesInThisGroup = galleryImages.filter(img => img.groupId === groupId);
    if (imagesInThisGroup.length > 0) {
      alert('该图组内还存在图片，不支持删除，请先将图片移动至其他分组。');
      return;
    }
    if (!window.confirm('确定要删除此图组吗？')) return;
    try {
      const res = await fetch(`/api/groups/${groupId}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (res.ok) {
        fetchGallery();
      } else {
        alert(data.error || '删除图组失败');
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
                onClick={() => setShowCreateGroupModal(true)} 
                className="px-4 py-2 text-sm font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition shadow-sm flex items-center gap-1.5"
              >
                <FolderPlus size={16} /> 新建图组
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
                          className={`absolute top-2 left-2 z-20 w-6 h-6 rounded-full flex items-center justify-center border transition-all duration-200 cursor-pointer ${
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
                      </div>
                      <div className="mt-3 px-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-500 truncate pr-2 font-medium" title={img}>{img.split('/').pop()}</span>
                          <div className="flex gap-1 relative">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!processingGalleryImages.has(img)) {
                                  setEditingGalleryImage({ filename: img, url: `/downloads/${img}?t=${galleryUpdateToken}` });
                                }
                              }}
                              disabled={processingGalleryImages.has(img)}
                              className={`p-1.5 rounded-md transition-colors ${processingGalleryImages.has(img) ? 'text-gray-300' : 'text-purple-500 hover:bg-purple-50'}`}
                              title="智能填充 (手动去水印)"
                            >
                              <Paintbrush className="w-4 h-4" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!processingGalleryImages.has(img)) {
                                  handleOneClickWatermark(img);
                                }
                              }}
                              disabled={processingGalleryImages.has(img)}
                              className={`p-1.5 rounded-md transition-colors ${processingGalleryImages.has(img) ? 'text-gray-300' : 'text-blue-500 hover:bg-blue-50'}`}
                              title="一键去水印"
                            >
                              <Scissors className="w-4 h-4" />
                            </button>
                            
                            {/* 移动至相册/图组菜单 */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!processingGalleryImages.has(img)) {
                                  setMovingAssetPath(movingAssetPath === img ? null : img);
                                }
                              }}
                              disabled={processingGalleryImages.has(img)}
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
                                if (!processingGalleryImages.has(img)) {
                                  deleteGalleryImage(img);
                                }
                              }}
                              disabled={processingGalleryImages.has(img)}
                              className={`p-1.5 rounded-md transition-colors ${processingGalleryImages.has(img) ? 'text-gray-300' : 'text-red-500 hover:bg-red-50'}`}
                              title="彻底删除源文件"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
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
                    {/* 1. Custom groups */}
                    {assetGroups.map(grp => {
                      const grpImages = galleryImages.filter(img => img.groupId === grp.id);
                      const isCollapsed = collapsedGroups.has(grp.id);
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
                              if (collapsedGroups.has(grp.id)) {
                                const newSet = new Set(collapsedGroups);
                                newSet.delete(grp.id);
                                setCollapsedGroups(newSet);
                              }
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
                                onClick={() => handleDeleteGroup(grp.id)}
                                disabled={grpImages.length > 0}
                                className={`p-1.5 rounded-md transition-colors ${grpImages.length > 0 ? 'text-gray-400 opacity-40 cursor-not-allowed' : 'text-red-500 hover:bg-red-50'}`}
                                title={grpImages.length > 0 ? '图组存在图片时不支持删除' : '删除图组'}
                              >
                                <Trash2 size={16} />
                              </button>
                              <div 
                                onClick={() => {
                                  const newSet = new Set(collapsedGroups);
                                  if (newSet.has(grp.id)) {
                                    newSet.delete(grp.id);
                                  } else {
                                    newSet.add(grp.id);
                                  }
                                  setCollapsedGroups(newSet);
                                }}
                                className="text-gray-400 hover:text-gray-600"
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
                              ) : (
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                                  {grpImages.map(renderGalleryItem)}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* 2. Unassigned default gallery */}
                    <div 
                      className={`bg-white border rounded-2xl shadow-sm overflow-hidden transition-all duration-200 ${
                        selectedUploadGroupId === null 
                          ? 'ring-2 ring-blue-500 border-blue-500' 
                          : 'border-gray-200'
                      }`}
                    >
                      <div 
                        onClick={() => setSelectedUploadGroupId(null)}
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
                            {galleryImages.filter(img => !img.groupId).length} 张图片
                          </span>
                          {selectedUploadGroupId === null && (
                            <span className="flex items-center gap-1 bg-blue-600 text-white text-[11px] px-2.5 py-0.5 rounded-full font-bold animate-pulse shadow-sm shadow-blue-500/20">
                              📌 当前粘贴/上传目标 (默认)
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="p-4 bg-gray-50/10">
                        {galleryImages.filter(img => !img.groupId).length === 0 ? (
                          <div className="text-center py-12 text-gray-400 text-sm">
                            各张图片均已划分至相对应的图组相册中，点击上方图组头部可随时切回各组或未分组
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                            {galleryImages.filter(img => !img.groupId).map(renderGalleryItem)}
                          </div>
                        )}
                      </div>
                    </div>
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
              {user?.role === 'admin' ? Object.entries(groupByUser(videoJobs)).map(([uname, jobs]: [string, any[]]) => (
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

                          {((job.status === 'completed' && job.data.outputVideo) || (job.status === 'completed' && job.resultFiles && job.resultFiles.length > 0)) && (
                            <div className="mt-4 flex gap-3">
                              <button 
                                onClick={() => {
                                  let videoPath = job.resultFiles?.[0] || job.data.outputVideo;
                                  if (videoPath && !videoPath.startsWith('/')) videoPath = `/downloads/videos/${videoPath}`;
                                  setViewingVideo(videoPath);
                                }}
                                className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 rounded-lg font-medium hover:bg-blue-100 transition"
                              >
                                <PlayCircle size={16}/> 预览视频
                              </button>
                              <a 
                                href={(() => {
                                  let videoPath = job.resultFiles?.[0] || job.data.outputVideo;
                                  if (videoPath && !videoPath.startsWith('/')) videoPath = `/downloads/videos/${videoPath}`;
                                  return videoPath;
                                })()} 
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
              )) : videoJobs.map(job => (
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

                  {((job.status === 'completed' && job.data.outputVideo) || (job.status === 'completed' && job.resultFiles && job.resultFiles.length > 0)) && (
                    <div className="mt-4 flex gap-3">
                      <button 
                        onClick={() => {
                          let videoPath = job.resultFiles?.[0] || job.data.outputVideo;
                          if (videoPath && !videoPath.startsWith('/')) videoPath = `/downloads/videos/${videoPath}`;
                          setViewingVideo(videoPath);
                        }}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 rounded-lg font-medium hover:bg-blue-100 transition"
                      >
                        <PlayCircle size={16}/> 预览视频
                      </button>
                      <a 
                        href={(() => {
                          let videoPath = job.resultFiles?.[0] || job.data.outputVideo;
                          if (videoPath && !videoPath.startsWith('/')) videoPath = `/downloads/videos/${videoPath}`;
                          return videoPath;
                        })()} 
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
          ) : (() => {
            const renderVideoItem = (vidData: GalleryAsset) => {
              const vid = vidData.path;
              return (
                <div key={vid} className="group relative bg-white p-2 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-all">
                  <div onClick={() => setViewingVideo(`/downloads/videos/${vid}`)} className="block aspect-[9/16] overflow-hidden rounded-lg bg-gray-100 relative cursor-pointer">
                    <img src={`/api/thumbnails/videos/${vid.replace(/\.[^/.]+$/, ".jpg")}`} alt={vid} className="w-full h-full object-fill group-hover:scale-105 transition-transform duration-300 bg-gray-100" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                    <div className="absolute inset-0 bg-black/20 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                      <PlayCircle className="w-12 h-12 text-white opacity-80 group-hover:opacity-100 transition-opacity drop-shadow-md" />
                    </div>
                  </div>
                  <div className="mt-3 px-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-gray-500 truncate pr-2 font-medium" title={vid}>{vid.split('/').pop()}</span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            fetchGallery();
                            setViewingXhsNotes({ videoId: vidData.path, jobId: vidData.jobId, taskData: vidData.taskData || {} as VideoTask });
                          }}
                          className="p-1.5 text-red-500 hover:bg-red-50 rounded-md transition-colors animate-pulse"
                          title="小红书配置"
                        >
                          <Target className="w-4 h-4" />
                        </button>
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
                    {vidData.createdAt && (
                      <div className="flex items-center gap-1 mt-1 text-[10px] text-gray-400 font-medium">
                        <Clock size={10} />
                        {(() => {
                          const d = new Date(vidData.createdAt.endsWith('Z') ? vidData.createdAt : vidData.createdAt.replace(' ', 'T') + 'Z');
                          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                        })()}
                      </div>
                    )}
                  </div>
                </div>
              );
            };

            return user?.role === 'admin' ? (
              <div className="flex flex-col gap-6 w-full">
                {Object.entries(groupByUser(videoGallery)).map(([uname, vids]) => (
                  <div key={uname} className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
                    <div 
                      onClick={() => toggleUserExpand(uname + '_videoGallery')}
                      className="bg-gray-50 px-6 py-4 cursor-pointer flex justify-between items-center border-b border-gray-200 hover:bg-gray-100 transition"
                    >
                      <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                        <span>👤 {uname}</span>
                        <span className="bg-blue-100 text-blue-700 text-xs px-2 py-1 rounded-full font-bold">{vids.length} 个视频</span>
                      </h3>
                      {expandedUsers.has(uname + '_videoGallery') ? <ChevronUp size={20} className="text-gray-500" /> : <ChevronDown size={20} className="text-gray-500" />}
                    </div>
                    {expandedUsers.has(uname + '_videoGallery') && (
                      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 bg-gray-50/50">
                        {vids.map(renderVideoItem)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {videoGallery.map(renderVideoItem)}
              </div>
            );
          })()}
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
          <div className="bg-white p-6 rounded-2xl shadow-xl w-full max-w-lg">
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
            }} className="space-y-4">
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
                >
                  <option value="">- 不绑定电脑 (默认：服务器本地或动态匹配任意在线节点) -</option>
                  {availableWorkers.map(w => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({w.status === 'offline' ? '离线' : '在线'})
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-gray-400 mt-1.5 border-b pb-3 border-gray-100">
                  ※ 多账号隔离防封号：绑定后，本账号产生的<b>生图任务/文案生成</b>与<b>小红书自动/遥控发布</b>命令，将精准定向发送给您的这台本地设备，在您本地的 Chrome 浏览器及 CDP 端口中真实操作，完全符合防风控 and 单人单机需求。
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

      {viewingXhsNotes && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[999]" onClick={() => setViewingXhsNotes(null)}>
          <div className="relative bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
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
            
            <div className="p-6 overflow-y-auto w-full grid grid-cols-1 md:grid-cols-2 gap-6 bg-gray-50">
              <div className="space-y-4">
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

              <div>
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
                     onClick={() => { fetchGallery(); setShowXhsGalleryPicker(true); }}
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
                      fetchGallery();
                      setShowXhsGalleryPicker(true);
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

              {/* Timing/Publish Settings (小红书定时与发布) */}
              <div className="md:col-span-2 pt-4 mt-2 border-t border-gray-100">
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
                <FolderPlus className="text-purple-600 w-5 h-5" />
                新建图片分组目录
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
                <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">中文图组名称</label>
                <input 
                  type="text"
                  placeholder="如：工作日常、产品图库..."
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:bg-white focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none transition"
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
                  className="px-5 py-2 text-xs font-bold text-white bg-purple-600 rounded-lg hover:bg-purple-700 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-purple-100"
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
