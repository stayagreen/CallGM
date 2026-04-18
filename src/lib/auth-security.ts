import { Request, Response, NextFunction } from 'express';

// 定义权限校验中间件
export const checkAccess = (req: any, res: Response, next: NextFunction) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  // 管理员拥有所有权限
  if (req.session.user.role === 'admin') {
    next();
    return;
  }
  
  // 普通用户只能访问自己的数据
  // 这里可以根据 req.params 或 req.body 中的资源ID来决定是否允许访问
  // 具体的校验逻辑将在使用此中间件的路由中按需实现
  next();
};

// 工具函数：获取当前用户的存储基准路径
export const getUserStoragePath = (req: any, basePath: string) => {
  const user = req.session.user;
  if (!user) throw new Error('Unauthorized');
  
  // 管理员访问的是全部数据的根
  if (user.role === 'admin') return basePath;
  
  // 返回相对于根路径加上用户ID
  const path = require('path');
  return path.join(basePath, user.id.toString());
};
