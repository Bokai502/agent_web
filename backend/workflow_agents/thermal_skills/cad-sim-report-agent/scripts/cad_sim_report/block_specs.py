from __future__ import annotations

import re
from typing import Any

from .common import count_existing, fmt_bool, fmt_num, get_nested
from .report_schema import ALLOWED_FIELD_REFS as SCHEMA_ALLOWED_FIELD_REFS


DocxBlock = dict[str, Any]
BlockSpec = dict[str, Any]
MISSING = object()
FIELD_PLACEHOLDER_RE = re.compile(r"\{\{\s*([A-Za-z0-9_.]+)(?:\|([A-Za-z0-9_]+))?\s*\}\}")
ALLOWED_FIELD_REFS = set(SCHEMA_ALLOWED_FIELD_REFS)


def heading(text: str, level: int = 3) -> DocxBlock:
    return {"type": "heading", "text": text, "level": level}


def paragraph(text: str) -> DocxBlock:
    return {"type": "paragraph", "text": text}


def bullet(text: str, ordered: bool = False) -> DocxBlock:
    return {"type": "list_item", "text": text, "ordered": ordered}


def table(headers: list[str], rows: list[list[Any]], caption: str = "") -> DocxBlock:
    return {
        "type": "table",
        "headers": [str(item) for item in headers],
        "rows": [[str(item) for item in row] for row in rows],
        "caption": caption,
    }


def image_gallery(caption: str, images: list[dict[str, Any]]) -> list[DocxBlock]:
    existing = [image for image in images if image.get("exists")]
    return [{"type": "image_gallery", "images": existing, "caption": caption}] if existing else [paragraph("未找到可用图片。")]


def resolve_field_ref(ref: str, data: dict[str, Any]) -> Any:
    if ref not in ALLOWED_FIELD_REFS:
        raise RuntimeError(f"Unsupported field_ref: {ref}")
    parts = [part.strip() for part in ref.split(".")]
    if not parts or any(not part for part in parts):
        raise RuntimeError(f"Invalid field_ref: {ref}")
    value = get_nested(data, parts, MISSING)
    if value is MISSING:
        raise RuntimeError(f"Cannot resolve field_ref: {ref}")
    return value


def format_value(value: Any, format_name: str | None = None) -> str:
    if format_name in (None, "", "str"):
        return "unknown" if value is None else str(value)
    if format_name == "num":
        return fmt_num(value)
    if format_name == "bool":
        return fmt_bool(value)
    if format_name == "count_existing":
        if not isinstance(value, list):
            raise RuntimeError("count_existing format requires a list")
        return str(count_existing(value))
    raise RuntimeError(f"Unsupported cell format: {format_name}")


def resolve_text_placeholders(text: str, data: dict[str, Any]) -> str:
    def replace(match: re.Match[str]) -> str:
        ref = match.group(1)
        format_name = match.group(2)
        return format_value(resolve_field_ref(ref, data), format_name)

    return FIELD_PLACEHOLDER_RE.sub(replace, text)


def resolve_cell(value: Any, data: dict[str, Any]) -> str:
    if isinstance(value, dict):
        if "field_ref" in value:
            return format_value(resolve_field_ref(str(value["field_ref"]), data), value.get("format"))
        if "template" in value:
            values = {str(k): resolve_cell(v, data) for k, v in (value.get("values") or {}).items()}
            return str(value["template"]).format(**values)
        if "join" in value:
            return str(value.get("separator", " / ")).join(resolve_cell(item, data) for item in value.get("join") or [])
        raise RuntimeError(f"Unsupported cell spec: {value}")
    if isinstance(value, list):
        return " / ".join(resolve_cell(item, data) for item in value)
    if isinstance(value, str):
        return resolve_text_placeholders(value, data)
    return format_value(value)


def render_spec_blocks(spec: list[BlockSpec], data: dict[str, Any] | None = None) -> list[DocxBlock]:
    context = data or {}
    blocks: list[DocxBlock] = []
    for item in spec:
        item_type = item.get("type")
        if item_type == "heading":
            blocks.append(heading(resolve_cell(item.get("text", ""), context), int(item.get("level", 3))))
        elif item_type == "paragraph":
            blocks.append(paragraph(resolve_cell(item.get("text", ""), context)))
        elif item_type == "paragraphs":
            blocks.extend(paragraph(text) for text in (resolve_cell(text, context).strip() for text in item.get("items", []) or []) if text)
        elif item_type == "table":
            blocks.append(table(
                [resolve_cell(header, context) for header in item.get("headers", [])],
                [[resolve_cell(cell, context) for cell in row] for row in item.get("rows", [])],
                resolve_cell(item.get("caption", ""), context),
            ))
        elif item_type == "image_gallery":
            blocks.extend(image_gallery(str(item.get("caption") or item.get("title") or ""), list(item.get("images") or [])))
        elif item_type == "blocks":
            blocks.extend(item.get("blocks", []) or [])
        else:
            raise RuntimeError(f"Unsupported report block spec type: {item_type}")
    return blocks
