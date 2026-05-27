from __future__ import annotations

import json
import math
import os
import signal
import shutil
import subprocess
import tempfile
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any, Mapping

import yaml

from core.io import read_json, write_json
from core.stages import StageResult
from formats.validators import (
    validate_simulation_input,
    validate_simulation_outputs,
    validate_simulation_payload,
)


def run_stage(
    input_dir: Path,
    output_dir: Path,
    config: Mapping[str, Any] | None = None,
) -> StageResult:
    """Prepare and run a simulation contract backend."""
    config = config or {}
    input_dir = Path(input_dir)
    output_dir = Path(output_dir)
    backend = str(config.get("execution_backend", "mock_contract"))
    layout_dir = Path(config.get("layout_dir", input_dir))
    simulation_input_path = Path(config.get("simulation_input_path", input_dir / "simulation_input.json"))
    geometry_step_path = Path(config.get("geometry_step_path", input_dir / "geometry.step"))
    result = StageResult(
        stage_name="simulation_run",
        status="running",
        inputs={
            "simulation_input": simulation_input_path,
            "geometry_step": geometry_step_path,
            "config": dict(config),
        },
        outputs={"output_dir": output_dir},
    )
    reports: dict[str, Any] = {}
    try:
        after_state_dir = _resolve_after_state_dir(layout_dir, geometry_step_path, config)
        simulation_input_path = _resolve_simulation_input_path(layout_dir, after_state_dir, config)
        result.inputs["simulation_input"] = simulation_input_path
        simulation_input = read_json(simulation_input_path)
        reports["simulation_input"] = validate_simulation_input(simulation_input, geometry_step_path).to_dict()
        if not reports["simulation_input"]["ok"]:
            return _finish_failed(result, reports)
        if backend == "comsol_local":
            return _run_comsol_local(result, input_dir, output_dir, config)

        if backend != "mock_contract":
            result.warnings.append(f"unsupported execution backend for default tests: {backend}")
            return result.finish("skipped")

        payload = build_payload(simulation_input, simulation_input_path, geometry_step_path)
        reports["payload"] = validate_simulation_payload(payload).to_dict()
        if not reports["payload"]["ok"]:
            return _finish_failed(result, reports)

        status = {
            "schema_version": "1.0",
            "ok": True,
            "backend": backend,
            "mock_only": True,
            "message": "mock contract simulation completed",
        }
        field_samples = build_mock_field_samples(simulation_input)
        tensors = build_mock_tensors(field_samples)

        output_dir.mkdir(parents=True, exist_ok=True)
        manifest = {
            "schema_version": "1.0",
            "simulation_id": "sim_mock_contract",
            "inputs": {
                "simulation_input": str(simulation_input_path),
                "step": str(geometry_step_path),
            },
            "external_tools": {
                "comsol_version": None,
                "backend": backend,
                "mock_only": True,
            },
            "outputs": {
                "status_json": "status.json",
                "field_samples_json": "field_samples.json",
                "native_vtu": "native.vtu",
                "tensors_json": "tensors.json",
                "component_face_temperature_json": "component_face_temperature.json",
            },
            "checks": {
                "status_ok": True,
            },
        }
        payload_path = write_json(output_dir / "payload.json", payload)
        manifest_path = write_json(output_dir / "simulation_manifest.json", manifest)
        status_path = write_json(output_dir / "status.json", status)
        field_samples_path = write_json(output_dir / "field_samples.json", field_samples)
        tensors_path = write_json(output_dir / "tensors.json", tensors)
        native_vtu_path = write_mock_vtu(output_dir / "native.vtu", field_samples)
        component_face_temperature_path = write_component_face_temperature(
            simulation_input=simulation_input,
            simulation_input_path=simulation_input_path,
            native_vtu_path=native_vtu_path,
            output_path=output_dir / "component_face_temperature.json",
        )

        reports["outputs"] = validate_simulation_outputs(
            status=status,
            field_samples=field_samples,
            native_vtu=native_vtu_path,
            tensors=tensors,
        ).to_dict()
        if not reports["outputs"]["ok"]:
            return _finish_failed(result, reports)
        result.outputs.update(
            {
                "simulation_manifest": manifest_path,
                "payload": payload_path,
                "status": status_path,
                "field_samples": field_samples_path,
                "native_vtu": native_vtu_path,
                "tensors": tensors_path,
                "component_face_temperature": component_face_temperature_path,
            }
        )
        result.checks = reports
        result.warnings.append("mock_contract backend does not run COMSOL")
        return result.finish("completed")
    except Exception as exc:
        result.errors.append({"type": exc.__class__.__name__, "message": str(exc)})
        return result.finish("failed")


def build_payload(
    simulation_input: Mapping[str, Any],
    simulation_input_path: Path,
    geometry_step_path: Path,
) -> dict[str, Any]:
    heat_sources = [
        {
            "component_id": component["component_id"],
            "selection_id": f"sel_{component['component_id']}",
            "power_W": component["power_W"],
        }
        for component in simulation_input["components"]
        if component.get("is_heat_source")
    ]
    return {
        "schema_version": "1.0",
        "payload_id": "payload_mock_contract",
        "inputs": {
            "simulation_input": str(simulation_input_path),
            "geometry_step": str(geometry_step_path),
        },
        "units": simulation_input["units"],
        "selection_plan": simulation_input["selection_plan"],
        "heat_sources": heat_sources,
        "materials": [
            {
                "component_id": component["component_id"],
                "material_id": component["material_id"],
            }
            for component in simulation_input["components"]
        ],
        "thermal_interfaces": [
            {
                "component_id": component["component_id"],
                "component_mount_face_id": component["component_mount_face_id"],
                "mount_face_id": component["mount_face_id"],
                "contact_resistance": component["contact_resistance"],
            }
            for component in simulation_input["components"]
        ],
    }


