from __future__ import annotations

from itertools import permutations
from typing import Any, Mapping


FACE_SPECS = [
    ("outer.zmax_outer", 2, 1),
    ("outer.xmax_outer", 0, 1),
    ("outer.xmin_outer", 0, -1),
    ("outer.ymax_outer", 1, 1),
    ("outer.ymin_outer", 1, -1),
    ("outer.zmin_outer", 2, -1),
]


def solve_add_component(
    *,
    component: Mapping[str, Any],
    geom: Mapping[str, Any],
    existing_bboxes: list[Mapping[str, list[float]]],
    clearance_mm: float = 0.0,
) -> dict[str, Any]:
    component_id = str(component.get("component_id") or "").strip()
    size = positive_vector3(component.get("size_mm") or component.get("dims_mm"))
    kind = str(component.get("kind") or kind_from_component_id(component_id))
    if not component_id:
        return unresolved(component, "missing_component_id", candidate_summary={"candidate_count": 0})
    if size is None:
        return unresolved(component, "missing_or_invalid_component_size", candidate_summary={"candidate_count": 0})
    if kind in {"external", "radiator"}:
        return solve_external_add(component=component, geom=geom, size=size, existing_bboxes=existing_bboxes)
    return solve_internal_add(
        component=component,
        geom=geom,
        size=size,
        existing_bboxes=existing_bboxes,
        clearance_mm=clearance_mm,
    )


def solve_external_add_with_move_existing(
    *,
    component: Mapping[str, Any],
    geom: Mapping[str, Any],
    existing_entities: list[Mapping[str, Any]],
    clearance_mm: float = 0.0,
) -> dict[str, Any]:
    component_id = str(component.get("component_id") or "").strip()
    size = positive_vector3(component.get("size_mm") or component.get("dims_mm"))
    if not component_id:
        return unresolved(component, "missing_component_id", candidate_summary={"candidate_count": 0})
    if size is None:
        return unresolved(component, "missing_or_invalid_component_size", candidate_summary={"candidate_count": 0})

    outer_bbox = bbox(((geom.get("outer_shell") or {}) if isinstance(geom.get("outer_shell"), Mapping) else {}).get("outer_bbox"))
    existing = entity_bboxes(existing_entities)
    candidates = enumerate_external_candidates(component=component, geom=geom, size=size, existing_bboxes=[])
    candidates.sort(key=lambda item: item["quality"]["overhang_mm"])
    attempts = []
    for candidate in candidates:
        quality_without_existing = candidate_quality(
            candidate["bbox"],
            container_bbox=outer_bbox,
            existing_bboxes=[],
            surface_normal_axis=(candidate.get("quality") or {}).get("surface_normal_axis"),
            surface_normal_sign=(candidate.get("quality") or {}).get("surface_normal_sign"),
        )
        if not quality_without_existing["strict_face_fit"]:
            attempts.append({"candidate": summarize_candidate(candidate), "reason": "candidate_overhang"})
            continue
        blockers = [
            entity
            for entity in existing
            if bbox_overlap_volume(candidate["bbox"], entity["bbox"]) > 1e-6
        ]
        if not blockers:
            solved_candidate = dict(candidate)
            solved_candidate["quality"] = candidate_quality(
                candidate["bbox"],
                container_bbox=outer_bbox,
                existing_bboxes=[item["bbox"] for item in existing],
                surface_normal_axis=(candidate.get("quality") or {}).get("surface_normal_axis"),
                surface_normal_sign=(candidate.get("quality") or {}).get("surface_normal_sign"),
            )
            return {
                "status": "solved",
                "candidate": solved_candidate,
                "move_actions": [],
                "candidate_summary": candidate_summary([solved_candidate]),
                "strategy": "direct_add_no_move_needed",
            }
        if len(blockers) > 2:
            attempts.append(
                {
                    "candidate": summarize_candidate(candidate),
                    "reason": "too_many_blockers",
                    "blocker_count": len(blockers),
                }
            )
            continue
        moved_entities = [dict(item, bbox=bbox(item["bbox"])) for item in existing]
        move_actions = []
        ok = True
        for blocker in blockers:
            move = find_surface_relocation_for_blocker(
                blocker=blocker,
                target_bbox=candidate["bbox"],
                outer_bbox=outer_bbox,
                all_entities=moved_entities,
                clearance_mm=clearance_mm,
            )
            if not move:
                ok = False
                break
            move_actions.append(move["action"])
            for item in moved_entities:
                if item["component_id"] == blocker["component_id"]:
                    item["bbox"] = move["new_bbox"]
                    break
        if not ok:
            attempts.append(
                {
                    "candidate": summarize_candidate(candidate),
                    "reason": "could_not_relocate_blockers",
                    "blockers": [blocker["component_id"] for blocker in blockers],
                }
            )
            continue
        final_quality = candidate_quality(
            candidate["bbox"],
            container_bbox=outer_bbox,
            existing_bboxes=[item["bbox"] for item in moved_entities],
            surface_normal_axis=(candidate.get("quality") or {}).get("surface_normal_axis"),
            surface_normal_sign=(candidate.get("quality") or {}).get("surface_normal_sign"),
        )
        if final_quality["ok"]:
            solved_candidate = dict(candidate)
            solved_candidate["quality"] = final_quality
            return {
                "status": "solved",
                "candidate": solved_candidate,
                "move_actions": move_actions,
                "candidate_summary": {
                    **candidate_summary(candidates),
                    "move_existing_attempted": True,
                    "moved_blockers": [action["component_id"] for action in move_actions],
                },
                "strategy": "move_existing_then_add",
            }
        attempts.append(
            {
                "candidate": summarize_candidate(candidate),
                "reason": "final_candidate_still_invalid",
                "quality": final_quality,
            }
        )

    return unresolved(
        component,
        "move_existing_then_add_no_valid_relayout",
        best_candidate=candidates[0] if candidates else None,
        candidate_summary={
            **candidate_summary(candidates),
            "move_existing_attempted": True,
            "attempts_sample": attempts[:5],
        },
        required_resolution=["expand_shell", "allow_overhang", "change_layout"],
    )


