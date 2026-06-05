"""
纠错模块 - 基于上下文的翻译纠错
使用 Ollama Qwen2 在段落后进行上下文感知的翻译修正
"""

import httpx

OLLAMA_BASE_URL = "http://localhost:11434"
DEFAULT_MODEL = "qwen2.5:7b"
TIMEOUT_SECONDS = 15

CORRECTION_PROMPT = """你是一个翻译审校专家。基于以下上下文，检查并修正翻译。

上下文：
{context}

当前原文：{source_text}
当前译文：{translation}

如果有明显错误，输出修正后的翻译。如果翻译正确，直接输出当前译文。
只输出翻译结果，不要添加任何解释。"""


class Corrector:
    """翻译纠错器"""

    def __init__(self, model: str = DEFAULT_MODEL, base_url: str = OLLAMA_BASE_URL):
        self.model = model
        self.base_url = base_url
        self.client = httpx.Client(timeout=TIMEOUT_SECONDS)

    async def correct(
        self,
        source_text: str,
        current_translation: str,
        context_before: list[str] | None = None
    ) -> dict:
        """
        基于上下文纠错翻译

        Args:
            source_text: 源语言原文
            current_translation: 当前翻译
            context_before: 前几段已确认的翻译文本

        Returns:
            {"corrected": str, "changed": bool}
        """
        if not source_text.strip() or not current_translation.strip():
            return {"corrected": current_translation, "changed": False}

        # 构建上下文
        context = ""
        if context_before:
            context = "\n".join([f"前文译文：{t}" for t in context_before[-2:]])

        prompt = CORRECTION_PROMPT.format(
            context=context,
            source_text=source_text,
            translation=current_translation
        )

        try:
            corrected = await self._call_ollama(prompt)
            corrected = corrected.strip()

            # 判断是否有变化
            changed = corrected != current_translation

            return {"corrected": corrected, "changed": changed}

        except Exception as e:
            print(f"Correction error: {e}")
            return {"corrected": current_translation, "changed": False}

    async def _call_ollama(self, prompt: str) -> str:
        """调用 Ollama API"""
        import asyncio

        def _sync_call():
            response = self.client.post(
                f"{self.base_url}/api/chat",
                json={
                    "model": self.model,
                    "messages": [{"role": "user", "content": prompt}],
                    "stream": False,
                    "options": {
                        "temperature": 0.1  # 低温度,减少不必要的修改
                    }
                }
            )
            response.raise_for_status()
            data = response.json()
            return data["message"]["content"]

        return await asyncio.get_event_loop().run_in_executor(None, _sync_call)
