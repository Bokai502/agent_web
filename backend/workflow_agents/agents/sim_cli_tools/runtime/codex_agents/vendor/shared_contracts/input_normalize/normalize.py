from __future__ import annotations

import random
import re
from copy import deepcopy
from pathlib import Path
from typing import Any, Mapping

from core.io import read_json, write_json
from core.stages import StageResult
from formats.validators import (
    validate_components,
    validate_design_input,
    validate_real_bom,
    validate_virtual_bom,
    validate_virtual_bom_requirements,
)


def run_stage(
    input_dir: Path,
    output_dir: Path,
    config: Mapping[str, Any] | None = None,
) -> StageResult:
    """Normalize canonical entry files into ``components.json``.

    Inputs:
    - ``design_input.json``
    - ``real_bom.json`` for ``entry_mode=real_bom``
    - ``virtual_bom_requirements.json`` for ``entry_mode=virtual_bom_generation``

    Outputs:
    - ``components.json``
    - ``virtual_bom.json`` when virtual BOM generation is selected
    - ``input_validation.json``
    """
    config = config or {}
    input_dir = Path(input_dir)
    output_dir = Path(output_dir)
    result = StageResult(
        stage_name="input_normalize",
        status="running",
        inputs={"input_dir": input_dir, "config": dict(config)},
        outputs={"output_dir": output_dir},
    )

    validation_reports: dict[str, Any] = {}
    try:
        design_input_path = input_dir / "design_input.json"
        design_input = read_json(design_input_path)
        design_validation = validate_design_input(design_input)
        validation_reports["design_input"] = design_validation.to_dict()
        if not design_validation.ok:
            return _finish_failed(result, validation_reports)

        entry_mode = str(config.get("entry_mode") or design_input["entry_mode"])
        if entry_mode != design_input["entry_mode"]:
            validation_reports["entry_mode_override"] = {
                "ok": False,
                "stage": "input_normalize",
                "failed_checks": [
                    {
                        "check": "entry_mode_override_matches_design_input",
                        "object_id": "design_input",
                        "message": "config entry_mode must match design_input.entry_mode",
                    }
                ],
                "warnings": [],
            }
            return _finish_failed(result, validation_reports)

        if entry_mode == "real_bom":
            bom_path = input_dir / "real_bom.json"
            bom = read_json(bom_path)
            bom_validation = validate_real_bom(bom)
            validation_reports["real_bom"] = bom_validation.to_dict()
            if not bom_validation.ok:
                return _finish_failed(result, validation_reports)
            components = normalize_bom_to_components(bom, source_file="real_bom.json")
        elif entry_mode == "virtual_bom_generation":
            requirements_path = input_dir / "virtual_bom_requirements.json"
            requirements = read_json(requirements_path)
            req_validation = validate_virtual_bom_requirements(requirements)
            validation_reports["virtual_bom_requirements"] = req_validation.to_dict()
            if not req_validation.ok:
                return _finish_failed(result, validation_reports)
            virtual_bom = generate_virtual_bom(requirements)
            virtual_validation = validate_virtual_bom(virtual_bom, requirements=requirements)
            validation_reports["virtual_bom"] = virtual_validation.to_dict()
            if not virtual_validation.ok:
                return _finish_failed(result, validation_reports)
            write_json(output_dir / "virtual_bom.json", virtual_bom)
            components = normalize_bom_to_components(virtual_bom, source_file="virtual_bom.json")
        else:
            validation_reports["entry_mode"] = {
                "ok": False,
                "stage": "input_normalize",
                "failed_checks": [
                    {
                        "check": "entry_mode_allowed",
                        "message": "entry_mode must be real_bom or virtual_bom_generation",
                    }
                ],
                "warnings": [],
            }
            return _finish_failed(result, validation_reports)

        components_validation = validate_components(components)
        validation_reports["components"] = components_validation.to_dict()
        if not components_validation.ok:
            return _finish_failed(result, validation_reports)

        components_path = write_json(output_dir / "components.json", components)
        validation_path = write_json(
            output_dir / "input_validation.json",
            {
                "ok": True,
                "stage": "input_normalize",
                "entry_mode": entry_mode,
                "reports": validation_reports,
            },
        )
        result.outputs.update(
            {
                "components": components_path,
                "input_validation": validation_path,
            }
        )
        if entry_mode == "virtual_bom_generation":
            result.outputs["virtual_bom"] = output_dir / "virtual_bom.json"
        result.checks = validation_reports
        return result.finish("completed")
    except Exception as exc:
        result.errors.append({"type": exc.__class__.__name__, "message": str(exc)})
        return result.finish("failed")


