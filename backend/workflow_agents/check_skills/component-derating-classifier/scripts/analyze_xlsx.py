#!/usr/bin/env python3
"""Analyze component derating data from a Table 5 XLSX file."""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

from xlsx_to_json import convert_xlsx_to_json


SKILL_DIR = Path(__file__).resolve().parents[1]
DEFAULT_REFERENCE = SKILL_DIR / "reference" / "jiange_full.json"
DEFAULT_RULES = SKILL_DIR / "reference" / "rules.md"
DEFAULT_OUTPUT_DIR = SKILL_DIR / "outputs"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Analyze a component derating XLSX file.")
    parser.add_argument("xlsx_path", type=Path, help="Input .xlsx file path.")
    parser.add_argument("--reference", type=Path, default=DEFAULT_REFERENCE)
    parser.add_argument("--rules", type=Path, default=DEFAULT_RULES)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument(
        "--ai-mapping",
        type=Path,
        help=(
            "JSON file produced by the skill/AI. It supplies component subclass "
            "selections and derating parameter-to-standard-parameter matches."
        ),
    )
    return parser.parse_args()


def normalize(value) -> str:
    return re.sub(r"\s+", "", str(value or "")).strip()


def parse_number(value) -> float | None:
    if value is None:
        return None
    match = re.search(r"-?\d+(?:\.\d+)?(?:[Ee][+-]?\d+)?", str(value).replace(",", ""))
    return float(match.group(0)) if match else None


def is_level_i(value) -> bool:
    text = normalize(value).upper().replace("Ⅰ", "I").replace("Ⅱ", "II").replace("Ⅲ", "III")
    return text == "I"


def load_reference(path: Path) -> list[dict]:
    rows = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(rows, list):
        raise SystemExit(f"Reference JSON root must be a list: {path}")
    return [row for row in rows if isinstance(row, dict)]


def load_ai_mapping(path: Path | None) -> dict:
    if path is None:
        return {
            "enabled": False,
            "components": {},
            "parameters": {},
            "global_parameters": {},
        }

    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(payload, dict):
        raise SystemExit(f"AI mapping JSON root must be an object: {path}")

    components = {}
    for item in payload.get("components", []):
        if not isinstance(item, dict):
            continue
        name = item.get("元器件名称")
        if name:
            components[str(name)] = item

    parameters = {}
    global_parameters = {}
    for item in payload.get("parameter_matches", []):
        if not isinstance(item, dict):
            continue
        source = item.get("降额参数")
        target = item.get("标准参数")
        if not source or not target:
            continue
        component_name = item.get("元器件名称")
        if component_name:
            parameters[(str(component_name), normalize(source))] = item
        else:
            global_parameters[normalize(source)] = item

    return {
        "enabled": True,
        "components": components,
        "parameters": parameters,
        "global_parameters": global_parameters,
    }


def rows_for_subclass(reference_rows: list[dict], subclass: str) -> list[dict]:
    return [row for row in reference_rows if row.get("元器件子类") == subclass]


def classify_component(name: str, reference_rows: list[dict], ai_mapping: dict) -> dict:
    subclasses = {row.get("元器件子类") for row in reference_rows}
    mapped = ai_mapping["components"].get(name)

    if mapped and mapped.get("元器件子类") in subclasses:
        subclass = mapped["元器件子类"]
        info = rows_for_subclass(reference_rows, subclass)
        categories = sorted({row.get("元器件大类") for row in info if row.get("元器件大类")})
        return {
            "matched": True,
            "元器件大类": mapped.get("元器件大类")
            or (categories[0] if len(categories) == 1 else categories),
            "元器件子类": subclass,
            "confidence": mapped.get("confidence", "medium"),
            "match_method": mapped.get("match_method", "ai"),
            "selection_reason": mapped.get("selection_reason", "AI selected this subclass."),
            "information": info,
        }

    if mapped:
        return {
            "matched": False,
            "元器件大类": mapped.get("元器件大类"),
            "元器件子类": mapped.get("元器件子类"),
            "confidence": mapped.get("confidence", "low"),
            "match_method": "invalid_ai_mapping",
            "selection_reason": "AI mapping selected a subclass that is not present in reference/jiange_full.json.",
            "information": [],
        }

    return {
        "matched": False,
        "元器件大类": None,
        "元器件子类": None,
        "confidence": "low",
        "match_method": "unmatched",
        "selection_reason": "未找到可靠的元器件子类匹配。",
        "information": [],
    }


