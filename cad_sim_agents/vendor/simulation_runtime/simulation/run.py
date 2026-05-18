from __future__ import annotations

import json
import math
import os
import signal
import shutil
import subprocess
import tempfile
import time
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
    _prepare_comsol_work_dir(layout_dir, geometry_step_path, work_dir, after_state_dir=after_state_dir)

    thermal_cfg = _read_yaml(Path(config["thermal_sim_config"]))
    connection_cfg = _read_yaml(Path(config["comsol_connection_config"]))
    template_mph = Path(thermal_cfg["comsol"]["template_mph_path"])
    export_tags = thermal_cfg["thermal_sim"].get("export_tags", [])
    export_volum_tags = thermal_cfg["thermal_sim"].get("export_volum_tags", [])
    mesh = thermal_cfg["thermal_sim"].get("mesh", {})
    boundary_conditions = thermal_cfg["thermal_sim"].get("boundary_conditions", {})
    configured_port = int(config.get("mph_port", connection_cfg["comsol"]["connection"].get("local_mph_port", 2036)) or 2036)
    connect_existing = bool(
        config.get(
            "connect_existing_mphserver",
            connection_cfg["comsol"]["connection"].get("connect_existing_mphserver", False),
        )
    )
    mph_port = configured_port if connect_existing else _select_mph_port(configured_port, prefer_private=True)
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
            "connect_existing_mphserver": connect_existing,
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
    result.checks = reports
    return result.finish("completed")


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
        after_state_dir / "sample.yaml",
        after_state_dir / "simulation_input.json",
    ]
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
    if prefer_private:
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
) -> None:
    if work_dir.exists():
        shutil.rmtree(work_dir)
    (work_dir / "geom").mkdir(parents=True, exist_ok=True)
    (work_dir / "inputs").mkdir(parents=True, exist_ok=True)
    shutil.copy2(geometry_step_path, work_dir / "geom" / "geometry.step")
    after_state_dir = after_state_dir or layout_dir
    if after_state_dir != layout_dir:
        geom_source = after_state_dir / "geometry_after.geom.json"
        sample_source = after_state_dir / "sample.yaml"
        comsol_inputs_dir = after_state_dir / "comsol_inputs"
    else:
        geom_source = layout_dir / "geom.json"
        sample_source = layout_dir / "sample.yaml"
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
) -> dict[str, Any]:
    local_python = str(connection.get("local_python", "/data/conda/envs/autoflowsim-comsol/bin/python"))
    entry_script = Path(config.get("local_entry_script") or connection.get("local_entry_script"))
    comsol_runtime_root = Path(config.get("comsol_runtime_root", entry_script.parents[1]))
    env = os.environ.copy()
    comsol_home = str(connection.get("local_comsol_home", "/usr/local/comsol64/multiphysics"))
    env["COMSOL_HOME"] = comsol_home
    env["PATH"] = f"{comsol_home}/bin:{env.get('PATH', '')}"
    env["PYTHONPATH"] = f"{comsol_runtime_root}:{env.get('PYTHONPATH', '')}"
    connect_existing = bool(config.get("connect_existing_mphserver"))
    if not connect_existing:
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
        progress_path = Path(config["pipeline_progress_path"]) if config.get("pipeline_progress_path") else None
        try:
            stdout, stderr = _communicate_with_progress(
                process,
                timeout_seconds=timeout if timeout > 0 else None,
                status_path=status_path,
                progress_path=progress_path,
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
) -> tuple[str, str]:
    deadline = time.monotonic() + timeout_seconds if timeout_seconds else None
    last_stage: str | None = None
    while True:
        if deadline is not None and time.monotonic() >= deadline:
            raise subprocess.TimeoutExpired(process.args, timeout_seconds)
        last_stage = _sync_comsol_progress(status_path, progress_path, last_stage)
        try:
            stdout, stderr = process.communicate(timeout=1.0)
        except subprocess.TimeoutExpired:
            continue
        _sync_comsol_progress(status_path, progress_path, last_stage)
        return stdout, stderr


def _sync_comsol_progress(
    status_path: Path | None,
    progress_path: Path | None,
    last_stage: str | None,
) -> str | None:
    if status_path is None or progress_path is None or not status_path.exists() or not progress_path.exists():
        return last_stage
    try:
        status = json.loads(status_path.read_text(encoding="utf-8"))
        progress = json.loads(progress_path.read_text(encoding="utf-8"))
    except Exception:
        return last_stage
    stage = str(status.get("stage") or "")
    if not stage or stage == last_stage:
        return last_stage
    percent = max(0.0, min(99.0, float(status.get("progress_percent") or 0.0)))
    now = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    for step in progress.get("steps", []):
        if step.get("command_name") != "simulation":
            continue
        step["status"] = "running"
        step["percent"] = percent
        step["comsol_progress"] = {
            "stage": stage,
            "percent": percent,
            "sample_id": status.get("sample_id"),
            "status_json": str(status_path),
            "updated_at": status.get("updated_at"),
        }
        break
    progress["current_step"] = "simulation"
    progress["updated_at"] = now
    progress["overall_percent"] = _overall_pipeline_percent(progress)
    progress_path.write_text(json.dumps(progress, ensure_ascii=False, indent=2), encoding="utf-8")
    return stage


def _overall_pipeline_percent(progress: Mapping[str, Any]) -> float:
    completed_weight = 0.0
    for step in progress.get("steps", []):
        step_percent = float(step.get("percent") or 0.0)
        weight_percent = float(step.get("weight_percent") or 0.0)
        completed_weight += (step_percent / 100.0) * weight_percent
    return round(completed_weight, 2)


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


def _read_yaml(path: Path) -> dict[str, Any]:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


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