def normalize_bom_to_components(
    bom: Mapping[str, Any],
    *,
    source_file: str,
    preserve_component_id_for_instances: bool = False,
) -> dict[str, Any]:
    """Convert a real or virtual BOM into physical components."""
    components: list[dict[str, Any]] = []
    used_ids = {
        str(item.get("component_id"))
        for item in bom.get("items", [])
        if isinstance(item, Mapping) and isinstance(item.get("component_id"), str)
    }
    allocated_ids: set[str] = set()

    for item in bom.get("items", []):
        quantity = int(item.get("quantity", 1))
        for copy_index in range(quantity):
            component = deepcopy(dict(item))
            source_component_id = str(item["component_id"])
            if preserve_component_id_for_instances:
                component_id = source_component_id
                instance_id = source_component_id if quantity == 1 else f"{source_component_id}__inst{copy_index + 1:03d}"
            elif copy_index == 0:
                component_id = source_component_id
                instance_id = component_id
            else:
                component_id = _next_component_id(source_component_id, used_ids | allocated_ids)
                instance_id = component_id
            allocated_ids.add(component_id)

            if component_id != source_component_id:
                _rewrite_component_id(component, source_component_id, component_id)
            component["instance_id"] = instance_id
            component.pop("quantity", None)
            component["material_id"] = component.pop(
                "material_id",
                component.pop("material_hint", "aluminum_6061"),
            )
            source_ref = dict(component.get("source_ref") or {})
            source_ref.update(
                {
                    "bom_file": source_file,
                    "source_component_id": source_component_id,
                    "instance_id": instance_id,
                    "copy_index": copy_index,
                }
            )
            component["source_ref"] = source_ref
            components.append(component)

    return {
        "schema_version": "1.0",
        "components": components,
    }


def generate_virtual_bom(requirements: Mapping[str, Any]) -> dict[str, Any]:
    """Generate a deterministic virtual BOM from validated requirements."""
    rng = random.Random(int(requirements["seed"]))
    component_count = requirements["component_count"]
    min_count = int(component_count["min"])
    max_count = int(component_count["max"])
    category_requirements = list(requirements["category_requirements"])

    counts: list[int] = [
        rng.randint(int(rule["count_range"][0]), int(rule["count_range"][1]))
        for rule in category_requirements
    ]
    cursor = 0
    while sum(counts) < min_count:
        index = cursor % len(category_requirements)
        max_for_category = int(category_requirements[index]["count_range"][1])
        if counts[index] < max_for_category:
            counts[index] += 1
        cursor += 1
        if cursor > len(category_requirements) * max_count:
            break
    cursor = 0
    while sum(counts) > max_count:
        reduced = False
        for largest_index in sorted(range(len(counts)), key=lambda index: counts[index], reverse=True):
            min_for_category = int(category_requirements[largest_index]["count_range"][0])
            if counts[largest_index] > min_for_category:
                counts[largest_index] -= 1
                reduced = True
                break
        if not reduced:
            cursor += 1
            if cursor > len(category_requirements):
                break

    prefix = str(requirements.get("naming_policy", {}).get("component_id_prefix", "C")).upper()
    allowed_kinds = list(requirements["allowed_kinds"])
    items: list[dict[str, Any]] = []
    component_index = 1
    for category_index, (rule, count) in enumerate(zip(category_requirements, counts)):
        for local_index in range(count):
            component_id = f"{prefix}{component_index:03d}"
            size_mm = [
                _rounded(rng.uniform(float(rule["size_mm_range"][0][axis]), float(rule["size_mm_range"][1][axis])))
                for axis in range(3)
            ]
            mass_kg = _rounded(rng.uniform(float(rule["mass_kg_range"][0]), float(rule["mass_kg_range"][1])))
            power_w = _rounded(rng.uniform(float(rule["power_W_range"][0]), float(rule["power_W_range"][1])))
            local_face, normal_axis, normal_sign = _select_mount_face(size_mm, rng, requirements)
            items.append(
                {
                    "component_id": component_id,
                    "semantic_name": f"{rule['category']}_{component_index:03d}",
                    "display_name": f"Virtual {str(rule['category']).replace('_', ' ').title()} {local_index + 1}",
                    "kind": _select_kind(allowed_kinds, category_index, component_index),
                    "category": rule["category"],
                    "quantity": 1,
                    "size_mm": size_mm,
                    "mass_kg": mass_kg,
                    "power_W": power_w,
                    "mounting": _build_mounting(component_id, local_face, normal_axis, normal_sign),
                    "material_hint": "aluminum_6061",
                    "generation_trace": {
                        "category_rule": rule["category"],
                        "sample_index": local_index,
                    },
                }
            )
            component_index += 1

    return {
        "schema_version": "1.0",
        "bom_id": f"virtual_bom_{requirements['requirements_id']}",
        "generated_from": {
            "requirements_file": "virtual_bom_requirements.json",
            "seed": requirements["seed"],
            "generator": "virtual_bom_generator_v1",
        },
        "summary": {
            "component_count": len(items),
            "total_mass_kg": _rounded(sum(float(item["mass_kg"]) for item in items)),
            "total_power_W": _rounded(sum(float(item["power_W"]) for item in items)),
        },
        "items": items,
    }


