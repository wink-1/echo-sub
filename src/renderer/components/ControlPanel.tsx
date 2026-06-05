import { useState, useRef, useEffect } from 'react'

// PCM 音频处理器 - 将 MediaStream 转换为 16kHz 16bit PCM 并发送到主进程
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

    console.log(`[AudioPCM] AudioContext sampleRate: ${this.audioContext.sampleRate}, state: ${this.audioContext.state}`)

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

export default function ControlPanel(): JSX.Element {
  const [isCapturing, setIsCapturing] = useState(false)
  const [status, setStatus] = useState<'idle' | 'connecting' | 'running' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [audioSource, setAudioSource] = useState<'none' | 'system' | 'microphone'>('none')
  const [isSubtitleOpen, setIsSubtitleOpen] = useState(false)
  const processorRef = useRef<AudioPCMProcessor | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [audioLevel, setAudioLevel] = useState(0)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animFrameRef = useRef<number>(0)
  const [sourceLanguage, setSourceLanguage] = useState('auto')

  useEffect(() => {
    const checkSubtitle = async () => {
      const open = await window.electronAPI?.isSubtitleWindowOpen()
      setIsSubtitleOpen(!!open)
    }
    checkSubtitle()
  }, [])

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

    try {
      const sourceId = await window.electronAPI?.getSystemAudioSource()
      if (!sourceId) {
        throw new Error('无法获取系统音频源。\n请确保已授予屏幕录制权限（系统设置 > 隐私与安全性 > 屏幕录制）')
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId
          }
        } as unknown as MediaTrackConstraints,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId,
            maxWidth: 1,
            maxHeight: 1
          }
        } as unknown as MediaTrackConstraints
      })

      stream.getVideoTracks().forEach(t => t.stop())

      if (stream.getAudioTracks().length === 0) {
        throw new Error('系统音频捕获失败：未检测到音频轨道')
      }

      streamRef.current = stream
      setAudioSource('system')
      window.electronAPI?.reportAudioSource?.('system')

      startLevelMonitor(stream)
      const processor = new AudioPCMProcessor()
      await processor.start(stream)
      processorRef.current = processor

      const result = await window.electronAPI?.startCapture()
      if (result?.success !== false) {
        setIsCapturing(true)
        setStatus('running')
      }
    } catch (err) {
      setStatus('error')
      setErrorMsg(`系统音频捕获失败: ${err instanceof Error ? err.message : String(err)}\n\n请确认：\n1. 系统设置 > 隐私与安全性 > 屏幕录制 中已授权 EchoSub\n2. 有音频正在播放\n\n如无法使用系统音频，可点击下方"使用麦克风"按钮。`)
    }
  }

  const startMicrophone = async () => {
    setStatus('connecting')
    setErrorMsg('')

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      })

      streamRef.current = stream
      setAudioSource('microphone')
      window.electronAPI?.reportAudioSource?.('microphone')

      startLevelMonitor(stream)
      const processor = new AudioPCMProcessor()
      await processor.start(stream)
      processorRef.current = processor

      const result = await window.electronAPI?.startCapture()
      if (result?.success !== false) {
        setIsCapturing(true)
        setStatus('running')
      } else {
        setStatus('error')
        setErrorMsg('启动失败')
      }
    } catch (err) {
      setStatus('error')
      setErrorMsg(err instanceof Error ? err.message : String(err))
    }
  }

  const handleToggle = async () => {
    if (isCapturing) {
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
    } else {
      // 默认使用系统音频
      await startSystemAudio()
    }
  }

  const toggleSubtitleWindow = async () => {
    try {
      if (isSubtitleOpen) {
        await window.electronAPI?.closeSubtitleWindow()
        setIsSubtitleOpen(false)
      } else {
        await window.electronAPI?.openSubtitleWindow()
        setIsSubtitleOpen(true)
      }
    } catch (err) {
      console.error('Failed to toggle subtitle window:', err)
    }
  }

  return (
    <div className="bg-gray-800/50 rounded-xl p-4 space-y-4 border border-gray-700/50">
      {/* 头部状态 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${
            status === 'running'
              ? 'bg-green-500 animate-pulse'
              : status === 'error'
                ? 'bg-red-500'
                : status === 'connecting'
                  ? 'bg-yellow-500 animate-pulse'
                  : 'bg-gray-500'
          }`} />
          <span className="text-sm font-medium text-gray-200">控制面板</span>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full ${
          status === 'running'
            ? 'bg-green-500/20 text-green-400'
            : status === 'error'
              ? 'bg-red-500/20 text-red-400'
              : status === 'connecting'
                ? 'bg-yellow-500/20 text-yellow-400'
                : 'bg-gray-700 text-gray-400'
        }`}>
          {status === 'idle' && '待机'}
          {status === 'connecting' && '连接中...'}
          {status === 'running' && '运行中'}
          {status === 'error' && '错误'}
        </span>
      </div>

      {/* 主按钮 — 系统音频 */}
      <button
        onClick={handleToggle}
        className={`w-full py-3 rounded-lg font-semibold text-sm transition-all duration-200 flex items-center justify-center gap-2 ${
          isCapturing
            ? 'bg-red-500/90 hover:bg-red-600 text-white shadow-lg shadow-red-500/20'
            : 'bg-blue-500/90 hover:bg-blue-600 text-white shadow-lg shadow-blue-500/20'
        }`}
      >
        {isCapturing ? (
          <>
            <span className="w-4 h-4 rounded-sm bg-white/80" />
            停止翻译
          </>
        ) : (
          <>
            <span className="text-base">🔊</span>
            开始翻译 (系统音频)
          </>
        )}
      </button>

      {/* 麦克风降级按钮 */}
      {!isCapturing && (
        <button
          onClick={startMicrophone}
          className="w-full py-2 rounded-lg text-xs font-medium transition-all
            bg-gray-700/30 text-gray-400 hover:bg-gray-700/50 border border-gray-700/30
            flex items-center justify-center gap-1.5"
        >
          <span>🎤</span>
          使用麦克风（非系统音频）
        </button>
      )}

      {/* 音频源状态 + 电平指示器 */}
      {isCapturing && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-400 flex items-center gap-1.5">
              {audioSource === 'system' ? (
                <>
                  <span className="text-sm">🔊</span>
                  <span className="font-semibold text-green-400">系统音频</span>
                </>
              ) : (
                <>
                  <span className="text-sm">🎤</span>
                  <span className="font-semibold text-yellow-400">麦克风</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400 ml-1">⚠ 非系统音频</span>
                </>
              )}
            </span>
            <span className={`text-xs font-medium ${audioLevel > 0.05 ? 'text-green-400' : 'text-gray-500'}`}>
              {audioLevel > 0.05 ? '● 检测到音频' : '○ 未检测到音频'}
            </span>
          </div>
          <div className="w-full bg-gray-700/50 rounded-full h-2 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-75"
              style={{
                width: `${Math.max(audioLevel * 100, 2)}%`,
                background: audioLevel > 0.05
                  ? 'linear-gradient(90deg, #22c55e, #4ade80)'
                  : '#6b7280'
              }}
            />
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-300 text-xs p-3 rounded-lg whitespace-pre-line">
          {errorMsg}
        </div>
      )}

      {/* 源语言选择 + 目标语言 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gray-700/30 rounded-lg p-3">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">源语言</div>
          <select
            value={sourceLanguage}
            onChange={(e) => handleLanguageChange(e.target.value)}
            className="bg-transparent text-sm text-white font-medium w-full outline-none cursor-pointer"
            disabled={isCapturing}
          >
            <option value="auto">自动检测</option>
            <option value="en">English</option>
            <option value="ja">日本語</option>
            <option value="ko">한국어</option>
            <option value="zh">中文</option>
            <option value="fr">Français</option>
            <option value="de">Deutsch</option>
            <option value="es">Español</option>
            <option value="ru">Русский</option>
          </select>
        </div>
        <div className="bg-gray-700/30 rounded-lg p-3">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">目标语言</div>
          <div className="text-sm text-white font-medium">中文</div>
        </div>
      </div>

      <button
        onClick={toggleSubtitleWindow}
        className={`w-full py-2 rounded-lg text-xs font-medium transition-all ${
          isSubtitleOpen
            ? 'bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 border border-purple-500/30'
            : 'bg-gray-700/30 text-gray-400 hover:bg-gray-700/50 border border-gray-700/30'
        }`}
      >
        {isSubtitleOpen ? '✕ 关闭字幕悬浮窗' : '⛶ 打开字幕悬浮窗'}
      </button>
    </div>
  )
}
