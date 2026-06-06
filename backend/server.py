"""
EchoSub Python 后端 - FastAPI WebSocket 服务器
队列管线: audio_queue → asr_worker → translation_queue → translation_worker

停顿检测策略: 当 >600ms 无新音频到达时 (说话人停顿), 立即处理缓冲区并发送 asr_final;
说话中则在缓冲区达到最小长度时发送 asr_partial 提供实时反馈。
"""

import asyncio
import json
import logging
import os
import time
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import uvicorn

# 结构化日志配置
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(name)s] %(levelname)s: %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger("EchoSub")

from asr import ASREngine
from translator import Translator
from corrector import Corrector

app = FastAPI(title="EchoSub Backend")

asr_engine: ASREngine | None = None
translator: Translator | None = None
corrector: Corrector | None = None

segment_history: list[dict] = []
MAX_HISTORY = 20

# ASR segment ID 计数器（独立于 segment_history，避免翻译延迟导致 id 冲突）
asr_segment_counter = 0

DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1")
DEEPSEEK_MODEL = os.environ.get("DEEPSEEK_MODEL", "deepseek-chat")
ASR_MODEL = os.environ.get("ASR_MODEL", "small")
ASR_ONLY = os.environ.get("ASR_ONLY", "").lower() in ("1", "true", "yes")

ws_active = False

# ASR worker 参数 — 降低最小 chunk 以加快响应
ASR_CHUNK_SECONDS = 2.0     # 每次 ASR 的最小音频长度（从 5s 降低到 2s 加快响应）
ASR_OVERLAP_SECONDS = 0.5   # 滑动窗口重叠（从 1s 降低到 0.5s）
PAUSE_THRESHOLD_SECONDS = 0.6  # 停顿检测阈值：>600ms 无新音频视为一句话结束
MIN_SPEECH_FOR_PAUSE = 0.8     # 停顿触发处理的最少语音时长（秒），避免噪音误触发


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    global asr_engine, translator, corrector, ws_active

    await websocket.accept()
    ws_active = True
    if ASR_ONLY:
        await send_status(websocket, "asr_only", "ASR 测试模式 — 只识别不翻译")
        logger.info("Running in ASR-only mode (no translation)")
    else:
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
        if not ASR_ONLY:
            translation_task = asyncio.create_task(
                translation_worker(translation_queue, websocket, stop_event)
            )

        packet_count = 0
        last_log_time = 0

        while True:
            message = await websocket.receive()

            if message["type"] == "websocket.disconnect":
                logger.info("Client disconnected")
                break

            if message["type"] != "websocket.receive":
                continue

            if "text" in message:
                try:
                    msg = json.loads(message["text"])
                    if isinstance(msg, dict) and "type" in msg:
                        logger.debug(f"Control: {msg['type']}")
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
                logger.debug(f"Queued {packet_count} audio packets")
                last_log_time = now

            if asr_engine is None:
                await send_error(websocket, "ASR engine not initialized")
                continue

            audio_data = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0
            if len(audio_data) == 0:
                continue

            # 静音过滤保留但放宽阈值，避免过度过滤微弱语音
            if np.abs(audio_data).mean() < 0.003:
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
        logger.info("Client disconnected (WebSocketDisconnect)")
    except Exception as e:
        logger.error(f"WebSocket error: {e}", exc_info=True)
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
        logger.info("Connection closed, workers stopped")


# ---- Workers ----

async def asr_worker(
    audio_queue: asyncio.Queue,
    translation_queue: asyncio.Queue,
    websocket: WebSocket,
    stop_event: asyncio.Event,
):
    global asr_engine, segment_history, asr_segment_counter

    audio_buffer = np.array([], dtype=np.float32)
    min_samples = int(16000 * ASR_CHUNK_SECONDS)
    overlap = int(16000 * ASR_OVERLAP_SECONDS)
    min_speech_for_pause = int(16000 * MIN_SPEECH_FOR_PAUSE)

    # 累积已识别的文本，用于 condition_on_previous_text 模式下的增量提取
    accumulated_text = ""
    last_audio_time = time.monotonic()

    while not stop_event.is_set():
        try:
            chunk = await asyncio.wait_for(audio_queue.get(), timeout=0.1)
            audio_buffer = np.concatenate([audio_buffer, chunk])
            last_audio_time = time.monotonic()
        except asyncio.TimeoutError:
            pass

        buffer_len = len(audio_buffer)
        time_since_audio = time.monotonic() - last_audio_time
        is_pause = time_since_audio > PAUSE_THRESHOLD_SECONDS

        # 决定是否处理缓冲区:
        # 1. 缓冲区达到最小长度 → 处理 (说话中，发 asr_partial)
        # 2. 检测到停顿 且 缓冲区有足够语音 → 处理 (一句话结束，发 asr_final)
        should_process = False
        is_final = False

        if buffer_len >= min_samples:
            should_process = True
            is_final = is_pause  # 如果同时有停顿，标记为 final
        elif is_pause and buffer_len >= min_speech_for_pause:
            should_process = True
            is_final = True  # 停顿触发 → 一定是一句完整的话

        if not should_process:
            continue

        # 取出全部缓冲区内容处理
        process_data = audio_buffer.copy()

        # 滑动窗口：保留重叠部分到下一个 chunk
        if buffer_len > overlap:
            audio_buffer = audio_buffer[-overlap:]
        else:
            audio_buffer = np.array([], dtype=np.float32)

        # 停顿触发后重置 last_audio_time（避免连续触发）
        if is_final:
            last_audio_time = time.monotonic()

        loop = asyncio.get_event_loop()
        try:
            segments, info = await loop.run_in_executor(
                None, asr_engine.transcribe_chunk_direct, process_data
            )
        except Exception as e:
            logger.error(f"ASR Worker error: {e}")
            continue

        if not segments:
            continue

        # 拼接 whisper 识别结果
        full_text = " ".join(s.text.strip() for s in segments if s.text.strip())

        # ---- 增量提取 ----
        new_text = _extract_increment(full_text, accumulated_text)

        # 更新累积文本边界
        accumulated_text = full_text

        if not new_text:
            continue

        seg_id = f"seg-{asr_segment_counter}"
        asr_segment_counter += 1

        msg_type = "asr_final" if is_final else "asr_partial"
        logger.info(f"[{msg_type}] {new_text} (lang={info.language}, id={seg_id}, pause={is_pause:.2f}s)")

        await safe_send_json(websocket, {
            "type": msg_type,
            "data": {"id": seg_id, "text": new_text, "language": info.language}
        })

        # 只有 asr_final 才送翻译队列（完整句子才翻译，partial 不翻译）
        if is_final and not ASR_ONLY:
            try:
                translation_queue.put_nowait({
                    "segment_id": seg_id,
                    "source_text": new_text,
                    "language": info.language
                })
            except asyncio.QueueFull:
                logger.warning("Translation queue full")


