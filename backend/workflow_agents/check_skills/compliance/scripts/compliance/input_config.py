from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from .io_utils import read_json, write_json

INPUTS_DIRNAME = "00_inputs"
INPUT_CONFIG_FILENAME = "input_config.json"

INPUT_FILE_KEYS = {
    "requirement_document": "requirement_doc",
    "component_list": "component_list",
    "catalog_evidence": "catalog",
    "catalog": "catalog",
    "reliability_evidence": "reliability_db",
    "reliability_db": "reliability_db",
    "derating_table": "derating_table",
    "derating_standard": "derating_standard",
}


def _dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _text(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None


def _input_path(inputs_dir: Path, item: Any) -> str | None:
    rel_path = _text(_dict(item).get("relative_path"))
    if not rel_path:
        return None
    path = Path(rel_path)
    if not path.is_absolute():
        path = inputs_dir / path
    return str(path.resolve())


def read_input_config(
    workspace_dir: Path, input_config: Path | None = None
) -> dict[str, Any]:
    workspace_dir = workspace_dir.resolve()
    inputs_dir = workspace_dir / INPUTS_DIRNAME
    input_config = (input_config or inputs_dir / INPUT_CONFIG_FILENAME).resolve()
    config = read_json(input_config)
    if not isinstance(config, dict):
        raise ValueError("input_config.json root must be an object")

    files = {}
    missing = []
    input_files = _dict(config.get("input_files"))
    for config_key, output_key in INPUT_FILE_KEYS.items():
        if config_key not in input_files:
            continue
        path = _input_path(inputs_dir, input_files[config_key])
        files[output_key] = path
        if not path or not Path(path).exists():
            missing.append(path if path else config_key)

    for required_key in ("requirement_document", "component_list"):
        output_key = INPUT_FILE_KEYS[required_key]
        if not files.get(output_key):
            missing.append(f"input_files.{required_key}")

    quality_level = _dict(config.get("quality_level"))
    compliance_quality = _dict(
        _dict(config.get("compliance_config")).get("quality_level")
    )
    min_required = (
        _text(quality_level.get("min_required"))
        or _text(quality_level.get("selected"))
        or _text(compliance_quality.get("min_required"))
    )
    quality_compare = {
        "selected_import_baseline": quality_level.get("selected_import_baseline"),
        "selected_import_baseline_group": quality_level.get(
            "selected_import_baseline_group"
        ),
        "selected_import_baseline_label": quality_level.get(
            "selected_import_baseline_label"
        ),
    }

    return {
        "workspace_dir": str(workspace_dir),
        "input_config": str(input_config),
        "files": files,
        "quality_level": {"min_required": min_required},
        "quality_compare": quality_compare,
        "derating": {
            "table": files.get("derating_table"),
            "standard": files.get("derating_standard"),
        },
        "missing": list(dict.fromkeys(missing)),
    }


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        description="Read compliance inputs from 00_inputs/input_config.json."
    )
    parser.add_argument("--workspace-dir", required=True)
    parser.add_argument("--input-config")
    parser.add_argument("--output")
    args = parser.parse_args(argv)

    result = read_input_config(
        Path(args.workspace_dir),
        Path(args.input_config) if args.input_config else None,
    )
    if args.output:
        write_json(Path(args.output), result)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
