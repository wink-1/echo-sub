"""
翻译模块测试
"""
import pytest
import asyncio
from translator import Translator, LANG_NAMES, TRANSLATION_PROMPT, TRANSLATION_PROMPT_WITH_CONTEXT


class TestLangNames:
    def test_known_languages(self):
        assert LANG_NAMES["en"] == "英文"
        assert LANG_NAMES["ja"] == "日文"
        assert LANG_NAMES["zh"] == "中文"

    def test_has_all_expected(self):
        expected = {"en", "ja", "ko", "fr", "de", "es", "ru", "zh"}
        assert set(LANG_NAMES.keys()) == expected


class TestPrompts:
    def test_translation_prompt_format(self):
        prompt = TRANSLATION_PROMPT.format(source_lang="英文", text="Hello")
        assert "英文" in prompt
        assert "Hello" in prompt
        assert "同声传译" in prompt
        # 确保没有遗留未填充的占位符
        assert "{context}" not in prompt

    def test_context_prompt_format(self):
        prompt = TRANSLATION_PROMPT_WITH_CONTEXT.format(
            source_lang="英文", context="前文内容", text="World"
        )
        assert "前文内容" in prompt
        assert "World" in prompt
