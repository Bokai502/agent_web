from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

from . import checks
from .io_utils import read_text
from .llm import async_chat_completions
from .llm_classifier import LlmClassifierConfig


@dataclass(frozen=True)
class LlmReportConfig:
    mode: str = "llm"
    template_dir: Path | None = None


REPORT_STEPS = [
    ("step1_category_analysis.md", "二、 被评审元器件清单及信息"),
    ("step4_manufacturer_check.md", "（1）目录外器件审查"),
    ("step5_flight_history_check.md", "（2）应用经历审查"),
    ("step6_catalog_match_check.md", "（3）目录匹配结果审查"),
    ("step7_quality_compare_check.md", "（4）质量等级比较审查"),
    ("step9_reliability_query_check.md", "（6）质量问题与辐射效应数据库查询"),
]


def build_llm_report(
    title: str,
    artifacts: dict[str, Any],
    llm_config: LlmClassifierConfig,
    report_config: LlmReportConfig,
) -> tuple[str, dict[str, Any]]:
    mode = (report_config.mode or "llm").lower()
    if mode != "llm":
        raise ValueError(f"Unknown report mode: {mode}")
    if not llm_config.enabled:
        raise ValueError("LLM report generation requires base URL, API key, and model.")
    return _build_stepwise_report(title, artifacts, llm_config, report_config)


def _build_stepwise_report(
    title: str,
    artifacts: dict[str, Any],
    llm_config: LlmClassifierConfig,
    report_config: LlmReportConfig,
) -> tuple[str, dict[str, Any]]:
    payloads = []
    for template_name, heading in REPORT_STEPS:
        template = _read_template(report_config.template_dir, template_name)
        data = _step_data(template_name, artifacts)
        if template_name == "step1_category_analysis.md":
            continue
        payloads.append(
            {
                "template_name": template_name,
                "heading": heading,
                "data": data,
                "system_prompt": _section_system_prompt(template_name, heading, template),
                "user_prompt": _section_user_prompt(template_name, data),
                "max_tokens": _max_tokens_for(template_name),
            }
        )

    outcomes = _run_section_requests(llm_config, payloads)
    section_by_template: dict[str, str] = {
        "step1_category_analysis.md": _category_inventory_section(
            _step_data("step1_category_analysis.md", artifacts)
        )
    }
    generated_steps = []
    for payload, outcome in zip(payloads, outcomes):
        template_name = payload["template_name"]
        body = _clean_markdown(outcome)
        generated_steps.append(template_name)
        if template_name == "step4_manufacturer_check.md":
            body = _ensure_manufacturer_detail(body, payload["data"])
        elif template_name == "step5_flight_history_check.md":
            body = _ensure_flight_history_detail(body, payload["data"])
        elif template_name == "step6_catalog_match_check.md":
            body = _ensure_catalog_match_detail(body, payload["data"])
        elif template_name == "step7_quality_compare_check.md":
            body = _ensure_quality_compare_detail(body, payload["data"])
        elif template_name == "step9_reliability_query_check.md":
            body = _ensure_reliability_detail(body, payload["data"])
        section_by_template[template_name] = body

    lines = []
    title_page = _title_page(report_config.template_dir)
    if title_page:
        lines.extend([title_page, ""])
    lines.extend(_basic_info_section(artifacts))
    lines.append("")
    for index, (template_name, heading) in enumerate(REPORT_STEPS):
        body = section_by_template.get(template_name, "")
        body = _strip_duplicate_heading(body, heading)
        if index == 1:
            lines.extend(["# 三、 评审内容及审查要点", ""])
        lines.extend([_heading_prefix(heading), "", body.strip() or "No data.", ""])
    return "\n".join(lines).strip() + "\n", {
        "report_mode": "llm_stepwise",
        "used_llm": True,
        "template_dir": str(report_config.template_dir) if report_config.template_dir else None,
        "generated_steps": ["step1_category_analysis.md", *generated_steps],
    }



def _run_section_requests(llm_config: LlmClassifierConfig, payloads: list[dict[str, Any]]) -> list[str]:
    if not payloads:
        return []
    prompts = [
        {
            "system_prompt": payload["system_prompt"],
            "user_prompt": payload["user_prompt"],
            "max_tokens": payload["max_tokens"],
            "temperature": 0.1,
            "strip": False,
        }
        for payload in payloads
    ]
    outcomes = async_chat_completions(
        llm_config,
        prompts,
        return_exceptions=False,
        is_json=False,
    )
    return [str(outcome) for outcome in outcomes]


def _read_template(template_dir: Path | None, name: str) -> str:
    if not template_dir:
        return ""
    path = template_dir / name
    return read_text(path) if path.exists() else ""


def _title_page(template_dir: Path | None) -> str:
    if not template_dir:
        return ""
    path = template_dir / "report_title_page_template.md"
    if not path.exists():
        return ""
    today = date.today()
    report_date = f"{today.year}年{today.month}月{today.day}日"
    return read_text(path).replace("{REPORT_DATE}", report_date)


def _section_system_prompt(template_name: str, heading: str, template: str) -> str:
    return (
        "你是航天元器件选用报告编制专家。请只生成当前章节正文 Markdown，"
        "不得编造输入数据中不存在的事实。必须依据提供的步骤数据和模板要求，"
        "语言应正式、客观、接近《航天元器件选用报告》的审查语气。"
        "不要输出提示词说明，不要输出聊天式追问、服务推荐、下一步可协助事项、表情符号或营销式标题。"
        "章节重点顺序应先给审查依据或对象，再列问题清单，最后给风险评估和整改建议。\n\n"
        f"当前章节：{heading}\n"
        f"模板文件：{template_name}\n\n"
        "模板/写作要求：\n"
        f"{template}"
    )


