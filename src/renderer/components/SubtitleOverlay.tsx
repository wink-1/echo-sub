import { useEffect, useRef, useCallback } from 'react'
import { useTranslationStore } from '../stores/translationStore'

export default function SubtitleOverlay(): JSX.Element {
  const { segments } = useTranslationStore()
  const containerRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
  const lastPos = useRef({ x: 0, y: 0 })

  // 自动滚动到最新字幕
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [segments])

  // 拖拽处理
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    isDragging.current = true
    lastPos.current = { x: e.screenX, y: e.screenY }
  }, [])

  const handleDragMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return
    const deltaX = e.screenX - lastPos.current.x
    const deltaY = e.screenY - lastPos.current.y
    lastPos.current = { x: e.screenX, y: e.screenY }
    window.electronAPI?.subtitleDrag?.(deltaX, deltaY)
  }, [])

  const handleDragEnd = useCallback(() => {
    isDragging.current = false
  }, [])

  const visibleSegments = segments.slice(-8)

  return (
    <div
      className="w-full h-full flex flex-col select-none rounded-2xl overflow-hidden"
      style={{
        background: 'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.65) 100%)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 4px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)'
      }}
    >
      {/* 拖拽手柄 - 顶部标题栏 */}
      <div
        onMouseDown={handleDragStart}
        onMouseMove={handleDragMove}
        onMouseUp={handleDragEnd}
        onMouseLeave={handleDragEnd}
        className="flex items-center justify-between px-4 py-2 cursor-grab active:cursor-grabbing shrink-0"
        style={{
          background: 'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)',
          borderBottom: '1px solid rgba(255,255,255,0.06)'
        }}
      >
        {/* 左侧标题 */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-white/50 tracking-wide">
            EchoSub 字幕悬浮窗
          </span>
          {segments.length > 0 && (
            <span className="text-[10px] text-green-400/60">● 收录中</span>
          )}
        </div>
        {/* 中间拖拽提示 */}
        <div className="flex items-center gap-1 opacity-30 hover:opacity-60 transition-opacity">
          <div className="w-5 h-1 rounded-full bg-white/50" />
          <div className="w-5 h-1 rounded-full bg-white/50" />
          <div className="w-5 h-1 rounded-full bg-white/50" />
        </div>
        {/* 右侧：不显示关闭按钮，保持简洁 */}
        <div />
      </div>

      {/* 字幕内容区域 */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto px-4 py-2 space-y-1.5 scrollbar-hide"
        style={{ scrollBehavior: 'smooth' }}
      >
        {visibleSegments.map((seg) => (
          <div
            key={seg.id}
            className="rounded-xl px-3.5 py-2.5 transition-all duration-300 animate-fadeIn"
            style={{
              backgroundColor: seg.status === 'corrected'
                ? 'rgba(59, 130, 246, 0.15)'
                : seg.status === 'partial'
                  ? 'rgba(255, 255, 255, 0.05)'
                  : 'rgba(255, 255, 255, 0.08)',
              borderLeft: seg.status === 'partial'
                ? '2px solid rgba(250, 204, 21, 0.6)'
                : seg.status === 'corrected'
                  ? '2px solid rgba(96, 165, 250, 0.6)'
                  : '2px solid rgba(74, 222, 128, 0.4)',
            }}
          >
            {/* 源语言文本 */}
            {seg.sourceText && seg.sourceText !== seg.translatedText && (
              <div className="text-[11px] text-white/40 leading-relaxed mb-1">
                {seg.sourceText}
              </div>
            )}
            {/* 翻译文本 */}
            <div className="flex items-start gap-2">
              <div
                className="flex-1 text-[15px] font-medium leading-snug"
                style={{
                  color: 'rgba(255,255,255,0.95)',
                  textShadow: '0 1px 3px rgba(0,0,0,0.7)'
                }}
              >
                {seg.translatedText}
                {seg.status === 'partial' && (
                  <span className="inline-block w-1 h-4 bg-yellow-400/70 ml-1 animate-pulse rounded-sm" />
                )}
              </div>
              {/* 状态小圆标 */}
              {seg.status === 'partial' && (
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-400/80 mt-1.5 animate-pulse shrink-0" />
              )}
              {seg.status === 'corrected' && (
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400/80 mt-1.5 shrink-0" />
              )}
            </div>
          </div>
        ))}

        {/* 空状态 */}
        {segments.length === 0 && (
          <div className="flex flex-col items-center justify-center py-10 opacity-40">
            <svg className="w-8 h-8 mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" stroke="currentColor" style={{ color: 'rgba(255,255,255,0.3)' }}>
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
            <span className="text-xs text-white/30">等待音频输入，字幕将在此显示</span>
          </div>
        )}
      </div>
    </div>
  )
}
