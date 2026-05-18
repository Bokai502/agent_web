from __future__ import annotations

import argparse
import importlib.util
import json
import os
import subprocess
from pathlib import Path
from typing import Any

import pytest

import codex_agents as pipeline
from codex_agents import dependencies
from codex_agents.bootstrap import prefer_vendor_imports
from codex_agents.cli import main
from codex_agents.external_tool_launchers import load_simulation_outputs_in_remote_tools
from codex_agents.local_io import read_json, write_json

prefer_vendor_imports()

from apps.main_loop.layout_materialize import write_component_info_outputs  # noqa: E402
from pipeline.simulation.run import (  # noqa: E402
    _comsol_mphserver_ports_from_processes,
    _listening_tcp_ports,
    _select_mph_port,
    _sync_comsol_progress,
)


class _FakeStageResult:
    def __init__(self, stage_name: str, status: str = "completed") -> None:
        self.stage_name = stage_name
        self.status = status

    def to_dict(self) -> dict[str, Any]:
        return {
            "stage_name": self.stage_name,
            "status": self.status,
            "inputs": {},
            "outputs": {},
            "checks": {},
            "warnings": [],
            "errors": [],
        }


def test_config_from_namespace_preserves_vendor_defaults(tmp_path: Path) -> None:
    config = pipeline.BomExternalToolsPipelineConfig.from_namespace(
        argparse.Namespace(
            bom_json=tmp_path / "real_bom.json",
            run_root=tmp_path / "run",
            rebuild_cad_after_edit=True,
        )
    )

    assert config.bom_json == tmp_path / "real_bom.json"
    assert config.run_root == tmp_path / "run"
    assert config.rebuild_cad_after_edit is True
    assert config.geometry_edit_dir_name == "02_geometry_edit"
    assert config.simulation_backend == "comsol_local"
    assert "codex_agents/vendor" in str(config.layout3dcube_root)
    assert "codex_agents/vendor" in str(config.thermal_db)


def test_simulation_step_selects_after_state_inputs(tmp_path: Path) -> None:
    config = pipeline.BomExternalToolsPipelineConfig(
        bom_json=tmp_path / "real_bom.json",
        run_root=tmp_path / "run",
        simulation_backend="mock_contract",
    )
    ctx = pipeline.BomExternalToolsPipelineContext(config)
    after_step = ctx.paths["geometry_edit"] / "geometry_after.step"
    after_step.write_text("step", encoding="utf-8")
    for relative_path in (
        "geometry_after.geom.json",
        "geometry_after.layout_topology.json",
        "geometry_after_registry.json",
        "sample.yaml",
        "simulation_input.json",
        "comsol_inputs/coord.txt",
        "comsol_inputs/channels_input.npz",
    ):
        path = ctx.paths["geometry_edit"] / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("{}", encoding="utf-8")

    step = pipeline.SimulationStep()
    selected = step.select_geometry_step(ctx)
    stage_config = step.simulation_config(config, ctx.paths, selected)

    assert selected == after_step
    assert stage_config["simulation_input_path"] == ctx.paths["geometry_edit"] / "simulation_input.json"
    assert stage_config["geometry_step_path"] == after_step
    assert "thermal_sim_config" not in stage_config


def test_load_simulation_outputs_in_remote_tools_launches_expected_commands(
    monkeypatch: Any,
    tmp_path: Path,
) -> None:
    simulation_dir = tmp_path / "03_simulation"
    simulation_dir.mkdir()
    work_mph = simulation_dir / "work.mph"
    native_vtu = simulation_dir / "native.vtu"
    work_mph.write_text("mph", encoding="utf-8")
    native_vtu.write_text("<VTKFile />", encoding="utf-8")
    commands: list[list[str]] = []

    class FakeProcess:
        pid = 12345

    monkeypatch.setattr("codex_agents.external_tool_launchers.shutil.which", lambda path: path)
    monkeypatch.setattr(
        "codex_agents.external_tool_launchers._has_existing_paraview_process",
        lambda: False,
    )
    monkeypatch.setattr(
        "codex_agents.external_tool_launchers.subprocess.Popen",
        lambda command, **kwargs: commands.append(command) or FakeProcess(),
    )

    result = load_simulation_outputs_in_remote_tools(simulation_dir)

    assert result["ok"] is True
    assert result["comsol"]["status"] == "launched"
    assert result["paraview"]["status"] == "launched"
    assert commands == [
        ["/usr/local/bin/start-comsol-remote", "-open", str(work_mph)],
        [
            "/usr/local/bin/start-paraview-remote",
            f"--script={simulation_dir / 'open_native_vtu_in_paraview.py'}",
            "--geometry=1600x1000+20+20",
        ],
    ]
    assert (simulation_dir / "open_native_vtu_in_paraview.py").exists()


def test_load_simulation_outputs_in_remote_tools_skips_paraview_when_already_running(
    monkeypatch: Any,
    tmp_path: Path,
) -> None:
    simulation_dir = tmp_path / "03_simulation"
    simulation_dir.mkdir()
    (simulation_dir / "work.mph").write_text("mph", encoding="utf-8")
    (simulation_dir / "native.vtu").write_text("<VTKFile />", encoding="utf-8")
    calls: list[list[str]] = []

    class FakeProcess:
        pid = 12345

    monkeypatch.setattr("codex_agents.external_tool_launchers.shutil.which", lambda path: path)
    monkeypatch.setattr(
        "codex_agents.external_tool_launchers._has_existing_paraview_process",
        lambda: True,
    )

    def fake_popen(command: list[str], **kwargs: Any) -> FakeProcess:
        calls.append(command)
        return FakeProcess()

    monkeypatch.setattr(
        "codex_agents.external_tool_launchers.subprocess.Popen",
        fake_popen,
    )

    result = load_simulation_outputs_in_remote_tools(simulation_dir)

    assert result["ok"] is True
    assert result["paraview"]["status"] == "skipped"
    assert result["paraview"]["reason"] == "existing_process_no_ipc"
    assert calls == [["/usr/local/bin/start-comsol-remote", "-open", str(simulation_dir / "work.mph")]]