def _section_user_prompt(template_name: str, data: dict[str, Any]) -> str:
    extra = ""
    if template_name == "step1_category_analysis.md":
        extra = "step1 的器件清单及分类表必须包含厂商和封装形式列；分类明细表也必须包含厂商和封装形式列。"
    elif template_name == "step4_manufacturer_check.md":
        extra = "目录外器件审查表只输出厂商名称、涉及元器件型号、元器件功能三类事实列，不要保留目录状态列。"
    elif template_name == "step7_quality_compare_check.md":
        extra = "质量等级比较结果表必须包含厂商和封装形式列，不得省略；分析建议按核心数据概览、不满足项典型特征分析、分级处置建议组织。"
    elif template_name == "step9_reliability_query_check.md":
        extra = "数据库查询章节必须包含统计、逐型号查询结果、质量问题风险、辐射效应风险和审查结论。"
    return (
        "请根据以下 JSON 数据生成本章节。"
        "若存在 rows/detail_rows，请优先保留必要表格；长表由程序兜底，分析文字应精炼。"
        "不得输出“已收到”“请告知”“可选后续操作”“下一步可协助事项”等聊天式内容。"
        f"{extra}\n"
        + json.dumps(data, ensure_ascii=False, indent=2, default=str)
    )


def _step_data(template_name: str, artifacts: dict[str, Any]) -> dict[str, Any]:
    load_inputs = artifacts.get("load_inputs") or {}
    base = {
        "component_count": load_inputs.get("component_count"),
        "requirement_doc": load_inputs.get("requirement_doc"),
        "component_list": load_inputs.get("component_list"),
    }
    if template_name == "step1_category_analysis.md":
        return {
            **base,
            "category_summary": artifacts.get("category_summary"),
            "classification_rows": _classification_rows(
                artifacts.get("component_classification") or [],
                load_inputs.get("components") or [],
            ),
        }
    if template_name == "step2_key_units_check.md":
        return {
            **base,
            "requirements": _requirement_by_name(artifacts, "关键"),
            "rows": artifacts.get("key_units_check") or [],
        }
    if template_name == "step3_quality_level_check.md":
        return {
            **base,
            "requirements": _requirement_by_name(artifacts, "质量"),
            "rows": artifacts.get("quality_level_check") or [],
        }
    if template_name == "step4_manufacturer_check.md":
        rows = artifacts.get("manufacturer_check") or []
        summary = checks.summarize_manufacturer_compliance(rows)
        components = load_inputs.get("components") or []
        return {
            **base,
            "rows": _manufacturer_attention_rows(rows, components),
            "summary": summary,
            "attention_rows": _manufacturer_attention_rows(summary["attention_rows"], components),
            "counting_rule": "生产厂商目录符合性检查中，目录外厂商和进口厂商均应纳入统计与清单。",
        }
    if template_name == "step5_flight_history_check.md":
        return {
            **base,
            "requirements": _requirement_by_name(artifacts, "飞行"),
            "rows": _flight_history_rows(artifacts.get("flight_history_check") or []),
        }
    if template_name == "step6_catalog_match_check.md":
        return {
            **base,
            "requirements": _requirement_by_name(artifacts, "选用"),
            "rows": checks.catalog_match_report_rows(artifacts.get("catalog_match") or []),
            "candidate_note": "完整候选匹配项已保留在 steps/catalog_match.json 的 candidates 字段中；本报告只使用 AI 自动推荐的最终结果。",
        }
    if template_name == "step7_quality_compare_check.md":
        return {
            **base,
            "requirements": _requirement_by_name(artifacts, "质量"),
            "rows": _quality_rows(
                artifacts.get("quality_level_check") or [],
                load_inputs.get("components") or [],
            ),
            "summary": _quality_summary(artifacts.get("quality_level_check") or []),
            "reliability_summary": _reliability_summary(artifacts.get("reliability_query") or []),
        }
    if template_name == "step9_reliability_query_check.md":
        rows = artifacts.get("reliability_query") or []
        return {**base, "summary": _reliability_summary(rows), "rows": _reliability_rows(rows)}
    return base


def _requirement_by_name(artifacts: dict[str, Any], keyword: str) -> list[dict[str, Any]]:
    rows = artifacts.get("requirements_analysis") or []
    return [row for row in rows if keyword in str(row.get("name", "")) or keyword in str(row.get("original_content", ""))]


def _basic_info_section(artifacts: dict[str, Any]) -> list[str]:
    requirements = artifacts.get("requirements_analysis") or []
    satellite_info = artifacts.get("satellite_info") or []
    quality_requirement = _requirement_exact(requirements, "质量等级要求") or _first_requirement_by_keyword(requirements, "质量")
    selection_requirement = _requirement_exact(requirements, "选用原则要求") or _first_requirement_by_keyword(requirements, "选用")
    radiation = [row for row in requirements if "辐射" in str(row.get("name", "")) or "辐射" in str(row.get("original_content", ""))]
    orbit_info = _satellite_evidence(satellite_info, "轨道")
    radiation_info = _satellite_evidence(satellite_info, "辐射")
    lines = ["# 一、 基本信息", "", "## (1) 型号基本情况", ""]
    if orbit_info:
        lines.append(_format_orbit_info(orbit_info))
    else:
        lines.append("根据输入任务信息开展元器件选用符合性审查；轨道、寿命、倾角等型号基本信息以型号设计文件为准。")
    if radiation_info:
        lines.extend(["", _format_radiation_info(radiation_info)])
    elif radiation:
        lines.extend(["", _format_radiation_info(_requirement_text(radiation[0]))])
    lines.extend(["", "## (2) 型号要求", ""])
    satellite_quality = _satellite_evidence(satellite_info, "质量等级")
    if satellite_quality:
        lines.append(_format_quality_requirement(satellite_quality))
    elif quality_requirement:
        lines.append(_format_quality_requirement(_requirement_text(quality_requirement)))
    else:
        lines.append("元器件选用应遵循先成熟产品后新品、先目录内后目录外原则，关键部位优先选用高质量等级元器件。")
    selection_text = _format_selection_requirement(_requirement_text(selection_requirement) if selection_requirement else "")
    if selection_text:
        lines.extend(["", selection_text])
    assurance = _satellite_evidence(satellite_info, "质保")
    if assurance:
        lines.extend(["", _format_assurance_requirement(assurance)])
    return lines


def _format_orbit_info(text: str) -> str:
    compact = _compact_text(text)
    altitude = _first_match(compact, r"轨道高度[为：:]?\s*([0-9.]+\s*km)")
    lifetime = _first_match(compact, r"寿命[为：:]?\s*([0-9.]+\s*年)")
    inclination = _first_match(compact, r"(?:倾角|轨道类型)[为：:]?\s*([0-9.]+°?)")
    parts = []
    if altitude:
        parts.append(f"轨道高度为{altitude.replace(' ', '')}")
    if lifetime:
        parts.append(f"寿命为{lifetime.replace(' ', '')}")
    if inclination:
        value = inclination if inclination.endswith("°") else f"{inclination}°"
        parts.append(f"倾角为{value}")
    if parts:
        return "卫星的" + "，".join(parts) + "。"
    return compact