def solve_external_add(
    *,
    component: Mapping[str, Any],
    geom: Mapping[str, Any],
    size: list[float],
    existing_bboxes: list[Mapping[str, list[float]]],
) -> dict[str, Any]:
    candidates = enumerate_external_candidates(
        component=component,
        geom=geom,
        size=size,
        existing_bboxes=existing_bboxes,
    )
    candidates.sort(key=lambda item: item["quality"]["score"])
    best = candidates[0] if candidates else None
    strict = next((candidate for candidate in candidates if candidate["quality"]["ok"]), None)
    summary = candidate_summary(candidates)
    if strict is not None:
        return {"status": "solved", "candidate": strict, "candidate_summary": summary}
    reason = "no_outer_face_can_fit_projection_without_overhang"
    if best and best["quality"]["overlap_volume_mm3"] > 0:
        reason = "no_outer_face_candidate_without_collision_or_overhang"
    return unresolved(
        component,
        reason,
        best_candidate=best,
        candidate_summary=summary,
        required_resolution=["expand_shell", "allow_overhang", "change_layout"],
    )


def solve_external_add_with_shell_expansion(
    *,
    component: Mapping[str, Any],
    geom: Mapping[str, Any],
    existing_bboxes: list[Mapping[str, list[float]]],
    clearance_mm: float = 0.0,
) -> dict[str, Any]:
    component_id = str(component.get("component_id") or "").strip()
    size = positive_vector3(component.get("size_mm") or component.get("dims_mm"))
    if not component_id:
        return unresolved(component, "missing_component_id", candidate_summary={"candidate_count": 0})
    if size is None:
        return unresolved(component, "missing_or_invalid_component_size", candidate_summary={"candidate_count": 0})

    original_outer = bbox(((geom.get("outer_shell") or {}) if isinstance(geom.get("outer_shell"), Mapping) else {}).get("outer_bbox"))
    expanded_outer = expand_outer_bbox_to_fit_external_size(original_outer, size, margin_mm=max(clearance_mm, 3.0))
    expanded_geom = dict(geom)
    expanded_shell = dict(expanded_geom.get("outer_shell") or {})
    expanded_shell["outer_bbox"] = expanded_outer
    thickness = float(expanded_shell.get("thickness", 0.0) or 0.0)
    if thickness > 0:
        expanded_shell["inner_bbox"] = {
            "min": [expanded_outer["min"][axis] + thickness for axis in range(3)],
            "max": [expanded_outer["max"][axis] - thickness for axis in range(3)],
        }
    expanded_geom["outer_shell"] = expanded_shell
    solved = solve_external_add(
        component=component,
        geom=expanded_geom,
        size=size,
        existing_bboxes=existing_bboxes,
    )
    if solved.get("status") != "solved":
        return unresolved(
            component,
            "expand_shell_no_valid_external_candidate",
            candidate_summary=solved.get("candidate_summary"),
            required_resolution=["allow_overhang", "change_layout"],
        )
    return {
        "status": "solved",
        "candidate": solved["candidate"],
        "expand_action": {
            "type": "expand_shell",
            "outer_bbox": expanded_outer,
            "inner_bbox": expanded_shell.get("inner_bbox"),
            "expansion_mm": bbox_expansion_delta(original_outer, expanded_outer),
            "reason": "expand outer shell so external component projection fits without overhang",
        },
        "candidate_summary": {
            **dict(solved.get("candidate_summary") or {}),
            "shell_expansion": {
                "from_outer_bbox": original_outer,
                "to_outer_bbox": expanded_outer,
                "expansion_mm": bbox_expansion_delta(original_outer, expanded_outer),
            },
        },
        "strategy": "expand_shell_then_add",
    }


