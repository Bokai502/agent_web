from __future__ import annotations

from typing import Any

from .report_schema import SECTION_CHAPTERS

DocxBlock = dict[str, Any]


def strip_caption_prefix(text: str) -> str:
    parts = text.strip().split(maxsplit=2)
    if len(parts) >= 3 and parts[0] in {"表", "图"} and "-" in parts[1]:
        return parts[2]
    return text.strip()


def has_caption(blocks: list[DocxBlock], caption: str) -> bool:
    return any(strip_caption_prefix(str(block.get("caption", ""))) == caption for block in blocks)


def apply_captions(context: dict[str, list[DocxBlock]]) -> dict[str, list[DocxBlock]]:
    table_counts: dict[int, int] = {}
    figure_counts: dict[int, int] = {}
    for section_key, blocks in context.items():
        chapter = SECTION_CHAPTERS.get(section_key)
        if chapter is None:
            continue
        for block in blocks:
            block_type = block.get("type")
            if block_type == "table":
                caption = strip_caption_prefix(str(block.get("caption", "")).strip())
                if caption:
                    table_counts[chapter] = table_counts.get(chapter, 0) + 1
                    block["caption"] = f"表 {chapter}-{table_counts[chapter]} {caption}"
            elif block_type == "image_gallery":
                caption = strip_caption_prefix(str(block.get("caption", "")).strip())
                if caption:
                    images = block.get("images")
                    image_count = len(images) if isinstance(images, list) else 1
                    captions: list[str] = []
                    for _ in range(max(image_count, 1)):
                        figure_counts[chapter] = figure_counts.get(chapter, 0) + 1
                        captions.append(f"图 {chapter}-{figure_counts[chapter]} {caption}")
                    block["caption"] = captions[0]
                    block["captions"] = captions
    return context
