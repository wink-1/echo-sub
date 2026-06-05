import { useState, useRef, useEffect } from 'react'

// PCM 音频处理器 - 将 MediaStream 转换为 16kHz 16bit PCM 并发送到主进程
class AudioPCMProcessor {
  private audioContext: AudioContext | null = null
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private scriptNode: ScriptProcessorNode | null = null
  private targetSampleRate = 16000

  async start(stream: MediaStream): Promise<void> {
    this.audioContext = new AudioContext({ sampleRate: this.targetSampleRate })
    this.sourceNode = this.audioContext.createMediaStreamSource(stream)

    // 使用 ScriptProcessorNode 将音频转为 PCM
    // bufferSize=4096 约 256ms @ 16kHz
    this.scriptNode = this.audioContext.createScriptProcessor(4096, 1, 1)

    this.scriptNode.onaudioprocess = (event) => {
      const inputData = event.inputBuffer.getChannelData(0)
      // float32 → int16 PCM
      const pcm16 = new Int16Array(inputData.length)
      for (let i = 0; i < inputData.length; i++) {
        const s = Math.max(-1, Math.min(1, inputData[i]))
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
      }
      // IPC 传输: ArrayBuffer 在 IPC 中可能丢失, 用 Uint8Array 包装
      // 用 slice 创建独立副本 (避免底层 buffer 被复用)
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

  // 检查音频电平 (用于 UI 反馈)
  const [audioLevel, setAudioLevel] = useState(0)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animFrameRef = useRef<number>(0)

  useEffect(() => {
    // 检查字幕窗口状态
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
      setAudioLevel(Math.min(avg / 128, 1)) // normalize 0-1
      animFrameRef.current = requestAnimationFrame(tick)
    }
    tick()
  }

  const stopLevelMonitor = () => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    analyserRef.current = null
    setAudioLevel(0)
  }

  const handleToggle = async () => {
    if (isCapturing) {
      // 停止
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
      // 开始
      setStatus('connecting')
      setErrorMsg('')

      try {
        let stream: MediaStream
        let source: 'system' | 'microphone' = 'microphone'

        // 尝试使用系统音频 (桌面音频捕获)
        try {
          const sourceId = await window.electronAPI?.getSystemAudioSource()
          if (sourceId) {
            // 注意: chromeMediaSource: 'desktop' 同时需要 audio 和 video
            // 然后丢弃 video track
            stream = await navigator.mediaDevices.getUserMedia({
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
            // 丢弃 video track, 只保留 audio
            stream.getVideoTracks().forEach(t => t.stop())
            stream.removeTrack(stream.getVideoTracks()[0])

            if (stream.getAudioTracks().length > 0) {
              source = 'system'
              console.log('System audio captured via desktopCapturer')
            } else {
              throw new Error('No audio track in desktop capture')
            }
          } else {
            throw new Error('No system audio source available')
          }
        } catch (loopbackErr) {
          console.warn('System audio capture failed:', loopbackErr)
          console.log('Falling back to microphone...')
          // 降级到麦克风输入
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              channelCount: 1,
              sampleRate: 16000,
              echoCancellation: true,
              noiseSuppression: true
            }
          })
          console.log('Microphone captured')
        }

        streamRef.current = stream
        setAudioSource(source)

        // 启动音频电平监测
        startLevelMonitor(stream)

        // 创建 PCM 处理器并发送音频
        const processor = new AudioPCMProcessor()
        await processor.start(stream)
        processorRef.current = processor

        // 通知主进程后端开始接收音频
        const result = await window.electronAPI?.startCapture()
        if (result?.success !== false) {
          setIsCapturing(true)
          setStatus('running')
        } else {
          setStatus('error')
          setErrorMsg('启动失败')
        }
      } catch (err) {
        console.error('Audio capture error:', err)
        setStatus('error')
        setErrorMsg(err instanceof Error ? err.message : String(err))
      }
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

      {/* 主按钮 */}
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
            <span className="w-0 h-0 border-t-4 border-b-4 border-l-6 border-transparent border-l-white ml-0.5" />
            开始翻译
          </>
        )}
      </button>

      {/* 音频电平指示器 */}
      {isCapturing && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-400 flex items-center gap-1.5">
              {audioSource === 'system' ? (
                <>
                  <span className="text-sm">🔊</span>
                  <span>系统音频</span>
                </>
              ) : (
                <>
                  <span className="text-sm">🎤</span>
                  <span>麦克风</span>
                </>
              )}
            </span>
            <span className={`text-xs font-medium ${
              audioLevel > 0.05 ? 'text-green-400' : 'text-gray-500'
            }`}>
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
        <div className="bg-red-500/10 border border-red-500/20 text-red-300 text-xs p-3 rounded-lg">
          {errorMsg}
        </div>
      )}

      {/* 设置和悬浮窗 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gray-700/30 rounded-lg p-3">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">源语言</div>
          <div className="text-sm text-white font-medium">自动检测</div>
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