def propose_shell_expansion_for_relayout(
    *,
    geom: Mapping[str, Any],
    components: list[Mapping[str, Any]],
    clearance_mm: float = 0.0,
    expansion_scale: float = 1.15,
) -> dict[str, Any]:
    """Propose an expanded shell for full relayout.

    This deliberately does not choose positions. The 02 official expansion path
    should rerun the 01 packing algorithm after resizing the envelope instead
    of patching individual bbox placements.
    """
    original_outer = bbox(((geom.get("outer_shell") or {}) if isinstance(geom.get("outer_shell"), Mapping) else {}).get("outer_bbox"))
    expanded = bbox(original_outer)
    scale = max(1.0, float(expansion_scale))
    center = [
        (original_outer["min"][axis] + original_outer["max"][axis]) / 2.0
        for axis in range(3)
    ]
    half = [
        (original_outer["max"][axis] - original_outer["min"][axis]) * scale / 2.0
        for axis in range(3)
    ]
    expanded = {
        "min": [round(center[axis] - half[axis], 9) for axis in range(3)],
        "max": [round(center[axis] + half[axis], 9) for axis in range(3)],
    }

    margin = max(float(clearance_mm), 3.0)
    for component in components:
        size = positive_vector3(component.get("size_mm") or component.get("dims_mm"))
        if not size:
            continue
        kind = str(component.get("kind") or kind_from_component_id(str(component.get("component_id") or "")))
        if kind in {"external", "radiator"}:
            expanded = expand_outer_bbox_to_fit_external_size(expanded, size, margin_mm=margin)
        else:
            expanded = expand_outer_bbox_to_fit_internal_size(expanded, geom, size, margin_mm=margin)

    return {
        "status": "solved",
        "outer_bbox": expanded,
        "inner_bbox": inner_bbox_for_outer_bbox(geom, expanded),
        "outer_size_mm": bbox_size(expanded),
        "expansion_mm": bbox_expansion_delta(original_outer, expanded),
        "candidate_summary": {
            "strategy": "expand_shell_then_relayout",
            "target_component_count": len(components),
            "from_outer_bbox": original_outer,
            "to_outer_bbox": expanded,
            "outer_size_mm": bbox_size(expanded),
            "expansion_mm": bbox_expansion_delta(original_outer, expanded),
        },
    }


def enumerate_external_candidates(
    *,
    component: Mapping[str, Any],
    geom: Mapping[str, Any],
    size: list[float],
    existing_bboxes: list[Mapping[str, list[float]]],
) -> list[dict[str, Any]]:
    outer_bbox = bbox(((geom.get("outer_shell") or {}) if isinstance(geom.get("outer_shell"), Mapping) else {}).get("outer_bbox"))
    candidates = []
    for mount_face_id, normal_axis, normal_sign in FACE_SPECS:
        plane_axes = [axis for axis in range(3) if axis != normal_axis]
        for dims in oriented_dims(size):
            # External/radiator parts should use the thinnest dimension as the normal thickness.
            if dims[normal_axis] != min(size):
                continue
            for plane_min in surface_plane_positions(outer_bbox, dims=dims, plane_axes=plane_axes):
                candidate_bbox = surface_bbox(
                    outer_bbox,
                    dims=dims,
                    normal_axis=normal_axis,
                    normal_sign=normal_sign,
                    plane_min=plane_min,
                    plane_axes=plane_axes,
                )
                quality = candidate_quality(
                    candidate_bbox,
                    container_bbox=outer_bbox,
                    existing_bboxes=existing_bboxes,
                    surface_normal_axis=normal_axis,
                    surface_normal_sign=normal_sign,
                )
                candidates.append(
                    {
                        "bbox": candidate_bbox,
                        "mount_face_id": mount_face_id,
                        "install_pos": list(candidate_bbox["min"]),
                        "leaf_node_id": "leaf.outer",
                        "quality": quality,
                        "policy": "enumerate outer shell faces, 90-degree bbox orientations, and face-corner/center projection positions",
                    }
                )
    return candidates


