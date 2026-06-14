"""Normalize layout_topology.json + geom.json into an assembly build spec."""

from __future__ import annotations

import os
from copy import deepcopy
from pathlib import Path
from typing import Any

from freecad_cli_tools.geometry import (
    EPSILON,
    apply_in_plane_spin,
    box_bounds,
    component_local_extents,
    compute_mount_point,
    normalize_spin_quarter_turns,
    rotation_for_component_contact_face,
    rotation_matrix_from_component,
)
from freecad_cli_tools.layout_dataset_common import (
    LayoutDatasetError,
    bbox_size,
    require_number,
    require_string,
    vector3,
)
from freecad_cli_tools.layout_dataset_faces import (
    component_face_id_to_layout_face_id,
    component_local_face_to_face_id,
    dataset_install_pos_from_face,
    dataset_mount_point_from_face,
    face_id_to_layout_mount_face_id,
    layout_mount_face_to_face_id,
    resolve_geom_install_face,
    resolve_layout_mount_face_id,
)
from freecad_cli_tools.layout_dataset_io import (
    atomic_write_text,
    cleanup_atomic_file,
    load_json_file,
    restore_atomic_target,
    serialize_json_payload,
    stage_atomic_text,
    stage_existing_file_backup,
)


def load_and_normalize_layout_dataset(
    layout_topology_path: str | Path,
    geom_path: str | Path,
) -> dict[str, Any]:
    """Load and normalize a layout dataset pair from disk."""
    layout_topology, geom = load_layout_dataset_files(layout_topology_path, geom_path)
    return normalize_layout_dataset(layout_topology, geom)


