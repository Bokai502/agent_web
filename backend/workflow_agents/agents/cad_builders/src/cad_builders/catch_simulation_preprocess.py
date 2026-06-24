#!/usr/bin/env python3
"""CATCH-specific geometry cleanup before simulation CAD export."""

from __future__ import annotations

import argparse
import copy
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any


CATCH_INTERNAL_WALL_IDS = {"03_GB_ZY_BJ", "04_GB_FY_BJ"}
TOL = 1e-6
OVERLAP_TOL = 1e-3
MIN_THICKNESS = 0.5
CLEARANCE = 0.5
SMALL_INTRUSION_MM = 5.0
SMALL_INTRUSION_RATIO = 0.10
DELETE_COVERAGE_RATIO = 0.90
FULL_COVERAGE_RATIO = 0.999
DELETE_VOLUME_RATIO = 0.20
DEFAULT_CLEARANCE_MM = 1.0


@dataclass
class Placement:
    axis: int
    side: int
    cabin_bbox: dict[str, list[float]]
    cabin_side: str
    plane: float
    wall_mounted: bool = False
    target_id: str = "cabin"
    component_side: int = 0


def _bbox3(value: Any) -> dict[str, list[float]] | None:
    if not isinstance(value, dict):
        return None
    bmin = value.get("min")
    bmax = value.get("max")
    if not isinstance(bmin, list) or not isinstance(bmax, list) or len(bmin) != 3 or len(bmax) != 3:
        return None
    try:
        parsed_min = [float(item) for item in bmin]
        parsed_max = [float(item) for item in bmax]
    except (TypeError, ValueError):
        return None
    if any(math.isnan(item) or math.isinf(item) for item in parsed_min + parsed_max):
        return None
    if any(parsed_max[index] <= parsed_min[index] for index in range(3)):
        return None
    return {"min": parsed_min, "max": parsed_max}


def _wall_id(wall: dict[str, Any]) -> str:
    return str(wall.get("id") or wall.get("wall_id") or wall.get("panel_id") or wall.get("name") or "")


def _component_id(component: dict[str, Any]) -> str:
    return str(component.get("id") or component.get("component_id") or component.get("name") or "")


def bbox_dims(bbox: dict[str, list[float]]) -> list[float]:
    return [float(bbox["max"][index]) - float(bbox["min"][index]) for index in range(3)]


def bbox_volume(bbox: dict[str, list[float]]) -> float:
    dims = bbox_dims(bbox)
    return max(0.0, dims[0]) * max(0.0, dims[1]) * max(0.0, dims[2])


def bbox_from_min(minimum: list[float], dims: list[float]) -> dict[str, list[float]]:
    return {"min": list(minimum), "max": [minimum[index] + dims[index] for index in range(3)]}


def component_bbox(component: dict[str, Any]) -> dict[str, list[float]]:
    bbox = _bbox3(component.get("bbox"))
    if bbox is not None:
        return bbox
    pos = [float(value) for value in component["position"]]
    dims = [float(value) for value in component["dims"]]
    return bbox_from_min(pos, dims)


def overlap_volume(a: dict[str, list[float]], b: dict[str, list[float]]) -> float:
    volume = 1.0
    for axis in range(3):
        low = max(float(a["min"][axis]), float(b["min"][axis]))
        high = min(float(a["max"][axis]), float(b["max"][axis]))
        if high <= low:
            return 0.0
        volume *= high - low
    return volume


def outside_amounts(inner: dict[str, list[float]], outer: dict[str, list[float]]) -> list[dict[str, Any]]:
    issues = []
    for axis in range(3):
        low = float(outer["min"][axis]) - float(inner["min"][axis])
        high = float(inner["max"][axis]) - float(outer["max"][axis])
        if low > TOL:
            issues.append({"axis": axis, "side": "min", "amount_mm": low})
        if high > TOL:
            issues.append({"axis": axis, "side": "max", "amount_mm": high})
    return issues


def face_id(axis: int, side: int, cabin_side: str) -> str:
    direction = ("x", "y", "z")[axis] + ("min" if side < 0 else "max")
    return f"cabin.{direction}_{cabin_side}"


def target_face_id(target_id: str, axis: int, side: int, cabin_side: str) -> str:
    direction = ("x", "y", "z")[axis] + ("min" if side < 0 else "max")
    owner = target_id or "cabin"
    return f"{owner}.{direction}_{cabin_side}"


def component_face_id(component_id: str, axis: int, side: int) -> str:
    return f"{component_id}.local_{('x', 'y', 'z')[axis]}{'min' if side < 0 else 'max'}"


def _parse_face_axis_side(face_id_value: Any) -> tuple[int | None, int | None, str]:
    token = str(face_id_value or "").split(".")[-1].replace("local_", "")
    direction, suffix = token.split("_", 1) if "_" in token else (token, "")
    axis = {"x": 0, "y": 1, "z": 2}.get(direction[:1])
    if axis is None:
        return None, None, suffix
    if direction.endswith("min"):
        return axis, -1, suffix
    if direction.endswith("max"):
        return axis, 1, suffix
    return axis, None, suffix


def _target_bbox_side_from_plane(target_bbox: dict[str, list[float]], axis: int, plane: float | None, fallback_side: int) -> int:
    if plane is None:
        return fallback_side
    min_gap = abs(float(plane) - float(target_bbox["min"][axis]))
    max_gap = abs(float(plane) - float(target_bbox["max"][axis]))
    return -1 if min_gap <= max_gap else 1


