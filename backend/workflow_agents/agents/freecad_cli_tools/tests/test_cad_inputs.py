from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from freecad_cli_tools.cad_inputs import build_cad_stage_inputs
from freecad_cli_tools.cad_validation import validate_cad_build


def write_inputs(root: Path) -> tuple[Path, Path, Path, Path]:
    input_dir = root / "00_inputs"
    input_dir.mkdir(parents=True)
    real_bom = {
        "schema_version": "1.0",
        "items": [
            {
                "component_id": "P001",
                "semantic_name": "Battery",
                "kind": "internal",
                "category": "power",
                "mass_kg": 2.5,
                "power_W": 4.0,
                "material_id": "aluminum_6061",
                "mounting": {
                    "mount_faces": [
                        {
                            "component_mount_face_id": "P001.local_xmax",
                            "local_face": "xmax",
                            "normal_axis": 0,
                            "normal_sign": 1,
                            "u_axis": 1,
                            "v_axis": 2,
                        }
                    ]
                },
            }
        ],
    }
    layout_topology = {
        "schema_version": "1.0",
        "layout_id": "layout-test",
        "source_design_id": "design-test",
        "outer_shell": {"id": "outer_shell"},
        "cabins": [{"id": "cabin_auto_1", "parent": "outer_shell"}],
        "walls": [],
        "install_faces": [
            {
                "id": "cabin_auto_1.xmax",
                "owner_id": "cabin_auto_1",
                "side": "inner",
                "plane_axis": 0,
                "plane_value": 50.0,
                "normal_sign": 1,
            }
        ],
        "placements": [
            {
                "component_id": "P001",
                "semantic_name": "Battery",
                "kind": "internal",
                "cabin_id": "cabin_auto_1",
                "component_mount_face_id": "P001.local_xmax",
                "mount_face_id": "cabin_auto_1.xmax",
                "alignment": {"normal_alignment": "opposite", "in_plane_rotation_deg": 0.0},
                "geometry_id": "G001",
                "thermal_id": "T001",
            }
        ],
    }
    geom = {
        "schema_version": "2.0",
        "units": {"length": "mm", "mass": "kg", "power": "W"},
        "outer_shell": {
            "id": "outer_shell",
            "outer_bbox": {"min": [-55.0, -55.0, -55.0], "max": [55.0, 55.0, 55.0]},
            "inner_bbox": {"min": [-50.0, -50.0, -50.0], "max": [50.0, 50.0, 50.0]},
            "thickness": 5.0,
        },
        "install_faces": {
            "cabin_auto_1.xmax": {
                "id": "cabin_auto_1.xmax",
                "belongs_to": "cabin_auto_1",
                "side": "inner",
                "plane_axis": 0,
                "plane_value": 50.0,
                "normal_sign": 1,
            }
        },
        "components": {
            "P_001_internal": {
                "id": "P_001_internal",
                "component_id": "P001",
                "semantic_name": "Battery",
                "kind": "internal",
                "category": "power",
                "shape": "box",
                "dims": [10.0, 20.0, 30.0],
                "position": [40.0, -10.0, -15.0],
                "bbox": {"min": [40.0, -10.0, -15.0], "max": [50.0, 10.0, 15.0]},
                "mass": 2.5,
                "power": 4.0,
                "mount_face_id": "cabin_auto_1.xmax",
                "thermal_interface": {"contact_resistance": 0.001},
            }
        },
    }
    real_bom_path = input_dir / "real_bom.json"
    layout_path = input_dir / "layout_topology.json"
    geom_path = input_dir / "geom.json"
    real_bom_path.write_text(json.dumps(real_bom), encoding="utf-8")
    layout_path.write_text(json.dumps(layout_topology), encoding="utf-8")
    geom_path.write_text(json.dumps(geom), encoding="utf-8")
    return input_dir, real_bom_path, layout_path, geom_path


