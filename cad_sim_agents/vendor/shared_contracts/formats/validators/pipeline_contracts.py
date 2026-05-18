from __future__ import annotations

import math
from pathlib import Path
from typing import Any, Mapping

from .canonical_inputs import ALLOWED_KINDS
from .common import ValidationResult


def validate_layout_topology(
    topology: Mapping[str, Any],
    components: Mapping[str, Any],
    geometry_registry: Mapping[str, Any] | None = None,
    thermal_model: Mapping[str, Any] | None = None,
) -> ValidationResult:
    result = ValidationResult(stage="layout_topology")
    _require_str(result, topology, "schema_version", "layout_topology")
    _require_str(result, topology, "layout_id", "layout_topology")

    component_map = _component_map(components)
    cabin_ids = {item.get("id") for item in topology.get("cabins", []) if isinstance(item, Mapping)}
    install_face_ids = {item.get("id") for item in topology.get("install_faces", []) if isinstance(item, Mapping)}
    geometry_ids = _ids_from_list(geometry_registry, "entities", "geometry_id") if geometry_registry else None
    thermal_ids = _ids_from_list(thermal_model, "components", "thermal_id") if thermal_model else None

    if not isinstance(topology.get("outer_shell"), Mapping) or not topology["outer_shell"].get("id"):
        result.fail("outer_shell_present", "outer_shell.id is required", "layout_topology")
    if not cabin_ids:
        result.fail("cabins_present", "cabins must contain at least one cabin", "layout_topology")
    if not install_face_ids:
        result.fail("install_faces_present", "install_faces must contain at least one mount face", "layout_topology")

    placements = topology.get("placements")
    if not isinstance(placements, list) or not placements:
        result.fail("placements_present", "placements must be a non-empty list", "layout_topology")
        return result

    seen_components: set[str] = set()
    for index, placement in enumerate(placements):
        object_id = f"placements[{index}]"
        if not isinstance(placement, Mapping):
            result.fail("placement_object", "placement must be an object", object_id)
            continue
        component_id = placement.get("component_id")
        seen_components.add(str(component_id))
        component = component_map.get(component_id)
        if component is None:
            result.fail("component_exists", "placement.component_id must exist in components.json", object_id)
        if placement.get("kind") not in ALLOWED_KINDS:
            result.fail("kind_allowed", "placement.kind must be internal, external, or radiator", object_id)
        if placement.get("kind") == "internal" and placement.get("cabin_id") not in cabin_ids:
            result.fail("cabin_exists", "internal placement.cabin_id must exist", object_id)
        if placement.get("mount_face_id") not in install_face_ids:
            result.fail("mount_face_exists", "mount_face_id must exist in layout_topology.install_faces", object_id)

        mount_face_id = placement.get("component_mount_face_id")
        if component and mount_face_id not in _component_mount_face_ids(component):
            result.fail(
                "component_mount_face_exists",
                "component_mount_face_id must exist in components mounting.mount_faces",
                object_id,
            )
        alignment = placement.get("alignment")
        if not isinstance(alignment, Mapping) or alignment.get("normal_alignment", "opposite") not in {"opposite", "same"}:
            result.fail("alignment_valid", "alignment.normal_alignment must be opposite or same", object_id)
        if geometry_ids is not None and placement.get("geometry_id") not in geometry_ids:
            result.fail("geometry_id_exists", "geometry_id must exist in geometry_registry.entities", object_id)
        if thermal_ids is not None and placement.get("thermal_id") not in thermal_ids:
            result.fail("thermal_id_exists", "thermal_id must exist in thermal_model.components", object_id)

    missing_components = sorted(set(component_map) - seen_components)
    if missing_components:
        result.fail(
            "all_components_placed",
            f"components missing from layout placements: {missing_components}",
            "layout_topology",
        )
    return result


