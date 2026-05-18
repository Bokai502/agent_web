from __future__ import annotations

from pathlib import Path
import re
from typing import Any, Iterable, Mapping

from pipeline.input_normalize.module_db_cad_lookup import (
    build_module_db_cad_index,
    display_info_from_excel_record,
)


def build_display_index(
    thermal_db: Path,
    *,
    cad_prefix: Path | None = None,
    datasheet_prefix: Path | None = None,
) -> dict[str, Any]:
    return build_module_db_cad_index(
        thermal_db,
        cad_prefix=cad_prefix,
        datasheet_prefix=datasheet_prefix,
    )


def first_matching_lookup_key(
    candidates: Iterable[Any],
    by_component_id: Mapping[str, Any],
) -> str:
    """Return the first candidate present in the component lookup table."""
    normalized = [_clean(candidate) for candidate in candidates]
    for value in normalized:
        if value and value in by_component_id:
            return value
    return next((value for value in normalized if value), "")


def display_lookup(
    lookup_key: str | None,
    by_component_id: Mapping[str, Any],
) -> dict[str, Any]:
    """Build display info and status for a thermal DB lookup key."""
    normalized_key = _clean(lookup_key)
    if not normalized_key:
        return {
            "display_info": None,
            "lookup_status": "not_applicable_no_thermal_db_key",
            "matched": False,
            "missing": False,
        }
    record = by_component_id.get(normalized_key)
    if record:
        return {
            "display_info": display_info_from_excel_record(record),
            "lookup_status": "matched_component_id",
            "matched": True,
            "missing": False,
        }
    if is_layout_generated_component_id(normalized_key):
        return {
            "display_info": None,
            "lookup_status": "not_applicable_no_thermal_db_key",
            "matched": False,
            "missing": False,
        }
    return {
        "display_info": None,
        "lookup_status": "not_found_by_component_id",
        "matched": False,
        "missing": True,
    }


def query_summary(
    *,
    components: list[dict[str, Any]],
    missing_count: int,
) -> dict[str, int]:
    return {
        "total_records": len(components),
        "matched_records": sum(1 for item in components if item.get("display_info")),
        "missing_records": missing_count,
        "not_applicable_records": sum(
            1 for item in components if item.get("lookup_status") == "not_applicable_no_thermal_db_key"
        ),
    }


def is_layout_generated_component_id(value: str | None) -> bool:
    return bool(re.fullmatch(r"[PER]_\d{3}_(internal|external|radiator)", _clean(value)))


def _clean(value: Any) -> str:
    return str(value or "").strip()
