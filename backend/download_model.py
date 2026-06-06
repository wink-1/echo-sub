"""
ASR 模型预下载脚本
首次运行时自动下载 Whisper 模型到缓存，后续启动无需等待。
可通过环境变量 HF_ENDPOINT 配置 HuggingFace 镜像源。
"""

import os
import sys

# 优先使用环境变量，否则使用官方源
HF_MIRROR = os.environ.get("HF_ENDPOINT", "https://huggingface.co")
os.environ.setdefault("HF_ENDPOINT", HF_MIRROR)


def _model_is_cached(model_size: str) -> bool:
    """检查模型是否已完整缓存到本地。"""
    model_dir = os.path.expanduser(
        f"~/.cache/huggingface/hub/models--Systran--faster-whisper-{model_size}"
    )
    if not os.path.isdir(model_dir):
        return False

    # 必须有 refs/main（确认是从 main 分支下载的）
    if not os.path.isfile(os.path.join(model_dir, "refs", "main")):
        return False

    # 必须有 snapshots 目录且非空（模型文件实际存在）
    snapshots_dir = os.path.join(model_dir, "snapshots")
    if not os.path.isdir(snapshots_dir):
        return False

    # 至少有一个快照子目录且包含模型文件
    for entry in os.listdir(snapshots_dir):
        snapshot_path = os.path.join(snapshots_dir, entry)
        if os.path.isdir(snapshot_path) and len(os.listdir(snapshot_path)) > 0:
            return True

    return False


def download_model(model_size: str = "small") -> bool:
    """下载并缓存 Whisper 模型。如果已缓存则跳过。"""
    from faster_whisper import WhisperModel

    cache_dir = os.path.expanduser(
        f"~/.cache/huggingface/hub/models--Systran--faster-whisper-{model_size}"
    )

    if _model_is_cached(model_size):
        print(f"[Download] 模型 {model_size} 已缓存，跳过下载")
        return True

    print(f"[Download] 首次运行，正在下载 {model_size} 模型...")
    print(f"[Download] 模型大小: ~{_model_size_mb(model_size)}MB，请耐心等待...")
    print(f"[Download] 下载源: {HF_MIRROR}")

    try:
        # 下载到 CPU/int8（最小配置，下载最快）
        model = WhisperModel(model_size, device="cpu", compute_type="int8")
        print(f"[Download] [OK] 模型 {model_size} 下载完成！")
        print(f"[Download] 缓存路径: {cache_dir}")
        return True
    except Exception as e:
        print(f"[Download] [FAIL] 下载失败: {e}")
        return False


def _model_size_mb(size: str) -> str:
    sizes = {"tiny": "39", "base": "74", "small": "244", "medium": "769", "large-v3-turbo": "809"}
    return sizes.get(size, "?")


if __name__ == "__main__":
    model = os.environ.get("ASR_MODEL", "small")
    success = download_model(model)
    sys.exit(0 if success else 1)
