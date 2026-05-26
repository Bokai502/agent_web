from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path

import pytest

import freecad_cli_tools.layout_dataset as layout_dataset_module
from freecad_cli_tools.geometry import (
    box_bounds,
    centered_face_position,
    rotation_matrix_from_component,
    update_component_placement,
)
from freecad_cli_tools.layout_dataset import (
    LayoutDatasetError,
    component_local_face_to_face_id,
    layout_mount_face_to_face_id,
    load_and_normalize_layout_dataset,
    normalize_layout_dataset,
    save_layout_dataset_files,
    update_layout_dataset_component_placement,
)


def sample_realistic_layout_dataset() -> tuple[dict, dict]:
    p000_position = [-144.89511395585285, 50.628016611469434, -89.10051419349894]
    e000_dims = [66.33270638512315, 91.51587519468295, 47.89472116237455]
    e000_position = [-81.4401644502338, -28.004797658047018, -100.98845651238274]
    e000_bbox_min = [
        e000_position[0] - e000_dims[0],
        e000_position[1],
        e000_position[2] - e000_dims[2],
    ]

    layout_topology = {
        "schema_version": "1.0",
        "layout_id": "layout3dcube_910001",
        "source_design_id": "910001",
        "outer_shell": {"id": "outer_shell"},
        "cabins": [
            {
                "id": "cabin_auto_1",
                "parent": "outer_shell",
                "role": "internal_compartment",
            }
        ],
        "walls": [],
        "install_faces": [
            {
                "id": "cabin_auto_1.ymax",
                "owner_id": "cabin_auto_1",
                "side": "inner",
                "face_role": "mount",
                "plane_axis": 1,
                "plane_value": 142.1372262179226,
                "normal_sign": 1,
            },
            {
                "id": "outer.zmin_outer",
                "owner_id": "outer_shell",
                "side": "outer",
                "face_role": "mount",
                "plane_axis": 2,
                "plane_value": -100.98845651238273,
                "normal_sign": -1,
            },
        ],
        "placements": [
            {
                "component_id": "P000",
                "semantic_name": "P_000_internal",
                "kind": "internal",
                "cabin_id": "cabin_auto_1",
                "component_mount_face_id": "P000.local_ymax",
                "mount_face_id": "cabin_auto_1.ymax",
                "alignment": {
                    "normal_alignment": "opposite",
                    "component_u_axis_to_target_u_axis": True,
                    "in_plane_rotation_deg": 0.0,
                },
            },
            {
                "component_id": "E000",
                "semantic_name": "E_000_external",
                "kind": "external",
                "cabin_id": None,
                "component_mount_face_id": "E000.local_zmin",
                "mount_face_id": "outer.zmin_outer",
                "alignment": {
                    "normal_alignment": "opposite",
                    "component_u_axis_to_target_u_axis": True,
                    "in_plane_rotation_deg": 0.0,
                },
            },
        ],
    }
    geom = {
        "schema_version": "2.0",
        "units": {"length": "mm", "mass": "kg", "power": "W"},
        "meta": {},
        "outer_shell": {
            "id": "outer_shell",
            "outer_bbox": {
                "min": [-156.78305627473662, -145.0149830974267, -100.98845651238273],
                "max": [156.78305627473662, 145.0149830974267, 100.98845651238273],
            },
            "inner_bbox": {
                "min": [-153.90529939523253, -142.1372262179226, -98.11069963287862],
                "max": [153.90529939523253, 142.1372262179226, 98.11069963287862],
            },
            "thickness": 2.877756879504105,
        },
        "install_faces": {
            "cabin_auto_1.ymax": {
                "id": "cabin_auto_1.ymax",
                "belongs_to": "cabin_auto_1",
                "side": "inner",
                "cabin_face_tag": "ymax",
                "plane_axis": 1,
                "plane_value": 142.1372262179226,
                "normal_sign": 1,
                "bbox_2d": [
                    -153.90529939523253,
                    153.90529939523253,
                    -98.11069963287862,
                    98.11069963287862,
                ],
                "center_xyz": [0.0, 142.1372262179226, 0.0],
                "extents_xyz": [307.81059879046506, 0.0, 196.22139926575724],
            },
            "outer.zmin_outer": {
                "id": "outer.zmin_outer",
                "belongs_to": "outer_shell",
                "side": "outer",
                "cabin_face_tag": "zmin",
                "plane_axis": 2,
                "plane_value": -100.98845651238273,
                "normal_sign": -1,
                "bbox_2d": [
                    -156.78305627473662,
                    156.78305627473662,
                    -145.0149830974267,
                    145.0149830974267,
                ],
                "center_xyz": [0.0, 0.0, -100.98845651238273],
                "extents_xyz": [313.56611254947325, 290.0299661948534, 0.0],
            },
        },
        "components": {
            "P_000_internal": {
                "id": "P_000_internal",
                "component_id": "P000",
                "kind": "internal",
                "category": "avionics",
                "dims": [10.0, 20.0, 30.0],
                "mass": 1.0,
                "power": 2.0,
                "color": [255, 200, 100, 255],
                "shape": "box",
                "model": "",
                "mount_face_id": "cabin_auto_1.ymax",
                "position": p000_position,
                "install_pos": p000_position,
            },
            "E_000_external": {
                "id": "E_000_external",
                "component_id": "E000",
                "kind": "external",
                "category": "payload",
                "dims": e000_dims,
                "mass": 3.0,
                "power": 4.0,
                "color": [100, 180, 255, 255],
                "shape": "box",
                "model": "",
                "mount_face_id": "outer.zmin_outer",
                "position": e000_bbox_min,
                "install_pos": e000_bbox_min,
            },
        },
    }

    normalized = normalize_layout_dataset(layout_topology, geom)
    updated_layout_topology, updated_geom = update_layout_dataset_component_placement(
        layout_topology,
        geom,
        "P000",
        normalized["components"]["P000"],
    )
    normalized = normalize_layout_dataset(updated_layout_topology, updated_geom)
    updated_layout_topology, updated_geom = update_layout_dataset_component_placement(
        updated_layout_topology,
        updated_geom,
        "E000",
        normalized["components"]["E000"],
    )
    return updated_layout_topology, updated_geom


