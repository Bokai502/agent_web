from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from .io_utils import read_json_if_exists


CONFIRMED_RESULTS_RELATIVE_PATH = (
    Path("check_outputs") / "compliance" / "confirmed_results.json"
)


def load_confirmed_results(workspace_dir: Path | None) -> dict[str, list[dict[str, Any]]]:
    if workspace_dir is None:
        return {}
    payload = read_json_if_exists(workspace_dir / CONFIRMED_RESULTS_RELATIVE_PATH)
    stages = payload.get("stages") if isinstance(payload, dict) else {}
    if not isinstance(stages, dict):
        return {}

    confirmed: dict[str, list[dict[str, Any]]] = {}
    for stage, value in stages.items():
        if stage == "manufacturer_check":
            continue
        rows = value.get("rows") if isinstance(value, dict) else []
        if isinstance(rows, list):
            confirmed[str(stage)] = [row for row in rows if isinstance(row, dict)]
    return confirmed


def apply_confirmed_rows(
    stage: str,
    fresh: Any,
    confirmed_results: dict[str, list[dict[str, Any]]],
) -> Any:
    if stage == "manufacturer_check":
        return fresh
    confirmed_rows = confirmed_results.get(stage) or []
    if not confirmed_rows:
        return fresh

    if stage == "derating_check" and isinstance(fresh, dict):
        rows = fresh.get("rows")
        if isinstance(rows, list):
            return {
                **fresh,
                "rows": _merge_rows(stage, rows, confirmed_rows),
                "confirmation_source": "confirmed_results.json",
            }
        return fresh

    if isinstance(fresh, list):
        return _merge_rows(stage, fresh, confirmed_rows)

    return fresh


def _merge_rows(
    stage: str,
    fresh_rows: list[Any],
    confirmed_rows: list[dict[str, Any]],
) -> list[Any]:
    confirmed_by_key = {
        key: row
        for row in confirmed_rows
        for key in [_row_key(stage, row)]
        if key
    }
    if not confirmed_by_key:
        return fresh_rows

    merged: list[Any] = []
    seen_keys: set[str] = set()
    for row in fresh_rows:
        if not isinstance(row, dict):
            merged.append(row)
            continue
        key = _row_key(stage, row)
        if key:
            seen_keys.add(key)
        confirmed = confirmed_by_key.get(key)
        if confirmed:
            merged.append(
                {
                    **row,
                    **confirmed,
                    "confirmation_source": "confirmed_results.json",
                }
            )
        else:
            merged.append(row)
    if stage == "key_units_check":
        for row in confirmed_rows:
            key = _row_key(stage, row)
            if key and key not in seen_keys and not _is_key_part(row):
                merged.append(
                    {
                        **row,
                        "confirmation_source": "confirmed_results.json",
                    }
                )
    return merged


def _row_key(stage: str, row: dict[str, Any]) -> str:
    if stage == "catalog_match":
        return _join(
            _value(row, "list_model", "model", "型号规格", "catalog_model"),
            _value(row, "list_manufacturer", "manufacturer", "厂商", "catalog_manufacturer"),
            _value(row, "component_name", "名称", "元器件名称", "name"),
        )

    if stage == "component_classification":
        return _join(
            _value(row, "model", "型号规格"),
            _value(row, "manufacturer", "厂商"),
            _value(row, "component_name", "名称", "元器件名称", "name"),
        ) or _join(_value(row, "index", "序号"))

    if stage == "quality_level_check":
        return _join(
            _value(row, "型号规格", "model"),
            _value(row, "名称", "component_name", "元器件名称", "name"),
            _value(row, "质量等级", "quality_level"),
            _value(row, "国产/进口"),
        ) or _join(_value(row, "index", "序号"))

    if stage == "reliability_query":
        return _join(
            _value(row, "model", "型号规格"),
            _value(row, "manufacturer", "厂商"),
            _value(row, "component_name", "名称", "元器件名称", "name"),
        ) or _join(_value(row, "index", "序号"))

    if stage == "derating_check":
        return _join(
            _value(row, "元器件名称", "component_name", "名称", "name"),
            _value(row, "型号规格", "型号规格_规格", "model", "list_model"),
            _value(row, "生产厂商", "生产厂商_生产单位", "manufacturer", "厂商"),
            _value(row, "降额参数", "parameter", "参数"),
        )

    if stage == "key_units_check":
        return _join(
            _value(row, "model", "型号规格"),
            _value(row, "manufacturer", "厂商"),
            _value(row, "name", "component_name", "名称", "元器件名称"),
        ) or _join(_value(row, "index", "序号"))

    return _join(_value(row, "index", "序号"))


def _value(row: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = row.get(key)
        if value is not None and str(value).strip():
            return str(value)
    return ""


def _is_key_part(row: dict[str, Any]) -> bool:
    text = _value(row, "is_key_part", "关键部位", "关键器件", "status").strip().lower()
    return text in {"true", "是", "关键", "yes", "y", "1"}


def _join(*parts: str) -> str:
    normalized = [_normalize(part) for part in parts if _normalize(part)]
    return "|".join(normalized)


def _normalize(value: Any) -> str:
    text = str(value or "").strip().lower()
    return re.sub(r"\s+", "", text)
