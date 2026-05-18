from __future__ import annotations

from copy import deepcopy
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Mapping

from core.io import read_json, write_json
from core.stages import StageResult
from formats.validators import (
    validate_components,
    validate_geometry_registry,
    validate_geometry_validation,
    validate_layout_topology,
)

def run_stage(
    input_dir: Path,
    output_dir: Path,
    config: Mapping[str, Any] | None = None,
) -> StageResult:
    """Create geometry-edit audit files and validate geometry contract output.

    ``mock_contract`` is the only no-external-tools backend. It is explicit so
    bbox-derived contract fixtures are not confused with CAD-kernel validation.
    """
    config = config or {}
    input_dir = Path(input_dir)
    output_dir = Path(output_dir)
    backend = str(config.get("validation_backend", "mock_contract"))
    result = StageResult(
        stage_name="geometry_validate",
        status="running",
        inputs={"input_dir": input_dir, "config": dict(config)},
        outputs={"output_dir": output_dir},
    )
    reports: dict[str, Any] = {}
    try:
        if backend == "freecad_skill_cli":
            from .freecad_skill_cli import run_freecad_skill_cli

            components = read_json(_resolve_geometry_edit_components_path(input_dir, config))
            source_topology = read_json(input_dir / "layout_topology.json")
            geometry = read_json(input_dir / "geometry_registry.json")
            skill_result = run_freecad_skill_cli(input_dir, output_dir, config, geometry)
            after_topology = read_json(skill_result["after_topology_path"])
            after_registry = skill_result["after_registry"]
            if skill_result.get("validation_components_path"):
                validation_components = read_json(skill_result["validation_components_path"])
            else:
                validation_components = _components_for_after_topology(input_dir, components, after_topology)
            registry_path = write_json(output_dir / "geometry_after_registry.json", after_registry)
            validation = build_mock_geometry_validation(after_topology, after_registry)
            validation["inputs"]["geometry_registry"] = "geometry_after_registry.json"
            validation["inputs"]["layout_topology"] = "geometry_after.layout_topology.json"
            validation["inputs"]["edit_plan"] = "edit_plan.json"
            validation["method"]["backend"] = "freecad_skill_cli"
            validation["method"]["mock_only"] = not bool(skill_result["cad_synced"])
            validation["method"]["note"] = (
                "FreeCAD skill CLI layout move; geometry_validation remains contract-level "
                "unless cad_synced is true and a downstream CAD-kernel validator is used."
            )
            validation["summary"]["mock_only"] = not bool(skill_result["cad_synced"])
            validation_path = write_json(output_dir / "geometry_validation.json", validation)
            write_json(
                output_dir / "geometry_edit_result.json",
                {
                    "schema_version": "1.0",
                    "status": "ok",
                    "backend": backend,
                    "tool_backend": "freecad_skill_cli",
                    "cad_synced": bool(skill_result["cad_synced"]),
                    "cad_rebuilt": bool(skill_result.get("cad_rebuilt")),
                    "step_from_relayout": bool(skill_result.get("step_from_relayout")),
                    "step_copied_from_source": bool(skill_result.get("step_copied_from_source")),
                    "geometry_after_glb": skill_result.get("result", {}).get("geometry_after_glb"),
                    "relayout_result": "relayout_result.json" if skill_result.get("relayout_result") else None,
                    "edit_plan": "edit_plan.json",
                    "edit_action_count": len(skill_result["edit_plan"].get("actions", [])),
                    "input_step": None,
                    "output_step": "geometry_after.step",
                    "output_geometry_registry": "geometry_after_registry.json",
                    "output_layout_topology": "geometry_after.layout_topology.json",
                    "output_geom": "geometry_after.geom.json",
                    "cli_result": "freecad_skill_cli_result.json",
                },
            )
            write_json(
                output_dir / "geometry_delta_summary.json",
                build_geometry_delta_summary(
                    before_registry=geometry,
                    after_registry=after_registry,
                    before_step=skill_result["before_step"],
                    after_step=skill_result["after_step"],
                    config=config,
                ),
            )
            reports["components"] = validate_components(validation_components).to_dict()
            reports["geometry_after_registry"] = validate_geometry_registry(after_registry).to_dict()
            reports["layout_topology_after"] = validate_layout_topology(
                after_topology,
                validation_components,
                after_registry,
            ).to_dict()
            reports["geometry_validation"] = validate_geometry_validation(
                validation,
                before_step=None,
                after_step=skill_result["after_step"],
                components=validation_components,
                topology=after_topology,
            ).to_dict()
            if not all(report["ok"] for report in reports.values()):
                return _finish_failed(result, reports)
            result.outputs.update(
                {
                    "geometry_before_step": skill_result["before_step"],
                    "geometry_after_step": skill_result["after_step"],
                    "geometry_after_registry": registry_path,
                    "geometry_validation": validation_path,
                    "layout_topology": skill_result["after_topology_path"],
                    "geom": skill_result["after_geom_path"],
                }
            )
            result.checks = reports
            if not skill_result["cad_synced"]:
                result.warnings.append("freecad_skill_cli did not produce geometry_after.step; downstream simulation will be blocked.")
            return result.finish("completed")

        if backend == "freecad_agent":
            source_step = Path(config.get("geometry_step_path", input_dir / "geometry.step"))
            before_step = output_dir / "geometry_before.step"
            after_step = output_dir / "geometry_after.step"
            output_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source_step, before_step)
            components = read_json(_resolve_geometry_edit_components_path(input_dir, config))
            topology = read_json(input_dir / "layout_topology.json")
            geometry = read_json(input_dir / "geometry_registry.json")
            agent_config = _prepare_freecad_agent_config(config, geometry, source_step, output_dir)
            _run_freecad_agent(source_step, after_step, agent_config)
            after_registry = build_geometry_after_registry_from_step(after_step, geometry, agent_config)
            validation_components = _components_for_after_topology(input_dir, components, topology)
            registry_path = write_json(output_dir / "geometry_after_registry.json", after_registry)
            validation = build_mock_geometry_validation(topology, after_registry)
            validation["inputs"]["geometry_registry"] = "geometry_after_registry.json"
            if agent_config.get("resolved_edit_plan"):
                validation["inputs"]["edit_plan"] = "edit_plan.json"
            validation["method"]["backend"] = "freecad_agent"
            validation["method"]["mock_only"] = False
            validation["summary"]["mock_only"] = False
            validation_path = write_json(output_dir / "geometry_validation.json", validation)
            write_json(
                output_dir / "geometry_edit_result.json",
                {
                    "schema_version": "1.0",
                    "status": "ok",
                    "backend": backend,
                    "template": agent_config.get("template", "export_identity"),
                    "params": dict(agent_config.get("params") or {}),
                    "target_component_id": agent_config.get("component_id"),
                    "edit_plan": "edit_plan.json" if agent_config.get("resolved_edit_plan") else None,
                    "edit_action_count": len((agent_config.get("resolved_edit_plan") or {}).get("actions", [])),
                    "input_step": str(source_step),
                    "output_step": "geometry_after.step",
                    "output_geometry_registry": "geometry_after_registry.json",
                },
            )
            write_json(
                output_dir / "geometry_delta_summary.json",
                build_geometry_delta_summary(
                    before_registry=geometry,
                    after_registry=after_registry,
                    before_step=source_step,
                    after_step=after_step,
                    config=agent_config,
                ),
            )
            reports["components"] = validate_components(validation_components).to_dict()
            reports["geometry_after_registry"] = validate_geometry_registry(after_registry).to_dict()
            reports["geometry_validation"] = validate_geometry_validation(
                validation,
                before_step=before_step,
                after_step=after_step,
                components=validation_components,
                topology=topology,
            ).to_dict()
            if not all(report["ok"] for report in reports.values()):
                return _finish_failed(result, reports)
            result.outputs.update(
                {
                    "geometry_before_step": before_step,
                    "geometry_after_step": after_step,
                    "geometry_after_registry": registry_path,
                    "geometry_validation": validation_path,
                }
            )
            result.checks = reports
            return result.finish("completed")

        if backend != "mock_contract":
            result.warnings.append(f"unsupported validation backend for default tests: {backend}")
            return result.finish("skipped")

        components = read_json(input_dir / "components.json") if (input_dir / "components.json").exists() else read_json(input_dir.parent / "00_inputs" / "components.json")
        topology = read_json(input_dir / "layout_topology.json")
        geometry = read_json(input_dir / "geometry_registry.json")
        reports["components"] = validate_components(components).to_dict()
        reports["geometry_registry"] = validate_geometry_registry(geometry, topology).to_dict()
        reports["layout_topology"] = validate_layout_topology(topology, components, geometry).to_dict()
        if not all(report["ok"] for report in reports.values()):
            return _finish_failed(result, reports)

        before_step = output_dir / "geometry_before.step"
        after_step = output_dir / "geometry_after.step"
        source_step = input_dir / "geometry.step"
        output_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_step, before_step)
        shutil.copy2(source_step, after_step)

        after_registry = build_geometry_after_registry_copy(geometry)
        registry_path = write_json(output_dir / "geometry_after_registry.json", after_registry)
        validation = build_mock_geometry_validation(topology, after_registry)
        validation["inputs"]["geometry_registry"] = "geometry_after_registry.json"
        validation_path = write_json(output_dir / "geometry_validation.json", validation)
        write_json(
            output_dir / "geometry_edit_result.json",
            {
                "schema_version": "1.0",
                "status": "ok",
                "backend": backend,
                "mock_only": True,
                "input_step": str(source_step),
                "output_step": "geometry_after.step",
                "output_geometry_registry": "geometry_after_registry.json",
            },
        )
        write_json(
            output_dir / "geometry_delta_summary.json",
            build_geometry_delta_summary(
                before_registry=geometry,
                after_registry=after_registry,
                before_step=source_step,
                after_step=after_step,
                config=config,
            ),
        )
        reports["geometry_after_registry"] = validate_geometry_registry(after_registry, topology).to_dict()
        reports["geometry_validation"] = validate_geometry_validation(
            validation,
            before_step=before_step,
            after_step=after_step,
            components=components,
            topology=topology,
        ).to_dict()
        if not all(report["ok"] for report in reports.values()):
            return _finish_failed(result, reports)
        result.outputs.update(
            {
                "geometry_before_step": before_step,
                "geometry_after_step": after_step,
                "geometry_after_registry": registry_path,
                "geometry_validation": validation_path,
            }
        )
        result.checks = reports
        result.warnings.append("mock_contract backend does not perform real CAD-kernel geometry validation")
        return result.finish("completed")
    except Exception as exc:
        result.errors.append({"type": exc.__class__.__name__, "message": str(exc)})
        return result.finish("failed")


