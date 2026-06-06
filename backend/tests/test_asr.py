"""
ASR 引擎和辅助函数测试
"""
import pytest
from asr import _info_stub, ASRInfo, TRANSCRIBE_PARAMS, _detect_device


class TestASRInfo:
    def test_info_stub_defaults(self):
        info = _info_stub()
        assert isinstance(info, ASRInfo)
        assert info.language == "en"
        assert info.language_probability == 0.0

    def test_info_stub_custom_lang(self):
        info = _info_stub("ja")
        assert info.language == "ja"
        assert info.language_probability == 0.0


class TestTranscribeParams:
    def test_params_structure(self):
        assert TRANSCRIBE_PARAMS["beam_size"] == 10
        assert TRANSCRIBE_PARAMS["best_of"] == 5
        assert TRANSCRIBE_PARAMS["temperature"] == 0.0
        assert TRANSCRIBE_PARAMS["task"] == "transcribe"
        assert TRANSCRIBE_PARAMS["vad_filter"] is True
        assert TRANSCRIBE_PARAMS["condition_on_previous_text"] is True

    def test_vad_parameters(self):
        vad = TRANSCRIBE_PARAMS["vad_parameters"]
        assert vad["min_silence_duration_ms"] == 500
        assert vad["threshold"] == 0.3


class TestDeviceDetection:
    def test_returns_string(self):
        device = _detect_device()
        assert device in ("cuda", "mps", "cpu")