def test_face_id_parsers_map_layout_dataset_ids() -> None:
    assert component_local_face_to_face_id("P000.local_ymax") == 3
    assert component_local_face_to_face_id("E000.local_zmin") == 4
    assert layout_mount_face_to_face_id("cabin_auto_1.xmax") == 1
    assert layout_mount_face_to_face_id("outer.zmin_outer") == 10


def test_real_layout_dataset_normalizes_into_build_spec(tmp_path: Path) -> None:
    layout_topology, geom = sample_realistic_layout_dataset()
    dataset_dir = tmp_path / "dataset"
    dataset_dir.mkdir(parents=True)
    (dataset_dir / "layout_topology.json").write_text(
        json.dumps(layout_topology, indent=2), encoding="utf-8"
    )
    (dataset_dir / "geom.json").write_text(json.dumps(geom, indent=2), encoding="utf-8")
    normalized = load_and_normalize_layout_dataset(
        dataset_dir / "layout_topology.json",
        dataset_dir / "geom.json",
    )

    assert normalized["envelope"]["outer_size"] == pytest.approx(
        [313.56611254947325, 290.0299661948534, 201.97691302476545]
    )
    assert normalized["envelope"]["inner_size"] == pytest.approx(
        [307.81059879046506, 284.2744524358452, 196.22139926575724]
    )
    assert len(normalized["components"]) == 2

    p000 = normalized["components"]["P000"]
    assert p000["component_id"] == "P000"
    assert p000["placement"]["mount_face_id"] == "cabin_auto_1.ymax"
    assert p000["placement"]["component_mount_face_id"] == "P000.local_ymax"
    assert p000["placement"]["position"] == pytest.approx(
        [-144.89511395585285, 50.628016611469434, -89.10051419349894]
    )

    e000 = normalized["components"]["E000"]
    assert e000["component_id"] == "E000"
    assert e000["placement"]["mount_face_id"] == "outer.zmin_outer"
    assert e000["placement"]["component_mount_face_id"] == "E000.local_zmin"
    assert e000["placement"]["position"] == pytest.approx(
        [-81.4401644502338, -28.004797658047018, -100.98845651238274]
    )

    for component in normalized["components"].values():
        bounds = box_bounds(
            component["placement"]["position"],
            component["dims"],
            rotation_matrix_from_component(component),
        )
        bbox_min = [axis_bounds[0] for axis_bounds in bounds]
        assert bbox_min == pytest.approx(component["source_bbox_min"])


