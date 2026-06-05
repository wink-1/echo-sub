"""
EchoSub Python 后端 - FastAPI WebSocket 服务器
队列管线: audio_queue → asr_worker → translation_queue → translation_worker
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

asr_engine: ASREngine | None = None
translator: Translator | None = None
corrector: Corrector | None = None

segment_history: list[dict] = []
MAX_HISTORY = 20

DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1")
DEEPSEEK_MODEL = os.environ.get("DEEPSEEK_MODEL", "deepseek-chat")
ASR_MODEL = os.environ.get("ASR_MODEL", "small")

ws_active = False

# ASR worker 参数
ASR_CHUNK_SECONDS = 0.8    # 每次 ASR 的最小音频长度
ASR_OVERLAP_SECONDS = 0.3  # 滑动窗口重叠


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    global asr_engine, translator, corrector, ws_active

    await websocket.accept()
    ws_active = True
    await send_status(websocket, "connected", "Backend connected")

    audio_queue: asyncio.Queue = asyncio.Queue(maxsize=200)
    translation_queue: asyncio.Queue = asyncio.Queue(maxsize=100)
    stop_event = asyncio.Event()

    asr_task = None
    translation_task = None

    try:
        asr_task = asyncio.create_task(
            asr_worker(audio_queue, translation_queue, websocket, stop_event)
        )
        translation_task = asyncio.create_task(
            translation_worker(translation_queue, websocket, stop_event)
        )

        packet_count = 0
        last_log_time = 0

        while True:
            message = await websocket.receive()

            if message["type"] == "websocket.disconnect":
                print("[WS] Client disconnected")
                break

            if message["type"] != "websocket.receive":
                continue

            if "text" in message:
                try:
                    msg = json.loads(message["text"])
                    if isinstance(msg, dict) and "type" in msg:
                        print(f"[WS] Control: {msg['type']}")
                        await handle_control_message(websocket, msg)
                except (json.JSONDecodeError, KeyError):
                    pass
                continue

            if "bytes" not in message:
                continue

            data = message["bytes"]
            packet_count += 1
            now = asyncio.get_event_loop().time()
            if now - last_log_time > 5:
                print(f"[WS] Queued {packet_count} audio packets")
                last_log_time = now

            if asr_engine is None:
                await send_error(websocket, "ASR engine not initialized")
                continue

            audio_data = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0
            if len(audio_data) == 0:
                continue
            if np.abs(audio_data).mean() < 0.005:
                continue

            try:
                audio_queue.put_nowait(audio_data)
            except asyncio.QueueFull:
                try:
                    audio_queue.get_nowait()
                    audio_queue.put_nowait(audio_data)
                except asyncio.QueueEmpty:
                    pass

    except WebSocketDisconnect:
        print("[WS] Client disconnected (WebSocketDisconnect)")
    except Exception as e:
        print(f"[WS] WebSocket error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        stop_event.set()
        ws_active = False
        for t in [asr_task, translation_task]:
            if t and not t.done():
                t.cancel()
                try:
                    await asyncio.wait_for(t, timeout=3.0)
                except (asyncio.CancelledError, asyncio.TimeoutError):
                    pass
        print("[WS] Connection closed, workers stopped")


# ---- Workers ----

async def asr_worker(
    audio_queue: asyncio.Queue,
    translation_queue: asyncio.Queue,
    websocket: WebSocket,
    stop_event: asyncio.Event,
):
    global asr_engine, segment_history

    audio_buffer = np.array([], dtype=np.float32)
    min_samples = int(16000 * ASR_CHUNK_SECONDS)
    overlap = int(16000 * ASR_OVERLAP_SECONDS)

    while not stop_event.is_set():
        try:
            chunk = await asyncio.wait_for(audio_queue.get(), timeout=0.1)
            audio_buffer = np.concatenate([audio_buffer, chunk])
        except asyncio.TimeoutError:
            pass

        if len(audio_buffer) < min_samples:
            continue

        process_data = audio_buffer.copy()
        audio_buffer = audio_buffer[-overlap:] if len(audio_buffer) > overlap else np.array([], dtype=np.float32)

        loop = asyncio.get_event_loop()
        try:
            segments, info = await loop.run_in_executor(
                None, asr_engine.transcribe_chunk_direct, process_data
            )
        except Exception as e:
            print(f"[ASR Worker] Error: {e}")
            continue

        # Partial: 发送当前全部文本作为流式预览
        if segments:
            full_text = " ".join(s.text.strip() for s in segments if s.text.strip())
            if full_text:
                await safe_send_json(websocket, {
                    "type": "asr_partial",
                    "data": {"text": full_text, "language": info.language}
                })

        for segment in segments:
            source_text = segment.text.strip()
            if not source_text:
                continue
            if segment_history and segment_history[-1].get("source") == source_text:
                continue

            seg_id = f"seg-{len(segment_history)}"
            print(f"[ASR Worker] {source_text} (lang={info.language})")

            await safe_send_json(websocket, {
                "type": "asr_final",
                "data": {"id": seg_id, "text": source_text, "language": info.language}
            })

            try:
                translation_queue.put_nowait({
                    "segment_id": seg_id,
                    "source_text": source_text,
                    "language": info.language
                })
            except asyncio.QueueFull:
                print("[ASR Worker] Translation queue full")


async def translation_worker(
    translation_queue: asyncio.Queue,
    websocket: WebSocket,
    stop_event: asyncio.Event,
):
    global translator, corrector, segment_history, ws_active

    while not stop_event.is_set():
        try:
            entry = await asyncio.wait_for(translation_queue.get(), timeout=0.2)
        except asyncio.TimeoutError:
            continue

        if not translator:
            continue

        src = entry["source_text"]
        lang = entry["language"]
        sid = entry["segment_id"]

        try:
            print(f"[Trans Worker] Translating: '{src}'")
            translated = await translator.translate(src, lang, "zh")
            print(f"[Trans Worker] -> '{translated}'")

            await safe_send_json(websocket, {
                "type": "translation_final",
                "data": {"id": sid, "text": translated, "originalText": src, "language": lang}
            })

            segment_history.append({
                "id": sid, "source": src, "translation": translated, "language": lang
            })
            if len(segment_history) > MAX_HISTORY:
                segment_history.pop(0)

            if corrector and ws_active:
                asyncio.create_task(run_correction(websocket, sid, src, translated))

        except Exception as e:
            print(f"[Trans Worker] Error: {e}")


# ---- Helpers ----

async def safe_send_json(websocket: WebSocket, data: dict):
    global ws_active
    if not ws_active:
        return
    try:
        await websocket.send_json(data)
    except Exception as e:
        print(f"[WS] Failed to send: {e}")
        ws_active = False


async def handle_control_message(websocket: WebSocket, msg: dict):
    global asr_engine
    msg_type = msg.get("type")
    data = msg.get("data", {})

    if msg_type == "start":
        await send_status(websocket, "started", "Processing started")
    elif msg_type == "stop":
        await send_status(websocket, "stopped", "Processing stopped")
    elif msg_type == "set_language":
        language = data.get("language", "auto")
        if asr_engine:
            asr_engine.forced_language = None if language == "auto" else language
            print(f"[ASR] Language set: {language}")
        await send_status(websocket, "language_set", f"Language={language}")


async def run_correction(websocket, seg_id, source_text, translation):
    global ws_active
    if not corrector or not ws_active:
        return
    await asyncio.sleep(2)
    if not ws_active:
        return
    try:
        ctx = [s["translation"] for s in segment_history[-3:-1]]
        result = await corrector.correct(source_text, translation, ctx)
        if result["changed"] and ws_active:
            await safe_send_json(websocket, {
                "type": "correction",
                "data": {"id": seg_id, "text": result["corrected"], "correctedText": result["corrected"], "originalText": source_text, "changed": True}
            })
            for seg in segment_history:
                if seg["id"] == seg_id:
                    seg["translation"] = result["corrected"]
                    break
    except Exception as e:
        print(f"[Correction] Error: {e}")


async def send_status(websocket: WebSocket, status: str, message: str):
    await safe_send_json(websocket, {"type": "status", "data": {"message": f"{status}: {message}"}})


async def send_error(websocket: WebSocket, message: str):
    await safe_send_json(websocket, {"type": "error", "data": {"message": message}})


def init_engines():
    global asr_engine, translator, corrector

    os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
    print(f"HF_ENDPOINT: {os.environ.get('HF_ENDPOINT')}")

    print(f"Initializing ASR engine (model={ASR_MODEL})...")
    asr_engine = ASREngine(model_size=ASR_MODEL)

    print("Initializing DeepSeek translator...")
    translator = Translator(api_key=DEEPSEEK_API_KEY, base_url=DEEPSEEK_BASE_URL, model=DEEPSEEK_MODEL)

    print("Initializing DeepSeek corrector...")
    corrector = Corrector(api_key=DEEPSEEK_API_KEY, base_url=DEEPSEEK_BASE_URL, model=DEEPSEEK_MODEL)

    print("All engines initialized!")
    print(f"  ASR: {ASR_MODEL} | chunk={ASR_CHUNK_SECONDS}s overlap={ASR_OVERLAP_SECONDS}s")
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
