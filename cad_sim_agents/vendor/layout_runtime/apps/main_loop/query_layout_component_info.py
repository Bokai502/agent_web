from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Iterable, Mapping

from core.io import read_json, write_json
from apps.main_loop.component_info_common import build_display_index, display_lookup, query_summary
from local_defaults import THERMAL_DB


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Query CAD/Excel info for components in geom.json or geometry_registry.json.")
    parser.add_argument("--layout-json", type=Path, required=True, help="Path to geom.json or geometry_registry.json.")
    parser.add_argument("--bom-json", type=Path, help="Optional real_bom.json. Used to map pipeline component_id to Excel semantic_name.")
    parser.add_argument("--component-id", help="Optional thermal DB component id filter, e.g. THM-011.")
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

    result = query_layout_component_info(
        layout_json=args.layout_json,
        bom_json=args.bom_json,
        component_id=args.component_id,
        thermal_db=args.thermal_db,
        cad_prefix=args.cad_prefix,
        datasheet_prefix=args.datasheet_prefix,
        output_path=args.output,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
    return 0 if result["ok"] else 1


def query_layout_component_info(
    *,
    layout_json: Path,
    bom_json: Path | None = None,
    component_id: str | None = None,
    thermal_db: Path,
    cad_prefix: Path | None = None,
    datasheet_prefix: Path | None = None,
    output_path: Path | None = None,
) -> dict[str, Any]:
    layout_json = Path(layout_json)
    data = read_json(layout_json)
    bom_lookup = _bom_lookup_by_component_id(Path(bom_json)) if bom_json else {}
    records = list(_records_from_layout_json(data, layout_json.name))
    cad_index = build_display_index(thermal_db, cad_prefix=cad_prefix, datasheet_prefix=datasheet_prefix)
    by_component_id = cad_index.get("by_component_id", {})

    components = []
    missing_count = 0
    for record in records:
        semantic_name = _lookup_key_from_record(record, bom_lookup)
        if component_id and semantic_name != component_id:
            continue
        lookup = display_lookup(semantic_name, by_component_id)
        item = _public_layout_record(
            record,
            semantic_name=semantic_name,
            display_info=lookup["display_info"],
            lookup_status=lookup["lookup_status"],
        )
        components.append(item)
        if lookup.get("missing"):
            missing_count += 1

    result = {
        "schema_version": "1.0",
        "ok": missing_count == 0,
        "source_files": {
            "layout_json": str(layout_json),
            "bom_json": str(bom_json) if bom_json else None,
        },
        "layout_json_type": _layout_json_type(data),
        **query_summary(components=components, missing_count=missing_count),
        "components": components,
    }
    if component_id:
        result["component_filter"] = component_id
    if output_path:
        write_json(output_path, result)
    return result


def _public_layout_record(
    record: Mapping[str, Any],
    *,
    semantic_name: str | None,
    display_info: Mapping[str, Any] | None,
    lookup_status: str,
) -> dict[str, Any]:
    item = {
        "component_id": record.get("component_id"),
        "semantic_name": semantic_name,
        "lookup_status": lookup_status,
        "display_info": display_info,
    }
    for key in (
        "geometry_id",
        "kind",
        "category",
        "bbox",
        "position",
        "center",
        "size",
        "mount_face_id",
    ):
        if record.get(key) is not None:
            item[key] = record.get(key)
    return item


def _records_from_layout_json(data: Mapping[str, Any], filename: str) -> Iterable[dict[str, Any]]:
    if isinstance(data.get("components"), Mapping):
        for geom_component_key, item in data["components"].items():
            if not isinstance(item, Mapping):
                continue
            yield {
                "geom_component_key": geom_component_key,
                "component_id": item.get("component_id"),
                "kind": item.get("kind"),
                "category": item.get("category"),
                "bbox": item.get("bbox"),
                "position": item.get("position"),
                "mount_face_id": item.get("mount_face_id"),
            }
        return

    if isinstance(data.get("entities"), list):
        for item in data["entities"]:
            if not isinstance(item, Mapping) or item.get("entity_type") != "component_solid":
                continue
            yield {
                "geometry_id": item.get("geometry_id"),
                "component_id": item.get("component_id"),
                "bbox": item.get("bbox"),
                "center": item.get("center"),
                "size": item.get("size"),
            }
        return

    raise ValueError(f"Unsupported layout JSON structure: {filename}")


def _bom_lookup_by_component_id(bom_json: Path) -> dict[str, dict[str, Any]]:
    if not bom_json.exists():
        return {}
    bom = read_json(bom_json)
    lookup: dict[str, dict[str, Any]] = {}
    for item in bom.get("items", []):
        if not isinstance(item, Mapping):
            continue
        component_id = str(item.get("component_id") or "").strip()
        semantic_name = str(item.get("semantic_name") or "").strip()
        if not component_id or not semantic_name:
            continue
        source_ref = item.get("source_ref") if isinstance(item.get("source_ref"), Mapping) else {}
        lookup[component_id] = {
            "semantic_name": semantic_name,
            "thermal_db_component_id": source_ref.get("thermal_db_component_id"),
            "excel_component_id": source_ref.get("excel_component_id"),
            "bom_component_id": component_id,
            "bom_semantic_name": semantic_name,
        }
    return lookup


def _lookup_key_from_record(record: Mapping[str, Any], bom_lookup: Mapping[str, Mapping[str, Any]]) -> str | None:
    value = str(record.get("component_id") or "").strip()
    if value and value in bom_lookup:
        bom_item = bom_lookup[value]
        return str(
            bom_item.get("thermal_db_component_id")
            or bom_item.get("excel_component_id")
            or bom_item.get("semantic_name")
            or ""
        )
    return None


def _layout_json_type(data: Mapping[str, Any]) -> str:
    if isinstance(data.get("components"), Mapping):
        return "geom"
    if isinstance(data.get("entities"), list):
        return "geometry_registry"
    return "unknown"


if __name__ == "__main__":
    raise SystemExit(main())