def load_layout_dataset_files(
    layout_topology_path: str | Path,
    geom_path: str | Path,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Load the raw layout dataset JSON objects from disk."""
    return load_json_file(layout_topology_path), load_json_file(geom_path)


def save_layout_dataset_file(path: str | Path, payload: dict[str, Any]) -> None:
    """Write a layout dataset JSON object to disk."""
    atomic_write_text(
        Path(path),
        serialize_json_payload(payload),
        replace_file=os.replace,
    )


def save_layout_dataset_files(
    layout_topology_path: str | Path,
    layout_topology: dict[str, Any],
    geom_path: str | Path,
    geom: dict[str, Any],
) -> None:
    """Write layout_topology.json + geom.json with rollback on mid-write failure."""
    layout_path = Path(layout_topology_path)
    geom_output_path = Path(geom_path)
    layout_temp: Path | None = None
    geom_temp: Path | None = None
    layout_backup: Path | None = None
    geom_backup: Path | None = None
    layout_existed = layout_path.exists()
    geom_existed = geom_output_path.exists()
    layout_replaced = False
    geom_replaced = False

    try:
        layout_temp = stage_atomic_text(
            layout_path,
            serialize_json_payload(layout_topology),
        )
        geom_temp = stage_atomic_text(
            geom_output_path,
            serialize_json_payload(geom),
        )
        layout_backup = stage_existing_file_backup(layout_path)
        geom_backup = stage_existing_file_backup(geom_output_path)

        os.replace(layout_temp, layout_path)
        layout_replaced = True
        layout_temp = None

        os.replace(geom_temp, geom_output_path)
        geom_replaced = True
        geom_temp = None
    except Exception:
        if geom_replaced:
            restore_atomic_target(
                geom_output_path,
                geom_backup,
                geom_existed,
                replace_file=os.replace,
            )
            geom_backup = None
        if layout_replaced:
            restore_atomic_target(
                layout_path,
                layout_backup,
                layout_existed,
                replace_file=os.replace,
            )
            layout_backup = None
        raise
    finally:
        cleanup_atomic_file(layout_temp)
        cleanup_atomic_file(geom_temp)
        cleanup_atomic_file(layout_backup)
        cleanup_atomic_file(geom_backup)


def normalize_layout_dataset(
    layout_topology: dict[str, Any],
    geom: dict[str, Any],
) -> dict[str, Any]:
    """Convert layout_topology.json + geom.json into a build-ready assembly spec."""
    if not isinstance(layout_topology, dict):
        raise LayoutDatasetError("layout_topology data must be a JSON object.")
    if not isinstance(geom, dict):
        raise LayoutDatasetError("geom data must be a JSON object.")

    outer_shell = geom.get("outer_shell")
    if not isinstance(outer_shell, dict):
        raise LayoutDatasetError("geom.outer_shell must be a JSON object.")

    components = geom.get("components")
    if not isinstance(components, dict) or not components:
        raise LayoutDatasetError("geom.components must be a non-empty object.")

    placements = layout_topology.get("placements")
    if not isinstance(placements, list) or not placements:
        raise LayoutDatasetError("layout_topology.placements must be a non-empty array.")

    normalized_components: dict[str, Any] = {}
    for placement in placements:
        normalized = _normalize_component(placement, components)
        normalized_components[normalized["id"]] = normalized

    envelope = {
        "outer_bbox": {
            "min": vector3(
                (outer_shell.get("outer_bbox") or {}).get("min"),
                "geom.outer_shell.outer_bbox.min",
            ),
            "max": vector3(
                (outer_shell.get("outer_bbox") or {}).get("max"),
                "geom.outer_shell.outer_bbox.max",
            ),
        },
        "inner_bbox": {
            "min": vector3(
                (outer_shell.get("inner_bbox") or {}).get("min"),
                "geom.outer_shell.inner_bbox.min",
            ),
            "max": vector3(
                (outer_shell.get("inner_bbox") or {}).get("max"),
                "geom.outer_shell.inner_bbox.max",
            ),
        },
        "outer_size": bbox_size(outer_shell.get("outer_bbox"), "geom.outer_shell.outer_bbox"),
        "inner_size": bbox_size(outer_shell.get("inner_bbox"), "geom.outer_shell.inner_bbox"),
        "shell_thickness": require_number(
            outer_shell.get("thickness"),
            "geom.outer_shell.thickness",
        ),
    }

    return {
        "schema_version": "layout_dataset_normalized/1.0",
        "units": geom.get("units") or {},
        "source": {
            "layout_id": layout_topology.get("layout_id"),
            "source_design_id": layout_topology.get("source_design_id"),
            "topology_schema_version": layout_topology.get("schema_version"),
            "geom_schema_version": geom.get("schema_version"),
        },
        "envelope": envelope,
        "cabins": normalize_cabins(layout_topology),
        "walls": normalize_walls(layout_topology, geom),
        "components": normalized_components,
    }


def normalize_cabins(layout_topology: dict[str, Any]) -> list[dict[str, Any]]:
    cabins = layout_topology.get("cabins")
    if not isinstance(cabins, list):
        return []
    normalized = []
    for cabin in cabins:
        if not isinstance(cabin, dict):
            continue
        cabin_id = cabin.get("id")
        if not isinstance(cabin_id, str) or not cabin_id.strip():
            continue
        normalized.append(deepcopy(cabin))
    return normalized


def normalize_walls(layout_topology: dict[str, Any], geom: dict[str, Any]) -> list[dict[str, Any]]:
    """Normalize explicit structural wall/panel solids for CAD export."""
    raw_walls = layout_topology.get("walls")
    if not isinstance(raw_walls, list):
        raw_walls = []
    geom_walls = geom.get("walls")
    if not isinstance(geom_walls, dict):
        geom_walls = {}

    normalized = []
    for wall in raw_walls:
        if not isinstance(wall, dict):
            continue
        wall_id = wall.get("id")
        if not isinstance(wall_id, str) or not wall_id.strip():
            continue
        geom_wall = geom_walls.get(wall_id)
        if not isinstance(geom_wall, dict):
            geom_wall = {}
        bbox = wall.get("bbox") or geom_wall.get("bbox")
        if not isinstance(bbox, dict):
            continue
        bbox_min = vector3(bbox.get("min"), f"wall[{wall_id!r}].bbox.min")
        bbox_max = vector3(bbox.get("max"), f"wall[{wall_id!r}].bbox.max")
        size = [bbox_max[axis] - bbox_min[axis] for axis in range(3)]
        if any(length <= 0.0 for length in size):
            raise LayoutDatasetError(f"wall {wall_id!r} bbox must have positive size.")
        normalized_wall = deepcopy(wall)
        normalized_wall["id"] = wall_id
        normalized_wall["bbox"] = {"min": bbox_min, "max": bbox_max}
        normalized_wall["size"] = size
        normalized_wall["position"] = bbox_min
        if "panel_id" not in normalized_wall and isinstance(geom_wall.get("panel_id"), str):
            normalized_wall["panel_id"] = geom_wall["panel_id"]
        if "name" not in normalized_wall and isinstance(geom_wall.get("name"), str):
            normalized_wall["name"] = geom_wall["name"]
        normalized.append(normalized_wall)
    return normalized


def bbox_min_to_local_origin(
    bbox_min: list[float],
    dims: list[float],
    rotation_matrix: list[list[int]],
) -> list[float]:
    """Convert an axis-aligned bbox minimum into the component local origin."""
    if len(bbox_min) != 3:
        raise LayoutDatasetError(f"Expected 3 bbox-min values, got {bbox_min!r}.")
    if len(dims) != 3:
        raise LayoutDatasetError(
            f"Expected 3 dims values when deriving placement.position, got {dims!r}."
        )

    origin: list[float] = []
    for row in range(3):
        negative_offset = sum(
            min(0.0, float(rotation_matrix[row][column]) * float(dims[column]))
            for column in range(3)
        )
        origin.append(float(bbox_min[row]) - negative_offset)
    return origin


def update_layout_dataset_component_placement(
    layout_topology: dict[str, Any],
    geom: dict[str, Any],
    component_id: str,
    normalized_component: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Write one updated normalized component back into layout_topology + geom."""
    updated_layout_topology = deepcopy(layout_topology)
    updated_geom = deepcopy(geom)

    placement = _find_layout_placement(updated_layout_topology, component_id)
    geom_component, _ = _find_geom_component(
        updated_geom,
        placement,
        normalized_component,
        component_id,
    )

    normalized_placement = normalized_component.get("placement")
    if not isinstance(normalized_placement, dict):
        raise LayoutDatasetError(f"Normalized component {component_id!r} is missing placement.")

    install_face_id = layout_mount_face_to_face_id(
        require_string(
            normalized_placement.get("mount_face_id"),
            f"components[{component_id!r}].placement.mount_face_id",
        )
    )
    component_face_id = _component_mount_face_from_normalized(
        component_id,
        normalized_component,
    )
    orientation_rows = _normalized_component_rotation_matrix(normalized_component)
    extents = component_local_extents(component_id, normalized_component)
    position = vector3(
        normalized_placement.get("position"),
        f"components[{component_id!r}].placement.position",
    )
    bounds = box_bounds(position, extents, orientation_rows)
    bbox_min = [float(axis_bounds[0]) for axis_bounds in bounds]

    mount_face_id, mount_owner_id = resolve_layout_mount_face_id(
        updated_layout_topology,
        install_face_id,
        current_placement=placement,
    )
    component_mount_face_id = component_face_id_to_layout_face_id(
        component_id,
        component_face_id,
    )
    in_plane_rotation_deg = infer_in_plane_rotation_deg(
        component_face_id,
        install_face_id,
        orientation_rows,
    )
    clearance = float(geom_component.get("clearance_mm", 0.0) or 0.0)
    mount_point = compute_mount_point(
        position,
        extents,
        component_face_id,
        orientation_rows,
    )

    placement["mount_face_id"] = mount_face_id
    placement["component_mount_face_id"] = component_mount_face_id
    placement["cabin_id"] = None if mount_owner_id == "outer" else mount_owner_id
    alignment = placement.setdefault("alignment", {})
    alignment["normal_alignment"] = "opposite"
    alignment["component_u_axis_to_target_u_axis"] = True
    alignment["in_plane_rotation_deg"] = in_plane_rotation_deg

    geom_install_face = resolve_geom_install_face(updated_geom, mount_face_id)

    geom_component["mount_face_id"] = mount_face_id
    geom_component["position"] = bbox_min
    geom_component["mount_point"] = dataset_mount_point_from_face(
        mount_point,
        geom_install_face,
        clearance,
    )
    if "install_pos" in geom_component or clearance > 0.0:
        geom_component["install_pos"] = dataset_install_pos_from_face(
            bbox_min,
            geom_install_face,
            clearance,
        )
    if "leaf_node_id" in geom_component or mount_owner_id:
        geom_component["leaf_node_id"] = (
            "leaf.outer" if mount_owner_id == "outer" else f"leaf.{mount_owner_id}"
        )

    return updated_layout_topology, updated_geom


def infer_in_plane_rotation_deg(
    component_face_id: int,
    install_face_id: int,
    rotation_matrix: list[list[int]],
) -> float:
    """Infer the dataset in-plane rotation angle from a normalized rotation matrix."""
    base_rotation = rotation_for_component_contact_face(
        component_face_id,
        install_face_id,
    )
    normalized_rotation = [[int(value) for value in row] for row in rotation_matrix]
    for spin_quarter_turns in range(4):
        candidate = apply_in_plane_spin(
            base_rotation=base_rotation,
            target_envelope_face=install_face_id,
            spin_quarter_turns=spin_quarter_turns,
        )
        if candidate == normalized_rotation:
            return float(spin_quarter_turns * 90)

    raise LayoutDatasetError(
        "rotation_matrix cannot be represented as "
        f"component_face={component_face_id}, install_face={install_face_id}, "
        "and an in-plane quarter-turn rotation."
    )


def _normalize_component(
    placement: dict[str, Any],
    geom_components: dict[str, Any],
) -> dict[str, Any]:
    if not isinstance(placement, dict):
        raise LayoutDatasetError("Each placement must be a JSON object.")

    component_id = require_string(placement.get("component_id"), "placement.component_id")
    geom_component_key, geom_component = _resolve_geom_component_for_placement(
        placement,
        geom_components,
        component_id,
    )

    dims = vector3(geom_component.get("dims"), f"geom.components[{geom_component_key!r}].dims")
    install_face_id = layout_mount_face_to_face_id(
        require_string(
            placement.get("mount_face_id"),
            f"placement[{component_id!r}].mount_face_id",
        )
    )
    component_face_id = component_local_face_to_face_id(
        require_string(
            placement.get("component_mount_face_id"),
            f"placement[{component_id!r}].component_mount_face_id",
        )
    )
    orientation_rows = _rotation_matrix_from_placement(
        component_id=component_id,
        placement=placement,
        component_face_id=component_face_id,
        install_face_id=install_face_id,
    )
    bbox_min = vector3(
        geom_component.get("position"),
        f"geom.components[{geom_component_key!r}].position",
    )
    position = bbox_min_to_local_origin(bbox_min, dims, orientation_rows)

    normalized: dict[str, Any] = {
        "id": component_id,
        "component_id": component_id,
        "shape": geom_component.get("shape", "box"),
        "dims": dims,
        "color": geom_component.get("color"),
        "mass": geom_component.get("mass"),
        "power": geom_component.get("power"),
        "kind": placement.get("kind", geom_component.get("kind")),
        "category": geom_component.get("category"),
        "semantic_name": placement.get("semantic_name"),
        "source_mount_face_id": geom_component.get("mount_face_id"),
        "source_bbox_min": bbox_min,
        "placement": {
            "position": position,
            "mount_face_id": placement.get("mount_face_id"),
            "component_mount_face_id": placement.get("component_mount_face_id"),
            "alignment": deepcopy(placement.get("alignment") or {}),
        },
    }

    model = geom_component.get("model")
    if model:
        normalized["model"] = model

    return normalized


def _find_layout_placement(
    layout_topology: dict[str, Any],
    component_id: str,
) -> dict[str, Any]:
    placements = layout_topology.get("placements")
    if not isinstance(placements, list):
        raise LayoutDatasetError("layout_topology.placements must be an array.")
    for placement in placements:
        if isinstance(placement, dict) and placement.get("component_id") == component_id:
            return placement
    raise LayoutDatasetError(
        f"layout_topology.placements is missing component_id={component_id!r}."
    )


def _find_geom_component(
    geom: dict[str, Any],
    layout_placement: dict[str, Any],
    normalized_component: dict[str, Any],
    component_id: str,
) -> tuple[dict[str, Any], str]:
    geom_components = geom.get("components")
    if not isinstance(geom_components, dict):
        raise LayoutDatasetError("geom.components must be a JSON object.")

    normalized_component_id = normalized_component.get("component_id")
    if isinstance(normalized_component_id, str) and normalized_component_id.strip():
        geom_component = geom_components.get(normalized_component_id)
        if isinstance(geom_component, dict):
            return geom_component, normalized_component_id

    geom_component_key, geom_component = _resolve_geom_component_for_placement(
        layout_placement,
        geom_components,
        component_id,
    )
    return geom_component, geom_component_key


def _resolve_geom_component_for_placement(
    placement: dict[str, Any],
    geom_components: dict[str, Any],
    component_id: str,
) -> tuple[str, dict[str, Any]]:
    """Resolve the backing geom.components entry for one placement.

    The current dataset preserves the stable CAD-facing component id directly
    under geom.components[*].component_id.
    """
    if not isinstance(geom_components, dict) or not geom_components:
        raise LayoutDatasetError("geom.components must be a non-empty object.")

    direct_geom_component = geom_components.get(component_id)
    if isinstance(direct_geom_component, dict):
        return component_id, direct_geom_component

    matching_keys = [
        key
        for key, geom_component in geom_components.items()
        if isinstance(key, str)
        and isinstance(geom_component, dict)
        and (
            geom_component.get("component_id") == component_id
            or geom_component.get("id") == component_id
        )
    ]
    if len(matching_keys) == 1:
        matched_key = matching_keys[0]
        geom_component = geom_components[matched_key]
        if isinstance(geom_component, dict):
            return matched_key, geom_component
    if len(matching_keys) > 1:
        raise LayoutDatasetError(
            "Placement "
            f"{component_id!r} matched multiple geom.components entries by component_id: "
            f"{matching_keys!r}."
        )

    raise LayoutDatasetError(
        "Placement "
        f"{component_id!r} could not be resolved to a geom.components entry. "
        "Expected geom.components[component_id], or exactly one "
        "geom.components[*].component_id matching placement.component_id."
    )


def _component_mount_face_from_normalized(
    component_id: str,
    normalized_component: dict[str, Any],
) -> int:
    placement = normalized_component.get("placement")
    if not isinstance(placement, dict):
        raise LayoutDatasetError(f"Normalized component {component_id!r} is missing placement.")

    component_face_id = placement.get("component_mount_face_id")
    if component_face_id is not None:
        return component_local_face_to_face_id(component_face_id)

    raise LayoutDatasetError(
        f"components[{component_id!r}].placement.component_mount_face_id is required."
    )


def _normalized_component_rotation_matrix(
    normalized_component: dict[str, Any],
) -> list[list[int]]:
    rotation_matrix = rotation_matrix_from_component(normalized_component)
    return [[int(value) for value in row] for row in rotation_matrix]


def _rotation_matrix_from_placement(
    *,
    component_id: str,
    placement: dict[str, Any],
    component_face_id: int,
    install_face_id: int,
) -> list[list[int]]:
    alignment = placement.get("alignment") or {}
    if not isinstance(alignment, dict):
        raise LayoutDatasetError(f"Placement {component_id!r}: alignment must be a JSON object.")

    normal_alignment = alignment.get("normal_alignment", "opposite")
    if normal_alignment != "opposite":
        raise LayoutDatasetError(
            f"Placement {component_id!r}: unsupported normal_alignment={normal_alignment!r}."
        )

    if alignment.get("component_u_axis_to_target_u_axis", True) is not True:
        raise LayoutDatasetError(
            f"Placement {component_id!r}: component_u_axis_to_target_u_axis=false is not supported."
        )

    rotation_matrix = rotation_for_component_contact_face(
        component_face_id,
        install_face_id,
    )
    in_plane_rotation_deg = float(alignment.get("in_plane_rotation_deg", 0.0))
    if abs(in_plane_rotation_deg) > EPSILON:
        rotation_matrix = apply_in_plane_spin(
            base_rotation=rotation_matrix,
            target_envelope_face=install_face_id,
            spin_quarter_turns=normalize_spin_quarter_turns(in_plane_rotation_deg),
        )
    return rotation_matrix


__all__ = [
    "LayoutDatasetError",
    "bbox_min_to_local_origin",
    "component_face_id_to_layout_face_id",
    "component_local_face_to_face_id",
    "dataset_install_pos_from_face",
    "dataset_mount_point_from_face",
    "face_id_to_layout_mount_face_id",
    "infer_in_plane_rotation_deg",
    "layout_mount_face_to_face_id",
    "load_and_normalize_layout_dataset",
    "load_layout_dataset_files",
    "normalize_cabins",
    "normalize_layout_dataset",
    "normalize_walls",
    "resolve_geom_install_face",
    "resolve_layout_mount_face_id",
    "save_layout_dataset_file",
    "save_layout_dataset_files",
    "update_layout_dataset_component_placement",
]
