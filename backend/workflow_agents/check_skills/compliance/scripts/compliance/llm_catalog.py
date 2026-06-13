from __future__ import annotations

import json
import re
from typing import Any

from .llm import async_chat_completions
from .llm_classifier import LlmClassifierConfig
from .schema import ComponentRecord

CatalogScoringItem = tuple[ComponentRecord, list[dict[str, Any]]]


def score_catalog_batches_with_llm(
    items: list[CatalogScoringItem],
    llm_config: LlmClassifierConfig,
    batch_size: int = 8,
) -> dict[int, list[dict[str, Any]]]:
    enabled_items = [(comp, candidates) for comp, candidates in items if candidates]
    if not enabled_items or not llm_config.enabled:
        return {}

    batches = [
        enabled_items[index : index + max(1, batch_size)]
        for index in range(0, len(enabled_items), max(1, batch_size))
    ]
    contents = async_chat_completions(
        llm_config,
        [_prompt(batch) for batch in batches],
        return_exceptions=True,
        is_json=True,
        temperature=0,
    )

    output: dict[int, list[dict[str, Any]]] = {}
    for batch, content in zip(batches, contents, strict=False):
        if isinstance(content, Exception):
            for comp, candidates in batch:
                output[comp.index] = _fallback_candidates(
                    candidates, f"LLM批量打分失败，使用型号和厂商相似度：{content}"
                )
            continue
        try:
            scored = _apply_batch_scores(batch, _parse_json(str(content)))
        except Exception as exc:
            for comp, candidates in batch:
                output[comp.index] = _fallback_candidates(
                    candidates, f"LLM结果解析失败，使用型号和厂商相似度：{exc}"
                )
            continue
        output.update(scored)
    return output


def _prompt(batch: list[CatalogScoringItem]) -> dict[str, Any]:
    system_prompt = (
        "你是航天元器件选用目录匹配专家。"
        "请对每个清单元器件的候选目录项分别打分。"
        "score 范围是 0 到 1，越大越匹配。必须优先考虑 A 类目录项："
        "A 类与 B/C 类相近时选择 A 类；只有 A 类明显不匹配时才选择其他类别。"
        "综合考虑型号、厂商、名称、执行标准、质量等级、封装形式、温度范围和其他详情。"
        "只输出 JSON 对象，格式为："
        "{\"components\":[{\"component_index\":1,\"results\":[{\"candidate_index\":1,\"score\":0.0,\"reason\":\"...\"}]}]}。"
        "component_index 和 candidate_index 必须来自输入。reason 用一句中文说明，不超过30字。"
    )
    payload = {
        "components": [
            {
                "component_index": comp.index,
                "component": {
                    "model": comp.model,
                    "name": comp.name,
                    "manufacturer": comp.manufacturer,
                    "quality_level": comp.quality_level,
                    "package_type": comp.package_type,
                    "working_temp": comp.working_temp,
                },
                "candidates": [
                    {
                        "candidate_index": index,
                        "model": candidate.get("catalog_model", ""),
                        "category": candidate.get("catalog_group", ""),
                        "manufacturer": candidate.get("catalog_manufacturer", ""),
                        "detail": candidate.get("detail", {}),
                        "rule_score": candidate.get("_score", 0),
                    }
                    for index, candidate in enumerate(candidates, start=1)
                ],
            }
            for comp, candidates in batch
        ]
    }
    return {
        "system_prompt": system_prompt,
        "user_prompt": json.dumps(payload, ensure_ascii=False, indent=2),
        "max_tokens": max(3000, 900 * len(batch)),
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


def _apply_batch_scores(
    batch: list[CatalogScoringItem], value: Any
) -> dict[int, list[dict[str, Any]]]:
    if not isinstance(value, dict):
        raise ValueError("LLM catalog response must be a JSON object.")
    components = value.get("components")
    if not isinstance(components, list):
        raise ValueError("LLM catalog response must include components list.")

    raw_by_component: dict[int, Any] = {}
    for item in components:
        if not isinstance(item, dict):
            continue
        try:
            component_index = int(item.get("component_index"))
        except (TypeError, ValueError):
            continue
        raw_by_component[component_index] = item.get("results")

    output: dict[int, list[dict[str, Any]]] = {}
    for comp, candidates in batch:
        output[comp.index] = _apply_scores(candidates, raw_by_component.get(comp.index))
    return output


def _apply_scores(candidates: list[dict[str, Any]], results: Any) -> list[dict[str, Any]]:
    if not isinstance(results, list):
        return _fallback_candidates(candidates, "LLM未返回该器件评分，使用型号和厂商相似度")

    by_index: dict[int, dict[str, Any]] = {}
    for item in results:
        if not isinstance(item, dict):
            continue
        try:
            index = int(item.get("candidate_index") or item.get("index"))
            score = float(item.get("score"))
        except (TypeError, ValueError):
            continue
        by_index[index] = {
            "score": max(0.0, min(1.0, score)),
            "reason": str(item.get("reason") or "").strip(),
        }

    output = []
    for index, candidate in enumerate(candidates, start=1):
        item = dict(candidate)
        result = by_index.get(index)
        if result:
            item["_score"] = round(float(result["score"]), 3)
            item["reason"] = result["reason"]
        output.append(item)
    output.sort(key=lambda item: float(item.get("_score") or 0), reverse=True)
    return output


def _fallback_candidates(candidates: list[dict[str, Any]], reason: str) -> list[dict[str, Any]]:
    output = []
    for candidate in candidates:
        item = dict(candidate)
        item["reason"] = reason
        output.append(item)
    return output