def find_standard(row: dict, classification: dict, ai_mapping: dict) -> dict | None:
    component_name = str(row.get("元器件名称") or "")
    parameter = normalize(row.get("降额参数"))
    mapped = ai_mapping["parameters"].get((component_name, parameter))
    mapped = mapped or ai_mapping["global_parameters"].get(parameter)

    if ai_mapping["enabled"] and not mapped:
        return None

    wanted = normalize(mapped.get("标准参数")) if mapped else parameter

    for candidate in classification.get("information") or []:
        candidate_param = normalize(candidate.get("降额参数"))
        if candidate_param == wanted:
            return candidate

    if ai_mapping["enabled"]:
        return None

    for candidate in classification.get("information") or []:
        candidate_param = normalize(candidate.get("降额参数"))
        if parameter and (parameter in candidate_param or candidate_param in parameter):
            return candidate

    return None


def check_row(row: dict, excel_row: int, classification: dict, ai_mapping: dict) -> dict:
    standard = find_standard(row, classification, ai_mapping) if classification.get("matched") else None
    issues: list[str] = []
    hard_fail = False
    stricter = False

    standard_factor = parse_number(standard.get("I级降额")) if standard else None
    required_factor = parse_number(row.get("降额因子_规定"))
    actual_factor = parse_number(row.get("降额因子_实际"))
    rated_value = parse_number(row.get("参数值_额定"))
    allowed_value = parse_number(row.get("参数值_允许"))
    actual_value = parse_number(row.get("参数值_实际"))
    expected_allowed = rated_value * standard_factor if rated_value is not None and standard_factor is not None else None
    calculated_actual_factor = (
        actual_value / rated_value
        if actual_value is not None and rated_value not in (None, 0)
        else None
    )

    if not classification.get("matched"):
        issues.append("未匹配到元器件分类。")
    if not standard:
        issues.append("未找到对应的标准降额参数。")
    if not is_level_i(row.get("降额等级")):
        issues.append("降额等级不是 I 级。")

    if standard_factor is not None and required_factor is not None:
        if abs(required_factor - standard_factor) > 1e-9:
            if required_factor < standard_factor:
                stricter = True
                issues.append("规定降额因子小于 I 级标准值，属于更严格填写。")
            else:
                hard_fail = True
                issues.append("规定降额因子大于 I 级标准值。")
    elif standard and required_factor is None:
        issues.append("规定降额因子无法提取数值。")

    if expected_allowed is not None and allowed_value is not None:
        tolerance = max(1e-9, abs(expected_allowed) * 0.02)
        if abs(allowed_value - expected_allowed) > tolerance:
            hard_fail = True
            issues.append("允许值不等于额定值乘以 I 级规定降额因子。")

    if actual_value is not None and allowed_value is not None and actual_value > allowed_value:
        hard_fail = True
        issues.append("实际值大于允许值。")

    if actual_factor is not None and required_factor is not None and actual_factor > required_factor:
        hard_fail = True
        issues.append("实际降额因子大于规定降额因子。")

    if "温" in normalize(row.get("降额参数")) and actual_value is not None and actual_value > 85:
        hard_fail = True
        issues.append("温度相关实际值超过 85 deg C。")

    if hard_fail:
        status = "不符合"
    elif stricter:
        status = "更严格"
    elif issues:
        status = "需人工确认"
    else:
        status = "符合"

    return {
        "excel_row": excel_row,
        **row,
        "元器件大类": classification.get("元器件大类"),
        "元器件子类": classification.get("元器件子类"),
        "分类方式": classification.get("match_method"),
        "标准参数": standard.get("降额参数") if standard else None,
        "标准I级降额": standard.get("I级降额") if standard else None,
        "计算允许值": expected_allowed,
        "计算实际降额因子": calculated_actual_factor,
        "符合性": status,
        "问题": issues,
    }


