from __future__ import annotations

import math
from pathlib import Path
from typing import Any, Mapping

from core.io import read_json, write_json
from core.stages import StageResult
from formats.validators import validate_analysis_outputs


def run_stage(
    input_dir: Path,
    output_dir: Path,
    config: Mapping[str, Any] | None = None,
) -> StageResult:
    """Run deterministic lower-loop analysis on a canonical case directory."""
    config = config or {}
    case_dir = Path(input_dir)
    output_dir = Path(output_dir)
    result = StageResult(
        stage_name="analysis",
        status="running",
        inputs={"case_dir": case_dir, "config": dict(config)},
        outputs={"output_dir": output_dir},
    )
    try:
        component_index = read_json(case_dir / "component_index.json")
        field_points = read_json(case_dir / "field_points.json")
        tensor_summary = read_json(case_dir / "tensor_summary.json")
        component_ids = set(component_index.get("components", {}).keys())
        max_allowed = float(config.get("default_allow_max_K", 320.0))
        min_allowed = float(config.get("default_allow_min_K", 250.0))
        temperatures = [
            float(sample["temperature_K"])
            for sample in field_points.get("samples", [])
            if (
                isinstance(sample, Mapping)
                and isinstance(sample.get("temperature_K"), (int, float))
                and math.isfinite(float(sample["temperature_K"]))
            )
        ]
        temp_summary = {
            "min_K": min(temperatures),
            "max_K": max(temperatures),
            "mean_K": round(sum(temperatures) / len(temperatures), 6),
        }
        anomalies = []
        for sample in field_points.get("samples", []):
            if not isinstance(sample, Mapping):
                continue
            temperature = sample.get("temperature_K")
            component_id = sample.get("component_id")
            if not isinstance(temperature, (int, float)):
                continue
            if not math.isfinite(float(temperature)):
                continue
            if temperature > max_allowed or temperature < min_allowed:
                anomalies.append(
                    {
                        "object_id": component_id,
                        "component_id": component_id,
                        "anomaly_type": "over_allow_max" if temperature > max_allowed else "under_allow_min",
                        "observed_K": temperature,
                        "allow_max_K": max_allowed,
                        "allow_min_K": min_allowed,
                        "evidence": [f"temperature_K={temperature} outside [{min_allowed}, {max_allowed}]"],
                    }
                )
        observation = {
            "schema_version": "1.0",
            "observation_id": "obs_contract",
            "source_simulation_id": "sim_mock_contract",
            "temperature": temp_summary,
            "anomalies": anomalies,
        }
        if anomalies:
            root_causes = [
                {
                    "category": "internal_component",
                    "target_ids": sorted({item["component_id"] for item in anomalies if item.get("component_id")}),
                    "evidence": ["component temperature exceeds configured contract threshold"],
                    "confidence": 0.7,
                }
            ]
        else:
            root_causes = [
                {
                    "category": "no_anomaly",
                    "target_ids": [],
                    "evidence": ["all mock field samples are within configured thresholds"],
                    "confidence": 1.0,
                }
            ]
        diagnosis = {
            "schema_version": "1.0",
            "diagnosis_id": "diag_contract",
            "root_causes": root_causes,
        }
        metrics_summary = {
            "schema_version": "1.0",
            "ok": True,
            "component_count": len(component_ids),
            "anomaly_count": len(anomalies),
            "temperature_summary": temp_summary,
            "tensor_summary": tensor_summary.get("summary", {}),
        }
        root_cause_report = {
            "schema_version": "1.0",
            "primary_cause": root_causes[0]["category"],
            "evidence": root_causes[0]["evidence"],
            "confidence": root_causes[0]["confidence"],
            "eligible_for_solution_generation": bool(anomalies),
        }
        validation = validate_analysis_outputs(observation, diagnosis, known_target_ids=component_ids)
        result.checks["analysis_outputs"] = validation.to_dict()
        if not validation.ok:
            result.errors = [check.to_dict() for check in validation.failed_checks]
            return result.finish("failed")

        output_dir.mkdir(parents=True, exist_ok=True)
        result.outputs.update(
            {
                "observation": write_json(output_dir / "observation.json", observation),
                "metrics_summary": write_json(output_dir / "metrics_summary.json", metrics_summary),
                "anomaly_candidates": write_json(output_dir / "anomaly_candidates.json", anomalies),
                "diagnosis": write_json(output_dir / "diagnosis.json", diagnosis),
                "root_cause_report": write_json(output_dir / "root_cause_report.json", root_cause_report),
                "analysis_stage_log": write_json(
                    output_dir / "analysis_stage_log.json",
                    {
                        "schema_version": "1.0",
                        "ok": True,
                        "warnings": [],
                    },
                ),
            }
        )
        return result.finish("completed")
    except Exception as exc:
        result.errors.append({"type": exc.__class__.__name__, "message": str(exc)})
        return result.finish("failed")