def _run_comsol_local(
    result: StageResult,
    input_dir: Path,
    output_dir: Path,
    config: Mapping[str, Any],
) -> StageResult:
    output_dir = Path(output_dir).resolve()
    layout_dir = Path(config.get("layout_dir", input_dir)).resolve()
    geometry_step_path = Path(config.get("geometry_step_path", layout_dir / "geometry.step")).resolve()
    after_state_dir = _resolve_after_state_dir(layout_dir, geometry_step_path, config)
    simulation_input_path = _resolve_simulation_input_path(layout_dir, after_state_dir, config)
    simulation_input = read_json(simulation_input_path)
    reports: dict[str, Any] = {}
    reports["simulation_input"] = validate_simulation_input(simulation_input, geometry_step_path).to_dict()
    if not reports["simulation_input"]["ok"]:
        return _finish_failed(result, reports)

    output_dir.mkdir(parents=True, exist_ok=True)
    work_dir = output_dir / "_comsol_work"
    sample_yaml_path = Path(config["sample_yaml_path"]).resolve() if config.get("sample_yaml_path") else None
    _prepare_comsol_work_dir(
        layout_dir,
        geometry_step_path,
        work_dir,
        after_state_dir=after_state_dir,
        sample_yaml_path=sample_yaml_path,
    )

    thermal_cfg = _read_yaml(Path(config["thermal_sim_config"]))
    connection_cfg = _read_yaml(Path(config["comsol_connection_config"]))
    comsol_runtime_root = Path(config["comsol_runtime_root"]).resolve()
    template_mph = _resolve_runtime_path(
        thermal_cfg["comsol"]["template_mph_path"],
        base=comsol_runtime_root,
    )
    export_tags = thermal_cfg["thermal_sim"].get("export_tags", [])
    export_volum_tags = thermal_cfg["thermal_sim"].get("export_volum_tags", [])
    mesh = thermal_cfg["thermal_sim"].get("mesh", {})
    boundary_conditions = thermal_cfg["thermal_sim"].get("boundary_conditions", {})
    configured_port = int(config.get("mph_port", connection_cfg["comsol"]["connection"].get("local_mph_port", 2036)) or 2036)
    mph_port = _select_mph_port(configured_port, prefer_private=True)
    payload = {
        "action": "cubesat",
        "model_file_path": str(template_mph),
        "template_mph_path": str(template_mph),
        "sample_dirs": [str(work_dir)],
        "sample_range": {"start_from": 1, "end_at": 1},
        "base_output_dir": str(output_dir),
        "comsol": {
            "export_face_tags": connection_cfg["comsol"].get("export_face_tags", []),
            "export_volum_tags": export_volum_tags,
            "field_expressions": connection_cfg["comsol"].get("field_expressions", {"temperature": "T"}),
        },
        "geometry": {
            "enable_geometry_update": True,
            "component": thermal_cfg["comsol"].get("component", "comp1"),
            "geometry": thermal_cfg["comsol"].get("geometry", "geom1"),
            "import_feature": thermal_cfg["comsol"].get("import_feature", "imp1"),
        },
        "runtime": {
            "mph_version": str(connection_cfg["comsol"]["connection"].get("local_mph_version", "6.4")),
            "mph_port": mph_port,
            "configured_mph_port": configured_port,
        },
        "extra": {
            "export_tags": export_tags,
            "postprocess": thermal_cfg["thermal_sim"].get("postprocess", {}),
            "mesh": mesh,
            "boundary_conditions": boundary_conditions,
        },
    }
    canonical_payload = build_payload(simulation_input, simulation_input_path, geometry_step_path)
    payload_path = write_json(output_dir / "payload.json", canonical_payload)
    reports["payload"] = validate_simulation_payload(canonical_payload).to_dict()
    if not reports["payload"]["ok"]:
        return _finish_failed(result, reports)

    entry_config = dict(config)
    entry_config.setdefault("runtime_home", str(output_dir / "_comsol_runtime_home"))
    execution_result = _run_comsol_entry(
        payload,
        connection_cfg["comsol"]["connection"],
        entry_config,
        status_path=work_dir / "sim" / "status.json",
        progress_path=work_dir / "sim" / "comsol_progress.json",
        workspace_dir=_workspace_dir_from_simulation_output(output_dir),
    )
    sim_src = work_dir / "sim"
    _copy_comsol_outputs(sim_src, output_dir)
    status = read_json(output_dir / "status.json")
    field_samples = _field_samples_from_data1(
        output_dir / "data1.txt",
        simulation_input,
        stride=int(config.get("field_sample_stride", 16)),
    )
    tensors = _tensor_summary(field_samples)
    write_json(output_dir / "field_samples.json", field_samples)
    write_json(output_dir / "tensors.json", tensors)
    component_face_temperature_path: Path | None = None
    interface_temperature_diagnostics_path: Path | None = None
    try:
        component_face_temperature_path = write_component_face_temperature(
            simulation_input=simulation_input,
            simulation_input_path=simulation_input_path,
            native_vtu_path=output_dir / "native.vtu",
            output_path=output_dir / "component_face_temperature.json",
        )
    except Exception as exc:
        result.warnings.append(f"failed to write component_face_temperature.json: {exc}")
    try:
        interface_temperature_diagnostics_path = write_interface_temperature_diagnostics(
            simulation_input=simulation_input,
            simulation_input_path=simulation_input_path,
            native_vtu_path=output_dir / "native.vtu",
            output_path=output_dir / "interface_temperature_diagnostics.json",
        )
    except Exception as exc:
        result.warnings.append(f"failed to write interface_temperature_diagnostics.json: {exc}")
    manifest = {
        "schema_version": "1.0",
        "simulation_id": f"sim_{output_dir.parent.name}",
        "inputs": {
            "simulation_input": str(simulation_input_path),
            "step": str(geometry_step_path),
        },
        "external_tools": {
            "backend": "comsol_local",
            "template_mph": str(template_mph),
            "entry_script": str(config.get("local_entry_script") or connection_cfg["comsol"]["connection"].get("local_entry_script")),
            "mesh": mesh,
        },
        "outputs": {
            "status_json": "status.json",
            "field_samples_json": "field_samples.json",
            "native_vtu": "native.vtu",
            "data1_txt": "data1.txt",
            "tensors_json": "tensors.json",
            "component_face_temperature_json": "component_face_temperature.json",
            "interface_temperature_diagnostics_json": "interface_temperature_diagnostics.json",
        },
        "checks": {
            "status_ok": status.get("ok") is True,
            "comsol_success": execution_result.get("success") is True,
        },
    }
    manifest_path = write_json(output_dir / "simulation_manifest.json", manifest)
    reports["outputs"] = validate_simulation_outputs(
        status=status,
        field_samples=field_samples,
        native_vtu=output_dir / "native.vtu",
        tensors=tensors,
    ).to_dict()
    if not reports["outputs"]["ok"]:
        return _finish_failed(result, reports)
    result.outputs.update(
        {
            "simulation_manifest": manifest_path,
            "payload": payload_path,
            "status": output_dir / "status.json",
            "field_samples": output_dir / "field_samples.json",
            "native_vtu": output_dir / "native.vtu",
            "tensors": output_dir / "tensors.json",
            "data1_txt": output_dir / "data1.txt",
        }
    )
    if component_face_temperature_path is not None:
        result.outputs["component_face_temperature"] = component_face_temperature_path
    if interface_temperature_diagnostics_path is not None:
        result.outputs["interface_temperature_diagnostics"] = interface_temperature_diagnostics_path
    result.checks = reports
    return result.finish("completed")