def _format_radiation_info(text: str) -> str:
    compact = _compact_text(text)
    total_dose = _first_match(compact, r"(?:总剂量[^≥大]*)(?:≥|大于等于)\s*([0-9.]+\s*Krad\(si\))") or "30Krad(si)"
    sel = _first_match(compact, r"SEL[^≥大]*(?:≥|大于等于)\s*([0-9.]+\s*MeV·cm²/mg)") or "75 MeV·cm²/mg"
    seu = _first_match(compact, r"SEU[^≥大]*(?:≥|大于等于)\s*([0-9.]+\s*MeV·cm²/mg)") or "15 MeV·cm²/mg"
    return "\n".join(
        [
            "结合任务特点进行抗辐射分析与评估，必要时开展评估试验与加固设计。具体要求如下：",
            f"1. 抗总剂量：优先选用指标≥{total_dose.replace(' ', '')}的器件；未达优先值的须采取屏蔽防护、容差设计等加固措施。",
            f"2. 抗单粒子效应：抗SEL器件LET阈值优先≥{sel}；抗SEU数字逻辑器件LET阈值优先≥{seu}。未达优先值的需进行系统防护设计、评估审批，并设计检测防护电路。",
            "3. 抗位移损伤效应：针对CCD、光耦等敏感器件，须采取屏蔽防护、容差设计或冗余设计等措施，确保系统性能不下降。",
        ]
    )


def _format_quality_requirement(text: str) -> str:
    if not _compact_text(text):
        return ""
    return "\n".join(
        [
            "根据型号技术文件规定，卫星正样产品元器件质量等级要求如下：",
            "1. 国产元器件：关键、重要单机优先选用CASSM等级；无时可选用GJB、七专或相当及以上等级。一般、备份单机选用普军级或相当及以上等级。",
            "2. 进口元器件：须选用有相应飞行经历的工业级（优先军温、汽车级）及以上产品。",
            "3. 总体原则：按单机重要程度、设计需求及风险分析选型，卫星关键部位优先选用高质量等级元器件。",
        ]
    )


def _format_selection_requirement(text: str) -> str:
    if not _compact_text(text):
        return ""
    return (
        "选用原则：遵循“先成熟产品后新品、先目录内后目录外”原则；优先选用目录内及有飞行经历的器件；"
        "禁止选用已知不稳定或导致可靠性风险的器件，并严格核对禁限用规则。"
    )


def _format_assurance_requirement(text: str) -> str:
    if not _compact_text(text):
        return ""
    return "\n".join(
        [
            "质保：由可靠性中心统一实施元器件质保与评估，负责监制验收、补充筛选、DPA及超期复验，并统一开具装机合格证。",
            "补筛：正样器件委托可靠性中心进行目检、PIND、X光、声学扫描及板级应力筛选。总PDA≤20%，单项超规需专题分析，失效件必做失效分析。",
            "低等级：确需选用低于规定等级器件时，须承制单位申请、型号总师批准，并参照相关标准或型号条件制定专用筛选规范。",
            "首飞：型号要求优先选用有飞行经历与成熟产品；未明确飞行经历或首飞风险器件应按正样质保流程和等级管控要求闭环。",
        ]
    )


def _first_match(text: str, pattern: str) -> str:
    match = re.search(pattern, text, flags=re.IGNORECASE)
    return match.group(1).strip() if match else ""


def _compact_text(text: Any) -> str:
    return " ".join(str(text or "").split())


def _satellite_evidence(rows: list[dict[str, Any]], keyword: str) -> str:
    for row in rows:
        if keyword in str(row.get("item", "")):
            return str(row.get("evidence") or "").strip()
    return ""


def _requirement_text(row: dict[str, Any]) -> str:
    original = str(row.get("original_content") or "").strip()
    detail = str(row.get("detail") or "").strip()
    review = str(row.get("review") or "").strip()
    parts = [part for part in [detail, original, review] if part]
    return "\n\n".join(parts) if parts else "未提取到对应型号要求。"


def _requirement_exact(rows: list[dict[str, Any]], name: str) -> dict[str, Any] | None:
    for row in rows:
        if str(row.get("name") or "").strip() == name:
            return row
    return None


def _first_requirement_by_keyword(rows: list[dict[str, Any]], keyword: str) -> dict[str, Any] | None:
    for row in rows:
        if keyword in str(row.get("name", "")) or keyword in str(row.get("original_content", "")):
            return row
    return None


def _heading_prefix(heading: str) -> str:
    if heading.startswith("（"):
        return f"## {heading}"
    return f"# {heading}"


def _classification_rows(rows: list[dict[str, Any]], components: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    component_by_index = {item.get("index"): item for item in components or []}
    component_by_model = {item.get("model"): item for item in components or [] if item.get("model")}
    return [
        {
            "序号": row.get("index"),
            "元器件名称": row.get("component_name"),
            "型号规格": row.get("model"),
            "厂商": _fallback_value(row, component_by_index, component_by_model, "manufacturer"),
            "封装形式": _fallback_value(row, component_by_index, component_by_model, "package_type"),
            "国产/进口": _origin_from_component(_fallback_value(row, component_by_index, component_by_model, "manufacturer")),
            "类别": row.get("category_class"),
            "统一名称": row.get("category_name"),
            "分类来源": row.get("classification_source"),
        }
        for row in rows
    ]


def _category_inventory_section(data: dict[str, Any]) -> str:
    rows = data.get("classification_rows") or []
    lines = ["### 一、器件清单及分类", ""]
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        category_class = str(row.get("类别") or "未明确").strip() or "未明确"
        grouped.setdefault(category_class, []).append(_classification_display_row(row))

    for category in _category_order(grouped):
        lines.extend([f"**{category}元器件清单**", "", checks._table_report(grouped[category]), ""])

    stats = _category_origin_stats(rows)
    lines.extend(["### 二、国产/进口器件统计", "", checks._table_report(stats), ""])
    return "\n".join(lines).strip()


def _classification_display_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "序号": row.get("序号"),
        "统一名称": row.get("统一名称") or "未提供",
        "元器件名称": row.get("元器件名称") or "未提供",
        "型号规格": row.get("型号规格") or "未提供",
        "厂商": row.get("厂商") or "未提供",
        "封装形式": row.get("封装形式") or "未提供",
        "国产/进口": _origin_label(row.get("国产/进口")),
        "数量": row.get("数量") or 1,
    }