def test_round_trip_preserves_real_component_dataset_fields() -> None:
    layout_topology, geom = sample_realistic_layout_dataset()
    normalized = normalize_layout_dataset(layout_topology, geom)

    updated_layout_topology, updated_geom = update_layout_dataset_component_placement(
        layout_topology,
        geom,
        "E000",
        normalized["components"]["E000"],
    )

    original_placement = next(
        placement
        for placement in layout_topology["placements"]
        if placement["component_id"] == "E000"
    )
    updated_placement = next(
        placement
        for placement in updated_layout_topology["placements"]
        if placement["component_id"] == "E000"
    )
    assert updated_placement["mount_face_id"] == original_placement["mount_face_id"]
    assert updated_placement["cabin_id"] == original_placement["cabin_id"]
    assert updated_placement["alignment"] == original_placement["alignment"]

    original_geom_component = geom["components"]["E_000_external"]
    updated_geom_component = updated_geom["components"]["E_000_external"]
    assert updated_geom_component["position"] == pytest.approx(original_geom_component["position"])
    assert updated_geom_component["mount_point"] == pytest.approx(
        original_geom_component["mount_point"]
    )
    assert updated_geom_component["install_pos"] == pytest.approx(
        original_geom_component["install_pos"]
    )
    assert updated_geom_component["leaf_node_id"] == original_geom_component["leaf_node_id"]


def test_round_trip_preserves_modeled_pose_after_face_change() -> None:
    layout_topology, geom = sample_realistic_layout_dataset()
    normalized = normalize_layout_dataset(layout_topology, geom)
    target = normalized["components"]["E000"]
    extents = target["dims"]
    wall_size = normalized["envelope"]["inner_size"]
    component_face = component_local_face_to_face_id(target["placement"]["component_mount_face_id"])
    final_position, _, rotation_matrix = centered_face_position(
        extents,
        wall_size,
        component_face,
        3,
    )
    updated_normalized = update_component_placement(
        normalized,
        "E000",
        final_position,
        3,
        rotation_matrix=rotation_matrix,
    )

    updated_layout_topology, updated_geom = update_layout_dataset_component_placement(
        layout_topology,
        geom,
        "E000",
        updated_normalized["components"]["E000"],
    )
    renormalized = normalize_layout_dataset(updated_layout_topology, updated_geom)
    updated_component = renormalized["components"]["E000"]
    updated_placement = next(
        placement
        for placement in updated_layout_topology["placements"]
        if placement["component_id"] == "E000"
    )

    assert updated_placement["cabin_id"] == "cabin_auto_1"
    assert updated_placement["mount_face_id"] == "cabin_auto_1.ymax"
    assert updated_placement["alignment"]["in_plane_rotation_deg"] == 0.0
    assert updated_geom["components"]["E_000_external"]["leaf_node_id"] == "leaf.cabin_auto_1"
    assert updated_component["placement"]["mount_face_id"] == "cabin_auto_1.ymax"
    assert updated_component["placement"]["position"] == pytest.approx(final_position)
    assert rotation_matrix_from_component(updated_component) == rotation_matrix