def normalize_component_geometry(component: dict[str, Any], bbox: dict[str, list[float]]) -> None:
    dims = bbox_dims(bbox)
    if any(length <= MIN_THICKNESS - TOL for length in dims):
        raise ValueError(f"{_component_id(component)} has non-positive repaired dims: {dims}")
    component["bbox"] = {"min": [float(value) for value in bbox["min"]], "max": [float(value) for value in bbox["max"]]}
    component["position"] = [float(value) for value in bbox["min"]]
    component["dims"] = [float(value) for value in dims]
    component["rotation_rows"] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
    placement = component.get("placement")
    if isinstance(placement, dict):
        placement["position"] = [float(value) for value in bbox["min"]]
        placement["rotation_matrix"] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]


def refresh_mount(component: dict[str, Any], placement: Placement) -> None:
    bbox = component_bbox(component)
    axis = placement.axis
    component_side = placement.component_side or (placement.side if placement.cabin_side == "inner" else -placement.side)
    normal_sign = component_side
    plane = float(bbox["min"][axis] if component_side < 0 else bbox["max"][axis])
    axes = [item for item in (0, 1, 2) if item != axis]
    mount = component.get("mount")
    if not isinstance(mount, dict):
        mount = {}
        component["mount"] = mount
    component_id = _component_id(component)
    mount["install_face_id"] = target_face_id(placement.target_id, axis, placement.side, placement.cabin_side)
    mount["component_face_id"] = component_face_id(component_id, axis, component_side)
    mount["contact_plane_axis"] = axis
    mount["contact_plane_value"] = plane
    mount["normal_sign"] = normal_sign
    mount["footprint_bbox_2d"] = [
        [float(bbox["min"][axes[0]]), float(bbox["min"][axes[1]])],
        [float(bbox["max"][axes[0]]), float(bbox["max"][axes[1]])],
    ]


def placement_from_mount(component: dict[str, Any], envelope: dict[str, Any], wall_ids: set[str] | None = None) -> Placement:
    bbox = component_bbox(component)
    kind = str(component.get("kind") or "")
    mount = component.get("mount") if isinstance(component.get("mount"), dict) else {}
    component_axis, component_side, _ = _parse_face_axis_side(mount.get("component_face_id"))
    if component_axis is not None:
        axis = component_axis
    elif mount.get("contact_plane_axis") is not None:
        axis = int(mount["contact_plane_axis"])
    else:
        axis = max(range(3), key=lambda item: bbox_dims(bbox)[item])
    install_face_id = str(mount.get("install_face_id") or "")
    owner_id = install_face_id.split(".", 1)[0]
    wall_mounted = owner_id in (wall_ids or set())
    cabin_side = "inner" if "_inner" in install_face_id or kind == "internal" or wall_mounted else "outer"
    cabin_bbox = envelope["inner_bbox"] if cabin_side == "inner" else envelope["outer_bbox"]
    target_axis, target_side, _ = _parse_face_axis_side(install_face_id)
    plane = float(mount["contact_plane_value"]) if mount.get("contact_plane_value") is not None else None
    if component_side is not None:
        face_plane = float(bbox["min"][axis] if component_side < 0 else bbox["max"][axis])
        if plane is None:
            plane = face_plane
        side = _target_bbox_side_from_plane(cabin_bbox, axis, plane, target_side or component_side)
    elif target_axis == axis and target_side is not None:
        side = target_side
    else:
        plane_min = float(cabin_bbox["min"][axis])
        plane_max = float(cabin_bbox["max"][axis])
        if kind == "internal":
            side = -1 if abs(float(bbox["min"][axis]) - plane_min) <= abs(float(bbox["max"][axis]) - plane_max) else 1
        else:
            side = -1 if abs(float(bbox["max"][axis]) - plane_min) <= abs(float(bbox["min"][axis]) - plane_max) else 1
    if plane is None:
        plane = float(cabin_bbox["min"][axis] if side < 0 else cabin_bbox["max"][axis])
    if component_side is None:
        component_side = side if cabin_side == "inner" else -side
    return Placement(
        axis=axis,
        side=side,
        cabin_bbox=cabin_bbox,
        cabin_side=cabin_side,
        plane=plane,
        wall_mounted=wall_mounted,
        target_id=owner_id if wall_mounted else "cabin",
        component_side=component_side,
    )


def bbox_union_overlap_ratio(bbox: dict[str, list[float]], obstacles: list[dict[str, Any]]) -> tuple[float, dict[str, Any] | None]:
    volume = bbox_volume(bbox)
    if volume <= OVERLAP_TOL:
        return 0.0, None
    best_ratio = 0.0
    best_obstacle = None
    for obstacle in obstacles:
        obstacle_bbox = obstacle["bbox"]
        ratio = overlap_volume(bbox, obstacle_bbox) / volume
        if ratio > best_ratio:
            best_ratio = ratio
            best_obstacle = obstacle
    return best_ratio, best_obstacle


def component_power(component: dict[str, Any]) -> float:
    thermal = component.get("thermal") if isinstance(component.get("thermal"), dict) else {}
    try:
        return float(thermal.get("power_W") or 0.0)
    except (TypeError, ValueError):
        return 0.0


