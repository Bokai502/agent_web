from __future__ import annotations

import argparse
from pathlib import Path

from . import checks
from .component_io import load_components
from .io_utils import write_json


def build_config_template(component_list: Path, output: Path, sheet_name: str | None = None) -> dict:
    components, missing = load_components(component_list, sheet_name)
    if missing:
        raise ValueError(f"Component list missing required fields: {', '.join(missing)}")
    checks.classify_components(components)
    manufacturers = checks.normalize_manufacturers(components)
    return {
        "notes": "This file replaces the original frontend confirmation step. Edit values here before running the pipeline.",
        "user_confirmations": {
            "key_unit_models": [c.model for c in components if c.is_key_part],
            "low_quality_models": [c.model for c in components if c.is_low_quality],
        },
        "quality_level": {
            "min_required": "CAST C"
        },
        "component_classification": {
            "overrides": {
                c.name: {
                    "category_class": c.category_class,
                    "category_name": c.category_name,
                }
                for c in components
            }
        },
        "manufacturer_confirmations": {
            row["厂商简称"]: {
                "厂商全称": row["厂商全称"],
                "国产/进口": row["国产/进口"],
                "目录内或外": row["目录内或外"],
            }
            for row in manufacturers
        },
        "external_results": {
            "catalog_match_results": [],
            "quality_compare_results": [],
            "reliability_results": [],
        },
    }


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Create a compliance_config.json template.")
    parser.add_argument("--component-list", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--sheet-name", default=None)
    args = parser.parse_args(argv)
    config = build_config_template(Path(args.component_list), Path(args.output), args.sheet_name)
    write_json(Path(args.output), config)
    print(Path(args.output))


if __name__ == "__main__":
    main()
