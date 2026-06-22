#!/usr/bin/env python3
"""Prepare legacy simulation after-state files from 01_cad CAD-native outputs."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

from .spec_common import read_json, spec_to_layout_data, write_json

import numpy as np


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Prepare 01_cad after-state files for simulation.")
    parser.add_argument("--cad-dir", required=True)
    parser.add_argument("--spec", help="Path to cad_build_spec.json. Defaults to ../00_inputs/cad_build_spec.json from cad-dir.")
    parser.add_argument("--grid-shape", default="32,32,32", help="Grid shape as nx,ny,nz. Default: 32,32,32.")
    return parser.parse_args()


def parse_grid_shape(value: str) -> tuple[int, int, int]:
    parts = [part.strip() for part in value.split(",")]
    if len(parts) != 3:
        raise ValueError("--grid-shape must have exactly three comma-separated integers")
    shape = tuple(int(part) for part in parts)
    if any(item <= 0 for item in shape):
        raise ValueError("--grid-shape values must be positive")
    return shape


def component_bbox(component: dict[str, Any]) -> dict[str, list[float]]:
    bbox = component.get("bbox")
    if isinstance(bbox, dict) and isinstance(bbox.get("min"), list) and isinstance(bbox.get("max"), list):
        return bbox
    position = component.get("placement", {}).get("position") or component.get("position") or [0, 0, 0]
    dims = component.get("dims") or [1, 1, 1]
    return {
        "min": [float(value) for value in position],
        "max": [float(position[index]) + float(dims[index]) for index in range(3)],
    }


def vector3(value: Any, label: str) -> list[float]:
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        raise ValueError(f"{label} must be a 3-value array.")
    return [float(item) for item in value]


def float_value(value: Any, *, default: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    if math.isnan(parsed) or math.isinf(parsed):
        return default
    return parsed


def sampling_bbox(geom: dict[str, Any]) -> tuple[list[float], list[float], int]:
    outer_bbox = geom.get("outer_shell", {}).get("outer_bbox")
    if not isinstance(outer_bbox, dict):
        raise ValueError("geom.outer_shell.outer_bbox must be a JSON object.")
    bbox_min = vector3(outer_bbox.get("min"), "outer_shell.outer_bbox.min")
    bbox_max = vector3(outer_bbox.get("max"), "outer_shell.outer_bbox.max")
    component_bbox_count = 0
    for component in (geom.get("components") or {}).values():
        if not isinstance(component, dict):
            continue
        bbox = component_bbox(component)
        component_bbox_count += 1
        for axis in range(3):
            bbox_min[axis] = min(bbox_min[axis], bbox["min"][axis])
            bbox_max[axis] = max(bbox_max[axis], bbox["max"][axis])
    return bbox_min, bbox_max, component_bbox_count


def grid_index(
    point: list[float],
    bbox_min: list[float],
    bbox_max: list[float],
    grid_shape: tuple[int, int, int],
    *,
    floor: bool,
) -> list[int]:
    result = []
    for axis, count in enumerate(grid_shape):
        span = bbox_max[axis] - bbox_min[axis]
        if span <= 0:
            result.append(0)
            continue
        raw = ((point[axis] - bbox_min[axis]) / span) * (count - 1)
        index = math.floor(raw) if floor else math.ceil(raw)
        result.append(max(0, min(count - 1, int(index))))
    return result


def paint_bbox_into_mask(
    mask: np.ndarray,
    bbox: dict[str, list[float]],
    bbox_min: list[float],
    bbox_max: list[float],
    grid_shape: tuple[int, int, int],
) -> tuple[slice, ...]:
    min_i = grid_index(bbox["min"], bbox_min, bbox_max, grid_shape, floor=True)
    max_i = grid_index(bbox["max"], bbox_min, bbox_max, grid_shape, floor=False)
    slices = tuple(slice(min_i[axis], max_i[axis] + 1) for axis in range(3))
    mask[slices] = 1
    return slices


def write_grid_inputs(
    *,
    geom: dict[str, Any],
    coord_path: Path,
    channels_path: Path,
    grid_shape: tuple[int, int, int],
) -> dict[str, Any]:
    bbox_min, bbox_max, component_bbox_count = sampling_bbox(geom)
    nx, ny, nz = grid_shape
    xs = np.linspace(bbox_min[0], bbox_max[0], nx)
    ys = np.linspace(bbox_min[1], bbox_max[1], ny)
    zs = np.linspace(bbox_min[2], bbox_max[2], nz)
    mask = np.zeros(grid_shape, dtype=np.uint8)
    power = np.zeros(grid_shape, dtype=np.float32)
    mass = np.zeros(grid_shape, dtype=np.float32)

    coord_path.write_text(
        "".join(f"{x / 1000.0:.9g} {y / 1000.0:.9g} {z / 1000.0:.9g}\n" for x in xs for y in ys for z in zs),
        encoding="utf-8",
    )

    for component in (geom.get("components") or {}).values():
        if not isinstance(component, dict):
            continue
        bbox = component_bbox(component)
        slices = paint_bbox_into_mask(mask, bbox, bbox_min, bbox_max, grid_shape)
        voxel_count = max(1, int(np.prod([item.stop - item.start for item in slices])))
        power[slices] += np.float32(float_value(component.get("power"), default=0.0) / voxel_count)
        mass[slices] += np.float32(float_value(component.get("mass"), default=0.0) / voxel_count)

    for wall in (geom.get("walls") or {}).values():
        if isinstance(wall, dict) and isinstance(wall.get("bbox"), dict):
            paint_bbox_into_mask(mask, wall["bbox"], bbox_min, bbox_max, grid_shape)

    np.savez_compressed(channels_path, mask=mask, power=power, mass=mass)
    return {
        "occupied_voxels": int(mask.sum()),
        "total_voxels": int(mask.size),
        "total_power_W": float(power.sum()),
        "total_mass_kg": float(mass.sum()),
        "grid_bbox_min": bbox_min,
        "grid_bbox_max": bbox_max,
        "grid_bbox_units": "mm",
        "grid_bbox_source": "outer_shell.outer_bbox+geom.components.bbox+geom.walls.bbox",
        "grid_component_bbox_count": component_bbox_count,
        "grid_wall_bbox_count": len([
            wall for wall in (geom.get("walls") or {}).values()
            if isinstance(wall, dict) and isinstance(wall.get("bbox"), dict)
        ]),
    }


def build_geom(layout: dict[str, Any], simulation_input: dict[str, Any]) -> dict[str, Any]:
    envelope = layout.get("envelope") if isinstance(layout.get("envelope"), dict) else {}
    components = {}
    for component_id, component in (layout.get("components") or {}).items():
        bbox = component_bbox(component)
        thermal = next(
            (item for item in simulation_input.get("components", []) if item.get("component_id") == component_id),
            {},
        )
        components[component_id] = {
            "component_id": component_id,
            "semantic_name": component.get("semantic_name"),
            "display_name": component.get("display_name"),
            "shape": component.get("shape", "box"),
            "position": component.get("placement", {}).get("position") or bbox["min"],
            "dims": component.get("dims") or [bbox["max"][i] - bbox["min"][i] for i in range(3)],
            "bbox": bbox,
            "color": component.get("color"),
            "power": thermal.get("power_W", 0.0),
            "mass": thermal.get("mass_kg", 0.0),
            "category": component.get("category"),
            "kind": component.get("kind"),
        }
    walls = {}
    for wall in layout.get("walls") or []:
        wall_id = str(wall.get("id") or wall.get("wall_id") or wall.get("name") or f"wall_{len(walls) + 1}")
        bbox = wall.get("bbox")
        bbox_min = bbox.get("min") if isinstance(bbox, dict) and isinstance(bbox.get("min"), list) else None
        bbox_max = bbox.get("max") if isinstance(bbox, dict) and isinstance(bbox.get("max"), list) else None
        thickness = None
        if bbox_min is not None and bbox_max is not None and len(bbox_min) == 3 and len(bbox_max) == 3:
            thickness = min(abs(float(bbox_max[index]) - float(bbox_min[index])) for index in range(3))
        walls[wall_id] = {
            "id": wall_id,
            "name": wall.get("name"),
            "panel_id": wall.get("panel_id"),
            "position": wall.get("position"),
            "size": wall.get("dims") or wall.get("size"),
            "bbox": bbox,
            "thickness": thickness,
            "thickness_mm": thickness,
        }
    outer_bbox = envelope.get("outer_bbox")
    inner_bbox = envelope.get("inner_bbox")
    install_faces = {
        str(face.get("face_id") or face.get("id")): face
        for face in simulation_input.get("install_faces") or []
        if isinstance(face, dict) and (face.get("face_id") or face.get("id"))
    }
    return {
        "schema_version": "geometry_after/1.0",
        "units": layout.get("units") or {"length": "mm"},
        "outer_shell": {
            "id": "outer_shell",
            "outer_bbox": outer_bbox,
            "inner_bbox": inner_bbox,
            "thickness": envelope.get("shell_thickness", 0.0),
            "thickness_mm": envelope.get("shell_thickness", 0.0),
            "shell_thickness": envelope.get("shell_thickness", 0.0),
        },
        "install_faces": install_faces,
        "cabins": layout.get("cabins") or [],
        "walls": walls,
        "components": components,
    }


def build_registry(geom: dict[str, Any], simulation_input: dict[str, Any]) -> dict[str, Any]:
    entities = []
    for component_id, component in (geom.get("components") or {}).items():
        entities.append(
            {
                "geometry_id": component_id,
                "component_id": component_id,
                "semantic_name": component.get("semantic_name"),
                "display_name": component.get("display_name"),
                "shape": component.get("shape", "box"),
                "bbox": component.get("bbox"),
                "dims": component.get("dims"),
                "position": component.get("position"),
            }
        )
    walls = []
    for wall_id, wall in (geom.get("walls") or {}).items():
        walls.append(
            {
                "wall_id": wall_id,
                "name": wall.get("name"),
                "panel_id": wall.get("panel_id"),
                "bbox": wall.get("bbox"),
                "size": wall.get("size"),
                "position": wall.get("position"),
            }
        )
    return {
        "schema_version": "1.0",
        "units": geom.get("units") or {"length": "mm"},
        "coordinate_system": "body_fixed_xyz",
        "entities": entities,
        "walls": walls,
        "faces": simulation_input.get("install_faces") or [],
    }


def main() -> int:
    args = parse_args()
    cad_dir = Path(args.cad_dir).expanduser().resolve()
    spec_path = Path(args.spec).expanduser().resolve() if args.spec else cad_dir.parent / "00_inputs" / "cad_build_spec.json"
    grid_shape = parse_grid_shape(args.grid_shape)
    simulation_input_path = cad_dir / "simulation_input.json"
    layout = spec_to_layout_data(read_json(spec_path), simulation_only=True, include_walls=True)
    simulation_input = read_json(simulation_input_path)
    geom = build_geom(layout, simulation_input)
    registry = build_registry(geom, simulation_input)

    after_geom_path = cad_dir / "geometry_after.geom.json"
    after_layout_path = cad_dir / "geometry_after.layout_topology.json"
    registry_path = cad_dir / "geometry_after_registry.json"
    comsol_inputs_dir = cad_dir / "comsol_inputs"
    comsol_inputs_dir.mkdir(parents=True, exist_ok=True)
    coord_path = comsol_inputs_dir / "coord.txt"
    channels_path = comsol_inputs_dir / "channels_input.npz"

    write_json(after_geom_path, geom)
    write_json(after_layout_path, layout)
    write_json(registry_path, registry)
    grid_summary = write_grid_inputs(
        geom=geom,
        coord_path=coord_path,
        channels_path=channels_path,
        grid_shape=grid_shape,
    )
    payload = {
        "ok": True,
        "cad_dir": str(cad_dir),
        "outputs": {
            "geometry_after_geom": str(after_geom_path),
            "geometry_after_layout_topology": str(after_layout_path),
            "geometry_after_registry": str(registry_path),
            "coord": str(coord_path),
            "channels_input": str(channels_path),
        },
        "counts": {
            "components": len(geom.get("components") or {}),
            "walls": len(geom.get("walls") or {}),
        },
        "grid": grid_summary,
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
