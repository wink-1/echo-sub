"""
ASR 引擎 - 基于 faster-whisper 的流式语音识别
"""

import numpy as np
from faster_whisper import WhisperModel


class ASREngine:
    """faster-whisper ASR 引擎"""

    def __init__(
        self,
        model_size: str = "large-v3-turbo",
        device: str = "auto",
        compute_type: str = "auto"
    ):
        self.model_size = model_size

        # 自动检测设备
        if device == "auto":
            try:
                import torch
                if torch.cuda.is_available():
                    device = "cuda"
                elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
                    device = "cpu"  # MPS 对 faster-whisper 支持有限,先用 CPU
                else:
                    device = "cpu"
            except ImportError:
                device = "cpu"

        # 自动选择计算精度
        if compute_type == "auto":
            compute_type = "float16" if device == "cuda" else "int8"

        print(f"Loading Whisper model: {model_size} on {device} ({compute_type})")

        self.model = WhisperModel(
            model_size,
            device=device,
            compute_type=compute_type
        )

        # 音频缓冲区 (累积音频直到有足够数据)
        self.audio_buffer = np.array([], dtype=np.float32)
        self.min_chunk_size = 16000 * 2  # 至少 2 秒音频
        self.sample_rate = 16000

        print(f"ASR engine ready: {model_size} on {device}")

    def transcribe_chunk(self, audio: np.ndarray) -> tuple:
        """
        转录一个音频块

        Args:
            audio: float32 numpy array, 16kHz mono, 值范围 [-1, 1]

        Returns:
            (segments, info): segments 是转录段落列表, info 包含语言检测等信息
        """
        # 累积到缓冲区
        self.audio_buffer = np.concatenate([self.audio_buffer, audio])

        # 缓冲区不足,等待更多音频
        if len(self.audio_buffer) < self.min_chunk_size:
            return [], type("Info", (), {"language": "en"})()

        # 取出缓冲区内容
        audio_to_process = self.audio_buffer
        self.audio_buffer = np.array([], dtype=np.float32)

        # 执行转录
        segments, info = self.model.transcribe(
            audio_to_process,
            beam_size=5,
            vad_filter=True,
            vad_parameters=dict(
                min_silence_duration_ms=500,
                speech_pad_ms=200
            ),
            condition_on_previous_text=True
        )

        # 转换为列表
        segments_list = list(segments)

        return segments_list, info

    def reset(self):
        """重置缓冲区"""
        self.audio_buffer = np.array([], dtype=np.float32)
