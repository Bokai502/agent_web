#!/usr/bin/env python3
"""Validate split CAD outputs produced from cad_build_spec.json."""

from __future__ import annotations

import argparse
import itertools
from pathlib import Path
from typing import Any

from cad_builders.sim_input.support import build_simulation_input
try:
    from .spec_common import check_file, component_bbox, default_cad_dir, default_spec_path, load_spec, print_result, read_json, write_json
except ImportError:
    from spec_common import check_file, component_bbox, default_cad_dir, default_spec_path, load_spec, print_result, read_json, write_json


REQUIRED_FILES = (
    "geometry_after.glb",
    "geometry_after_power_filtered.step",
    "geometry_after_real_cad.glb",
    "simulation_input.json",
)
_LAST_REPORT: dict[str, Any] | None = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate split CAD outputs from cad_build_spec.json.")
    parser.add_argument("--workspace-dir", required=True)
    parser.add_argument("--spec")
    parser.add_argument("--cad-dir")
    parser.add_argument("--max-occupancy-ratio", type=float, default=1.0)
    parser.add_argument("--mount-tolerance-mm", type=float, default=0.5)
    parser.add_argument("--overlap-tolerance-mm3", type=float, default=1e-3)
    parser.add_argument("--report-path", help="Optional path for writing the validation report JSON.")
    return parser.parse_args()


def overlap_volume(a: dict[str, list[float]], b: dict[str, list[float]]) -> float:
    spans = []
    for axis in range(3):
        low = max(float(a["min"][axis]), float(b["min"][axis]))
        high = min(float(a["max"][axis]), float(b["max"][axis]))
        spans.append(max(0.0, high - low))
    return spans[0] * spans[1] * spans[2]


def bbox_volume(bbox: dict[str, list[float]]) -> float:
    return (
        max(0.0, float(bbox["max"][0]) - float(bbox["min"][0]))
        * max(0.0, float(bbox["max"][1]) - float(bbox["min"][1]))
        * max(0.0, float(bbox["max"][2]) - float(bbox["min"][2]))
    )


def install_face_bbox_2d(face_id: str, envelope: dict[str, Any]) -> tuple[int, list[int], list[float]] | None:
    token = face_id.split(".", 1)[1] if "." in face_id else face_id
    direction, side = token.split("_", 1) if "_" in token else (token, "inner")
    axis = {"x": 0, "y": 1, "z": 2}.get(direction[:1])
    if axis is None:
        return None
    source_bbox = envelope.get("inner_bbox") if side == "inner" else envelope.get("outer_bbox")
    if not isinstance(source_bbox, dict):
        return None
    bbox_min = source_bbox.get("min")
    bbox_max = source_bbox.get("max")
    if not isinstance(bbox_min, list) or not isinstance(bbox_max, list) or len(bbox_min) != 3 or len(bbox_max) != 3:
        return None
    axes = [item for item in (0, 1, 2) if item != axis]
    return axis, axes, [
        float(bbox_min[axes[0]]),
        float(bbox_max[axes[0]]),
        float(bbox_min[axes[1]]),
        float(bbox_max[axes[1]]),
    ]


def outside_bbox_amounts(inner: dict[str, list[float]], outer: dict[str, list[float]], *, tolerance_mm: float) -> list[dict[str, Any]]:
    issues = []
    for axis in range(3):
        low_gap = float(outer["min"][axis]) - float(inner["min"][axis])
        high_gap = float(inner["max"][axis]) - float(outer["max"][axis])
        if low_gap > tolerance_mm:
            issues.append({"axis": axis, "side": "min", "amount_mm": low_gap})
        if high_gap > tolerance_mm:
            issues.append({"axis": axis, "side": "max", "amount_mm": high_gap})
    return issues