def _category_order(grouped: dict[str, list[dict[str, Any]]]) -> list[str]:
    preferred = ["I类", "II类", "III类", "IV类", "其他", "未明确"]
    ordered = [item for item in preferred if item in grouped]
    ordered.extend(sorted(key for key in grouped if key not in preferred))
    return ordered


def _category_origin_stats(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}
    models: dict[tuple[str, str], set[str]] = {}
    for row in rows:
        category = str(row.get("类别") or "未明确").strip() or "未明确"
        origin = _origin_label(row.get("国产/进口"))
        count = _safe_int(row.get("数量"), 1)
        grouped.setdefault(category, {"元器件类型": category, "国产数量": 0, "进口数量": 0, "未明确数量": 0, "合计数量": 0})
        key = "国产数量" if origin == "国产" else "进口数量" if origin == "进口" else "未明确数量"
        grouped[category][key] += count
        grouped[category]["合计数量"] += count
        model = str(row.get("型号规格") or row.get("元器件名称") or row.get("序号") or "").strip()
        models.setdefault((category, origin), set()).add(model)

    output = []
    for category in _category_order({key: [] for key in grouped}):
        stat = grouped[category]
        total = stat["合计数量"]
        domestic_count = stat["国产数量"]
        import_count = stat["进口数量"]
        output.append(
            {
                "元器件类型": category,
                "国产种类": len(models.get((category, "国产"), set())),
                "国产数量": domestic_count,
                "国产数量占比（%）": round(domestic_count * 100 / total, 1) if total else 0.0,
                "进口种类": len(models.get((category, "进口"), set())),
                "进口数量": import_count,
                "进口数量占比（%）": round(import_count * 100 / total, 1) if total else 0.0,
                "合计数量": total,
            }
        )
    return output


def _category_conclusion(stats: list[dict[str, Any]]) -> str:
    total = sum(_safe_int(row.get("合计数量"), 0) for row in stats)
    if not total:
        return "本次未获得可统计的元器件分类数据，后续应补充完整元器件清单后再开展分类统计。"
    top = max(stats, key=lambda row: _safe_int(row.get("合计数量"), 0))
    domestic = sum(_safe_int(row.get("国产数量"), 0) for row in stats)
    imported = sum(_safe_int(row.get("进口数量"), 0) for row in stats)
    return (
        f"本次被评审元器件共 {total} 项，{top['元器件类型']}数量最多，为 {top['合计数量']} 项。"
        f"其中国产器件 {domestic} 项、进口器件 {imported} 项。"
        "后续评审应重点关注进口器件、关键部位器件以及质量等级或目录状态不明确的器件。"
    )


def _origin_label(value: Any) -> str:
    if isinstance(value, bool):
        return "国产" if value else "进口"
    text = str(value or "").strip()
    if text.lower() == "true":
        return "国产"
    if text.lower() == "false":
        return "进口"
    return text or "未明确"


def _origin_from_component(manufacturer: Any) -> str:
    text = str(manufacturer or "").strip()
    if not text:
        return "未明确"
    foreign = {"ADI", "AD", "TI", "TMC", "ST", "MAXIM", "NSC", "NXP", "VISHAY", "ACTEL", "TDK", "LITTLEFUSE"}
    if text.lower() in {"interpoint"} or text.upper() in foreign:
        return "进口"
    return "国产"


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _fallback_value(
    row: dict[str, Any],
    component_by_index: dict[Any, dict[str, Any]],
    component_by_model: dict[Any, dict[str, Any]],
    field: str,
) -> Any:
    value = row.get(field)
    if value not in {None, ""}:
        return value
    component = component_by_index.get(row.get("index")) or component_by_model.get(row.get("model"))
    return component.get(field) if component else value


def _component_maps(components: list[dict[str, Any]]) -> tuple[dict[Any, dict[str, Any]], dict[Any, dict[str, Any]]]:
    return (
        {item.get("index"): item for item in components or []},
        {item.get("model"): item for item in components or [] if item.get("model")},
    )


def _manufacturer_attention_rows(rows: list[dict[str, Any]], components: list[dict[str, Any]]) -> list[dict[str, Any]]:
    models_by_manufacturer: dict[str, list[str]] = {}
    names_by_manufacturer: dict[str, list[str]] = {}
    for component in components:
        manufacturer = str(component.get("manufacturer") or "").strip()
        if not manufacturer:
            continue
        models_by_manufacturer.setdefault(manufacturer, [])
        names_by_manufacturer.setdefault(manufacturer, [])
        model = str(component.get("model") or "").strip()
        name = str(component.get("name") or "").strip()
        if model and model not in models_by_manufacturer[manufacturer]:
            models_by_manufacturer[manufacturer].append(model)
        if name and name not in names_by_manufacturer[manufacturer]:
            names_by_manufacturer[manufacturer].append(name)

    output = []
    for index, row in enumerate(rows, 1):
        manufacturer = str(row.get("厂商简称") or row.get("厂商名称") or row.get("manufacturer") or "").strip()
        origin = str(row.get("国产/进口") or row.get("origin") or "").strip()
        status = str(row.get("目录内或外") or row.get("目录状态") or "").strip()
        if status == "目录内" and origin != "进口":
            continue
        output.append(
            {
                "序号": index,
                "厂商名称": manufacturer or "未提供",
                "涉及元器件型号": "、".join(models_by_manufacturer.get(manufacturer, [])) or "未提供",
                "元器件功能": "、".join(names_by_manufacturer.get(manufacturer, [])) or "未提供",
                "关注原因": _manufacturer_attention_reason(status, origin),
            }
        )
    return output


def _manufacturer_attention_reason(status: str, origin: str) -> str:
    if origin == "进口":
        return "进口厂商，需关注供应链、追溯和进口合规风险"
    if status and status != "目录内":
        return "目录外厂商，需完成准入或专项评审"
    return "目录状态无法确认，需补充核查依据"


