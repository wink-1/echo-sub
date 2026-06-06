/**
 * PCM 音频处理器 - 将 MediaStream 转换为 16kHz 16bit PCM 并发送到主进程
 *
 * TODO: 替换 createScriptProcessor 为 AudioWorklet
 * createScriptProcessor 已被 W3C 标记为废弃，推荐使用 AudioWorklet。
 * AudioWorklet 在独立线程运行，不会有主线程阻塞问题。
 * 当前 ScriptProcessorNode 仍可正常工作，但未来版本的浏览器/Electron 可能移除支持。
 */
export class AudioPCMProcessor {
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
