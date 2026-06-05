"""
ASR 引擎 - 基于 faster-whisper 的流式语音识别
优化: MPS 加速 + 滑动窗口 + 1.5s chunk + 离线加载
"""

import os
import numpy as np
from faster_whisper import WhisperModel

# 国内用户使用 HuggingFace 镜像
HF_MIRROR = "https://hf-mirror.com"


def _detect_device() -> str:
    """检测最佳可用设备，Apple Silicon 优先尝试 MPS。"""
    try:
        import torch
        if torch.cuda.is_available():
            return "cuda"
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            print("[ASR] Apple Silicon detected, attempting MPS acceleration...")
            return "mps"
        else:
            return "cpu"
    except ImportError:
        return "cpu"


def _model_is_cached(model_size: str) -> bool:
    """检查模型是否已缓存到本地。"""
    cache_dir = os.path.expanduser(
        f"~/.cache/huggingface/hub/models--Systran--faster-whisper-{model_size}"
    )
    return os.path.isdir(cache_dir)


class ASREngine:
    """faster-whisper ASR 引擎"""

    def __init__(
        self,
        model_size: str = "small",
        device: str = "auto",
        compute_type: str = "auto"
    ):
        self.model_size = model_size

        # 自动检测设备
        if device == "auto":
            device = _detect_device()

        # 自动选择计算精度
        if compute_type == "auto":
            compute_type = "float16" if device in ("cuda", "mps") else "int8"

        self.device = device
        self.compute_type = compute_type

        # 模型若已缓存，跳过网络验证，直接离线加载（解决 hf-mirror 慢/挂起问题）
        if _model_is_cached(model_size):
            os.environ.setdefault("HF_HUB_OFFLINE", "1")
            print(f"[ASR] Model {model_size} 已缓存，离线加载中...")
        else:
            os.environ.setdefault("HF_ENDPOINT", HF_MIRROR)
            print(f"[ASR] 首次加载，使用镜像 {HF_MIRROR}")

        print(f"Loading Whisper model: {model_size} on {device} ({compute_type})...")

        # MPS 可能不被 CTranslate2 支持，失败时自动回退 CPU
        try:
            self.model = WhisperModel(
                model_size,
                device=device,
                compute_type=compute_type
            )
        except RuntimeError as e:
            if device == "mps" and "MPS" in str(e):
                print(f"[ASR] MPS not supported by faster-whisper/CTranslate2, falling back to CPU: {e}")
                self.device = "cpu"
                self.compute_type = "int8"
                self.model = WhisperModel(
                    model_size,
                    device="cpu",
                    compute_type="int8"
                )
            else:
                raise

        # 音频缓冲区 (累积音频直到有足够数据)
        self.audio_buffer = np.array([], dtype=np.float32)
        self.sample_rate = 16000
        self.min_chunk_size = int(self.sample_rate * 1.5)  # 1.5 秒音频 (降低首字延迟)
        self.overlap_seconds = 0.5  # 滑动窗口重叠时间
        self.total_audio_processed = 0

        print(f"ASR engine ready: {model_size} on {self.device} ({self.compute_type})")

    def transcribe_chunk(self, audio: np.ndarray) -> tuple:
        """
        转录一个音频块 (滑动窗口模式)

        Args:
            audio: float32 numpy array, 16kHz mono, 值范围 [-1, 1]

        Returns:
            (segments, info): segments 是转录段落列表, info 包含语言检测等信息
        """
        # 累积到缓冲区
        self.audio_buffer = np.concatenate([self.audio_buffer, audio])
        buffer_len = len(self.audio_buffer)

        # 缓冲区不足,等待更多音频
        if buffer_len < self.min_chunk_size:
            return [], _info_stub("en")

        # 取出全部缓冲区内容处理
        audio_to_process = self.audio_buffer.copy()
        self.total_audio_processed += len(audio_to_process)

        # 滑动窗口：保留最后 overlap_seconds 秒的音频到下一个 chunk
        # 防止句子在 chunk 边界被截断
        overlap_samples = int(self.sample_rate * self.overlap_seconds)
        if buffer_len > overlap_samples:
            self.audio_buffer = self.audio_buffer[-overlap_samples:]
        else:
            self.audio_buffer = np.array([], dtype=np.float32)

        print(
            f"[ASR] Processing {len(audio_to_process)} samples "
            f"({len(audio_to_process)/self.sample_rate:.1f}s), "
            f"overlap: {len(self.audio_buffer)/self.sample_rate:.1f}s, "
            f"total: {self.total_audio_processed/self.sample_rate:.1f}s"
        )

        # 音频归一化：如果音量太低，自动提升增益
        peak = np.abs(audio_to_process).max()
        if peak > 0 and peak < 0.15:
            gain = 0.25 / peak
            audio_to_process = np.clip(audio_to_process * gain, -1.0, 1.0)
            print(f"[ASR] Audio normalized: peak={peak:.4f}, gain={gain:.2f}")

        try:
            segments, info = self.model.transcribe(
                audio_to_process,
                beam_size=5,
                vad_filter=True,
                vad_parameters=dict(
                    min_silence_duration_ms=300,
                    speech_pad_ms=200,
                    threshold=0.3,
                ),
                condition_on_previous_text=False,
                language=None,
                task="transcribe",
                no_speech_threshold=0.6,
                log_prob_threshold=-1.0,
            )

            segments_list = list(segments)

            if segments_list:
                print(
                    f"[ASR] Detected {len(segments_list)} segments, "
                    f"lang={info.language}, prob={info.language_probability:.2f}"
                )
                for i, seg in enumerate(segments_list):
                    print(f"[ASR] Segment {i}: '{seg.text.strip()}'")
            else:
                print(f"[ASR] No speech detected in this chunk (lang={info.language})")

            return segments_list, info

        except Exception as e:
            print(f"[ASR] Transcription error: {e}")
            import traceback
            traceback.print_exc()
            return [], _info_stub("en")

    def reset(self):
        """重置缓冲区"""
        self.audio_buffer = np.array([], dtype=np.float32)
        print("[ASR] Buffer reset")


def _info_stub(lang: str = "en"):
    """创建占位 info 对象"""
    return type("Info", (), {"language": lang, "language_probability": 0.0})