def test_load_simulation_outputs_in_remote_tools_skips_missing_files(tmp_path: Path) -> None:
    result = load_simulation_outputs_in_remote_tools(tmp_path / "03_simulation")

    assert result["ok"] is True
    assert result["comsol"]["status"] == "skipped"
    assert result["comsol"]["reason"] == "missing_data_file"
    assert result["paraview"]["status"] == "skipped"
    assert result["paraview"]["reason"] == "missing_data_file"


def test_runner_stops_after_simulation_when_skip_postprocess(monkeypatch: Any, tmp_path: Path) -> None:
    run_root = tmp_path / "run"
    (tmp_path / "real_bom.json").write_text("{}", encoding="utf-8")

    def fake_layout(**kwargs: Any) -> dict[str, Any]:
        run_dir = Path(kwargs["run_dir"])
        layout_dir = run_dir / "01_layout"
        return {
            "ok": True,
            "bom": str(kwargs["bom_path"]),
            "run_dir": str(run_dir),
            "layout_dir": str(layout_dir),
            "component_info_dir": str(run_dir / "component_info"),
            "stats": {"n_unplaced": 0},
        }

    def fake_geometry(**kwargs: Any) -> dict[str, Any]:
        edit_dir = Path(kwargs["run_dir"]) / kwargs["output_dir_name"]
        for relative_path in (
            "geometry_after.step",
            "geometry_after.geom.json",
            "geometry_after.layout_topology.json",
            "geometry_after_registry.json",
            "sample.yaml",
            "simulation_input.json",
            "comsol_inputs/coord.txt",
            "comsol_inputs/channels_input.npz",
        ):
            path = edit_dir / relative_path
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("{}", encoding="utf-8")
        return {
            "ok": True,
            "run_dir": str(kwargs["run_dir"]),
            "geometry_edit_dir": str(edit_dir),
            "planner_execution_ok": True,
            "covered_missing_count": 0,
            "unresolved_missing_count": 0,
            "warnings": [],
            "errors": [],
        }

    def fail_downstream(*args: Any, **kwargs: Any) -> None:
        raise AssertionError("downstream postprocess stages should not run")

    monkeypatch.setattr(dependencies, "run_one_bom_layout", fake_layout)
    monkeypatch.setattr(dependencies, "_run_one_geometry_edit_loop_test", fake_geometry)
    monkeypatch.setattr(dependencies, "run_simulation", lambda *args, **kwargs: _FakeStageResult("simulation_run"))
    monkeypatch.setattr(dependencies, "run_field_export", fail_downstream)
    monkeypatch.setattr(dependencies, "run_postprocess", fail_downstream)
    monkeypatch.setattr(dependencies, "run_case_build", fail_downstream)
    monkeypatch.setattr(dependencies, "run_analysis", fail_downstream)
    monkeypatch.setattr(dependencies, "run_suggestion", fail_downstream)

    manifest = pipeline.run_bom_external_tools_pipeline(
        argparse.Namespace(
            bom_json=tmp_path / "real_bom.json",
            run_root=run_root,
            simulation_backend="mock_contract",
            skip_postprocess=True,
        )
    )

    assert manifest["ok"] is True
    assert [stage["stage_name"] for stage in manifest["stages"]] == [
        "layout_generate",
        "geometry_validate",
        "simulation_run",
    ]
    assert (run_root / "logs" / "layout_generate_stage_result.json").exists()
    assert (run_root / "logs" / "geometry_validate_stage_result.json").exists()
    assert (run_root / "logs" / "simulation_run_stage_result.json").exists()
    assert (run_root / "logs" / "layout_generate_raw_result.json").exists()
    progress = read_json(run_root / "logs" / "progress_percentages.json")
    assert progress["schema_version"] == "1.0"
    assert progress["total_steps"] == 8
    assert progress["overall_percent"] == 37.5
    assert [step["command_name"] for step in progress["steps"]] == [
        "layout-generate",
        "geometry-edit",
        "simulation",
        "field-export",
        "postprocess",
        "case-build",
        "analysis",
        "suggestion",
    ]
    assert [step["status"] for step in progress["steps"][:3]] == ["completed", "completed", "completed"]
    assert [step["percent"] for step in progress["steps"][:3]] == [100.0, 100.0, 100.0]
    assert read_json(run_root / "run_manifest.json") == manifest