def _extract_increment(full_text: str, accumulated: str) -> str:
    """
    从 whisper 输出中提取增量文本，支持累积和重叠两种模式。

    累积模式: full_text 以 accumulated 为前缀 → 截取尾部
    重叠模式: full_text 开头与 accumulated 尾部有重叠 → 逐词检测重叠后提取增量
    """
    if not accumulated:
        return full_text.strip()

    ft = full_text.strip()
    acc = accumulated.strip()

    # 累积模式: 纯前缀匹配
    if ft.startswith(acc):
        suffix = ft[len(acc):].strip()
        return suffix or ft  # 无增量时保留原文

    # 重叠模式: 从 accumulated 尾部取词，寻找与 full_text 开头的重叠
    acc_words = acc.split()
    ft_words = ft.split()
    max_check = min(len(acc_words), 50)

    for overlap_len in range(max_check, 0, -1):
        overlap_candidate = " ".join(acc_words[-overlap_len:])
        if overlap_candidate and ft.startswith(overlap_candidate):
            after_overlap = ft[len(overlap_candidate):].strip()
            if after_overlap:
                return after_overlap
            return ""  # 整段都是重叠，无新内容

    # 无匹配 → 大范围修正，返回全文
    logger.warning(f"Text mismatch, resetting. Old: '{acc[:50]}' New: '{ft[:50]}'")
    return ft


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
            logger.debug(f"Translating: '{src}'")
            accumulated = ""
            async for partial in translator.translate_stream(src, lang, "zh"):
                accumulated = partial
                await safe_send_json(websocket, {
                    "type": "translation_partial",
                    "data": {"id": sid, "text": partial, "originalText": src, "language": lang}
                })

            await safe_send_json(websocket, {
                "type": "translation_final",
                "data": {"id": sid, "text": accumulated, "originalText": src, "language": lang}
            })
            logger.info(f"-> '{accumulated[:40]}'")

            segment_history.append({
                "id": sid, "source": src, "translation": accumulated, "language": lang
            })
            if len(segment_history) > MAX_HISTORY:
                segment_history.pop(0)

            if corrector and ws_active:
                asyncio.create_task(run_correction(websocket, sid, src, accumulated))

        except Exception as e:
            logger.error(f"Error translating '{src[:50]}': {e}", exc_info=True)


# ---- Helpers ----

async def safe_send_json(websocket: WebSocket, data: dict):
    global ws_active
    if not ws_active:
        return
    try:
        await websocket.send_json(data)
    except Exception as e:
        logger.error(f"Failed to send: {e}")
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
            logger.info(f"Language set: {language}")
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
        logger.error(f"Correction error: {e}")


async def send_status(websocket: WebSocket, status: str, message: str):
    await safe_send_json(websocket, {"type": "status", "data": {"message": f"{status}: {message}"}})


async def send_error(websocket: WebSocket, message: str):
    await safe_send_json(websocket, {"type": "error", "data": {"message": message}})


def init_engines():
    global asr_engine, translator, corrector

    os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
    logger.info(f"HF_ENDPOINT: {os.environ.get('HF_ENDPOINT')}")

    logger.info(f"Initializing ASR engine (model={ASR_MODEL})...")
    asr_engine = ASREngine(model_size=ASR_MODEL)

    logger.info("Initializing DeepSeek translator...")
    translator = Translator(api_key=DEEPSEEK_API_KEY, base_url=DEEPSEEK_BASE_URL, model=DEEPSEEK_MODEL)

    logger.info("Initializing DeepSeek corrector...")
    corrector = Corrector(api_key=DEEPSEEK_API_KEY, base_url=DEEPSEEK_BASE_URL, model=DEEPSEEK_MODEL)

    logger.info("All engines initialized!")
    logger.info(f"  ASR: {ASR_MODEL} | chunk={ASR_CHUNK_SECONDS}s overlap={ASR_OVERLAP_SECONDS}s | pause={PAUSE_THRESHOLD_SECONDS}s")
    logger.info(f"  Translation: DeepSeek ({DEEPSEEK_MODEL})")
    if DEEPSEEK_API_KEY:
        logger.info("  API Key: *** (已配置)")
    else:
        logger.warning("  API Key 未设置！请在 .env 文件中配置 DEEPSEEK_API_KEY")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8765))
    init_engines()
    logger.info(f"Starting EchoSub backend on port {port}")
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")