"""Build CAD-stage artifacts from 00_inputs real_bom + layout_topology + geom."""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import numpy as np

from freecad_cli_tools.layout_dataset import normalize_layout_dataset
from freecad_cli_tools.layout_dataset_io import load_json_file, serialize_json_payload


def build_cad_stage_inputs(
    *,
    real_bom_path: str | Path,
    layout_topology_path: str | Path,
    geom_path: str | Path,
    output_dir: str | Path,
    step_filename: str = "geometry_after.step",
    grid_shape: tuple[int, int, int] = (32, 32, 32),
) -> dict[str, Any]:
    """Write non-FreeCAD CAD-stage artifacts and return build metadata."""
    real_bom_path = Path(real_bom_path)
    layout_topology_path = Path(layout_topology_path)
    geom_path = Path(geom_path)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    real_bom = load_json_file(real_bom_path)
    layout_topology = load_json_file(layout_topology_path)
    geom = load_json_file(geom_path)
    normalized = normalize_layout_dataset(layout_topology, geom)

    after_layout_path = output_dir / "geometry_after.layout_topology.json"
    after_geom_path = output_dir / "geometry_after.geom.json"
    registry_path = output_dir / "geometry_after_registry.json"
    simulation_input_path = output_dir / "simulation_input.json"
    cad_agent_output_path = output_dir / "cad_agent_output.json"
    comsol_inputs_dir = output_dir / "comsol_inputs"
    comsol_inputs_dir.mkdir(parents=True, exist_ok=True)
    coord_path = comsol_inputs_dir / "coord.txt"
    channels_path = comsol_inputs_dir / "channels_input.npz"
    for legacy_path in (output_dir / "coord.txt", output_dir / "channels_input.npz"):
        if legacy_path.exists():
            legacy_path.unlink()

    _write_json(after_layout_path, layout_topology)
    _write_json(after_geom_path, geom)

    registry = build_geometry_registry(layout_topology, geom)
    simulation_input = build_simulation_input(
        real_bom=real_bom,
        layout_topology=layout_topology,
        geom=geom,
        geometry_registry=registry,
        step_filename=step_filename,
    )
    _write_json(registry_path, registry)
    _write_json(simulation_input_path, simulation_input)

    channel_summary = write_grid_inputs(
        geom=geom,
        coord_path=coord_path,
        channels_path=channels_path,
        grid_shape=grid_shape,
    )
    bom_items = real_bom.get("items") if isinstance(real_bom.get("items"), list) else []
    bom_by_component = {
        item.get("component_id"): item for item in bom_items if isinstance(item, dict)
    }
    placed_component_ids = [item["component_id"] for item in simulation_input["components"]]
    cad_agent_output = {
        "schema_version": "1.0",
        "status": "prepared",
        "input_format": "real_bom_layout_topology_geom",
        "source_files": {
            "real_bom": str(real_bom_path.resolve()),
            "layout_topology": str(layout_topology_path.resolve()),
            "geom": str(geom_path.resolve()),
        },
        "output_dir": str(output_dir.resolve()),
        "outputs": {
            "geometry_after_layout_topology": str(after_layout_path),
            "geometry_after_geom": str(after_geom_path),
            "geometry_after_registry": str(registry_path),
            "simulation_input": str(simulation_input_path),
            "comsol_coord": str(coord_path),
            "comsol_channels_input": str(channels_path),
        },
        "counts": {
            "bom_items": len(bom_items),
            "placements": len(layout_topology.get("placements") or []),
            "geom_components": len(geom.get("components") or {}),
            "cad_components": len(placed_component_ids),
            "unplaced_bom_items": len(
                [
                    item
                    for item in bom_items
                    if item.get("component_id") not in set(placed_component_ids)
                ]
            ),
        },
        "checks": {
            "all_placements_have_geom": _all_placements_have_geom(layout_topology, geom),
            "all_placements_have_bom": all(
                component_id in bom_by_component for component_id in placed_component_ids
            ),
            "grid_shape": list(grid_shape),
            **channel_summary,
        },
        "warnings": [
            "comsol_inputs/coord.txt and comsol_inputs/channels_input.npz are generated from axis-aligned geom bounding boxes.",
        ],
    }
    _write_json(cad_agent_output_path, cad_agent_output)

    return {
        "real_bom": real_bom,
        "layout_topology": layout_topology,
        "geom": geom,
        "normalized": normalized,
        "geometry_registry": registry,
        "simulation_input": simulation_input,
        "cad_agent_output": cad_agent_output,
        "paths": {
            "geometry_after_layout_topology": after_layout_path,
            "geometry_after_geom": after_geom_path,
            "geometry_after_registry": registry_path,
            "simulation_input": simulation_input_path,
            "cad_agent_output": cad_agent_output_path,
            "comsol_coord": coord_path,
            "comsol_channels_input": channels_path,
        },
    }