def test_build_cad_stage_inputs_writes_expected_outputs(tmp_path: Path) -> None:
    _, real_bom_path, layout_path, geom_path = write_inputs(tmp_path)
    output_dir = tmp_path / "01_cad"

    result = build_cad_stage_inputs(
        real_bom_path=real_bom_path,
        layout_topology_path=layout_path,
        geom_path=geom_path,
        output_dir=output_dir,
        grid_shape=(4, 4, 4),
    )

    assert (output_dir / "geometry_after.layout_topology.json").exists()
    assert (output_dir / "geometry_after.geom.json").exists()
    assert (output_dir / "geometry_after_registry.json").exists()
    assert (output_dir / "simulation_input.json").exists()
    assert (output_dir / "cad_agent_output.json").exists()
    assert not (output_dir / "coord.txt").exists()
    assert not (output_dir / "channels_input.npz").exists()
    assert (output_dir / "comsol_inputs" / "coord.txt").exists()
    assert (output_dir / "comsol_inputs" / "channels_input.npz").exists()

    simulation_input = json.loads((output_dir / "simulation_input.json").read_text())
    assert simulation_input["step_file"] == "geometry_after.step"
    assert simulation_input["components"][0]["component_id"] == "P001"
    assert simulation_input["components"][0]["power_W"] == 4.0

    cad_agent_output = json.loads((output_dir / "cad_agent_output.json").read_text())
    assert cad_agent_output["checks"]["all_placements_have_geom"] is True
    assert cad_agent_output["counts"]["cad_components"] == 1
    assert result["normalized"]["components"]["P001"]["dims"] == [10.0, 20.0, 30.0]

    assert "coord" not in cad_agent_output["outputs"]
    assert "channels_input" not in cad_agent_output["outputs"]
    assert cad_agent_output["outputs"]["comsol_coord"].endswith("comsol_inputs/coord.txt")
    assert cad_agent_output["outputs"]["comsol_channels_input"].endswith(
        "comsol_inputs/channels_input.npz"
    )

    channels = np.load(output_dir / "comsol_inputs" / "channels_input.npz")
    assert set(channels.files) == {"mask", "power", "mass"}
    assert channels["mask"].shape == (4, 4, 4)


def test_validate_cad_build_merges_report_into_cad_agent_output(tmp_path: Path) -> None:
    _, real_bom_path, layout_path, geom_path = write_inputs(tmp_path)
    output_dir = tmp_path / "01_cad"
    build_cad_stage_inputs(
        real_bom_path=real_bom_path,
        layout_topology_path=layout_path,
        geom_path=geom_path,
        output_dir=output_dir,
        grid_shape=(4, 4, 4),
    )
    for name in ("geometry_after.step", "geometry_after.glb"):
        (output_dir / name).write_text("artifact", encoding="utf-8")

    screenshot = {
        "success": True,
        "count": 6,
        "screenshot_paths": {
            "top": str(output_dir / "freecad_screenshot_top.png"),
            "bottom": str(output_dir / "freecad_screenshot_bottom.png"),
            "front": str(output_dir / "freecad_screenshot_front.png"),
            "back": str(output_dir / "freecad_screenshot_back.png"),
            "left": str(output_dir / "freecad_screenshot_left.png"),
            "right": str(output_dir / "freecad_screenshot_right.png"),
        },
        "width": 1600,
        "height": 1000,
    }
    report = validate_cad_build(
        real_bom_path=real_bom_path,
        layout_topology_path=layout_path,
        geom_path=geom_path,
        cad_dir=output_dir,
        screenshot_result=screenshot,
        write_back=True,
    )

    assert report["success"] is True
    assert report["summary"]["component_count"] == 1
    updated = json.loads((output_dir / "cad_agent_output.json").read_text(encoding="utf-8"))
    assert updated["status"] == "validated"
    assert updated["validation"]["success"] is True
    assert updated["screenshot"] == screenshot
    assert "screenshot" not in updated["validation"]
    assert "cabin_auto_1.xmax" in updated["validation"]["face_occupancy"]


def test_validate_cad_build_accepts_outer_face_when_bbox_min_touches_plane(
    tmp_path: Path,
) -> None:
    _, real_bom_path, layout_path, geom_path = write_inputs(tmp_path)
    output_dir = tmp_path / "01_cad"
    build_cad_stage_inputs(
        real_bom_path=real_bom_path,
        layout_topology_path=layout_path,
        geom_path=geom_path,
        output_dir=output_dir,
        grid_shape=(4, 4, 4),
    )
    for name in ("geometry_after.step", "geometry_after.glb"):
        (output_dir / name).write_text("artifact", encoding="utf-8")

    after_geom_path = output_dir / "geometry_after.geom.json"
    after_geom = json.loads(after_geom_path.read_text(encoding="utf-8"))
    after_geom["install_faces"]["cabin_auto_1.xmax"].update(
        {
            "id": "outer_shell.zmin",
            "side": "outer",
            "plane_axis": 2,
            "plane_value": -15.0,
            "normal_sign": -1,
        }
    )
    component = after_geom["components"]["P_001_internal"]
    component["bbox"] = {"min": [40.0, -10.0, -15.0], "max": [50.0, 10.0, 15.0]}
    component["position"] = [40.0, -10.0, -15.0]
    after_geom_path.write_text(json.dumps(after_geom), encoding="utf-8")

    report = validate_cad_build(
        real_bom_path=real_bom_path,
        layout_topology_path=layout_path,
        geom_path=geom_path,
        cad_dir=output_dir,
        write_back=False,
    )

    assert report["checks"]["mount_contact"]["ok"] is True
    assert not report["checks"]["mount_contact"]["contact_failures"]