def main() -> int:
    args = parse_args()
    xlsx_path = args.xlsx_path.expanduser().resolve()
    reference_path = args.reference.expanduser().resolve()
    rules_path = args.rules.expanduser().resolve()
    ai_mapping_path = args.ai_mapping.expanduser().resolve() if args.ai_mapping else None
    output_dir = args.output_dir.expanduser().resolve()

    for required_path, label in [
        (xlsx_path, "input XLSX"),
        (reference_path, "reference JSON"),
        (rules_path, "rules markdown"),
    ]:
        if not required_path.exists():
            raise SystemExit(f"Missing {label}: {required_path}")
    if ai_mapping_path and not ai_mapping_path.exists():
        raise SystemExit(f"Missing AI mapping JSON: {ai_mapping_path}")

    output_dir.mkdir(parents=True, exist_ok=True)

    stem = xlsx_path.stem
    table_path = output_dir / f"{stem}_table.json"
    classification_path = output_dir / f"{stem}_classification.json"
    result_path = output_dir / f"{stem}_check_result.json"

    table = convert_xlsx_to_json(xlsx_path, table_path)
    reference_rows = load_reference(reference_path)
    ai_mapping = load_ai_mapping(ai_mapping_path)

    groups = defaultdict(lambda: {"rows": [], "models": set(), "params": set()})
    for row in table["data"]:
        name = str(row.get("元器件名称") or "")
        groups[name]["rows"].append(row)
        groups[name]["models"].add(str(row.get("型号规格_规格") or ""))
        groups[name]["params"].add(str(row.get("降额参数") or ""))

    classifications = {}
    components = []
    for name, group in groups.items():
        classification = classify_component(name, reference_rows, ai_mapping)
        component = {
            "元器件名称": name,
            "row_count": len(group["rows"]),
            "sample_models": sorted(model for model in group["models"] if model)[:5],
            "降额参数": sorted(param for param in group["params"] if param),
            **classification,
        }
        classifications[name] = component
        components.append(component)

    checked_rows = [
        check_row(row, excel_row, classifications[str(row.get("元器件名称") or "")], ai_mapping)
        for excel_row, row in enumerate(table["data"], start=4)
    ]

    class_counts = Counter(
        (str(component.get("元器件大类")), str(component.get("元器件子类")))
        for component in components
        if component.get("matched")
    )
    classification_payload = {
        "schema_version": "1.0",
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "input_xlsx": str(xlsx_path),
        "source_json": str(reference_path),
        "ai_mapping_json": str(ai_mapping_path) if ai_mapping_path else None,
        "summary": {
            "total_rows": table["row_count"],
            "unique_component_names": len(groups),
            "matched_component_names": sum(1 for component in components if component.get("matched")),
            "unmatched_component_names": sum(1 for component in components if not component.get("matched")),
            "classification_counts": [
                {"元器件大类": key[0], "元器件子类": key[1], "component_name_count": value}
                for key, value in sorted(class_counts.items())
            ],
        },
        "components": components,
    }
    classification_path.write_text(
        json.dumps(classification_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    summary = Counter(row["符合性"] for row in checked_rows)
    issue_counts = Counter(issue for row in checked_rows for issue in row["问题"])
    unmatched_components = [
        component["元器件名称"]
        for component in components
        if not component.get("matched")
    ]
    result_payload = {
        "schema_version": "1.0",
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "input_xlsx": str(xlsx_path),
        "table_json": str(table_path),
        "classification_json": str(classification_path),
        "standard_json": str(reference_path),
        "rules_md": str(rules_path),
        "ai_mapping_json": str(ai_mapping_path) if ai_mapping_path else None,
        "summary": {"total_rows": len(checked_rows), **dict(summary)},
        "issue_counts": dict(issue_counts),
        "unmatched_components": unmatched_components,
        "rows": checked_rows,
    }
    result_path.write_text(
        json.dumps(result_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(table_path)
    print(classification_path)
    print(result_path)
    print(json.dumps(result_payload["summary"], ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
