from __future__ import annotations

from typing import Any

from .app_config import app_root
from .io_utils import read_json_if_exists


LOCAL_DATA_DIR = app_root() / "data" / "compliance"
MANUFACTURER_FULL_NAMES_PATH = LOCAL_DATA_DIR / "manufacturer_full_names.json"
MANUFACTURER_ALIASES_PATH = LOCAL_DATA_DIR / "manufacturer_aliases.json"


def load_manufacturer_full_names() -> list[str]:
    data = read_json_if_exists(MANUFACTURER_FULL_NAMES_PATH)
    if isinstance(data, list):
        return _unique_texts(data)
    if isinstance(data, dict):
        values = data.get("full_names") or data.get("manufacturers") or []
        if isinstance(values, list):
            return _unique_texts(values)
    return []


def load_manufacturer_confirmations() -> dict[str, dict[str, str]]:
    data = read_json_if_exists(MANUFACTURER_ALIASES_PATH)
    if not isinstance(data, dict):
        return {}
    aliases = data.get("aliases") if isinstance(data.get("aliases"), dict) else data
    output: dict[str, dict[str, str]] = {}
    for alias, value in aliases.items():
        key = _normalize_key(alias)
        if not key:
            continue
        if isinstance(value, dict):
            short_name = str(value.get("厂商简称") or value.get("alias") or alias).strip()
            full_name = str(value.get("厂商全称") or value.get("full_name") or "").strip()
            origin = str(value.get("国产/进口") or value.get("origin") or "").strip()
            status = str(value.get("目录内或外") or value.get("catalog_status") or "").strip()
        else:
            short_name = str(alias).strip()
            full_name = str(value or "").strip()
            origin = "国产" if _valid_full_name(full_name) else ""
            status = "目录内" if _valid_full_name(full_name) else ""
        output[key] = {
            "厂商简称": short_name,
            "厂商全称": full_name or "无",
            "国产/进口": origin or ("国产" if _valid_full_name(full_name) else "进口"),
            "目录内或外": status or ("目录内" if _valid_full_name(full_name) else "无"),
        }
    return output


def find_manufacturer_confirmation(
    short_name: str,
    confirmations: dict[str, dict[str, str]] | None = None,
) -> dict[str, str] | None:
    confirmations = confirmations if confirmations is not None else load_manufacturer_confirmations()
    for key in _alias_keys(short_name):
        item = confirmations.get(key)
        if item:
            return item
    return None


def _normalize_key(value: Any) -> str:
    return "".join(str(value or "").strip().lower().split())


def _alias_keys(value: Any) -> list[str]:
    key = _normalize_key(value)
    keys = [key] if key else []
    if key.endswith("厂"):
        keys.append(key[:-1])
    elif key:
        keys.append(f"{key}厂")
    return [item for index, item in enumerate(keys) if item and item not in keys[:index]]


def _valid_full_name(value: Any) -> str:
    text = str(value or "").strip()
    if not text or text == "无" or text.startswith("未找到"):
        return ""
    return text


def _unique_texts(values: list[Any]) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for value in values:
        text = str(value or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        output.append(text)
    return sorted(output)