def test_comsol_status_sync_updates_pipeline_progress(tmp_path: Path) -> None:
    run_root = tmp_path / "run"
    progress_path = run_root / "logs" / "progress_percentages.json"
    status_path = run_root / "03_simulation" / "_comsol_work" / "sim" / "status.json"
    write_json(
        progress_path,
        {
            "schema_version": "1.0",
            "total_steps": 8,
            "overall_percent": 25.0,
            "current_step": "simulation",
            "steps": [
                {"command_name": "layout-generate", "weight_percent": 12.5, "status": "completed", "percent": 100.0},
                {"command_name": "geometry-edit", "weight_percent": 12.5, "status": "completed", "percent": 100.0},
                {"command_name": "simulation", "weight_percent": 12.5, "status": "running", "percent": 0.0},
            ],
        },
    )
    write_json(
        status_path,
        {
            "sample_id": "_comsol_work",
            "stage": "solve",
            "progress_percent": 80.0,
            "updated_at": "2026-05-15 10:00:00",
        },
    )

    assert _sync_comsol_progress(status_path, progress_path, None) == "solve"

    progress = read_json(progress_path)
    simulation_step = progress["steps"][2]
    assert simulation_step["percent"] == 80.0
    assert simulation_step["comsol_progress"]["stage"] == "solve"
    assert progress["overall_percent"] == 35.0


def test_comsol_auto_start_uses_free_mph_port_when_preferred_is_busy(monkeypatch: Any) -> None:
    monkeypatch.setattr(
        "pipeline.simulation.run._listening_tcp_ports",
        lambda: {2036},
    )
    monkeypatch.setattr(
        "pipeline.simulation.run._comsol_mphserver_ports_from_processes",
        lambda: {2037},
    )

    assert _select_mph_port(2036) == 2038


def test_comsol_auto_start_prefers_private_port(monkeypatch: Any) -> None:
    monkeypatch.setattr("pipeline.simulation.run._listening_tcp_ports", lambda: set())
    monkeypatch.setattr("pipeline.simulation.run._comsol_mphserver_ports_from_processes", lambda: set())

    assert _select_mph_port(2036, prefer_private=True) == 32036


def test_listening_tcp_ports_reads_proc_net_tcp(monkeypatch: Any, tmp_path: Path) -> None:
    tcp_path = tmp_path / "tcp"
    tcp6_path = tmp_path / "tcp6"
    tcp_path.write_text(
        "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n"
        "   0: 0100007F:07F4 00000000:0000 0A 00000000:00000000 00:00000000 00000000   100        0 1\n",
        encoding="utf-8",
    )
    tcp6_path.write_text(tcp_path.read_text(encoding="utf-8"), encoding="utf-8")
    paths = iter([tcp_path, tcp6_path])
    monkeypatch.setattr("pipeline.simulation.run.Path", lambda value: next(paths) if value.startswith("/proc/net/tcp") else Path(value))

    assert 2036 in _listening_tcp_ports()


def test_comsol_mphserver_ports_reads_proc_cmdline(monkeypatch: Any, tmp_path: Path) -> None:
    pid_dir = tmp_path / "123"
    pid_dir.mkdir()
    (pid_dir / "cmdline").write_bytes(b"/usr/local/bin/comsol\0mphserver\0-port\0" b"2036\0")
    other_dir = tmp_path / "abc"
    other_dir.mkdir()

    class FakeProcPath:
        def __init__(self, value: str | Path) -> None:
            self._path = tmp_path if str(value) == "/proc" else Path(value)

        def iterdir(self):
            return self._path.iterdir()

    monkeypatch.setattr("pipeline.simulation.run.Path", FakeProcPath)

    assert _comsol_mphserver_ports_from_processes() == {2036}


def test_layout_snapshot_preserves_bom_inside_cleaned_inputs(monkeypatch: Any, tmp_path: Path) -> None:
    run_root = tmp_path / "run"
    input_bom = run_root / "00_inputs" / "real_bom.json"
    input_bom.parent.mkdir(parents=True)
    input_bom.write_text('{"bom": "inside-run-root"}', encoding="utf-8")
    captured: dict[str, Any] = {}

    def fake_layout(**kwargs: Any) -> dict[str, Any]:
        bom_path = Path(kwargs["bom_path"])
        input_dir = Path(kwargs["run_dir"]) / "00_inputs"
        if input_dir.exists():
            import shutil

            shutil.rmtree(input_dir)
        input_dir.mkdir(parents=True)
        captured["bom_path"] = bom_path
        captured["bom_payload"] = bom_path.read_text(encoding="utf-8")
        return {
            "ok": True,
            "bom": str(bom_path),
            "run_dir": str(kwargs["run_dir"]),
            "layout_dir": str(Path(kwargs["run_dir"]) / "01_layout"),
            "component_info_dir": str(Path(kwargs["run_dir"]) / "component_info"),
            "stats": {"n_unplaced": 0},
        }

    def fake_geometry(**kwargs: Any) -> dict[str, Any]:
        captured["source_bom_path"] = Path(kwargs["source_bom_path"])
        captured["source_bom_payload"] = Path(kwargs["source_bom_path"]).read_text(encoding="utf-8")
        edit_dir = Path(kwargs["run_dir"]) / kwargs["output_dir_name"]
        for relative_path in (
            "geometry_after.step",
            "geometry_after.geom.json",
            "geometry_after.layout_topology.json",
            "geometry_after_registry.json",
            "sample.yaml",
            "simulation_input.json",
            "comsol_inputs/coord.txt",
            "comsol_inputs/channels_input.npz",
        ):
            path = edit_dir / relative_path
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("{}", encoding="utf-8")
        return {
            "ok": True,
            "run_dir": str(kwargs["run_dir"]),
            "geometry_edit_dir": str(edit_dir),
        }

    def fail_downstream(*args: Any, **kwargs: Any) -> None:
        raise AssertionError("downstream stages should not run")

    monkeypatch.setattr(dependencies, "run_one_bom_layout", fake_layout)
    monkeypatch.setattr(dependencies, "_run_one_geometry_edit_loop_test", fake_geometry)
    monkeypatch.setattr(dependencies, "run_simulation", lambda *args, **kwargs: _FakeStageResult("simulation_run"))
    monkeypatch.setattr(dependencies, "run_field_export", fail_downstream)
    monkeypatch.setattr(dependencies, "run_postprocess", fail_downstream)
    monkeypatch.setattr(dependencies, "run_case_build", fail_downstream)
    monkeypatch.setattr(dependencies, "run_analysis", fail_downstream)
    monkeypatch.setattr(dependencies, "run_suggestion", fail_downstream)

    manifest = pipeline.run_bom_external_tools_pipeline(
        argparse.Namespace(
            bom_json=input_bom,
            run_root=run_root,
            simulation_backend="mock_contract",
            skip_postprocess=True,
        )
    )

    snapshot = run_root / ".pipeline_inputs" / "real_bom.json"
    assert manifest["ok"] is True
    assert captured["bom_path"] == snapshot
    assert captured["source_bom_path"] == snapshot
    assert captured["bom_payload"] == '{"bom": "inside-run-root"}'
    assert captured["source_bom_payload"] == '{"bom": "inside-run-root"}'
    assert read_json(run_root / "logs" / "layout_generate_raw_result.json")["bom"] == str(snapshot)


