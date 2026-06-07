"""
EchoSub Python 后端 - FastAPI WebSocket 服务器
队列管线: audio_queue → asr_worker → translation_queue → translation_worker

句子边界检测策略（标点优先 + 停顿辅助）:
- 标点优先: 当 whisper 输出以句号/问号等结尾 且 整体文本足够长(≥2词/≥10字符)时,
  即使没有停顿也判定为 asr_final — 这样连续说话也能正确翻译
- 停顿辅助: 停顿 >1.0s + 增量足够长 → asr_final (处理无标点的句子结束)
- 绝对超时 3.0s: 停顿非常长时无论如何都要 finalize
- 最短长度: 短碎片(<2词/<10字符)如 "live." 即使有标点也不单独翻译,
  会继续积累直到形成足够长的完整句子

停顿提升: 如果停顿出现但缓冲区太小无法处理, 将最后一个 asr_partial 提升为 asr_final
以满足相同条件 (标点+长度 或 长停顿+长度)。
"""

# ═══════════════════════════════════════════════════════════════
# Windows 控制台 UTF-8 — 必须在任何 import 前执行
# ═══════════════════════════════════════════════════════════════
import sys as _sys
if _sys.platform == 'win32':
    import ctypes as _ctypes
    try:
        _ctypes.windll.kernel32.SetConsoleCP(65001)
        _ctypes.windll.kernel32.SetConsoleOutputCP(65001)
    except Exception:
        pass  # 非控制台环境（如管道输出）忽略

# 冗余兜底：同时包装 stdout/stderr 为 UTF-8
import io as _io
if hasattr(_sys.stdout, 'buffer'):
    _sys.stdout = _io.TextIOWrapper(_sys.stdout.buffer, encoding='utf-8',
                                     errors='replace', line_buffering=True)
if hasattr(_sys.stderr, 'buffer'):
    _sys.stderr = _io.TextIOWrapper(_sys.stderr.buffer, encoding='utf-8',
                                     errors='replace', line_buffering=True)

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

# ASR worker 参数 — 标点优先 + 停顿辅助的句子边界检测
ASR_CHUNK_SECONDS = 2.0     # 每次 ASR 的最小音频长度
ASR_OVERLAP_SECONDS = 0.5   # 滑动窗口重叠
PAUSE_THRESHOLD_SECONDS = 1.0   # 停顿辅助阈值：>1.0s 停顿 + 足够增量 → finalize
ABSOLUTE_TIMEOUT = 3.0          # 绝对超时：>3s 停顿无论如何都 finalize
SENTENCE_END_CHARS = '.!?。！？' # 句子结束标点
MIN_FINAL_WORDS = 2             # finalize 最少单词数（"live." 1词不够, "Hello world." 2词足够）
MIN_FINAL_CHARS = 10            # finalize 最少字符数
MIN_SPEECH_FOR_PAUSE = 0.8      # 停顿触发处理的最少语音时长（秒）

