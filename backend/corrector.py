"""
纠错模块 - DeepSeek API 翻译审校
"""

import os
import httpx

DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1"
DEEPSEEK_MODEL = "deepseek-chat"
TIMEOUT_SECONDS = 15

CORRECTION_PROMPT = """你是一位翻译审校专家。基于上下文检查以下翻译是否有误。

## 前文上下文
{context}

## 当前原文
{source_text}

## 当前译文
{translation}

## 规则
1. 如果翻译准确无误，直接输出当前译文，不做任何修改
2. 如果有明显翻译错误（如误译、漏译、过度翻译），输出修正后的译文
3. 只输出翻译结果，不要添加任何解释或标注
4. 不要做不必要的文风润色，只修正事实性错误

## 修正后的译文"""


class Corrector:
    """DeepSeek API 翻译纠错器"""

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

    async def correct(
        self,
        source_text: str,
        current_translation: str,
        context_before: list[str] | None = None
    ) -> dict:
        if not source_text.strip() or not current_translation.strip():
            return {"corrected": current_translation, "changed": False}

        context = "（无前文）"
        if context_before:
            context = "\n".join([f"前文：{t}" for t in context_before[-2:]])

        prompt = CORRECTION_PROMPT.format(
            context=context,
            source_text=source_text,
            translation=current_translation
        )

        try:
            corrected = await self._call_deepseek(prompt)
            corrected = corrected.strip()
            changed = corrected != current_translation

            if changed:
                print(f"[Corrector] Corrected: '{current_translation}' -> '{corrected}'")

            return {"corrected": corrected, "changed": changed}

        except Exception as e:
            print(f"Correction error: {e}")
            return {"corrected": current_translation, "changed": False}

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
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.1,
                "max_tokens": 512,
                "stream": False
            }
        )
        response.raise_for_status()
        data = response.json()
        return data["choices"][0]["message"]["content"]

    async def close(self):
        """关闭异步 HTTP 客户端。"""
        await self.client.aclose()
