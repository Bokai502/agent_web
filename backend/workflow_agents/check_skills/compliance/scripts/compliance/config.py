from __future__ import annotations

from pathlib import Path
from typing import Any

from .io_utils import read_json_if_exists


class ComplianceConfig:
    """Static replacements for values the original web flow asked users to confirm."""

    def __init__(self, path: str | Path | None = None) -> None:
        self.path = Path(path) if path else None
        self.data: dict[str, Any] = read_json_if_exists(self.path)

    def get(self, key: str, default: Any = None) -> Any:
        value: Any = self.data
        for part in key.split("."):
            if not isinstance(value, dict) or part not in value:
                return default
            value = value[part]
        return value

    @property
    def enabled(self) -> bool:
        return bool(self.data)

    def component_class(self, component_name: str) -> dict[str, str] | None:
        mapping = self.get("component_classification.overrides", {})
        if not isinstance(mapping, dict):
            return None
        item = mapping.get(component_name)
        return item if isinstance(item, dict) else None

    def manufacturer(self, short_name: str) -> dict[str, str] | None:
        mapping = self.get("manufacturer_confirmations", {})
        if not isinstance(mapping, dict):
            return None
        item = mapping.get(short_name)
        return item if isinstance(item, dict) else None

    def selected_models(self, key: str) -> set[str]:
        values = self.get(key, [])
        if not isinstance(values, list):
            return set()
        return {str(item).strip() for item in values if str(item).strip()}

    def external_results(self, key: str) -> list[dict]:
        values = self.get(f"external_results.{key}", [])
        return values if isinstance(values, list) else []
