"""
EchoSub Python 后端 - FastAPI WebSocket 服务器
接收音频流,执行 ASR + 翻译 + 纠错,返回结果
"""

import asyncio
import json
import os
import sys
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from asr import ASREngine
from translator import Translator
from corrector import Corrector

app = FastAPI(title="EchoSub Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 全局引擎实例
asr_engine: ASREngine | None = None
translator: Translator | None = None
corrector: Corrector | None = None

# 翻译段落历史 (用于纠错上下文)
segment_history: list[dict] = []
MAX_HISTORY = 20


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """主 WebSocket 端点 - 接收音频流,返回翻译结果"""
    global asr_engine, translator, corrector

    await websocket.accept()
    await send_status(websocket, "connected", "Backend connected")

    try:
        while True:
            data = await websocket.receive_bytes()

            # 检查是否是 JSON 控制消息
            try:
                msg = json.loads(data.decode("utf-8"))
                if isinstance(msg, dict) and "type" in msg:
                    await handle_control_message(websocket, msg)
                    continue
            except (UnicodeDecodeError, json.JSONDecodeError):
                pass

            # 处理音频数据
            if asr_engine is None:
                await send_error(websocket, "ASR engine not initialized")
                continue

            # PCM 16bit 16kHz mono → numpy array
            audio_data = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0

            if len(audio_data) == 0:
                continue

            # ASR 识别
            segments, info = asr_engine.transcribe_chunk(audio_data)

            for segment in segments:
                source_text = segment.text.strip()
                if not source_text:
                    continue

                # 发送 ASR 结果
                await websocket.send_json({
                    "type": "asr_final",
                    "data": {
                        "id": f"seg-{len(segment_history)}",
                        "text": source_text,
                        "language": info.language
                    }
                })

                # 翻译
                if translator:
                    translated = await translator.translate(
                        source_text, info.language, "zh"
                    )

                    # 发送翻译结果
                    segment_id = f"seg-{len(segment_history)}"
                    await websocket.send_json({
                        "type": "translation_final",
                        "data": {
                            "id": segment_id,
                            "text": translated,
                            "originalText": source_text,
                            "language": info.language
                        }
                    })

                    # 添加到历史
                    segment_history.append({
                        "id": segment_id,
                        "source": source_text,
                        "translation": translated,
                        "language": info.language
                    })

                    # 保持历史长度
                    if len(segment_history) > MAX_HISTORY:
                        segment_history.pop(0)

                    # 异步触发纠错
                    if corrector:
                        asyncio.create_task(
                            run_correction(websocket, segment_id, source_text, translated)
                        )

    except WebSocketDisconnect:
        print("Client disconnected")
    except Exception as e:
        print(f"WebSocket error: {e}")
        import traceback
        traceback.print_exc()


async def handle_control_message(websocket: WebSocket, msg: dict):
    """处理控制消息"""
    msg_type = msg.get("type")
    data = msg.get("data", {})

    if msg_type == "start":
        await send_status(websocket, "started", "Processing started")
    elif msg_type == "stop":
        await send_status(websocket, "stopped", "Processing stopped")
    elif msg_type == "set_language":
        language = data.get("language", "auto")
        await send_status(websocket, "language_set", f"Language set to {language}")
    elif msg_type == "set_model":
        model = data.get("model", "large-v3-turbo")
        await send_status(websocket, "model_set", f"Model set to {model}")


async def run_correction(
    websocket: WebSocket,
    segment_id: str,
    source_text: str,
    current_translation: str
):
    """异步执行纠错"""
    if not corrector:
        return

    # 等待 2 秒,让更多上下文到达
    await asyncio.sleep(2)

    # 获取上下文
    context_before = [s["translation"] for s in segment_history[-3:-1]]

    result = await corrector.correct(
        source_text, current_translation, context_before
    )

    if result["changed"]:
        await websocket.send_json({
            "type": "correction",
            "data": {
                "id": segment_id,
                "text": result["corrected"],
                "correctedText": result["corrected"],
                "originalText": source_text,
                "changed": True
            }
        })

        # 更新历史
        for seg in segment_history:
            if seg["id"] == segment_id:
                seg["translation"] = result["corrected"]
                break


async def send_status(websocket: WebSocket, status: str, message: str):
    """发送状态消息"""
    await websocket.send_json({
        "type": "status",
        "data": {"message": f"{status}: {message}"}
    })


async def send_error(websocket: WebSocket, message: str):
    """发送错误消息"""
    await websocket.send_json({
        "type": "error",
        "data": {"message": message}
    })


def init_engines():
    """初始化 ASR、翻译、纠错引擎"""
    global asr_engine, translator, corrector

    print("Initializing ASR engine...")
    asr_engine = ASREngine()

    print("Initializing translator...")
    translator = Translator()

    print("Initializing corrector...")
    corrector = Corrector()

    print("All engines initialized!")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8765))

    # 初始化引擎
    init_engines()

    print(f"Starting EchoSub backend on port {port}")
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
