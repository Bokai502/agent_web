from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Mapping

import yaml

from core.io import read_json, write_json


def run_layout3dcube_v2(output_dir: Path, config: Mapping[str, Any]) -> dict[str, Any]:
    """Run layout3dcube and emit canonical reconstruct layout artifacts."""
    output_dir = Path(output_dir).resolve()
    layout3dcube_root = Path(config["layout3dcube_root"]).resolve()
    dist_yaml = Path(config["dist_yaml"]).resolve()
    staging_dir = output_dir / "_layout3dcube_staging"
    sample_count = int(config.get("sample_count", 1))
    sample_id_start = int(config.get("sample_id_start", 910001))
    parallel = int(config.get("parallel", 1))

    dist = yaml.safe_load(dist_yaml.read_text(encoding="utf-8"))
    dataset_name = dist["dataset"]["name"]
    layout_python = str(config.get("layout_python") or sys.executable)
    cmd = [
        layout_python,
        "batch_generate.py",
        "--dist",
        str(dist_yaml),
        "--output",
        str(staging_dir),
        "--n_samples",
        str(sample_count),
        "--start_id",
        str(sample_id_start),
        "--parallel",
        str(parallel),
    ]
    result = subprocess.run(
        cmd,
        cwd=str(layout3dcube_root),
        text=True,
        capture_output=True,
        timeout=int(config.get("layout_timeout_seconds", 900)),
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip())

    samples_root = staging_dir / dataset_name / "samples"
    sample_dirs = sorted(path for path in samples_root.iterdir() if path.is_dir())
    if not sample_dirs:
        raise RuntimeError(f"layout3dcube did not produce samples under {samples_root}")
    sample_dir = sample_dirs[0]

    sample_yaml_path = sample_dir / "sample.yaml"
    sample = yaml.safe_load(sample_yaml_path.read_text(encoding="utf-8"))

    output_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(sample_dir / "geom" / "geometry.step", output_dir / "geometry.step")
    shutil.copy2(sample_dir / "geom" / "geometry.step", output_dir / "layout_raw.step")
    geom = read_json(sample_dir / "geom" / "geom.json")
    _strip_geom_legacy_model(geom)
    write_json(output_dir / "geom.json", geom)
    shutil.copy2(sample_yaml_path, output_dir / "sample.yaml")
    comsol_inputs = output_dir / "comsol_inputs"
    comsol_inputs.mkdir(parents=True, exist_ok=True)
    for name in ("coord.txt", "channels_input.npz"):
        src = sample_dir / "inputs" / name
        if src.exists():
            shutil.copy2(src, comsol_inputs / name)

    converted = convert_sample_to_canonical(sample)
    write_json(output_dir / "layout_topology.json", converted["layout_topology"])
    write_json(output_dir / "geometry_registry.json", converted["geometry_registry"])
    write_json(output_dir / "thermal_model.json", converted["thermal_model"])
    write_json(output_dir / "simulation_input.json", converted["simulation_input"])
    write_json(
        output_dir / "layout_validation.json",
        {
            "ok": True,
            "stage": "layout_generate",
            "backend": "layout3dcube_v2",
            "reports": {},
        },
    )

    components_output = config.get("components_output")
    if components_output:
        write_json(Path(components_output), converted["components"])

    return {
        "sample_dir": sample_dir,
        "staging_dir": staging_dir,
        "stdout": result.stdout,
        "stderr": result.stderr,
        **converted,
    }


