from __future__ import annotations

import re
from collections import Counter, defaultdict
from difflib import SequenceMatcher
from typing import Any

from .schema import ComponentRecord

QUALITY_ORDER = {
    "宇航级": 6,
    "S": 6,
    "CAST A": 6,
    "CAST B": 5,
    "B": 5,
    "CAST C": 4,
    "C": 4,
    "GJB": 4,
    "军品级": 3,
    "工业级": 2,
    "民品级": 1,
    "商业级": 1,
    "": 0,
}


def _origin_from_map(
    name: str, manufacturer_origins: dict[str, str] | None = None
) -> str:
    text = str(name or "").strip()
    if not text:
        return "无"
    return (manufacturer_origins or {}).get(text) or "进口"


def summarize_category(
    components: list[ComponentRecord],
    manufacturer_origins: dict[str, str] | None = None,
) -> dict[str, Any]:
    by_category = Counter(c.category_name or "未分类" for c in components)
    by_category_domestic = Counter(
        (
            c.category_name or "未分类",
            _origin_from_map(c.manufacturer, manufacturer_origins),
        )
        for c in components
    )
    return {
        "total": len(components),
        "by_category": dict(by_category),
        "by_category_domestic": {
            f"{cat}/{domestic}": count
            for (cat, domestic), count in by_category_domestic.items()
        },
    }


def select_key_units(components: list[ComponentRecord]) -> list[dict[str, Any]]:
    return [c.to_dict() for c in components if c.is_key_part]