def test_progress_migrates_legacy_freecad_payload(monkeypatch: Any, tmp_path: Path) -> None:
    run_root = tmp_path / "run"
    logs_dir = run_root / "logs"
    logs_dir.mkdir(parents=True)
    step_path = run_root / "02_geometry_edit" / "geometry_after.step"
    (logs_dir / "layout_generate_stage_result.json").write_text(
        """
{
  "stage_name": "layout_generate",
  "status": "completed_with_unplaced",
  "inputs": {},
  "outputs": {},
  "checks": {},
  "warnings": [],
  "errors": []
}
""",
        encoding="utf-8",
    )
    progress_path = logs_dir / "progress_percentages.json"
    progress_path.write_text(
        """
{
  "tool": "freecad-create-assembly",
  "updated_at": "2026-01-01T00:00:00Z",
  "success": false,
  "progress_percentages": {
    "layout_completion_percent": 100.0,
    "modeling_percent": 50.0,
    "export_file_percent": 0.0
  },
  "output_files": {
    "step": {
      "path": "%s",
      "exists": false
    }
  },
  "layout_completion_percent": 100.0,
  "modeling_percent": 50.0,
  "export_file_percent": 0.0
}
"""
        % step_path,
        encoding="utf-8",
    )

    class FakeStep:
        def run(self, ctx: Any) -> Any:
            return argparse.Namespace(
                stage={"stage_name": "simulation_run", "status": "completed"},
                continue_pipeline=True,
            )

    monkeypatch.setattr(
        "codex_agents.runner.get_step_spec",
        lambda command_name: argparse.Namespace(
            command_name=command_name,
            required_stage_names=(),
            required_files=(),
            create_step=lambda: FakeStep(),
        ),
    )

    pipeline.run_bom_external_tools_pipeline(
        argparse.Namespace(
            command="simulation",
            bom_json=tmp_path / "real_bom.json",
            run_root=run_root,
            simulation_backend="mock_contract",
        )
    )

    progress = read_json(progress_path)
    layout_step = progress["steps"][0]
    geometry_step = progress["steps"][1]
    assert progress["schema_version"] == "1.0"
    assert layout_step["status"] == "completed"
    assert layout_step["percent"] == 100.0
    assert progress["output_files"]["step"]["path"] == str(step_path)
    assert progress["freecad_progress"]["tool"] == "freecad-create-assembly"
    assert geometry_step["freecad_progress"]["progress_percentages"] == {
        "layout_completion_percent": 100.0,
        "modeling_percent": 50.0,
        "export_file_percent": 0.0,
    }
    assert not (logs_dir / "freecad_progress_percentages.json").exists()


def test_progress_recovers_if_legacy_payload_overwrites_after_simulation(monkeypatch: Any, tmp_path: Path) -> None:
    run_root = tmp_path / "run"
    logs_dir = run_root / "logs"
    logs_dir.mkdir(parents=True)
    for filename, stage_name in (
        ("layout_generate_stage_result.json", "layout_generate"),
        ("geometry_validate_stage_result.json", "geometry_validate"),
        ("simulation_run_stage_result.json", "simulation_run"),
    ):
        (logs_dir / filename).write_text(
            f'{{"stage_name":"{stage_name}","status":"completed"}}',
            encoding="utf-8",
        )
    for relative_path in ("status.json", "field_samples.json", "tensors.json"):
        path = run_root / "03_simulation" / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("{}", encoding="utf-8")

    progress_path = logs_dir / "progress_percentages.json"
    progress_path.write_text(
        """
{
  "tool": "freecad-create-assembly",
  "success": true,
  "progress_percentages": {
    "layout_completion_percent": 100.0,
    "modeling_percent": 100.0,
    "export_file_percent": 100.0
  },
  "output_files": {}
}
""",
        encoding="utf-8",
    )

    class FakeStep:
        def run(self, ctx: Any) -> Any:
            running = read_json(progress_path)
            assert running["schema_version"] == "1.0"
            assert running["current_step"] == "field-export"
            assert running["steps"][3]["status"] == "running"
            assert running["steps"][3]["percent"] > 0.0
            return argparse.Namespace(
                stage={"stage_name": "field_export", "status": "completed"},
                continue_pipeline=True,
            )

    monkeypatch.setattr(
        "codex_agents.runner.get_step_spec",
        lambda command_name: argparse.Namespace(
            command_name=command_name,
            required_stage_names=("simulation_run",),
            required_files=("03_simulation/status.json", "03_simulation/field_samples.json", "03_simulation/tensors.json"),
            create_step=lambda: FakeStep(),
        ),
    )

    pipeline.run_bom_external_tools_pipeline(
        argparse.Namespace(
            command="field-export",
            bom_json=tmp_path / "real_bom.json",
            run_root=run_root,
            simulation_backend="mock_contract",
        )
    )

    progress = read_json(progress_path)
    assert progress["schema_version"] == "1.0"
    assert [step["status"] for step in progress["steps"][:4]] == ["completed", "completed", "completed", "completed"]
    assert progress["overall_percent"] == 50.0


