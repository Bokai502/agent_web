"""Prepare simulation after-state files from CAD-native outputs."""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any

import numpy as np

from cad_builders.catch_simulation_preprocess import preprocess_catch_simulation_spec


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
    simulation_walls = {
        str(item.get("wall_id") or item.get("component_id") or item.get("id")): item
        for item in simulation_input.get("walls") or []
        if isinstance(item, dict) and (item.get("wall_id") or item.get("component_id") or item.get("id"))
    }
    for wall in layout.get("walls") or []:
        wall_id = str(wall.get("id") or wall.get("wall_id") or wall.get("name") or f"wall_{len(walls) + 1}")
        sim_wall = simulation_walls.get(wall_id, {})
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
            "material_id": sim_wall.get("material_id", "aluminum_6061"),
            "thermalconductivity": sim_wall.get("thermalconductivity", sim_wall.get("conductivity_W_mK", 167.0)),
            "conductivity_W_mK": sim_wall.get("conductivity_W_mK", sim_wall.get("thermalconductivity", 167.0)),
            "density": sim_wall.get("density", 2700.0),
            "heatcapacity": sim_wall.get("heatcapacity", sim_wall.get("heat_capacity_J_kgK", 896.0)),
            "heat_capacity_J_kgK": sim_wall.get("heat_capacity_J_kgK", sim_wall.get("heatcapacity", 896.0)),
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
