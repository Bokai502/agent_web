"""Validate 01_cad outputs against 00_inputs and generated CAD artifacts."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from freecad_cli_tools.cad_inputs import (
    component_bbox,
    geom_components_by_component_id,
    write_json_file,
)
from freecad_cli_tools.layout_dataset_io import load_json_file


REQUIRED_CAD_FILES = (
    "geometry_after.step",
    "geometry_after.glb",
    "simulation_input.json",
    "cad_agent_output.json",
    "comsol_inputs/coord.txt",
    "comsol_inputs/channels_input.npz",
    "geometry_after.geom.json",
    "geometry_after.layout_topology.json",
    "geometry_after_registry.json",
)


def validate_cad_build(
    *,
    real_bom_path: str | Path,
    layout_topology_path: str | Path,
    geom_path: str | Path,
    cad_dir: str | Path,
    tolerance_mm: float = 1e-3,
    max_occupancy_ratio: float = 1.0,
    screenshot_result: dict[str, Any] | None = None,
    write_back: bool = True,
) -> dict[str, Any]:
    """Validate CAD build artifacts and optionally merge into cad_agent_output.json."""
    real_bom_path = Path(real_bom_path)
    layout_topology_path = Path(layout_topology_path)
    geom_path = Path(geom_path)
    cad_dir = Path(cad_dir)

    real_bom = load_json_file(real_bom_path)
    layout_topology = load_json_file(layout_topology_path)
    source_geom = load_json_file(geom_path)
    after_geom_path = cad_dir / "geometry_after.geom.json"
    after_topology_path = cad_dir / "geometry_after.layout_topology.json"
    registry_path = cad_dir / "geometry_after_registry.json"
    simulation_input_path = cad_dir / "simulation_input.json"
    cad_agent_output_path = cad_dir / "cad_agent_output.json"

    after_geom = load_json_file(after_geom_path) if after_geom_path.exists() else source_geom
    after_topology = (
        load_json_file(after_topology_path) if after_topology_path.exists() else layout_topology
    )
    registry = load_json_file(registry_path) if registry_path.exists() else {"entities": []}
    simulation_input = (
        load_json_file(simulation_input_path) if simulation_input_path.exists() else {"components": []}
    )
    cad_agent_output = (
        load_json_file(cad_agent_output_path)
        if cad_agent_output_path.exists()
        else {"schema_version": "1.0"}
    )

    failures: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    files_check = _check_required_files(cad_dir, failures)
    contract_check = _check_contracts(
        real_bom=real_bom,
        layout_topology=after_topology,
        geom=after_geom,
        registry=registry,
        simulation_input=simulation_input,
        failures=failures,
    )
    bbox_check = _check_bboxes(after_geom, after_topology, warnings, tolerance_mm)
    contact_check = _check_mount_contact(after_geom, after_topology, warnings, tolerance_mm)
    occupancy = _face_occupancy(after_geom, after_topology, warnings, max_occupancy_ratio)

    summary = {
        "component_count": len(after_topology.get("placements") or []),
        "missing_file_count": len(files_check["missing"]),
        "empty_file_count": len(files_check["empty"]),
        "bbox_failure_count": bbox_check["failure_count"],
        "bbox_overlap_count": len(bbox_check["overlaps"]),
        "contact_failure_count": contact_check["failure_count"],
        "face_occupancy_max": occupancy["max_occupancy_ratio"],
        "over_capacity_face_count": len(occupancy["over_capacity_faces"]),
    }
    success = not failures
    status = "failed" if not success else "passed_with_warnings" if warnings else "passed"
    report = {
        "schema_version": "1.0",
        "success": success,
        "status": status,
        "summary": summary,
        "checks": {
            "files": files_check,
            "contracts": contract_check,
            "bbox": bbox_check,
            "mount_contact": contact_check,
            "face_occupancy": {
                "ok": not occupancy["over_capacity_faces"],
                "max_occupancy_ratio": occupancy["max_occupancy_ratio"],
                "over_capacity_faces": occupancy["over_capacity_faces"],
            },
        },
        "face_occupancy": occupancy["faces"],
        "failures": failures,
        "warnings": warnings,
        "settings": {
            "tolerance_mm": tolerance_mm,
            "max_occupancy_ratio": max_occupancy_ratio,
        },
    }

    if write_back:
        cad_agent_output["validation"] = report
        if screenshot_result is not None:
            cad_agent_output["screenshot"] = screenshot_result
        cad_agent_output["status"] = "validated" if success else "validation_failed"
        write_json_file(cad_agent_output_path, cad_agent_output)
    return report


def _check_required_files(cad_dir: Path, failures: list[dict[str, Any]]) -> dict[str, Any]:
    missing = []
    empty = []
    files = {}
    for name in REQUIRED_CAD_FILES:
        path = cad_dir / name
        exists = path.exists()
        size = path.stat().st_size if exists else 0
        files[name] = {"path": str(path), "exists": exists, "size_bytes": size}
        if not exists:
            missing.append(name)
            failures.append({"check": "files", "code": "missing_file", "path": str(path)})
        elif size <= 0:
            empty.append(name)
            failures.append({"check": "files", "code": "empty_file", "path": str(path)})
    return {"ok": not missing and not empty, "missing": missing, "empty": empty, "files": files}


def _check_contracts(
    *,
    real_bom: dict[str, Any],
    layout_topology: dict[str, Any],
    geom: dict[str, Any],
    registry: dict[str, Any],
    simulation_input: dict[str, Any],
    failures: list[dict[str, Any]],
) -> dict[str, Any]:
    placements = layout_topology.get("placements") or []
    geom_by_component = geom_components_by_component_id(geom)
    bom_ids = {
        item.get("component_id")
        for item in real_bom.get("items", [])
        if isinstance(item, dict)
    }
    registry_geometry_ids = {
        item.get("geometry_id") for item in registry.get("entities", []) if isinstance(item, dict)
    }
    simulation_component_ids = {
        item.get("component_id")
        for item in simulation_input.get("components", [])
        if isinstance(item, dict)
    }
    missing_geom = []
    missing_bom = []
    missing_registry = []
    for placement in placements:
        component_id = placement.get("component_id")
        if component_id not in geom_by_component:
            missing_geom.append(component_id)
        if component_id not in bom_ids:
            missing_bom.append(component_id)
        if placement.get("geometry_id") not in registry_geometry_ids:
            missing_registry.append(placement.get("geometry_id"))
    missing_sim = sorted({item.get("component_id") for item in placements} - simulation_component_ids)

    for code, values in (
        ("missing_geom_component", missing_geom),
        ("missing_bom_component", missing_bom),
        ("missing_registry_geometry", missing_registry),
        ("missing_simulation_component", missing_sim),
    ):
        for value in values:
            failures.append({"check": "contracts", "code": code, "id": value})

    step_file_ok = simulation_input.get("step_file") == "geometry_after.step"
    if not step_file_ok:
        failures.append(
            {
                "check": "contracts",
                "code": "unexpected_simulation_step_file",
                "value": simulation_input.get("step_file"),
            }
        )
    ok = not (missing_geom or missing_bom or missing_registry or missing_sim) and step_file_ok
    return {
        "ok": ok,
        "missing_geom_components": missing_geom,
        "missing_bom_components": missing_bom,
        "missing_registry_geometry_ids": missing_registry,
        "missing_simulation_components": missing_sim,
        "simulation_step_file_ok": step_file_ok,
    }


def _check_bboxes(
    geom: dict[str, Any],
    layout_topology: dict[str, Any],
    failures: list[dict[str, Any]],
    tolerance_mm: float,
) -> dict[str, Any]:
    geom_by_component = geom_components_by_component_id(geom)
    overlaps = []
    invalid = []
    components = []
    for placement in layout_topology.get("placements") or []:
        component_id = placement.get("component_id")
        component = geom_by_component.get(component_id)
        if not component:
            continue
        bbox = component_bbox(component)
        if any(bbox["max"][axis] <= bbox["min"][axis] for axis in range(3)):
            invalid.append(component_id)
            failures.append({"check": "bbox", "code": "invalid_bbox", "component_id": component_id})
        components.append((component_id, placement.get("kind"), bbox))

    outer_shell = geom.get("outer_shell") or {}
    inner_bbox = outer_shell.get("inner_bbox")
    outer_bbox = outer_shell.get("outer_bbox")
    outside_envelope = []
    for component_id, kind, bbox in components:
        if kind in {"external", "radiator"}:
            continue
        container = inner_bbox
        if isinstance(container, dict) and not _bbox_contains(container, bbox, tolerance_mm):
            outside_envelope.append(component_id)
            failures.append(
                {"check": "bbox", "code": "outside_expected_envelope", "component_id": component_id}
            )

    for index, (a_id, _a_kind, a_bbox) in enumerate(components):
        for b_id, _b_kind, b_bbox in components[index + 1 :]:
            volume = _bbox_overlap_volume(a_bbox, b_bbox, tolerance_mm)
            if volume > tolerance_mm:
                overlaps.append({"a": a_id, "b": b_id, "volume_mm3": volume})
                failures.append(
                    {"check": "bbox", "code": "component_overlap", "a": a_id, "b": b_id, "volume_mm3": volume}
                )

    return {
        "ok": not invalid and not outside_envelope and not overlaps,
        "failure_count": len(invalid) + len(outside_envelope) + len(overlaps),
        "invalid_components": invalid,
        "outside_expected_envelope": outside_envelope,
        "overlaps": overlaps,
    }


def _check_mount_contact(
    geom: dict[str, Any],
    layout_topology: dict[str, Any],
    failures: list[dict[str, Any]],
    tolerance_mm: float,
) -> dict[str, Any]:
    geom_by_component = geom_components_by_component_id(geom)
    faces = geom.get("install_faces") or {}
    contact_failures = []
    footprint_failures = []
    for placement in layout_topology.get("placements") or []:
        component_id = placement.get("component_id")
        component = geom_by_component.get(component_id)
        face = faces.get(placement.get("mount_face_id"))
        if not component or not isinstance(face, dict):
            continue
        bbox = component_bbox(component)
        axis = int(face.get("plane_axis", 0))
        plane_value = float(face.get("plane_value", 0.0))
        contact = _bbox_mount_plane_contact(bbox, axis, plane_value)
        if contact["distance_mm"] > tolerance_mm:
            item = {
                "component_id": component_id,
                "mount_face_id": placement.get("mount_face_id"),
                "axis": axis,
                "expected_plane_value": plane_value,
                "actual_contact_value": contact["value"],
                "actual_contact_side": contact["side"],
                "delta_mm": contact["delta_mm"],
            }
            contact_failures.append(item)
            failures.append({"check": "mount_contact", "code": "not_on_mount_plane", **item})
        if not _footprint_inside_face(face, bbox, axis, tolerance_mm):
            item = {
                "component_id": component_id,
                "mount_face_id": placement.get("mount_face_id"),
            }
            footprint_failures.append(item)
            failures.append({"check": "mount_contact", "code": "footprint_outside_face", **item})
    return {
        "ok": not contact_failures and not footprint_failures,
        "failure_count": len(contact_failures) + len(footprint_failures),
        "contact_failures": contact_failures,
        "footprint_failures": footprint_failures,
    }


def _face_occupancy(
    geom: dict[str, Any],
    layout_topology: dict[str, Any],
    failures: list[dict[str, Any]],
    max_occupancy_ratio: float,
) -> dict[str, Any]:
    geom_by_component = geom_components_by_component_id(geom)
    faces = geom.get("install_faces") or {}
    face_records: dict[str, dict[str, Any]] = {}
    for placement in layout_topology.get("placements") or []:
        face_id = placement.get("mount_face_id")
        component_id = placement.get("component_id")
        face = faces.get(face_id)
        component = geom_by_component.get(component_id)
        if not isinstance(face, dict) or not component:
            continue
        bbox = component_bbox(component)
        axis = int(face.get("plane_axis", 0))
        face_area = _face_area(face, geom)
        footprint_area = _bbox_projected_area(bbox, axis)
        record = face_records.setdefault(
            str(face_id),
            {
                "component_count": 0,
                "component_ids": [],
                "face_area_mm2": face_area,
                "occupied_area_sum_mm2": 0.0,
                "occupancy_ratio_sum": 0.0,
            },
        )
        record["component_count"] += 1
        record["component_ids"].append(component_id)
        record["occupied_area_sum_mm2"] += footprint_area
        record["occupancy_ratio_sum"] = (
            record["occupied_area_sum_mm2"] / face_area if face_area > 0 else 0.0
        )

    over_capacity = []
    max_ratio = 0.0
    for face_id, record in face_records.items():
        ratio = float(record["occupancy_ratio_sum"])
        max_ratio = max(max_ratio, ratio)
        if ratio > max_occupancy_ratio:
            over_capacity.append(face_id)
            failures.append(
                {
                    "check": "face_occupancy",
                    "code": "face_over_capacity",
                    "face_id": face_id,
                    "occupancy_ratio_sum": ratio,
                    "max_occupancy_ratio": max_occupancy_ratio,
                }
            )
    return {
        "faces": face_records,
        "max_occupancy_ratio": max_ratio,
        "over_capacity_faces": over_capacity,
    }


def _bbox_mount_plane_contact(
    bbox: dict[str, list[float]],
    axis: int,
    plane_value: float,
) -> dict[str, float | str]:
    """Return the bbox side closest to a declared mount plane.

    CAD build places axis-aligned placeholder boxes so that the physical
    contact side is represented by either bbox.min[axis] or bbox.max[axis].
    Some datasets mark outer shell faces with side="outer" but keep mount_face_id
    tokens such as ".zmin" instead of ".zmin_outer"; build-time placement follows
    the face token.  Therefore validation should compare the declared plane
    against the actual bbox sides instead of deriving a side from normal_sign.
    """
    min_delta = float(bbox["min"][axis]) - plane_value
    max_delta = float(bbox["max"][axis]) - plane_value
    if abs(min_delta) <= abs(max_delta):
        return {
            "side": "min",
            "value": float(bbox["min"][axis]),
            "delta_mm": min_delta,
            "distance_mm": abs(min_delta),
        }
    return {
        "side": "max",
        "value": float(bbox["max"][axis]),
        "delta_mm": max_delta,
        "distance_mm": abs(max_delta),
    }


def _bbox_contains(container: dict[str, Any], bbox: dict[str, list[float]], tolerance_mm: float) -> bool:
    container_min = [float(value) for value in container["min"]]
    container_max = [float(value) for value in container["max"]]
    return all(
        bbox["min"][axis] >= container_min[axis] - tolerance_mm
        and bbox["max"][axis] <= container_max[axis] + tolerance_mm
        for axis in range(3)
    )


def _bbox_overlap_volume(
    a: dict[str, list[float]],
    b: dict[str, list[float]],
    tolerance_mm: float,
) -> float:
    lengths = []
    for axis in range(3):
        length = min(a["max"][axis], b["max"][axis]) - max(a["min"][axis], b["min"][axis])
        lengths.append(max(0.0, length))
    if any(length <= tolerance_mm for length in lengths):
        return 0.0
    return lengths[0] * lengths[1] * lengths[2]


def _footprint_inside_face(
    face: dict[str, Any],
    bbox: dict[str, list[float]],
    axis: int,
    tolerance_mm: float,
) -> bool:
    bbox_2d = face.get("bbox_2d")
    if not isinstance(bbox_2d, list) or len(bbox_2d) != 4:
        return True
    axes = [item for item in (0, 1, 2) if item != axis]
    u_axis, v_axis = axes
    u_min, u_max, v_min, v_max = [float(value) for value in bbox_2d]
    return (
        bbox["min"][u_axis] >= u_min - tolerance_mm
        and bbox["max"][u_axis] <= u_max + tolerance_mm
        and bbox["min"][v_axis] >= v_min - tolerance_mm
        and bbox["max"][v_axis] <= v_max + tolerance_mm
    )


def _face_area(face: dict[str, Any], geom: dict[str, Any]) -> float:
    bbox_2d = face.get("bbox_2d")
    if isinstance(bbox_2d, list) and len(bbox_2d) == 4:
        return max(0.0, float(bbox_2d[1]) - float(bbox_2d[0])) * max(
            0.0,
            float(bbox_2d[3]) - float(bbox_2d[2]),
        )
    axis = int(face.get("plane_axis", 0))
    shell_bbox = (geom.get("outer_shell") or {}).get("outer_bbox") or {}
    axes = [item for item in (0, 1, 2) if item != axis]
    try:
        return (
            float(shell_bbox["max"][axes[0]]) - float(shell_bbox["min"][axes[0]])
        ) * (float(shell_bbox["max"][axes[1]]) - float(shell_bbox["min"][axes[1]]))
    except Exception:
        return 0.0


def _bbox_projected_area(bbox: dict[str, list[float]], axis: int) -> float:
    axes = [item for item in (0, 1, 2) if item != axis]
    return max(0.0, bbox["max"][axes[0]] - bbox["min"][axes[0]]) * max(
        0.0,
        bbox["max"][axes[1]] - bbox["min"][axes[1]],
    )
