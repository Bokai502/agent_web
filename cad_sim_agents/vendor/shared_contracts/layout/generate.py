from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping

from core.io import read_json, write_json
from core.stages import StageResult
from formats.validators import (
    validate_components,
    validate_geometry_registry,
    validate_layout_topology,
    validate_simulation_input,
    validate_thermal_model,
)
from pipeline.layout.layout3dcube_backend import run_layout3dcube_v2


def run_stage(
    input_dir: Path,
    output_dir: Path,
    config: Mapping[str, Any] | None = None,
) -> StageResult:
    """Generate minimal canonical layout artifacts from ``components.json``."""
    config = config or {}
    input_dir = Path(input_dir)
    output_dir = Path(output_dir)
    result = StageResult(
        stage_name="layout_generate",
        status="running",
        inputs={"input_dir": input_dir, "config": dict(config)},
        outputs={"output_dir": output_dir},
    )
    reports: dict[str, Any] = {}
    try:
        backend = str(config.get("layout_backend", "mock_contract"))
        if backend == "layout3dcube_v2":
            converted = run_layout3dcube_v2(output_dir, config)
            components = converted["components"]
            layout = converted["layout_topology"]
            geometry = converted["geometry_registry"]
            thermal = converted["thermal_model"]
            simulation_input = converted["simulation_input"]
            reports["components"] = validate_components(components).to_dict()
            reports["geometry_registry"] = validate_geometry_registry(geometry, layout).to_dict()
            reports["thermal_model"] = validate_thermal_model(thermal, components, layout).to_dict()
            reports["layout_topology"] = validate_layout_topology(layout, components, geometry, thermal).to_dict()
            reports["simulation_input"] = validate_simulation_input(simulation_input, output_dir / "geometry.step").to_dict()
            if not all(report["ok"] for report in reports.values()):
                return _finish_failed(result, reports)
            result.outputs.update(
                {
                    "layout_topology": output_dir / "layout_topology.json",
                    "geometry_registry": output_dir / "geometry_registry.json",
                    "thermal_model": output_dir / "thermal_model.json",
                    "simulation_input": output_dir / "simulation_input.json",
                    "geometry_step": output_dir / "geometry.step",
                    "sample_yaml": output_dir / "sample.yaml",
                    "geom_json": output_dir / "geom.json",
                    "layout_validation": output_dir / "layout_validation.json",
                }
            )
            if config.get("components_output"):
                result.outputs["components"] = Path(config["components_output"])
            result.checks = reports
            return result.finish("completed")

        components = read_json(input_dir / "components.json")
        components_validation = validate_components(components)
        reports["components"] = components_validation.to_dict()
        if not components_validation.ok:
            return _finish_failed(result, reports)

        layout = build_layout_topology(components, config)
        geometry = build_geometry_registry(components, layout, config)
        thermal = build_thermal_model(components, layout, config)
        simulation_input = build_simulation_input(components, layout, geometry, thermal)

        reports["geometry_registry"] = validate_geometry_registry(geometry, layout).to_dict()
        reports["thermal_model"] = validate_thermal_model(thermal, components, layout).to_dict()
        reports["layout_topology"] = validate_layout_topology(layout, components, geometry, thermal).to_dict()

        step_path = output_dir / "geometry.step"
        write_placeholder_step(step_path, components)
        reports["simulation_input"] = validate_simulation_input(simulation_input, step_path).to_dict()
        if not all(report["ok"] for report in reports.values()):
            return _finish_failed(result, reports)

        outputs = {
            "layout_topology": write_json(output_dir / "layout_topology.json", layout),
            "geometry_registry": write_json(output_dir / "geometry_registry.json", geometry),
            "thermal_model": write_json(output_dir / "thermal_model.json", thermal),
            "simulation_input": write_json(output_dir / "simulation_input.json", simulation_input),
            "geometry_step": step_path,
            "layout_validation": write_json(
                output_dir / "layout_validation.json",
                {
                    "ok": True,
                    "stage": "layout_generate",
                    "reports": reports,
                },
            ),
        }
        result.outputs.update(outputs)
        result.checks = reports
        return result.finish("completed")
    except Exception as exc:
        result.errors.append({"type": exc.__class__.__name__, "message": str(exc)})
        return result.finish("failed")


