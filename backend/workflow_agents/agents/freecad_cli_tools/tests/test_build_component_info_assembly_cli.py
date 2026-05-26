from __future__ import annotations

import json
import sys
from pathlib import Path

from freecad_cli_tools.cli import build_component_info_assembly


def write_default_inputs(workspace: Path) -> None:
    input_dir = workspace / "00_inputs"
    input_dir.mkdir(parents=True, exist_ok=True)
    (input_dir / "layout_topology.json").write_text("{}", encoding="utf-8")
    (input_dir / "geom.json").write_text("{}", encoding="utf-8")
    (input_dir / "real_bom.json").write_text(
        json.dumps({"schema_version": "1.0", "source": {}, "items": []}),
        encoding="utf-8",
    )


def sample_normalized_component_info_assembly() -> dict[str, object]:
    return {
        "schema_version": "geom_component_assembly/1.0",
        "envelope": {
            "outer_size": [100.0, 80.0, 60.0],
            "inner_size": [96.0, 76.0, 56.0],
            "shell_thickness": 2.0,
        },
        "components": {
            "P001": {
                "id": "P001",
                "component_id": "P001",
                "category": "payload",
                "color": [255, 100, 0, 255],
                "target_bbox": {"min": [1.0, 2.0, 3.0], "max": [11.0, 22.0, 33.0]},
                "placement": {
                    "mount_face_id": "outer.zmin_outer",
                    "component_mount_face_id": "P001.local_zmin",
                    "install_face": 10,
                    "component_local_face": 4,
                    "mount_axis": 2,
                    "mount_direction": -1,
                    "external": True,
                    "alignment": {"in_plane_rotation_deg": 0.0},
                },
                "source": {"kind": "step", "step_path": "/tmp/real.step"},
            }
        },
    }


def test_main_stages_runtime_files_and_rewrites_export_paths(
    monkeypatch, tmp_path: Path, capsys
) -> None:
    captured: dict = {}

    def fake_render(script_name: str, replacements: dict) -> str:
        captured["script_name"] = script_name
        captured["replacements"] = replacements
        return "rendered-code"

    def fake_execute_script_payload(host: str, port: int, code: str) -> dict:
        assert code == "rendered-code"
        staged_output = Path(json.loads(captured["replacements"]["__SAVE_PATH__"]))
        staged_output.parent.mkdir(parents=True, exist_ok=True)
        staged_output.write_text("step-data", encoding="utf-8")
        staged_output.with_suffix(".glb").write_text("glb-data", encoding="utf-8")
        return {
            "success": True,
            "document": "GeomInfoAssembly",
            "save_path": str(staged_output),
            "glb_path": str(staged_output.with_suffix(".glb")),
            "component_count": 1,
            "components": [
                {
                    "component_id": "P001",
                    "mode": "step",
                    "category": "payload",
                    "source_step_path": "/tmp/real.step",
                    "requested_step_path": "/tmp/real.step",
                    "step_size_bytes": 123,
                    "fallback_reason": None,
                    "fallback_box": False,
                    "target_bbox": {"min": [1.0, 2.0, 3.0], "max": [11.0, 22.0, 33.0]},
                }
            ],
            "step_component_ids": ["P001"],
            "box_component_ids": [],
            "fallback_box_component_ids": [],
            "fallback_components_by_reason": {},
        }

    workspace = tmp_path / "workspace"
    write_default_inputs(workspace)

    monkeypatch.setenv("FREECAD_WORKSPACE_DIR", str(workspace))
    monkeypatch.setattr(build_component_info_assembly, "render_rpc_script", fake_render)
    monkeypatch.setattr(
        build_component_info_assembly,
        "execute_script_payload",
        fake_execute_script_payload,
    )
    monkeypatch.setattr(
        build_component_info_assembly,
        "load_and_normalize_component_info_assembly",
        lambda *args, **kwargs: sample_normalized_component_info_assembly(),
    )
    requested_output_path = workspace / "exports" / "custom.step"
    output_path = workspace / "exports" / "component_info_assembly.step"

    monkeypatch.setattr(
        sys,
        "argv",
        [
            "freecad-create-assembly-from-component-info",
            "--doc-name",
            "GeomInfoAssembly",
            "--output",
            str(requested_output_path),
        ],
    )

    build_component_info_assembly.main()

    assert captured["script_name"] == "assembly_from_component_info.py"
    staged_input = Path(json.loads(captured["replacements"]["__INPUT_PATH__"]))
    normalized = json.loads(staged_input.read_text(encoding="utf-8"))
    assert normalized["components"]["P001"]["placement"]["mount_face_id"] == "outer.zmin_outer"
    assert output_path.read_text(encoding="utf-8") == "step-data"
    assert output_path.with_suffix(".glb").read_text(encoding="utf-8") == "glb-data"

    payload = json.loads(capsys.readouterr().out)
    assert payload["save_path"] == str(output_path)
    assert payload["glb_path"] == str(output_path.with_suffix(".glb"))
    assert payload["components"][0]["fallback_reason"] is None
    assert payload["fallback_components_by_reason"] == {}


