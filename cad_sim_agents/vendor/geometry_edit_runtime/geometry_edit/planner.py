from __future__ import annotations

import re
from typing import Any, Mapping

from .search_solver import (
    bbox,
    propose_shell_expansion_for_relayout,
    solve_add_component,
    solve_external_add_with_move_existing,
)


def plan_geometry_edit(
    *,
    request: str,
    geom: Mapping[str, Any],
    registry: Mapping[str, Any],
    topology: Mapping[str, Any],
    components: Mapping[str, Any],
    layout_result: Mapping[str, Any],
    unplaced_doc: Mapping[str, Any],
    case_index: int,
    move_mm: float,
    max_actions: int,
    clearance_mm: float = 0.0,
) -> dict[str, Any]:
    unplaced_components = [
        component
        for component in (unplaced_doc.get("components") if isinstance(unplaced_doc, Mapping) else []) or []
        if isinstance(component, Mapping)
    ]
    parsed_request = parse_edit_request(request, move_mm=move_mm)
    targets = build_targets(
        unplaced_components=unplaced_components,
        parsed_request=parsed_request,
        components=components,
    )
    context = {
        "layout_ok": bool(layout_result.get("ok")),
        "layout_error": layout_result.get("error"),
        "n_unplaced": len(unplaced_components) if unplaced_components else int((layout_result.get("stats") or {}).get("n_unplaced", 0)),
        "n_placed": int((layout_result.get("stats") or {}).get("n_placed", 0)),
        "n_parts": int((layout_result.get("stats") or {}).get("n_parts", 0)),
        "component_count_in_registry": len([e for e in registry.get("entities", []) if isinstance(e, Mapping)]),
        "missing_component_identity_available": bool(unplaced_components),
        "missing_components": [
            {
                "component_id": component.get("component_id"),
                "semantic_name": component.get("semantic_name"),
                "layout_part_id": component.get("layout_part_id"),
                "kind": component.get("kind"),
                "component_subtype": component.get("component_subtype"),
                "size_mm": component.get("size_mm"),
            }
            for component in unplaced_components
        ],
    }

    warnings = []
    actions: list[dict[str, Any]] = []
    unresolved_components: list[dict[str, Any]] = []
    candidate_summaries: list[dict[str, Any]] = []

    explicit_component_id = parsed_request.get("component_id")
    if explicit_component_id:
        action = plan_explicit_component_move(
            registry=registry,
            component_id=str(explicit_component_id),
            delta=vector3(parsed_request.get("delta_mm")),
            request=request,
        )
        actions = [action]
        planner_intent = "move_explicit_component_from_request"
    else:
        planner_intent = "place_unplaced_components" if targets else "general_layout_refinement"
        existing_bboxes = [
            bbox(entity.get("bbox"))
            for entity in registry.get("entities", [])
            if isinstance(entity, Mapping)
        ]
        if targets and parsed_request.get("allow_shell_expansion"):
            expansion = propose_shell_expansion_for_relayout(
                geom=geom,
                components=targets,
                clearance_mm=clearance_mm,
            )
            candidate_summaries.append(dict(expansion.get("candidate_summary") or {}))
            actions.append(
                {
                    "type": "expand_shell_then_relayout",
                    "outer_bbox": expansion.get("outer_bbox"),
                    "inner_bbox": expansion.get("inner_bbox"),
                    "outer_size_mm": expansion.get("outer_size_mm"),
                    "expansion_mm": expansion.get("expansion_mm"),
                    "target_component_ids": [
                        target.get("component_id")
                        for target in targets
                        if target.get("component_id")
                    ],
                    "selection_policy": {
                        "strategy": "expand_shell_then_relayout",
                        "official_expansion_path": True,
                        "source_request": request,
                        "note": (
                            "Resize the shell and rerun the 01 layout packing algorithm for all BOM components; "
                            "do not patch individual add_component bboxes."
                        ),
                    },
                    "reason": "shell expansion is allowed; rerun full layout instead of expand_shell_then_add",
                }
            )
        for target in ([] if actions and actions[0].get("type") == "expand_shell_then_relayout" else targets):
            if len(actions) >= max(0, max_actions):
                unresolved_components.append(
                    unresolved_from_target(
                        target,
                        reason="max_actions_limit_reached",
                        required_resolution=["increase_max_actions_per_case"],
                    )
                )
                continue
            solved = solve_add_component(
                component=target,
                geom=geom,
                existing_bboxes=existing_bboxes,
                clearance_mm=clearance_mm,
            )
            candidate_summaries.append(
                {
                    "component_id": target.get("component_id"),
                    "semantic_name": target.get("semantic_name"),
                    **dict(solved.get("candidate_summary") or {}),
                }
            )
            if solved.get("status") != "solved":
                if _should_try_move_existing(target, parsed_request, solved):
                    moved_solved = solve_external_add_with_move_existing(
                        component=target,
                        geom=geom,
                        existing_entities=[
                            entity
                            for entity in registry.get("entities", [])
                            if isinstance(entity, Mapping)
                        ],
                        clearance_mm=clearance_mm,
                    )
                    candidate_summaries[-1]["move_existing_then_add"] = dict(
                        moved_solved.get("candidate_summary") or {}
                    )
                    if moved_solved.get("status") == "solved":
                        move_actions = [dict(action) for action in moved_solved.get("move_actions", [])]
                        remaining_slots = max(0, max_actions - len(actions))
                        if len(move_actions) + 1 > remaining_slots:
                            unresolved_components.append(
                                unresolved_from_target(
                                    target,
                                    reason="move_existing_then_add_requires_more_actions_than_limit",
                                    required_resolution=["increase_max_actions_per_case"],
                                )
                            )
                            continue
                        add_action = action_from_candidate(
                            target=target,
                            candidate=moved_solved["candidate"],
                            topology=topology,
                            request=request,
                        )
                        add_action["selection_policy"]["strategy"] = "move_existing_then_add"
                        add_action["selection_policy"]["move_action_count"] = len(move_actions)
                        actions.extend(move_actions)
                        actions.append(add_action)
                        existing_bboxes.append(bbox(add_action["bbox"]))
                        continue
                    candidate_summaries[-1]["move_existing_then_add_unresolved"] = dict(
                        moved_solved.get("unresolved") or {}
                    )
                unresolved_components.append(dict(solved.get("unresolved") or unresolved_from_target(target, reason="unresolved")))
                continue
            action = action_from_candidate(
                target=target,
                candidate=solved["candidate"],
                topology=topology,
                request=request,
            )
            actions.append(action)
            existing_bboxes.append(bbox(action["bbox"]))

    if context["n_unplaced"] and not targets:
        warnings.append(
            "layout has unplaced components, but no target could be built from unplaced_components.json."
        )
    if parsed_request.get("unsupported_intents"):
        warnings.append("unsupported request parts: " + ", ".join(parsed_request["unsupported_intents"]))

    return {
        "schema_version": "2.0",
        "planner": "structured_geometry_edit_planner",
        "planner_mode": "deterministic",
        "case_index": case_index,
        "request": request,
        "planner_intent": planner_intent,
        "intent": planner_intent,
        "parsed_request": parsed_request,
        "constraints": build_constraints(parsed_request),
        "context": context,
        "targets": targets,
        "actions": actions,
        "unresolved_components": unresolved_components,
        "candidate_summary": candidate_summaries,
        "warnings": warnings,
    }


