"""
翻译模块 - DeepSeek API 翻译
兼容 OpenAI API 格式
"""

import os
import httpx

DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1"
DEEPSEEK_MODEL = "deepseek-chat"
TIMEOUT_SECONDS = 15

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
        self.client = httpx.Client(timeout=TIMEOUT_SECONDS)
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

    async def _call_deepseek(self, prompt: str) -> str:
        import asyncio

        api_key = self.api_key
        base_url = self.base_url
        model = self.model

        def _sync_call():
            response = self.client.post(
                f"{base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": model,
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

        return await asyncio.get_event_loop().run_in_executor(None, _sync_call)

    def _add_context(self, source: str, translation: str):
        self.context_history.append(f"原文：{source}\n译文：{translation}")
        if len(self.context_history) > self.MAX_CONTEXT:
            self.context_history.pop(0)

    def reset_context(self):
        self.context_history = []
