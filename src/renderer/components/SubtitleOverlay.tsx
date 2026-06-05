import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslationStore } from '../stores/translationStore'

// PCM 音频处理器
class AudioPCMProcessor {
  private audioContext: AudioContext | null = null
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private scriptNode: ScriptProcessorNode | null = null
  private targetSampleRate = 16000

  async start(stream: MediaStream): Promise<void> {
    this.audioContext = new AudioContext({ sampleRate: this.targetSampleRate })
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume()
    }
    this.sourceNode = this.audioContext.createMediaStreamSource(stream)
    this.scriptNode = this.audioContext.createScriptProcessor(4096, 1, 1)
    this.scriptNode.onaudioprocess = (event) => {
      const inputData = event.inputBuffer.getChannelData(0)
      const pcm16 = new Int16Array(inputData.length)
      for (let i = 0; i < inputData.length; i++) {
        const s = Math.max(-1, Math.min(1, inputData[i]))
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
      }
      const bytes = new Uint8Array(pcm16.buffer.slice(0))
      window.electronAPI?.sendAudioPCMData(bytes)
    }
    this.sourceNode.connect(this.scriptNode)
    this.scriptNode.connect(this.audioContext.destination)
  }

  stop(): void {
    this.scriptNode?.disconnect()
    this.sourceNode?.disconnect()
    this.audioContext?.close()
    this.audioContext = null
    this.sourceNode = null
    this.scriptNode = null
  }
}

