from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from .io_utils import read_json_if_exists
from .app_config import chat_model_config
from .llm import async_process
from .schema import ComponentRecord


@dataclass(frozen=True)
class LlmClassifierConfig:
    base_url: str = ""
    api_key: str = ""
    model: str = ""
    timeout_seconds: int = 120
    batch_size: int = 16
    concurrency: int = 4

    @property
    def enabled(self) -> bool:
        return bool(self.base_url and self.api_key and self.model)


def load_llm_classifier_config(
    path: str | Path | None = None,
    *,
    base_url: str | None = None,
    api_key: str | None = None,
    model: str | None = None,
    timeout_seconds: int | None = None,
    batch_size: int | None = None,
    concurrency: int | None = None,
) -> LlmClassifierConfig:
    """Load LLM settings the same way for CLI and direct Python callers."""
    data = _load_llm_config_data(Path(path) if path else None)
    app_data = chat_model_config()
    return LlmClassifierConfig(
        base_url=base_url
        or os.getenv("COMPLIANCE_LLM_BASE_URL", "")
        or _config_value(data, "baseUrl", "base_url")
        or _config_value(app_data, "baseUrl", "base_url"),
        api_key=api_key
        or os.getenv("COMPLIANCE_LLM_API_KEY", "")
        or _config_value(data, "apiKey", "api_key")
        or _config_value(app_data, "apiKey", "api_key"),
        model=model
        or os.getenv("COMPLIANCE_LLM_MODEL", "")
        or _config_value(data, "model")
        or _config_value(app_data, "model"),
        timeout_seconds=timeout_seconds
        or int(_config_value(data, "timeoutSeconds", "timeout_seconds") or _config_value(app_data, "timeoutSeconds", "timeout_seconds") or 120),
        batch_size=batch_size
        or int(_config_value(data, "batchSize", "batch_size") or _config_value(app_data, "batchSize", "batch_size") or 16),
        concurrency=concurrency
        or int(os.getenv("COMPLIANCE_LLM_CONCURRENCY", "") or _config_value(data, "concurrency", "maxConcurrency") or _config_value(app_data, "concurrency", "maxConcurrency") or 4),
    )


def _load_llm_config_data(path: Path | None) -> dict[str, Any]:
    data = read_json_if_exists(path)
    if not data:
        return {}
    if not isinstance(data, dict):
        raise ValueError(f"LLM config must be a JSON object: {path}")
    return data