def check_mount_contact(component: dict[str, Any], bbox: dict[str, list[float]], envelope: dict[str, Any], *, tolerance_mm: float) -> list[dict[str, Any]]:
    component_id = str(component.get("id") or component.get("component_id"))
    mount = component.get("mount") if isinstance(component.get("mount"), dict) else {}
    required = ("install_face_id", "component_face_id", "contact_plane_axis", "contact_plane_value", "normal_sign")
    missing = [key for key in required if mount.get(key) is None]
    if missing:
        return [{"component_id": component_id, "code": "missing_mount_fields", "missing_fields": missing}]

    issues = []
    axis = int(mount.get("contact_plane_axis"))
    normal_sign = int(mount.get("normal_sign"))
    contact_plane_value = float(mount.get("contact_plane_value"))
    contact_coordinate = float(bbox["min"][axis] if normal_sign < 0 else bbox["max"][axis])
    distance = abs(contact_coordinate - contact_plane_value)
    if distance > tolerance_mm:
        issues.append(
            {
                "component_id": component_id,
                "code": "mount_plane_gap",
                "install_face_id": mount.get("install_face_id"),
                "component_face_id": mount.get("component_face_id"),
                "axis": axis,
                "contact_coordinate": contact_coordinate,
                "contact_plane_value": contact_plane_value,
                "distance_mm": distance,
                "tolerance_mm": tolerance_mm,
            }
        )

    footprint = mount.get("footprint_bbox_2d")
    install_face = install_face_bbox_2d(str(mount.get("install_face_id")), envelope)
    if isinstance(footprint, list) and len(footprint) == 2 and install_face is not None:
        _, axes, face_bbox_2d = install_face
        flat_footprint = [
            float(footprint[0][0]),
            float(footprint[1][0]),
            float(footprint[0][1]),
            float(footprint[1][1]),
        ]
        overflow = []
        labels = [f"axis_{axes[0]}_min", f"axis_{axes[0]}_max", f"axis_{axes[1]}_min", f"axis_{axes[1]}_max"]
        deltas = [
            face_bbox_2d[0] - flat_footprint[0],
            flat_footprint[1] - face_bbox_2d[1],
            face_bbox_2d[2] - flat_footprint[2],
            flat_footprint[3] - face_bbox_2d[3],
        ]
        for label, delta in zip(labels, deltas):
            if delta > tolerance_mm:
                overflow.append({"side": label, "amount_mm": delta})
        if overflow:
            issues.append(
                {
                    "component_id": component_id,
                    "code": "mount_footprint_outside_install_face",
                    "install_face_id": mount.get("install_face_id"),
                    "footprint_bbox_2d": flat_footprint,
                    "install_face_bbox_2d": face_bbox_2d,
                    "overflow": overflow,
                }
            )
    return issues


def check_bboxes(spec: dict[str, Any], *, mount_tolerance_mm: float, overlap_tolerance_mm3: float) -> dict[str, Any]:
    components = [(str(item.get("id")), component_bbox(item)) for item in spec.get("components") or []]
    component_by_id = {str(item.get("id")): item for item in spec.get("components") or []}
    walls = [(str(item.get("id") or item.get("wall_id") or item.get("name")), item.get("bbox")) for item in spec.get("walls") or []]
    walls = [(wall_id, bbox) for wall_id, bbox in walls if isinstance(bbox, dict)]
    envelope = spec.get("envelope") if isinstance(spec.get("envelope"), dict) else {}
    inner_bbox = envelope.get("inner_bbox") if isinstance(envelope.get("inner_bbox"), dict) else None
    outer_bbox = envelope.get("outer_bbox") if isinstance(envelope.get("outer_bbox"), dict) else None
    invalid = []
    overlaps = []
    mount_issues = []
    wall_overlaps = []
    envelope_conflicts = []
    for component_id, bbox in components:
        if any(float(bbox["max"][axis]) <= float(bbox["min"][axis]) for axis in range(3)):
            invalid.append(component_id)
            continue
        component = component_by_id.get(component_id, {})
        mount_issues.extend(check_mount_contact(component, bbox, envelope, tolerance_mm=mount_tolerance_mm))
        kind = str(component.get("kind") or "")
        if inner_bbox is not None and kind == "internal":
            outside = outside_bbox_amounts(bbox, inner_bbox, tolerance_mm=mount_tolerance_mm)
            if outside:
                envelope_conflicts.append({"component_id": component_id, "code": "internal_component_outside_inner_box", "outside": outside})
        elif inner_bbox is not None and kind == "external":
            intrusion = overlap_volume(bbox, inner_bbox)
            if intrusion > overlap_tolerance_mm3:
                envelope_conflicts.append({"component_id": component_id, "code": "external_component_intrudes_inner_box", "volume_mm3": intrusion})
        if outer_bbox is not None and kind not in {"internal", "external"}:
            outside = outside_bbox_amounts(bbox, outer_bbox, tolerance_mm=mount_tolerance_mm)
            if outside:
                envelope_conflicts.append({"component_id": component_id, "code": "component_outside_outer_box", "outside": outside})

    for (a_id, a_bbox), (b_id, b_bbox) in itertools.combinations(components, 2):
        volume = overlap_volume(a_bbox, b_bbox)
        if volume > overlap_tolerance_mm3:
            overlaps.append({"a": a_id, "b": b_id, "volume_mm3": volume})
    for component_id, bbox in components:
        for wall_id, wall_bbox in walls:
            volume = overlap_volume(bbox, wall_bbox)
            if volume > overlap_tolerance_mm3:
                wall_overlaps.append({"component_id": component_id, "wall_id": wall_id, "volume_mm3": volume})
    return {
        "ok": not invalid and not overlaps and not mount_issues and not wall_overlaps and not envelope_conflicts,
        "invalid_components": invalid,
        "component_overlaps": overlaps,
        "mount_issues": mount_issues,
        "wall_overlaps": wall_overlaps,
        "envelope_conflicts": envelope_conflicts,
        "failure_count": len(invalid) + len(overlaps) + len(mount_issues) + len(wall_overlaps) + len(envelope_conflicts),
    }