def _workspace_dir_from_simulation_output(output_dir: Path) -> Path | None:
    output_dir = Path(output_dir).resolve()
    if output_dir.name == "simulation" and output_dir.parent.name == "02_sim":
        return output_dir.parent.parent
    return None


def _resolve_after_state_dir(layout_dir: Path, geometry_step_path: Path, config: Mapping[str, Any]) -> Path:
    configured = config.get("after_state_dir")
    if configured:
        after_state_dir = Path(configured).resolve()
    else:
        geometry_step_path = geometry_step_path.resolve()
        after_state_dir = geometry_step_path.parent if geometry_step_path.name == "geometry_after.step" else layout_dir
    if after_state_dir == layout_dir:
        return layout_dir
    required = [
        after_state_dir / "geometry_after.geom.json",
        after_state_dir / "geometry_after.layout_topology.json",
        after_state_dir / "geometry_after_registry.json",
        after_state_dir / "simulation_input.json",
    ]
    sample_yaml_path = Path(config.get("sample_yaml_path", after_state_dir / "sample.yaml"))
    required.append(sample_yaml_path)
    comsol_inputs_dir = after_state_dir / "comsol_inputs"
    for name in ("coord.txt", "channels_input.npz"):
        required.append(comsol_inputs_dir / name)
    missing = [str(path) for path in required if not path.exists()]
    if missing:
        raise RuntimeError(
            "after-state simulation input is incomplete; refusing to mix geometry_after.step "
            "with 01_layout helper files. Missing: " + ", ".join(missing)
        )
    return after_state_dir


def _resolve_simulation_input_path(
    layout_dir: Path,
    after_state_dir: Path,
    config: Mapping[str, Any],
) -> Path:
    configured = config.get("simulation_input_path")
    if after_state_dir != layout_dir:
        after_simulation_input = after_state_dir / "simulation_input.json"
        if configured and Path(configured).resolve() != after_simulation_input.resolve():
            raise RuntimeError(
                "after-state geometry requires after-state simulation_input.json; "
                f"got {Path(configured).resolve()}, expected {after_simulation_input.resolve()}"
            )
        return after_simulation_input.resolve()
    return Path(configured or layout_dir / "simulation_input.json").resolve()


def _select_mph_port(preferred_port: int, *, prefer_private: bool = False) -> int:
    used_ports = _listening_tcp_ports() | _comsol_mphserver_ports_from_processes()
    if prefer_private and preferred_port < 32036:
        preferred_port = max(32036, preferred_port + 10000)
    if preferred_port not in used_ports:
        return preferred_port
    for port in range(max(1024, preferred_port + 1), 65535):
        if port not in used_ports:
            return port
    raise RuntimeError("no available TCP port found for COMSOL mphserver")


