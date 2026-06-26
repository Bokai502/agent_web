from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

from docxtpl import DocxTemplate

from .docx_blocks import render_blocks_to_subdoc


def template_dir() -> Path:
    return Path(__file__).resolve().parents[2] / "assets"


def build_template_context(template: DocxTemplate, content: dict[str, Any]) -> dict[str, Any]:
    context: dict[str, Any] = {}
    for key, value in content.items():
        if isinstance(value, list):
            context[key] = render_blocks_to_subdoc(template, value)
        else:
            context[key] = value
    return context


def render_template_docx(template_path: Path, content: dict[str, Any], out_path: Path) -> None:
    template = DocxTemplate(template_path)
    context = build_template_context(template, content)
    context.update({"generated_at": datetime.now().isoformat(timespec="seconds")})
    template.render(context)
    template.save(out_path)
