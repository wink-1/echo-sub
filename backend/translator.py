"""
翻译模块 - 通过 Ollama HTTP API 调用 Qwen2 进行翻译
"""

import httpx
import json

OLLAMA_BASE_URL = "http://localhost:11434"
DEFAULT_MODEL = "qwen2.5:7b"
TIMEOUT_SECONDS = 10

TRANSLATION_PROMPT = """你是一个专业的同声传译员。将以下{source_lang}文本翻译成自然流畅的中文。
只输出翻译结果，不要添加任何解释。
保持原文的专业术语和语气。

原文：{text}"""


class Translator:
    """Ollama 翻译客户端"""

    def __init__(self, model: str = DEFAULT_MODEL, base_url: str = OLLAMA_BASE_URL):
        self.model = model
        self.base_url = base_url
        self.client = httpx.Client(timeout=TIMEOUT_SECONDS)

    async def translate(
        self,
        text: str,
        source_lang: str = "en",
        target_lang: str = "zh"
    ) -> str:
        """
        翻译文本

        Args:
            text: 源语言文本
            source_lang: 源语言代码
            target_lang: 目标语言代码

        Returns:
            翻译后的文本
        """
        if not text.strip():
            return ""

        # 语言名称映射
        lang_names = {
            "en": "英文",
            "ja": "日文",
            "ko": "韩文",
            "fr": "法文",
            "de": "德文",
            "es": "西班牙文",
            "ru": "俄文",
        }
        source_lang_name = lang_names.get(source_lang, "外文")

        prompt = TRANSLATION_PROMPT.format(
            source_lang=source_lang_name,
            text=text
        )

        try:
            print(f"[Translator] Calling Ollama ({self.model}) for: '{text[:50]}...'")
            response = await self._call_ollama(prompt)
            result = response.strip()
            print(f"[Translator] Result: '{result[:50]}...'")
            return result
        except Exception as e:
            print(f"[Translator] Error: {e}")
            return text  # 翻译失败返回原文

    async def _call_ollama(self, prompt: str) -> str:
        """调用 Ollama API"""
        import asyncio

        def _sync_call():
            response = self.client.post(
                f"{self.base_url}/api/chat",
                json={
                    "model": self.model,
                    "messages": [{"role": "user", "content": prompt}],
                    "stream": False
                }
            )
            response.raise_for_status()
            data = response.json()
            return data["message"]["content"]

        # 在线程池中执行同步 HTTP 调用
        return await asyncio.get_event_loop().run_in_executor(None, _sync_call)

    async def translate_stream(self, text: str, source_lang: str = "en") -> str:
        """
        流式翻译 (逐 token 输出)

        Args:
            text: 源语言文本
            source_lang: 源语言代码

        Returns:
            完整翻译文本
        """
        if not text.strip():
            return ""

        lang_names = {"en": "英文", "ja": "日文", "ko": "韩文"}
        source_lang_name = lang_names.get(source_lang, "外文")

        prompt = TRANSLATION_PROMPT.format(
            source_lang=source_lang_name,
            text=text
        )

        full_text = ""
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                async with client.stream(
                    "POST",
                    f"{self.base_url}/api/chat",
                    json={
                        "model": self.model,
                        "messages": [{"role": "user", "content": prompt}],
                        "stream": True
                    }
                ) as response:
                    async for line in response.aiter_lines():
                        if not line.strip():
                            continue
                        data = json.loads(line)
                        if "message" in data and "content" in data["message"]:
                            full_text += data["message"]["content"]
        except Exception as e:
            print(f"Stream translation error: {e}")
            return text

        return full_text.strip()
