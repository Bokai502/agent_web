from __future__ import annotations

from pathlib import Path
from typing import Any

from .common import load_json, write_json
from .report_schema import REPORT_SECTION_KEYS


LLM_ANALYSIS_SCHEMA_VERSION = "cad_sim_report_llm_analysis/1.0"


def validate_llm_analysis(value: Any, source: Path | None = None) -> dict[str, Any]:
    location = f" at {source}" if source else ""
    if not isinstance(value, dict):
        raise RuntimeError(f"Cannot read llm_analysis.json{location}")
    sections = value.get("report_sections")
    if not isinstance(sections, dict):
        raise RuntimeError(f"llm_analysis.json missing report_sections{location}")
    for key in REPORT_SECTION_KEYS:
        items = sections.get(key)
        if not isinstance(items, list):
            raise RuntimeError(f"llm_analysis.json missing report section: {key}")
        cleaned = [str(item).strip() for item in items if str(item).strip()]
        if not cleaned:
            raise RuntimeError(f"llm_analysis.json has empty report section: {key}")
        sections[key] = cleaned
    if value.get("schema_version") != LLM_ANALYSIS_SCHEMA_VERSION:
        value["schema_version"] = LLM_ANALYSIS_SCHEMA_VERSION
    return value


def load_llm_analysis(path: Path) -> dict[str, Any]:
    return validate_llm_analysis(load_json(path), path)


def write_llm_analysis(path: Path, analysis: dict[str, Any]) -> None:
    write_json(path, validate_llm_analysis(analysis, path))