def _listening_tcp_ports() -> set[int]:
    ports: set[int] = set()
    for proc_path in (Path("/proc/net/tcp"), Path("/proc/net/tcp6")):
        try:
            lines = proc_path.read_text(encoding="utf-8").splitlines()[1:]
        except OSError:
            continue
        for line in lines:
            fields = line.split()
            if len(fields) < 4 or fields[3] != "0A":
                continue
            local_address = fields[1]
            try:
                ports.add(int(local_address.rsplit(":", 1)[1], 16))
            except (IndexError, ValueError):
                continue
    return ports


def _comsol_mphserver_ports_from_processes() -> set[int]:
    ports: set[int] = set()
    proc_root = Path("/proc")
    try:
        proc_entries = list(proc_root.iterdir())
    except OSError:
        return ports
    for entry in proc_entries:
        if not entry.name.isdigit():
            continue
        try:
            raw = (entry / "cmdline").read_bytes()
        except OSError:
            continue
        if not raw or b"mphserver" not in raw or b"comsol" not in raw:
            continue
        parts = [part.decode("utf-8", errors="ignore") for part in raw.split(b"\0") if part]
        for index, part in enumerate(parts):
            value: str | None = None
            if part == "-port" and index + 1 < len(parts):
                value = parts[index + 1]
            elif part.startswith("-port="):
                value = part.split("=", 1)[1]
            if value is None:
                continue
            try:
                ports.add(int(value.strip('"')))
            except ValueError:
                continue
    return ports


def _prepare_comsol_work_dir(
    layout_dir: Path,
    geometry_step_path: Path,
    work_dir: Path,
    *,
    after_state_dir: Path | None = None,
    sample_yaml_path: Path | None = None,
) -> None:
    if work_dir.exists():
        shutil.rmtree(work_dir)
    (work_dir / "geom").mkdir(parents=True, exist_ok=True)
    (work_dir / "inputs").mkdir(parents=True, exist_ok=True)
    shutil.copy2(geometry_step_path, work_dir / "geom" / "geometry.step")
    after_state_dir = after_state_dir or layout_dir
    if after_state_dir != layout_dir:
        geom_source = after_state_dir / "geometry_after.geom.json"
        sample_source = sample_yaml_path or after_state_dir / "sample.yaml"
        comsol_inputs_dir = after_state_dir / "comsol_inputs"
    else:
        geom_source = layout_dir / "geom.json"
        sample_source = sample_yaml_path or layout_dir / "sample.yaml"
        comsol_inputs_dir = layout_dir / "comsol_inputs"
    shutil.copy2(geom_source, work_dir / "geom" / "geom.json")
    shutil.copy2(sample_source, work_dir / "sample.yaml")
    for name in ("coord.txt", "channels_input.npz"):
        src = comsol_inputs_dir / name
        if src.exists():
            shutil.copy2(src, work_dir / "inputs" / name)


