#!/usr/bin/env python3
"""Write all derating rows for one already-selected component subclass."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path


SKILL_DIR = Path(__file__).resolve().parents[1]
DEFAULT_DATA = SKILL_DIR / "reference" / "jiange_full.json"
DEFAULT_OUTPUT = Path("component_derating_result.json")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Read jiange_full.json and write all rows for one selected 元器件子类. "
            "This script does not classify or choose the subclass."
        )
    )
    parser.add_argument("--component-name", required=True, help="Original user component name.")
    parser.add_argument("--subclass", required=True, help="Already-selected 元器件子类.")
    parser.add_argument(
        "--reason",
        required=True,
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
        default=str(DEFAULT_OUTPUT),
        help="Output JSON path.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    data_path = Path(args.data)
    output_path = Path(args.output)

    if not data_path.exists():
        raise SystemExit(f"JSON data file not found: {data_path}")

    rows = json.loads(data_path.read_text(encoding="utf-8-sig"))
    if not isinstance(rows, list):
        raise SystemExit(f"JSON root must be a list: {data_path}")

    selected_rows = [
        row
        for row in rows
        if isinstance(row, dict) and row.get("元器件子类") == args.subclass
    ]
    if not selected_rows:
        raise SystemExit(f"No rows found for 元器件子类: {args.subclass}")

    big_categories = sorted(
        {row.get("元器件大类", "") for row in selected_rows if row.get("元器件大类")}
    )
    result = {
        "schema_version": "3.0",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "input": args.component_name,
        "source_json": display_path(data_path),
        "matched": True,
        "result": {
            "元器件大类": big_categories[0] if len(big_categories) == 1 else big_categories,
            "元器件子类": args.subclass,
            "selection_reason": args.reason,
            "information": selected_rows,
        },
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
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