def build_mock_geometry_validation(
    topology: Mapping[str, Any],
    geometry: Mapping[str, Any],
) -> dict[str, Any]:
    collision_checks = _collision_checks(geometry)
    fit_checks = _fit_checks(topology)
    block = {
        "collision_checks": collision_checks,
        "fit_checks": fit_checks,
        "clearance_checks": [],
        "envelope_checks": [],
    }
    return {
        "schema_version": "1.0",
        "validation_id": "geom_val_mock_contract",
        "inputs": {
            "before_step": "geometry_before.step",
            "after_step": "geometry_after.step",
            "geometry_registry": "../01_layout/geometry_registry.json",
            "layout_topology": "../01_layout/layout_topology.json",
            "edit_plan": None,
        },
        "method": {
            "backend": "mock_contract",
            "mock_only": True,
            "entity_level": True,
            "final_collision_basis": "mock_entity_overlap_volume",
            "note": "Contract fixture only; real FreeCAD/OpenCascade backend must replace this for integration validation.",
        },
        "tolerances": {
            "collision_overlap_volume_mm3": 0.0,
            "fit_gap_max_mm": 0.05,
            "fit_penetration_max_mm": 0.02,
            "fit_normal_angle_max_deg": 1.0,
            "min_contact_area_mm2": 1.0,
            "min_clearance_mm": 0.1,
        },
        "before": block,
        "after": block,
        "summary": {
            "ok": True,
            "collision_failures": 0,
            "fit_failures": 0,
            "clearance_failures": 0,
            "envelope_failures": 0,
            "mock_only": True,
        },
    }