def _config_value(data: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = data.get(key)
        if value is not None:
            return str(value)
    return ""


def classify_components_with_llm(
    components: list[ComponentRecord],
    config,
    llm_config: LlmClassifierConfig,
    mode: str = "auto",
    rules_text: str = "",
) -> list[dict[str, Any]]:
    mode = (mode or "auto").lower()
    if mode not in {"auto", "llm", "rules"}:
        raise ValueError(f"Unknown classifier mode: {mode}")
    if mode == "rules":
        raise ValueError("Rules classifier mode is no longer supported. Use --classifier-mode llm or auto.")
    use_llm = mode in {"auto", "llm"} and llm_config.enabled and bool(rules_text)
    if not use_llm:
        raise ValueError("LLM classifier requires base URL, API key, model, and 8118 classifier markdown.")

    llm_results: dict[int, dict[str, str]] = {}
    llm_errors: dict[int, str] = {}
    if use_llm:
        llm_results, llm_errors = _classify_batches(components, llm_config, rules_text)

    rows = []
    for comp in components:
        override = config.component_class(comp.name) if config else None
        source = "llm"
        note = ""
        if override:
            category_name = override.get("category_name") or override.get("categoryName") or comp.category_name or "其他元器件"
            category_class = override.get("category_class") or override.get("categoryClass") or comp.category_class or "其他"
            source = "config_override"
        elif comp.index in llm_results:
            category = llm_results[comp.index]
            category_name = category["category_name"]
            category_class = category["category_class"]
            source = "llm"
        elif comp.category_name or comp.category_class:
            category_name = comp.category_name or "其他元器件"
            category_class = comp.category_class or "其他"
            source = "input"
        else:
            category_name = "其他元器件"
            category_class = "其他"
            source = "default"
        if comp.index in llm_errors:
            source = f"llm_fallback_{source}"
            note = llm_errors[comp.index]

        comp.category_name = category_name
        comp.category_class = category_class
        rows.append(
            {
                "index": comp.index,
                "component_name": comp.name,
                "model": comp.model,
                "manufacturer": comp.manufacturer,
                "package_type": comp.package_type,
                "category_class": category_class,
                "category_name": category_name,
                "classification_source": source,
                "classification_note": note,
            }
        )
    return rows


def _classify_batches(
    components: list[ComponentRecord],
    llm_config: LlmClassifierConfig,
    rules_text: str,
) -> tuple[dict[int, dict[str, str]], dict[int, str]]:
    results: dict[int, dict[str, str]] = {}
    errors: dict[int, str] = {}
    system_prompt = _system_prompt(rules_text)

    batch_size = max(1, llm_config.batch_size)
    batches = [components[start : start + batch_size] for start in range(0, len(components), batch_size)]
    contents = _run_llm_batch_requests(llm_config, system_prompt, [_user_prompt(batch) for batch in batches])
    for batch, outcome in zip(batches, contents):
        if isinstance(outcome, Exception):
            message = f"LLM request failed: {outcome}"
            for comp in batch:
                errors[comp.index] = message
            continue
        try:
            parsed = _parse_response(outcome)
        except Exception as exc:
            message = f"LLM response parse failed: {exc}"
            for comp in batch:
                errors[comp.index] = message
            continue
        for comp in batch:
            raw_value = parsed.get(str(comp.index)) or parsed.get(comp.index) or parsed.get(comp.name)
            category = _clean_category_result(raw_value)
            if category:
                results[comp.index] = category
            else:
                errors[comp.index] = f"LLM category result is incomplete: {raw_value!r}"
    return results, errors


def _run_llm_batch_requests(
    llm_config: LlmClassifierConfig,
    system_prompt: str,
    user_prompts: list[str],
) -> list[str | Exception]:
    if not user_prompts:
        return []
    messages = [
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]
        for user_prompt in user_prompts
    ]
    llm = SimpleNamespace(
        model=llm_config.model,
        api_key=llm_config.api_key,
        base_url=llm_config.base_url,
        timeout_seconds=llm_config.timeout_seconds,
        concurrency=llm_config.concurrency,
    )
    try:
        return async_process(llm, messages, is_json=True)
    except Exception as exc:
        return [exc for _ in user_prompts]


def _system_prompt(rules_text: str) -> str:
    rules_excerpt = rules_text[:20000] if rules_text else ""
    return (
        "你是航天元器件分类专家。必须依据 8118_classifier_map_sys.md 的分类层级和规则，"
        "把每个元器件归入且只能归入一个标准分类名称。\n\n"
        "分类标准原文：\n"
        f"{rules_excerpt}\n\n"
        "只输出 JSON 对象，键为输入 index 的字符串，值为对象："
        '{"category_name":"标准分类名称","category_class":"I类/II类/III类/IV类/V类/其他"}。不要输出解释。'
    )


def _user_prompt(batch: list[ComponentRecord]) -> str:
    items = [
        {
            "index": comp.index,
            "name": comp.name,
            "model": comp.model,
            "manufacturer": comp.manufacturer,
            "package_type": comp.package_type,
            "quality_level": comp.quality_level,
        }
        for comp in batch
    ]
    return "请分类以下元器件：\n" + json.dumps(items, ensure_ascii=False, indent=2)


def _parse_response(content: str) -> dict[Any, Any]:
    text = content.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text)
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, flags=re.DOTALL)
        if not match:
            raise
        value = json.loads(match.group(0))
    if isinstance(value, list):
        output = {}
        for item in value:
            if isinstance(item, dict):
                index = item.get("index")
                category = {
                    "category_name": item.get("category_name") or item.get("category") or item.get("name"),
                    "category_class": item.get("category_class") or item.get("class") or item.get("level"),
                }
                if index is not None and category:
                    output[str(index)] = category
        return output
    if not isinstance(value, dict):
        raise ValueError(f"LLM response is not a JSON object: {value!r}")
    return value


def _clean_category_result(value: Any) -> dict[str, str] | None:
    if value is None:
        return None
    if isinstance(value, dict):
        category_name = _clean_text(value.get("category_name") or value.get("category") or value.get("name"))
        category_class = _clean_text(value.get("category_class") or value.get("class") or value.get("level"))
    else:
        category_name = _clean_text(value)
        category_class = ""
    if not category_name:
        return None
    return {
        "category_name": category_name,
        "category_class": category_class or "其他",
    }


def _clean_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip().strip("`'\" ")