def check_simulation_contract(spec: dict[str, Any], cad_dir: Path) -> dict[str, Any]:
    expected = {
        item["component_id"]
        for item in build_simulation_input(spec).get("components", [])
    }
    simulation_path = cad_dir / "simulation_input.json"
    actual_payload = read_json(simulation_path) if simulation_path.exists() else {"components": []}
    actual = {
        item.get("component_id")
        for item in actual_payload.get("components", [])
        if isinstance(item, dict)
    }
    return {
        "ok": expected == actual,
        "expected_simulation_components": sorted(expected),
        "missing_simulation_components": sorted(expected - actual),
        "unexpected_simulation_components": sorted(actual - expected),
        "simulation_step_file_ok": actual_payload.get("step_file") == "geometry_after_power_filtered.step",
    }


def main() -> int:
    global _LAST_REPORT
    args = parse_args()
    workspace_dir = Path(args.workspace_dir).expanduser().resolve()
    spec_path = Path(args.spec).expanduser().resolve() if args.spec else default_spec_path(workspace_dir)
    cad_dir = Path(args.cad_dir).expanduser().resolve() if args.cad_dir else default_cad_dir(workspace_dir)
    spec = load_spec(spec_path)
    failures = []
    warnings = []
    file_checks = {}
    missing = []
    empty = []
    for relative in REQUIRED_FILES:
        check = check_file(cad_dir / relative)
        file_checks[relative] = {"path": str(check.path), "exists": check.exists, "size_bytes": check.size_bytes}
        if not check.exists:
            missing.append(relative)
            failures.append({"check": "files", "code": "missing_file", "path": str(check.path)})
        elif check.size_bytes <= 0:
            empty.append(relative)
            failures.append({"check": "files", "code": "empty_file", "path": str(check.path)})

    contracts = check_simulation_contract(spec, cad_dir) if (cad_dir / "simulation_input.json").exists() else {
        "ok": False,
        "missing_simulation_components": [],
        "unexpected_simulation_components": [],
        "simulation_step_file_ok": False,
    }
    for component_id in contracts.get("missing_simulation_components", []):
        failures.append({"check": "contracts", "code": "missing_simulation_component", "component_id": component_id})
    for component_id in contracts.get("unexpected_simulation_components", []):
        failures.append({"check": "contracts", "code": "unexpected_simulation_component", "component_id": component_id})
    if not contracts.get("simulation_step_file_ok"):
        failures.append({"check": "contracts", "code": "unexpected_simulation_step_file"})

    bbox = check_bboxes(
        spec,
        mount_tolerance_mm=args.mount_tolerance_mm,
        overlap_tolerance_mm3=args.overlap_tolerance_mm3,
    )
    for item in bbox["invalid_components"]:
        warnings.append({"check": "bbox", "code": "invalid_bbox", "component_id": item})
    for item in bbox["component_overlaps"]:
        warnings.append({"check": "bbox", "code": "component_overlap", **item})
    for item in bbox["mount_issues"]:
        warnings.append({"check": "mount", **item})
    for item in bbox["wall_overlaps"]:
        warnings.append({"check": "walls", "code": "component_wall_overlap", **item})
    for item in bbox["envelope_conflicts"]:
        warnings.append({"check": "envelope", **item})

    success = not failures
    report = {
        "schema_version": "1.0",
        "success": success,
        "status": "failed" if not success else "passed_with_warnings" if warnings else "passed",
        "summary": {
            "component_count": len(spec.get("components") or []),
            "missing_file_count": len(missing),
            "empty_file_count": len(empty),
            "bbox_overlap_count": len(bbox["component_overlaps"]),
            "mount_issue_count": len(bbox["mount_issues"]),
            "wall_overlap_count": len(bbox["wall_overlaps"]),
            "envelope_conflict_count": len(bbox["envelope_conflicts"]),
            "warning_count": len(warnings),
        },
        "checks": {
            "files": {"ok": not missing and not empty, "missing": missing, "empty": empty, "files": file_checks},
            "contracts": contracts,
            "bbox": bbox,
        },
        "failures": failures,
        "warnings": warnings,
        "settings": {
            "max_occupancy_ratio": args.max_occupancy_ratio,
            "mount_tolerance_mm": args.mount_tolerance_mm,
            "overlap_tolerance_mm3": args.overlap_tolerance_mm3,
        },
    }
    if args.report_path:
        report_path = Path(args.report_path).expanduser().resolve()
        write_json(report_path, report)
    _LAST_REPORT = report
    print_result(report)
    return 0 if success else 1


if __name__ == "__main__":
    raise SystemExit(main())