def test_internal_face_resolution_raises_when_multiple_cabins_match() -> None:
    layout_topology, geom = sample_realistic_layout_dataset()
    updated_layout_topology = deepcopy(layout_topology)
    updated_layout_topology["cabins"].append(
        {
            "id": "cabin_auto_2",
            "parent": "outer_shell",
            "role": "internal_compartment",
        }
    )
    duplicated_faces = []
    for face in updated_layout_topology["install_faces"]:
        if face["owner_id"] != "cabin_auto_1":
            continue
        duplicate = deepcopy(face)
        duplicate["id"] = duplicate["id"].replace("cabin_auto_1", "cabin_auto_2")
        duplicate["owner_id"] = "cabin_auto_2"
        duplicated_faces.append(duplicate)
    updated_layout_topology["install_faces"].extend(duplicated_faces)

    normalized_component = {
        "id": "E000",
        "component_id": "E000",
        "shape": "box",
        "dims": [66.33270638512315, 91.51587519468295, 47.89472116237455],
        "placement": {
            "position": [0.0, 0.0, 0.0],
            "mount_face_id": "outer.ymax_inner",
            "component_mount_face_id": "E000.local_zmin",
            "alignment": {
                "normal_alignment": "opposite",
                "component_u_axis_to_target_u_axis": True,
                "in_plane_rotation_deg": 0.0,
            },
        },
    }

    with pytest.raises(LayoutDatasetError, match="Ambiguous internal install face"):
        update_layout_dataset_component_placement(
            updated_layout_topology,
            geom,
            "E000",
            normalized_component,
        )


def test_internal_face_resolution_preserves_current_cabin_when_multiple_exist() -> None:
    layout_topology, geom = sample_realistic_layout_dataset()
    updated_layout_topology = deepcopy(layout_topology)
    updated_layout_topology["cabins"].append(
        {
            "id": "cabin_auto_2",
            "parent": "outer_shell",
            "role": "internal_compartment",
        }
    )
    duplicated_faces = []
    for face in updated_layout_topology["install_faces"]:
        if face["owner_id"] != "cabin_auto_1":
            continue
        duplicate = deepcopy(face)
        duplicate["id"] = duplicate["id"].replace("cabin_auto_1", "cabin_auto_2")
        duplicate["owner_id"] = "cabin_auto_2"
        duplicated_faces.append(duplicate)
    updated_layout_topology["install_faces"].extend(duplicated_faces)

    normalized = normalize_layout_dataset(updated_layout_topology, geom)
    updated_layout_topology_after, _ = update_layout_dataset_component_placement(
        updated_layout_topology,
        geom,
        "P000",
        normalized["components"]["P000"],
    )
    updated_placement = next(
        placement
        for placement in updated_layout_topology_after["placements"]
        if placement["component_id"] == "P000"
    )
    assert updated_placement["cabin_id"] == "cabin_auto_1"
    assert updated_placement["mount_face_id"] == "cabin_auto_1.ymax"


def test_save_layout_dataset_files_rolls_back_first_file_on_second_write_failure(
    monkeypatch, tmp_path: Path
) -> None:
    layout_path = tmp_path / "layout_topology.json"
    geom_path = tmp_path / "geom.json"
    original_layout = {"version": 1}
    original_geom = {"version": 1}
    layout_path.write_text(json.dumps(original_layout), encoding="utf-8")
    geom_path.write_text(json.dumps(original_geom), encoding="utf-8")

    real_replace = layout_dataset_module.os.replace
    replace_calls = {"count": 0}

    def flaky_replace(src, dst):
        replace_calls["count"] += 1
        if replace_calls["count"] == 2:
            raise OSError("simulated geom write failure")
        return real_replace(src, dst)

    monkeypatch.setattr(layout_dataset_module.os, "replace", flaky_replace)

    with pytest.raises(OSError, match="simulated geom write failure"):
        save_layout_dataset_files(
            layout_path,
            {"version": 2},
            geom_path,
            {"version": 2},
        )

    assert json.loads(layout_path.read_text(encoding="utf-8")) == original_layout
    assert json.loads(geom_path.read_text(encoding="utf-8")) == original_geom