def _finish_failed(result: StageResult, validation_reports: dict[str, Any]) -> StageResult:
    result.checks = validation_reports
    result.errors = [
        check
        for report in validation_reports.values()
        if isinstance(report, Mapping) and not report.get("ok", True)
        for check in report.get("failed_checks", [])
    ]
    return result.finish("failed")


def _build_mounting(
    component_id: str,
    local_face: str,
    normal_axis: int,
    normal_sign: int,
) -> dict[str, Any]:
    component_mount_face_id = f"{component_id}.local_{local_face}"
    axes = [0, 1, 2]
    axes.remove(normal_axis)
    return {
        "default_component_mount_face_id": component_mount_face_id,
        "mount_faces": [
            {
                "component_mount_face_id": component_mount_face_id,
                "local_face": local_face,
                "normal_axis": normal_axis,
                "normal_sign": normal_sign,
                "u_axis": axes[0],
                "v_axis": axes[1],
                "role": "primary_mount",
                "contact_area_hint_mm2": _rounded(_face_area_hint(normal_axis), precision=3),
            }
        ],
    }


def _face_area_hint(normal_axis: int) -> float:
    # The generated face stores only orientation; layout will compute exact area later.
    return 1.0 + normal_axis


def _select_mount_face(
    size_mm: list[float],
    rng: random.Random,
    requirements: Mapping[str, Any],
) -> tuple[str, int, int]:
    policy = requirements.get("mounting_policy", {}).get("default_mount_face_policy", "largest_area_face")
    if policy == "random_seeded":
        normal_axis = rng.choice([0, 1, 2])
    else:
        areas = {
            0: size_mm[1] * size_mm[2],
            1: size_mm[0] * size_mm[2],
            2: size_mm[0] * size_mm[1],
        }
        normal_axis = max(areas, key=areas.get)
    axis_name = "xyz"[normal_axis]
    return f"{axis_name}min", normal_axis, -1


def _select_kind(allowed_kinds: list[str], category_index: int, component_index: int) -> str:
    if "internal" in allowed_kinds:
        return "internal"
    return allowed_kinds[(category_index + component_index) % len(allowed_kinds)]


def _rounded(value: float, *, precision: int = 6) -> float:
    return round(float(value), precision)


def _rewrite_component_id(component: dict[str, Any], old_id: str, new_id: str) -> None:
    component["component_id"] = new_id
    mounting = component.get("mounting")
    if not isinstance(mounting, dict):
        return
    old_prefix = f"{old_id}.local_"
    new_prefix = f"{new_id}.local_"
    default_face = mounting.get("default_component_mount_face_id")
    if isinstance(default_face, str) and default_face.startswith(old_prefix):
        mounting["default_component_mount_face_id"] = default_face.replace(old_prefix, new_prefix, 1)
    for face in mounting.get("mount_faces", []):
        if not isinstance(face, dict):
            continue
        face_id = face.get("component_mount_face_id")
        if isinstance(face_id, str) and face_id.startswith(old_prefix):
            face["component_mount_face_id"] = face_id.replace(old_prefix, new_prefix, 1)


def _next_component_id(source_component_id: str, used_ids: set[str]) -> str:
    match = re.match(r"^([A-Z]+)([0-9]+)$", source_component_id)
    if not match:
        copy_index = 2
        while True:
            candidate = f"{source_component_id}-{copy_index:03d}"
            if candidate not in used_ids:
                return candidate
            copy_index += 1

    prefix = match.group(1)
    width = len(match.group(2))
    current_numbers = [
        int(candidate_match.group(1))
        for component_id in used_ids
        if (candidate_match := re.match(rf"^{re.escape(prefix)}([0-9]+)$", component_id))
    ]
    next_number = max(current_numbers or [0]) + 1
    while True:
        candidate = f"{prefix}{next_number:0{width}d}"
        if candidate not in used_ids:
            return candidate
        next_number += 1
