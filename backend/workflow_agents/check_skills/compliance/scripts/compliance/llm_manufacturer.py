from __future__ import annotations

import json
import re
from typing import Any

from .component_io import unique
from .llm import async_chat_completions
from .llm_classifier import LlmClassifierConfig
from .schema import ComponentRecord


def match_manufacturers_with_llm(
    components: list[ComponentRecord],
    manufacturer_rows: list[dict[str, Any]],
    llm_config: LlmClassifierConfig,
) -> dict[str, dict[str, Any]]:
    if not llm_config.enabled:
        raise ValueError(
            "Manufacturer matching requires LLM base URL, API key, and model."
        )
    input_names = unique(component.manufacturer for component in components)
    database_names = [
        str(row.get("full_name") or "").strip()
        for row in manufacturer_rows
        if str(row.get("full_name") or "").strip()
    ]
    if not input_names or not database_names:
        return {}
    content = async_chat_completions(
        llm_config,
        [_prompt(input_names, database_names)],
        is_json=True,
        temperature=0,
    )[0]
    return _normalize_matches(
        input_names, set(database_names), _parse_json(str(content))
    )


def _prompt(input_names: list[str], database_names: list[str]) -> dict[str, Any]:
    system_prompt = (
        "你是航天元器件生产厂商名称匹配专家。"
        "请只根据给定的 database_full_names 判断每个 input_manufacturers 最接近哪一个数据库厂商全称。"
        "不要自行编造 database_full_names 中不存在的名称。无法可靠对应时 database_full_name 置为空字符串。"
        "只输出 JSON 对象，键必须是输入厂商原文，值必须是对象，且只包含 "
        "database_full_name、国产/进口、目录内或外 三个字段。"
        "database_full_name 非空时，国产/进口=国产，目录内或外=目录内；"
        "database_full_name 为空时，国产/进口=进口，目录内或外=无。"
    )
    user_payload = {
        "input_manufacturers": input_names,
        "database_full_names": database_names,
    }
    return {
        "system_prompt": system_prompt,
        "user_prompt": json.dumps(user_payload, ensure_ascii=False, indent=2),
        "max_tokens": 6000,
    }


def _parse_json(content: str) -> Any:
    text = content.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"(\{.*\})", text, flags=re.DOTALL)
        if not match:
            raise
        return json.loads(match.group(1))


def _normalize_matches(
    input_names: list[str], database_names: set[str], value: Any
) -> dict[str, dict[str, Any]]:
    if not isinstance(value, dict):
        raise ValueError("LLM manufacturer matching response must be a JSON object.")
    output: dict[str, dict[str, Any]] = {}
    for name in input_names:
        raw = value.get(name)
        full_name = ""
        origin = ""
        catalog_status = ""
        if isinstance(raw, dict):
            full_name = str(
                raw.get("database_full_name") or raw.get("full_name") or ""
            ).strip()
            origin = str(raw.get("国产/进口") or raw.get("origin") or "").strip()
            catalog_status = str(
                raw.get("目录内或外") or raw.get("catalog_status") or ""
            ).strip()
        elif isinstance(raw, str):
            full_name = raw.strip()
        matched = bool(full_name) and full_name in database_names
        if not matched:
            full_name = ""
            origin = "进口"
            catalog_status = "无"
        output[name] = {
            "matched": matched,
            "full_name": full_name,
            "国产/进口": origin or "国产",
            "目录内或外": catalog_status or "目录内",
            "匹配来源": "llm_manufacturer_db" if matched else "llm_unmatched",
        }
    return output


def manufacturer_check_rows(
    components: list[ComponentRecord],
    matches: dict[str, dict[str, Any]],
    config=None,
) -> list[dict[str, Any]]:
    rows = []
    for name in unique(component.manufacturer for component in components):
        configured = config.manufacturer(name) if config else None
        if configured:
            full_name = str(
                configured.get("厂商全称") or configured.get("full_name") or ""
            ).strip()
            origin = str(
                configured.get("国产/进口")
                or configured.get("domestic_status")
                or ("国产" if full_name else "进口")
            )
            rows.append(
                {
                    "厂商简称": name,
                    "厂商全称": full_name or "无",
                    "国产/进口": origin,
                    "目录内或外": configured.get("目录内或外")
                    or configured.get("catalog_status")
                    or ("目录内" if full_name else "无"),
                    "匹配来源": "config_override",
                }
            )
            continue
        match = matches.get(name) or {}
        rows.append(
            {
                "厂商简称": name,
                "厂商全称": str(match.get("full_name") or "").strip() or "无",
                "国产/进口": str(match.get("国产/进口") or "进口"),
                "目录内或外": str(match.get("目录内或外") or "无"),
                "匹配来源": str(match.get("匹配来源") or "llm_unmatched"),
            }
        )
    return rows


def manufacturer_origin_map(
    rows: dict[str, dict[str, Any]] | list[dict[str, Any]],
) -> dict[str, str]:
    if isinstance(rows, dict):
        return {name: str(row.get("国产/进口") or "进口") for name, row in rows.items()}
    return {
        str(row.get("厂商简称") or "").strip(): str(row.get("国产/进口") or "进口")
        for row in rows
        if isinstance(row, dict) and str(row.get("厂商简称") or "").strip()
    }
