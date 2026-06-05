import { useEffect, useRef } from 'react'
import { useTranslationStore } from '../stores/translationStore'

export default function SubtitleOverlay(): JSX.Element {
  const { segments } = useTranslationStore()
  const containerRef = useRef<HTMLDivElement>(null)

  // 自动滚动到底部
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [segments])

  // 只显示最近的 3 段
  const visibleSegments = segments.slice(-3)

  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'partial':
        return 'opacity-60 border-l-2 border-yellow-400/50'
      case 'confirmed':
        return 'opacity-100 border-l-2 border-green-400'
      case 'corrected':
        return 'opacity-100 border-l-2 border-blue-400 bg-blue-500/10'
      default:
        return 'opacity-80'
    }
  }

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'partial':
        return <span className="text-[10px] text-yellow-400/70 animate-pulse">识别中...</span>
      case 'confirmed':
        return <span className="text-[10px] text-green-400/70">已确认</span>
      case 'corrected':
        return <span className="text-[10px] text-blue-400/70">已修正</span>
      default:
        return null
    }
  }

  return (
    <div className="w-full">
      {/* 字幕显示区域 */}
      <div
        ref={containerRef}
        className="space-y-2 max-h-[60vh] overflow-y-auto scrollbar-hide"
      >
        {visibleSegments.map((seg) => (
          <div
            key={seg.id}
            className={`rounded-lg p-3 bg-black/60 backdrop-blur-sm transition-all duration-300 ${getStatusStyle(seg.status)}`}
          >
            {/* 状态标签 */}
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-500 uppercase tracking-wider">
                  {seg.language}
                </span>
                {getStatusLabel(seg.status)}
              </div>
              <span className="text-[10px] text-gray-600">
                {new Date(seg.timestamp).toLocaleTimeString('zh-CN', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit'
                })}
              </span>
            </div>

            {/* 源语言文本 (双语模式) */}
            {seg.sourceText && (
              <div className="text-xs text-gray-400/80 mb-1.5 leading-relaxed">
                {seg.sourceText}
              </div>
            )}

            {/* 翻译文本 */}
            <div
              className="text-base font-medium leading-relaxed text-white"
              style={{
                textShadow: '0 1px 3px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.5)'
              }}
            >
              {seg.translatedText}
              {seg.status === 'partial' && (
                <span className="inline-block w-0.5 h-4 bg-yellow-400 ml-0.5 animate-pulse" />
              )}
            </div>
          </div>
        ))}
      </div>

      {/* 空状态 */}
      {segments.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-gray-500">
          <div className="text-4xl mb-3">🎙️</div>
          <div className="text-sm">等待音频输入...</div>
          <div className="text-xs text-gray-600 mt-1">
            点击「开始翻译」并对麦克风说话
          </div>
        </div>
      )}
    </div>
  )
}