def build_geometry_registry(layout_topology: dict[str, Any], geom: dict[str, Any]) -> dict[str, Any]:
    components = geom.get("components")
    if not isinstance(components, dict):
        raise ValueError("geom.components must be a JSON object.")
    component_by_id = _geom_components_by_component_id(geom)

    entities = []
    for placement in layout_topology.get("placements") or []:
        component_id = str(placement.get("component_id"))
        geom_component = component_by_id.get(component_id)
        if geom_component is None:
            raise ValueError(f"geom.components is missing component_id={component_id!r}.")
        bbox = _component_bbox(geom_component)
        entities.append(
            {
                "geometry_id": placement.get("geometry_id"),
                "component_id": component_id,
                "semantic_name": placement.get("semantic_name") or geom_component.get("semantic_name"),
                "shape": geom_component.get("shape", "box"),
                "bbox": bbox,
                "dims": _vector3(geom_component.get("dims"), f"{component_id}.dims"),
                "position": _vector3(geom_component.get("position"), f"{component_id}.position"),
                "mount_face_id": placement.get("mount_face_id") or geom_component.get("mount_face_id"),
                "component_mount_face_id": placement.get("component_mount_face_id"),
            }
        )

    faces = []
    for face_id, face in (geom.get("install_faces") or {}).items():
        if not isinstance(face, dict):
            continue
        faces.append(
            {
                "face_id": face_id,
                "owner_id": face.get("belongs_to") or face.get("owner_id") or "outer_shell",
                "plane_axis": int(face.get("plane_axis", 0)),
                "plane_value": float(face.get("plane_value", 0.0)),
                "normal_sign": int(face.get("normal_sign", 1)),
                "bbox_2d": face.get("bbox_2d", []),
                "center_xyz": face.get("center_xyz", []),
            }
        )

    return {
        "schema_version": "1.0",
        "units": geom.get("units") or {"length": "mm"},
        "coordinate_system": "body_fixed_xyz",
        "entities": entities,
        "faces": faces,
    }