export default function SubtitleOverlay(): JSX.Element {
  const { segments, clearSegments } = useTranslationStore()
  const scrollRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
  const lastPos = useRef({ x: 0, y: 0 })

  // 控制状态
  const [isCapturing, setIsCapturing] = useState(false)
  const [status, setStatus] = useState<'idle' | 'connecting' | 'running' | 'error'>('idle')
  const [audioSource, setAudioSource] = useState<'none' | 'system' | 'microphone'>('none')
  const [sourceLanguage, setSourceLanguage] = useState('auto')
  const [errorMsg, setErrorMsg] = useState('')
  const [audioLevel, setAudioLevel] = useState(0)

  const processorRef = useRef<AudioPCMProcessor | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animFrameRef = useRef<number>(0)

  // 自动滚动到底部
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const rafId = requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: 'auto' })
    })
    return () => cancelAnimationFrame(rafId)
  }, [segments])

  // 音频电平监测
  const startLevelMonitor = (stream: MediaStream) => {
    const ctx = new AudioContext({ sampleRate: 16000 })
    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    source.connect(analyser)
    analyserRef.current = analyser
    const dataArray = new Uint8Array(analyser.frequencyBinCount)
    const tick = () => {
      analyser.getByteFrequencyData(dataArray)
      const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length
      setAudioLevel(Math.min(avg / 128, 1))
      animFrameRef.current = requestAnimationFrame(tick)
    }
    tick()
  }

  const stopLevelMonitor = () => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    analyserRef.current = null
    setAudioLevel(0)
  }

  const handleLanguageChange = async (lang: string) => {
    setSourceLanguage(lang)
    await window.electronAPI?.updateSettings({ sourceLanguage: lang })
  }

  const startSystemAudio = async () => {
    setStatus('connecting')
    setErrorMsg('')
    let source: 'system' | 'microphone' = 'microphone'

    try {
      const sourceId = await window.electronAPI?.getSystemAudioSource()
      if (!sourceId) throw new Error('无可用音频源')

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId }
        } as unknown as MediaTrackConstraints,
        video: {
          mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId, maxWidth: 1, maxHeight: 1 }
        } as unknown as MediaTrackConstraints
      })
      stream.getVideoTracks().forEach(t => t.stop())
      if (stream.getAudioTracks().length === 0) throw new Error('无音频轨道')
      source = 'system'
      streamRef.current = stream
    } catch (err) {
      console.warn('System audio failed, falling back to mic:', err)
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      })
      streamRef.current = micStream
    }

    setAudioSource(source)
    window.electronAPI?.reportAudioSource?.(source)

    startLevelMonitor(streamRef.current!)
    const processor = new AudioPCMProcessor()
    await processor.start(streamRef.current!)
    processorRef.current = processor

    const result = await window.electronAPI?.startCapture()
    if (result?.success !== false) {
      setIsCapturing(true)
      setStatus('running')
    }
  }

  const stopCapture = async () => {
    processorRef.current?.stop()
    streamRef.current?.getTracks().forEach(t => t.stop())
    processorRef.current = null
    streamRef.current = null
    stopLevelMonitor()
    await window.electronAPI?.stopCapture()
    setIsCapturing(false)
    setStatus('idle')
    setErrorMsg('')
    setAudioSource('none')
  }

  const handleToggle = async () => {
    if (isCapturing) {
      await stopCapture()
    } else {
      await startSystemAudio()
    }
  }

  // 拖拽
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
      className="w-full h-full select-none rounded-2xl flex flex-col"
      style={{
        background: 'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.65) 100%)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 4px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)',
        position: 'relative'
      }}
    >
      {/* 标题栏 - 可拖拽 */}
      <div
        onMouseDown={handleDragStart}
        onMouseMove={handleDragMove}
        onMouseUp={handleDragEnd}
        onMouseLeave={handleDragEnd}
        className="flex items-center justify-between px-4 py-2.5 cursor-grab active:cursor-grabbing"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: 'linear-gradient(180deg, rgba(20,20,20,0.95) 0%, rgba(10,10,10,0.85) 100%)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderBottom: '1px solid rgba(255,255,255,0.12)',
          borderTopLeftRadius: '1rem',
          borderTopRightRadius: '1rem',
          flexShrink: 0
        }}
      >
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-white/60 tracking-wider">
            EchoSub
          </span>
          {isCapturing && (
            <span className="text-[10px] font-medium flex items-center gap-1" style={{ color: 'rgba(74, 222, 128, 0.7)' }}>
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: 'rgba(74, 222, 128, 0.8)' }} />
              {audioSource === 'system' ? '系统音频' : '麦克风'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 opacity-30 hover:opacity-60 transition-opacity">
          <div className="w-4 h-1 rounded-full bg-white/50" />
          <div className="w-4 h-1 rounded-full bg-white/50" />
          <div className="w-4 h-1 rounded-full bg-white/50" />
        </div>
      </div>

      {/* 控制栏 - 开始按钮 + 语言选择 */}
      <div
        className="flex items-center gap-2 px-4 py-2"
        style={{
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          flexShrink: 0,
          background: 'rgba(0,0,0,0.2)'
        }}
      >
        {/* 开始/停止按钮 */}
        <button
          onClick={handleToggle}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 flex items-center gap-1.5 ${
            isCapturing
              ? 'bg-red-500/80 hover:bg-red-600 text-white'
              : 'bg-blue-500/80 hover:bg-blue-600 text-white'
          }`}
          style={{ minWidth: '90px', justifyContent: 'center' }}
        >
          {isCapturing ? (
            <>
              <span className="w-2.5 h-2.5 rounded-sm bg-white/80" />
              停止
            </>
          ) : (
            <>
              <span className="text-sm">▶</span>
              开始翻译
            </>
          )}
        </button>

        {/* 源语言选择 */}
        <select
          value={sourceLanguage}
          onChange={(e) => handleLanguageChange(e.target.value)}
          disabled={isCapturing}
          className="bg-white/5 text-white/80 text-xs rounded-lg px-2 py-1.5 outline-none cursor-pointer border border-white/10 hover:bg-white/10 transition-colors disabled:opacity-40"
          style={{ minWidth: '90px' }}
        >
          <option value="auto" style={{ background: '#1a1a1a' }}>自动检测</option>
          <option value="en" style={{ background: '#1a1a1a' }}>English</option>
          <option value="ja" style={{ background: '#1a1a1a' }}>日本語</option>
          <option value="ko" style={{ background: '#1a1a1a' }}>한국어</option>
          <option value="zh" style={{ background: '#1a1a1a' }}>中文</option>
          <option value="fr" style={{ background: '#1a1a1a' }}>Français</option>
          <option value="de" style={{ background: '#1a1a1a' }}>Deutsch</option>
          <option value="es" style={{ background: '#1a1a1a' }}>Español</option>
          <option value="ru" style={{ background: '#1a1a1a' }}>Русский</option>
        </select>

        {/* 音频电平条 */}
        {isCapturing && (
          <div className="flex-1 flex items-center gap-1.5">
            <div className="flex-1 bg-white/10 rounded-full h-1.5 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-75"
                style={{
                  width: `${Math.max(audioLevel * 100, 2)}%`,
                  background: audioLevel > 0.05
                    ? 'linear-gradient(90deg, #22c55e, #4ade80)'
                    : 'rgba(255,255,255,0.1)'
                }}
              />
            </div>
            <span className={`text-[10px] font-medium ${audioLevel > 0.05 ? 'text-green-400/70' : 'text-white/20'}`}>
              {audioLevel > 0.05 ? '●' : '○'}
            </span>
          </div>
        )}

        {/* 清空按钮 */}
        {!isCapturing && segments.length > 0 && (
          <button
            onClick={clearSegments}
            className="text-[10px] text-white/30 hover:text-white/60 transition-colors px-2 py-1 rounded hover:bg-white/5"
          >
            清空
          </button>
        )}
      </div>

      {/* 错误提示 */}
      {errorMsg && (
        <div className="px-4 py-1.5 bg-red-500/10 border-b border-red-500/20 text-red-300 text-[10px]" style={{ flexShrink: 0 }}>
          {errorMsg}
        </div>
      )}

      {/* 字幕滚动区 */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto px-4 pb-3 pt-1.5 space-y-1.5 scrollbar-hide"
      >
        {visibleSegments.map((seg) => (
          <div
            key={seg.id}
            className="animate-fadeIn rounded-xl px-3.5 py-2.5 transition-all"
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
            {seg.sourceText && seg.translatedText && seg.sourceText !== seg.translatedText && (
              <div className="text-[11px] text-white/40 leading-relaxed mb-1">
                {seg.sourceText}
              </div>
            )}
            <div className="flex items-start gap-2">
              <div
                className="flex-1 text-[15px] font-medium leading-snug"
                style={{
                  color: 'rgba(255,255,255,0.95)',
                  textShadow: '0 1px 3px rgba(0,0,0,0.7)'
                }}
              >
                {seg.translatedText || seg.sourceText}
                {seg.status === 'partial' && (
                  <span className="inline-block w-1 h-4 bg-yellow-400/70 ml-1 animate-pulse rounded-sm" />
                )}
              </div>
              {seg.status === 'partial' && (
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-400/80 mt-1.5 animate-pulse shrink-0" />
              )}
              {seg.status === 'corrected' && (
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400/80 mt-1.5 shrink-0" />
              )}
            </div>
          </div>
        ))}

        {segments.length === 0 && (
          <div className="flex flex-col items-center justify-center py-6 opacity-30">
            <svg className="w-7 h-7 mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
            <span className="text-xs text-white/30">点击「开始翻译」启动</span>
          </div>
        )}
      </div>
    </div>
  )
}