def _flight_history_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    output = []
    for row in rows:
        output.append(
            {
                "序号": row.get("index"),
                "元器件名称": row.get("component_name") or row.get("元器件名称"),
                "厂商名称": row.get("manufacturer") or row.get("厂商名称"),
                "元器件型号": row.get("model") or row.get("型号规格"),
                "元器件功能": row.get("component_name") or row.get("元器件功能"),
                "飞行经历/状态": row.get("flight_history") or row.get("飞行经历/状态"),
                "关注状态": row.get("status"),
            }
        )
    return output


def _quality_rows(rows: list[dict[str, Any]], components: list[dict[str, Any]]) -> list[dict[str, Any]]:
    component_by_index, component_by_model = _component_maps(components)
    output = []
    for row in rows:
        model = row.get("型号规格") or row.get("model")
        component = component_by_index.get(row.get("index")) or component_by_model.get(model) or {}
        output.append(
            {
                "序号": row.get("index"),
                "型号规格": model,
                "名称": row.get("名称") or row.get("component_name") or component.get("name"),
                "厂商": row.get("manufacturer") or component.get("manufacturer"),
                "封装形式": row.get("封装形式") or row.get("package_type") or component.get("package_type"),
                "质量等级": row.get("质量等级") or row.get("quality_level"),
                "关键部位": _yes_no(row.get("关键部位")),
                "国产/进口": row.get("国产/进口"),
                "是否满足要求": row.get("是否满足要求"),
                "问题说明": row.get("reason") or row.get("问题说明") or "",
            }
        )
    return output


def _quality_summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    total = len(rows)
    ok = sum(1 for row in rows if str(row.get("是否满足要求") or "").strip() in {"满足", "符合", "通过"})
    attention = total - ok
    key_attention = sum(
        1
        for row in rows
        if row.get("关键部位") is True and str(row.get("是否满足要求") or "").strip() not in {"满足", "符合", "通过"}
    )
    return {
        "total": total,
        "pass": ok,
        "attention": attention,
        "pass_rate": round(ok * 100 / total, 1) if total else 0.0,
        "key_attention": key_attention,
    }


def _reliability_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    output = []
    for row in rows:
        quality = row.get("quality", {}) if isinstance(row, dict) else {}
        radiation = row.get("radiation", {}) if isinstance(row, dict) else {}
        output.append(
            {
                "序号": row.get("index"),
                "元器件名称": row.get("component_name"),
                "型号规格": row.get("model"),
                "生产厂商": row.get("manufacturer"),
                "质量命中分级": _hit_label(quality),
                "质量问题摘要": _short_text(quality.get("answer", "") or "未检索到质量问题", 180),
                "辐射命中分级": _hit_label(radiation),
                "辐射效应摘要": _short_text(radiation.get("answer", "") or "未检索到辐射效应", 180),
            }
        )
    return output


def _hit_label(hit: dict[str, Any]) -> str:
    count = int(hit.get("count") or 0)
    if count <= 0:
        return "未命中"
    score = hit.get("score")
    label = hit.get("label") or hit.get("match_type") or "命中"
    return f"{label}({score}分)" if score not in {None, ""} else str(label)


def _yes_no(value: Any) -> str:
    if isinstance(value, bool):
        return "是" if value else "否"
    text = str(value or "").strip()
    if text.lower() == "true":
        return "是"
    if text.lower() == "false":
        return "否"
    return text or "未提供"


def _reliability_summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    quality_hits = 0
    radiation_hits = 0
    compact_rows = []
    for row in rows:
        quality = row.get("quality", {}) if isinstance(row, dict) else {}
        radiation = row.get("radiation", {}) if isinstance(row, dict) else {}
        q_count = int(quality.get("count") or 0)
        r_count = int(radiation.get("count") or 0)
        quality_hits += 1 if q_count else 0
        radiation_hits += 1 if r_count else 0
        compact_rows.append(
            {
                "序号": row.get("index"),
                "名称": row.get("component_name"),
                "型号": row.get("model"),
                "厂商": row.get("manufacturer"),
                "质量命中": q_count,
                "辐射命中": r_count,
                "质量摘要": _short_text(quality.get("answer", ""), 120),
                "辐射摘要": _short_text(radiation.get("answer", ""), 120),
            }
        )
    return {
        "total_components": len(rows),
        "components_with_quality_hits": quality_hits,
        "components_with_radiation_hits": radiation_hits,
        "rows": compact_rows,
    }


def _ensure_classification_detail(body: str, data: dict[str, Any]) -> str:
    rows = data.get("classification_rows") or []
    if not rows:
        return body
    detail = "### 元器件分类明细\n\n" + checks._table_report(rows)
    pattern = r"(?:\n\n)?###\s*元器件分类明细\s*\n.*?(?=\n###\s|\n##\s|\Z)"
    if re.search(pattern, body, flags=re.DOTALL):
        return re.sub(pattern, "\n\n" + detail, body, count=1, flags=re.DOTALL).strip()
    return body.rstrip() + "\n\n" + detail


def _ensure_manufacturer_detail(body: str, data: dict[str, Any]) -> str:
    rows = data.get("rows") or data.get("attention_rows") or []
    if not rows:
        return body
    table_rows = [
        {
            "序号": index,
            "厂商名称": row.get("厂商名称") or row.get("manufacturer") or "未提供",
            "涉及元器件型号": row.get("涉及元器件型号") or "未提供",
            "元器件功能": row.get("元器件功能") or "未提供",
        }
        for index, row in enumerate(rows, 1)
    ]
    detail = "\n\n".join(
        [
            "根据需求文件要求，元器件生产厂商应满足以下标准：",
            str(data.get("counting_rule") or "生产厂商目录符合性检查中，目录外厂商和进口厂商均应纳入统计与清单。"),
            "以下厂商不在《选用目录》范围内或属于进口厂商，应纳入本节统计和关注：",
            checks._table_report(table_rows),
            "**风险评估：**",
            _extract_bold_block(body, "风险评估") or _default_manufacturer_risk(data),
            "**整改建议：**",
            _extract_bold_block(body, "整改建议") or _default_manufacturer_actions(),
        ]
    )
    pattern = r"根据需求文件要求，元器件生产厂商应满足以下标准：.*?(?=\n##\s|\Z)"
    if re.search(pattern, body, flags=re.DOTALL):
        return re.sub(pattern, detail, body, count=1, flags=re.DOTALL).strip()
    return detail