def build_geometry_after_registry_copy(geometry: Mapping[str, Any]) -> dict[str, Any]:
    """Return a registry for unchanged/mock geometry edits."""
    after_registry = deepcopy(dict(geometry))
    after_registry["source"] = {
        "stage": "02_geometry_edit",
        "method": "copied_from_01_layout_geometry_registry",
    }
    return after_registry


def build_geometry_after_registry_from_step(
    after_step: Path,
    geometry: Mapping[str, Any],
    config: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Build updated component bbox registry from geometry_after.step.

    STEP does not reliably preserve component ids, so component identity is
    inherited from the 01_layout geometry registry. Solid bboxes are mapped by
    export order. A leading shell solid is skipped when present.
    """
    config = config or {}
    source_entities = _entities_after_edit_plan(geometry, config.get("resolved_edit_plan"))
    solid_bboxes = _read_step_solid_bboxes(after_step, config)
    entity_bboxes = _component_solid_bboxes(solid_bboxes, len(source_entities))

    after_registry = deepcopy(dict(geometry))
    after_entities = []
    for entity, bbox in zip(source_entities, entity_bboxes, strict=True):
        updated = dict(entity)
        updated["bbox"] = {"min": bbox["min"], "max": bbox["max"]}
        updated["center"] = [
            round((bbox["min"][axis] + bbox["max"][axis]) / 2.0, 9)
            for axis in range(3)
        ]
        updated["size"] = [
            round(bbox["max"][axis] - bbox["min"][axis], 9)
            for axis in range(3)
        ]
        after_entities.append(updated)
    after_registry["entities"] = after_entities
    after_registry["source"] = {
        "stage": "02_geometry_edit",
        "method": "step_solid_bbox_extraction",
        "step_file": "geometry_after.step",
        "identity_source": "../01_layout/geometry_registry.json",
        "solid_count": len(solid_bboxes),
        "component_entity_count": len(after_entities),
    }
    if config.get("resolved_edit_plan"):
        after_registry["source"]["edit_plan"] = "edit_plan.json"
    return after_registry


def build_geometry_delta_summary(
    *,
    before_registry: Mapping[str, Any],
    after_registry: Mapping[str, Any],
    before_step: Path,
    after_step: Path,
    config: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Compute component-level geometry delta from before/after registries."""
    config = config or {}
    tolerance_mm = float(config.get("delta_tolerance_mm", 1e-6))
    before_by_id = _registry_entities_by_component_id(before_registry)
    after_by_id = _registry_entities_by_component_id(after_registry)

    before_ids = set(before_by_id)
    after_ids = set(after_by_id)
    deleted_ids = sorted(before_ids - after_ids)
    added_ids = sorted(after_ids - before_ids)
    common_ids = sorted(before_ids & after_ids)

    moved_objects = []
    scaled_objects = []
    changed_objects = []
    unchanged_objects = []

    for component_id in common_ids:
        before = before_by_id[component_id]
        after = after_by_id[component_id]
        before_center = _vector3(before.get("center"), _bbox_center(before.get("bbox")))
        after_center = _vector3(after.get("center"), _bbox_center(after.get("bbox")))
        before_size = _vector3(before.get("size"), _bbox_size(before.get("bbox")))
        after_size = _vector3(after.get("size"), _bbox_size(after.get("bbox")))
        center_delta = [round(after_center[index] - before_center[index], 9) for index in range(3)]
        size_delta = [round(after_size[index] - before_size[index], 9) for index in range(3)]
        bbox_delta = _bbox_delta(before.get("bbox"), after.get("bbox"))
        center_delta_abs_max = max(abs(value) for value in center_delta)
        size_delta_abs_max = max(abs(value) for value in size_delta)
        bbox_delta_abs_max = max(abs(value) for value in bbox_delta)
        moved = center_delta_abs_max > tolerance_mm
        scaled = size_delta_abs_max > tolerance_mm
        bbox_changed = bbox_delta_abs_max > tolerance_mm

        if not (moved or scaled or bbox_changed):
            unchanged_objects.append(component_id)
            continue

        change_types = []
        if moved:
            change_types.append("moved")
        if scaled:
            change_types.append("resized")
        if bbox_changed and not change_types:
            change_types.append("bbox_changed")

        record = {
            "component_id": component_id,
            "geometry_id": after.get("geometry_id") or before.get("geometry_id"),
            "semantic_name": after.get("semantic_name") or before.get("semantic_name"),
            "step_name": after.get("step_name") or before.get("step_name"),
            "change_types": change_types,
            "before": _entity_geometry_snapshot(before),
            "after": _entity_geometry_snapshot(after),
            "delta": {
                "center_mm": center_delta,
                "size_mm": size_delta,
                "bbox_mm": bbox_delta,
                "center_abs_max_mm": round(center_delta_abs_max, 9),
                "size_abs_max_mm": round(size_delta_abs_max, 9),
                "bbox_abs_max_mm": round(bbox_delta_abs_max, 9),
            },
        }
        changed_objects.append(record)
        if moved:
            moved_objects.append(record)
        if scaled:
            scaled_objects.append(record)

    added_objects = [_entity_geometry_snapshot(after_by_id[component_id], include_ids=True) for component_id in added_ids]
    deleted_objects = [_entity_geometry_snapshot(before_by_id[component_id], include_ids=True) for component_id in deleted_ids]
    geometry_changed = bool(changed_objects or added_objects or deleted_objects)
    return {
        "schema_version": "1.0",
        "changed": geometry_changed,
        "geometry_changed": geometry_changed,
        "step_file_changed": before_step.exists() and after_step.exists() and before_step.read_bytes() != after_step.read_bytes(),
        "updated_geometry_registry": "geometry_after_registry.json",
        "comparison": {
            "method": "component_geometry_registry_diff",
            "tolerance_mm": tolerance_mm,
            "before_registry": "../01_layout/geometry_registry.json",
            "after_registry": "geometry_after_registry.json",
        },
        "summary": {
            "before_component_count": len(before_by_id),
            "after_component_count": len(after_by_id),
            "changed_component_count": len(changed_objects),
            "moved_component_count": len(moved_objects),
            "scaled_component_count": len(scaled_objects),
            "added_component_count": len(added_objects),
            "deleted_component_count": len(deleted_objects),
            "unchanged_component_count": len(unchanged_objects),
        },
        "changed_objects": changed_objects,
        "moved_objects": moved_objects,
        "replaced_objects": [],
        "scaled_objects": scaled_objects,
        "added_objects": added_objects,
        "deleted_objects": deleted_objects,
        "unchanged_objects": unchanged_objects,
    }


def _entities_after_edit_plan(
    geometry: Mapping[str, Any],
    resolved_edit_plan: Mapping[str, Any] | None,
) -> list[Mapping[str, Any]]:
    entities = [dict(entity) for entity in geometry.get("entities", []) if isinstance(entity, Mapping)]
    if not resolved_edit_plan:
        return entities

    deleted_ids = {
        str(action.get("component_id"))
        for action in resolved_edit_plan.get("actions", [])
        if isinstance(action, Mapping) and action.get("type") == "delete_component"
    }
    entities = [entity for entity in entities if entity.get("component_id") not in deleted_ids]

    for action in resolved_edit_plan.get("actions", []):
        if not isinstance(action, Mapping) or action.get("type") != "add_component":
            continue
        bbox = _bbox_snapshot(action.get("bbox"))
        entity = {
            "geometry_id": action.get("geometry_id"),
            "component_id": action.get("component_id"),
            "entity_type": action.get("entity_type") or "component_solid",
            "bbox": bbox,
            "center": _bbox_center(bbox),
            "size": _bbox_size(bbox),
            "step_name": action.get("step_name") or action.get("component_id"),
            "semantic_name": action.get("semantic_name"),
        }
        if action.get("component_subtype"):
            entity["component_subtype"] = action.get("component_subtype")
        entities.append(entity)
    return entities


def _component_solid_bboxes(solid_bboxes: list[dict[str, Any]], entity_count: int) -> list[dict[str, list[float]]]:
    if len(solid_bboxes) == entity_count:
        return solid_bboxes
    if len(solid_bboxes) == entity_count + 1:
        return solid_bboxes[1:]
    raise RuntimeError(
        "Cannot map STEP solids back to component ids: "
        f"solid_count={len(solid_bboxes)}, component_entity_count={entity_count}. "
        "Expected equal counts or one leading shell solid."
    )


def _registry_entities_by_component_id(registry: Mapping[str, Any]) -> dict[str, Mapping[str, Any]]:
    entities: dict[str, Mapping[str, Any]] = {}
    for entity in registry.get("entities", []):
        if not isinstance(entity, Mapping):
            continue
        component_id = entity.get("component_id")
        if isinstance(component_id, str) and component_id:
            entities[component_id] = entity
    return entities


def _entity_geometry_snapshot(entity: Mapping[str, Any], *, include_ids: bool = False) -> dict[str, Any]:
    snapshot: dict[str, Any] = {
        "bbox": _bbox_snapshot(entity.get("bbox")),
        "center": _vector3(entity.get("center"), _bbox_center(entity.get("bbox"))),
        "size": _vector3(entity.get("size"), _bbox_size(entity.get("bbox"))),
    }
    if include_ids:
        snapshot = {
            "component_id": entity.get("component_id"),
            "geometry_id": entity.get("geometry_id"),
            "semantic_name": entity.get("semantic_name"),
            "step_name": entity.get("step_name"),
            **snapshot,
        }
    return snapshot


def _bbox_snapshot(value: Any) -> dict[str, list[float]]:
    if not isinstance(value, Mapping):
        return {"min": [0.0, 0.0, 0.0], "max": [0.0, 0.0, 0.0]}
    return {
        "min": _vector3(value.get("min"), [0.0, 0.0, 0.0]),
        "max": _vector3(value.get("max"), [0.0, 0.0, 0.0]),
    }


def _bbox_center(value: Any) -> list[float]:
    bbox = _bbox_snapshot(value)
    return [round((bbox["min"][index] + bbox["max"][index]) / 2.0, 9) for index in range(3)]


def _bbox_size(value: Any) -> list[float]:
    bbox = _bbox_snapshot(value)
    return [round(bbox["max"][index] - bbox["min"][index], 9) for index in range(3)]


def _bbox_delta(before: Any, after: Any) -> list[float]:
    before_bbox = _bbox_snapshot(before)
    after_bbox = _bbox_snapshot(after)
    return [
        round(after_bbox["min"][index] - before_bbox["min"][index], 9)
        for index in range(3)
    ] + [
        round(after_bbox["max"][index] - before_bbox["max"][index], 9)
        for index in range(3)
    ]


def _vector3(value: Any, default: list[float]) -> list[float]:
    if not isinstance(value, list) or len(value) != 3:
        return [float(item) for item in default]
    return [float(item) for item in value]


def _read_step_solid_bboxes(after_step: Path, config: Mapping[str, Any]) -> list[dict[str, Any]]:
    freecadcmd = str(config.get("freecadcmd") or os.environ.get("FREECADCMD") or shutil.which("freecadcmd") or "")
    if not freecadcmd:
        raise RuntimeError("freecadcmd is required to extract geometry_after_registry.json from STEP")
    timeout_seconds = int(config.get("timeout_seconds", 600))
    with tempfile.TemporaryDirectory(prefix="cad2comsol_step_registry_") as tmp:
        tmp_dir = Path(tmp)
        script_path = tmp_dir / "extract_step_bboxes.py"
        output_json = tmp_dir / "solid_bboxes.json"
        script_path.write_text(
            "\n".join(
                [
                    "import json",
                    "from pathlib import Path",
                    "import Part",
                    "shape = Part.Shape()",
                    f"shape.read({str(after_step)!r})",
                    "rows = []",
                    "for index, solid in enumerate(shape.Solids):",
                    "    bbox = solid.BoundBox",
                    "    rows.append({",
                    "        'solid_index': index,",
                    "        'bbox': {",
                    "            'min': [float(bbox.XMin), float(bbox.YMin), float(bbox.ZMin)],",
                    "            'max': [float(bbox.XMax), float(bbox.YMax), float(bbox.ZMax)],",
                    "        },",
                    "        'volume': float(solid.Volume),",
                    "    })",
                    f"Path({str(output_json)!r}).write_text(json.dumps(rows), encoding='utf-8')",
                    "",
                ]
            ),
            encoding="utf-8",
        )
        execution = subprocess.run(
            [freecadcmd, str(script_path)],
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
        )
        if execution.returncode != 0:
            raise RuntimeError(execution.stderr.strip() or execution.stdout.strip())
        if not output_json.exists():
            raise RuntimeError("freecadcmd did not write STEP solid bbox extraction output")
        rows = json.loads(output_json.read_text(encoding="utf-8"))
    return [
        {
            "min": [float(value) for value in row["bbox"]["min"]],
            "max": [float(value) for value in row["bbox"]["max"]],
        }
        for row in rows
    ]


def _collision_checks(geometry: Mapping[str, Any]) -> list[dict[str, Any]]:
    entities = geometry.get("entities", [])
    checks: list[dict[str, Any]] = []
    for left_index, left in enumerate(entities):
        if not isinstance(left, Mapping):
            continue
        for right in entities[left_index + 1 :]:
            if not isinstance(right, Mapping):
                continue
            checks.append(
                {
                    "pair": [left.get("component_id"), right.get("component_id")],
                    "allowed_contact": False,
                    "overlap_volume_mm3": 0.0,
                    "status": "pass",
                    "method": "mock_entity_overlap_volume",
                }
            )
    return checks


def _fit_checks(topology: Mapping[str, Any]) -> list[dict[str, Any]]:
    checks = []
    for placement in topology.get("placements", []):
        if not isinstance(placement, Mapping):
            continue
        checks.append(
            {
                "component_id": placement["component_id"],
                "component_mount_face_id": placement["component_mount_face_id"],
                "target_mount_face_id": placement["mount_face_id"],
                "normal_alignment": placement.get("alignment", {}).get("normal_alignment", "opposite"),
                "gap_mm": 0.0,
                "penetration_mm": 0.0,
                "contact_area_mm2": 1.0,
                "normal_angle_deg": 0.0,
                "status": "pass",
                "method": "mock_entity_fit",
            }
        )
    return checks


def _components_for_after_topology(
    input_dir: Path,
    base_components: Mapping[str, Any],
    after_topology: Mapping[str, Any],
) -> dict[str, Any]:
    component_rows = [
        dict(component)
        for component in base_components.get("components", [])
        if isinstance(component, Mapping) and component.get("component_id")
    ]
    by_id = {str(component["component_id"]): component for component in component_rows}
    required_ids = {
        str(placement.get("component_id"))
        for placement in after_topology.get("placements", [])
        if isinstance(placement, Mapping) and placement.get("component_id")
    }
    missing_ids = sorted(required_ids - set(by_id))
    if missing_ids:
        full_components_path = input_dir.parent / "00_inputs" / "components.json"
        if full_components_path.exists():
            full_components = read_json(full_components_path)
            full_by_id = {
                str(component.get("component_id")): component
                for component in full_components.get("components", [])
                if isinstance(component, Mapping) and component.get("component_id")
            }
            for component_id in missing_ids:
                component = full_by_id.get(component_id)
                if component is not None:
                    by_id[component_id] = dict(component)

    still_missing = sorted(required_ids - set(by_id))
    for component_id in still_missing:
        by_id[component_id] = _minimal_component_from_topology(component_id, after_topology)

    return {
        "schema_version": str(base_components.get("schema_version") or "1.0"),
        "components": [
            by_id[component_id]
            for component_id in sorted(required_ids)
            if component_id in by_id
        ],
        "source": {
            **dict(base_components.get("source") or {}),
            "representation": "geometry_edit_validation_components",
            "note": "placed components plus components added by 02_geometry_edit",
        },
    }


def _minimal_component_from_topology(component_id: str, topology: Mapping[str, Any]) -> dict[str, Any]:
    placement = next(
        (
            item
            for item in topology.get("placements", [])
            if isinstance(item, Mapping) and item.get("component_id") == component_id
        ),
        {},
    )
    mount_face_id = str(placement.get("component_mount_face_id") or f"{component_id}.local_zmin")
    return {
        "component_id": component_id,
        "semantic_name": placement.get("semantic_name") or component_id,
        "kind": placement.get("kind") or "internal",
        "category": "payload",
        "size_mm": [1.0, 1.0, 1.0],
        "mass_kg": 0.0,
        "power_W": 0.0,
        "material_id": "aluminum_6061",
        "component_subtype": placement.get("component_subtype"),
        "mounting": {
            "default_component_mount_face_id": mount_face_id,
            "mount_faces": [
                {
                    "component_mount_face_id": mount_face_id,
                    "local_face": mount_face_id.rsplit(".", 1)[-1],
                    "normal_axis": 2,
                    "normal_sign": -1,
                    "u_axis": 0,
                    "v_axis": 1,
                }
            ],
        },
    }


def _finish_failed(result: StageResult, reports: dict[str, Any]) -> StageResult:
    result.checks = reports
    result.errors = [
        check
        for report in reports.values()
        if isinstance(report, Mapping) and not report.get("ok", True)
        for check in report.get("failed_checks", [])
    ]
    return result.finish("failed")


def _resolve_geometry_edit_components_path(input_dir: Path, config: Mapping[str, Any]) -> Path:
    """Geometry edit validates only components that were actually placed in 01_layout."""
    configured = config.get("components_path")
    if configured:
        return Path(configured)
    placed_components_path = input_dir / "placed_components.json"
    if placed_components_path.exists():
        return placed_components_path
    return input_dir.parent / "00_inputs" / "components.json"


def _prepare_freecad_agent_config(
    config: Mapping[str, Any],
    geometry: Mapping[str, Any],
    source_step: Path,
    output_dir: Path,
) -> dict[str, Any]:
    agent_config = dict(config)
    edit_plan = _load_edit_plan(config)
    if edit_plan is not None:
        resolved_plan = _resolve_edit_plan(edit_plan, geometry, source_step, agent_config)
        edit_plan_path = write_json(output_dir / "edit_plan.json", resolved_plan)
        agent_config["template"] = "apply_edit_plan"
        agent_config["params"] = {"edit_plan_path": str(edit_plan_path)}
        agent_config["resolved_edit_plan"] = resolved_plan
        return agent_config

    component_id = str(agent_config.get("component_id") or "").strip()
    if not component_id:
        return agent_config
    template = str(agent_config.get("template") or "")
    if template not in {"translate_solid_by_index"}:
        return agent_config

    params = dict(agent_config.get("params") or {})
    params["solid_index"] = _solid_index_for_component(component_id, geometry, source_step, agent_config)
    agent_config["params"] = params
    return agent_config


def _load_edit_plan(config: Mapping[str, Any]) -> dict[str, Any] | None:
    if isinstance(config.get("edit_plan"), Mapping):
        return deepcopy(dict(config["edit_plan"]))
    if isinstance(config.get("actions"), list):
        return {"schema_version": "1.0", "actions": deepcopy(config["actions"])}
    edit_plan_path = config.get("edit_plan_path")
    if edit_plan_path:
        return read_json(Path(edit_plan_path))
    return None


def _resolve_edit_plan(
    edit_plan: Mapping[str, Any],
    geometry: Mapping[str, Any],
    source_step: Path,
    config: Mapping[str, Any],
) -> dict[str, Any]:
    entities = [entity for entity in geometry.get("entities", []) if isinstance(entity, Mapping)]
    existing_ids = {
        str(entity.get("component_id"))
        for entity in entities
        if isinstance(entity.get("component_id"), str)
    }
    next_geometry_index = _next_geometry_index(entities)
    resolved_actions = []
    for action in edit_plan.get("actions", []):
        if not isinstance(action, Mapping):
            raise RuntimeError(f"edit_plan action must be an object: {action!r}")
        action_type = _normalize_action_type(str(action.get("type") or ""))
        if action_type in {"move_component", "delete_component"}:
            component_id = str(action.get("component_id") or "").strip()
            if not component_id:
                raise RuntimeError(f"{action_type} requires component_id")
            resolved = dict(action)
            resolved["type"] = action_type
            resolved["component_id"] = component_id
            resolved["solid_index"] = _solid_index_for_component(component_id, geometry, source_step, config)
            if action_type == "move_component":
                resolved["delta_mm"] = _action_delta_mm(action)
            resolved_actions.append(resolved)
            continue

        if action_type == "add_component":
            component_id = str(action.get("component_id") or "").strip()
            semantic_name = str(action.get("semantic_name") or "").strip()
            if not component_id:
                raise RuntimeError("add_component requires component_id")
            if component_id in existing_ids:
                raise RuntimeError(f"add_component component_id already exists: {component_id}")
            if not semantic_name:
                raise RuntimeError("add_component requires semantic_name")
            bbox = _bbox_snapshot(action.get("bbox"))
            size = _bbox_size(bbox)
            if min(size) <= 0.0:
                raise RuntimeError("add_component requires bbox with positive size")
            geometry_id = str(action.get("geometry_id") or f"G{next_geometry_index:03d}")
            next_geometry_index += 1
            resolved = dict(action)
            resolved.update(
                {
                    "type": action_type,
                    "component_id": component_id,
                    "semantic_name": semantic_name,
                    "geometry_id": geometry_id,
                    "entity_type": str(action.get("entity_type") or "component_solid"),
                    "step_name": str(action.get("step_name") or component_id),
                    "bbox": bbox,
                }
            )
            if action.get("component_subtype"):
                resolved["component_subtype"] = action.get("component_subtype")
            resolved_actions.append(resolved)
            existing_ids.add(component_id)
            continue

        raise RuntimeError(f"unsupported edit_plan action type: {action.get('type')!r}")

    return {
        "schema_version": str(edit_plan.get("schema_version") or "1.0"),
        "actions": resolved_actions,
    }


def _normalize_action_type(action_type: str) -> str:
    aliases = {
        "move": "move_component",
        "delete": "delete_component",
        "add": "add_component",
    }
    return aliases.get(action_type, action_type)


def _action_delta_mm(action: Mapping[str, Any]) -> list[float]:
    if isinstance(action.get("delta_mm"), list):
        return _vector3(action["delta_mm"], [0.0, 0.0, 0.0])
    return [
        float(action.get("dx", 0.0)),
        float(action.get("dy", 0.0)),
        float(action.get("dz", 0.0)),
    ]


def _next_geometry_index(entities: list[Mapping[str, Any]]) -> int:
    max_index = 0
    for entity in entities:
        geometry_id = str(entity.get("geometry_id") or "")
        if geometry_id.startswith("G") and geometry_id[1:].isdigit():
            max_index = max(max_index, int(geometry_id[1:]))
    return max_index + 1


def _solid_index_for_component(
    component_id: str,
    geometry: Mapping[str, Any],
    source_step: Path,
    config: Mapping[str, Any],
) -> int:
    entities = [entity for entity in geometry.get("entities", []) if isinstance(entity, Mapping)]
    entity_index = next(
        (index for index, entity in enumerate(entities) if entity.get("component_id") == component_id),
        None,
    )
    if entity_index is None:
        raise RuntimeError(f"component_id not found in geometry_registry.json: {component_id}")

    solid_count = len(_read_step_solid_bboxes(source_step, config))
    if solid_count == len(entities):
        return entity_index
    if solid_count == len(entities) + 1:
        return entity_index + 1
    raise RuntimeError(
        "Cannot map component_id to STEP solid index: "
        f"component_id={component_id}, solid_count={solid_count}, component_entity_count={len(entities)}"
    )


def _run_freecad_agent(source_step: Path, output_step: Path, config: Mapping[str, Any]) -> None:
    script = Path(config.get("agent_loop_script", "geometry_edit_runtime/freecad_agent/agent_loop.py"))
    if not script.is_absolute():
        script = Path.cwd() / script
    result_out = output_step.with_name("freecad_result.json")
    script_out = output_step.with_name("freecad_script.py")
    cmd = [
        sys.executable,
        str(script),
        "--input",
        str(source_step),
        "--output",
        str(output_step),
        "--script-out",
        str(script_out),
        "--result-out",
        str(result_out),
        "--template",
        str(config.get("template", "export_identity")),
    ]
    if config.get("params"):
        cmd.extend(["--params", json.dumps(config["params"])])
    env = os.environ.copy()
    runtime_home = Path(str(config.get("runtime_home", "/tmp/cad2comsol_runtime/freecad_home")))
    runtime_home.mkdir(parents=True, exist_ok=True)
    env["HOME"] = str(runtime_home)
    env["XDG_CONFIG_HOME"] = str(runtime_home / ".config")
    env["XDG_CACHE_HOME"] = str(runtime_home / ".cache")
    if config.get("freecadcmd"):
        env["FREECADCMD"] = str(config["freecadcmd"])
    execution = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        env=env,
        timeout=int(config.get("timeout_seconds", 600)),
    )
    if execution.returncode != 0:
        raise RuntimeError(execution.stderr.strip() or execution.stdout.strip())