def build_simulation_input(
    *,
    real_bom: dict[str, Any],
    layout_topology: dict[str, Any],
    geom: dict[str, Any],
    geometry_registry: dict[str, Any],
    step_filename: str,
) -> dict[str, Any]:
    bom_by_id = {
        item.get("component_id"): item
        for item in real_bom.get("items", [])
        if isinstance(item, dict)
    }
    geom_by_component = _geom_components_by_component_id(geom)
    geometry_by_id = {
        entity.get("geometry_id"): entity for entity in geometry_registry.get("entities", [])
    }
    sim_components = []
    for placement in layout_topology.get("placements") or []:
        component_id = str(placement.get("component_id"))
        bom_item = bom_by_id.get(component_id, {})
        geom_component = geom_by_component.get(component_id, {})
        geometry = geometry_by_id.get(placement.get("geometry_id"), {})
        mount_face = _mount_face_by_id(bom_item, placement.get("component_mount_face_id"))
        power = _float_value(
            bom_item.get("power_W", geom_component.get("power", 0.0)),
            default=0.0,
        )
        sim_components.append(
            {
                "component_id": component_id,
                "semantic_name": placement.get("semantic_name")
                or bom_item.get("semantic_name")
                or geom_component.get("semantic_name"),
                "kind": placement.get("kind") or bom_item.get("kind") or geom_component.get("kind"),
                "category": bom_item.get("category") or geom_component.get("category"),
                "geometry_id": placement.get("geometry_id"),
                "thermal_id": placement.get("thermal_id"),
                "component_mount_face_id": placement.get("component_mount_face_id"),
                "component_mount_face": mount_face,
                "mount_face_id": placement.get("mount_face_id"),
                "alignment": placement.get("alignment") or {},
                "is_heat_source": power > 0.0,
                "power_W": power,
                "mass_kg": _float_value(
                    bom_item.get("mass_kg", geom_component.get("mass", 0.0)),
                    default=0.0,
                ),
                "material_id": bom_item.get("material_id")
                or bom_item.get("material_hint")
                or "aluminum_6061",
                "bbox": geometry.get("bbox") or _component_bbox(geom_component),
                "contact_resistance": _float_value(
                    (geom_component.get("thermal_interface") or {}).get(
                        "contact_resistance",
                        (bom_item.get("thermal_interface") or {}).get("contact_resistance", 0.001),
                    ),
                    default=0.001,
                ),
            }
        )

    return {
        "schema_version": "1.0",
        "simulation_input_id": f"{layout_topology.get('layout_id', 'layout')}_simulation_input",
        "step_file": step_filename,
        "source_files": {
            "real_bom": "../00_inputs/real_bom.json",
            "topology": "../00_inputs/layout_topology.json",
            "geom": "../00_inputs/geom.json",
            "geometry_registry": "geometry_after_registry.json",
        },
        "units": {"length": "mm", "power": "W", "contact_resistance": "m^2*K/W"},
        "components": sim_components,
        "install_faces": [
            {
                "face_id": face["face_id"],
                "owner_id": face["owner_id"],
                "plane_axis": face["plane_axis"],
                "plane_value": face["plane_value"],
                "normal_sign": face["normal_sign"],
            }
            for face in geometry_registry.get("faces", [])
        ],
        "shells": [
            {
                "shell_id": (layout_topology.get("outer_shell") or {}).get("id", "outer_shell"),
                "selection_role": "outer_shell",
            }
        ],
        "cabins": [
            {
                "cabin_id": cabin.get("id"),
                "selection_role": "internal_domain",
            }
            for cabin in layout_topology.get("cabins", [])
            if isinstance(cabin, dict)
        ],
        "radiators": [
            item["component_id"] for item in sim_components if item.get("kind") == "radiator"
        ],
        "selection_plan": {
            "component_selections": [
                {
                    "selection_id": f"sel_{item['component_id']}",
                    "component_id": item["component_id"],
                    "semantic_name": item.get("semantic_name"),
                    "step_name": item["component_id"],
                }
                for item in sim_components
            ],
            "install_face_selections": [
                {
                    "selection_id": f"sel_face_{face['face_id'].replace('.', '_')}",
                    "face_id": face["face_id"],
                }
                for face in geometry_registry.get("faces", [])
            ],
            "shell_selections": [],
        },
    }


def write_grid_inputs(
    *,
    geom: dict[str, Any],
    coord_path: Path,
    channels_path: Path,
    grid_shape: tuple[int, int, int],
) -> dict[str, Any]:
    bbox_min, bbox_max, component_bbox_count = _sampling_bbox(geom)
    nx, ny, nz = grid_shape
    xs = np.linspace(bbox_min[0], bbox_max[0], nx)
    ys = np.linspace(bbox_min[1], bbox_max[1], ny)
    zs = np.linspace(bbox_min[2], bbox_max[2], nz)
    mask = np.zeros(grid_shape, dtype=np.uint8)
    power = np.zeros(grid_shape, dtype=np.float32)
    mass = np.zeros(grid_shape, dtype=np.float32)

    lines = []
    for x in xs:
        for y in ys:
            for z in zs:
                lines.append(f"{x / 1000.0:.9g} {y / 1000.0:.9g} {z / 1000.0:.9g}\n")
    coord_path.write_text("".join(lines), encoding="utf-8")

    for component in (geom.get("components") or {}).values():
        if not isinstance(component, dict):
            continue
        bbox = _component_bbox(component)
        min_i = _grid_index(bbox["min"], bbox_min, bbox_max, grid_shape, floor=True)
        max_i = _grid_index(bbox["max"], bbox_min, bbox_max, grid_shape, floor=False)
        slices = tuple(slice(min_i[axis], max_i[axis] + 1) for axis in range(3))
        mask[slices] = 1
        power[slices] += np.float32(_float_value(component.get("power"), default=0.0))
        mass[slices] += np.float32(_float_value(component.get("mass"), default=0.0))

    np.savez_compressed(channels_path, mask=mask, power=power, mass=mass)
    return {
        "occupied_voxels": int(mask.sum()),
        "total_voxels": int(mask.size),
        "total_power_W": float(power.sum()),
        "total_mass_kg": float(mass.sum()),
        "grid_bbox_min": bbox_min,
        "grid_bbox_max": bbox_max,
        "grid_bbox_units": "mm",
        "grid_bbox_source": "outer_shell.outer_bbox+geom.components.bbox",
        "grid_component_bbox_count": component_bbox_count,
    }