def solve_internal_add(
    *,
    component: Mapping[str, Any],
    geom: Mapping[str, Any],
    size: list[float],
    existing_bboxes: list[Mapping[str, list[float]]],
    clearance_mm: float,
) -> dict[str, Any]:
    inner_bbox = inner_bbox_from_geom(geom)
    candidates = []
    for dims in oriented_dims(size):
        if any(dims[axis] > inner_bbox["max"][axis] - inner_bbox["min"][axis] for axis in range(3)):
            continue
        for position in grid_positions(inner_bbox, dims=dims):
            candidate_bbox = {"min": position, "max": [round(position[index] + dims[index], 9) for index in range(3)]}
            quality = candidate_quality(
                candidate_bbox,
                container_bbox=inner_bbox,
                existing_bboxes=expanded_bboxes(existing_bboxes, clearance_mm),
            )
            candidates.append(
                {
                    "bbox": candidate_bbox,
                    "mount_face_id": "cabin_auto_1.zmin",
                    "cabin_id": "cabin_auto_1",
                    "install_pos": list(candidate_bbox["min"]),
                    "leaf_node_id": "leaf.cabin_auto_1",
                    "quality": quality,
                    "policy": "enumerate internal 3D occupancy grid positions and 90-degree bbox orientations",
                }
            )
    candidates.sort(key=lambda item: item["quality"]["score"])
    best = candidates[0] if candidates else None
    strict = next((candidate for candidate in candidates if candidate["quality"]["ok"]), None)
    summary = candidate_summary(candidates)
    if strict is not None:
        return {"status": "solved", "candidate": strict, "candidate_summary": summary}
    reason = "no_internal_grid_slot_without_collision"
    if not candidates:
        reason = "component_size_exceeds_inner_bbox"
    return unresolved(
        component,
        reason,
        best_candidate=best,
        candidate_summary=summary,
        required_resolution=["move_existing_components", "expand_shell", "change_layout"],
    )


def candidate_quality(
    candidate_bbox: Mapping[str, list[float]],
    *,
    container_bbox: Mapping[str, list[float]],
    existing_bboxes: list[Mapping[str, list[float]]],
    surface_normal_axis: int | None = None,
    surface_normal_sign: int | None = None,
) -> dict[str, Any]:
    overhang = 0.0
    for axis in range(3):
        if axis == surface_normal_axis:
            continue
        overhang += max(0.0, container_bbox["min"][axis] - candidate_bbox["min"][axis])
        overhang += max(0.0, candidate_bbox["max"][axis] - container_bbox["max"][axis])
    if surface_normal_axis is None:
        for axis in range(3):
            overhang += max(0.0, container_bbox["min"][axis] - candidate_bbox["min"][axis])
            overhang += max(0.0, candidate_bbox["max"][axis] - container_bbox["max"][axis])
    overlap = sum(bbox_overlap_volume(candidate_bbox, other) for other in existing_bboxes)
    strict_fit = overhang <= 1e-6
    score = (0.0 if strict_fit else 1_000_000_000.0) + overlap * 10.0 + overhang
    return {
        "ok": strict_fit and overlap <= 1e-6,
        "strict_face_fit": strict_fit,
        "overhang_mm": round(overhang, 9),
        "overlap_volume_mm3": round(overlap, 9),
        "surface_normal_axis": surface_normal_axis,
        "surface_normal_sign": surface_normal_sign,
        "score": round(score, 9),
    }


