from __future__ import annotations

import json
import re
from typing import Any

from .llm import async_chat_completions
from .llm_classifier import LlmClassifierConfig


REQUIREMENT_ITEMS = [
    "元器件划分标准",
    "关键器件划分标准",
    "质量等级要求",
    "选用原则要求",
    "飞行经历要求",
    "抗辐照要求",
]

SATELLITE_ITEMS = [
    "轨道/寿命/倾角",
    "抗辐照要求",
    "质量等级要求",
    "质保/补筛/低等级/首飞",
]


def analyze_requirements_with_llm(
    requirement_text: str,
    llm_config: LlmClassifierConfig,
) -> list[dict[str, Any]]:
    if not llm_config.enabled:
        raise ValueError("Step requirements_analysis requires LLM base URL, API key, and model.")
    system_prompt, user_prompt, max_tokens = _requirements_prompt(requirement_text)
    rows = _parse_json(_run_single_json_completion(llm_config, system_prompt, user_prompt, max_tokens))
    return _normalize_requirement_rows(rows)


def extract_satellite_info_with_llm(
    requirement_text: str,
    llm_config: LlmClassifierConfig,
) -> list[dict[str, Any]]:
    if not llm_config.enabled:
        raise ValueError("Step satellite_info requires LLM base URL, API key, and model.")
    system_prompt, user_prompt, max_tokens = _satellite_prompt(requirement_text)
    rows = _parse_json(_run_single_json_completion(llm_config, system_prompt, user_prompt, max_tokens))
    return _normalize_satellite_rows(rows)


def analyze_requirements_and_satellite_with_llm(
    requirement_text: str,
    llm_config: LlmClassifierConfig,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if not llm_config.enabled:
        raise ValueError("Requirement and satellite analysis require LLM base URL, API key, and model.")
    req_prompt = _requirements_prompt(requirement_text)
    sat_prompt = _satellite_prompt(requirement_text)
    req_content, sat_content = _run_parallel_chat_completions(llm_config, [req_prompt, sat_prompt])
    return (
        _normalize_requirement_rows(_parse_json(req_content)),
        _normalize_satellite_rows(_parse_json(sat_content)),
    )


def _requirements_prompt(requirement_text: str) -> tuple[str, str, int]:
    system_prompt = (
        "你是航天元器件保证大纲审查专家。请从需求文档中提取元器件符合性检查所需条款。"
        "只输出 JSON 数组，不要解释。数组每项必须包含 name、original_content、detail、review。"
        f"name 必须从以下项目中选择并全部覆盖：{', '.join(REQUIREMENT_ITEMS)}。"
        "original_content 应引用或概括文档中的相关原文依据；未找到时写明未检索到明确条款。"
    )
    user_prompt = "需求文档内容如下：\n" + requirement_text[:60000]
    return system_prompt, user_prompt, 6000


def _satellite_prompt(requirement_text: str) -> tuple[str, str, int]:
    system_prompt = (
        "你是航天型号任务信息审查专家。请从需求文档中提取工具/卫星基础信息确认所需内容。"
        "只输出 JSON 数组，不要解释。数组每项必须包含 item、evidence。"
        f"item 必须从以下项目中选择并全部覆盖：{', '.join(SATELLITE_ITEMS)}。"
        "evidence 应引用或概括文档依据；未找到时写明未检索到明确描述。"
    )
    user_prompt = "需求文档内容如下：\n" + requirement_text[:60000]
    return system_prompt, user_prompt, 3500


def _run_single_json_completion(
    llm_config: LlmClassifierConfig,
    system_prompt: str,
    user_prompt: str,
    max_tokens: int,
) -> str:
    outcomes = async_chat_completions(
        llm_config,
        [(system_prompt, user_prompt, max_tokens)],
        is_json=False,
        temperature=0,
    )
    return str(outcomes[0])


def _normalize_requirement_rows(value: Any) -> list[dict[str, Any]]:
    by_name = {}
    if isinstance(value, list):
        for row in value:
            if isinstance(row, dict) and row.get("name"):
                by_name[str(row["name"]).strip()] = row
    missing = [name for name in REQUIREMENT_ITEMS if name not in by_name]
    if missing:
        raise ValueError(f"LLM requirements analysis missed required items: {', '.join(missing)}")
    output = []
    for name in REQUIREMENT_ITEMS:
        row = by_name[name]
        output.append(
            {
                "name": name,
                "original_content": str(row.get("original_content") or ""),
                "detail": str(row.get("detail") or ""),
                "review": str(row.get("review") or ""),
                "analysis_source": "llm",
            }
        )
    return output


def _normalize_satellite_rows(value: Any) -> list[dict[str, Any]]:
    by_item = {}
    if isinstance(value, list):
        for row in value:
            if isinstance(row, dict) and row.get("item"):
                by_item[str(row["item"]).strip()] = row
    missing = [item for item in SATELLITE_ITEMS if item not in by_item]
    if missing:
        raise ValueError(f"LLM satellite info extraction missed required items: {', '.join(missing)}")
    output = []
    for item in SATELLITE_ITEMS:
        row = by_item[item]
        output.append(
            {
                "item": item,
                "evidence": str(row.get("evidence") or ""),
                "info_source": "llm",
            }
        )
    return output


def _run_parallel_chat_completions(
    llm_config: LlmClassifierConfig,
    prompts: list[tuple[str, str, int]],
) -> list[str]:
    if not prompts:
        return []
    outcomes = async_chat_completions(
        llm_config,
        prompts,
        is_json=False,
        temperature=0,
    )
    return [str(outcome) for outcome in outcomes]


def _parse_json(content: str) -> Any:
    text = content.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"(\[.*\]|\{.*\})", text, flags=re.DOTALL)
        if not match:
            raise
        return json.loads(match.group(1))
