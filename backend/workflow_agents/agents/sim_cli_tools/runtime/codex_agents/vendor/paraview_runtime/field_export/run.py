from __future__ import annotations

import math
from pathlib import Path
from typing import Any, Mapping

from core.io import read_json, write_json
from core.stages import StageResult
from formats.validators import validate_simulation_outputs
from .threejs_export import export_temperature_field_threejs, export_temperature_surface_threejs


def run_stage(
    input_dir: Path,
    output_dir: Path,
    config: Mapping[str, Any] | None = None,
) -> StageResult:
    """Normalize simulation field outputs into postprocess inputs."""
    config = config or {}
    input_dir = Path(input_dir)
    output_dir = Path(output_dir)
    result = StageResult(
        stage_name="field_export",
        status="running",
        inputs={"input_dir": input_dir, "config": dict(config)},
        outputs={"output_dir": output_dir},
    )
    try:
        status = read_json(input_dir / "status.json")
        field_samples = read_json(input_dir / "field_samples.json")
        tensors = read_json(input_dir / "tensors.json")
        native_vtu = input_dir / "native.vtu"
        validation = validate_simulation_outputs(
            status=status,
            field_samples=field_samples,
            native_vtu=native_vtu,
            tensors=tensors,
        )
        result.checks["simulation_outputs"] = validation.to_dict()
        if not validation.ok:
            result.errors = [check.to_dict() for check in validation.failed_checks]
            return result.finish("failed")

        output_dir.mkdir(parents=True, exist_ok=True)
        field_stats = _field_stats(field_samples)
        threejs_temperature_field_path: Path | None = None
        threejs_temperature_surface_path: Path | None = None
        try:
            threejs_temperature_field_path = export_temperature_field_threejs(
                native_vtu,
                output_dir / "temperature_field_threejs.json",
                preferred_array=str(config.get("temperature_array", "")) or None,
                max_points=int(config.get("threejs_max_points", 50000)),
            )
        except Exception as exc:
            result.warnings.append(f"failed to export temperature_field_threejs.json: {exc}")
        try:
            threejs_temperature_surface_path = export_temperature_surface_threejs(
                native_vtu,
                output_dir / "temperature_surface_threejs.json",
                preferred_array=str(config.get("temperature_array", "")) or None,
            )
        except Exception as exc:
            result.warnings.append(f"failed to export temperature_surface_threejs.json: {exc}")
        manifest = {
            "schema_version": "1.0",
            "field_export_id": "field_export_mock_contract",
            "inputs": {
                "status": str(input_dir / "status.json"),
                "field_samples": str(input_dir / "field_samples.json"),
                "native_vtu": str(native_vtu),
                "tensors": str(input_dir / "tensors.json"),
            },
            "outputs": {
                "field_stats": "field_stats.json",
                "native_vtu": str(native_vtu),
                "derived_tensors": "derived_tensors/tensor_summary.json",
                "temperature_field_threejs": (
                    "temperature_field_threejs.json"
                    if threejs_temperature_field_path is not None
                    else None
                ),
                "temperature_surface_threejs": (
                    "temperature_surface_threejs.json"
                    if threejs_temperature_surface_path is not None
                    else None
                ),
            },
            "summary": field_stats,
        }
        field_stats_path = write_json(output_dir / "field_stats.json", field_stats)
        manifest_path = write_json(output_dir / "field_export_manifest.json", manifest)
        tensor_summary_path = write_json(output_dir / "derived_tensors" / "tensor_summary.json", tensors)
        result.outputs.update(
            {
                "field_export_manifest": manifest_path,
                "field_stats": field_stats_path,
                "tensor_summary": tensor_summary_path,
            }
        )
        if threejs_temperature_field_path is not None:
            result.outputs["temperature_field_threejs"] = threejs_temperature_field_path
        if threejs_temperature_surface_path is not None:
            result.outputs["temperature_surface_threejs"] = threejs_temperature_surface_path
        return result.finish("completed")
    except Exception as exc:
        result.errors.append({"type": exc.__class__.__name__, "message": str(exc)})
        return result.finish("failed")


def _field_stats(field_samples: Mapping[str, Any]) -> dict[str, Any]:
    temperatures = [
        float(sample["temperature_K"])
        for sample in field_samples.get("samples", [])
        if (
            isinstance(sample, Mapping)
            and isinstance(sample.get("temperature_K"), (int, float))
            and math.isfinite(float(sample["temperature_K"]))
        )
    ]
    if not temperatures:
        raise ValueError("field_samples contains no numeric temperature_K values")
    return {
        "schema_version": "1.0",
        "count": len(field_samples.get("samples", [])),
        "valid_count": len(temperatures),
        "nan_count": len(field_samples.get("samples", [])) - len(temperatures),
        "min_K": min(temperatures),
        "max_K": max(temperatures),
        "mean_K": round(sum(temperatures) / len(temperatures), 6),
    }
