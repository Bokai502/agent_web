#!/usr/bin/env python3
"""Check whether an AI derating mapping covers all standard parameters."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


SKILL_DIR = Path(__file__).resolve().parents[1]
DEFAULT_REFERENCE = SKILL_DIR / "reference" / "jiange_full.json"
DEFAULT_OUTPUT_SUBDIR = Path("check_outputs") / "component-derating-classifier"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Compare parameter_matches in an AI mapping against all standard "
            "derating parameters required by each selected 元器件子类."
        )
    )
    parser.add_argument("ai_mapping", type=Path, help="AI mapping JSON path.")
    parser.add_argument("--workspace-dir", type=Path, help="Workspace root for relative mapping paths.")
    parser.add_argument("--reference", type=Path, default=DEFAULT_REFERENCE, help="Reference jiange_full.json path.")
    parser.add_argument(
        "--output",
        type=Path,
        help=(
            "Output JSON path. Defaults to updating the mapping file in place. "
            "Relative paths are resolved against --workspace-dir when provided."
        ),
    )
    parser.add_argument(
        "--no-in-place",
        action="store_true",
        help="Write a separate completeness report instead of updating the mapping file.",
    )
    return parser.parse_args()


def normalize(value: object) -> str:
    return re.sub(r"\s+", "", str(value or "")).strip()


def resolve_path(path: Path, workspace_dir: Path | None = None) -> Path:
    expanded = path.expanduser()
    if expanded.is_absolute():
        return expanded.resolve()
    if workspace_dir is not None:
        return (workspace_dir / expanded).resolve()
    return expanded.resolve()


def default_report_path(mapping_path: Path, workspace_dir: Path | None) -> Path:
    stem = mapping_path.stem
    if stem.endswith("_ai_mapping"):
        stem = stem[: -len("_ai_mapping")]
    base = workspace_dir / DEFAULT_OUTPUT_SUBDIR if workspace_dir is not None else mapping_path.parent
    return base / f"{stem}_mapping_completeness.json"


def load_reference(path: Path) -> list[dict]:
    rows = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(rows, list):
        raise SystemExit(f"Reference JSON root must be a list: {path}")
    return [row for row in rows if isinstance(row, dict)]


def required_parameters_by_type(reference_rows: list[dict]) -> dict[tuple[str, str], list[str]]:
    grouped: dict[tuple[str, str], list[str]] = {}
    seen: dict[tuple[str, str], set[str]] = {}
    for row in reference_rows:
        category = str(row.get("元器件大类") or "")
        subclass = str(row.get("元器件子类") or "")
        parameter = str(row.get("降额参数") or "")
        if not category or not subclass or not parameter:
            continue
        normalized = normalize(parameter)
        type_key = (category, subclass)
        type_seen = seen.setdefault(type_key, set())
        if normalized in type_seen:
            continue
        type_seen.add(normalized)
        grouped.setdefault(type_key, []).append(parameter)
    return grouped


def mapped_parameters_by_component(payload: dict) -> dict[str, set[str]]:
    mapped: dict[str, set[str]] = {}
    matches = payload.get("parameter_matches")
    if not isinstance(matches, list):
        return mapped
    for item in matches:
        if not isinstance(item, dict):
            continue
        component_name = item.get("元器件名称")
        standard_parameter = item.get("标准参数")
        if component_name and standard_parameter:
            mapped.setdefault(str(component_name), set()).add(normalize(standard_parameter))
    return mapped


def build_completeness(payload: dict, reference_rows: list[dict]) -> list[dict]:
    required_by_type = required_parameters_by_type(reference_rows)
    mapped_by_component = mapped_parameters_by_component(payload)
    components = payload.get("components")
    if not isinstance(components, list):
        raise SystemExit("AI mapping JSON must contain a components array.")

    completeness: list[dict] = []
    for component in components:
        if not isinstance(component, dict):
            continue
        component_name = str(component.get("元器件名称") or "")
        category = str(component.get("元器件大类") or "")
        subclass = str(component.get("元器件子类") or "")
        required = required_by_type.get((category, subclass), [])
        mapped = mapped_by_component.get(component_name, set())
        missing = [parameter for parameter in required if normalize(parameter) not in mapped]
        completeness.append({
            "元器件名称": component_name,
            "元器件大类": component.get("元器件大类"),
            "元器件子类": subclass,
            "required_count": len(required),
            "mapped_count": len(required) - len(missing),
            "missing_count": len(missing),
            "missing_standard_parameters": missing,
        })
    return completeness


def main() -> int:
    args = parse_args()
    workspace_dir = args.workspace_dir.expanduser().resolve() if args.workspace_dir else None
    mapping_path = resolve_path(args.ai_mapping, workspace_dir)
    reference_path = resolve_path(args.reference)
    output_path = (
        resolve_path(args.output, workspace_dir)
        if args.output
        else (default_report_path(mapping_path, workspace_dir) if args.no_in_place else mapping_path)
    )

    payload = json.loads(mapping_path.read_text(encoding="utf-8-sig"))
    if not isinstance(payload, dict):
        raise SystemExit(f"AI mapping JSON root must be an object: {mapping_path}")
    completeness = build_completeness(payload, load_reference(reference_path))
    summary = {
        "component_count": len(completeness),
        "components_with_missing": sum(1 for item in completeness if item["missing_count"] > 0),
        "missing_total": sum(int(item["missing_count"]) for item in completeness),
    }
    report = {
        "schema_version": "1.0",
        "summary": summary,
        "components": completeness,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    if args.no_in_place or output_path != mapping_path:
        output_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    else:
        payload["parameter_completeness"] = report
        output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(output_path)
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
