from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Mapping

from core.io import read_json, write_json
from apps.main_loop.component_info_common import build_display_index, display_lookup, first_matching_lookup_key, query_summary
from local_defaults import THERMAL_DB


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Query front-end display info for components in real_bom.json.")
    parser.add_argument("--bom", type=Path, required=True, help="Path to real_bom.json.")
    parser.add_argument("--component-id", help="Optional thermal DB component id filter, e.g. PWR-004.")
    parser.add_argument(
        "--thermal-db",
        type=Path,
        default=THERMAL_DB,
    )
    parser.add_argument(
        "--cad-prefix",
        type=Path,
        default=None,
        help="Optional override. Defaults to <thermal-db-dir>/cad.",
    )
    parser.add_argument(
        "--datasheet-prefix",
        type=Path,
        default=None,
        help="Optional override. Defaults to <thermal-db-dir>/datasheet.",
    )
    parser.add_argument("--output", type=Path, help="Optional output JSON path.")
    args = parser.parse_args(argv)

    result = query_bom_component_info(
        bom_json=args.bom,
        component_id=args.component_id,
        thermal_db=args.thermal_db,
        cad_prefix=args.cad_prefix,
        datasheet_prefix=args.datasheet_prefix,
        output_path=args.output,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
    return 0 if result["ok"] else 1


def query_bom_component_info(
    *,
    bom_json: Path,
    component_id: str | None = None,
    thermal_db: Path,
    cad_prefix: Path | None = None,
    datasheet_prefix: Path | None = None,
    output_path: Path | None = None,
) -> dict[str, Any]:
    bom_json = Path(bom_json)
    bom = read_json(bom_json)
    cad_index = build_display_index(thermal_db, cad_prefix=cad_prefix, datasheet_prefix=datasheet_prefix)
    by_component_id = cad_index.get("by_component_id", {})

    components = []
    missing_count = 0
    for item in bom.get("items", []):
        if not isinstance(item, Mapping):
            continue
        thermal_db_component_id = _thermal_db_lookup_key(item, by_component_id)
        if component_id and thermal_db_component_id != component_id:
            continue
        lookup = display_lookup(thermal_db_component_id, by_component_id)
        record = {
            "component_id": item.get("component_id"),
            "semantic_name": item.get("semantic_name"),
            "kind": item.get("kind"),
            "category": item.get("category"),
            "quantity": item.get("quantity", 1),
            "size_mm": item.get("size_mm"),
            "mass_kg": item.get("mass_kg"),
            "power_W": item.get("power_W"),
            "material_id": item.get("material_id"),
            "component_subtype": item.get("component_subtype") or (item.get("source_ref") or {}).get("original_kind"),
            "display_info": lookup["display_info"],
            "lookup_status": lookup["lookup_status"],
        }
        components.append(record)
        if lookup.get("missing"):
            missing_count += 1

    result = {
        "schema_version": "1.0",
        "ok": missing_count == 0,
        "source_files": {"bom_json": str(bom_json)},
        "bom_id": bom.get("bom_id"),
        **query_summary(components=components, missing_count=missing_count),
        "components": components,
    }
    if component_id:
        result["component_filter"] = component_id
    if output_path:
        write_json(output_path, result)
    return result


def _thermal_db_lookup_key(item: Mapping[str, Any], by_component_id: Mapping[str, Any]) -> str:
    source_ref = item.get("source_ref") if isinstance(item.get("source_ref"), Mapping) else {}
    return first_matching_lookup_key(
        (
            item.get("semantic_name"),
            source_ref.get("thermal_db_component_id"),
            source_ref.get("excel_component_id"),
            item.get("component_id"),
        ),
        by_component_id,
    )


if __name__ == "__main__":
    raise SystemExit(main())