def test_main_allows_output_at_staged_export_path(monkeypatch, tmp_path: Path, capsys) -> None:
    captured: dict = {}

    def fake_render(script_name: str, replacements: dict) -> str:
        captured["replacements"] = replacements
        return "rendered-code"

    def fake_execute_script_payload(host: str, port: int, code: str) -> dict:
        staged_output = Path(json.loads(captured["replacements"]["__SAVE_PATH__"]))
        staged_output.parent.mkdir(parents=True, exist_ok=True)
        staged_output.write_text("step-data", encoding="utf-8")
        staged_output.with_suffix(".glb").write_text("glb-data", encoding="utf-8")
        return {
            "success": True,
            "document": "test-19",
            "save_path": str(staged_output),
            "glb_path": str(staged_output.with_suffix(".glb")),
            "component_count": 0,
            "components": [],
            "step_component_ids": [],
            "box_component_ids": [],
            "fallback_box_component_ids": [],
            "fallback_components_by_reason": {},
        }

    workspace = tmp_path / "workspace"
    write_default_inputs(workspace)

    monkeypatch.setenv("FREECAD_WORKSPACE_DIR", str(workspace))
    monkeypatch.setattr(build_component_info_assembly, "render_rpc_script", fake_render)
    monkeypatch.setattr(
        build_component_info_assembly,
        "execute_script_payload",
        fake_execute_script_payload,
    )
    monkeypatch.setattr(
        build_component_info_assembly,
        "load_and_normalize_component_info_assembly",
        lambda *args, **kwargs: sample_normalized_component_info_assembly(),
    )
    output_path = (
        workspace
        / "assembly_builds"
        / "test-19"
        / "outputs"
        / "component_info_assembly.step"
    )

    monkeypatch.setattr(
        sys,
        "argv",
        [
            "freecad-create-assembly-from-component-info",
            "--doc-name",
            "test-19",
            "--output",
            str(output_path),
        ],
    )

    build_component_info_assembly.main()

    assert output_path.read_text(encoding="utf-8") == "step-data"
    assert output_path.with_suffix(".glb").read_text(encoding="utf-8") == "glb-data"

    payload = json.loads(capsys.readouterr().out)
    assert payload["success"] is True
    assert payload["save_path"] == str(output_path)
    assert payload["glb_path"] == str(output_path.with_suffix(".glb"))


def test_main_uses_runtime_default_step_size_limit(monkeypatch, tmp_path: Path, capsys) -> None:
    captured: dict = {}

    def fake_render(script_name: str, replacements: dict) -> str:
        captured["script_name"] = script_name
        captured["replacements"] = replacements
        return "rendered-code"

    def fake_execute_script_payload(host: str, port: int, code: str) -> dict:
        staged_output = Path(json.loads(captured["replacements"]["__SAVE_PATH__"]))
        staged_output.parent.mkdir(parents=True, exist_ok=True)
        staged_output.write_text("step-data", encoding="utf-8")
        staged_output.with_suffix(".glb").write_text("glb-data", encoding="utf-8")
        return {
            "success": True,
            "document": "GeomInfoAssembly",
            "save_path": str(staged_output),
            "glb_path": str(staged_output.with_suffix(".glb")),
            "component_count": 0,
            "components": [],
            "step_component_ids": [],
            "box_component_ids": [],
            "fallback_box_component_ids": [],
            "fallback_components_by_reason": {},
        }

    workspace = tmp_path / "workspace"
    write_default_inputs(workspace)

    monkeypatch.setenv("FREECAD_WORKSPACE_DIR", str(workspace))
    monkeypatch.setenv("FREECAD_COMPONENT_INFO_MAX_STEP_SIZE_MB", "77")
    monkeypatch.setattr(build_component_info_assembly, "render_rpc_script", fake_render)
    monkeypatch.setattr(
        build_component_info_assembly,
        "execute_script_payload",
        fake_execute_script_payload,
    )

    def fake_load(*args, **kwargs):
        captured["max_step_size_mb"] = kwargs["max_step_size_mb"]
        return {"schema_version": "geom_component_assembly/1.0", "envelope": {}, "components": {}}

    monkeypatch.setattr(
        build_component_info_assembly,
        "load_and_normalize_component_info_assembly",
        fake_load,
    )
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "freecad-create-assembly-from-component-info",
            "--doc-name",
            "GeomInfoAssembly",
        ],
    )

    build_component_info_assembly.main()

    assert captured["max_step_size_mb"] == 77.0
    payload = json.loads(capsys.readouterr().out)
    assert payload["success"] is True
    assert payload["save_path"] == str(workspace / "01_cad" / "component_info_assembly.step")
    assert payload["glb_path"] == str(workspace / "01_cad" / "component_info_assembly.glb")