def _ensure_flight_history_detail(body: str, data: dict[str, Any]) -> str:
    rows = data.get("rows") or []
    if not rows:
        return body
    attention_rows = [
        row for row in rows
        if str(row.get("关注状态") or row.get("status") or "").strip() not in {"通过", "满足", "符合"}
    ]
    if not attention_rows:
        attention_rows = rows
    table_rows = [
        {
            "序号": row.get("序号") or index,
            "元器件名称": row.get("元器件名称") or "未提供",
            "厂商名称": row.get("厂商名称") or "未提供",
            "元器件型号": row.get("元器件型号") or "未提供",
            "元器件功能": row.get("元器件功能") or row.get("元器件名称") or "未提供",
        }
        for index, row in enumerate(attention_rows, 1)
    ]
    missing = [
        row for row in attention_rows
        if str(row.get("飞行经历/状态") or "").strip() in {"", "未填写", "无", "未知", "未提供"}
    ]
    imported = sum(1 for row in attention_rows if str(row.get("国产/进口") or "").strip() == "进口")
    detail = "\n\n".join(
        [
            "根据型号技术要求，元器件飞行经历与状态应满足以下标准：",
            "进口元器件须具备相应飞行经历或成熟工程验证记录；国产元器件优先选用有飞行验证记录和可靠性数据的产品。首飞、无明确飞行经历、目录外或状态不明确器件应完成专项评审和验证闭环。",
            "以下元器件为首飞、无明确飞行经历或需重点关注的元器件：",
            checks._table_report(table_rows),
            _flight_history_note(rows, attention_rows, missing, imported),
            "针对不符合项，提出以下整改建议：",
            "1. 对飞行经历未填写或状态不明确的器件，补充具体应用验证报告、鉴定试验数据或专项评审结论。",
            "2. 对关键部位使用的进口器件，核实其是否满足相应飞行经历要求；无法提供证明时，应提出替代选型或风险接受审批。",
            "3. 对目录外、低等级或批量使用器件，完善质量追溯、筛选试验和后续批次状态管控。",
        ]
    )
    pattern = r"根据型号技术要求，元器件飞行经历与状态应满足以下标准：.*?(?=\n##\s|\Z)"
    if re.search(pattern, body, flags=re.DOTALL):
        return re.sub(pattern, detail, body, count=1, flags=re.DOTALL).strip()
    return detail


def _flight_history_note(
    rows: list[dict[str, Any]],
    attention_rows: list[dict[str, Any]],
    missing: list[dict[str, Any]],
    imported: int,
) -> str:
    if not attention_rows:
        return "未发现首飞、无明确飞行经历或需重点关注的元器件。"
    missing_models = "、".join(str(row.get("元器件型号") or "") for row in missing[:8] if row.get("元器件型号"))
    note = (
        f"注：本次应用经历审查共覆盖 {len(rows)} 项元器件，需关注 {len(attention_rows)} 项，"
        f"其中进口器件 {imported} 项。"
    )
    if missing_models:
        note += f"飞行经历未填写或状态不明确的典型型号包括：{missing_models}。"
    else:
        note += "未发现明确标识为首飞的元器件，但需关注项仍应补齐应用经历证明和评审记录。"
    return note


def _ensure_catalog_match_detail(body: str, data: dict[str, Any]) -> str:
    rows = data.get("rows") or []
    if not rows:
        return body
    summary = _catalog_summary(rows)
    detail_rows = [_catalog_display_row(row) for row in rows]
    table = "### 目录匹配最终结果表\n\n" + checks._table_report(detail_rows)
    analysis = _extract_section(body, "分析与建议") or _default_catalog_analysis(summary)
    observations = _catalog_observations(summary)
    detail = "\n\n".join(
        [
            "经审查，本型号元器件目录匹配情况如下：",
            table,
            "### 分析与建议",
            analysis.strip(),
            "### 核心观察",
            checks._table_report(observations),
        ]
    )
    pattern = r"经审查，本型号元器件目录匹配情况如下：.*?(?=\n##\s|\Z)"
    if re.search(pattern, body, flags=re.DOTALL):
        return re.sub(pattern, detail, body, count=1, flags=re.DOTALL).strip()
    return detail


def _ensure_quality_compare_detail(body: str, data: dict[str, Any]) -> str:
    rows = data.get("rows") or []
    if not rows:
        return body
    summary = data.get("summary") or {}
    table = "### 质量等级比较结果表\n\n" + checks._table_report(rows)
    analysis = _quality_analysis_detail(rows, summary, _extract_section(body, "分析与建议"))
    detail = "\n\n".join([
        "经审查，本型号元器件质量等级符合性情况如下：",
        table,
        "### 分析与建议",
        analysis,
    ])
    pattern = r"经审查，本型号元器件质量等级符合性情况如下：.*?(?=\n##\s|\Z)"
    if re.search(pattern, body, flags=re.DOTALL):
        return re.sub(pattern, detail, body, count=1, flags=re.DOTALL).strip()
    return detail


def _ensure_reliability_detail(body: str, data: dict[str, Any]) -> str:
    rows = data.get("rows") or []
    summary = data.get("summary") or {}
    if not rows:
        return body
    stats = "\n".join([
        "### 可靠性数据库查询统计",
        "",
        f"- 查询型号数：{summary.get('total_components', len(rows))}",
        f"- 命中质量问题型号数：{summary.get('components_with_quality_hits', 0)}",
        f"- 命中辐射效应型号数：{summary.get('components_with_radiation_hits', 0)}",
    ])
    table = "### 逐型号查询结果\n\n" + checks._table_report(rows)
    analysis = _reliability_analysis_detail(rows, summary, _extract_section(body, "AI 分析与建议"))
    detail = "\n\n".join([stats, table, "### AI 分析与建议", analysis])
    pattern = r"###\s*可靠性数据库查询统计.*?(?=\n##\s|\Z)"
    if re.search(pattern, body, flags=re.DOTALL):
        return re.sub(pattern, detail, body, count=1, flags=re.DOTALL).strip()
    return detail