def test_fresh_run_legacy_freecad_payload_does_not_resurrect_old_downstream_steps(
    monkeypatch: Any, tmp_path: Path
) -> None:
    run_root = tmp_path / "run"
    logs_dir = run_root / "logs"
    logs_dir.mkdir(parents=True)
    (run_root / "run_manifest.json").write_text(
        """
{
  "schema_version": "1.0",
  "ok": true,
  "stages": [
    {"stage_name": "layout_generate", "status": "completed_with_unplaced"}
  ]
}
""",
        encoding="utf-8",
    )
    for filename, stage_name in (
        ("simulation_run_stage_result.json", "simulation_run"),
        ("field_export_stage_result.json", "field_export"),
        ("postprocess_stage_result.json", "postprocess"),
    ):
        (logs_dir / filename).write_text(
            f'{{"stage_name":"{stage_name}","status":"completed"}}',
            encoding="utf-8",
        )
    progress_path = logs_dir / "progress_percentages.json"
    progress_path.write_text(
        """
{
  "tool": "freecad-create-assembly",
  "success": true,
  "progress_percentages": {
    "layout_completion_percent": 100.0,
    "modeling_percent": 100.0,
    "export_file_percent": 100.0
  },
  "output_files": {}
}
""",
        encoding="utf-8",
    )

    class FakeStep:
        def run(self, ctx: Any) -> Any:
            running = read_json(progress_path)
            assert [step["status"] for step in running["steps"][:5]] == [
                "completed",
                "completed",
                "running",
                "pending",
                "pending",
            ]
            return argparse.Namespace(
                stage={"stage_name": "simulation_run", "status": "failed"},
                continue_pipeline=False,
            )

    monkeypatch.setattr(
        "codex_agents.runner.get_step_spec",
        lambda command_name: argparse.Namespace(
            command_name=command_name,
            required_stage_names=(),
            required_files=(),
            create_step=lambda: FakeStep(),
        ),
    )

    pipeline.run_bom_external_tools_pipeline(
        argparse.Namespace(
            command="simulation",
            bom_json=tmp_path / "real_bom.json",
            run_root=run_root,
            simulation_backend="mock_contract",
        )
    )

    progress = read_json(progress_path)
    assert [step["status"] for step in progress["steps"][:5]] == [
        "completed",
        "completed",
        "failed",
        "pending",
        "pending",
    ]
    assert progress["steps"][2]["percent"] < 100.0


def test_run_all_uses_registry_order(monkeypatch: Any, tmp_path: Path) -> None:
    calls: list[str] = []

    class FakeStep:
        def __init__(self, name: str) -> None:
            self.name = name

        def run(self, ctx: Any) -> Any:
            calls.append(self.name)
            return argparse.Namespace(
                stage={"stage_name": self.name, "status": "completed"},
                continue_pipeline=True,
            )

    specs = [
        argparse.Namespace(command_name=name, create_step=lambda name=name: FakeStep(name))
        for name in (
            "layout-generate",
            "geometry-edit",
            "simulation",
            "field-export",
            "postprocess",
            "case-build",
            "analysis",
            "suggestion",
        )
    ]
    monkeypatch.setattr("codex_agents.runner.default_step_specs", lambda: specs)

    manifest = pipeline.run_bom_external_tools_pipeline(
        argparse.Namespace(
            command="run-all",
            bom_json=tmp_path / "real_bom.json",
            run_root=tmp_path / "run",
            simulation_backend="mock_contract",
        )
    )

    assert calls == [spec.command_name for spec in specs]
    assert [stage["stage_name"] for stage in manifest["stages"]] == calls


def test_single_step_dispatch_runs_only_requested_step(monkeypatch: Any, tmp_path: Path) -> None:
    calls: list[str] = []

    def fake_simulation(*args: Any, **kwargs: Any) -> _FakeStageResult:
        calls.append("simulation")
        return _FakeStageResult("simulation_run")

    monkeypatch.setattr(dependencies, "run_simulation", fake_simulation)
    run_root = tmp_path / "run"
    edit_dir = run_root / "02_geometry_edit"
    edit_dir.mkdir(parents=True)
    for relative_path in (
        "geometry_after.step",
        "geometry_after.geom.json",
        "geometry_after.layout_topology.json",
        "geometry_after_registry.json",
        "sample.yaml",
        "simulation_input.json",
        "comsol_inputs/coord.txt",
        "comsol_inputs/channels_input.npz",
    ):
        path = edit_dir / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("{}", encoding="utf-8")
    (run_root / "logs").mkdir()
    (run_root / "logs" / "geometry_validate_stage_result.json").write_text(
        '{"stage_name":"geometry_validate","status":"completed"}',
        encoding="utf-8",
    )

    manifest = pipeline.run_bom_external_tools_pipeline(
        argparse.Namespace(
            command="simulation",
            bom_json=tmp_path / "real_bom.json",
            run_root=run_root,
            simulation_backend="mock_contract",
            skip_postprocess=False,
        )
    )

    assert calls == ["simulation"]
    assert [stage["stage_name"] for stage in manifest["stages"]] == ["geometry_validate", "simulation_run"]