# 跨 final 聚合参数
MIN_FLUSH_WORDS = 12      # 以标点结尾时，最少词数才立即 flush（避免短碎片单独翻译）
MAX_FLUSH_WORDS = 30      # 累积文本最大词数，超过强制 flush
FLUSH_TIMEOUT = 2.0       # 距离上次文本到达的最大等待时间（秒），超时强制 flush


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

    # 停顿提升追踪：记录最后一个 asr_partial，当停顿出现但缓冲区不足时提升为 final
    last_partial_text = ""
    last_partial_id = ""
    last_partial_language = ""
    last_partial_full_text = ""
    last_partial_full_word_count = 0
    last_partial_full_char_count = 0
    last_partial_has_punctuation = False

    # 句子累积器：将同一句话的所有 partial + final 文本累积，final 时翻译完整句子
    sentence_accumulator = ""
    # 最后一次有文本到达的时间（用于超时 flush）
    last_text_arrival_time = 0.0

    while not stop_event.is_set():
        try:
            chunk = await asyncio.wait_for(audio_queue.get(), timeout=0.1)
            audio_buffer = np.concatenate([audio_buffer, chunk])
            last_audio_time = time.monotonic()
        except asyncio.TimeoutError:
            pass

        buffer_len = len(audio_buffer)
        time_since_audio = time.monotonic() - last_audio_time

        # ---- 停顿提升 ----
        # 当停顿出现但缓冲区太小无法处理时，将最后一个 partial 提升为 final
        # 条件与正常 is_final 相同：标点+足够长度 或 长停顿+足够长度 或 绝对超时
        if time_since_audio > PAUSE_THRESHOLD_SECONDS and buffer_len < min_speech_for_pause and last_partial_text:
            should_promote = False
            # 标点优先: fullText 以标点结尾 + 整体长度足够 → promote
            if last_partial_has_punctuation and (
                last_partial_full_word_count >= MIN_FINAL_WORDS or last_partial_full_char_count >= MIN_FINAL_CHARS
            ):
                should_promote = True
            # 长停顿 + 增量长度足够 → promote
            elif time_since_audio > PAUSE_THRESHOLD_SECONDS and (
                len(last_partial_text.split()) >= MIN_FINAL_WORDS or len(last_partial_text.strip()) >= MIN_FINAL_CHARS
            ):
                should_promote = True
            # 绝对超时 → 无论如何 promote
            elif time_since_audio > ABSOLUTE_TIMEOUT:
                should_promote = True

            if should_promote:
                logger.info(f"[pause-promote] '{last_partial_text[:30]}' → final (pause={time_since_audio:.2f}s)")

                # 将停顿提升的文本追加到累积器
                if sentence_accumulator:
                    sentence_accumulator += " " + last_partial_text
                else:
                    sentence_accumulator = last_partial_text
                last_text_arrival_time = time.monotonic()

                # 检查是否应该 flush
                should_flush = False
                acc_words = len(sentence_accumulator.split())
                if sentence_accumulator.strip() and sentence_accumulator.strip()[-1] in SENTENCE_END_CHARS and acc_words >= MIN_FLUSH_WORDS:
                    should_flush = True
                if acc_words >= MAX_FLUSH_WORDS:
                    should_flush = True

                seg_id = f"seg-{asr_segment_counter}"
                asr_segment_counter += 1

                if should_flush:
                    await safe_send_json(websocket, {
                        "type": "asr_final",
                        "data": {
                            "id": seg_id,
                            "text": sentence_accumulator,
                            "fullText": sentence_accumulator,
                            "language": last_partial_language
                        }
                    })
                    if not ASR_ONLY:
                        try:
                            translation_queue.put_nowait({
                                "segment_id": seg_id,
                                "source_text": sentence_accumulator,
                                "language": last_partial_language
                            })
                        except asyncio.QueueFull:
                            logger.warning("Translation queue full")
                    sentence_accumulator = ""
                    last_text_arrival_time = 0.0
                else:
                    await safe_send_json(websocket, {
                        "type": "asr_partial",
                        "data": {
                            "id": seg_id,
                            "text": last_partial_text,
                            "fullText": sentence_accumulator,
                            "language": last_partial_language
                        }
                    })

                # 清除 partial 追踪
                last_partial_text = ""
                last_partial_id = ""
                last_partial_language = ""
                last_partial_full_text = ""
                last_partial_full_word_count = 0
                last_partial_full_char_count = 0
                last_partial_has_punctuation = False
                last_audio_time = time.monotonic()
                continue

        # ---- 句子累积器超时 flush ----
        if sentence_accumulator and last_text_arrival_time > 0 and (time.monotonic() - last_text_arrival_time) > FLUSH_TIMEOUT:
            seg_id = f"seg-{asr_segment_counter}"
            asr_segment_counter += 1
            logger.info(f"[timeout-flush] '{sentence_accumulator[:50]}' (id={seg_id}, words={len(sentence_accumulator.split())})")
            await safe_send_json(websocket, {
                "type": "asr_final",
                "data": {
                    "id": seg_id,
                    "text": sentence_accumulator,
                    "fullText": sentence_accumulator,
                    "language": last_partial_language or "en"
                }
            })
            if not ASR_ONLY:
                try:
                    translation_queue.put_nowait({
                        "segment_id": seg_id,
                        "source_text": sentence_accumulator,
                        "language": last_partial_language or "en"
                    })
                except asyncio.QueueFull:
                    logger.warning("Translation queue full")
            sentence_accumulator = ""
            last_text_arrival_time = 0.0

        # ---- 决定是否处理缓冲区 ----
        should_process = False

        if buffer_len >= min_samples:
            should_process = True
        elif time_since_audio > PAUSE_THRESHOLD_SECONDS and buffer_len >= min_speech_for_pause:
            should_process = True

        if not should_process:
            continue

        # 取出全部缓冲区内容处理
        process_data = audio_buffer.copy()

        # 滑动窗口：保留重叠部分到下一个 chunk
        if buffer_len > overlap:
            audio_buffer = audio_buffer[-overlap:]
        else:
            audio_buffer = np.array([], dtype=np.float32)

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

        # ---- 句子累积：将增量文本追加到句子累积器 ----
        if sentence_accumulator:
            sentence_accumulator += " " + new_text
        else:
            sentence_accumulator = new_text
        last_text_arrival_time = time.monotonic()

        # ---- 判断 is_final（标点优先 + 停顿辅助）----
        # 核心思路: whisper 输出的标点本身就是最可靠的句子边界信号
        # 当 fullText 以句号/问号结尾且整体够长 → 即使没有停顿也 finalize
        # 这样连续说话时也能正确翻译，短碎片如 "live." 因长度不够不会被 finalize
        new_words = new_text.split()
        word_count = len(new_words)
        char_count = len(new_text.strip())

        # full_text 的整体长度（包含之前已识别的文本，代表整个 utterance 的规模）
        full_word_count = len(full_text.split())
        full_char_count = len(full_text.strip())

        # 检查 whisper 输出是否以句子结束标点结尾
        text_ends_sentence = full_text.strip() and full_text.strip()[-1] in SENTENCE_END_CHARS

        # 增量是否足够长（用于停顿辅助的长度判断）
        increment_has_min_length = word_count >= MIN_FINAL_WORDS or char_count >= MIN_FINAL_CHARS
        # 整体 utterance 是否足够长（用于标点优先的长度判断）
        full_has_min_length = full_word_count >= MIN_FINAL_WORDS or full_char_count >= MIN_FINAL_CHARS

        is_final = False
        # 1. 标点优先: fullText 以标点结尾 + 整体够长 → finalize
        #    即使 pause=0s（连续说话中）也能触发 — 这是最重要的判断条件
        if text_ends_sentence and full_has_min_length:
            is_final = True
        # 2. 停顿辅助: 停顿 >1.0s + 增量够长 → finalize（处理无标点的句子）
        elif time_since_audio > PAUSE_THRESHOLD_SECONDS and increment_has_min_length:
            is_final = True
        # 3. 绝对超时: 停顿 >3s → 无论如何 finalize
        elif time_since_audio > ABSOLUTE_TIMEOUT:
            is_final = True

        seg_id = f"seg-{asr_segment_counter}"
        asr_segment_counter += 1

        if is_final:
            # ---- final：检查是否应该 flush ----
            should_flush = False
            acc_words = len(sentence_accumulator.split())

            # 条件1：以句末标点结尾且长度足够 → 句子完整，flush
            if sentence_accumulator.strip() and sentence_accumulator.strip()[-1] in SENTENCE_END_CHARS and acc_words >= MIN_FLUSH_WORDS:
                should_flush = True

            # 条件2：超过最大词数 → 强制 flush
            if acc_words >= MAX_FLUSH_WORDS:
                should_flush = True

            if should_flush:
                msg_type = "asr_final"
                logger.info(f"[{msg_type}] {sentence_accumulator} (lang={info.language}, id={seg_id}, "
                             f"pause={time_since_audio:.2f}s, acc_words={acc_words})")

                await safe_send_json(websocket, {
                    "type": "asr_final",
                    "data": {
                        "id": seg_id,
                        "text": sentence_accumulator,
                        "fullText": sentence_accumulator,
                        "language": info.language
                    }
                })

                if not ASR_ONLY:
                    try:
                        translation_queue.put_nowait({
                            "segment_id": seg_id,
                            "source_text": sentence_accumulator,
                            "language": info.language
                        })
                    except asyncio.QueueFull:
                        logger.warning("Translation queue full")

                # 清空句子累积器
                sentence_accumulator = ""
                last_text_arrival_time = 0.0
            else:
                # 不 flush，发送 partial 显示进度
                msg_type = "asr_partial"
                logger.info(f"[{msg_type}] {new_text} (lang={info.language}, id={seg_id}, "
                             f"pause={time_since_audio:.2f}s, acc_words={acc_words}, not-flushing)")

                await safe_send_json(websocket, {
                    "type": "asr_partial",
                    "data": {
                        "id": seg_id,
                        "text": new_text,
                        "fullText": sentence_accumulator,
                        "language": info.language
                    }
                })

            # 清除 partial 追踪（停顿提升用）
            last_partial_text = ""
            last_partial_id = ""
            last_partial_language = ""
            last_partial_full_text = ""
            last_partial_full_word_count = 0
            last_partial_full_char_count = 0
            last_partial_has_punctuation = False
        else:
            # ---- partial：显示实时进度，累积器继续增长 ----
            last_text_arrival_time = time.monotonic()
            msg_type = "asr_partial"
            logger.info(f"[{msg_type}] {new_text} (lang={info.language}, id={seg_id}, "
                         f"pause={time_since_audio:.2f}s, inc_words={word_count}, full_words={full_word_count}, "
                         f"punct={text_ends_sentence}, acc_len={len(sentence_accumulator)})")

            await safe_send_json(websocket, {
                "type": "asr_partial",
                "data": {
                    "id": seg_id,
                    "text": new_text,
                    "fullText": sentence_accumulator,
                    "language": info.language
                }
            })

            # partial → 追踪以便停顿提升
            last_partial_text = new_text
            last_partial_id = seg_id
            last_partial_language = info.language
            last_partial_full_text = full_text
            last_partial_full_word_count = full_word_count
            last_partial_full_char_count = full_char_count
            last_partial_has_punctuation = text_ends_sentence

    # 退出时：如果有残留累积文本，作为 final flush 出去
    if sentence_accumulator:
        seg_id = f"seg-{asr_segment_counter}"
        asr_segment_counter += 1
        logger.info(f"[exit-flush] '{sentence_accumulator[:50]}' (id={seg_id})")
        await safe_send_json(websocket, {
            "type": "asr_final",
            "data": {
                "id": seg_id,
                "text": sentence_accumulator,
                "fullText": sentence_accumulator,
                "language": last_partial_language or "en"
            }
        })
        if not ASR_ONLY:
            try:
                translation_queue.put_nowait({
                    "segment_id": seg_id,
                    "source_text": sentence_accumulator,
                    "language": last_partial_language or "en"
                })
            except asyncio.QueueFull:
                pass
        sentence_accumulator = ""
        last_text_arrival_time = 0.0


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

    # HF_ENDPOINT 由环境变量或 .env 文件控制，不再硬编码
    logger.info(f"HF_ENDPOINT: {os.environ.get('HF_ENDPOINT', '(default)')}")

    logger.info(f"Initializing ASR engine (model={ASR_MODEL})...")
    asr_engine = ASREngine(model_size=ASR_MODEL)

    logger.info("Initializing DeepSeek translator...")
    translator = Translator(api_key=DEEPSEEK_API_KEY, base_url=DEEPSEEK_BASE_URL, model=DEEPSEEK_MODEL)

    logger.info("Initializing DeepSeek corrector...")
    corrector = Corrector(api_key=DEEPSEEK_API_KEY, base_url=DEEPSEEK_BASE_URL, model=DEEPSEEK_MODEL)

    logger.info("All engines initialized!")
    logger.info(f"  ASR: {ASR_MODEL} | chunk={ASR_CHUNK_SECONDS}s overlap={ASR_OVERLAP_SECONDS}s")
    logger.info(f"  Sentence detection: punct-first | pause={PAUSE_THRESHOLD_SECONDS}s abs={ABSOLUTE_TIMEOUT}s min_words={MIN_FINAL_WORDS}")
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