#!/usr/bin/env python3
"""Legacy helper to generate a CAD-native build spec from old thermal 00_inputs.

Normal thermal workspaces should already provide `00_inputs/cad_build_spec.json`
and should not use this helper. This script exists only for migrating old input
packages into the CAD-native single-spec format.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from pathlib import Path
from typing import Any


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _freecad_src() -> Path:
    return _repo_root() / "backend/workflow_agents/agents/freecad_cli_tools/src"


sys.path.insert(0, str(_freecad_src()))

from freecad_cli_tools.cad_inputs import component_bbox, geom_components_by_component_id  # noqa: E402
from freecad_cli_tools.geometry import orientation_rows_from_placement  # noqa: E402
from freecad_cli_tools.layout_dataset import normalize_layout_dataset  # noqa: E402
from freecad_cli_tools.layout_dataset_faces import component_local_face_to_face_id  # noqa: E402
from freecad_cli_tools.layout_dataset_io import load_json_file, serialize_json_payload  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Legacy migration: generate 00_inputs/cad_build_spec.json from old input files.")
    parser.add_argument("input_dir", type=Path, help="Legacy directory containing old split JSON input files.")
    parser.add_argument(
        "--output",
        type=Path,
        help="Output path. Default: <input_dir>/cad_build_spec.json.",
    )
    return parser.parse_args()


def positive_power(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(parsed) or math.isinf(parsed) or parsed <= 0.0:
        return None
    return parsed


def float_or_default(value: Any, default: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    if math.isnan(parsed) or math.isinf(parsed):
        return default
    return parsed


def vector3(value: Any, default: list[float] | None = None) -> list[float] | None:
    if isinstance(value, (list, tuple)) and len(value) == 3:
        return [float(item) for item in value]
    return default


def face_footprint_bbox_2d(face: dict[str, Any] | None, bbox: dict[str, list[float]]) -> list[list[float]] | None:
    if not isinstance(face, dict):
        return None
    axis = int(face.get("plane_axis", 0))
    axes = [index for index in range(3) if index != axis]
    return [
        [float(bbox["min"][axes[0]]), float(bbox["min"][axes[1]])],
        [float(bbox["max"][axes[0]]), float(bbox["max"][axes[1]])],
    ]


def load_template_csv_rows(real_bom: dict[str, Any]) -> dict[str, dict[str, str]]:
    source = real_bom.get("source") if isinstance(real_bom.get("source"), dict) else {}
    raw_path = source.get("template_csv")
    if not isinstance(raw_path, str) or not raw_path.strip():
        return {}
    csv_path = Path(raw_path)
    if not csv_path.exists():
        return {}
    rows: dict[str, dict[str, str]] = {}
    with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            for key in ("器件ID", "device_id", "semantic_name", "id"):
                value = row.get(key)
                if value:
                    rows[str(value)] = row
                    break
    return rows


def step_path_from_item(item: dict[str, Any], csv_rows: dict[str, dict[str, str]]) -> str | None:
    source_ref = item.get("source_ref") if isinstance(item.get("source_ref"), dict) else {}
    for key in ("cad_rotated_path", "step_path", "cad_path", "source_step_path"):
        value = source_ref.get(key)
        if isinstance(value, str) and value.strip():
            return value
    row = csv_rows.get(str(item.get("semantic_name")))
    if row:
        for key in ("cad_rotated_path", "step_path", "STEP路径", "CAD路径", "path"):
            value = row.get(key)
            if isinstance(value, str) and value.strip():
                return value
    return None


def display_name_from_item(item: dict[str, Any]) -> str | None:
    value = item.get("display_name")
    if isinstance(value, str) and value.strip():
        return value
    source_ref = item.get("source_ref") if isinstance(item.get("source_ref"), dict) else {}
    value = source_ref.get("display_name")
    if isinstance(value, str) and value.strip():
        return value
    return None


def mount_face_id_from_item(item: dict[str, Any], fallback: Any = None) -> Any:
    value = item.get("mount_face_id")
    if isinstance(value, str) and value.strip():
        return value
    source_ref = item.get("source_ref") if isinstance(item.get("source_ref"), dict) else {}
    value = source_ref.get("panel_mount_face_id")
    if isinstance(value, str) and value.strip():
        return value
    return fallback


def int_sign(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    if parsed in (-1, 1):
        return parsed
    return None


def normal_sign_from_item(item: dict[str, Any], component_mount_face_id: Any, fallback: Any = None) -> Any:
    value = int_sign(item.get("normal_sign"))
    if value is not None:
        return value

    mounting = item.get("mounting") if isinstance(item.get("mounting"), dict) else {}
    value = int_sign(mounting.get("normal_sign"))
    if value is not None:
        return value

    mount_faces = mounting.get("mount_faces") if isinstance(mounting.get("mount_faces"), list) else []
    if isinstance(component_mount_face_id, str) and component_mount_face_id.strip():
        for mount_face in mount_faces:
            if not isinstance(mount_face, dict):
                continue
            if mount_face.get("component_mount_face_id") == component_mount_face_id:
                value = int_sign(mount_face.get("normal_sign"))
                if value is not None:
                    return value

    if mount_faces:
        first_mount_face = mount_faces[0]
        if isinstance(first_mount_face, dict):
            value = int_sign(first_mount_face.get("normal_sign"))
            if value is not None:
                return value

    source_ref = item.get("source_ref") if isinstance(item.get("source_ref"), dict) else {}
    value = int_sign(source_ref.get("panel_normal_sign"))
    if value is not None:
        return value

    return fallback


def build_spec(input_dir: Path) -> dict[str, Any]:
    real_bom_path = input_dir / "real_bom.json"
    layout_topology_path = input_dir / "layout_topology.json"
    geom_path = input_dir / "geom.json"
    real_bom = load_json_file(real_bom_path)
    layout_topology = load_json_file(layout_topology_path)
    geom = load_json_file(geom_path)

    normalized = normalize_layout_dataset(layout_topology, geom)
    geom_by_component = geom_components_by_component_id(geom)
    bom_by_component = {
        item.get("component_id"): item
        for item in real_bom.get("items", [])
        if isinstance(item, dict)
    }
    csv_rows = load_template_csv_rows(real_bom)
    install_faces = geom.get("install_faces") if isinstance(geom.get("install_faces"), dict) else {}

    components = []
    for placement in layout_topology.get("placements") or []:
        if not isinstance(placement, dict):
            continue
        component_id = str(placement.get("component_id"))
        normalized_component = normalized["components"][component_id]
        geom_component = geom_by_component.get(component_id, {})
        bom_item = bom_by_component.get(component_id, {})
        bbox = component_bbox(geom_component)
        power = positive_power(bom_item.get("power_W", geom_component.get("power")))
        mount_face_id = mount_face_id_from_item(bom_item, placement.get("mount_face_id"))
        component_mount_face_id = placement.get("component_mount_face_id")
        face = install_faces.get(mount_face_id) if isinstance(mount_face_id, str) else None
        normal_sign = normal_sign_from_item(
            bom_item,
            component_mount_face_id,
            face.get("normal_sign") if isinstance(face, dict) else None,
        )
        component_face = None
        if isinstance(component_mount_face_id, str) and component_mount_face_id.strip():
            component_face = component_local_face_to_face_id(component_mount_face_id)

        step_path = step_path_from_item(bom_item, csv_rows)
        components.append(
            {
                "id": component_id,
                "geometry_id": placement.get("geometry_id"),
                "thermal_id": placement.get("thermal_id"),
                "semantic_name": placement.get("semantic_name")
                or bom_item.get("semantic_name")
                or geom_component.get("semantic_name"),
                "display_name": display_name_from_item(bom_item),
                "kind": placement.get("kind") or bom_item.get("kind") or geom_component.get("kind"),
                "category": bom_item.get("category") or geom_component.get("category"),
                "shape": normalized_component.get("shape", "box"),
                "position": normalized_component.get("placement", {}).get("position"),
                "dims": normalized_component.get("dims"),
                "rotation_rows": orientation_rows_from_placement(
                    component_id,
                    normalized_component.get("placement", {}),
                ),
                "bbox": bbox,
                "color": geom_component.get("color") or placement.get("color"),
                "mount": {
                    "install_face_id": mount_face_id,
                    "component_face_id": component_mount_face_id,
                    "component_face_index": component_face,
                    "contact_plane_axis": face.get("plane_axis") if isinstance(face, dict) else None,
                    "contact_plane_value": face.get("plane_value") if isinstance(face, dict) else None,
                    "normal_sign": normal_sign,
                    "footprint_bbox_2d": face_footprint_bbox_2d(face, bbox),
                },
                "thermal": {
                    "include_in_simulation": power is not None,
                    "power_W": power if power is not None else 0.0,
                    "mass_kg": float_or_default(
                        bom_item.get("mass_kg", geom_component.get("mass")),
                        0.0,
                    ),
                    "material_id": bom_item.get("material_id")
                    or bom_item.get("material_hint")
                    or "aluminum_6061",
                    "contact_resistance": float_or_default(
                        (geom_component.get("thermal_interface") or {}).get(
                            "contact_resistance",
                            (bom_item.get("thermal_interface") or {}).get("contact_resistance"),
                        ),
                        0.001,
                    ),
                },
                "real_cad": {
                    "source_kind": "step" if step_path else "box",
                    "step_path": step_path,
                    "fallback_shape": "box",
                },
            }
        )

    walls = []
    for wall in normalized.get("walls", []):
        walls.append(
            {
                "id": wall.get("id"),
                "name": wall.get("name"),
                "panel_id": wall.get("panel_id"),
                "shape": "box",
                "position": wall.get("position"),
                "dims": wall.get("size"),
                "bbox": wall.get("bbox"),
                "color": [217, 166, 64, 255],
                "simulation": {
                    "include": True,
                    "power_W": 0.0,
                    "selection_role": "internal_partition",
                },
            }
        )

    spec = {
        "schema_version": "cad_build_spec/1.0",
        "units": {
            "length": (geom.get("units") or {}).get("length", "mm"),
            "power": "W",
        },
        "source_files": {
            "cad_build_spec": "cad_build_spec.json",
            "legacy_migration": "old split thermal input package",
        },
        "document": {
            "name": layout_topology.get("layout_id") or real_bom.get("bom_id") or "SatelliteCAD",
            "view": "Isometric",
        },
        "envelope": {
            "outer_bbox": normalized.get("envelope", {}).get("outer_bbox"),
            "inner_bbox": normalized.get("envelope", {}).get("inner_bbox"),
            "outer_size": normalized.get("envelope", {}).get("outer_size"),
            "inner_size": normalized.get("envelope", {}).get("inner_size"),
            "shell_thickness": normalized.get("envelope", {}).get("shell_thickness"),
            "display": {
                "mode": "wireframe",
                "color": [51, 128, 230, 255],
            },
        },
        "cabins": normalized.get("cabins", []),
        "walls": walls,
        "components": components,
        "outputs": {
            "placeholder_glb": "01_cad/geometry_after.glb",
            "simulation_step": "01_cad/geometry_after_power_filtered.step",
            "real_cad_glb": "01_cad/geometry_after_real_cad.glb",
            "simulation_input": "01_cad/simulation_input.json",
            "cad_agent_output": "01_cad/cad_agent_output.json",
        },
        "summary": {
            "component_count": len(components),
            "wall_count": len(walls),
            "simulation_component_count": len(
                [item for item in components if item["thermal"]["include_in_simulation"]]
            ),
            "real_cad_step_count": len(
                [item for item in components if item["real_cad"]["step_path"]]
            ),
        },
    }
    return spec


def main() -> int:
    args = parse_args()
    input_dir = args.input_dir.resolve()
    output = args.output.resolve() if args.output else input_dir / "cad_build_spec.json"
    spec = build_spec(input_dir)
    output.write_text(serialize_json_payload(spec), encoding="utf-8")
    print(json.dumps({"ok": True, "output": str(output), "summary": spec["summary"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