def candidate_summary(candidates: list[Mapping[str, Any]]) -> dict[str, Any]:
    best = candidates[0] if candidates else None
    ok_count = sum(1 for candidate in candidates if (candidate.get("quality") or {}).get("ok"))
    return {
        "candidate_count": len(candidates),
        "ok_candidate_count": ok_count,
        "best_candidate": summarize_candidate(best),
        "best_ok": bool((best or {}).get("quality", {}).get("ok")) if best else False,
    }


def summarize_candidate(candidate: Mapping[str, Any] | None) -> dict[str, Any] | None:
    if not candidate:
        return None
    return {
        "mount_face_id": candidate.get("mount_face_id"),
        "bbox": candidate.get("bbox"),
        "quality": candidate.get("quality"),
        "policy": candidate.get("policy"),
    }


def unresolved(
    component: Mapping[str, Any],
    reason: str,
    *,
    best_candidate: Mapping[str, Any] | None = None,
    candidate_summary: Mapping[str, Any] | None = None,
    required_resolution: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "status": "unresolved",
        "unresolved": {
            "component_id": component.get("component_id"),
            "semantic_name": component.get("semantic_name"),
            "layout_part_id": component.get("layout_part_id"),
            "kind": component.get("kind"),
            "component_subtype": component.get("component_subtype"),
            "size_mm": component.get("size_mm") or component.get("dims_mm"),
            "reason": reason,
            "best_candidate": summarize_candidate(best_candidate),
            "required_resolution": required_resolution or [],
        },
        "candidate_summary": dict(candidate_summary or {"candidate_count": 0, "ok_candidate_count": 0}),
    }


def surface_plane_positions(
    outer_bbox: Mapping[str, list[float]],
    *,
    dims: list[float],
    plane_axes: list[int],
) -> list[list[float]]:
    axis_positions = []
    for axis in plane_axes:
        low = outer_bbox["min"][axis]
        high = outer_bbox["max"][axis] - dims[axis]
        center = (outer_bbox["min"][axis] + outer_bbox["max"][axis] - dims[axis]) / 2.0
        if high < low:
            axis_positions.append([center])
        else:
            axis_positions.append(unique_sorted([low, center, high]))
    return [[a, b] for a in axis_positions[0] for b in axis_positions[1]]


def surface_bbox(
    outer_bbox: Mapping[str, list[float]],
    *,
    dims: list[float],
    normal_axis: int,
    normal_sign: int,
    plane_min: list[float],
    plane_axes: list[int],
) -> dict[str, list[float]]:
    mins = [0.0, 0.0, 0.0]
    maxs = [0.0, 0.0, 0.0]
    for axis in range(3):
        if axis == normal_axis:
            if normal_sign > 0:
                mins[axis] = outer_bbox["max"][axis]
                maxs[axis] = outer_bbox["max"][axis] + dims[axis]
            else:
                mins[axis] = outer_bbox["min"][axis] - dims[axis]
                maxs[axis] = outer_bbox["min"][axis]
            continue
        plane_index = plane_axes.index(axis)
        mins[axis] = plane_min[plane_index]
        maxs[axis] = plane_min[plane_index] + dims[axis]
    return {"min": [round(value, 9) for value in mins], "max": [round(value, 9) for value in maxs]}


def grid_positions(container_bbox: Mapping[str, list[float]], *, dims: list[float]) -> list[list[float]]:
    axis_positions = []
    for axis in range(3):
        low = container_bbox["min"][axis]
        high = container_bbox["max"][axis] - dims[axis]
        center = (container_bbox["min"][axis] + container_bbox["max"][axis] - dims[axis]) / 2.0
        if high < low:
            return []
        quarter = low + (high - low) * 0.25
        three_quarter = low + (high - low) * 0.75
        axis_positions.append(unique_sorted([low, quarter, center, three_quarter, high]))
    return [[x, y, z] for x in axis_positions[0] for y in axis_positions[1] for z in axis_positions[2]]


def oriented_dims(size: list[float]) -> list[list[float]]:
    return [list(item) for item in sorted(set(permutations([float(value) for value in size], 3)))]


def expanded_bboxes(bboxes: list[Mapping[str, list[float]]], clearance_mm: float) -> list[dict[str, list[float]]]:
    if clearance_mm <= 0:
        return [bbox(item) for item in bboxes]
    expanded = []
    for item in bboxes:
        box = bbox(item)
        expanded.append(
            {
                "min": [value - clearance_mm for value in box["min"]],
                "max": [value + clearance_mm for value in box["max"]],
            }
        )
    return expanded