def validate_geometry_registry(
    registry: Mapping[str, Any],
    topology: Mapping[str, Any] | None = None,
) -> ValidationResult:
    result = ValidationResult(stage="geometry_registry")
    _require_str(result, registry, "schema_version", "geometry_registry")
    units = registry.get("units")
    if not isinstance(units, Mapping) or not units.get("length"):
        result.fail("length_unit_present", "units.length is required", "geometry_registry")

    entities = registry.get("entities")
    if not isinstance(entities, list) or not entities:
        result.fail("entities_present", "entities must be a non-empty list", "geometry_registry")
        entities = []
    geometry_ids: set[str] = set()
    for index, entity in enumerate(entities):
        object_id = f"entities[{index}]"
        if not isinstance(entity, Mapping):
            result.fail("entity_object", "entity must be an object", object_id)
            continue
        geometry_id = entity.get("geometry_id")
        if not isinstance(geometry_id, str) or not geometry_id:
            result.fail("geometry_id_present", "geometry_id is required", object_id)
        elif geometry_id in geometry_ids:
            result.fail("geometry_id_unique", f"duplicate geometry_id {geometry_id}", geometry_id)
        else:
            geometry_ids.add(geometry_id)
            object_id = geometry_id
        _validate_bbox(result, entity.get("bbox"), object_id)
        center = entity.get("center")
        bbox = entity.get("bbox")
        if _is_vector3(center) and isinstance(bbox, Mapping) and _is_vector3(bbox.get("min")) and _is_vector3(bbox.get("max")):
            for axis, value in enumerate(center):
                if value < bbox["min"][axis] or value > bbox["max"][axis]:
                    result.fail("center_inside_bbox", "center must lie inside bbox", object_id)
        if entity.get("entity_type") == "component_solid" and not entity.get("step_name"):
            result.fail("step_name_present", "component_solid entity requires step_name", object_id)

    face_ids: set[str] = set()
    for index, face in enumerate(registry.get("faces", []) or []):
        object_id = f"faces[{index}]"
        if not isinstance(face, Mapping):
            result.fail("face_object", "face must be an object", object_id)
            continue
        face_id = face.get("face_id")
        if not isinstance(face_id, str) or not face_id:
            result.fail("face_id_present", "face_id is required", object_id)
        elif face_id in face_ids:
            result.fail("face_id_unique", f"duplicate face_id {face_id}", face_id)
        else:
            face_ids.add(face_id)
            object_id = face_id
        if face.get("plane_axis") not in (0, 1, 2):
            result.fail("plane_axis_valid", "plane_axis must be 0, 1, or 2", object_id)
        if face.get("normal_sign") not in (-1, 1):
            result.fail("normal_sign_valid", "normal_sign must be -1 or 1", object_id)

    if topology:
        placement_geometry_ids = {
            placement.get("geometry_id")
            for placement in topology.get("placements", [])
            if isinstance(placement, Mapping)
        }
        missing_geometry = sorted(str(item) for item in placement_geometry_ids - geometry_ids)
        if missing_geometry:
            result.fail(
                "topology_geometry_ids_exist",
                f"topology references missing geometry ids: {missing_geometry}",
                "geometry_registry",
            )
    return result


def validate_thermal_model(
    thermal_model: Mapping[str, Any],
    components: Mapping[str, Any] | None = None,
    topology: Mapping[str, Any] | None = None,
) -> ValidationResult:
    result = ValidationResult(stage="thermal_model")
    _require_str(result, thermal_model, "schema_version", "thermal_model")
    units = thermal_model.get("units")
    if not isinstance(units, Mapping) or not units.get("power") or not units.get("contact_resistance"):
        result.fail("thermal_units_present", "units.power and units.contact_resistance are required", "thermal_model")

    material_ids = {
        material.get("material_id")
        for material in thermal_model.get("materials", [])
        if isinstance(material, Mapping)
    }
    component_ids = set(_component_map(components).keys()) if components else None
    placement_pairs = _placement_pairs(topology) if topology else None
    thermal_ids: set[str] = set()

    thermal_components = thermal_model.get("components")
    if not isinstance(thermal_components, list) or not thermal_components:
        result.fail("thermal_components_present", "components must be a non-empty list", "thermal_model")
        return result

    for index, item in enumerate(thermal_components):
        object_id = f"components[{index}]"
        if not isinstance(item, Mapping):
            result.fail("thermal_component_object", "thermal component must be an object", object_id)
            continue
        thermal_id = item.get("thermal_id")
        if not isinstance(thermal_id, str) or not thermal_id:
            result.fail("thermal_id_present", "thermal_id is required", object_id)
        elif thermal_id in thermal_ids:
            result.fail("thermal_id_unique", f"duplicate thermal_id {thermal_id}", thermal_id)
        else:
            thermal_ids.add(thermal_id)
            object_id = thermal_id
        component_id = item.get("component_id")
        if component_ids is not None and component_id not in component_ids:
            result.fail("component_id_exists", "thermal component_id must exist in components.json", object_id)
        if not isinstance(item.get("power_W"), (int, float)) or item["power_W"] < 0:
            result.fail("power_non_negative", "power_W must be non-negative", object_id)
        if item.get("material_id") not in material_ids:
            result.fail("material_exists", "material_id must exist in materials", object_id)
        interface = item.get("interface")
        if isinstance(interface, Mapping):
            if not isinstance(interface.get("contact_resistance"), (int, float)) or interface["contact_resistance"] < 0:
                result.fail("contact_resistance_non_negative", "contact_resistance must be non-negative", object_id)
            if placement_pairs is not None:
                pair = (component_id, interface.get("component_mount_face_id"), interface.get("mount_face_id"))
                if pair not in placement_pairs:
                    result.fail(
                        "interface_matches_layout_placement",
                        "thermal interface mount pair must match layout placement",
                        object_id,
                    )
    return result