def test_main_accepts_explicit_workspace_without_environment(
    monkeypatch, tmp_path: Path, capsys
) -> None:
    captured: dict = {}

    def fake_render(script_name: str, replacements: dict) -> str:
        captured["replacements"] = replacements
        return "rendered-code"

    def fake_execute_script_payload(host: str, port: int, code: str) -> dict:
        staged_output = Path(json.loads(captured["replacements"]["__SAVE_PATH__"]))
        staged_output.parent.mkdir(parents=True, exist_ok=True)
        staged_output.write_text("step-data", encoding="utf-8")
        staged_output.with_suffix(".glb").write_text("glb-data", encoding="utf-8")
        return {
            "success": True,
            "document": "GeomInfoAssembly",
            "save_path": str(staged_output),
            "glb_path": str(staged_output.with_suffix(".glb")),
            "component_count": 0,
            "components": [],
            "step_component_ids": [],
            "box_component_ids": [],
            "fallback_box_component_ids": [],
            "fallback_components_by_reason": {},
        }

    workspace = tmp_path / "workspace"
    write_default_inputs(workspace)

    monkeypatch.delenv("FREECAD_WORKSPACE_DIR", raising=False)
    monkeypatch.setattr(build_component_info_assembly, "render_rpc_script", fake_render)
    monkeypatch.setattr(
        build_component_info_assembly,
        "execute_script_payload",
        fake_execute_script_payload,
    )
    monkeypatch.setattr(
        build_component_info_assembly,
        "load_and_normalize_component_info_assembly",
        lambda *args, **kwargs: {"schema_version": "geom_component_assembly/1.0", "envelope": {}, "components": {}},
    )
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "freecad-create-assembly-from-component-info",
            "--workspace",
            str(workspace),
            "--doc-name",
            "GeomInfoAssembly",
        ],
    )

    build_component_info_assembly.main()

    payload = json.loads(capsys.readouterr().out)
    assert payload["success"] is True
    assert payload["save_path"] == str(workspace / "01_cad" / "component_info_assembly.step")
    assert payload["glb_path"] == str(workspace / "01_cad" / "component_info_assembly.glb")


def test_main_allows_explicit_input_paths_when_workspace_defaults_are_missing(
    monkeypatch, tmp_path: Path, capsys
) -> None:
    captured: dict = {}

    def fake_render(script_name: str, replacements: dict) -> str:
        captured["replacements"] = replacements
        return "rendered-code"

    def fake_execute_script_payload(host: str, port: int, code: str) -> dict:
        staged_output = Path(json.loads(captured["replacements"]["__SAVE_PATH__"]))
        staged_output.parent.mkdir(parents=True, exist_ok=True)
        staged_output.write_text("step-data", encoding="utf-8")
        staged_output.with_suffix(".glb").write_text("glb-data", encoding="utf-8")
        return {
            "success": True,
            "document": "GeomInfoAssembly",
            "save_path": str(staged_output),
            "glb_path": str(staged_output.with_suffix(".glb")),
            "component_count": 0,
            "components": [],
            "step_component_ids": [],
            "box_component_ids": [],
            "fallback_box_component_ids": [],
            "fallback_components_by_reason": {},
        }

    workspace = tmp_path / "workspace"
    workspace.mkdir()
    explicit_inputs = tmp_path / "explicit-inputs"
    explicit_inputs.mkdir()
    layout_path = explicit_inputs / "layout_topology.json"
    geom_path = explicit_inputs / "geom.json"
    real_bom_path = explicit_inputs / "real_bom.json"
    component_info_path = explicit_inputs / "geom_component_info.json"
    layout_path.write_text("{}", encoding="utf-8")
    geom_path.write_text("{}", encoding="utf-8")
    real_bom_path.write_text(
        json.dumps({"schema_version": "1.0", "source": {}, "items": []}),
        encoding="utf-8",
    )
    component_info_path.write_text("{}", encoding="utf-8")

    monkeypatch.delenv("FREECAD_WORKSPACE_DIR", raising=False)
    monkeypatch.setattr(build_component_info_assembly, "render_rpc_script", fake_render)
    monkeypatch.setattr(
        build_component_info_assembly,
        "execute_script_payload",
        fake_execute_script_payload,
    )
    monkeypatch.setattr(
        build_component_info_assembly,
        "load_and_normalize_component_info_assembly",
        lambda *args, **kwargs: {"schema_version": "geom_component_assembly/1.0", "envelope": {}, "components": {}},
    )
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "freecad-create-assembly-from-component-info",
            "--workspace",
            str(workspace),
            "--layout-topology",
            str(layout_path),
            "--geom",
            str(geom_path),
            "--real-bom",
            str(real_bom_path),
            "--geom-component-info",
            str(component_info_path),
            "--doc-name",
            "GeomInfoAssembly",
        ],
    )

    build_component_info_assembly.main()

    payload = json.loads(capsys.readouterr().out)
    assert payload["success"] is True