def build_targets(
    *,
    unplaced_components: list[Mapping[str, Any]],
    parsed_request: Mapping[str, Any],
    components: Mapping[str, Any],
) -> list[dict[str, Any]]:
    component_lookup = {
        str(component.get("component_id")): component
        for component in components.get("components", [])
        if isinstance(component, Mapping) and component.get("component_id")
    }
    targets = []
    for component in unplaced_components:
        component_id = str(component.get("component_id") or "")
        full = component_lookup.get(component_id, {})
        target = {
            **dict(full),
            **dict(component),
            "constraints": build_target_constraints(component, parsed_request),
        }
        targets.append(target)
    targets.sort(key=target_sort_key)
    return targets


def build_target_constraints(component: Mapping[str, Any], parsed_request: Mapping[str, Any]) -> dict[str, Any]:
    kind = str(component.get("kind") or "")
    return {
        "placement_preference": "outer_surface" if kind in {"external", "radiator"} else "internal_volume",
        "must_not_overlap": True,
        "must_fit_surface_projection": kind in {"external", "radiator"},
        "allow_overhang": bool(parsed_request.get("allow_overhang")),
        "allow_move_existing": bool(parsed_request.get("allow_move_existing")),
        "allow_shell_expansion": bool(parsed_request.get("allow_shell_expansion")),
    }


def build_constraints(parsed_request: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "must_not_overlap": True,
        "allow_overhang": bool(parsed_request.get("allow_overhang")),
        "allow_move_existing": bool(parsed_request.get("allow_move_existing")),
        "allow_shell_expansion": bool(parsed_request.get("allow_shell_expansion")),
        "bad_candidates_must_be_unresolved": True,
    }