def detect_low_quality(
    components: list[ComponentRecord],
    min_level: str = "CAST C",
    config=None,
    manufacturer_origins: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    min_level = _quality_min_level(config, min_level)
    low_models = (
        config.selected_models("user_confirmations.low_quality_models")
        if config
        else set()
    )
    threshold = quality_rank(min_level)
    rows = []
    for comp in components:
        rank = quality_rank(comp.quality_level)
        is_ok = bool(rank and rank >= threshold)
        if comp.is_low_quality or comp.model in low_models:
            is_ok = False
        rows.append(
            {
                "index": comp.index,
                "型号规格": comp.model,
                "名称": comp.name,
                "封装形式": comp.package_type or "未填写",
                "质量等级": comp.quality_level or "未填写",
                "关键部位": comp.is_key_part,
                "国产/进口": _origin_from_map(comp.manufacturer, manufacturer_origins),
                "是否满足要求": "满足" if is_ok else "需关注",
                "reason": "" if is_ok else f"质量等级低于{min_level}或被标记为低等级",
            }
        )
    return rows


def _quality_min_level(config, fallback: str = "CAST C") -> str:
    if not config:
        return fallback
    return (
        config.get("quality_level.min_required")
        or config.get("quality_level.selected")
        or config.get("compliance_config.quality_level.min_required")
        or fallback
    )


def quality_rank(level: str) -> int:
    text = (level or "").upper().replace("-", " ").strip()
    for key, rank in sorted(
        QUALITY_ORDER.items(), key=lambda item: len(item[0]), reverse=True
    ):
        if not key:
            continue
        key_text = key.upper()
        if len(key_text) == 1:
            if key_text in re.split(r"[^A-Z0-9]+", text):
                return rank
            continue
        if key_text in text:
            return rank
    return QUALITY_ORDER.get(level, 0)


def check_flight_history(
    components: list[ComponentRecord],
    manufacturer_origins: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    rows = []
    for comp in components:
        text = str(comp.flight_history or "").strip()
        if text and text not in {
            "无",
            "未填写",
            "未知",
            "未提供",
            "None",
            "none",
            "null",
            "NULL",
            "-",
        }:
            continue
        rows.append(
            {
                "index": comp.index,
                "component_name": comp.name,
                "model": comp.model,
                "manufacturer": comp.manufacturer,
                "国产/进口": _origin_from_map(comp.manufacturer, manufacturer_origins),
                "package_type": comp.package_type or "未填写",
                "quality_level": comp.quality_level or "未填写",
                "flight_history": text or "未填写",
                "status": "需关注",
            }
        )
    return rows


def catalog_match_with_candidates(
    components: list[ComponentRecord],
    catalog_rows: list[dict],
    configured_results: list[dict] | None = None,
    manufacturer_origins: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    if configured_results:
        return _normalize_configured_catalog_results(
            components, configured_results, manufacturer_origins
        )
    if not catalog_rows:
        rows = []
        for comp in components:
            origin = _origin_from_map(comp.manufacturer, manufacturer_origins)
            if origin == "进口":
                rows.append(_import_catalog_unavailable_row(comp, with_candidates=True))
                continue
            rows.append(
                {
                    "index": comp.index,
                    "list_model": comp.model,
                    "list_manufacturer": comp.manufacturer,
                    "国产/进口": origin,
                    "catalog_model": "",
                    "catalog_manufacturer": "",
                    "is_in_catalog": "未提供目录",
                    "score": 0,
                    "ai_recommended": False,
                    "selected_candidate": None,
                    "candidates": [],
                }
            )
        return rows

    rows = []
    for comp in components:
        origin = _origin_from_map(comp.manufacturer, manufacturer_origins)
        if origin == "进口":
            rows.append(_import_catalog_unavailable_row(comp, with_candidates=True))
            continue
        candidates = _catalog_candidates(comp, catalog_rows)
        selected = candidates[0] if candidates else None
        is_confident = bool(selected and selected["score"] >= CATALOG_MATCH_THRESHOLD)
        selected_in_catalog = bool(
            selected and selected["score"] >= CATALOG_MATCH_THRESHOLD
        )
        rows.append(
            {
                "index": comp.index,
                "list_model": comp.model,
                "list_manufacturer": comp.manufacturer,
                "国产/进口": origin,
                "catalog_model": selected["catalog_model"] if selected else "",
                "catalog_manufacturer": selected["catalog_manufacturer"]
                if selected
                else "",
                "is_in_catalog": "目录内" if selected_in_catalog else "目录外",
                "score": selected["score"]
                if selected
                else (candidates[0]["score"] if candidates else 0),
                "ai_recommended": selected is not None,
                "recommendation_confident": is_confident,
                "selected_candidate": selected,
                "candidates": candidates,
            }
        )
    return rows


def _import_catalog_unavailable_row(
    comp: ComponentRecord, with_candidates: bool = False
) -> dict[str, Any]:
    row: dict[str, Any] = {
        "index": comp.index,
        "list_model": comp.model,
        "list_manufacturer": comp.manufacturer,
        "国产/进口": "进口",
        "catalog_model": "",
        "catalog_manufacturer": "",
        "is_in_catalog": "无",
        "score": 0,
    }
    if with_candidates:
        row.update(
            {
                "ai_recommended": False,
                "recommendation_confident": False,
                "selected_candidate": None,
                "candidates": [],
            }
        )
    return row


def _normalize_configured_catalog_results(
    components: list[ComponentRecord],
    rows: list[dict[str, Any]],
    manufacturer_origins: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    component_by_index = {comp.index: comp for comp in components}
    component_by_model = {comp.model: comp for comp in components if comp.model}
    output = []
    for row in rows:
        item = dict(row)
        comp = component_by_index.get(item.get("index")) or component_by_model.get(
            str(item.get("list_model") or item.get("型号规格") or "")
        )
        origin = item.get("国产/进口") or (
            _origin_from_map(comp.manufacturer, manufacturer_origins) if comp else ""
        )
        if origin:
            item["国产/进口"] = origin
        if origin == "进口":
            item["is_in_catalog"] = "无"
            if "目录内或外" in item:
                item["目录内或外"] = "无"
        output.append(item)
    return output


def catalog_match_report_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "index": row.get("index"),
            "list_model": row.get("list_model"),
            "list_manufacturer": row.get("list_manufacturer"),
            "国产/进口": row.get("国产/进口"),
            "catalog_model": row.get("catalog_model"),
            "catalog_manufacturer": row.get("catalog_manufacturer"),
            "is_in_catalog": row.get("is_in_catalog"),
            "score": row.get("score"),
            "ai_recommended": row.get("ai_recommended", False),
        }
        for row in rows
    ]


def _catalog_score(
    comp: ComponentRecord, model: str, name: str, manufacturer: str
) -> float:
    model_score = _ratio(comp.model, model)
    name_score = max(_ratio(comp.name, name), _ratio(comp.name, model))
    base_score = max(model_score, name_score)
    if comp.manufacturer and manufacturer:
        return (base_score * 0.75) + (_ratio(comp.manufacturer, manufacturer) * 0.25)
    return base_score


def _catalog_match_reason(
    comp: ComponentRecord, model: str, name: str, manufacturer: str, score: float
) -> str:
    parts = []
    if comp.model and model:
        parts.append(f"型号相似度 {round(_ratio(comp.model, model) * 100, 1)}%")
    if comp.name and (name or model):
        parts.append(
            f"名称相似度 {round(max(_ratio(comp.name, name), _ratio(comp.name, model)) * 100, 1)}%"
        )
    if comp.manufacturer and manufacturer:
        parts.append(
            f"厂商相似度 {round(_ratio(comp.manufacturer, manufacturer) * 100, 1)}%"
        )
    parts.append(f"综合得分 {round(score * 100, 1)}%")
    return "；".join(parts)


def _catalog_detail(item: dict[str, Any]) -> dict[str, Any]:
    detail = {}
    for key, value in item.items():
        if value is None:
            continue
        text = str(value).strip()
        if text:
            detail[str(key)] = text
    return detail


def _catalog_field(row: dict[str, Any], field: str) -> str:
    exact_aliases = {
        "model": [
            "model",
            "component_model",
            "\u578b\u53f7",
            "\u578b\u53f7\u89c4\u683c",
        ],
        "name": [
            "catalog_name",
            "name",
            "component_name",
            "\u540d\u79f0",
            "\u5143\u5668\u4ef6\u540d\u79f0",
        ],
        "manufacturer": [
            "manufacturer",
            "manufacturer_name",
            "\u5382\u5546",
            "\u751f\u4ea7\u5382\u5546",
            "\u5236\u9020\u5546",
        ],
        "group": [
            "catalog_group",
            "group",
            "category",
            "\u7c7b\u522b",
            "\u5206\u7c7b",
            "\u76ee\u5f55\u7c7b\u522b",
        ],
    }
    value = _first_value(row, exact_aliases[field])
    if value:
        return value

    contains_aliases = {
        "model": ["model", "partnumber", "part_number", "\u578b\u53f7", "\u89c4\u683c"],
        "name": ["name", "\u540d\u79f0"],
        "manufacturer": [
            "manufacturer",
            "vendor",
            "maker",
            "\u5382\u5546",
            "\u5382\u5bb6",
            "\u751f\u4ea7",
            "\u5236\u9020",
        ],
        "group": ["group", "category", "\u7c7b\u522b", "\u5206\u7c7b", "\u76ee\u5f55"],
    }
    for key, item in row.items():
        if item is None:
            continue
        key_text = str(key).strip().lower().replace(" ", "").replace("-", "_")
        if any(alias in key_text for alias in contains_aliases[field]):
            value = str(item).strip()
            if value:
                return value
    return ""


def _first_value(row: dict, names: list[str]) -> str:
    for name in names:
        if name in row and row[name]:
            return str(row[name]).strip()
    return ""


def _ratio(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


CATALOG_RECALL_LIMIT = 400
CATALOG_CANDIDATE_LIMIT = 10
CATALOG_MATCH_THRESHOLD = 0.72
CATALOG_PREFIX_LENGTH = 4
CATALOG_NGRAM_SIZE = 3
_CATALOG_INDEX_CACHE: dict[int, tuple[int, dict[str, Any]]] = {}


def _catalog_candidates(
    comp: ComponentRecord, catalog_rows: list[dict]
) -> list[dict[str, Any]]:
    index = _catalog_index(catalog_rows)
    candidate_entries = _recall_catalog_entries(comp, index)
    candidates = []
    for entry in candidate_entries:
        score = _catalog_score(
            comp, entry["model"], entry["name"], entry["manufacturer"]
        )
        candidates.append(
            {
                "rank": 0,
                "catalog_index": entry["catalog_index"],
                "catalog_model": entry["model"],
                "catalog_name": entry["name"],
                "catalog_manufacturer": entry["manufacturer"],
                "catalog_group": entry["group"],
                "score": round(score, 3),
                "similarity": f"{round(score * 100, 1)}%",
                "reason": _catalog_match_reason(
                    comp, entry["model"], entry["name"], entry["manufacturer"], score
                ),
                "catalog_detail": entry["detail"],
            }
        )
    candidates.sort(
        key=lambda item: (item["score"], item.get("catalog_group") == "A"), reverse=True
    )
    candidates = candidates[:CATALOG_CANDIDATE_LIMIT]
    for rank, item in enumerate(candidates, start=1):
        item["rank"] = rank
    return candidates


def _catalog_index(catalog_rows: list[dict]) -> dict[str, Any]:
    cache_key = id(catalog_rows)
    cached = _CATALOG_INDEX_CACHE.get(cache_key)
    if cached and cached[0] == len(catalog_rows):
        return cached[1]

    entries = []
    model_exact: dict[str, set[int]] = defaultdict(set)
    model_prefix: dict[str, set[int]] = defaultdict(set)
    ngrams: dict[str, set[int]] = defaultdict(set)
    manufacturer: dict[str, set[int]] = defaultdict(set)
    for position, item in enumerate(catalog_rows, start=1):
        model = _catalog_field(item, "model")
        name = _catalog_field(item, "name")
        maker = _catalog_field(item, "manufacturer")
        group = _catalog_field(item, "group")
        model_key = _catalog_norm(model)
        maker_key = _catalog_norm(maker)
        entry = {
            "catalog_index": position,
            "model": model,
            "name": name,
            "manufacturer": maker,
            "group": group,
            "detail": _catalog_detail(item),
            "model_key": model_key,
            "name_key": _catalog_norm(name),
            "manufacturer_key": maker_key,
        }
        idx = len(entries)
        entries.append(entry)
        if model_key:
            model_exact[model_key].add(idx)
            for length in range(CATALOG_PREFIX_LENGTH, min(len(model_key), 10) + 1):
                model_prefix[model_key[:length]].add(idx)
            for gram in _catalog_ngrams(model_key):
                ngrams[gram].add(idx)
        if maker_key:
            manufacturer[maker_key].add(idx)

    index = {
        "entries": entries,
        "model_exact": model_exact,
        "model_prefix": model_prefix,
        "ngrams": ngrams,
        "manufacturer": manufacturer,
    }
    _CATALOG_INDEX_CACHE.clear()
    _CATALOG_INDEX_CACHE[cache_key] = (len(catalog_rows), index)
    return index


def _recall_catalog_entries(
    comp: ComponentRecord, index: dict[str, Any]
) -> list[dict[str, Any]]:
    entries = index["entries"]
    model_key = _catalog_norm(comp.model)
    name_key = _catalog_norm(comp.name)
    maker_key = _catalog_norm(comp.manufacturer)
    candidate_scores: dict[int, int] = defaultdict(int)

    if model_key:
        for idx in index["model_exact"].get(model_key, ()):
            candidate_scores[idx] += 100
        for length in range(min(len(model_key), 10), CATALOG_PREFIX_LENGTH - 1, -1):
            for idx in index["model_prefix"].get(model_key[:length], ()):
                candidate_scores[idx] += length * 8
        for gram in _catalog_ngrams(model_key):
            for idx in index["ngrams"].get(gram, ()):
                candidate_scores[idx] += 3

    if name_key and not candidate_scores:
        for gram in _catalog_ngrams(name_key):
            for idx in index["ngrams"].get(gram, ()):
                candidate_scores[idx] += 1

    if maker_key:
        maker_hits = set(index["manufacturer"].get(maker_key, ()))
        for idx in maker_hits:
            candidate_scores[idx] += 8
        if candidate_scores:
            overlap = set(candidate_scores).intersection(maker_hits)
            if overlap:
                for idx in overlap:
                    candidate_scores[idx] += 20

    if not candidate_scores:
        return entries

    ranked_indices = [
        idx
        for idx, _ in sorted(
            candidate_scores.items(), key=lambda item: item[1], reverse=True
        )[:CATALOG_RECALL_LIMIT]
    ]
    return [entries[idx] for idx in ranked_indices]


def _catalog_norm(value: Any) -> str:
    text = str(value or "").upper()
    return re.sub(r"[^0-9A-Z\u4E00-\u9FFF]+", "", text)


def _catalog_ngrams(value: str) -> set[str]:
    if not value:
        return set()
    if len(value) <= CATALOG_NGRAM_SIZE:
        return {value}
    return {
        value[index : index + CATALOG_NGRAM_SIZE]
        for index in range(len(value) - CATALOG_NGRAM_SIZE + 1)
    }


def reliability_query(
    components: list[ComponentRecord], reliability_rows: list[dict]
) -> list[dict[str, Any]]:
    indexed = defaultdict(list)
    for row in reliability_rows:
        joined = " ".join(str(v) for v in row.values()).lower()
        indexed["all"].append((joined, row))

    results = []
    for comp in components:
        probe = f"{comp.model} {comp.name} {comp.manufacturer}".lower()
        hits = []
        for joined, row in indexed["all"]:
            if comp.model and comp.model.lower() in joined or comp.name and comp.name.lower() in joined or _ratio(probe, joined[: max(len(probe), 1)]) > 0.72:
                hits.append(row)
            if len(hits) >= 5:
                break
        quality_hits = [
            h for h in hits if "质量" in str(h) or "quality" in str(h).lower()
        ]
        radiation_hits = [
            h
            for h in hits
            if "辐射" in str(h)
            or "radiation" in str(h).lower()
            or "see" in str(h).lower()
        ]
        results.append(
            {
                "index": comp.index,
                "component_name": comp.name,
                "model": comp.model,
                "manufacturer": comp.manufacturer,
                "quality": {
                    "count": len(quality_hits),
                    "answer": _summarize_hits(quality_hits)
                    if quality_hits
                    else "未检索到质量问题记录",
                },
                "radiation": {
                    "count": len(radiation_hits),
                    "answer": _summarize_hits(radiation_hits)
                    if radiation_hits
                    else "未检索到辐射效应记录",
                },
            }
        )
    return results


def _summarize_hits(rows: list[dict]) -> str:
    snippets = []
    for row in rows[:3]:
        values = [str(v).strip() for v in row.values() if str(v).strip()]
        snippets.append("；".join(values[:4]))
    return "\n".join(snippets)


def summarize_manufacturer_compliance(rows: list[dict[str, Any]]) -> dict[str, Any]:
    attention_rows = []
    in_catalog_count = 0
    out_catalog_count = 0
    import_count = 0
    for row in rows:
        origin = str(row.get("国产/进口") or "").strip()
        status = str(row.get("目录内或外") or row.get("目录状态") or "").strip()
        if status == "目录内":
            in_catalog_count += 1
        if status == "目录外":
            out_catalog_count += 1
        if origin == "进口":
            import_count += 1
        if status == "目录外" or origin == "进口":
            attention_rows.append(row)
    return {
        "total_manufacturers": len(rows),
        "in_catalog_count": in_catalog_count,
        "out_catalog_count": out_catalog_count,
        "import_count": import_count,
        "attention_count": len(attention_rows),
        "attention_rows": attention_rows,
    }


def _table_report(rows: list[dict[str, Any]]) -> str:
    if not rows:
        return "无数据。"
    if (
        isinstance(rows[0], dict)
        and "selected_candidate" in rows[0]
        and "candidates" in rows[0]
    ):
        rows = catalog_match_report_rows(rows)
    headers = list(rows[0].keys())
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join(["---"] * len(headers)) + " |",
    ]
    for row in rows:
        lines.append("| " + " | ".join(_cell(row.get(h, "")) for h in headers) + " |")
    return "\n".join(lines)


def _cell(value: Any) -> str:
    text = str(value).replace("\n", "<br>").replace("|", "\\|")
    return text[:240] + "..." if len(text) > 240 else text
