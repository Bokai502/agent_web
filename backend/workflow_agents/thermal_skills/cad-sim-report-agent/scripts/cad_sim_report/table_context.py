from __future__ import annotations

from pathlib import Path
from typing import Any

from .block_specs import BlockSpec, DocxBlock, bullet, paragraph, render_spec_blocks
from .captioning import apply_captions, has_caption
from .common import fmt_num, get_nested, stat_file


CATCH_SUPPORT_HIDDEN_COLUMNS = {"稳态功耗（W）", "峰值功耗（W）", "工作温度（℃）", "配套单位"}


def section_items(llm_analysis: dict[str, Any], key: str) -> list[str]:
    sections = llm_analysis.get("report_sections")
    if not isinstance(sections, dict):
        raise RuntimeError("llm_analysis.json missing report_sections")
    value = sections.get(key)
    if not isinstance(value, list):
        raise RuntimeError(f"llm_analysis.json missing report section: {key}")
    items = [str(item).strip() for item in value if str(item).strip()]
    if not items:
        raise RuntimeError(f"llm_analysis.json missing report section: {key}")
    return items


def llm_paragraphs(llm_analysis: dict[str, Any], key: str) -> BlockSpec:
    return {"type": "paragraphs", "items": section_items(llm_analysis, key)}


def catch_support_table_blocks(data: dict[str, Any]) -> list[BlockSpec]:
    source = data.get("catch_support_table")
    if not isinstance(source, dict):
        return []
    if source.get("error"):
        return [{"type": "paragraph", "text": f"CATCH整星配套表读取失败：{source.get('error')}"}]
    if not source.get("exists"):
        return []
    headers = source.get("headers")
    rows = source.get("rows")
    if not isinstance(headers, list) or not isinstance(rows, list) or not headers:
        return []
    visible_indexes = [index for index, header in enumerate(headers) if str(header).strip() not in CATCH_SUPPORT_HIDDEN_COLUMNS]
    visible_headers = [headers[index] for index in visible_indexes]
    visible_rows = [[row[index] if index < len(row) else "" for index in visible_indexes] for row in rows if isinstance(row, list)]
    return [
        {"type": "table", "caption": "CATCH整星配套表", "headers": visible_headers, "rows": visible_rows},
    ]


def thermal_control_table_blocks(data: dict[str, Any]) -> list[BlockSpec]:
    source = data.get("thermal_control_table")
    if not isinstance(source, dict):
        return []
    headers = source.get("headers")
    rows = source.get("rows")
    if not isinstance(headers, list) or not isinstance(rows, list) or not rows:
        return []
    return [
        {"type": "table", "caption": "星上各仪器设备的热控指标", "headers": headers, "rows": rows},
    ]


def postprocess_image_specs(data: dict[str, Any]) -> list[BlockSpec]:
    render_summary = data["render_summary"] if isinstance(data["render_summary"], dict) else {}
    paraview_summary = data["paraview_summary"] if isinstance(data["paraview_summary"], dict) else {}
    grouped_outputs = get_nested(render_summary, ["paraview_summary", "outputs"], {}) or get_nested(paraview_summary, ["outputs"], {}) or {}
    if not grouped_outputs:
        return [{"type": "image_gallery", "caption": "后处理图片", "images": data["postprocess_images"]}]
    groups = [
        ("三维温度视图", "3d_views"),
        ("切片视图", "slices"),
        ("等值面视图", "contours"),
        ("体渲染视图", "volume"),
    ]
    return [{"type": "image_gallery", "caption": title, "images": [stat_file(Path(path)) for path in grouped_outputs.get(key) or []]} for title, key in groups]


def local_report_specs(data: dict[str, Any], llm_analysis: dict[str, Any]) -> dict[str, list[BlockSpec]]:
    model_spec: list[BlockSpec] = [
        llm_paragraphs(llm_analysis, "model_section"),
        {"type": "image_gallery", "caption": "FreeCAD 几何视图", "images": data["screenshots"]},
        *catch_support_table_blocks(data),
    ]
    thermal_spec: list[BlockSpec] = [
        llm_paragraphs(llm_analysis, "thermal_results_section"),
        *thermal_control_table_blocks(data),
    ]

    validity_spec: list[BlockSpec] = []
    cad_validation = data["cad_validation"]
    components = data["components"]
    if cad_validation.get("overlaps"):
        validity_spec.append({"type": "table", "headers": ["组件 A", "组件 B", "重叠体积（mm^3）"], "rows": [[item.get("a"), item.get("b"), fmt_num(item.get("volume_mm3"))] for item in cad_validation["overlaps"][:12]]})
    elif components["suspicious"]:
        validity_spec.append({"type": "table", "headers": ["组件", "原因", "尺寸"], "rows": [[item.get("component_id"), item.get("reason"), item.get("dims")] for item in components["suspicious"][:12]]})
    else:
        validity_spec.append({"type": "paragraph", "text": "根据现有元数据，未发现 CAD 重叠或可疑尺寸问题。"})
    validity_spec.append(llm_paragraphs(llm_analysis, "validity_section"))

    return {
        "model_section": model_spec,
        "validity_section": validity_spec,
        "thermal_results_section": thermal_spec,
        "temperature_images_section": [llm_paragraphs(llm_analysis, "temperature_images_section"), *postprocess_image_specs(data)],
        "conclusion_section": [llm_paragraphs(llm_analysis, "conclusion_section")],
    }


def build_docx_context(data: dict[str, Any], llm_analysis: dict[str, Any]) -> dict[str, Any]:
    context = {key: render_spec_blocks(spec, data) for key, spec in local_report_specs(data, llm_analysis).items()}
    append_required_blocks(context, data)
    return apply_captions(context)


def append_required_blocks(context: dict[str, list[DocxBlock]], data: dict[str, Any]) -> None:
    required = [
        ("model_section", "CATCH整星配套表", catch_support_table_blocks),
        ("thermal_results_section", "星上各仪器设备的热控指标", thermal_control_table_blocks),
    ]
    for section_key, caption, factory in required:
        blocks = render_spec_blocks(factory(data), data)
        if blocks and not has_caption(context[section_key], caption):
            context[section_key].extend(blocks)


def build_modification_context(llm_analysis: dict[str, Any]) -> dict[str, Any]:
    return {
        "modification_intro": [paragraph("以下修改建议根据报告章节分析生成，重点覆盖 CAD 几何、仿真设置、报告覆盖和复核步骤。")],
        "cad_suggestions": [bullet(item) for item in section_items(llm_analysis, "recommendations_section")],
        "simulation_suggestions": [bullet(item) for item in section_items(llm_analysis, "solver_section")],
        "report_suggestions": [bullet(item) for item in section_items(llm_analysis, "validity_section")],
        "validation_steps": [bullet(item, ordered=True) for item in section_items(llm_analysis, "conclusion_section")],
    }