def test_single_step_reports_missing_prerequisites(tmp_path: Path) -> None:
    try:
        pipeline.run_bom_external_tools_pipeline(
            argparse.Namespace(
                command="geometry-edit",
                bom_json=tmp_path / "real_bom.json",
                run_root=tmp_path / "run",
                simulation_backend="mock_contract",
            )
        )
    except RuntimeError as exc:
        message = str(exc)
    else:
        raise AssertionError("expected missing prerequisite error")

    assert "cannot run geometry-edit" in message
    assert "layout_generate" in message
    assert "logs/layout_generate_raw_result.json" in message
    progress = read_json(tmp_path / "run" / "logs" / "progress_percentages.json")
    geometry_step = progress["steps"][1]
    assert geometry_step["command_name"] == "geometry-edit"
    assert geometry_step["status"] == "blocked"
    assert progress["error"] == message


def test_simulation_reports_missing_after_state_files(tmp_path: Path) -> None:
    run_root = tmp_path / "run"
    logs_dir = run_root / "logs"
    logs_dir.mkdir(parents=True)
    (logs_dir / "geometry_validate_stage_result.json").write_text(
        '{"stage_name":"geometry_validate","status":"completed"}',
        encoding="utf-8",
    )

    with pytest.raises(RuntimeError) as exc_info:
        pipeline.run_bom_external_tools_pipeline(
            argparse.Namespace(
                command="simulation",
                bom_json=tmp_path / "real_bom.json",
                run_root=run_root,
                simulation_backend="mock_contract",
            )
        )

    message = str(exc_info.value)
    assert "cannot run simulation" in message
    assert "02_geometry_edit/geometry_after.step" in message


def test_geometry_edit_recovers_raw_layout_result(monkeypatch: Any, tmp_path: Path) -> None:
    captured: dict[str, Any] = {}
    run_root = tmp_path / "run"
    logs_dir = run_root / "logs"
    logs_dir.mkdir(parents=True)
    (logs_dir / "layout_generate_stage_result.json").write_text(
        '{"stage_name":"layout_generate","status":"completed"}',
        encoding="utf-8",
    )
    raw_layout = {
        "ok": True,
        "bom": "bom.json",
        "run_dir": str(run_root),
        "layout_dir": str(run_root / "01_layout"),
        "component_info_dir": str(run_root / "component_info"),
        "stats": {"n_unplaced": 0},
        "raw_only": "needed by geometry edit",
    }
    (logs_dir / "layout_generate_raw_result.json").write_text(
        '{"ok":true,"bom":"bom.json","run_dir":"%s","layout_dir":"%s","component_info_dir":"%s","stats":{"n_unplaced":0},"raw_only":"needed by geometry edit"}'
        % (run_root, run_root / "01_layout", run_root / "component_info"),
        encoding="utf-8",
    )

    def fake_geometry(**kwargs: Any) -> dict[str, Any]:
        captured.update(kwargs)
        return {
            "ok": True,
            "run_dir": str(kwargs["run_dir"]),
            "geometry_edit_dir": str(Path(kwargs["run_dir"]) / kwargs["output_dir_name"]),
        }

    monkeypatch.setattr(dependencies, "_run_one_geometry_edit_loop_test", fake_geometry)

    manifest = pipeline.run_bom_external_tools_pipeline(
        argparse.Namespace(
            command="geometry-edit",
            bom_json=tmp_path / "real_bom.json",
            run_root=run_root,
            simulation_backend="mock_contract",
        )
    )

    assert captured["layout_result"] == raw_layout
    assert [stage["stage_name"] for stage in manifest["stages"]] == ["layout_generate", "geometry_validate"]


def test_single_step_updates_existing_manifest_without_dropping_other_stages(monkeypatch: Any, tmp_path: Path) -> None:
    run_root = tmp_path / "run"
    logs_dir = run_root / "logs"
    logs_dir.mkdir(parents=True)
    (run_root / "run_manifest.json").write_text(
        '{"schema_version":"1.0","ok":true,"run_root":"%s","stage_dirs":{},"stages":[{"stage_name":"layout_generate","status":"completed"},{"stage_name":"old_stage","status":"completed"}]}'
        % run_root,
        encoding="utf-8",
    )
    (logs_dir / "layout_generate_raw_result.json").write_text(
        '{"ok":true,"bom":"bom.json","run_dir":"%s","layout_dir":"%s","component_info_dir":"%s","stats":{"n_unplaced":0}}'
        % (run_root, run_root / "01_layout", run_root / "component_info"),
        encoding="utf-8",
    )

    monkeypatch.setattr(
        dependencies,
        "_run_one_geometry_edit_loop_test",
        lambda **kwargs: {
            "ok": True,
            "run_dir": str(kwargs["run_dir"]),
            "geometry_edit_dir": str(Path(kwargs["run_dir"]) / kwargs["output_dir_name"]),
        },
    )

    manifest = pipeline.run_bom_external_tools_pipeline(
        argparse.Namespace(
            command="geometry-edit",
            bom_json=tmp_path / "real_bom.json",
            run_root=run_root,
            simulation_backend="mock_contract",
        )
    )

    assert [stage["stage_name"] for stage in manifest["stages"]] == [
        "layout_generate",
        "old_stage",
        "geometry_validate",
    ]


