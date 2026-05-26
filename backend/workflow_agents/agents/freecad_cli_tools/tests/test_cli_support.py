from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

import freecad_cli_tools.runtime_config as runtime_config
from freecad_cli_tools.artifact_registry import (
    artifact_entry,
    finalize_registry_run,
    start_registry_run,
)
from freecad_cli_tools.cli import runtime_config as runtime_config_command
from freecad_cli_tools.cli_support import (
    describe_rpc_failure,
    extract_output_payload,
    normalize_runtime_path,
)
from freecad_cli_tools.doc_name import DEFAULT_DOC_NAME, infer_doc_name_from_workspace, resolve_doc_name
from freecad_cli_tools.pipeline_logging import configure_pipeline_logging, get_pipeline_logger, pipeline_step
from freecad_cli_tools.runtime_config import (
    get_default_artifact_registry_dir,
    get_default_cad_output_dir,
    get_default_component_info_max_step_size_mb,
    get_default_geometry_after_step_path,
    get_default_real_bom_path,
    get_default_rpc_host,
    get_default_rpc_port,
    get_default_workspace_dir,
    resolve_geometry_after_step_path,
    resolve_workspace_path,
)
from freecad_cli_tools.workspace import validate_workspace_root


def write_runtime_config(monkeypatch, tmp_path: Path, freecad_config: dict) -> Path:
    config_path = tmp_path / "config.json"
    config_path.write_text(json.dumps({"freecad": freecad_config}), encoding="utf-8")
    monkeypatch.setattr(runtime_config, "CODEX_WEB_CONFIG_PATH", config_path)
    monkeypatch.setattr(runtime_config, "_CONFIG_CACHE", None)
    monkeypatch.setattr(
        runtime_config,
        "FALLBACK_RPC_PORT",
        runtime_config._get_freecad_config_value("rpcPort", "9877") or "9877",
    )
    monkeypatch.setattr(
        runtime_config,
        "FREECAD_WORKSPACE_DIR",
        runtime_config._get_freecad_config_value("workspaceDir"),
    )
    monkeypatch.setattr(runtime_config, "_WORKSPACE_OVERRIDE", None)
    return config_path


def test_get_default_workspace_dir_requires_environment_or_config(
    monkeypatch, tmp_path: Path
) -> None:
    monkeypatch.delenv("FREECAD_WORKSPACE_DIR", raising=False)
    config_path = tmp_path / "missing-config.json"
    monkeypatch.setattr(runtime_config, "CODEX_WEB_CONFIG_PATH", config_path)
    monkeypatch.setattr(runtime_config, "_CONFIG_CACHE", None)
    monkeypatch.setattr(runtime_config, "FREECAD_WORKSPACE_DIR", None)
    monkeypatch.setattr(runtime_config, "_WORKSPACE_OVERRIDE", None)

    with pytest.raises(RuntimeError, match="FreeCAD workspace is not configured"):
        get_default_workspace_dir()