def convert_sample_to_canonical(sample: Mapping[str, Any]) -> dict[str, Any]:
    external_to_component = {
        external_id: _canonical_component_id(external_id)
        for external_id in sample.get("components", {})
    }
    component_to_external = {value: key for key, value in external_to_component.items()}

    components = []
    topology_placements = []
    geometry_entities = []
    thermal_components = []

    for index, (external_id, item) in enumerate(sample.get("components", {}).items(), start=1):
        component_id = external_to_component[external_id]
        pos, dims, bbox_max = _component_world_box(item)
        center = [(pos[axis] + bbox_max[axis]) / 2.0 for axis in range(3)]
        mount_face_id = str(item.get("mount_face_id") or _first_install_face_id(sample))
        local_face = _face_suffix(mount_face_id)
        component_mount_face_id = f"{component_id}.local_{local_face}"
        geometry_id = f"G{index:03d}"
        thermal_id = f"T{index:03d}"
        kind = str(item.get("kind", "internal"))

        components.append(
            {
                "component_id": component_id,
                "semantic_name": external_id,
                "kind": kind,
                "category": str(item.get("category") or "payload"),
                "size_mm": dims,
                "mass_kg": float(item.get("mass", 0.0)),
                "power_W": float(item.get("power", 0.0)),
                "material_id": "aluminum_6061",
                "mounting": {
                    "default_component_mount_face_id": component_mount_face_id,
                    "mount_faces": [_mount_face(component_id, local_face)],
                },
            }
        )
        topology_placements.append(
            {
                "component_id": component_id,
                "semantic_name": external_id,
                "kind": kind,
                "cabin_id": _cabin_id_for_component(sample, item) if kind == "internal" else None,
                "component_mount_face_id": component_mount_face_id,
                "mount_face_id": mount_face_id,
                "alignment": {
                    "normal_alignment": "opposite",
                    "component_u_axis_to_target_u_axis": True,
                    "in_plane_rotation_deg": 0.0,
                },
                "geometry_id": geometry_id,
                "thermal_id": thermal_id,
            }
        )
        geometry_entities.append(
            {
                "geometry_id": geometry_id,
                "component_id": component_id,
                "entity_type": "component_solid",
                "bbox": {"min": pos, "max": bbox_max},
                "center": center,
                "size": dims,
                "step_name": external_id,
            }
        )
        thermal_components.append(
            {
                "thermal_id": thermal_id,
                "component_id": component_id,
                "power_W": float(item.get("power", 0.0)),
                "material_id": "aluminum_6061",
                "surface": {
                    "emissivity": float((item.get("thermal_surface") or {}).get("emissivity", 0.8)),
                    "absorptivity": float((item.get("thermal_surface") or {}).get("absorptivity", 0.3)),
                },
                "interface": {
                    "component_mount_face_id": component_mount_face_id,
                    "mount_face_id": mount_face_id,
                    "contact_resistance": float((item.get("thermal_interface") or {}).get("contact_resistance", 0.001)),
                },
            }
        )

    components_doc = {
        "schema_version": "1.0",
        "components": components,
        "source": {
            "backend": "layout3dcube_v2",
            "component_id_map": component_to_external,
        },
    }
    layout_topology = {
        "schema_version": "1.0",
        "layout_id": f"layout3dcube_{sample.get('sample_id', 'sample')}",
        "source_design_id": str(sample.get("sample_id", "layout3dcube")),
        "outer_shell": {
            "id": "outer_shell",
        },
        "cabins": [
            {
                "id": cabin.get("id", f"cabin_{index}"),
                "parent": cabin.get("parent") or "outer_shell",
                "role": "internal_compartment",
            }
            for index, cabin in enumerate(sample.get("cabins", []), start=1)
        ],
        "walls": sample.get("cabin_walls", []),
        "install_faces": [
            {
                "id": face_id,
                "owner_id": face.get("belongs_to") or face.get("owner_id") or "outer_shell",
                "side": face.get("side", "inner"),
                "face_role": "mount",
                "plane_axis": face.get("plane_axis"),
                "plane_value": face.get("plane_value"),
                "normal_sign": face.get("normal_sign"),
            }
            for face_id, face in sample.get("install_faces", {}).items()
        ],
        "placements": topology_placements,
    }
    geometry_registry = {
        "schema_version": "1.0",
        "units": {"length": "mm"},
        "coordinate_system": "body_fixed_xyz",
        "entities": geometry_entities,
        "faces": [
            {
                "face_id": face_id,
                "owner_id": face.get("belongs_to") or face.get("owner_id") or "outer_shell",
                "plane_axis": int(face.get("plane_axis", 0)),
                "plane_value": float(face.get("plane_value", 0.0)),
                "normal_sign": int(face.get("normal_sign", 1)),
                "bbox_2d": face.get("bbox_2d", []),
                "center_xyz": face.get("center_xyz", []),
            }
            for face_id, face in sample.get("install_faces", {}).items()
        ],
    }
    thermal_model = {
        "schema_version": "1.0",
        "units": {"power": "W", "contact_resistance": "m^2*K/W"},
        "materials": [
            {
                "material_id": "aluminum_6061",
                "conductivity_W_mK": 160,
                "emissivity": 0.8,
            }
        ],
        "components": thermal_components,
    }
    simulation_input = _simulation_input(layout_topology, geometry_registry, thermal_model, components_doc)
    return {
        "components": components_doc,
        "layout_topology": layout_topology,
        "geometry_registry": geometry_registry,
        "thermal_model": thermal_model,
        "simulation_input": simulation_input,
        "component_id_map": component_to_external,
    }