def expand_outer_bbox_to_fit_external_size(
    outer_bbox: Mapping[str, list[float]],
    size: list[float],
    *,
    margin_mm: float,
) -> dict[str, list[float]]:
    result = bbox(outer_bbox)
    sorted_dims = sorted(float(value) for value in size)
    required_plane_dims = sorted_dims[1:]
    extents = [result["max"][axis] - result["min"][axis] for axis in range(3)]
    axes = sorted(range(3), key=lambda axis: extents[axis])[:2]
    for axis, required in zip(axes, required_plane_dims):
        target = required + margin_mm * 2.0
        if extents[axis] >= target:
            continue
        grow = (target - extents[axis]) / 2.0
        result["min"][axis] = round(result["min"][axis] - grow, 9)
        result["max"][axis] = round(result["max"][axis] + grow, 9)
    return result


def expand_outer_bbox_to_fit_internal_size(
    outer_bbox: Mapping[str, list[float]],
    geom: Mapping[str, Any],
    size: list[float],
    *,
    margin_mm: float,
) -> dict[str, list[float]]:
    result = bbox(outer_bbox)
    shell = geom.get("outer_shell") if isinstance(geom.get("outer_shell"), Mapping) else {}
    thickness = float(shell.get("thickness", 0.0) or 0.0)
    required_outer_size = [float(value) + 2.0 * (thickness + margin_mm) for value in size]
    current_size = bbox_size(result)
    for axis in range(3):
        deficit = required_outer_size[axis] - current_size[axis]
        if deficit > 0.0:
            result["min"][axis] = round(result["min"][axis] - deficit / 2.0, 9)
            result["max"][axis] = round(result["max"][axis] + deficit / 2.0, 9)
    return result


def inner_bbox_for_outer_bbox(
    geom: Mapping[str, Any],
    outer_bbox: Mapping[str, list[float]],
) -> dict[str, list[float]] | None:
    shell = geom.get("outer_shell") if isinstance(geom.get("outer_shell"), Mapping) else {}
    thickness = float(shell.get("thickness", 0.0) or 0.0)
    if thickness <= 0.0:
        return None
    outer = bbox(outer_bbox)
    inner = {
        "min": [round(outer["min"][axis] + thickness, 9) for axis in range(3)],
        "max": [round(outer["max"][axis] - thickness, 9) for axis in range(3)],
    }
    if min(bbox_size(inner)) <= 0.0:
        return None
    return inner


def bbox_size(value: Mapping[str, list[float]]) -> list[float]:
    box = bbox(value)
    return [round(box["max"][axis] - box["min"][axis], 9) for axis in range(3)]


def bbox_expansion_delta(
    before: Mapping[str, list[float]],
    after: Mapping[str, list[float]],
) -> dict[str, list[float]]:
    b = bbox(before)
    a = bbox(after)
    return {
        "min_delta": [round(a["min"][axis] - b["min"][axis], 9) for axis in range(3)],
        "max_delta": [round(a["max"][axis] - b["max"][axis], 9) for axis in range(3)],
    }


def entity_bboxes(entities: list[Mapping[str, Any]]) -> list[dict[str, Any]]:
    result = []
    for index, entity in enumerate(entities):
        if not isinstance(entity, Mapping):
            continue
        component_id = str(entity.get("component_id") or entity.get("id") or "")
        box = bbox(entity.get("bbox"))
        if not component_id or min(box["max"][axis] - box["min"][axis] for axis in range(3)) <= 0.0:
            continue
        result.append(
            {
                "index": index,
                "component_id": component_id,
                "semantic_name": entity.get("semantic_name"),
                "kind": entity.get("kind") or kind_from_component_id(component_id),
                "bbox": box,
            }
        )
    return result


