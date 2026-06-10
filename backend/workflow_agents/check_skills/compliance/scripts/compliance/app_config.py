from __future__ import annotations

from pathlib import Path
from typing import Any

from .io_utils import read_json_if_exists


def skill_dir() -> Path:
    return Path(__file__).resolve().parents[2]


def reference_dir() -> Path:
    return skill_dir() / "reference"


def app_root() -> Path:
    return Path(__file__).resolve().parents[6]


def app_config_path() -> Path:
    return app_root() / "config.json"


def app_config() -> dict[str, Any]:
    data = read_json_if_exists(app_config_path())
    return data if isinstance(data, dict) else {}


def nested_value(data: dict[str, Any], *keys: str) -> Any:
    current: Any = data
    for key in keys:
        if not isinstance(current, dict) or key not in current:
            return None
        current = current[key]
    return current


def config_value(*keys: str) -> Any:
    return nested_value(app_config(), *keys)


def chat_model_config() -> dict[str, Any]:
    value = config_value("chatModel")
    return value if isinstance(value, dict) else {}


def compliance_database_config(name: str) -> dict[str, Any]:
    config = app_config()
    candidates = [
        nested_value(config, "compliance", "database", name),
        nested_value(config, "compliance", name),
        nested_value(config, "database", name),
    ]
    for candidate in candidates:
        if isinstance(candidate, dict):
            return candidate
    return {}