def nudge_to_mount_face(bbox: dict[str, list[float]], placement: Placement) -> tuple[dict[str, list[float]], list[float]]:
    result = copy.deepcopy(bbox)
    delta = [0.0, 0.0, 0.0]
    axis = placement.axis
    component_side = placement.component_side or (placement.side if placement.cabin_side == "inner" else -placement.side)
    face = float(result["min"][axis] if component_side < 0 else result["max"][axis])
    move = placement.plane - face
    result["min"][axis] = float(result["min"][axis]) + move
    result["max"][axis] = float(result["max"][axis]) + move
    delta[axis] = move
    return result, delta


def original_mount_gap(bbox: dict[str, list[float]], placement: Placement) -> float:
    axis = placement.axis
    component_side = placement.component_side or (placement.side if placement.cabin_side == "inner" else -placement.side)
    face = float(bbox["min"][axis] if component_side < 0 else bbox["max"][axis])
    return placement.plane - face


def crop_to_cabin_refined(
    bbox: dict[str, list[float]],
    component: dict[str, Any],
    placement: Placement,
    reasons: list[str],
    operations: list[dict[str, Any]],
) -> dict[str, list[float]]:
    result = copy.deepcopy(bbox)
    if placement.wall_mounted:
        return result
    dims = bbox_dims(result)
    kind = str(component.get("kind") or "")
    cabin_bbox = placement.cabin_bbox
    mount_axis = placement.axis
    if kind == "internal":
        for axis in range(3):
            low_intrusion = float(cabin_bbox["min"][axis]) - float(result["min"][axis])
            high_intrusion = float(result["max"][axis]) - float(cabin_bbox["max"][axis])
            if low_intrusion > TOL:
                reasons.append("cabin_intrusion")
                result["min"][axis] = float(cabin_bbox["min"][axis])
                operations.append({"type": "crop", "reason": "internal_below_inner", "axis": axis, "side": "min", "amount_mm": low_intrusion})
            if high_intrusion > TOL:
                reasons.append("cabin_intrusion")
                result["max"][axis] = float(cabin_bbox["max"][axis])
                operations.append({"type": "crop", "reason": "internal_above_inner", "axis": axis, "side": "max", "amount_mm": high_intrusion})
    else:
        for axis in range(3):
            if axis != mount_axis:
                continue
            shell_low = float(result["max"][axis]) - float(cabin_bbox["min"][axis])
            shell_high = float(cabin_bbox["max"][axis]) - float(result["min"][axis])
            if placement.side < 0 and shell_low > TOL:
                threshold = min(SMALL_INTRUSION_MM, dims[axis] * SMALL_INTRUSION_RATIO)
                reasons.append("cabin_intrusion")
                if shell_low <= threshold:
                    result["max"][axis] = float(cabin_bbox["min"][axis])
                    reason = "external_small_shell_intrusion"
                else:
                    inside_len = max(0.0, float(result["max"][axis]) - float(cabin_bbox["min"][axis]))
                    outside_len = max(0.0, float(cabin_bbox["min"][axis]) - float(result["min"][axis]))
                    if outside_len >= inside_len:
                        result["max"][axis] = float(cabin_bbox["min"][axis])
                        reason = "external_keep_larger_outside"
                        side_name = "max"
                        amount = shell_low
                    else:
                        reason = "external_keep_larger_far_side"
                        side_name = "min"
                        amount = float(cabin_bbox["max"][axis]) - float(bbox["min"][axis])
                        result["min"][axis] = float(cabin_bbox["max"][axis])
                if shell_low <= threshold:
                    side_name = "max"
                    amount = shell_low
                operations.append({"type": "crop", "reason": reason, "axis": axis, "side": side_name, "amount_mm": amount})
            elif placement.side > 0 and shell_high > TOL:
                threshold = min(SMALL_INTRUSION_MM, dims[axis] * SMALL_INTRUSION_RATIO)
                reasons.append("cabin_intrusion")
                if shell_high <= threshold:
                    result["min"][axis] = float(cabin_bbox["max"][axis])
                    reason = "external_small_shell_intrusion"
                else:
                    outside_len = max(0.0, float(result["max"][axis]) - float(cabin_bbox["max"][axis]))
                    inside_len = max(0.0, float(cabin_bbox["max"][axis]) - float(result["min"][axis]))
                    if outside_len >= inside_len:
                        result["min"][axis] = float(cabin_bbox["max"][axis])
                        reason = "external_keep_larger_outside"
                        side_name = "min"
                        amount = shell_high
                    else:
                        reason = "external_keep_larger_far_side"
                        side_name = "max"
                        amount = float(bbox["max"][axis]) - float(cabin_bbox["min"][axis])
                        result["max"][axis] = float(cabin_bbox["min"][axis])
                if shell_high <= threshold:
                    side_name = "min"
                    amount = shell_high
                operations.append({"type": "crop", "reason": reason, "axis": axis, "side": side_name, "amount_mm": amount})
    return result