def _extract_section(body: str, heading: str) -> str:
    pattern = rf"###\s*{re.escape(heading)}\s*\n(.*?)(?=\n###\s|\n##\s|\Z)"
    match = re.search(pattern, body, flags=re.DOTALL)
    return match.group(1).strip() if match else ""


def _extract_bold_block(body: str, label: str) -> str:
    pattern = rf"\*\*{re.escape(label)}：?\*\*\s*\n(.*?)(?=\n\*\*[^*\n]+：?\*\*|\n###\s|\n##\s|\Z)"
    match = re.search(pattern, body, flags=re.DOTALL)
    return match.group(1).strip() if match else ""


def _catalog_summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    total = len(rows)
    in_count = 0
    out_count = 0
    unknown_count = 0
    imported_count = 0
    domestic_count = 0
    for row in rows:
        status = str(row.get("目录匹配状态") or row.get("is_in_catalog") or row.get("状态") or "").strip()
        origin = str(row.get("国产/进口") or "").strip()
        if origin == "进口":
            imported_count += 1
        elif origin == "国产":
            domestic_count += 1
        if status == "目录内":
            in_count += 1
        elif status in {"目录外", "无"}:
            out_count += 1
        else:
            unknown_count += 1
    return {
        "total": total,
        "in": in_count,
        "out": out_count,
        "unknown": unknown_count,
        "imported": imported_count,
        "domestic": domestic_count,
        "match_rate": round(in_count * 100 / total, 1) if total else 0.0,
    }


def _catalog_display_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "序号": row.get("序号") or row.get("index"),
        "清单型号": row.get("清单型号") or row.get("list_model"),
        "清单厂商": row.get("清单厂商") or row.get("list_manufacturer"),
        "目录型号": row.get("目录型号") or row.get("catalog_model") or "",
        "目录厂商": row.get("目录厂商") or row.get("catalog_manufacturer") or "",
        "状态": row.get("目录匹配状态") or row.get("is_in_catalog") or row.get("状态") or "无法确认",
    }


def _catalog_observations(summary: dict[str, Any]) -> list[dict[str, str]]:
    total = summary.get("total", 0)
    return [
        {
            "维度": "匹配状态",
            "说明": (
                f"共检查 {total} 项，目录内 {summary.get('in', 0)} 项，目录外 {summary.get('out', 0)} 项，"
                f"无法确认 {summary.get('unknown', 0)} 项，匹配率 {summary.get('match_rate', 0.0)}%。"
            ),
        },
        {
            "维度": "型号匹配策略",
            "说明": "以输入中的最终匹配结果为准；未提供目录型号或状态为无、未提供目录的条目均需补充目录依据或人工复核。",
        },
        {
            "维度": "厂商名称对齐",
            "说明": "重点核查厂商简称、全称、历史名称和目录登记名称的一致性，避免因名称差异造成误判。",
        },
        {
            "维度": "数据一致性",
            "说明": "目录匹配结论应与质量等级、飞行经历、生产厂商目录审查结论保持一致，并形成可追溯记录。",
        },
    ]


def _default_catalog_analysis(summary: dict[str, Any]) -> str:
    total = summary.get("total", 0)
    return (
        f"本次目录匹配共覆盖 {total} 项元器件，目录内 {summary.get('in', 0)} 项，"
        f"目录外 {summary.get('out', 0)} 项，无法确认 {summary.get('unknown', 0)} 项。"
        "目录外或无法确认器件需按“先目录内后目录外”原则补充选用依据；进口器件应同步核查飞行经历、"
        "采购合规和替代方案；国产器件应补齐目录型号、目录厂商及准入证明。"
    )


def _default_manufacturer_risk(data: dict[str, Any]) -> str:
    rows = data.get("rows") or data.get("attention_rows") or []
    summary = data.get("summary") or {}
    total = summary.get("total_manufacturers", 0)
    attention = len(rows)
    return (
        f"本次生产厂商目录符合性检查共覆盖 {total or attention} 家厂商，需关注厂商 {attention} 家。"
        "目录外或进口厂商可能带来供货连续性、批次追溯、质量一致性和进口合规风险，"
        "应结合器件关键程度、替代性和历史应用情况完成专项确认。"
    )


def _default_manufacturer_actions() -> str:
    return (
        "1. 对目录外厂商补充准入依据、质量保证能力证明和专项评审结论。\n"
        "2. 对进口厂商器件补充采购合规、批次追溯、供货保障和替代方案论证。\n"
        "3. 对涉及关键部位或低等级质量风险的器件优先开展替代选型或加严筛选。"
    )


def _default_quality_analysis(summary: dict[str, Any]) -> str:
    total = summary.get("total", 0)
    passed = summary.get("pass", 0)
    attention = summary.get("attention", 0)
    rate = summary.get("pass_rate", 0.0)
    key_attention = summary.get("key_attention", 0)
    return (
        f"本次质量等级比较共覆盖 {total} 项元器件，满足要求 {passed} 项，不符合或需关注 {attention} 项，"
        f"符合率为 {rate}%。其中关键部位需关注项 {key_attention} 项，应优先完成等级等效性论证、"
        "飞行经历确认、补充筛选或替代选型。对进口工业级、Standard、Q级等器件，应补充与型号要求的"
        "适用性证明；对国产低等级或等级边界不明确器件，应结合单机重要程度完成专项评审。"
    )


