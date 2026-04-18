import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Lock, User, Sparkles } from 'lucide-react';

export const Login: React.FC = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login, register } = useAuth();
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    const result = isLogin ? await login({ username, password }) : await register({ username, password });
    setIsLoading(false);
    if (result.error) {
      setError(result.error);
    }
  };

  return (
    <div className="flex justify-center items-center h-screen bg-gradient-to-br from-blue-50 to-indigo-50 p-4">
      <form onSubmit={handleSubmit} className="bg-white p-8 md:p-10 rounded-3xl shadow-xl w-full max-w-sm border border-gray-100">
        <div className="flex flex-col items-center mb-8">
          <div className="bg-blue-600 p-3 rounded-2xl mb-4 shadow-lg shadow-blue-200">
            <Sparkles className="text-white w-8 h-8" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900">{isLogin ? '欢迎回来' : '创建账号'}</h2>
          <p className="text-gray-500 text-sm mt-1">{isLogin ? '登录以继续您的工作' : '开始您的创意之旅'}</p>
        </div>
        
        {error && <div className="bg-red-50 text-red-600 text-xs p-3 rounded-lg mb-4 text-center">{error}</div>}
        
        <div className="space-y-4">
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input 
              type="text" 
              placeholder="用户名" 
              className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition" 
              value={username} 
              onChange={e => setUsername(e.target.value)}
              required
            />
          </div>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input 
              type="password" 
              placeholder="密码" 
              className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition" 
              value={password} 
              onChange={e => setPassword(e.target.value)}
              required
            />
          </div>
        </div>

        <button 
          className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition mt-6 shadow-lg shadow-blue-200 disabled:opacity-50"
          disabled={isLoading}
        >
          {isLoading ? '处理中...' : (isLogin ? '登录' : '注册')}
        </button>
        
        <button type="button" className="w-full text-blue-600 text-sm mt-6 font-medium hover:text-blue-700 transition" onClick={() => setIsLogin(!isLogin)}>
          {isLogin ? '没有账号？去注册' : '已有账号？去登录'}
        </button>
      </form>
    </div>
  );
};