def crop_against_obstacle_refined(
    bbox: dict[str, list[float]],
    obstacle_bbox: dict[str, list[float]],
    placement: Placement,
    reason: str,
    operations: list[dict[str, Any]],
) -> dict[str, list[float]] | None:
    if overlap_volume(bbox, obstacle_bbox) <= OVERLAP_TOL:
        return bbox
    candidates = []
    mount_axis = placement.axis
    for axis in range(3):
        low = max(float(bbox["min"][axis]), float(obstacle_bbox["min"][axis]))
        high = min(float(bbox["max"][axis]), float(obstacle_bbox["max"][axis]))
        overlap = max(0.0, high - low)
        if overlap <= TOL:
            continue
        if axis == mount_axis:
            component_mount_side = placement.component_side or (placement.side if placement.cabin_side == "inner" else -placement.side)
            allowed_sides = [1 if component_mount_side < 0 else -1]
        else:
            allowed_sides = [-1, 1]
        for crop_side in allowed_sides:
            candidate = copy.deepcopy(bbox)
            if crop_side < 0:
                amount = float(obstacle_bbox["max"][axis]) - float(candidate["min"][axis]) + CLEARANCE
                candidate["min"][axis] = float(obstacle_bbox["max"][axis]) + CLEARANCE
                side_name = "min"
            else:
                amount = float(candidate["max"][axis]) - float(obstacle_bbox["min"][axis]) + CLEARANCE
                candidate["max"][axis] = float(obstacle_bbox["min"][axis]) - CLEARANCE
                side_name = "max"
            dims = bbox_dims(candidate)
            if any(length <= MIN_THICKNESS for length in dims):
                continue
            volume_loss = bbox_volume(bbox) - bbox_volume(candidate)
            candidates.append((volume_loss, axis == mount_axis, candidate, {"type": "crop", "reason": reason, "axis": axis, "side": side_name, "amount_mm": amount}))
    candidates.sort(key=lambda item: (item[0], item[1]))
    for _, _, candidate, operation in candidates:
        if overlap_volume(candidate, obstacle_bbox) <= OVERLAP_TOL:
            operations.append(operation)
            return candidate
    return None


def tangent_move_away_from_obstacle(
    bbox: dict[str, list[float]],
    obstacle_bbox: dict[str, list[float]],
    placement: Placement,
    operations: list[dict[str, Any]],
    reason: str,
) -> dict[str, list[float]] | None:
    if overlap_volume(bbox, obstacle_bbox) <= OVERLAP_TOL:
        return bbox
    candidates = []
    for axis in range(3):
        if axis == placement.axis:
            continue
        moves = [
            float(obstacle_bbox["min"][axis]) - float(bbox["max"][axis]) - CLEARANCE,
            float(obstacle_bbox["max"][axis]) - float(bbox["min"][axis]) + CLEARANCE,
        ]
        for move in moves:
            candidate = copy.deepcopy(bbox)
            candidate["min"][axis] = float(candidate["min"][axis]) + move
            candidate["max"][axis] = float(candidate["max"][axis]) + move
            candidates.append((abs(move), axis, move, candidate))
    candidates.sort(key=lambda item: item[0])
    for _, axis, move, candidate in candidates:
        if overlap_volume(candidate, obstacle_bbox) <= OVERLAP_TOL:
            operations.append({"type": "move", "reason": reason, "axis": axis, "delta_mm": move})
            return candidate
    return None


def summarize_bbox_change(before: dict[str, list[float]], after: dict[str, list[float]]) -> dict[str, Any]:
    before_volume = bbox_volume(before)
    return {
        "delta_min": [float(after["min"][index]) - float(before["min"][index]) for index in range(3)],
        "delta_max": [float(after["max"][index]) - float(before["max"][index]) for index in range(3)],
        "before_dims": bbox_dims(before),
        "after_dims": bbox_dims(after),
        "volume_before_mm3": before_volume,
        "volume_after_mm3": bbox_volume(after),
        "volume_ratio": bbox_volume(after) / before_volume if before_volume > OVERLAP_TOL else None,
    }


def should_delete_small_covered_component(
    component: dict[str, Any],
    bbox: dict[str, list[float]],
    obstacles: list[dict[str, Any]],
    *,
    coverage_ratio: float = DELETE_COVERAGE_RATIO,
) -> tuple[bool, float, dict[str, Any] | None, str | None]:
    ratio, coverer = bbox_union_overlap_ratio(bbox, obstacles)
    if ratio >= coverage_ratio:
        coverer_volume = bbox_volume(coverer["bbox"]) if coverer else 0.0
        current_volume = bbox_volume(bbox)
        if coverer_volume > current_volume + OVERLAP_TOL and ratio >= FULL_COVERAGE_RATIO:
            return True, ratio, coverer, "fully_covered_by_larger_obstacle"
        if component_power(component) <= 0.0:
            return True, ratio, coverer, "zero_power_covered_by_larger_obstacle"
        if coverer_volume > OVERLAP_TOL and current_volume < coverer_volume * DELETE_VOLUME_RATIO:
            return True, ratio, coverer, "small_component_covered_by_larger_obstacle"
    return False, ratio, coverer, None


def cabin_solid_overlap(component: dict[str, Any], envelope: dict[str, Any]) -> float:
    bbox = component_bbox(component)
    kind = str(component.get("kind") or "")
    mount = component.get("mount") if isinstance(component.get("mount"), dict) else {}
    owner_id = str(mount.get("install_face_id") or "").split(".", 1)[0]
    wall_ids = {
        str(wall.get("id") or wall.get("wall_id") or wall.get("name"))
        for wall in envelope.get("_wall_refs", [])
        if isinstance(wall, dict)
    }
    if owner_id in wall_ids:
        return 0.0
    inner = envelope["inner_bbox"]
    outer = envelope["outer_bbox"]
    if kind == "internal":
        outside = outside_amounts(bbox, inner)
        return sum(item["amount_mm"] for item in outside) if outside else 0.0
    return overlap_volume(bbox, outer) - overlap_volume(bbox, inner)


