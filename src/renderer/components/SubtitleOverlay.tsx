import { useTranslationStore } from '../stores/translationStore'

export default function SubtitleOverlay(): JSX.Element {
  const { segments } = useTranslationStore()

  // 只显示最近的 3 段
  const visibleSegments = segments.slice(-3)

  return (
    <div className="subtitle-container w-full h-full flex flex-col justify-end p-3">
      <div className="space-y-1">
        {visibleSegments.map((seg) => (
          <div key={seg.id} className="subtitle-text">
            {/* 源语言文本 (双语模式) */}
            <div className="text-xs text-gray-400/70 mb-0.5 status-{seg.status}">
              {seg.sourceText}
            </div>
            {/* 翻译文本 */}
            <div
              className={`text-lg font-medium leading-snug status-${seg.status}`}
              style={{
                textShadow: '0 1px 3px rgba(0,0,0,0.8)'
              }}
            >
              {seg.translatedText}
              {seg.status === 'partial' && (
                <span className="animate-pulse">|</span>
              )}
              {seg.status === 'confirmed' && (
                <span className="text-green-400 text-xs ml-1">✓</span>
              )}
              {seg.status === 'corrected' && (
                <span className="text-yellow-400 text-xs ml-1">✓✓</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {segments.length === 0 && (
        <div className="text-center text-gray-500 text-sm py-8">
          等待音频输入...
        </div>
      )}
    </div>
  )
}
