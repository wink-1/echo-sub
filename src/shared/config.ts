/**
 * 应用常量配置 — 所有可调参数集中管理
 *
 * 修改这些值会同时影响 main 和 renderer 进程。
 * 生产环境下考虑从 .env 文件读取这些值。
 */

/** 后端连接配置 */
export const BACKEND_CONFIG = {
  /** WebSocket 服务端口 */
  PORT: 8765,
  /** 首次连接最大重试次数 */
  WS_MAX_RETRIES: 30,
  /** 断线重连最大次数 */
  WS_MAX_RECONNECT: 10,
  /** 断线重连间隔 (ms) */
  WS_RECONNECT_DELAY: 2000,
} as const

/** 字幕显示配置 */
export const SUBTITLE_CONFIG = {
  /** 可见段落最大数 */
  MAX_VISIBLE_SEGMENTS: 8,
  /** 存储段落最大数 */
  MAX_STORED_SEGMENTS: 50,
  /** 窗口默认透明度 */
  DEFAULT_OPACITY: 1.0,
} as const

/** 音频处理配置 */
export const AUDIO_CONFIG = {
  /** 目标采样率 (Hz) */
  TARGET_SAMPLE_RATE: 16000,
  /** ScriptProcessor 缓冲区大小 */
  BUFFER_SIZE: 4096,
} as const