def mount_contact_ok(component: dict[str, Any]) -> bool:
    bbox = component_bbox(component)
    mount = component.get("mount") if isinstance(component.get("mount"), dict) else {}
    if mount.get("contact_plane_axis") is None or mount.get("contact_plane_value") is None:
        return False
    axis = int(mount["contact_plane_axis"])
    normal_sign = int(mount.get("normal_sign") or 1)
    face = float(bbox["min"][axis] if normal_sign < 0 else bbox["max"][axis])
    if abs(face - float(mount["contact_plane_value"])) > max(SMALL_INTRUSION_MM, 1.0):
        return False
    area = 1.0
    for other in range(3):
        if other != axis:
            area *= max(0.0, float(bbox["max"][other]) - float(bbox["min"][other]))
    return area > TOL


def _mount_target_bbox(component: dict[str, Any], spec: dict[str, Any]) -> dict[str, list[float]] | None:
    mount = component.get("mount") if isinstance(component.get("mount"), dict) else {}
    install_face_id = str(mount.get("install_face_id") or "")
    owner_id = install_face_id.split(".", 1)[0]
    if owner_id and owner_id not in {"cabin", "outer_shell"}:
        for wall in spec.get("walls") or []:
            if isinstance(wall, dict) and _wall_id(wall) == owner_id:
                return _bbox3(wall.get("bbox"))
    envelope = spec.get("envelope") if isinstance(spec.get("envelope"), dict) else {}
    _, _, face_kind = _parse_face_axis_side(install_face_id)
    if face_kind == "outer":
        return _bbox3(envelope.get("outer_bbox"))
    if face_kind == "inner":
        return _bbox3(envelope.get("inner_bbox"))
    kind = str(component.get("kind") or "")
    return _bbox3(envelope.get("inner_bbox" if kind == "internal" else "outer_bbox"))


def validate_mount_faces(spec: dict[str, Any]) -> dict[str, Any]:
    issues: list[dict[str, Any]] = []
    for component in spec.get("components") or []:
        if not isinstance(component, dict):
            continue
        component_id = _component_id(component)
        bbox = component_bbox(component)
        mount = component.get("mount") if isinstance(component.get("mount"), dict) else {}
        component_axis, component_side, _ = _parse_face_axis_side(mount.get("component_face_id"))
        install_axis, install_side, install_kind = _parse_face_axis_side(mount.get("install_face_id"))
        if component_axis is None or component_side is None:
            issues.append({"code": "invalid_component_face_id", "component_id": component_id, "component_face_id": mount.get("component_face_id")})
            continue
        if install_axis is None or install_side is None:
            issues.append({"code": "invalid_install_face_id", "component_id": component_id, "install_face_id": mount.get("install_face_id")})
            continue
        if component_axis != install_axis:
            issues.append({
                "code": "mount_axis_mismatch",
                "component_id": component_id,
                "component_face_id": mount.get("component_face_id"),
                "install_face_id": mount.get("install_face_id"),
            })
            continue
        component_plane = float(bbox["min"][component_axis] if component_side < 0 else bbox["max"][component_axis])
        target_bbox = _mount_target_bbox(component, spec)
        if target_bbox is None:
            issues.append({"code": "missing_mount_target_bbox", "component_id": component_id, "install_face_id": mount.get("install_face_id")})
            continue
        target_plane = float(target_bbox["min"][install_axis] if install_side < 0 else target_bbox["max"][install_axis])
        if abs(component_plane - target_plane) > 1e-4:
            issues.append({
                "code": "mount_plane_mismatch",
                "component_id": component_id,
                "install_face_id": mount.get("install_face_id"),
                "component_face_id": mount.get("component_face_id"),
                "install_kind": install_kind,
                "component_plane": component_plane,
                "target_plane": target_plane,
                "gap_mm": component_plane - target_plane,
            })
        if mount.get("contact_plane_axis") != component_axis:
            issues.append({
                "code": "contact_axis_mismatch",
                "component_id": component_id,
                "contact_plane_axis": mount.get("contact_plane_axis"),
                "expected_axis": component_axis,
            })
        if mount.get("contact_plane_value") is None or abs(float(mount["contact_plane_value"]) - component_plane) > 1e-4:
            issues.append({
                "code": "contact_plane_value_mismatch",
                "component_id": component_id,
                "contact_plane_value": mount.get("contact_plane_value"),
                "expected_plane": component_plane,
            })
        axes = [axis for axis in (0, 1, 2) if axis != component_axis]
        expected_footprint = [
            [float(bbox["min"][axes[0]]), float(bbox["min"][axes[1]])],
            [float(bbox["max"][axes[0]]), float(bbox["max"][axes[1]])],
        ]
        footprint = mount.get("footprint_bbox_2d")
        if not (
            isinstance(footprint, list)
            and len(footprint) == 2
            and all(isinstance(row, list) and len(row) == 2 for row in footprint)
            and all(abs(float(footprint[row][col]) - expected_footprint[row][col]) <= 1e-4 for row in range(2) for col in range(2))
        ):
            issues.append({
                "code": "footprint_mismatch",
                "component_id": component_id,
                "footprint_bbox_2d": footprint,
                "expected_footprint_bbox_2d": expected_footprint,
            })
    return {
        "success": not issues,
        "issue_count": len(issues),
        "issues": issues,
    }