def _should_try_move_existing(
    target: Mapping[str, Any],
    parsed_request: Mapping[str, Any],
    solved: Mapping[str, Any],
) -> bool:
    constraints = target.get("constraints") if isinstance(target.get("constraints"), Mapping) else {}
    if not (parsed_request.get("allow_move_existing") or constraints.get("allow_move_existing")):
        return False
    if str(target.get("kind") or "") not in {"external", "radiator"}:
        return False
    unresolved = solved.get("unresolved") if isinstance(solved.get("unresolved"), Mapping) else {}
    reason = str(unresolved.get("reason") or "")
    return reason in {
        "no_outer_face_candidate_without_collision_or_overhang",
        "no_outer_face_can_fit_projection_without_overhang",
    }


def _should_try_shell_expansion(
    target: Mapping[str, Any],
    parsed_request: Mapping[str, Any],
) -> bool:
    constraints = target.get("constraints") if isinstance(target.get("constraints"), Mapping) else {}
    if not (parsed_request.get("allow_shell_expansion") or constraints.get("allow_shell_expansion")):
        return False
    return str(target.get("kind") or "") in {"external", "radiator"}


def action_from_candidate(
    *,
    target: Mapping[str, Any],
    candidate: Mapping[str, Any],
    topology: Mapping[str, Any],
    request: str,
) -> dict[str, Any]:
    component_id = str(target.get("component_id") or "").strip()
    bbox_value = bbox(candidate.get("bbox"))
    quality = dict(candidate.get("quality") or {})
    return {
        "type": "add_component",
        "component_id": component_id,
        "semantic_name": target.get("semantic_name"),
        "kind": target.get("kind"),
        "category": target.get("category"),
        "component_subtype": target.get("component_subtype"),
        "layout_part_id": target.get("layout_part_id") or component_id,
        "geometry_id": next_geometry_id_from_topology(topology),
        "step_name": target.get("layout_part_id") or component_id,
        "bbox": bbox_value,
        "size_mm": target.get("size_mm") or target.get("dims_mm"),
        "mass_kg": target.get("mass_kg"),
        "power_W": target.get("power_W"),
        "mount_face_id": candidate.get("mount_face_id"),
        "cabin_id": candidate.get("cabin_id"),
        "component_mount_face_id": component_mount_face_id(target, component_id),
        "install_pos": candidate.get("install_pos") or bbox_value["min"],
        "leaf_node_id": candidate.get("leaf_node_id"),
        "placement_quality": quality,
        "selection_policy": {
            "planner": "structured_geometry_edit_planner",
            "operation": "add_component",
            "candidate_filter": "only execute candidates with placement_quality.ok=true",
            "placement_policy": candidate.get("policy"),
            "source_request": request,
        },
        "reason": (
            "add missing component using validated search candidate; "
            f"strict_fit={quality.get('strict_face_fit')}, overlap_volume_mm3={quality.get('overlap_volume_mm3')}"
        ),
    }


def unresolved_from_target(
    target: Mapping[str, Any],
    *,
    reason: str,
    required_resolution: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "component_id": target.get("component_id"),
        "semantic_name": target.get("semantic_name"),
        "layout_part_id": target.get("layout_part_id"),
        "kind": target.get("kind"),
        "component_subtype": target.get("component_subtype"),
        "size_mm": target.get("size_mm") or target.get("dims_mm"),
        "reason": reason,
        "best_candidate": None,
        "required_resolution": required_resolution or [],
    }


def parse_edit_request(
    request: str,
    *,
    move_mm: float,
) -> dict[str, Any]:
    component_match = re.search(r"\b[PER]\d{3}\b", request, flags=re.IGNORECASE)
    distance_match = re.search(r"([-+]?\d+(?:\.\d+)?)\s*mm", request, flags=re.IGNORECASE)
    distance = abs(float(distance_match.group(1))) if distance_match else float(move_mm)
    direction = direction_from_natural_text(request)
    lowered = request.lower()
    unsupported = []
    if any(token in lowered for token in ["删除", "移除", "delete", "remove"]):
        unsupported.append("delete_component is available in dataset mode but not selected by this planner")
    return {
        "component_id": component_match.group(0).upper() if component_match else None,
        "move_mm": distance,
        "direction": direction["label"],
        "delta_mm": [round(value * distance, 6) for value in direction["unit"]],
        "wants_add": any(token in lowered for token in ["新增", "添加", "add", "未放置"]),
        "allow_overhang": _allows_overhang(lowered),
        "allow_move_existing": any(token in lowered for token in ["移动已有", "腾空间", "move existing"]),
        "allow_shell_expansion": any(token in lowered for token in ["扩箱", "扩大箱体", "expand shell"]),
        "unsupported_intents": unsupported,
    }