def test_context_recovers_legacy_raw_geometry_log(tmp_path: Path) -> None:
    config = pipeline.BomExternalToolsPipelineConfig(
        bom_json=tmp_path / "real_bom.json",
        run_root=tmp_path / "run",
        simulation_backend="mock_contract",
    )
    logs_dir = config.run_root / "logs"
    logs_dir.mkdir(parents=True)
    (logs_dir / "geometry_validate_stage_result.json").write_text(
        '{"ok":true,"run_dir":"%s","geometry_edit_dir":"%s","warnings":[],"errors":[]}'
        % (config.run_root, config.run_root / "02_geometry_edit"),
        encoding="utf-8",
    )

    ctx = pipeline.BomExternalToolsPipelineContext(config)

    assert [stage["stage_name"] for stage in ctx.stages] == ["geometry_validate"]
    assert ctx.stages[0]["status"] == "completed"


def test_bom_component_info_is_written_to_inputs(monkeypatch: Any, tmp_path: Path) -> None:
    input_dir = tmp_path / "00_inputs"
    layout_dir = tmp_path / "01_layout"
    component_info_dir = tmp_path / "component_info"
    input_dir.mkdir()
    layout_dir.mkdir()
    (input_dir / "real_bom.json").write_text("{}", encoding="utf-8")
    (layout_dir / "geom.json").write_text("{}", encoding="utf-8")
    (layout_dir / "geometry_registry.json").write_text("{}", encoding="utf-8")

    writes: list[Path] = []

    def fake_bom_info(**kwargs: Any) -> None:
        writes.append(Path(kwargs["output_path"]))

    def fake_layout_info(**kwargs: Any) -> None:
        writes.append(Path(kwargs["output_path"]))

    monkeypatch.setattr("apps.main_loop.layout_materialize.query_bom_component_info", fake_bom_info)
    monkeypatch.setattr("apps.main_loop.layout_materialize.query_layout_component_info", fake_layout_info)

    write_component_info_outputs(input_dir, layout_dir, component_info_dir, tmp_path / "thermal_db.json")

    assert input_dir / "bom_component_info.json" in writes
    assert component_info_dir / "bom_component_info.json" not in writes
    assert component_info_dir / "geom_component_info.json" in writes
    assert component_info_dir / "geometry_registry_component_info.json" in writes


def test_cli_missing_prerequisite_returns_clear_error(tmp_path: Path, capsys: Any) -> None:
    with pytest.raises(SystemExit) as exc_info:
        main(
            [
                "step",
                "geometry-edit",
                "--bom-json",
                str(tmp_path / "real_bom.json"),
                "--workspace-dir",
                str(tmp_path / "run"),
            ]
        )

    captured = capsys.readouterr()
    assert exc_info.value.code == 2
    assert "cannot run geometry-edit" in captured.err


def test_cli_legacy_single_step_still_dispatches(tmp_path: Path, capsys: Any) -> None:
    with pytest.raises(SystemExit) as exc_info:
        main(
            [
                "geometry-edit",
                "--bom-json",
                str(tmp_path / "real_bom.json"),
                "--workspace-dir",
                str(tmp_path / "run"),
            ]
        )

    captured = capsys.readouterr()
    assert exc_info.value.code == 2
    assert "cannot run geometry-edit" in captured.err


def test_cli_doctor_json_reports_steps(capsys: Any) -> None:
    assert main(["--json", "doctor"]) == 0

    captured = capsys.readouterr()
    payload = json.loads(captured.out)
    assert payload["ok"] is True
    assert payload["tool"] == "cad-sim-pipeline"
    assert "geometry-edit" in payload["steps"]
    assert payload["freecad_cli"]["required_for_geometry_edit"] is True
    assert "freecad-create-assembly" in payload["freecad_cli"]["commands"]
    assert payload["freecad_cli"]["handoff"]["skill"] == "freecad"
    assert payload["auth"]["required"] is False