def build_layout_topology(
    components: Mapping[str, Any],
    config: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    config = config or {}
    layout_id = str(config.get("layout_id", "layout_minimal"))
    cabin_id = str(config.get("default_cabin_id", "cabin_main"))
    mount_face_id = f"{cabin_id}.zmin"
    placements = []
    for index, component in enumerate(components["components"], start=1):
        component_id = component["component_id"]
        placements.append(
            {
                "component_id": component_id,
                "semantic_name": component["semantic_name"],
                "kind": component["kind"],
                "cabin_id": cabin_id if component["kind"] == "internal" else None,
                "component_mount_face_id": component["mounting"]["default_component_mount_face_id"],
                "mount_face_id": mount_face_id,
                "alignment": {
                    "normal_alignment": "opposite",
                    "component_u_axis_to_target_u_axis": True,
                    "in_plane_rotation_deg": 0.0,
                },
                "geometry_id": f"G{index:03d}",
                "thermal_id": f"T{index:03d}",
            }
        )
    return {
        "schema_version": "1.0",
        "layout_id": layout_id,
        "source_design_id": str(config.get("source_design_id", "unknown_design")),
        "outer_shell": {
            "id": "satellite_bus_shell",
        },
        "cabins": [
            {
                "id": cabin_id,
                "parent": "satellite_bus_shell",
                "role": "internal_compartment",
            }
        ],
        "walls": [],
        "install_faces": [
            {
                "id": mount_face_id,
                "owner_id": cabin_id,
                "side": "inner",
                "face_role": "internal_mount",
            }
        ],
        "placements": placements,
    }


def build_geometry_registry(
    components: Mapping[str, Any],
    layout: Mapping[str, Any],
    config: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    config = config or {}
    gap_mm = float(config.get("component_gap_mm", 10.0))
    cursor_x = 0.0
    entities = []
    placements_by_component = {
        placement["component_id"]: placement for placement in layout["placements"]
    }
    for component in components["components"]:
        size = [float(value) for value in component["size_mm"]]
        bbox_min = [round(cursor_x, 6), 0.0, 0.0]
        bbox_max = [round(cursor_x + size[0], 6), size[1], size[2]]
        center = [round((bbox_min[axis] + bbox_max[axis]) / 2.0, 6) for axis in range(3)]
        placement = placements_by_component[component["component_id"]]
        entities.append(
            {
                "geometry_id": placement["geometry_id"],
                "component_id": component["component_id"],
                "entity_type": "component_solid",
                "bbox": {
                    "min": bbox_min,
                    "max": bbox_max,
                },
                "center": center,
                "size": size,
                "step_name": component["component_id"],
            }
        )
        cursor_x += size[0] + gap_mm
    return {
        "schema_version": "1.0",
        "units": {
            "length": "mm",
        },
        "coordinate_system": "body_fixed_xyz",
        "entities": entities,
        "faces": [
            {
                "face_id": layout["install_faces"][0]["id"],
                "owner_id": layout["install_faces"][0]["owner_id"],
                "plane_axis": 2,
                "plane_value": 0.0,
                "normal_sign": -1,
                "bbox_2d": [0.0, max(cursor_x - gap_mm, 1.0), 0.0, 1000.0],
                "center_xyz": [round(max(cursor_x - gap_mm, 1.0) / 2.0, 6), 500.0, 0.0],
            }
        ],
    }


def build_thermal_model(
    components: Mapping[str, Any],
    layout: Mapping[str, Any],
    config: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    config = config or {}
    default_contact_resistance = float(config.get("default_contact_resistance", 0.001))
    placements_by_component = {
        placement["component_id"]: placement for placement in layout["placements"]
    }
    thermal_components = []
    for component in components["components"]:
        placement = placements_by_component[component["component_id"]]
        thermal_components.append(
            {
                "thermal_id": placement["thermal_id"],
                "component_id": component["component_id"],
                "power_W": float(component["power_W"]),
                "material_id": component.get("material_id", "aluminum_6061"),
                "surface": {
                    "emissivity": 0.8,
                    "absorptivity": 0.3,
                },
                "interface": {
                    "component_mount_face_id": placement["component_mount_face_id"],
                    "mount_face_id": placement["mount_face_id"],
                    "contact_resistance": default_contact_resistance,
                },
            }
        )
    return {
        "schema_version": "1.0",
        "units": {
            "power": "W",
            "contact_resistance": "m^2*K/W",
        },
        "materials": [
            {
                "material_id": "aluminum_6061",
                "conductivity_W_mK": 160,
                "emissivity": 0.8,
            }
        ],
        "components": thermal_components,
    }


def build_simulation_input(
    components: Mapping[str, Any],
    layout: Mapping[str, Any],
    geometry: Mapping[str, Any],
    thermal: Mapping[str, Any],
) -> dict[str, Any]:
    components_by_id = {component["component_id"]: component for component in components["components"]}
    geometry_by_id = {entity["geometry_id"]: entity for entity in geometry["entities"]}
    thermal_by_id = {item["thermal_id"]: item for item in thermal["components"]}
    simulation_components = []
    for placement in layout["placements"]:
        component = components_by_id[placement["component_id"]]
        geometry_entity = geometry_by_id[placement["geometry_id"]]
        thermal_item = thermal_by_id[placement["thermal_id"]]
        mount_face = _mount_face_by_id(component, placement["component_mount_face_id"])
        simulation_components.append(
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
                "alignment": {
                    "normal_alignment": placement["alignment"]["normal_alignment"],
                    "in_plane_rotation_deg": placement["alignment"]["in_plane_rotation_deg"],
                },
                "is_heat_source": component["kind"] != "radiator" and float(thermal_item["power_W"]) > 0.0,
                "power_W": thermal_item["power_W"],
                "material_id": thermal_item["material_id"],
                "bbox": geometry_entity["bbox"],
                "contact_resistance": thermal_item["interface"]["contact_resistance"],
            }
        )
    return {
        "schema_version": "1.0",
        "simulation_input_id": f"{layout['layout_id']}_simulation_input",
        "step_file": "geometry.step",
        "source_files": {
            "components": "../00_inputs/components.json",
            "topology": "layout_topology.json",
            "geometry_registry": "geometry_registry.json",
            "thermal_model": "thermal_model.json",
        },
        "units": {
            "length": "mm",
            "power": "W",
            "contact_resistance": "m^2*K/W",
        },
        "components": simulation_components,
        "install_faces": [
            {
                "face_id": face["face_id"],
                "owner_id": face["owner_id"],
                "plane_axis": face["plane_axis"],
                "plane_value": face["plane_value"],
                "normal_sign": face["normal_sign"],
            }
            for face in geometry["faces"]
        ],
        "shells": [
            {
                "shell_id": layout["outer_shell"]["id"],
                "selection_role": "outer_shell",
            }
        ],
        "cabins": [
            {
                "cabin_id": cabin["id"],
                "selection_role": "internal_domain",
            }
            for cabin in layout["cabins"]
        ],
        "radiators": [
            component["component_id"]
            for component in simulation_components
            if component["kind"] == "radiator"
        ],
        "selection_plan": {
            "component_selections": [
                {
                    "selection_id": f"sel_{component['component_id']}",
                    "component_id": component["component_id"],
                    "semantic_name": component["semantic_name"],
                    "step_name": component["component_id"],
                }
                for component in simulation_components
            ],
            "install_face_selections": [
                {
                    "selection_id": f"sel_face_{face['face_id'].replace('.', '_')}",
                    "face_id": face["face_id"],
                }
                for face in geometry["faces"]
            ],
            "shell_selections": [],
        },
    }


def write_placeholder_step(path: Path, components: Mapping[str, Any]) -> Path:
    """Write a tiny STEP-like audit file for contract tests.

    Real geometry export will replace this in the FreeCAD/CAD stage. The file is
    non-empty so downstream validators can enforce the simulation input boundary.
    """
    component_names = ", ".join(component["component_id"] for component in components["components"])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "\n".join(
            [
                "ISO-10303-21;",
                "HEADER;",
                "FILE_DESCRIPTION(('reconstruct placeholder geometry'), '2;1');",
                f"FILE_NAME('geometry.step', '1970-01-01T00:00:00', ('{component_names}'), (''), '', '', '');",
                "ENDSEC;",
                "DATA;",
                "ENDSEC;",
                "END-ISO-10303-21;",
                "",
            ]
        ),
        encoding="utf-8",
    )
    return path


def _mount_face_by_id(component: Mapping[str, Any], component_mount_face_id: str) -> Mapping[str, Any]:
    for face in component["mounting"]["mount_faces"]:
        if face["component_mount_face_id"] == component_mount_face_id:
            return face
    raise KeyError(component_mount_face_id)


def _finish_failed(result: StageResult, reports: dict[str, Any]) -> StageResult:
    result.checks = reports
    result.errors = [
        check
        for report in reports.values()
        if isinstance(report, Mapping) and not report.get("ok", True)
        for check in report.get("failed_checks", [])
    ]
    return result.finish("failed")