def _allows_overhang(lowered_request: str) -> bool:
    negative_tokens = [
        "不允许外伸",
        "不能外伸",
        "禁止外伸",
        "不允许越界",
        "不能越界",
        "禁止越界",
        "no overhang",
        "without overhang",
        "do not overhang",
    ]
    if any(token in lowered_request for token in negative_tokens):
        return False
    return any(
        token in lowered_request
        for token in ["允许外伸", "允许越界", "allow overhang"]
    )


def direction_from_natural_text(request: str) -> dict[str, Any]:
    text = request.lower()
    rules = [
        (["x-", "-x", "负x", "向左", "左移", "left"], "x-", [-1.0, 0.0, 0.0]),
        (["x+", "+x", "正x", "向右", "右移", "right"], "x+", [1.0, 0.0, 0.0]),
        (["y-", "-y", "负y", "向后", "后移", "back"], "y-", [0.0, -1.0, 0.0]),
        (["y+", "+y", "正y", "向前", "前移", "front", "forward"], "y+", [0.0, 1.0, 0.0]),
        (["z-", "-z", "负z", "向下", "下移", "down"], "z-", [0.0, 0.0, -1.0]),
        (["z+", "+z", "正z", "向上", "上移", "up"], "z+", [0.0, 0.0, 1.0]),
    ]
    for tokens, label, unit in rules:
        if any(token in text for token in tokens):
            return {"label": label, "unit": unit}
    return {"label": "auto", "unit": [1.0, 0.0, 0.0]}


def plan_explicit_component_move(
    *,
    registry: Mapping[str, Any],
    component_id: str,
    delta: list[float],
    request: str,
) -> dict[str, Any]:
    entity = entity_by_component_id(registry, component_id)
    if entity is None:
        raise RuntimeError(f"edit request references missing component_id: {component_id}")
    return {
        "type": "move_component",
        "component_id": component_id,
        "semantic_name": entity.get("semantic_name"),
        "delta_mm": delta,
        "selection_policy": {
            "planner": "structured_geometry_edit_planner",
            "operation": "move_component",
            "candidate_filter": "component_id explicitly mentioned in request",
            "source_request": request,
        },
        "reason": f"request explicitly selected {component_id}",
    }


def entity_by_component_id(registry: Mapping[str, Any], component_id: str) -> Mapping[str, Any] | None:
    for entity in registry.get("entities", []):
        if isinstance(entity, Mapping) and entity.get("component_id") == component_id:
            return entity
    return None


def target_sort_key(target: Mapping[str, Any]) -> tuple[int, float, str]:
    kind = str(target.get("kind") or "")
    size = target.get("size_mm") or target.get("dims_mm") or [0.0, 0.0, 0.0]
    volume = 1.0
    if isinstance(size, list) and len(size) == 3:
        for value in size:
            volume *= float(value)
    priority = 0 if kind in {"external", "radiator"} else 1
    return (priority, -volume, str(target.get("component_id") or ""))


def vector3(value: Any) -> list[float]:
    if not isinstance(value, list) or len(value) != 3:
        return [0.0, 0.0, 0.0]
    return [float(item) for item in value]


def component_mount_face_id(component: Mapping[str, Any], component_id: str) -> str:
    mounting = component.get("mounting") if isinstance(component.get("mounting"), Mapping) else {}
    mount_faces = mounting.get("mount_faces") if isinstance(mounting.get("mount_faces"), list) else []
    for mount_face in mount_faces:
        if isinstance(mount_face, Mapping) and mount_face.get("component_mount_face_id"):
            return str(mount_face["component_mount_face_id"])
    default_face = mounting.get("default_component_mount_face_id")
    if default_face:
        return str(default_face)
    return f"{component_id}.local_zmin"


def next_geometry_id_from_topology(topology: Mapping[str, Any]) -> str:
    max_index = 0
    for placement in topology.get("placements", []):
        if not isinstance(placement, Mapping):
            continue
        geometry_id = str(placement.get("geometry_id") or "")
        if geometry_id.startswith("G") and geometry_id[1:].isdigit():
            max_index = max(max_index, int(geometry_id[1:]))
    return f"G{max_index + 1:03d}"