def test_pipeline_logging_writes_workspace_pipeline_log(monkeypatch, tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    write_runtime_config(monkeypatch, tmp_path, {"workspaceDir": str(workspace)})
    monkeypatch.delenv("FREECAD_WORKSPACE_DIR", raising=False)

    log_path = configure_pipeline_logging(command="cad build", workspace=workspace)
    logger = get_pipeline_logger("test")
    with pipeline_step("unit_step"):
        logger.info("unit progress message")

    content = log_path.read_text(encoding="utf-8")
    assert log_path == workspace / "logs" / "pipeline.log"
    assert "freecad command started: cad build" in content
    assert "INFO [cad_agent]" in content
    assert "[unit_step]" in content
    assert "unit progress message" in content


def test_runtime_config_reads_codex_web_freecad_defaults(monkeypatch, tmp_path: Path) -> None:
    workspace = tmp_path / "configured-workspace"
    write_runtime_config(
        monkeypatch,
        tmp_path,
        {
            "workspaceDir": str(workspace),
            "rpcHost": "127.0.0.1",
            "rpcPort": 9988,
            "componentInfoMaxStepSizeMb": 12.5,
        },
    )
    monkeypatch.delenv("FREECAD_WORKSPACE_DIR", raising=False)
    monkeypatch.delenv("FREECAD_RPC_HOST", raising=False)
    monkeypatch.delenv("FREECAD_RPC_PORT", raising=False)
    monkeypatch.delenv("FREECAD_COMPONENT_INFO_MAX_STEP_SIZE_MB", raising=False)

    assert get_default_workspace_dir() == workspace.resolve()
    assert get_default_rpc_host() == "127.0.0.1"
    assert get_default_rpc_port() == 9988
    assert get_default_component_info_max_step_size_mb() == 12.5


def test_resolve_doc_name_prefers_explicit_value() -> None:
    assert resolve_doc_name("CustomDoc") == "CustomDoc"


def test_resolve_doc_name_falls_back_without_version_manifest(
    monkeypatch,
    tmp_path: Path,
) -> None:
    workspace = tmp_path / "plain-workspace"
    workspace.mkdir()
    write_runtime_config(monkeypatch, tmp_path, {"workspaceDir": str(workspace)})
    monkeypatch.delenv("FREECAD_WORKSPACE_DIR", raising=False)

    assert resolve_doc_name(None) == DEFAULT_DOC_NAME


def test_infer_doc_name_from_version_workspace(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspaces" / "ws_demo-123"
    version_workspace = workspace_root / "versions" / "v0002"
    version_workspace.mkdir(parents=True)
    manifest = {
        "workspaceId": "ws_demo-123",
        "activeVersionId": "v0002",
        "rootDir": str(workspace_root),
        "versions": [
            {
                "id": "v0002",
                "workspaceDir": str(version_workspace),
            }
        ],
    }
    (workspace_root / "workspace_manifest.json").write_text(
        json.dumps(manifest),
        encoding="utf-8",
    )

    assert infer_doc_name_from_workspace(version_workspace) == "FC_ws_demo_123_v0002"


def test_runtime_config_cli_prints_resolved_values(monkeypatch, tmp_path: Path, capsys) -> None:
    workspace = tmp_path / "workspace"
    write_runtime_config(
        monkeypatch,
        tmp_path,
        {
            "workspaceDir": str(workspace),
            "rpcHost": "127.0.0.1",
            "rpcPort": 9988,
            "componentInfoMaxStepSizeMb": 12.5,
        },
    )
    monkeypatch.delenv("FREECAD_WORKSPACE_DIR", raising=False)
    monkeypatch.delenv("FREECAD_RPC_HOST", raising=False)
    monkeypatch.delenv("FREECAD_RPC_PORT", raising=False)
    monkeypatch.delenv("FREECAD_COMPONENT_INFO_MAX_STEP_SIZE_MB", raising=False)
    monkeypatch.setattr(sys, "argv", ["freecad-runtime-config"])

    runtime_config_command.main()

    payload = json.loads(capsys.readouterr().out)
    assert payload["workspace_dir"] == str(workspace.resolve())
    assert payload["rpc_host"] == "127.0.0.1"
    assert payload["rpc_port"] == 9988
    assert payload["component_info_max_step_size_mb"] == 12.5
    assert payload["real_bom_path"] == str(workspace.resolve() / "00_inputs" / "real_bom.json")
    assert payload["layout_topology_path"] == str(
        workspace.resolve() / "00_inputs" / "layout_topology.json"
    )
    assert payload["cad_output_dir"] == str(workspace.resolve() / "01_cad")


def test_runtime_config_cli_prints_single_key(monkeypatch, tmp_path: Path, capsys) -> None:
    workspace = tmp_path / "workspace"
    write_runtime_config(monkeypatch, tmp_path, {"workspaceDir": str(workspace), "rpcPort": 9988})
    monkeypatch.delenv("FREECAD_WORKSPACE_DIR", raising=False)
    monkeypatch.delenv("FREECAD_RPC_PORT", raising=False)
    monkeypatch.setattr(sys, "argv", ["freecad-runtime-config", "--key", "rpc_port"])

    runtime_config_command.main()

    assert json.loads(capsys.readouterr().out) == {"rpc_port": 9988}


def test_runtime_config_cli_accepts_workspace_argument(
    monkeypatch, tmp_path: Path, capsys
) -> None:
    configured_workspace = tmp_path / "configured-workspace"
    cli_workspace = tmp_path / "cli-workspace"
    write_runtime_config(
        monkeypatch,
        tmp_path,
        {"workspaceDir": str(configured_workspace), "rpcPort": 9988},
    )
    monkeypatch.delenv("FREECAD_WORKSPACE_DIR", raising=False)
    monkeypatch.delenv("WORKSPACE_DIR", raising=False)
    monkeypatch.setattr(
        sys,
        "argv",
        ["freecad-runtime-config", "--workspace", str(cli_workspace)],
    )

    runtime_config_command.main()

    payload = json.loads(capsys.readouterr().out)
    assert payload["workspace_dir"] == str(cli_workspace.resolve())
    assert payload["layout_topology_path"] == str(
        cli_workspace.resolve() / "00_inputs" / "layout_topology.json"
    )


def test_workspace_env_var_overrides_codex_web_config(monkeypatch, tmp_path: Path) -> None:
    configured_workspace = tmp_path / "configured-workspace"
    env_workspace = tmp_path / "freecad-workspace"
    write_runtime_config(monkeypatch, tmp_path, {"workspaceDir": str(configured_workspace)})
    monkeypatch.setenv("FREECAD_WORKSPACE_DIR", str(env_workspace))
    monkeypatch.setenv("WORKSPACE_DIR", str(tmp_path / "pipeline-workspace"))

    assert get_default_workspace_dir() == env_workspace.resolve()


def test_workspace_dir_env_is_not_supported_as_fallback(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(runtime_config, "CODEX_WEB_CONFIG_PATH", tmp_path / "missing-config.json")
    monkeypatch.setattr(runtime_config, "_CONFIG_CACHE", None)
    monkeypatch.setattr(runtime_config, "_WORKSPACE_OVERRIDE", None)
    monkeypatch.delenv("FREECAD_WORKSPACE_DIR", raising=False)
    monkeypatch.setenv("WORKSPACE_DIR", str(tmp_path / "pipeline-workspace"))

    with pytest.raises(RuntimeError, match="FreeCAD workspace is not configured"):
        get_default_workspace_dir()


def test_normalize_runtime_path_resolves_path(tmp_path: Path) -> None:
    target = tmp_path / "example.step"
    target.write_text("ok", encoding="utf-8")

    assert normalize_runtime_path(target) == str(target.resolve())


def test_describe_rpc_failure_includes_error_message_and_raw_result() -> None:
    message = describe_rpc_failure(
        {"success": False, "error": "permission denied", "message": "generic failure"}
    )

    assert "permission denied" in message
    assert "generic failure" in message
    assert '"success": false' in message


def test_extract_output_payload_surfaces_rpc_error_details() -> None:
    with pytest.raises(RuntimeError, match="permission denied"):
        extract_output_payload({"success": False, "error": "permission denied"})


def test_extract_output_payload_accepts_log_lines_before_json() -> None:
    payload = extract_output_payload(
        {
            "success": True,
            "message": 'Output:\nSome FreeCAD log line\n{"success": true, "items": [1, 2]}',
        }
    )

    assert payload == {"success": True, "items": [1, 2]}


def test_extract_output_payload_accepts_message_without_marker_when_json_present() -> None:
    payload = extract_output_payload(
        {
            "success": True,
            "message": 'noise before json\n[{"name": "Doc1"}]',
        }
    )

    assert payload == [{"name": "Doc1"}]


def test_runtime_directory_getters_honor_environment_overrides(monkeypatch, tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    write_runtime_config(monkeypatch, tmp_path, {"workspaceDir": str(workspace)})
    monkeypatch.delenv("FREECAD_ARTIFACT_REGISTRY_DIR", raising=False)
    monkeypatch.setenv("FREECAD_COMPONENT_INFO_MAX_STEP_SIZE_MB", "42.5")

    assert get_default_workspace_dir() == workspace.resolve()
    assert get_default_artifact_registry_dir() == (workspace.resolve() / "logs" / "registry")
    assert get_default_component_info_max_step_size_mb() == 42.5


def test_resolve_workspace_path_uses_configured_workspace_root(monkeypatch, tmp_path: Path) -> None:
    write_runtime_config(monkeypatch, tmp_path, {"workspaceDir": str(tmp_path / "workspace")})

    assert resolve_workspace_path("./00_inputs/geom.json") == (
        tmp_path / "workspace" / "00_inputs" / "geom.json"
    )
    absolute = tmp_path / "abs" / "geom.json"
    assert resolve_workspace_path(absolute) == absolute


def test_validate_workspace_root_accepts_workspace_without_default_inputs(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()

    assert validate_workspace_root(workspace) == workspace.resolve()


def test_resolve_geometry_after_step_path_forces_geometry_after_basename(
    monkeypatch, tmp_path: Path
) -> None:
    workspace = tmp_path / "workspace"
    write_runtime_config(monkeypatch, tmp_path, {"workspaceDir": str(workspace)})

    assert get_default_geometry_after_step_path() == (
        workspace.resolve() / "01_cad" / "geometry_after.step"
    )
    assert get_default_cad_output_dir() == workspace.resolve() / "01_cad"
    assert get_default_real_bom_path() == workspace.resolve() / "00_inputs" / "real_bom.json"
    assert resolve_geometry_after_step_path("exports/custom_name.step") == (
        workspace.resolve() / "exports" / "geometry_after.step"
    )
    assert resolve_geometry_after_step_path("exports") == (
        workspace.resolve() / "exports" / "geometry_after.step"
    )


def test_start_and_finalize_registry_run_write_manifest_and_index(
    monkeypatch, tmp_path: Path
) -> None:
    registry_dir = tmp_path / "registry"
    yaml_path = tmp_path / "sample.yaml"
    step_path = tmp_path / "sample.step"
    yaml_path.write_text("components: {}\n", encoding="utf-8")
    step_path.write_text("step-data", encoding="utf-8")
    monkeypatch.setenv("FREECAD_ARTIFACT_REGISTRY_DIR", str(registry_dir))

    args = type(
        "Args",
        (),
        {
            "run_id": "run-123",
            "session_id": "session-123",
            "thread_id": "thread-123",
            "turn_id": "turn-123",
        },
    )()

    registry_run = start_registry_run(
        args,
        tool="freecad-create-assembly",
        operation_type="create_assembly",
        inputs={"yaml_path": str(yaml_path)},
    )

    assert registry_run is not None
    finalize_registry_run(
        registry_run,
        status="success",
        outputs={"yaml_path": str(yaml_path), "step_path": str(step_path)},
        result={"success": True},
        artifacts=[
            artifact_entry("yaml", yaml_path),
            artifact_entry("step", step_path),
        ],
    )

    manifest = json.loads((registry_dir / "runs" / "run-123.json").read_text(encoding="utf-8"))
    assert manifest["operation"]["status"] == "success"
    assert manifest["session_id"] == "session-123"
    assert manifest["outputs"]["step_path"] == str(step_path)
    assert manifest["artifacts"][1]["exists"] is True

    index = json.loads((registry_dir / "index.json").read_text(encoding="utf-8"))
    assert index["runs"]["run-123"] == "runs/run-123.json"
    assert index["sessions"]["session-123"] == ["runs/run-123.json"]


def test_start_registry_run_is_non_fatal_when_write_fails(monkeypatch) -> None:
    monkeypatch.setattr(
        "freecad_cli_tools.artifact_registry.get_default_artifact_registry_dir",
        lambda: Path("/tmp/ignored"),
    )
    monkeypatch.setattr(
        "freecad_cli_tools.artifact_registry._write_run_record",
        lambda registry_run: (_ for _ in ()).throw(PermissionError("no write")),
    )

    registry_run = start_registry_run(
        None,
        tool="freecad-create-assembly",
        operation_type="create_assembly",
        inputs={"yaml_path": "/tmp/sample.yaml"},
    )

    assert registry_run is None