def validate_simulation_input(
    simulation_input: Mapping[str, Any],
    geometry_step: Path | None = None,
) -> ValidationResult:
    result = ValidationResult(stage="simulation_input")
    _require_str(result, simulation_input, "schema_version", "simulation_input")
    _require_str(result, simulation_input, "simulation_input_id", "simulation_input")
    step_file = simulation_input.get("step_file")
    if not isinstance(step_file, str) or not step_file:
        result.fail("step_file_present", "step_file is required", "simulation_input")
    if geometry_step is not None and (not geometry_step.exists() or geometry_step.stat().st_size <= 0):
        result.fail("step_file_exists", "geometry.step must exist and be non-empty", str(geometry_step))

    source_files = simulation_input.get("source_files", {})
    if isinstance(source_files, Mapping):
        forbidden = [value for value in source_files.values() if "sample.yaml" in str(value)]
        if forbidden:
            result.fail("no_sample_yaml_dependency", "simulation_input must not depend on sample.yaml", "simulation_input")

    components = simulation_input.get("components")
    if not isinstance(components, list) or not components:
        result.fail("components_present", "simulation_input.components must be a non-empty list", "simulation_input")
        components = []
    component_ids: set[str] = set()
    heat_source_ids: set[str] = set()
    for index, component in enumerate(components):
        object_id = f"components[{index}]"
        if not isinstance(component, Mapping):
            result.fail("component_object", "simulation component must be an object", object_id)
            continue
        component_id = component.get("component_id")
        if isinstance(component_id, str):
            component_ids.add(component_id)
            object_id = component_id
        for key in ("geometry_id", "thermal_id", "component_mount_face_id", "mount_face_id"):
            if not component.get(key):
                result.fail(f"{key}_present", f"{key} is required", object_id)
        if not isinstance(component.get("component_mount_face"), Mapping):
            result.fail("component_mount_face_copied", "component_mount_face details must be copied into simulation_input", object_id)
        if component.get("is_heat_source"):
            heat_source_ids.add(str(component_id))
            if not isinstance(component.get("power_W"), (int, float)) or component["power_W"] < 0:
                result.fail("heat_source_power_present", "heat source component requires non-negative power_W", object_id)
        _validate_bbox(result, component.get("bbox"), object_id)

    selection_plan = simulation_input.get("selection_plan")
    if not isinstance(selection_plan, Mapping):
        result.fail("selection_plan_present", "selection_plan must be an object", "simulation_input")
        return result
    selected_components = {
        selection.get("component_id")
        for selection in selection_plan.get("component_selections", [])
        if isinstance(selection, Mapping)
    }
    component_semantic_names = {
        component.get("component_id"): component.get("semantic_name")
        for component in components
        if isinstance(component, Mapping) and isinstance(component.get("component_id"), str)
    }
    for index, selection in enumerate(selection_plan.get("component_selections", [])):
        object_id = f"selection_plan.component_selections[{index}]"
        if not isinstance(selection, Mapping):
            result.fail("component_selection_object", "component selection must be an object", object_id)
            continue
        component_id = selection.get("component_id")
        semantic_name = selection.get("semantic_name")
        if not isinstance(semantic_name, str) or not semantic_name.strip():
            result.fail("component_selection_semantic_name_present", "component selection semantic_name is required", object_id)
            continue
        expected_semantic_name = component_semantic_names.get(component_id)
        if expected_semantic_name is not None and semantic_name != expected_semantic_name:
            result.fail(
                "component_selection_semantic_name_matches",
                "component selection semantic_name must match simulation component semantic_name",
                object_id,
            )
    missing_selections = sorted(component_ids - selected_components)
    if missing_selections:
        result.fail(
            "component_selection_complete",
            f"component selections missing for: {missing_selections}",
            "selection_plan",
        )
    if heat_source_ids and not heat_source_ids.issubset(selected_components):
        result.fail("heat_source_selection_complete", "all heat sources must have geometry selections", "selection_plan")
    return result