def test_cli_doctor_prefers_workspace_dir_for_default_workspace(
    capsys: Any, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    workspace = tmp_path / "workspace"
    monkeypatch.setenv("WORKSPACE_DIR", str(workspace))

    assert main(["--json", "doctor"]) == 0

    captured = capsys.readouterr()
    payload = json.loads(captured.out)
    assert payload["paths"]["default_workspace_dir"] == str(workspace)
    assert payload["environment"]["workspace_dir_source"] == "WORKSPACE_DIR"


def test_cli_steps_list_json(capsys: Any) -> None:
    assert main(["--json", "steps", "list"]) == 0

    captured = capsys.readouterr()
    payload = json.loads(captured.out)
    assert payload["ok"] is True
    assert payload["steps"][0]["name"] == "layout-generate"


def test_run_pipeline_shell_preserves_legacy_option_only_form(tmp_path: Path) -> None:
    result = subprocess.run(
        [
            "bash",
            "-n",
            "codex_agents/run_pipeline.sh",
        ],
        cwd=Path(__file__).resolve().parents[2],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0


def test_run_pipeline_shell_filters_connect_existing_mphserver_by_default(tmp_path: Path) -> None:
    fake_python = tmp_path / "python"
    args_file = tmp_path / "args.txt"
    fake_python.write_text(
        "#!/usr/bin/env bash\n"
        "printf '%s\\n' \"$@\" > \"$CAPTURE_ARGS\"\n",
        encoding="utf-8",
    )
    fake_python.chmod(0o755)

    result = subprocess.run(
        [
            "codex_agents/run_pipeline.sh",
            "--connect-existing-mphserver",
        ],
        cwd=Path(__file__).resolve().parents[2],
        env={
            **os.environ,
            "PYTHON_BIN": str(fake_python),
            "CAPTURE_ARGS": str(args_file),
            "BOM_JSON": str(tmp_path / "real_bom.json"),
            "WORKSPACE_DIR": str(tmp_path / "run"),
            "SIMULATION_BACKEND": "comsol_local",
        },
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0
    assert "ignoring --connect-existing-mphserver" in result.stderr
    assert "--connect-existing-mphserver" not in args_file.read_text(encoding="utf-8")


def test_run_pipeline_shell_allows_connect_existing_mphserver_when_enabled(tmp_path: Path) -> None:
    fake_python = tmp_path / "python"
    args_file = tmp_path / "args.txt"
    fake_python.write_text(
        "#!/usr/bin/env bash\n"
        "printf '%s\\n' \"$@\" > \"$CAPTURE_ARGS\"\n",
        encoding="utf-8",
    )
    fake_python.chmod(0o755)

    result = subprocess.run(
        [
            "codex_agents/run_pipeline.sh",
            "--connect-existing-mphserver",
        ],
        cwd=Path(__file__).resolve().parents[2],
        env={
            **os.environ,
            "PYTHON_BIN": str(fake_python),
            "CAPTURE_ARGS": str(args_file),
            "CONNECT_EXISTING_MPHSERVER": "1",
            "BOM_JSON": str(tmp_path / "real_bom.json"),
            "WORKSPACE_DIR": str(tmp_path / "run"),
            "SIMULATION_BACKEND": "comsol_local",
        },
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0
    assert "--connect-existing-mphserver" in args_file.read_text(encoding="utf-8")


def test_geometry_edit_syncs_simulation_input_from_after_registry(tmp_path: Path) -> None:
    module_path = Path(__file__).resolve().parents[2] / (
        "codex_agents/vendor/geometry_edit_runtime/geometry_edit/freecad_skill_cli.py"
    )
    spec = importlib.util.spec_from_file_location("freecad_skill_cli_under_test", module_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    edit_dir = tmp_path / "02_geometry_edit"
    edit_dir.mkdir()
    (edit_dir / "simulation_input.json").write_text(
        json.dumps(
            {
                "components": [
                    {
                        "component_id": "P017",
                        "geometry_id": "G021",
                        "bbox": {"min": [386.0, -94.0, -69.0], "max": [387.0, -93.0, 6.0]},
                    }
                ],
                "selection_plan": {
                    "component_selections": [
                        {"component_id": "P017", "step_name": "P_017_internal"}
                    ]
                },
            }
        ),
        encoding="utf-8",
    )
    after_registry = {
        "entities": [
            {
                "component_id": "P017",
                "geometry_id": "G021",
                "step_name": "P_017_internal",
                "bbox": {"min": [383.0, -94.0, -69.0], "max": [384.0, -93.0, 6.0]},
            }
        ]
    }

    module.sync_simulation_input_after_registry(edit_dir, after_registry)

    updated = json.loads((edit_dir / "simulation_input.json").read_text(encoding="utf-8"))
    assert updated["components"][0]["bbox"] == after_registry["entities"][0]["bbox"]
    assert updated["components"][0]["step_name"] == "P_017_internal"


def test_geometry_edit_syncs_sample_yaml_from_after_registry(tmp_path: Path) -> None:
    module_path = Path(__file__).resolve().parents[2] / (
        "codex_agents/vendor/geometry_edit_runtime/geometry_edit/freecad_skill_cli.py"
    )
    spec = importlib.util.spec_from_file_location("freecad_skill_cli_under_test_yaml", module_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    edit_dir = tmp_path / "02_geometry_edit"
    edit_dir.mkdir()
    (edit_dir / "sample.yaml").write_text(
        """
schema_version: '2.0'
components:
  P_024_internal:
    id: P_024_internal
    position: [-605.8106782589012, 781.7516777410988, 249.56408774109877]
    install_pos: [-605.8106782589012, 778.7516777410988, 246.56408774109877]
    mount_point: [-605.8106782589012, 813.7516777410988, 281.5640877410988]
    bbox:
      min: [-605.8106782589012, 781.7516777410988, 249.56408774109877]
      max: [-255.81067825890125, 851.7516777410988, 319.5640877410988]
""".lstrip(),
        encoding="utf-8",
    )
    after_registry = {
        "entities": [
            {
                "component_id": "P024",
                "step_name": "P_024_internal",
                "bbox": {
                    "min": [-605.8106782589012, 778.7516777410988, 249.56408774109877],
                    "max": [-255.81067825890125, 848.7516777410988, 319.5640877410988],
                },
            }
        ]
    }

    module.sync_sample_yaml_after_registry(edit_dir, after_registry)

    import yaml

    updated = yaml.safe_load((edit_dir / "sample.yaml").read_text(encoding="utf-8"))
    component = updated["components"]["P_024_internal"]
    assert component["position"] == after_registry["entities"][0]["bbox"]["min"]
    assert component["bbox"] == after_registry["entities"][0]["bbox"]
    assert component["install_pos"] == [-605.8106782589012, 775.7516777410988, 246.56408774109877]
    assert component["mount_point"] == [-605.8106782589012, 810.7516777410988, 281.5640877410988]
