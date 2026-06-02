#!/usr/bin/env python3
"""Write all derating rows for one already-selected component category/subclass."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from progress_utils import update_loop_progress


SKILL_DIR = Path(__file__).resolve().parents[1]
DEFAULT_DATA = SKILL_DIR / "reference" / "jiange_full.json"
DEFAULT_OUTPUT_SUBDIR = Path("check_outputs") / "component-derating-classifier"
DEFAULT_OUTPUT_NAME = "component_derating_result.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Read jiange_full.json and write all rows for one selected 元器件大类/元器件子类. "
            "This script does not classify or choose the component type."
        )
    )
    parser.add_argument("--component-name", required=True, help="Original user component name.")
    parser.add_argument("--category", required=True, help="Already-selected 元器件大类.")
    parser.add_argument("--subclass", required=True, help="Already-selected 元器件子类.")
    parser.add_argument("--workspace-dir", type=Path, help="Workspace root for relative output paths.")
    parser.add_argument(
        "--reason",
        default=None,
        help="Short explanation for why this subclass was selected.",
    )
    parser.add_argument(
        "--data",
        default=str(DEFAULT_DATA),
        help="Path to jiange_full.json. Defaults to this skill's reference data.",
    )
    parser.add_argument(
        "--output",
        "-o",
        default=None,
        help="Output JSON path.",
    )
    return parser.parse_args()


def resolve_path(path: Path, workspace_dir: Path | None = None) -> Path:
    expanded = path.expanduser()
    if expanded.is_absolute():
        return expanded.resolve()
    if workspace_dir is not None:
        return (workspace_dir / expanded).resolve()
    return expanded.resolve()


def main() -> int:
    args = parse_args()
    workspace_dir = args.workspace_dir.expanduser().resolve() if args.workspace_dir else None
    data_path = resolve_path(Path(args.data))
    output_path = (
        resolve_path(Path(args.output), workspace_dir)
        if args.output
        else ((workspace_dir or Path.cwd()) / DEFAULT_OUTPUT_SUBDIR / DEFAULT_OUTPUT_NAME).resolve()
    )
    update_loop_progress(
        workspace_dir,
        loop_name="check_ai_mapping",
        status="ai_mapping_running",
        completed=False,
        percentage=20.0,
    )

    if not data_path.exists():
        raise SystemExit(f"JSON data file not found: {data_path}")

    rows = json.loads(data_path.read_text(encoding="utf-8-sig"))
    if not isinstance(rows, list):
        raise SystemExit(f"JSON root must be a list: {data_path}")

    selected_rows = [
        row
        for row in rows
        if (
            isinstance(row, dict)
            and row.get("元器件大类") == args.category
            and row.get("元器件子类") == args.subclass
        )
    ]
    if not selected_rows:
        raise SystemExit(f"No rows found for 元器件大类/元器件子类: {args.category}/{args.subclass}")
    result = {
        "schema_version": "3.0",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "input": args.component_name,
        "source_json": display_path(data_path),
        "matched": True,
        "result": {
            "元器件大类": args.category,
            "元器件子类": args.subclass,
            "information": selected_rows,
        },
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    update_loop_progress(
        workspace_dir,
        loop_name="check_ai_mapping",
        status="ai_mapping_completed",
        completed=True,
        percentage=100.0,
    )
    print(output_path)
    return 0


def display_path(path: Path) -> str:
    resolved = path.resolve()
    try:
        return str(resolved.relative_to(SKILL_DIR))
    except ValueError:
        return str(path)


if __name__ == "__main__":
    raise SystemExit(main())