def validate_simulation_payload(payload: Mapping[str, Any]) -> ValidationResult:
    result = ValidationResult(stage="simulation_payload")
    _require_str(result, payload, "schema_version", "simulation_payload")
    inputs = payload.get("inputs")
    if not isinstance(inputs, Mapping):
        result.fail("inputs_present", "payload.inputs must be an object", "simulation_payload")
    else:
        for key in ("simulation_input", "geometry_step"):
            if not inputs.get(key):
                result.fail(f"{key}_present", f"inputs.{key} is required", "simulation_payload")
        forbidden = [value for value in inputs.values() if "sample.yaml" in str(value)]
        if forbidden:
            result.fail("no_sample_yaml_dependency", "simulation payload must not depend on sample.yaml", "simulation_payload")
    selections = payload.get("selection_plan")
    if not isinstance(selections, Mapping) or not isinstance(selections.get("component_selections"), list):
        result.fail("selection_plan_present", "selection_plan.component_selections must be present", "simulation_payload")
    heat_sources = payload.get("heat_sources")
    if not isinstance(heat_sources, list):
        result.fail("heat_sources_present", "heat_sources must be a list", "simulation_payload")
    else:
        for index, heat_source in enumerate(heat_sources):
            object_id = f"heat_sources[{index}]"
            if not isinstance(heat_source, Mapping):
                result.fail("heat_source_object", "heat source must be an object", object_id)
                continue
            if not heat_source.get("component_id"):
                result.fail("heat_source_component_id_present", "heat source component_id is required", object_id)
            if not isinstance(heat_source.get("power_W"), (int, float)) or heat_source["power_W"] < 0:
                result.fail("heat_source_power_valid", "heat source power_W must be non-negative", object_id)
    return result


def validate_simulation_outputs(
    *,
    status: Mapping[str, Any],
    field_samples: Mapping[str, Any],
    native_vtu: Path | None = None,
    tensors: Mapping[str, Any] | None = None,
) -> ValidationResult:
    result = ValidationResult(stage="simulation_outputs")
    if status.get("ok") is not True:
        result.fail("status_ok", "status.ok must be true", "status.json")
    samples = field_samples.get("samples")
    if not isinstance(samples, list) or not samples:
        result.fail("field_samples_present", "field_samples.samples must be a non-empty list", "field_samples.json")
    else:
        valid_temperature_count = 0
        for index, sample in enumerate(samples):
            object_id = f"samples[{index}]"
            if not isinstance(sample, Mapping):
                result.fail("field_sample_object", "field sample must be an object", object_id)
                continue
            temperature = sample.get("temperature_K")
            if isinstance(temperature, (int, float)) and math.isfinite(float(temperature)):
                valid_temperature_count += 1
            elif isinstance(temperature, (int, float)):
                result.fail("temperature_finite", "field sample temperature_K must be finite", object_id)
        if valid_temperature_count <= 0:
            result.fail("valid_temperature_count", "field samples must contain at least one numeric temperature", "field_samples.json")
    if native_vtu is not None:
        if not native_vtu.exists() or native_vtu.stat().st_size <= 0:
            result.fail("native_vtu_exists", "native.vtu must exist and be non-empty", str(native_vtu))
        else:
            prefix = native_vtu.read_text(encoding="utf-8", errors="ignore")[:128]
            if "<VTKFile" not in prefix:
                result.fail("native_vtu_header", "native.vtu must contain a VTKFile XML header", str(native_vtu))
    if tensors is not None and not isinstance(tensors.get("summary"), Mapping):
        result.fail("tensors_summary_present", "tensors.summary must be present", "tensors.json")
    return result