def _simulation_input(
    layout_topology: Mapping[str, Any],
    geometry_registry: Mapping[str, Any],
    thermal_model: Mapping[str, Any],
    components_doc: Mapping[str, Any],
) -> dict[str, Any]:
    components_by_id = {item["component_id"]: item for item in components_doc["components"]}
    geometry_by_id = {item["geometry_id"]: item for item in geometry_registry["entities"]}
    thermal_by_id = {item["thermal_id"]: item for item in thermal_model["components"]}
    sim_components = []
    for placement in layout_topology["placements"]:
        component = components_by_id[placement["component_id"]]
        geometry = geometry_by_id[placement["geometry_id"]]
        thermal = thermal_by_id[placement["thermal_id"]]
        mount_face = component["mounting"]["mount_faces"][0]
        sim_components.append(
            {
                "component_id": component["component_id"],
                "semantic_name": component["semantic_name"],
                "kind": component["kind"],
                "geometry_id": placement["geometry_id"],
                "thermal_id": placement["thermal_id"],
                "component_mount_face_id": placement["component_mount_face_id"],
                "component_mount_face": {
                    "local_face": mount_face["local_face"],
                    "normal_axis": mount_face["normal_axis"],
                    "normal_sign": mount_face["normal_sign"],
                    "u_axis": mount_face["u_axis"],
                    "v_axis": mount_face["v_axis"],
                },
                "mount_face_id": placement["mount_face_id"],
                "alignment": placement["alignment"],
                "is_heat_source": component["kind"] != "radiator" and float(thermal["power_W"]) > 0.0,
                "power_W": thermal["power_W"],
                "material_id": thermal["material_id"],
                "bbox": geometry["bbox"],
                "contact_resistance": thermal["interface"]["contact_resistance"],
            }
        )
    return {
        "schema_version": "1.0",
        "simulation_input_id": f"{layout_topology['layout_id']}_simulation_input",
        "step_file": "geometry.step",
        "source_files": {
            "components": "../00_inputs/components.json",
            "topology": "layout_topology.json",
            "geometry_registry": "geometry_registry.json",
            "thermal_model": "thermal_model.json",
        },
        "units": {"length": "mm", "power": "W", "contact_resistance": "m^2*K/W"},
        "components": sim_components,
        "install_faces": [
            {
                "face_id": face["face_id"],
                "owner_id": face["owner_id"],
                "plane_axis": face["plane_axis"],
                "plane_value": face["plane_value"],
                "normal_sign": face["normal_sign"],
            }
            for face in geometry_registry["faces"]
        ],
        "shells": [{"shell_id": layout_topology["outer_shell"]["id"], "selection_role": "outer_shell"}],
        "cabins": [{"cabin_id": cabin["id"], "selection_role": "internal_domain"} for cabin in layout_topology["cabins"]],
        "radiators": [item["component_id"] for item in sim_components if item["kind"] == "radiator"],
        "selection_plan": {
            "component_selections": [
                {
                    "selection_id": f"sel_{item['component_id']}",
                    "component_id": item["component_id"],
                    "semantic_name": item["semantic_name"],
                    "step_name": item["semantic_name"],
                }
                for item in sim_components
            ],
            "install_face_selections": [
                {
                    "selection_id": f"sel_face_{face['face_id'].replace('.', '_')}",
                    "face_id": face["face_id"],
                }
                for face in geometry_registry["faces"]
            ],
            "shell_selections": [],
        },
    }


def _strip_geom_legacy_model(geom: dict[str, Any]) -> None:
    for item in (geom.get("components") or {}).values():
        if isinstance(item, dict):
            item.pop("model", None)


def _canonical_component_id(external_id: str) -> str:
    prefix = external_id.split("_", 1)[0]
    digits = "".join(char for char in external_id if char.isdigit())
    if not digits:
        digits = "000"
    return f"{prefix.upper()}{int(digits):03d}"


def _component_world_box(item: Mapping[str, Any]) -> tuple[list[float], list[float], list[float]]:
    bbox = item.get("bbox")
    if isinstance(bbox, Mapping) and isinstance(bbox.get("min"), list) and isinstance(bbox.get("max"), list):
        pos = [float(value) for value in bbox["min"]]
        bbox_max = [float(value) for value in bbox["max"]]
        dims = [bbox_max[axis] - pos[axis] for axis in range(3)]
        return pos, dims, bbox_max

    dims = [float(value) for value in item["dims"]]
    pos = [float(value) for value in item["position"]]
    bbox_max = [pos[axis] + dims[axis] for axis in range(3)]
    return pos, dims, bbox_max


def _face_suffix(face_id: str) -> str:
    suffix = face_id.rsplit(".", 1)[-1].replace("_inner", "").replace("_outer", "")
    if suffix not in {"xmin", "xmax", "ymin", "ymax", "zmin", "zmax"}:
        return "zmin"
    return suffix


def _mount_face(component_id: str, local_face: str) -> dict[str, Any]:
    axis = {"x": 0, "y": 1, "z": 2}[local_face[0]]
    sign = -1 if local_face.endswith("min") else 1
    axes = [0, 1, 2]
    axes.remove(axis)
    return {
        "component_mount_face_id": f"{component_id}.local_{local_face}",
        "local_face": local_face,
        "normal_axis": axis,
        "normal_sign": sign,
        "u_axis": axes[0],
        "v_axis": axes[1],
    }


def _first_install_face_id(sample: Mapping[str, Any]) -> str:
    faces = sample.get("install_faces", {})
    return next(iter(faces.keys()), "outer.zmin_inner")


def _cabin_id_for_component(sample: Mapping[str, Any], component: Mapping[str, Any]) -> str | None:
    leaf_node_id = str(component.get("leaf_node_id") or "")
    if "." in leaf_node_id:
        return leaf_node_id.split(".", 1)[1]
    cabins = sample.get("cabins") or []
    return cabins[0].get("id") if cabins else None


def debug_dump(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2)