def validate_repaired(spec: dict[str, Any]) -> dict[str, Any]:
    components = list(spec.get("components") or [])
    walls = [wall.get("bbox") for wall in spec.get("walls") or [] if isinstance(wall.get("bbox"), dict)]
    envelope = dict(spec["envelope"])
    envelope["_wall_refs"] = spec.get("walls") or []
    component_overlap_count = 0
    wall_overlap_count = 0
    cabin_solid_overlap_count = 0
    unmounted_component_count = 0
    invalid_component_count = 0
    details = []
    for index, component in enumerate(components):
        bbox = component_bbox(component)
        dims = bbox_dims(bbox)
        if any(length <= MIN_THICKNESS for length in dims):
            invalid_component_count += 1
            details.append({"code": "invalid_dims", "component_id": _component_id(component), "dims": dims})
        for other in components[index + 1:]:
            volume = overlap_volume(bbox, component_bbox(other))
            if volume > OVERLAP_TOL:
                component_overlap_count += 1
                details.append({"code": "component_overlap", "a": _component_id(component), "b": _component_id(other), "volume_mm3": volume})
        for wall in walls:
            if overlap_volume(bbox, wall) > OVERLAP_TOL:
                wall_overlap_count += 1
                details.append({"code": "wall_overlap", "component_id": _component_id(component)})
        shell_overlap = cabin_solid_overlap(component, envelope)
        if shell_overlap > OVERLAP_TOL:
            cabin_solid_overlap_count += 1
            details.append({"code": "cabin_solid_overlap", "component_id": _component_id(component), "amount": shell_overlap})
        if not mount_contact_ok(component):
            unmounted_component_count += 1
            details.append({"code": "unmounted", "component_id": _component_id(component)})
    mount_face_validation = validate_mount_faces(spec)
    success = not any((component_overlap_count, wall_overlap_count, cabin_solid_overlap_count, unmounted_component_count, invalid_component_count)) and mount_face_validation["success"]
    return {
        "success": success,
        "component_count": len(components),
        "component_overlap_count": component_overlap_count,
        "wall_overlap_count": wall_overlap_count,
        "cabin_solid_overlap_count": cabin_solid_overlap_count,
        "unmounted_component_count": unmounted_component_count,
        "invalid_component_count": invalid_component_count,
        "mount_face_issue_count": mount_face_validation["issue_count"],
        "mount_face_validation": mount_face_validation,
        "details": details,
    }


def repair_spec_crop_refined(spec: dict[str, Any], *, delete_coverage_ratio: float = DELETE_COVERAGE_RATIO) -> tuple[dict[str, Any], dict[str, Any]]:
    repaired = copy.deepcopy(spec)
    envelope = repaired["envelope"]
    walls = [
        {"id": _wall_id(wall), "bbox": wall.get("bbox"), "kind": "wall"}
        for wall in repaired.get("walls") or []
        if isinstance(wall, dict) and isinstance(wall.get("bbox"), dict)
    ]
    envelope["_wall_refs"] = repaired.get("walls") or []
    wall_ids = {str(wall["id"]) for wall in walls}
    original_components = list(repaired.get("components") or [])
    components_by_id = {_component_id(item): item for item in original_components}
    original_index = {_component_id(item): index for index, item in enumerate(original_components)}
    processing = sorted(original_components, key=lambda item: bbox_volume(component_bbox(item)), reverse=True)
    kept: list[dict[str, Any]] = []
    deleted_ids: set[str] = set()
    change_records: list[dict[str, Any]] = []
    failure_records: list[dict[str, Any]] = []

    for component in processing:
        component_id = _component_id(component)
        before = component_bbox(component)
        placement = placement_from_mount(component, envelope, wall_ids)
        reasons: list[str] = []
        operations: list[dict[str, Any]] = []
        bbox = copy.deepcopy(before)

        gap = original_mount_gap(bbox, placement)
        if abs(gap) <= SMALL_INTRUSION_MM:
            nudged, delta = nudge_to_mount_face(bbox, placement)
        else:
            nudged, delta = bbox, [0.0, 0.0, 0.0]
            reasons.append("mount_gap_preserved")
            operations.append({"type": "note", "reason": "large_original_mount_gap_not_moved", "axis": placement.axis, "gap_mm": gap})
        if any(abs(item) > TOL for item in delta):
            reasons.append("floating_mount")
            operations.append({"type": "move", "reason": "attach_to_original_mount_plane", "delta": delta})
            bbox = nudged

        obstacles = walls + [{"id": _component_id(item), "bbox": component_bbox(item), "kind": "component"} for item in kept]
        should_delete, coverage_ratio, coverer, delete_reason = should_delete_small_covered_component(
            component,
            bbox,
            obstacles,
            coverage_ratio=delete_coverage_ratio,
        )
        if should_delete:
            deleted_ids.add(component_id)
            change_records.append({
                "id": component_id,
                "action": "delete",
                "reasons": sorted(set(reasons + [delete_reason or "covered_by_larger_obstacle"])),
                "from": before,
                "to": None,
                "coverage_ratio": coverage_ratio,
                "covered_by": coverer.get("id") if coverer else None,
                "operations": operations + [{"type": "delete", "reason": delete_reason, "coverage_ratio": coverage_ratio}],
            })
            continue

        bbox = crop_to_cabin_refined(bbox, component, placement, reasons, operations)

        for _ in range(120):
            overlaps = [(overlap_volume(bbox, obstacle["bbox"]), obstacle) for obstacle in obstacles]
            overlaps = [(volume, obstacle) for volume, obstacle in overlaps if volume > OVERLAP_TOL]
            if not overlaps:
                break
            overlaps.sort(key=lambda item: item[0], reverse=True)
            volume, obstacle = overlaps[0]
            reason = "wall_overlap" if obstacle.get("kind") == "wall" else "component_overlap"
            reasons.append(reason)
            next_bbox = crop_against_obstacle_refined(bbox, obstacle["bbox"], placement, reason, operations)
            if next_bbox is None:
                next_bbox = tangent_move_away_from_obstacle(bbox, obstacle["bbox"], placement, operations, f"{reason}_tangent_move")
            if next_bbox is None:
                should_delete, ratio, coverer, delete_reason = should_delete_small_covered_component(
                    component,
                    bbox,
                    obstacles,
                    coverage_ratio=delete_coverage_ratio,
                )
                if should_delete:
                    deleted_ids.add(component_id)
                    change_records.append({
                        "id": component_id,
                        "action": "delete",
                        "reasons": sorted(set(reasons + [delete_reason or "covered_by_larger_obstacle"])),
                        "from": before,
                        "to": None,
                        "coverage_ratio": ratio,
                        "covered_by": coverer.get("id") if coverer else None,
                        "operations": operations + [{"type": "delete", "reason": delete_reason, "coverage_ratio": ratio}],
                    })
                    break
                failure_records.append({"id": component_id, "reason": "cannot_crop_without_invalid_dims", "overlap_volume_mm3": volume, "obstacle": obstacle.get("id")})
                break
            bbox = next_bbox
            volume_ratio = bbox_volume(bbox) / bbox_volume(before) if bbox_volume(before) > OVERLAP_TOL else 1.0
            if component_power(component) <= 0.0 and volume_ratio < DELETE_VOLUME_RATIO:
                deleted_ids.add(component_id)
                change_records.append({
                    "id": component_id,
                    "action": "delete",
                    "reasons": sorted(set(reasons + ["zero_power_too_small_after_crop"])),
                    "from": before,
                    "to": None,
                    "coverage_ratio": None,
                    "covered_by": obstacle.get("id"),
                    "operations": operations + [{"type": "delete", "reason": "zero_power_too_small_after_crop", "volume_ratio": volume_ratio}],
                })
                break
        if component_id in deleted_ids:
            continue
        if any(record.get("id") == component_id for record in failure_records):
            kept.append(component)
            continue
        try:
            normalize_component_geometry(component, bbox)
            refresh_mount(component, placement)
        except ValueError as exc:
            failure_records.append({"id": component_id, "reason": str(exc)})
            kept.append(component)
            continue
        kept.append(component)
        after = component_bbox(component)
        op_types = {item.get("type") for item in operations}
        action = "unchanged"
        if "move" in op_types and "crop" in op_types:
            action = "move_and_crop"
        elif "move" in op_types:
            action = "move"
        elif "crop" in op_types:
            action = "crop"
        if action != "unchanged":
            change_records.append({
                "id": component_id,
                "action": action,
                "reasons": sorted(set(reasons)),
                "from": before,
                "to": after,
                **summarize_bbox_change(before, after),
                "operations": operations,
            })

    kept.sort(key=lambda item: original_index.get(_component_id(item), 10**9))
    repaired["components"] = [components_by_id[_component_id(item)] for item in kept]
    validation = validate_repaired(repaired)
    summary = {
        "strategy": "crop_refined",
        "success": validation["success"] and not failure_records,
        "changed_count": len([item for item in change_records if item.get("action") != "delete"]),
        "deleted_count": len(deleted_ids),
        "changes": change_records,
        "failures": failure_records,
        "delete_coverage_ratio": float(delete_coverage_ratio),
        "fixed_obstacles": [{"id": wall["id"], "action": "fixed_obstacle", "bbox": wall["bbox"]} for wall in walls],
        **validation,
    }
    return repaired, summary