def validate_geometry_validation(
    geometry_validation: Mapping[str, Any],
    *,
    before_step: Path | None = None,
    after_step: Path | None = None,
    components: Mapping[str, Any] | None = None,
    topology: Mapping[str, Any] | None = None,
) -> ValidationResult:
    result = ValidationResult(stage="geometry_validation")
    _require_str(result, geometry_validation, "schema_version", "geometry_validation")
    summary = geometry_validation.get("summary")
    if not isinstance(summary, Mapping):
        result.fail("summary_present", "summary must be an object", "geometry_validation")
    elif summary.get("ok") is not True:
        result.fail("summary_ok", "geometry_validation.summary.ok must be true", "geometry_validation")
    for path, label in ((before_step, "geometry_before.step"), (after_step, "geometry_after.step")):
        if path is not None and (not path.exists() or path.stat().st_size <= 0):
            result.fail("step_file_non_empty", f"{label} must exist and be non-empty", str(path))

    valid_mount_faces = set()
    if components:
        for component in components.get("components", []):
            if isinstance(component, Mapping):
                valid_mount_faces.update(_component_mount_face_ids(component))
    placement_pairs = _placement_pairs(topology) if topology else None

    for section in ("before", "after"):
        payload = geometry_validation.get(section)
        if not isinstance(payload, Mapping):
            result.fail(f"{section}_present", f"{section} validation block is required", "geometry_validation")
            continue
        for check in payload.get("collision_checks", []) or []:
            object_id = section
            if not isinstance(check, Mapping):
                result.fail("collision_check_object", "collision check must be an object", object_id)
                continue
            if not isinstance(check.get("pair"), list) or len(check["pair"]) != 2:
                result.fail("collision_pair_present", "collision check pair must contain two object ids", object_id)
            if "overlap_volume_mm3" not in check and "severity" not in check:
                result.fail("collision_entity_metric_present", "collision check must include overlap volume or equivalent severity", object_id)
            if check.get("broad_phase_only") is True:
                result.fail("bbox_not_final_collision_check", "bbox broad phase cannot be the final collision verdict", object_id)
        for check in payload.get("fit_checks", []) or []:
            object_id = section
            if not isinstance(check, Mapping):
                result.fail("fit_check_object", "fit check must be an object", object_id)
                continue
            component_id = check.get("component_id")
            component_mount_face_id = check.get("component_mount_face_id")
            target_mount_face_id = check.get("target_mount_face_id")
            object_id = str(component_id or section)
            if valid_mount_faces and component_mount_face_id not in valid_mount_faces:
                result.fail("component_mount_face_traceable", "component_mount_face_id must exist in components", object_id)
            if placement_pairs is not None and (component_id, component_mount_face_id, target_mount_face_id) not in placement_pairs:
                result.fail("fit_pair_from_layout", "fit check pair must come from layout placement", object_id)
            for key in ("gap_mm", "penetration_mm", "contact_area_mm2", "normal_angle_deg"):
                if not isinstance(check.get(key), (int, float)):
                    result.fail(f"{key}_present", f"{key} must be numeric", object_id)
    return result