def _run_comsol_entry(
    payload: Mapping[str, Any],
    connection: Mapping[str, Any],
    config: Mapping[str, Any],
    *,
    status_path: Path | None = None,
    progress_path: Path | None = None,
    workspace_dir: Path | None = None,
) -> dict[str, Any]:
    local_python = str(connection.get("local_python", "/data/conda/envs/autoflowsim-comsol/bin/python"))
    comsol_runtime_root = Path(config.get("comsol_runtime_root", Path.cwd())).resolve()
    entry_script = _resolve_runtime_path(
        config.get("local_entry_script") or connection.get("local_entry_script"),
        base=comsol_runtime_root,
    )
    env = os.environ.copy()
    comsol_home = str(connection.get("local_comsol_home", "/usr/local/comsol64/multiphysics"))
    env["COMSOL_HOME"] = comsol_home
    env["PATH"] = f"{comsol_home}/bin:{env.get('PATH', '')}"
    env["PYTHONPATH"] = f"{comsol_runtime_root}:{env.get('PYTHONPATH', '')}"
    runtime_home = Path(str(config.get("runtime_home", "/tmp/cad2comsol_runtime/comsol_home")))
    runtime_home.mkdir(parents=True, exist_ok=True)
    (runtime_home / ".comsol").mkdir(parents=True, exist_ok=True)
    env["HOME"] = str(runtime_home)
    env["XDG_CONFIG_HOME"] = str(runtime_home / ".config")
    env["XDG_CACHE_HOME"] = str(runtime_home / ".cache")
    env["COMSOL_USER_HOME"] = str(runtime_home)
    user_home_option = f"-Duser.home={runtime_home}"
    java_tool_options = env.get("JAVA_TOOL_OPTIONS", "")
    env["JAVA_TOOL_OPTIONS"] = (
        f"{java_tool_options} {user_home_option}".strip()
        if user_home_option not in java_tool_options
        else java_tool_options
    )
    timeout = int(connection.get("local_timeout_seconds", config.get("timeout_seconds", 900)) or 0)
    with tempfile.TemporaryDirectory(prefix="reconstruct_comsol_") as temp_dir:
        temp_path = Path(temp_dir)
        payload_path = temp_path / "payload.json"
        result_path = temp_path / "result.json"
        payload_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        process = subprocess.Popen(
            [local_python, str(entry_script), "--payload", str(payload_path), "--result", str(result_path)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=env,
            start_new_session=True,
        )
        try:
            stdout, stderr = _communicate_with_progress(
                process,
                timeout_seconds=timeout if timeout > 0 else None,
                status_path=status_path,
                progress_path=progress_path,
                workspace_dir=workspace_dir,
            )
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                stdout, stderr = process.communicate(timeout=30)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                stdout, stderr = process.communicate()
            raise RuntimeError(f"COMSOL timed out after {timeout}s\n{stdout}\n{stderr}")
        if process.returncode != 0:
            raise RuntimeError(stderr.strip() or stdout.strip())
        if not result_path.exists():
            raise RuntimeError(f"COMSOL entry did not write result.json\n{stdout}\n{stderr}")
        result = json.loads(result_path.read_text(encoding="utf-8"))
        if not result.get("success"):
            raise RuntimeError(json.dumps(result, ensure_ascii=False))
        return result


def _communicate_with_progress(
    process: subprocess.Popen[str],
    *,
    timeout_seconds: int | None,
    status_path: Path | None,
    progress_path: Path | None,
    workspace_dir: Path | None,
) -> tuple[str, str]:
    deadline = time.monotonic() + timeout_seconds if timeout_seconds else None
    last_marker: str | None = None
    while True:
        if deadline is not None and time.monotonic() >= deadline:
            raise subprocess.TimeoutExpired(process.args, timeout_seconds)
        last_marker = _sync_comsol_progress_to_workspace(status_path, progress_path, workspace_dir, last_marker)
        try:
            stdout, stderr = process.communicate(timeout=1.0)
        except subprocess.TimeoutExpired:
            continue
        _sync_comsol_progress_to_workspace(status_path, progress_path, workspace_dir, last_marker)
        return stdout, stderr


def _sync_comsol_progress_to_workspace(
    status_path: Path | None,
    progress_path: Path | None,
    workspace_dir: Path | None,
    last_marker: str | None,
) -> str | None:
    if progress_path is None or not progress_path.exists():
        return last_marker
    try:
        from comsol_progress import normalize_comsol_progress

        progress = normalize_comsol_progress(status_path=status_path, progress_path=progress_path)
    except Exception:
        return last_marker
    stage = str(progress.get("stage") or "")
    if not stage:
        return last_marker
    mapped_percent = round(max(0.0, min(100.0, float(progress.get("percent") or 0.0))) * 0.7, 2)
    marker = json.dumps(
        {
            "stage": stage,
            "percent": progress.get("percent"),
            "mapped_percent": mapped_percent,
            "updated_at": progress.get("updated_at"),
            "heartbeat_at": progress.get("heartbeat_at"),
        },
        sort_keys=True,
    )
    if marker == last_marker:
        return last_marker
    _write_workspace_simulation_progress(workspace_dir, percentage=mapped_percent)
    return marker


def _write_workspace_simulation_progress(workspace_dir: Path | None, *, percentage: float) -> None:
    if workspace_dir is None:
        return
    try:
        from sim_cli_tools.progress import write_loop_progress

        write_loop_progress(
            workspace_dir,
            loop_name="simulation",
            status="simulation_running",
            completed=False,
            percentage=percentage,
        )
    except Exception:
        return


def _copy_comsol_outputs(sim_src: Path, output_dir: Path) -> None:
    for name in ("data1.txt", "status.json", "work.mph"):
        src = sim_src / name
        if src.exists():
            shutil.copy2(src, output_dir / name)
    vtu_src = sim_src / "native.vtu"
    if not vtu_src.exists():
        vtu_src = sim_src / "native_volum_data.vtu"
    if vtu_src.exists():
        shutil.copy2(vtu_src, output_dir / "native.vtu")


def _field_samples_from_data1(data1: Path, simulation_input: Mapping[str, Any], *, stride: int) -> dict[str, Any]:
    default_component = simulation_input["components"][0]["component_id"]
    samples = []
    with data1.open("r", encoding="utf-8", errors="ignore") as handle:
        for line_index, line in enumerate(handle):
            if line.startswith("%") or not line.strip():
                continue
            if line_index % max(stride, 1) != 0:
                continue
            parts = [part.strip() for part in line.split(",")]
            if len(parts) < 4:
                continue
            try:
                x, y, z, temperature = (float(parts[0]), float(parts[1]), float(parts[2]), float(parts[3]))
            except ValueError:
                continue
            if not all(math.isfinite(value) for value in (x, y, z, temperature)):
                continue
            samples.append(
                {
                    "sample_id": f"S{len(samples):06d}",
                    "component_id": default_component,
                    "xyz_m": [x, y, z],
                    "temperature_K": temperature,
                }
            )
    return {
        "schema_version": "1.0",
        "units": {"length": "m", "temperature": "K"},
        "samples": samples,
    }


def _tensor_summary(field_samples: Mapping[str, Any]) -> dict[str, Any]:
    temperatures = [
        float(sample["temperature_K"])
        for sample in field_samples.get("samples", [])
        if math.isfinite(float(sample["temperature_K"]))
    ]
    return {
        "schema_version": "1.0",
        "summary": {
            "temperature_min_K": min(temperatures),
            "temperature_max_K": max(temperatures),
            "temperature_mean_K": round(sum(temperatures) / len(temperatures), 6),
            "sample_count": len(temperatures),
        },
    }


def write_component_face_temperature(
    *,
    simulation_input: Mapping[str, Any],
    simulation_input_path: Path,
    native_vtu_path: Path,
    output_path: Path,
    temperature_array: str | None = None,
    plane_tolerance_m: float = 1e-6,
    range_tolerance_m: float = 1e-6,
) -> Path:
    points, temperatures, resolved_array = _read_ascii_vtu_points_and_temperature(
        native_vtu_path,
        preferred_array=temperature_array,
    )
    components = []
    bbox_ranges: list[tuple[list[float], list[float]]] = []
    for component in simulation_input.get("components", []):
        if not isinstance(component, Mapping):
            continue
        bbox = component.get("bbox")
        if not isinstance(bbox, Mapping):
            continue
        bbox_min = [float(value) / 1000.0 for value in bbox.get("min", [])]
        bbox_max = [float(value) / 1000.0 for value in bbox.get("max", [])]
        if len(bbox_min) != 3 or len(bbox_max) != 3:
            continue
        bbox_ranges.append((bbox_min, bbox_max))
    coordinate_scale = _infer_vtu_coordinate_scale_to_m(points, bbox_ranges)
    if coordinate_scale != 1.0:
        points = [
            (point[0] * coordinate_scale, point[1] * coordinate_scale, point[2] * coordinate_scale)
            for point in points
        ]
    for component in simulation_input.get("components", []):
        if not isinstance(component, Mapping):
            continue
        bbox = component.get("bbox")
        if not isinstance(bbox, Mapping):
            continue
        bbox_min = [float(value) / 1000.0 for value in bbox.get("min", [])]
        bbox_max = [float(value) / 1000.0 for value in bbox.get("max", [])]
        if len(bbox_min) != 3 or len(bbox_max) != 3:
            continue
        components.append(
            {
                "component_id": component.get("component_id"),
                "semantic_name": component.get("semantic_name"),
                "kind": component.get("kind"),
                "category": component.get("category"),
                "bbox_m": {"min": bbox_min, "max": bbox_max},
                "faces": _component_face_temperature_stats(
                    points,
                    temperatures,
                    bbox_min=bbox_min,
                    bbox_max=bbox_max,
                    plane_tolerance_m=plane_tolerance_m,
                    range_tolerance_m=range_tolerance_m,
                ),
            }
        )
    payload = {
        "schema_version": "1.0",
        "source": {
            "simulation_input": str(simulation_input_path),
            "native_vtu": str(native_vtu_path),
            "temperature_array": resolved_array,
        },
        "method": {
            "description": "Average native VTU point temperatures for points lying on each component bbox face plane and inside the other two bbox ranges.",
            "bbox_units_in_simulation_input": "mm",
            "coordinate_units": "m",
            "temperature_units": "K",
            "vtu_coordinate_scale_to_m": coordinate_scale,
            "plane_tolerance_m": plane_tolerance_m,
            "range_tolerance_m": range_tolerance_m,
        },
        "native_vtu_finite_point_count": len(points),
        "components": components,
    }
    return write_json(output_path, payload)


def write_interface_temperature_diagnostics(
    *,
    simulation_input: Mapping[str, Any],
    simulation_input_path: Path,
    native_vtu_path: Path,
    output_path: Path,
    temperature_array: str | None = None,
    offset_m: float = 0.003,
    in_plane_padding_m: float = 0.002,
) -> Path:
    points, temperatures, resolved_array = _read_ascii_vtu_points_and_temperature(
        native_vtu_path,
        preferred_array=temperature_array,
    )
    bbox_ranges: list[tuple[list[float], list[float]]] = []
    for component in simulation_input.get("components", []):
        if not isinstance(component, Mapping):
            continue
        bbox = component.get("bbox")
        if not isinstance(bbox, Mapping):
            continue
        bbox_min = [float(value) / 1000.0 for value in bbox.get("min", [])]
        bbox_max = [float(value) / 1000.0 for value in bbox.get("max", [])]
        if len(bbox_min) == 3 and len(bbox_max) == 3:
            bbox_ranges.append((bbox_min, bbox_max))
    coordinate_scale = _infer_vtu_coordinate_scale_to_m(points, bbox_ranges)
    if coordinate_scale != 1.0:
        points = [
            (point[0] * coordinate_scale, point[1] * coordinate_scale, point[2] * coordinate_scale)
            for point in points
        ]

    install_faces = {}
    raw_install_faces = simulation_input.get("install_faces", [])
    if isinstance(raw_install_faces, Mapping):
        install_faces = {
            str(face_id): face
            for face_id, face in raw_install_faces.items()
            if isinstance(face, Mapping)
        }
    else:
        install_faces = {
            str(face.get("id") or face.get("face_id")): face
            for face in raw_install_faces
            if isinstance(face, Mapping) and (face.get("id") is not None or face.get("face_id") is not None)
        }
    components = []
    for component in simulation_input.get("components", []):
        if not isinstance(component, Mapping):
            continue
        bbox = component.get("bbox")
        if not isinstance(bbox, Mapping):
            continue
        bbox_min = [float(value) / 1000.0 for value in bbox.get("min", [])]
        bbox_max = [float(value) / 1000.0 for value in bbox.get("max", [])]
        if len(bbox_min) != 3 or len(bbox_max) != 3:
            continue
        mount_face = install_faces.get(str(component.get("mount_face_id")))
        if not mount_face:
            continue
        axis = int(mount_face["plane_axis"])
        plane_m = float(mount_face["plane_value"]) / 1000.0
        normal_sign = int(mount_face.get("normal_sign", 1))
        in_plane_axes = [item for item in (0, 1, 2) if item != axis]
        component_side_m = plane_m + normal_sign * offset_m
        shell_side_m = plane_m - normal_sign * offset_m
        components.append(
            {
                "component_id": component.get("component_id"),
                "kind": component.get("kind"),
                "category": component.get("category"),
                "mount_face_id": component.get("mount_face_id"),
                "axis": ("x", "y", "z")[axis],
                "plane_m": plane_m,
                "normal_sign": normal_sign,
                "offset_m": offset_m,
                "component_side": _nearest_temperature_in_interface_patch(
                    points,
                    temperatures,
                    axis=axis,
                    plane_m=component_side_m,
                    in_plane_axes=in_plane_axes,
                    bbox_min=bbox_min,
                    bbox_max=bbox_max,
                    in_plane_padding_m=in_plane_padding_m,
                ),
                "shell_side": _nearest_temperature_in_interface_patch(
                    points,
                    temperatures,
                    axis=axis,
                    plane_m=shell_side_m,
                    in_plane_axes=in_plane_axes,
                    bbox_min=bbox_min,
                    bbox_max=bbox_max,
                    in_plane_padding_m=in_plane_padding_m,
                ),
            }
        )

    payload = {
        "schema_version": "1.0",
        "source": {
            "simulation_input": str(simulation_input_path),
            "native_vtu": str(native_vtu_path),
            "temperature_array": resolved_array,
        },
        "method": {
            "description": "Nearest VTU point temperatures in each component mount patch, sampled on both sides of the installation plane.",
            "coordinate_units": "m",
            "temperature_units": "K",
            "vtu_coordinate_scale_to_m": coordinate_scale,
            "offset_m": offset_m,
            "in_plane_padding_m": in_plane_padding_m,
        },
        "components": components,
    }
    return write_json(output_path, payload)


def _nearest_temperature_in_interface_patch(
    points: list[tuple[float, float, float]],
    temperatures: list[float],
    *,
    axis: int,
    plane_m: float,
    in_plane_axes: list[int],
    bbox_min: list[float],
    bbox_max: list[float],
    in_plane_padding_m: float,
) -> dict[str, Any]:
    candidates: list[tuple[float, float]] = []
    for point, temperature in zip(points, temperatures):
        if all(
            bbox_min[other_axis] - in_plane_padding_m
            <= point[other_axis]
            <= bbox_max[other_axis] + in_plane_padding_m
            for other_axis in in_plane_axes
        ):
            candidates.append((abs(point[axis] - plane_m), temperature))
    if not candidates:
        return {"sample_count": 0, "nearest_distance_m": None, "temperature_K": None}
    distance, temperature = min(candidates, key=lambda item: item[0])
    nearby = [value for dist, value in candidates if dist <= distance + 1e-9]
    return {
        "sample_count": len(candidates),
        "nearest_distance_m": distance,
        "temperature_K": sum(nearby) / len(nearby),
        "nearest_point_count": len(nearby),
    }


def _read_ascii_vtu_points_and_temperature(
    native_vtu_path: Path,
    *,
    preferred_array: str | None,
) -> tuple[list[tuple[float, float, float]], list[float], str]:
    root = ET.parse(native_vtu_path).getroot()
    piece = root.find(".//Piece")
    if piece is None:
        raise ValueError(f"{native_vtu_path} does not contain a VTU Piece")
    points_node = piece.find("./Points/DataArray")
    if points_node is None:
        raise ValueError(f"{native_vtu_path} does not contain point coordinates")
    point_values = _parse_ascii_float_values(points_node)
    if len(point_values) % 3 != 0:
        raise ValueError(f"{native_vtu_path} point coordinate count is not divisible by 3")
    points_all = [
        (point_values[index], point_values[index + 1], point_values[index + 2])
        for index in range(0, len(point_values), 3)
    ]
    temperature_node = _select_temperature_data_array(piece, preferred_array)
    temperature_name = temperature_node.get("Name") or preferred_array or "temperature"
    temperatures_all = _parse_ascii_float_values(temperature_node)
    if len(temperatures_all) != len(points_all):
        raise ValueError(
            f"{native_vtu_path} temperature count ({len(temperatures_all)}) does not match point count ({len(points_all)})"
        )
    points: list[tuple[float, float, float]] = []
    temperatures: list[float] = []
    for point, temperature in zip(points_all, temperatures_all):
        if math.isfinite(temperature) and all(math.isfinite(value) for value in point):
            points.append(point)
            temperatures.append(temperature)
    return points, temperatures, temperature_name


def _infer_vtu_coordinate_scale_to_m(
    points: list[tuple[float, float, float]],
    bbox_ranges: list[tuple[list[float], list[float]]],
) -> float:
    if not points or not bbox_ranges:
        return 1.0
    point_max_abs = max(abs(value) for point in points for value in point)
    bbox_max_abs = max(abs(value) for bbox_min, bbox_max in bbox_ranges for value in (*bbox_min, *bbox_max))
    if point_max_abs > 10.0 and bbox_max_abs < 10.0:
        return 0.001
    return 1.0


def _select_temperature_data_array(piece: ET.Element, preferred_array: str | None) -> ET.Element:
    arrays = list(piece.findall("./PointData/DataArray"))
    if not arrays:
        raise ValueError("native VTU does not contain PointData arrays")
    if preferred_array:
        for array in arrays:
            if array.get("Name") == preferred_array:
                return array
        raise ValueError(f"native VTU does not contain requested temperature array {preferred_array!r}")
    for name in ("Color", "T", "temperature", "Temperature"):
        for array in arrays:
            if array.get("Name") == name:
                return array
    return arrays[0]


def _parse_ascii_float_values(data_array: ET.Element) -> list[float]:
    data_format = (data_array.get("format") or data_array.get("Format") or "ascii").lower()
    if data_format != "ascii":
        raise ValueError("only ascii VTU DataArray values are supported for component_face_temperature.json")
    text = data_array.text or ""
    return [float(token) for token in text.split()]


def _component_face_temperature_stats(
    points: list[tuple[float, float, float]],
    temperatures: list[float],
    *,
    bbox_min: list[float],
    bbox_max: list[float],
    plane_tolerance_m: float,
    range_tolerance_m: float,
) -> dict[str, Any]:
    faces = {
        "xmin": (0, "min", bbox_min[0]),
        "xmax": (0, "max", bbox_max[0]),
        "ymin": (1, "min", bbox_min[1]),
        "ymax": (1, "max", bbox_max[1]),
        "zmin": (2, "min", bbox_min[2]),
        "zmax": (2, "max", bbox_max[2]),
    }
    axis_names = ("x", "y", "z")
    result: dict[str, Any] = {}
    for face_name, (axis, side, plane_value) in faces.items():
        other_axes = [item for item in (0, 1, 2) if item != axis]
        values = [
            temperature
            for point, temperature in zip(points, temperatures)
            if abs(point[axis] - plane_value) <= plane_tolerance_m
            and all(
                bbox_min[other_axis] - range_tolerance_m
                <= point[other_axis]
                <= bbox_max[other_axis] + range_tolerance_m
                for other_axis in other_axes
            )
        ]
        result[face_name] = {
            "axis": axis_names[axis],
            "side": side,
            "plane_m": plane_value,
            "sample_count": len(values),
            "average_temperature_K": (sum(values) / len(values)) if values else None,
            "min_temperature_K": min(values) if values else None,
            "max_temperature_K": max(values) if values else None,
        }
    return result


def _read_yaml(path: Path) -> dict[str, Any]:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _resolve_runtime_path(value: Any, *, base: Path) -> Path:
    path = Path(str(value)).expanduser()
    if path.is_absolute():
        return path
    return (base / path).resolve()


def build_mock_field_samples(simulation_input: Mapping[str, Any]) -> dict[str, Any]:
    samples = []
    for index, component in enumerate(simulation_input["components"]):
        bbox = component["bbox"]
        center = [(bbox["min"][axis] + bbox["max"][axis]) / 2.0 for axis in range(3)]
        samples.append(
            {
                "sample_id": f"P{index + 1:03d}",
                "component_id": component["component_id"],
                "xyz_mm": center,
                "temperature_K": round(293.15 + float(component.get("power_W", 0.0)) * 0.25, 6),
            }
        )
    return {
        "schema_version": "1.0",
        "units": {
            "length": "mm",
            "temperature": "K",
        },
        "samples": samples,
    }


def build_mock_tensors(field_samples: Mapping[str, Any]) -> dict[str, Any]:
    temperatures = [sample["temperature_K"] for sample in field_samples["samples"]]
    return {
        "schema_version": "1.0",
        "summary": {
            "temperature_min_K": min(temperatures),
            "temperature_max_K": max(temperatures),
            "temperature_mean_K": round(sum(temperatures) / len(temperatures), 6),
            "sample_count": len(temperatures),
        },
    }


def write_mock_vtu(path: Path, field_samples: Mapping[str, Any]) -> Path:
    point_count = len(field_samples["samples"])
    points = " ".join(
        " ".join(str(value) for value in sample["xyz_mm"])
        for sample in field_samples["samples"]
    )
    temperatures = " ".join(str(sample["temperature_K"]) for sample in field_samples["samples"])
    path.write_text(
        "\n".join(
            [
                '<?xml version="1.0"?>',
                '<VTKFile type="UnstructuredGrid" version="0.1" byte_order="LittleEndian">',
                "  <UnstructuredGrid>",
                f'    <Piece NumberOfPoints="{point_count}" NumberOfCells="0">',
                "      <PointData Scalars=\"T\">",
                f'        <DataArray type="Float64" Name="T" format="ascii">{temperatures}</DataArray>',
                "      </PointData>",
                "      <Points>",
                f'        <DataArray type="Float64" NumberOfComponents="3" format="ascii">{points}</DataArray>',
                "      </Points>",
                "      <Cells>",
                '        <DataArray type="Int32" Name="connectivity" format="ascii"></DataArray>',
                '        <DataArray type="Int32" Name="offsets" format="ascii"></DataArray>',
                '        <DataArray type="UInt8" Name="types" format="ascii"></DataArray>',
                "      </Cells>",
                "    </Piece>",
                "  </UnstructuredGrid>",
                "</VTKFile>",
                "",
            ]
        ),
        encoding="utf-8",
    )
    return path


def _finish_failed(result: StageResult, reports: dict[str, Any]) -> StageResult:
    result.checks = reports
    result.errors = [
        check
        for report in reports.values()
        if isinstance(report, Mapping) and not report.get("ok", True)
        for check in report.get("failed_checks", [])
    ]
    return result.finish("failed")