def _quality_analysis_detail(rows: list[dict[str, Any]], summary: dict[str, Any], llm_analysis: str = "") -> str:
    overview = [
        {"指标": "检查总数", "数量": summary.get("total", len(rows)), "说明": "纳入质量等级比较的元器件数量"},
        {"指标": "满足要求", "数量": summary.get("pass", 0), "说明": "判定为满足、符合或通过的元器件"},
        {"指标": "不满足或需关注", "数量": summary.get("attention", 0), "说明": "不满足、需关注、无法确认或等级边界不明确的元器件"},
        {"指标": "关键部位风险", "数量": summary.get("key_attention", 0), "说明": "关键部位中不满足或需关注的元器件"},
        {"指标": "符合率", "数量": f"{summary.get('pass_rate', 0.0)}%", "说明": "满足要求数量/检查总数"},
    ]
    attention_rows = [row for row in rows if str(row.get("是否满足要求") or "").strip() not in {"满足", "符合", "通过"}]
    imported_attention = sum(1 for row in attention_rows if row.get("国产/进口") == "进口")
    domestic_attention = sum(1 for row in attention_rows if row.get("国产/进口") == "国产")
    key_models = "、".join(str(row.get("型号规格")) for row in attention_rows if row.get("关键部位") == "是") or "无"
    return "\n\n".join(
        [
            _default_quality_analysis(summary),
            "### 一、核心数据概览",
            checks._table_report(overview),
            "### 二、不满足项典型特征分析",
            (
                f"不满足或需关注项中，进口器件 {imported_attention} 项，国产器件 {domestic_attention} 项。"
                f"关键部位需关注型号包括：{key_models}。进口工业级、Standard、Q级器件应重点核实飞行经历、"
                "温度等级、批次追溯和抗辐照适用性；国产GJB、普军或等级边界不明确器件应结合单机重要程度完成等效性论证。"
            ),
            "### 三、分级处置建议",
            (
                "1. 对关键部位且质量等级需关注的器件，优先开展替代选型或组织专项评审。\n"
                "2. 对进口器件补充飞行经历、采购合规、筛选试验和质量一致性证明。\n"
                "3. 对国产低等级或等级边界不清的器件，补充等级等效性说明、加严筛选或可靠性验证记录。"
            ),
        ]
    )


def _reliability_analysis_detail(rows: list[dict[str, Any]], summary: dict[str, Any], llm_analysis: str = "") -> str:
    total = summary.get("total_components", len(rows))
    quality_hits = summary.get("components_with_quality_hits", 0)
    radiation_hits = summary.get("components_with_radiation_hits", 0)
    no_hits = max(total - len([row for row in rows if _has_hit(row.get("quality", {})) or _has_hit(row.get("radiation", {}))]), 0)
    quality_rows = _risk_rows(rows, "quality")
    radiation_rows = _risk_rows(rows, "radiation")
    return "\n\n".join(
        [
            "### 一、总体概况",
            "\n".join(
                [
                    f"- 查询总量：{total} 型",
                    f"- 质量问题命中：{quality_hits} 型",
                    f"- 辐射效应命中：{radiation_hits} 型",
                    f"- 未命中记录：{no_hits} 型",
                ]
            ),
            "### 二、质量问题风险概括",
            checks._table_report(quality_rows)
            if quality_rows
            else "本次数据库查询未检索到质量问题命中记录。未命中不等同于无风险，仍需结合批次追溯、筛选试验和来料验收结果进行确认。",
            "### 三、辐射效应风险概括",
            checks._table_report(radiation_rows)
            if radiation_rows
            else "本次数据库查询未检索到辐射效应命中记录。后续仍应结合任务轨道、寿命和屏蔽条件开展总剂量、SEL/SEU裕度评估。",
            "### 四、审查结论",
            _default_reliability_analysis(summary),
        ]
    )


def _risk_rows(rows: list[dict[str, Any]], key: str) -> list[dict[str, Any]]:
    label_name = "质量问题摘要" if key == "quality" else "辐射效应摘要"
    output = []
    for row in rows:
        hit = row.get(key, {}) if isinstance(row, dict) else {}
        if not _has_hit(hit):
            continue
        output.append(
            {
                "涉及型号": row.get("model"),
                "生产厂商": row.get("manufacturer"),
                "命中分级": _hit_label(hit),
                label_name: _short_text(hit.get("answer", ""), 180),
            }
        )
    return output


def _has_hit(hit: dict[str, Any]) -> bool:
    return int(hit.get("count") or 0) > 0


def _default_reliability_analysis(summary: dict[str, Any]) -> str:
    quality_hits = summary.get("components_with_quality_hits", 0)
    radiation_hits = summary.get("components_with_radiation_hits", 0)
    if quality_hits or radiation_hits:
        return (
            f"数据库查询发现质量问题命中 {quality_hits} 项、辐射效应命中 {radiation_hits} 项。"
            "应对直接命中和强参考命中型号优先开展批次追溯、DPA/声扫等加严验证；对辐射效应命中型号，"
            "结合任务轨道和寿命进行总剂量、SEL/SEU 裕度核算。"
        )
    return (
        "本次数据库查询未检索到明确质量问题或辐射效应命中记录。未命中不等同于无风险，后续仍需结合"
        "来料批次、飞行经历、筛选试验、DPA 以及任务辐射环境完成闭环确认。"
    )


def _clean_markdown(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:markdown|md)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text)
    text = _remove_chatty_sections(text)
    text = re.sub(r"[📊🔍🛠️📝💡✅❌⚠️🔴🟡🟢📥🧩]", "", text)
    text = re.sub(r"^已收到.*?\n", "", text, flags=re.MULTILINE)
    return text.strip()


def _remove_chatty_sections(text: str) -> str:
    section_patterns = [
        "可选后续操作",
        "下一步可协助事项",
        "下一步需求",
        "可协助事项",
    ]
    for heading in section_patterns:
        text = re.sub(rf"\n###\s*.*{heading}.*?(?=\n###\s|\n##\s|\Z)", "", text, flags=re.DOTALL)
    text = re.sub(r"\n请告知.*?(?=\n|$)", "", text)
    text = re.sub(r"\n如需.*?(?=\n|$)", "", text)
    return text


def _strip_duplicate_heading(body: str, heading: str) -> str:
    lines = body.splitlines()
    while lines and not lines[0].strip():
        lines.pop(0)
    normalized_heading = _normalize_heading_text(heading)
    if lines and _normalize_heading_text(lines[0]) == normalized_heading:
        lines.pop(0)
    elif lines and heading.startswith("二、") and _normalize_heading_text(lines[0]) in {
        "被评审元器件清单及信息",
        "元器件分类统计分析",
    }:
        lines.pop(0)
    while lines and not lines[0].strip():
        lines.pop(0)
    return "\n".join(lines).strip()


def _normalize_heading_text(value: str) -> str:
    return value.lstrip("# ").replace(" ", "").strip()


def _short_text(value: Any, limit: int) -> str:
    text = str(value or "").replace("\n", " ").strip()
    return text[:limit] + "..." if len(text) > limit else text


def _max_tokens_for(template_name: str) -> int:
    if template_name == "step1_category_analysis.md":
        return 6000
    return 2500