def validate_analysis_outputs(
    observation: Mapping[str, Any],
    diagnosis: Mapping[str, Any],
    suggestion_task: Mapping[str, Any] | None = None,
    *,
    known_target_ids: set[str] | None = None,
) -> ValidationResult:
    result = ValidationResult(stage="analysis_outputs")
    _require_str(result, observation, "schema_version", "observation")
    _require_str(result, observation, "observation_id", "observation")
    anomalies = observation.get("anomalies")
    if not isinstance(anomalies, list):
        result.fail("anomalies_list", "observation.anomalies must be a list", "observation")
        anomalies = []
    for index, anomaly in enumerate(anomalies):
        object_id = f"anomalies[{index}]"
        if not isinstance(anomaly, Mapping):
            result.fail("anomaly_object", "anomaly must be an object", object_id)
            continue
        target_id = anomaly.get("object_id")
        if known_target_ids is not None and target_id not in known_target_ids:
            result.fail("anomaly_target_traceable", "anomaly object_id must be traceable", object_id)

    _require_str(result, diagnosis, "schema_version", "diagnosis")
    root_causes = diagnosis.get("root_causes")
    if not isinstance(root_causes, list):
        result.fail("root_causes_list", "diagnosis.root_causes must be a list", "diagnosis")
        root_causes = []
    allowed_categories = {"external_environment", "internal_component", "connection_to_environment", "no_anomaly"}
    for index, cause in enumerate(root_causes):
        object_id = f"root_causes[{index}]"
        if not isinstance(cause, Mapping):
            result.fail("root_cause_object", "root cause must be an object", object_id)
            continue
        if cause.get("category") not in allowed_categories:
            result.fail("root_cause_category_allowed", "root cause category is not allowed", object_id)
        confidence = cause.get("confidence")
        if not isinstance(confidence, (int, float)) or confidence < 0 or confidence > 1:
            result.fail("confidence_range", "root cause confidence must be between 0 and 1", object_id)
        if not isinstance(cause.get("evidence"), list):
            result.fail("evidence_list", "root cause evidence must be a list", object_id)

    if suggestion_task is not None:
        _require_str(result, suggestion_task, "schema_version", "suggestion_task")
        action_type = suggestion_task.get("action_type")
        if action_type not in {"no_action", "move_component", "change_mount_face", "add_radiator", "reduce_power", "increase_contact_conductance"}:
            result.fail("action_type_allowed", "suggestion action_type is not allowed", "suggestion_task")
        target_ids = suggestion_task.get("target_ids", [])
        if not isinstance(target_ids, list):
            result.fail("target_ids_list", "suggestion_task.target_ids must be a list", "suggestion_task")
        elif known_target_ids is not None:
            for target_id in target_ids:
                if target_id not in known_target_ids:
                    result.fail("suggestion_target_traceable", "suggestion target_id must be traceable", str(target_id))
    return result


def _require_str(result: ValidationResult, data: Mapping[str, Any], key: str, object_id: str) -> None:
    if not isinstance(data.get(key), str) or not data.get(key).strip():
        result.fail(f"{key}_present", f"{key} must be a non-empty string", object_id)


def _component_map(components: Mapping[str, Any] | None) -> dict[str, Mapping[str, Any]]:
    if not isinstance(components, Mapping):
        return {}
    return {
        item["component_id"]: item
        for item in components.get("components", [])
        if isinstance(item, Mapping) and isinstance(item.get("component_id"), str)
    }


def _component_mount_face_ids(component: Mapping[str, Any]) -> set[str]:
    mounting = component.get("mounting")
    if not isinstance(mounting, Mapping):
        return set()
    return {
        face.get("component_mount_face_id")
        for face in mounting.get("mount_faces", [])
        if isinstance(face, Mapping)
    }


def _ids_from_list(data: Mapping[str, Any] | None, list_key: str, id_key: str) -> set[str]:
    if not isinstance(data, Mapping):
        return set()
    return {
        item.get(id_key)
        for item in data.get(list_key, [])
        if isinstance(item, Mapping) and isinstance(item.get(id_key), str)
    }


def _placement_pairs(topology: Mapping[str, Any] | None) -> set[tuple[Any, Any, Any]]:
    if not isinstance(topology, Mapping):
        return set()
    return {
        (
            placement.get("component_id"),
            placement.get("component_mount_face_id"),
            placement.get("mount_face_id"),
        )
        for placement in topology.get("placements", [])
        if isinstance(placement, Mapping)
    }


def _validate_bbox(result: ValidationResult, bbox: Any, object_id: str) -> None:
    if not isinstance(bbox, Mapping) or not _is_vector3(bbox.get("min")) or not _is_vector3(bbox.get("max")):
        result.fail("bbox_present", "bbox.min and bbox.max must be numeric 3D vectors", object_id)
        return
    for axis, (min_value, max_value) in enumerate(zip(bbox["min"], bbox["max"])):
        if min_value >= max_value:
            result.fail("bbox_ordered", f"bbox axis {axis} min must be < max", object_id)


def _is_vector3(value: Any) -> bool:
    return isinstance(value, list) and len(value) == 3 and all(isinstance(item, (int, float)) for item in value)
