"""
ASR 引擎 - 基于 faster-whisper 的流式语音识别
"""

import os
import numpy as np
from faster_whisper import WhisperModel

# 国内用户使用 HuggingFace 镜像
HF_MIRROR = "https://hf-mirror.com"


class ASREngine:
    """faster-whisper ASR 引擎"""

    def __init__(
        self,
        model_size: str = "base",
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

        # 设置 HuggingFace 镜像 (国内网络无法直连 huggingface.co)
        os.environ.setdefault("HF_ENDPOINT", HF_MIRROR)
        print(f"Using HuggingFace endpoint: {os.environ.get('HF_ENDPOINT')}")

        self.model = WhisperModel(
            model_size,
            device=device,
            compute_type=compute_type
        )

        # 音频缓冲区 (累积音频直到有足够数据)
        self.audio_buffer = np.array([], dtype=np.float32)
        self.min_chunk_size = 16000 * 2  # 至少 2 秒音频
        self.sample_rate = 16000
        self.total_audio_processed = 0

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
        buffer_len = len(self.audio_buffer)

        # 缓冲区不足,等待更多音频
        if buffer_len < self.min_chunk_size:
            return [], type("Info", (), {"language": "en"})()

        # 取出缓冲区内容
        audio_to_process = self.audio_buffer
        self.audio_buffer = np.array([], dtype=np.float32)
        self.total_audio_processed += len(audio_to_process)

        print(f"[ASR] Processing {len(audio_to_process)} samples ({len(audio_to_process)/16000:.1f}s), total: {self.total_audio_processed/16000:.1f}s")

        # 音频归一化：如果音量太低，自动提升增益
        peak = np.abs(audio_to_process).max()
        if peak > 0 and peak < 0.15:
            gain = 0.25 / peak
            audio_to_process = np.clip(audio_to_process * gain, -1.0, 1.0)
            print(f"[ASR] Audio normalized: peak={peak:.4f}, gain={gain:.2f}")

        try:
            # 执行转录
            # 使用 VAD 过滤静音，减少 Whisper 幻觉
            # condition_on_previous_text=False 避免重复幻觉
            segments, info = self.model.transcribe(
                audio_to_process,
                beam_size=5,
                vad_filter=True,
                vad_parameters=dict(
                    min_silence_duration_ms=300,
                    speech_pad_ms=200,
                    threshold=0.3,  # 降低 VAD 阈值，对安静语音更敏感
                ),
                condition_on_previous_text=False,  # 避免重复幻觉
                language=None,  # 自动检测语言
                task="transcribe",
                no_speech_threshold=0.6,  # 高于此概率认为是无语音
                log_prob_threshold=-1.0,  # 过滤低置信度结果
            )

            # 转换为列表 (必须消费 generator 否则不会执行)
            segments_list = list(segments)

            if segments_list:
                print(f"[ASR] Detected {len(segments_list)} segments, lang={info.language}, prob={info.language_probability:.2f}")
                for i, seg in enumerate(segments_list):
                    print(f"[ASR] Segment {i}: '{seg.text.strip()}'")
            else:
                print(f"[ASR] No speech detected in this chunk (lang={info.language})")

            return segments_list, info

        except Exception as e:
            print(f"[ASR] Transcription error: {e}")
            import traceback
            traceback.print_exc()
            return [], type("Info", (), {"language": "en"})()

    def reset(self):
        """重置缓冲区"""
        self.audio_buffer = np.array([], dtype=np.float32)
        print("[ASR] Buffer reset")