def is_catch_simulation_spec(spec: dict[str, Any]) -> bool:
    """Return true when the spec is the CATCH satellite panel-layout geometry."""
    document = spec.get("document") if isinstance(spec.get("document"), dict) else {}
    doc_name = str(document.get("name") or "").lower()
    wall_ids = {_wall_id(wall) for wall in spec.get("walls") or [] if isinstance(wall, dict)}
    return "catch" in doc_name or bool(CATCH_INTERNAL_WALL_IDS & wall_ids)


def _single_side_wall_bbox(
    wall_bbox: dict[str, list[float]],
    inner_bbox: dict[str, list[float]],
    *,
    clearance_mm: float,
    contact_face: str,
) -> dict[str, list[float]]:
    if contact_face not in {"xmin", "xmax"}:
        raise ValueError("contact_face must be 'xmin' or 'xmax'")

    new_min = list(wall_bbox["min"])
    new_max = list(wall_bbox["max"])
    if contact_face == "xmin":
        new_min[0] = inner_bbox["min"][0]
        new_max[0] = inner_bbox["max"][0] - clearance_mm
    else:
        new_min[0] = inner_bbox["min"][0] + clearance_mm
        new_max[0] = inner_bbox["max"][0]
    new_min[2] = inner_bbox["min"][2] + clearance_mm
    new_max[2] = inner_bbox["max"][2] - clearance_mm

    if any(new_max[index] <= new_min[index] for index in range(3)):
        raise ValueError("single-side wall bbox is invalid; clearance is too large for inner bbox")
    return {"min": new_min, "max": new_max}