def write_json_file(path: str | Path, payload: dict[str, Any]) -> None:
    """Write a stable JSON payload to disk."""
    _write_json(Path(path), payload)


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(serialize_json_payload(payload), encoding="utf-8")


def geom_components_by_component_id(geom: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Return geom.components keyed by canonical component_id."""
    return _geom_components_by_component_id(geom)


def _geom_components_by_component_id(geom: dict[str, Any]) -> dict[str, dict[str, Any]]:
    result = {}
    for key, value in (geom.get("components") or {}).items():
        if not isinstance(value, dict):
            continue
        component_id = value.get("component_id") or value.get("id") or key
        result[str(component_id)] = value
    return result


def _all_placements_have_geom(layout_topology: dict[str, Any], geom: dict[str, Any]) -> bool:
    components = _geom_components_by_component_id(geom)
    return all(
        str(placement.get("component_id")) in components
        for placement in layout_topology.get("placements") or []
    )


def component_bbox(component: dict[str, Any]) -> dict[str, list[float]]:
    """Return a component bbox from bbox or position+dims fields."""
    return _component_bbox(component)


def _component_bbox(component: dict[str, Any]) -> dict[str, list[float]]:
    bbox = component.get("bbox")
    if isinstance(bbox, dict) and "min" in bbox and "max" in bbox:
        return {
            "min": _vector3(bbox.get("min"), "component.bbox.min"),
            "max": _vector3(bbox.get("max"), "component.bbox.max"),
        }
    position = _vector3(component.get("position"), "component.position")
    dims = _vector3(component.get("dims"), "component.dims")
    return {"min": position, "max": [position[index] + dims[index] for index in range(3)]}


def _sampling_bbox(geom: dict[str, Any]) -> tuple[list[float], list[float], int]:
    outer_bbox = geom.get("outer_shell", {}).get("outer_bbox")
    if not isinstance(outer_bbox, dict):
        raise ValueError("geom.outer_shell.outer_bbox must be a JSON object.")
    bbox_min = _vector3(outer_bbox.get("min"), "outer_shell.outer_bbox.min")
    bbox_max = _vector3(outer_bbox.get("max"), "outer_shell.outer_bbox.max")

    component_bbox_count = 0
    for component in (geom.get("components") or {}).values():
        if not isinstance(component, dict):
            continue
        component_bbox = _component_bbox(component)
        component_bbox_count += 1
        for axis in range(3):
            bbox_min[axis] = min(bbox_min[axis], component_bbox["min"][axis])
            bbox_max[axis] = max(bbox_max[axis], component_bbox["max"][axis])

    return bbox_min, bbox_max, component_bbox_count


def _mount_face_by_id(bom_item: dict[str, Any], component_mount_face_id: Any) -> dict[str, Any]:
    mounting = bom_item.get("mounting") if isinstance(bom_item, dict) else None
    faces = mounting.get("mount_faces") if isinstance(mounting, dict) else None
    if isinstance(faces, list):
        for face in faces:
            if isinstance(face, dict) and face.get("component_mount_face_id") == component_mount_face_id:
                return {
                    "local_face": face.get("local_face"),
                    "normal_axis": face.get("normal_axis"),
                    "normal_sign": face.get("normal_sign"),
                    "u_axis": face.get("u_axis"),
                    "v_axis": face.get("v_axis"),
                }
    local_face = str(component_mount_face_id or "").split(".")[-1].replace("local_", "")
    axis = {"x": 0, "y": 1, "z": 2}.get(local_face[:1], 0)
    sign = -1 if local_face.endswith("min") else 1
    other_axes = [item for item in (0, 1, 2) if item != axis]
    return {
        "local_face": local_face or None,
        "normal_axis": axis,
        "normal_sign": sign,
        "u_axis": other_axes[0],
        "v_axis": other_axes[1],
    }


def _vector3(value: Any, label: str) -> list[float]:
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        raise ValueError(f"{label} must be a 3-value array.")
    return [float(item) for item in value]


def _float_value(value: Any, *, default: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    if math.isnan(parsed) or math.isinf(parsed):
        return default
    return parsed


def _grid_index(
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
        ratio = (point[axis] - bbox_min[axis]) / span
        raw = ratio * (count - 1)
        index = math.floor(raw) if floor else math.ceil(raw)
        result.append(max(0, min(count - 1, int(index))))
    return result
