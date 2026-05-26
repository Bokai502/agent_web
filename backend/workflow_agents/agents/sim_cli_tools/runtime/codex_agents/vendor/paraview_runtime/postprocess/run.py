from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any, Mapping

from core.io import read_json, write_json
from core.stages import StageResult


def run_stage(
    input_dir: Path,
    output_dir: Path,
    config: Mapping[str, Any] | None = None,
) -> StageResult:
    """Create postprocess render and visualization manifests."""
    config = config or {}
    input_dir = Path(input_dir)
    output_dir = Path(output_dir)
    result = StageResult(
        stage_name="postprocess",
        status="running",
        inputs={"input_dir": input_dir, "config": dict(config)},
        outputs={"output_dir": output_dir},
    )
    try:
        field_stats = read_json(input_dir / "field_stats.json")
        backend = str(config.get("render_backend", "mock_contract"))
        if backend == "paraview":
            native_vtu = Path(config.get("native_vtu", input_dir.parent / "simulation" / "native.vtu"))
            script = Path(config.get("render_script", "paraview_runtime/paraview_renderer/render_temperature.py"))
            if not script.is_absolute():
                script = Path.cwd() / script
            cmd = [
                str(config.get("pvpython", "pvpython")),
                str(script),
                str(native_vtu),
                str(output_dir),
                "--array-name",
                str(config.get("array_name", "T")),
                "--width",
                str(config.get("image_width", 1280)),
                "--height",
                str(config.get("image_height", 720)),
            ]
            if bool(config.get("use_xvfb", True)):
                cmd = [
                    "xvfb-run",
                    "-a",
                    "--server-args",
                    f"-screen 0 {max(int(config.get('image_width', 1280)), 1280)}x{max(int(config.get('image_height', 720)), 720)}x24",
                    *cmd,
                ]
            output_dir.mkdir(parents=True, exist_ok=True)
            execution = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=int(config.get("timeout_seconds", 900)),
            )
            if execution.returncode != 0:
                raise RuntimeError(execution.stderr.strip() or execution.stdout.strip())
            pv_summary = read_json(output_dir / "summary.json")
            render_summary = {
                "schema_version": "1.0",
                "ok": True,
                "backend": "paraview",
                "mock_only": False,
                "temperature_range_K": [
                    pv_summary["temperature"]["min_K"],
                    pv_summary["temperature"]["max_K"],
                ],
                "images": [
                    path
                    for group in pv_summary.get("outputs", {}).values()
                    for path in (group if isinstance(group, list) else [group])
                ],
                "paraview_summary": pv_summary,
                "stdout": execution.stdout,
                "stderr": execution.stderr,
            }
            visualization_manifest = {
                "schema_version": "1.0",
                "inputs": {
                    "field_export_manifest": "field_export_manifest.json",
                    "field_stats": "field_stats.json",
                    "native_vtu": str(native_vtu),
                },
                "outputs": {
                    "render_summary": "render_summary.json",
                    "paraview_summary": "summary.json",
                    "images": render_summary["images"],
                },
                "summary": field_stats,
            }
            render_summary_path = write_json(output_dir / "render_summary.json", render_summary)
            visualization_manifest_path = write_json(output_dir / "visualization_manifest.json", visualization_manifest)
            result.outputs.update(
                {
                    "render_summary": render_summary_path,
                    "visualization_manifest": visualization_manifest_path,
                }
            )
            return result.finish("completed")

        render_summary = {
            "schema_version": "1.0",
            "ok": True,
            "backend": "mock_contract",
            "mock_only": True,
            "temperature_range_K": [
                field_stats["min_K"],
                field_stats["max_K"],
            ],
            "images": [],
            "warnings": ["mock_contract backend does not run ParaView"],
        }
        visualization_manifest = {
            "schema_version": "1.0",
            "inputs": {
                "field_export_manifest": "field_export_manifest.json",
                "field_stats": "field_stats.json",
            },
            "outputs": {
                "render_summary": "render_summary.json",
            },
            "summary": field_stats,
        }
        render_summary_path = write_json(output_dir / "render_summary.json", render_summary)
        visualization_manifest_path = write_json(output_dir / "visualization_manifest.json", visualization_manifest)
        result.outputs.update(
            {
                "render_summary": render_summary_path,
                "visualization_manifest": visualization_manifest_path,
            }
        )
        result.warnings.extend(render_summary["warnings"])
        return result.finish("completed")
    except Exception as exc:
        result.errors.append({"type": exc.__class__.__name__, "message": str(exc)})
        return result.finish("failed")
