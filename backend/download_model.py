"""
ASR 模型预下载脚本
首次运行时自动下载 Whisper 模型到缓存，后续启动无需等待。
"""

import os
import sys

# 国内 HuggingFace 镜像
HF_MIRROR = "https://hf-mirror.com"
os.environ.setdefault("HF_ENDPOINT", HF_MIRROR)


def download_model(model_size: str = "small") -> bool:
    """下载并缓存 Whisper 模型。如果已缓存则跳过。"""
    from faster_whisper import WhisperModel

    cache_dir = os.path.expanduser(f"~/.cache/huggingface/hub/models--Systran--faster-whisper-{model_size}")

    if os.path.isdir(cache_dir):
        print(f"[Download] 模型 {model_size} 已缓存，跳过下载")
        return True

    print(f"[Download] 首次运行，正在下载 {model_size} 模型...")
    print(f"[Download] 模型大小: ~{_model_size_mb(model_size)}MB，请耐心等待...")
    print(f"[Download] 镜像源: {HF_MIRROR}")

    try:
        # 下载到 CPU/int8（最小配置，下载最快）
        model = WhisperModel(model_size, device="cpu", compute_type="int8")
        print(f"[Download] ✅ 模型 {model_size} 下载完成！")
        print(f"[Download] 缓存路径: {cache_dir}")
        return True
    except Exception as e:
        print(f"[Download] ❌ 下载失败: {e}")
        return False


def _model_size_mb(size: str) -> str:
    sizes = {"tiny": "39", "base": "74", "small": "244", "medium": "769", "large-v3-turbo": "809"}
    return sizes.get(size, "?")


if __name__ == "__main__":
    model = os.environ.get("ASR_MODEL", "small")
    success = download_model(model)
    sys.exit(0 if success else 1)