def find_surface_relocation_for_blocker(
    *,
    blocker: Mapping[str, Any],
    target_bbox: Mapping[str, list[float]],
    outer_bbox: Mapping[str, list[float]],
    all_entities: list[Mapping[str, Any]],
    clearance_mm: float,
) -> dict[str, Any] | None:
    blocker_box = bbox(blocker.get("bbox"))
    dims = [blocker_box["max"][axis] - blocker_box["min"][axis] for axis in range(3)]
    thickness = min(dims)
    normal_axis = dims.index(thickness)
    plane_axes = [axis for axis in range(3) if axis != normal_axis]
    normal_sign = 1 if blocker_box["min"][normal_axis] >= outer_bbox["max"][normal_axis] - 1e-6 else -1
    static_entities = [
        item
        for item in all_entities
        if item.get("component_id") != blocker.get("component_id")
    ]
    occupied = [target_bbox] + [item["bbox"] for item in static_entities]
    for plane_min in dense_surface_plane_positions(outer_bbox, dims=dims, plane_axes=plane_axes):
        candidate = surface_bbox(
            outer_bbox,
            dims=dims,
            normal_axis=normal_axis,
            normal_sign=normal_sign,
            plane_min=plane_min,
            plane_axes=plane_axes,
        )
        delta = [round(candidate["min"][axis] - blocker_box["min"][axis], 9) for axis in range(3)]
        if max(abs(value) for value in delta) <= 1e-6:
            continue
        quality = candidate_quality(
            candidate,
            container_bbox=outer_bbox,
            existing_bboxes=expanded_bboxes(occupied, clearance_mm),
            surface_normal_axis=normal_axis,
            surface_normal_sign=normal_sign,
        )
        if quality["ok"]:
            return {
                "new_bbox": candidate,
                "action": {
                    "type": "move_component",
                    "component_id": blocker["component_id"],
                    "semantic_name": blocker.get("semantic_name"),
                    "delta_mm": delta,
                    "selection_policy": {
                        "planner": "structured_geometry_edit_planner",
                        "operation": "move_component",
                        "strategy": "move_existing_then_add",
                        "reason": "relocate blocker to create a validated add_component slot",
                        "new_bbox": candidate,
                        "placement_quality": quality,
                    },
                    "reason": "move existing component to make room for unresolved component",
                },
            }
    return None


def dense_surface_plane_positions(
    outer_bbox: Mapping[str, list[float]],
    *,
    dims: list[float],
    plane_axes: list[int],
) -> list[list[float]]:
    axis_positions = []
    for axis in plane_axes:
        low = outer_bbox["min"][axis]
        high = outer_bbox["max"][axis] - dims[axis]
        if high < low:
            return []
        span = high - low
        axis_positions.append(unique_sorted([low + span * fraction / 4.0 for fraction in range(5)]))
    return [[a, b] for a in axis_positions[0] for b in axis_positions[1]]


def inner_bbox_from_geom(geom: Mapping[str, Any]) -> dict[str, list[float]]:
    outer_shell = geom.get("outer_shell") if isinstance(geom.get("outer_shell"), Mapping) else {}
    if isinstance(outer_shell.get("inner_bbox"), Mapping):
        return bbox(outer_shell["inner_bbox"])
    if isinstance(outer_shell.get("outer_bbox"), Mapping):
        return bbox(outer_shell["outer_bbox"])
    return {"min": [-1e9, -1e9, -1e9], "max": [1e9, 1e9, 1e9]}


def bbox(value: Any) -> dict[str, list[float]]:
    if not isinstance(value, Mapping):
        return {"min": [0.0, 0.0, 0.0], "max": [0.0, 0.0, 0.0]}
    return {"min": vector3(value.get("min")), "max": vector3(value.get("max"))}


def positive_vector3(value: Any) -> list[float] | None:
    if not isinstance(value, list) or len(value) != 3:
        return None
    vector = [float(item) for item in value]
    if min(vector) <= 0.0:
        return None
    return vector


def vector3(value: Any) -> list[float]:
    if not isinstance(value, list) or len(value) != 3:
        return [0.0, 0.0, 0.0]
    return [float(item) for item in value]


def bbox_overlap_volume(left: Mapping[str, list[float]], right: Mapping[str, list[float]]) -> float:
    overlap = 1.0
    for axis in range(3):
        span = min(left["max"][axis], right["max"][axis]) - max(left["min"][axis], right["min"][axis])
        if span <= 0.0:
            return 0.0
        overlap *= span
    return round(overlap, 9)


def unique_sorted(values: list[float]) -> list[float]:
    return sorted({round(float(value), 9) for value in values})


def kind_from_component_id(component_id: str) -> str:
    if component_id.startswith("E"):
        return "external"
    if component_id.startswith("R"):
        return "radiator"
    return "internal"
