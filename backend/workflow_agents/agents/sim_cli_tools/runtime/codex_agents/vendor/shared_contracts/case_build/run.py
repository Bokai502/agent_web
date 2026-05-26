from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any, Mapping

from core.io import read_json, write_json
from core.stages import StageResult
from formats.validators import validate_components


def run_stage(
    input_dir: Path,
    output_dir: Path,
    config: Mapping[str, Any] | None = None,
) -> StageResult:
    """Build a canonical case directory from reconstructed run artifacts."""
    config = config or {}
    run_root = Path(config.get("run_root", input_dir))
    output_dir = Path(output_dir)
    result = StageResult(
        stage_name="case_build",
        status="running",
        inputs={"run_root": run_root, "config": dict(config)},
        outputs={"output_dir": output_dir},
    )
    try:
        components_path = Path(config.get("components_path", run_root / "components.json"))
        simulation_input_path = Path(config.get("simulation_input_path", run_root / "simulation_input.json"))
        components = read_json(components_path)
        validation = validate_components(components)
        result.checks["components"] = validation.to_dict()
        if not validation.ok:
            result.errors = [check.to_dict() for check in validation.failed_checks]
            return result.finish("failed")

        output_dir.mkdir(parents=True, exist_ok=True)
        native_vtu_src = run_root / "simulation" / "native.vtu"
        field_vtu = output_dir / "field.vtu"
        shutil.copy2(native_vtu_src, field_vtu)
        field_samples = read_json(run_root / "simulation" / "field_samples.json")
        tensor_summary = read_json(run_root / "simulation" / "tensors.json")
        component_index = _component_index(components)
        case_manifest = {
            "schema_version": "1.0",
            "case_id": str(config.get("case_id", run_root.name)),
            "source_run_root": str(run_root),
            "source_artifacts": {
                "components": str(components_path),
                "simulation_input": str(simulation_input_path),
                "field_samples": "simulation/field_samples.json",
                "native_vtu": "simulation/native.vtu",
                "tensors": "simulation/tensors.json",
            },
            "outputs": {
                "component_index": "component_index.json",
                "field_vtu": "field.vtu",
                "field_points": "field_points.json",
                "tensor_summary": "tensor_summary.json",
                "case_validation": "case_validation.json",
            },
        }
        validation_report = {
            "schema_version": "1.0",
            "ok": True,
            "checks": {
                "component_count": len(components["components"]),
                "field_vtu_exists": True,
                "field_sample_count": len(field_samples.get("samples", [])),
            },
            "warnings": [],
        }
        outputs = {
            "case_manifest": write_json(output_dir / "case_manifest.json", case_manifest),
            "component_index": write_json(output_dir / "component_index.json", component_index),
            "field_points": write_json(output_dir / "field_points.json", field_samples),
            "tensor_summary": write_json(output_dir / "tensor_summary.json", tensor_summary),
            "case_validation": write_json(output_dir / "case_validation.json", validation_report),
            "field_vtu": field_vtu,
        }
        result.outputs.update(outputs)
        return result.finish("completed")
    except Exception as exc:
        result.errors.append({"type": exc.__class__.__name__, "message": str(exc)})
        return result.finish("failed")


def _component_index(components: Mapping[str, Any]) -> dict[str, Any]:
    by_id = {}
    semantic_groups: dict[str, list[str]] = {}
    for component in components["components"]:
        by_id[component["component_id"]] = {
            "semantic_name": component["semantic_name"],
            "kind": component["kind"],
            "category": component["category"],
            "material_id": component.get("material_id"),
        }
        semantic_groups.setdefault(component["kind"], []).append(component["component_id"])
        semantic_groups.setdefault(component["category"], []).append(component["component_id"])
    return {
        "schema_version": "1.0",
        "components": by_id,
        "semantic_groups": semantic_groups,
    }
