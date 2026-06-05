"""
翻译模块 - DeepSeek API 翻译
兼容 OpenAI API 格式
"""

import os
import json
import httpx
from typing import AsyncGenerator

DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1"
DEEPSEEK_MODEL = "deepseek-chat"
TIMEOUT_SECONDS = 60

# 针对同声传译场景优化的翻译 Prompt
TRANSLATION_PROMPT = """你是一位资深同声传译员，正在为国际会议提供实时翻译。

## 规则
1. 将以下{source_lang}文本翻译成自然流畅的中文
2. 只输出翻译结果，绝对不要添加解释、注释或多余内容
3. 严格忠于原文含义，不得增删、臆测或"脑补"内容
4. 专业术语保持行业通用译法
5. 保持原文语气（正式/口语/技术等）
6. 如果原文不完整（如被截断的句子），也照实翻译不完整的部分
7. 不要重复翻译同一内容

## 原文
{text}

## 翻译"""

TRANSLATION_PROMPT_WITH_CONTEXT = """你是一位资深同声传译员，正在为国际会议提供实时翻译。

## 前文上下文
{context}

## 规则
1. 将以下{source_lang}文本翻译成自然流畅的中文
2. 只输出翻译结果，绝对不要添加解释、注释或多余内容
3. 严格忠于原文含义，不得增删、臆测或"脑补"内容
4. 结合前文上下文确保术语一致
5. 保持原文语气
6. 不要重复翻译同一内容

## 原文
{text}

## 翻译"""


class Translator:
    """DeepSeek API 翻译客户端"""

    def __init__(
        self,
        api_key: str = "",
        base_url: str = DEEPSEEK_BASE_URL,
        model: str = DEEPSEEK_MODEL
    ):
        self.api_key = api_key or os.environ.get("DEEPSEEK_API_KEY", "")
        self.base_url = base_url
        self.model = model
        self.client = httpx.AsyncClient(timeout=TIMEOUT_SECONDS)
        self.context_history: list[str] = []
        self.MAX_CONTEXT = 3
        print(f"[Translator] DeepSeek API: {self.model}, key={self.api_key[:8]}...")

    async def translate(
        self,
        text: str,
        source_lang: str = "en",
        target_lang: str = "zh"
    ) -> str:
        if not text.strip():
            return ""

        lang_names = {
            "en": "英文", "ja": "日文", "ko": "韩文",
            "fr": "法文", "de": "德文", "es": "西班牙文",
            "ru": "俄文", "zh": "中文",
        }
        source_lang_name = lang_names.get(source_lang, "外文")

        if self.context_history:
            context_str = "\n".join(self.context_history[-self.MAX_CONTEXT:])
            prompt = TRANSLATION_PROMPT_WITH_CONTEXT.format(
                source_lang=source_lang_name,
                context=context_str,
                text=text
            )
        else:
            prompt = TRANSLATION_PROMPT.format(
                source_lang=source_lang_name,
                text=text
            )

        try:
            result = await self._call_deepseek(prompt)
            result = result.strip()
            self._add_context(text, result)
            print(f"[Translator] '{text[:40]}' -> '{result[:40]}'")
            return result
        except Exception as e:
            print(f"[Translator] Error: {e}")
            import traceback
            traceback.print_exc()
            return text

    async def translate_stream(
        self,
        text: str,
        source_lang: str = "en",
        target_lang: str = "zh"
    ) -> AsyncGenerator[str, None]:
        """流式翻译：逐 token 返回翻译结果 (DeepSeek stream=true)。"""
        if not text.strip():
            yield ""
            return

        lang_names = {
            "en": "英文", "ja": "日文", "ko": "韩文",
            "fr": "法文", "de": "德文", "es": "西班牙文",
            "ru": "俄文", "zh": "中文",
        }
        source_lang_name = lang_names.get(source_lang, "外文")

        if self.context_history:
            context_str = "\n".join(self.context_history[-self.MAX_CONTEXT:])
            prompt = TRANSLATION_PROMPT_WITH_CONTEXT.format(
                source_lang=source_lang_name, context=context_str, text=text
            )
        else:
            prompt = TRANSLATION_PROMPT.format(
                source_lang=source_lang_name, text=text
            )

        accumulated = ""
        try:
            async with self.client.stream(
                "POST",
                f"{self.base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": self.model,
                    "messages": [
                        {"role": "system", "content": "你是一位专业的同声传译员。将外语实时翻译为中文，忠于原文，不增删内容。"},
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.1,
                    "max_tokens": 512,
                    "stream": True
                }
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        data_str = line[6:]
                        if data_str.strip() == "[DONE]":
                            break
                        try:
                            chunk = json.loads(data_str)
                            delta = chunk["choices"][0].get("delta", {})
                            content = delta.get("content", "")
                            if content:
                                accumulated += content
                                yield accumulated
                        except json.JSONDecodeError:
                            pass

            self._add_context(text, accumulated)
            print(f"[Translator Stream] '{text[:40]}' -> '{accumulated[:40]}'")

        except httpx.HTTPStatusError as e:
            status = e.response.status_code
            err_body = ""
            try:
                err_body = e.response.text[:200]
            except Exception:
                pass
            print(f"[Translator Stream] HTTP {status} error: {err_body}")
            if status == 401:
                print("[Translator Stream] ⚠️ API Key 无效或已过期，请检查 .env 中的 DEEPSEEK_API_KEY")
            elif status == 429:
                print("[Translator Stream] ⚠️ API 请求频率过高，请稍后重试")
            yield accumulated or text
        except Exception as e:
            print(f"[Translator Stream] Error: {type(e).__name__}: {e}")
            import traceback
            traceback.print_exc()
            yield accumulated or text

    async def _call_deepseek(self, prompt: str) -> str:
        """真正的异步 DeepSeek API 调用 (使用 httpx.AsyncClient)。"""
        response = await self.client.post(
            f"{self.base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json"
            },
            json={
                "model": self.model,
                "messages": [
                    {
                        "role": "system",
                        "content": "你是一位专业的同声传译员。将外语实时翻译为中文，忠于原文，不增删内容。"
                    },
                    {"role": "user", "content": prompt}
                ],
                "temperature": 0.1,
                "max_tokens": 512,
                "stream": False
            }
        )
        response.raise_for_status()
        data = response.json()
        return data["choices"][0]["message"]["content"]

    def _add_context(self, source: str, translation: str):
        self.context_history.append(f"原文：{source}\n译文：{translation}")
        if len(self.context_history) > self.MAX_CONTEXT:
            self.context_history.pop(0)

    def reset_context(self):
        self.context_history = []

    async def close(self):
        """关闭异步 HTTP 客户端。"""
        await self.client.aclose()
