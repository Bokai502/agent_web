from __future__ import annotations

import json
from pathlib import Path

import pytest

from freecad_cli_tools.component_info_assembly import (
    build_geom_component_info_from_real_bom,
    load_and_normalize_component_info_assembly,
    normalize_component_info_assembly,
)


def sample_layout_topology() -> dict:
    return {
        "schema_version": "1.0",
        "layout_id": "layout-demo",
        "source_design_id": "demo",
        "placements": [
            {
                "component_id": "P001",
                "mount_face_id": "outer.zmin_outer",
                "component_mount_face_id": "P001.local_zmin",
                "alignment": {
                    "normal_alignment": "opposite",
                    "component_u_axis_to_target_u_axis": True,
                    "in_plane_rotation_deg": 0.0,
                },
            },
            {
                "component_id": "P002",
                "mount_face_id": "outer.xmax_inner",
                "component_mount_face_id": "P002.local_xmax",
                "alignment": {
                    "normal_alignment": "opposite",
                    "component_u_axis_to_target_u_axis": True,
                    "in_plane_rotation_deg": 90.0,
                },
            },
        ],
    }


def sample_geom() -> dict:
    return {
        "schema_version": "2.0",
        "outer_shell": {
            "outer_bbox": {"min": [-50, -40, -30], "max": [50, 40, 30]},
            "inner_bbox": {"min": [-48, -38, -28], "max": [48, 38, 28]},
            "thickness": 2.0,
        },
        "components": {
            "P001": {
                "component_id": "P001",
                "position": [1, 2, 3],
                "dims": [10, 20, 30],
                "category": "payload",
                "color": [10, 20, 30, 255],
            },
            "G002": {
                "component_id": "P002",
                "position": [4, 5, 6],
                "dims": [12, 14, 16],
                "category": "avionics",
                "color": [100, 110, 120, 255],
            },
        },
    }


def sample_geom_component_info(step_path: str | None = None) -> dict:
    return {
        "schema_version": "1.0",
        "components": [
            {
                "component_id": "P001",
                "bbox": {"min": [1, 2, 3], "max": [11, 22, 33]},
                "category": "payload",
                "color": [10, 20, 30, 255],
                "display_info": {"assets": {"cad_rotated_path": step_path}},
            },
            {
                "component_id": "P002",
                "position": [4, 5, 6],
                "dims": [12, 14, 16],
            },
        ],
    }


def test_normalize_component_info_assembly_prefers_component_info_bbox(tmp_path: Path) -> None:
    step_path = tmp_path / "thruster.step"
    step_path.write_text("step", encoding="utf-8")

    normalized = normalize_component_info_assembly(
        layout_topology=sample_layout_topology(),
        geom=sample_geom(),
        geom_component_info=sample_geom_component_info(str(step_path)),
        geom_component_info_path=tmp_path / "geom_component_info.json",
    )

    assert normalized["envelope"]["outer_size"] == [100.0, 80.0, 60.0]
    assert normalized["components"]["P001"]["source"]["kind"] == "step"
    assert normalized["components"]["P001"]["source"]["step_size_bytes"] == 4
    assert normalized["components"]["P001"]["source"]["fallback_reason"] is None
    assert normalized["components"]["P001"]["placement"]["mount_face_id"] == "outer.zmin_outer"
    assert normalized["components"]["P001"]["placement"]["install_face"] == 10
    assert normalized["components"]["P001"]["placement"]["component_local_face"] == 4
    assert normalized["components"]["P001"]["target_bbox"]["max"] == [11.0, 22.0, 33.0]
    assert normalized["components"]["P002"]["source"]["kind"] == "box"
    assert normalized["components"]["P002"]["category"] == "avionics"


def test_load_and_normalize_component_info_assembly_reads_files(tmp_path: Path) -> None:
    layout_path = tmp_path / "layout_topology.json"
    geom_path = tmp_path / "geom.json"
    component_info_path = tmp_path / "geom_component_info.json"
    layout_path.write_text(json.dumps(sample_layout_topology()), encoding="utf-8")
    geom_path.write_text(json.dumps(sample_geom()), encoding="utf-8")
    component_info_path.write_text(
        json.dumps(sample_geom_component_info(None)),
        encoding="utf-8",
    )

    normalized = load_and_normalize_component_info_assembly(
        layout_path,
        geom_path,
        component_info_path,
    )

    assert set(normalized["components"]) == {"P001", "P002"}


def test_normalize_component_info_assembly_requires_layout_placement() -> None:
    layout = sample_layout_topology()
    layout["placements"] = layout["placements"][:1]

    with pytest.raises(Exception, match="missing component_id='P002'"):
        normalize_component_info_assembly(
            layout_topology=layout,
            geom=sample_geom(),
            geom_component_info=sample_geom_component_info(None),
            geom_component_info_path="geom_component_info.json",
        )


def test_normalize_component_info_assembly_falls_back_for_oversized_step(tmp_path: Path) -> None:
    step_path = tmp_path / "oversized.step"
    step_path.write_bytes(b"0123456789")

    normalized = normalize_component_info_assembly(
        layout_topology=sample_layout_topology(),
        geom=sample_geom(),
        geom_component_info=sample_geom_component_info(str(step_path)),
        geom_component_info_path=tmp_path / "geom_component_info.json",
        max_step_size_mb=0.000001,
    )

    source = normalized["components"]["P001"]["source"]
    assert source["kind"] == "box"
    assert source["step_path"] is None
    assert source["step_size_bytes"] == 10
    assert source["fallback_reason"] == "file_too_large"


def test_build_geom_component_info_from_real_bom_reads_template_csv_step(tmp_path: Path) -> None:
    step_dir = tmp_path / "refined_coordinate_steps" / "payloads"
    step_dir.mkdir(parents=True)
    step_path = step_dir / "payload.step"
    step_path.write_text("step", encoding="utf-8")
    csv_path = tmp_path / "template.csv"
    csv_path.write_text(
        "器件ID,CAD_rotated_path,CAD_MAJOR_PATH\n"
        "AIRBUS-REFINED-001,refined_coordinate_steps/payloads/payload.step,\n",
        encoding="utf-8",
    )
    real_bom = {
        "source": {"template_csv": str(csv_path)},
        "items": [
            {
                "component_id": "P001",
                "semantic_name": "AIRBUS-REFINED-001",
                "category": "payload",
                "size_mm": [10, 20, 30],
            }
        ],
    }

    component_info = build_geom_component_info_from_real_bom(
        real_bom=real_bom,
        geom=sample_geom(),
        template_csv_base_path=tmp_path / "real_bom.json",
    )

    entry = component_info["components"][0]
    assert entry["component_id"] == "P001"
    assert entry["display_info"]["assets"]["cad_rotated_path"] == str(step_path)
