import React from 'react';
import { Heart, Star, MessageCircle, ChevronLeft, MoreHorizontal } from 'lucide-react';

interface XhsPhonePreviewProps {
  title: string;
  content: string;
  tags: string;
  coverImage?: string;
  aspectRatio?: '3:4' | '4:3' | '9:16' | '16:9';
  authorName?: string;
  authorAvatar?: string;
}

export const XhsPhonePreview: React.FC<XhsPhonePreviewProps> = ({
  title,
  content,
  tags,
  coverImage,
  aspectRatio = '3:4',
  authorName = '小红书创作者',
  authorAvatar
}) => {
  // Combine content and tags exactly as they will be published in xhs_automation.ts
  const getCombinedText = () => {
    let text = (content || '').trim();
    
    // Parse tags to match xhs_automation.ts splitting rules
    if (tags) {
      const parsedTags = tags
        .split(/[\s,#，]+/)
        .map(t => t.trim())
        .filter(t => t.length > 0)
        .map(t => `#${t}`)
        .join('  '); // Two spaces, as implemented in automation
      
      if (parsedTags) {
        text += '\n\n' + parsedTags;
      }
    }
    return text;
  };

  const combinedText = getCombinedText();

  // Highlight hashtags with a nice Xiaohongshu-style blue color
  const renderFormattedText = (text: string) => {
    if (!text) return <span className="text-gray-400 italic">（无正文描述）</span>;
    
    // Regex to capture hashtags starting with #
    const hashtagRegex = /(#[^\s#，,。！!？?；;]+)/g;
    const parts = text.split(hashtagRegex);
    
    return parts.map((part, index) => {
      if (part.startsWith('#')) {
        return (
          <span key={index} className="text-[#4c75a3] font-medium hover:underline cursor-pointer">
            {part}
          </span>
        );
      }
      return part;
    });
  };

  // Get cover image URL
  const getCoverUrl = () => {
    if (!coverImage) return '';
    if (coverImage.startsWith('data:')) return coverImage;
    if (coverImage.startsWith('/downloads/') || coverImage.startsWith('/uploads/')) {
      return coverImage;
    }
    if (!coverImage.startsWith('http')) return coverImage;
    return `/api/proxy?url=${encodeURIComponent(coverImage)}`.replace('&', '%26');
  };

  const coverUrl = getCoverUrl();

  // Map aspect ratio to tailwind style
  const getAspectRatioClass = () => {
    switch (aspectRatio) {
      case '16:9': return 'aspect-[16/9]';
      case '4:3': return 'aspect-[4/3]';
      case '9:16': return 'aspect-[9/16]';
      case '3:4':
      default:
        return 'aspect-[3/4]';
    }
  };

  const defaultAvatar = "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop&crop=faces";

  return (
    <div className="w-[300px] sm:w-[320px] h-[600px] sm:h-[640px] bg-[#f9fafb] border-[8px] border-[#1f2937] rounded-[40px] shadow-2xl overflow-hidden flex flex-col relative select-none font-sans text-gray-900 ring-1 ring-black/10 mx-auto">
      {/* Phone Notch & Ear Speaker */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-6 bg-[#1f2937] rounded-b-2xl z-50 flex items-center justify-center">
        <div className="w-12 h-1 bg-gray-700 rounded-full mb-1"></div>
      </div>

      {/* Phone Status Bar */}
      <div className="h-7 bg-white pt-1 px-5 flex justify-between items-center text-[10px] font-bold text-gray-800 z-40 select-none">
        <span>12:30</span>
        <div className="flex items-center gap-1">
          <span className="w-2.5 h-2 bg-gray-800 rounded-xs"></span>
          <span className="w-3 h-2 bg-gray-800 rounded-xs"></span>
        </div>
      </div>

      {/* XHS App Header */}
      <div className="h-11 bg-white border-b border-gray-100 px-3 flex items-center justify-between shrink-0 z-40">
        <div className="flex items-center gap-2">
          <ChevronLeft size={20} className="text-gray-700 cursor-pointer" />
          <div className="w-6 h-6 rounded-full overflow-hidden border border-red-500/30">
            <img src={authorAvatar || defaultAvatar} className="w-full h-full object-cover" alt="avatar" />
          </div>
          <span className="text-[11px] font-semibold text-gray-800 truncate max-w-[80px]">{authorName}</span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="px-2.5 py-0.5 text-[10px] font-bold text-white bg-[#ff2442] hover:bg-[#e01f3a] rounded-full transition cursor-pointer">
            关注
          </button>
          <MoreHorizontal size={18} className="text-gray-500 cursor-pointer" />
        </div>
      </div>

      {/* Scrollable Note Content */}
      <div className="flex-grow overflow-y-auto scrollbar-none pb-12 bg-white">
        {/* Cover Image container */}
        <div className={`w-full bg-gray-100 relative ${getAspectRatioClass()} flex items-center justify-center overflow-hidden border-b border-gray-50`}>
          {coverUrl ? (
            <img 
              src={coverUrl} 
              alt="Note Cover" 
              className="w-full h-full object-cover"
              onError={(e) => { e.currentTarget.src = 'https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?q=80&w=600'; }}
            />
          ) : (
            <div className="text-gray-400 flex flex-col items-center p-4 text-center">
              <span className="text-xs font-medium">（暂无封面图）</span>
            </div>
          )}
        </div>

        {/* Note Text Section */}
        <div className="p-4">
          {/* Title */}
          {title ? (
            <h1 className="font-bold text-[15px] text-gray-900 leading-snug mb-2.5 break-words">
              {title}
            </h1>
          ) : (
            <h1 className="font-bold text-[15px] text-gray-300 leading-snug mb-2.5 italic">
              （未填写标题）
            </h1>
          )}

          {/* Body and Tags */}
          <div className="text-[13px] text-[#2c2c2c] leading-relaxed whitespace-pre-wrap break-all select-text selection:bg-red-100">
            {renderFormattedText(combinedText)}
          </div>

          {/* Date & Location */}
          <div className="mt-4 flex items-center justify-between text-[10px] text-gray-400">
            <span>编辑于 今天 12:30</span>
            <span className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-500">IP 属地: 浙江</span>
          </div>
        </div>
      </div>

      {/* XHS Bottom Comment/Interaction bar */}
      <div className="absolute bottom-0 inset-x-0 h-12 bg-white border-t border-gray-100 px-3 py-1 flex items-center justify-between z-40">
        <div className="flex-grow max-w-[130px] h-8 bg-gray-100 rounded-full px-3 flex items-center text-[11px] text-gray-400">
          说点什么...
        </div>
        <div className="flex items-center gap-3 text-gray-700">
          <div className="flex flex-col items-center cursor-pointer">
            <Heart size={16} className="text-gray-600" />
            <span className="text-[9px] text-gray-500 mt-0.5">点赞</span>
          </div>
          <div className="flex flex-col items-center cursor-pointer">
            <Star size={16} className="text-gray-600" />
            <span className="text-[9px] text-gray-500 mt-0.5">收藏</span>
          </div>
          <div className="flex flex-col items-center cursor-pointer">
            <MessageCircle size={16} className="text-gray-600" />
            <span className="text-[9px] text-gray-500 mt-0.5">评论</span>
          </div>
        </div>
      </div>
    </div>
  );
};