def preprocess_catch_simulation_spec(
    spec: dict[str, Any],
    *,
    enabled: bool = True,
    clearance_mm: float = DEFAULT_CLEARANCE_MM,
    contact_face: str = "xmin",
    delete_coverage_ratio: float = DELETE_COVERAGE_RATIO,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Return a simulation-ready copy of a CATCH spec plus a change report.

    The cleanup first applies the refined crop/delete repair used for the last
    verified CATCH STEP. Then it keeps the two internal partition walls as STEP
    solids while trimming them so each wall touches only one cabin shell face.
    """
    processed = copy.deepcopy(spec)
    report: dict[str, Any] = {
        "enabled": bool(enabled),
        "applied": False,
        "reason": None,
        "strategy": "crop_refined_then_wall_single_side",
        "clearance_mm": float(clearance_mm),
        "contact_face": contact_face,
        "delete_coverage_ratio": float(delete_coverage_ratio),
        "deleted_components": [],
        "component_changes": [],
        "wall_changes": [],
        "changes": [],
    }
    if not enabled:
        report["reason"] = "disabled"
        return processed, report
    if not is_catch_simulation_spec(processed):
        report["reason"] = "not_catch_spec"
        return processed, report
    if clearance_mm <= 0:
        raise ValueError("clearance_mm must be positive")
    if not 0.0 < delete_coverage_ratio <= 1.0:
        raise ValueError("delete_coverage_ratio must be in (0, 1]")

    processed, repair_summary = repair_spec_crop_refined(processed, delete_coverage_ratio=float(delete_coverage_ratio))
    report["component_repair"] = repair_summary
    report["deleted_components"] = [item for item in repair_summary.get("changes", []) if item.get("action") == "delete"]
    report["component_changes"] = [item for item in repair_summary.get("changes", []) if item.get("action") != "delete"]
    if not repair_summary.get("success"):
        report["reason"] = "component_repair_failed"
        raise RuntimeError(json.dumps(report, ensure_ascii=False))

    envelope = processed.get("envelope") if isinstance(processed.get("envelope"), dict) else {}
    inner_bbox = _bbox3(envelope.get("inner_bbox"))
    if inner_bbox is None:
        report["reason"] = "missing_inner_bbox"
        return processed, report

    walls = processed.get("walls")
    if not isinstance(walls, list):
        report["reason"] = "missing_walls"
        return processed, report

    for wall in walls:
        if not isinstance(wall, dict):
            continue
        wall_id = _wall_id(wall)
        if wall_id not in CATCH_INTERNAL_WALL_IDS:
            continue
        before = _bbox3(wall.get("bbox"))
        if before is None:
            report["wall_changes"].append({"id": wall_id, "action": "skipped", "reason": "invalid_bbox"})
            continue
        after = _single_side_wall_bbox(before, inner_bbox, clearance_mm=float(clearance_mm), contact_face=contact_face)
        wall["bbox"] = after
        wall["position"] = list(after["min"])
        wall["dims"] = [after["max"][index] - after["min"][index] for index in range(3)]
        simulation = wall.get("simulation") if isinstance(wall.get("simulation"), dict) else {}
        simulation["single_side_contact_preprocess"] = True
        simulation["contact_face"] = f"inner_{contact_face}"
        simulation["clearance_mm"] = float(clearance_mm)
        wall["simulation"] = simulation
        report["wall_changes"].append({
            "id": wall_id,
            "action": "single_side_trim",
            "before": before,
            "after": after,
            "dims": wall["dims"],
        })

    processed.setdefault("summary", {})["catch_simulation_preprocess"] = {
        "strategy": report["strategy"],
        "clearance_mm": float(clearance_mm),
        "contact_face": contact_face,
        "deleted_component_count": len(report["deleted_components"]),
        "changed_component_count": len(report["component_changes"]),
        "changed_wall_count": len([item for item in report["wall_changes"] if item.get("action") == "single_side_trim"]),
        "validation": {key: repair_summary.get(key) for key in ("success", "component_overlap_count", "wall_overlap_count", "cabin_solid_overlap_count", "unmounted_component_count", "invalid_component_count")},
    }
    if isinstance(processed.get("envelope"), dict):
        processed["envelope"]["_wall_refs"] = copy.deepcopy(processed.get("walls") or [])
    final_validation = validate_repaired(processed)
    report["final_validation"] = final_validation
    report["mount_face_validation"] = final_validation.get("mount_face_validation")
    if not final_validation.get("success"):
        report["reason"] = "final_validation_failed"
        raise RuntimeError(json.dumps(report, ensure_ascii=False))
    report["changes"] = report["component_changes"] + report["deleted_components"] + report["wall_changes"]
    report["applied"] = bool(report["changes"])
    if not report["applied"]:
        report["reason"] = "no_changes"
    return processed, report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Prepare a CATCH cad_build_spec.json for simulation.")
    parser.add_argument("input", type=Path, help="Input cad_build_spec.json")
    parser.add_argument("output", type=Path, help="Output simulation-ready cad_build_spec.json")
    parser.add_argument("--report", type=Path, help="Optional JSON report path.")
    parser.add_argument("--clearance-mm", type=float, default=DEFAULT_CLEARANCE_MM)
    parser.add_argument("--contact-face", choices=("xmin", "xmax"), default="xmin")
    parser.add_argument("--delete-coverage-ratio", type=float, default=DELETE_COVERAGE_RATIO)
    parser.add_argument("--disable", action="store_true", help="Copy input unchanged and report disabled preprocessing.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    spec = json.loads(args.input.read_text(encoding="utf-8"))
    processed, report = preprocess_catch_simulation_spec(
        spec,
        enabled=not args.disable,
        clearance_mm=args.clearance_mm,
        contact_face=args.contact_face,
        delete_coverage_ratio=args.delete_coverage_ratio,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(processed, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"ok": True, "input": str(args.input), "output": str(args.output), "report": report}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
