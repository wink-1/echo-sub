"""
EchoSub Python 后端 - FastAPI WebSocket 服务器
接收音频流,执行 ASR + 翻译 + 纠错,返回结果
"""

import asyncio
import json
import os
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import uvicorn

from asr import ASREngine
from translator import Translator
from corrector import Corrector

app = FastAPI(title="EchoSub Backend")

# 全局引擎实例
asr_engine: ASREngine | None = None
translator: Translator | None = None
corrector: Corrector | None = None

# 翻译段落历史 (用于纠错上下文)
segment_history: list[dict] = []
MAX_HISTORY = 20

# DeepSeek API 配置 (从环境变量读取，不硬编码！Key 存放在 .env 文件中)
DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1")
DEEPSEEK_MODEL = os.environ.get("DEEPSEEK_MODEL", "deepseek-chat")

# ASR 模型配置
ASR_MODEL = os.environ.get("ASR_MODEL", "medium")

# WebSocket 连接是否活跃 (用于判断纠错任务是否应该继续发送)
ws_active = False


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """主 WebSocket 端点 - 接收音频流,返回翻译结果"""
    global asr_engine, translator, corrector, ws_active

    await websocket.accept()
    ws_active = True
    await send_status(websocket, "connected", "Backend connected")

    packet_count = 0
    last_log_time = 0

    try:
        while True:
            message = await websocket.receive()

            if message["type"] == "websocket.disconnect":
                print("[WS] Client disconnected")
                break

            if message["type"] != "websocket.receive":
                continue

            # JSON 控制消息 (text frame)
            if "text" in message:
                try:
                    msg = json.loads(message["text"])
                    if isinstance(msg, dict) and "type" in msg:
                        print(f"[WS] Control message: {msg['type']}")
                        await handle_control_message(websocket, msg)
                except (json.JSONDecodeError, KeyError):
                    pass
                continue

            # PCM 音频数据 (binary frame)
            if "bytes" in message:
                data = message["bytes"]
            else:
                continue

            packet_count += 1
            now = asyncio.get_event_loop().time()
            if now - last_log_time > 5:
                print(f"[WS] Received {packet_count} audio packets so far")
                last_log_time = now

            if asr_engine is None:
                await send_error(websocket, "ASR engine not initialized")
                continue

            # PCM 16bit 16kHz mono → numpy array
            audio_data = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0

            if len(audio_data) == 0:
                continue

            # 检查音频电平
            audio_level = np.abs(audio_data).mean()
            peak_level = np.abs(audio_data).max()
            if packet_count <= 5 or packet_count % 40 == 0:
                print(f"[WS] Packet #{packet_count}: {len(audio_data)} samples, level={audio_level:.4f}, peak={peak_level:.4f}")

            # 静音检测：如果平均音量太低，跳过 ASR（减少误识别）
            if audio_level < 0.005:
                continue

            # ASR 识别 (在线程池中执行，避免阻塞事件循环)
            loop = asyncio.get_event_loop()
            segments, info = await loop.run_in_executor(
                None, asr_engine.transcribe_chunk, audio_data
            )

            for segment in segments:
                source_text = segment.text.strip()
                if not source_text:
                    continue

                # 过滤 Whisper 幻觉：如果和上一句完全相同，跳过
                if segment_history and segment_history[-1]["source"] == source_text:
                    print(f"[WS] Skipping duplicate: '{source_text}'")
                    continue

                print(f"[WS] ASR result: '{source_text}' (lang={info.language})")

                # 发送 ASR 结果
                segment_id = f"seg-{len(segment_history)}"
                await safe_send_json(websocket, {
                    "type": "asr_final",
                    "data": {
                        "id": segment_id,
                        "text": source_text,
                        "language": info.language
                    }
                })

                # 翻译 (DeepSeek API)
                if translator:
                    print(f"[WS] Translating: '{source_text}'")
                    translated = await translator.translate(
                        source_text, info.language, "zh"
                    )
                    print(f"[WS] Translation: '{translated}'")

                    # 发送翻译结果
                    await safe_send_json(websocket, {
                        "type": "translation_final",
                        "data": {
                            "id": segment_id,
                            "text": translated,
                            "originalText": source_text,
                            "language": info.language
                        }
                    })

                    segment_history.append({
                        "id": segment_id,
                        "source": source_text,
                        "translation": translated,
                        "language": info.language
                    })

                    if len(segment_history) > MAX_HISTORY:
                        segment_history.pop(0)

                    # 异步纠错 (带 ws_active 检查)
                    if corrector:
                        asyncio.create_task(
                            run_correction(websocket, segment_id, source_text, translated)
                        )

    except WebSocketDisconnect:
        print("[WS] Client disconnected (WebSocketDisconnect)")
    except Exception as e:
        print(f"[WS] WebSocket error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        ws_active = False
        print("[WS] Connection closed, ws_active=False")


async def safe_send_json(websocket: WebSocket, data: dict):
    """安全发送 JSON，连接已关闭时不报错"""
    global ws_active
    if not ws_active:
        return
    try:
        await websocket.send_json(data)
    except Exception as e:
        print(f"[WS] Failed to send (connection may be closed): {e}")
        ws_active = False


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


async def run_correction(
    websocket: WebSocket,
    segment_id: str,
    source_text: str,
    current_translation: str
):
    """异步执行纠错"""
    global ws_active
    if not corrector or not ws_active:
        return

    await asyncio.sleep(2)

    # 再次检查连接状态
    if not ws_active:
        return

    context_before = [s["translation"] for s in segment_history[-3:-1]]

    try:
        result = await corrector.correct(
            source_text, current_translation, context_before
        )

        if result["changed"] and ws_active:
            await safe_send_json(websocket, {
                "type": "correction",
                "data": {
                    "id": segment_id,
                    "text": result["corrected"],
                    "correctedText": result["corrected"],
                    "originalText": source_text,
                    "changed": True
                }
            })

            for seg in segment_history:
                if seg["id"] == segment_id:
                    seg["translation"] = result["corrected"]
                    break
    except Exception as e:
        print(f"[WS] Correction error: {e}")


async def send_status(websocket: WebSocket, status: str, message: str):
    await safe_send_json(websocket, {
        "type": "status",
        "data": {"message": f"{status}: {message}"}
    })


async def send_error(websocket: WebSocket, message: str):
    await safe_send_json(websocket, {
        "type": "error",
        "data": {"message": message}
    })


def init_engines():
    """初始化 ASR、翻译、纠错引擎"""
    global asr_engine, translator, corrector

    os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
    print(f"HF_ENDPOINT: {os.environ.get('HF_ENDPOINT')}")

    print(f"Initializing ASR engine (model={ASR_MODEL})...")
    asr_engine = ASREngine(model_size=ASR_MODEL)

    print("Initializing DeepSeek translator...")
    translator = Translator(
        api_key=DEEPSEEK_API_KEY,
        base_url=DEEPSEEK_BASE_URL,
        model=DEEPSEEK_MODEL
    )

    print("Initializing DeepSeek corrector...")
    corrector = Corrector(
        api_key=DEEPSEEK_API_KEY,
        base_url=DEEPSEEK_BASE_URL,
        model=DEEPSEEK_MODEL
    )

    print("All engines initialized!")
    print(f"  ASR: {ASR_MODEL}")
    print(f"  Translation: DeepSeek ({DEEPSEEK_MODEL})")
    if DEEPSEEK_API_KEY:
        print(f"  API Key: {DEEPSEEK_API_KEY[:8]}...")
    else:
        print("  ⚠️  API Key 未设置！请在 .env 文件中配置 DEEPSEEK_API_KEY")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8765))
    init_engines()
    print(f"Starting EchoSub backend on port {port}")
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
