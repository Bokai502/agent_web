from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

import yaml

from core.io import read_json, write_json
from formats.validators import (
    validate_components,
    validate_geometry_registry,
    validate_layout_topology,
    validate_thermal_model,
)
from apps.main_loop.layout_bom_parts import KIND_PREFIX
from apps.main_loop.query_bom_component_info import query_bom_component_info
from apps.main_loop.query_layout_component_info import query_layout_component_info
from pipeline.layout.layout3dcube_backend import convert_sample_to_canonical


def materialize_layout_outputs(
    sample_work_dir: Path,
    layout_dir: Path,
    input_dir: Path,
    component_info_dir: Path,
    real_bom: dict[str, Any],
    source_components: dict[str, Any],
    part_source_map: dict[str, Any],
    thermal_db: Path,
) -> None:
    _copy_layout_files(sample_work_dir, layout_dir)

    sample = yaml.safe_load((layout_dir / "sample.yaml").read_text(encoding="utf-8"))
    geom = read_json(sample_work_dir / "geom" / "geom.json")
    converted = convert_sample_to_canonical(sample)
    attach_traceability(converted, geom, part_source_map)
    strip_geom_legacy_model(geom)

    full_components = build_full_pipeline_components(
        source_components,
        placed_components=converted["components"],
        part_source_map=part_source_map,
    )
    placement_status = build_layout_placement_status(
        full_components=full_components,
        placed_components=converted["components"],
        geom=geom,
    )
    pipeline_real_bom = build_pipeline_real_bom(real_bom, full_components)

    _write_pipeline_inputs(input_dir, real_bom=real_bom, pipeline_real_bom=pipeline_real_bom, full_components=full_components)
    _write_layout_docs(layout_dir, geom=geom, converted=converted, placement_status=placement_status)
    write_component_info_outputs(input_dir, layout_dir, component_info_dir, thermal_db)
    _write_layout_validation(layout_dir, converted=converted, full_components=full_components)


def build_pipeline_real_bom(source_bom: dict[str, Any], components_doc: dict[str, Any]) -> dict[str, Any]:
    items = []
    for component in components_doc.get("components", []):
        source_ref = dict(component.get("source_ref") or {})
        thermal_db_component_id = str(
            component.get("thermal_db_component_id")
            or source_ref.get("thermal_db_component_id")
            or source_ref.get("excel_component_id")
            or component.get("semantic_name")
            or component.get("component_id")
        )
        item = {
            **component,
            "semantic_name": thermal_db_component_id,
            "quantity": 1,
            "material_hint": component.get("material_id", "aluminum_6061"),
        }
        item.pop("thermal_db_component_id", None)
        item.pop("source_ref", None)
        item.pop("component_trace", None)
        items.append(item)
    return {
        "schema_version": "1.0",
        "bom_id": source_bom.get("bom_id", "module_db_bom"),
        "source": {
            **dict(source_bom.get("source") or {}),
            "representation": "pipeline_component_ids",
            "id_policy": "component_id follows canonical pipeline IDs; semantic_name is the Excel/thermal DB lookup key",
        },
        "units": source_bom.get("units", {"length": "mm", "mass": "kg", "power": "W"}),
        "items": items,
    }


def build_full_pipeline_components(
    source_components: dict[str, Any],
    *,
    placed_components: dict[str, Any],
    part_source_map: dict[str, Any],
) -> dict[str, Any]:
    placed_by_component_id = {
        str(component["component_id"]): component
        for component in placed_components.get("components", [])
        if isinstance(component, dict) and component.get("component_id")
    }
    full_components = []
    counters = {"internal": 0, "external": 0, "radiator": 0}
    for source_component in source_components.get("components", []):
        kind = str(source_component["kind"])
        index = counters[kind]
        counters[kind] += 1
        layout_part_id = f"{KIND_PREFIX[kind]}_{index:03d}_{kind}"
        component_id = f"{KIND_PREFIX[kind]}{index:03d}"
        if component_id in placed_by_component_id:
            component = dict(placed_by_component_id[component_id])
        else:
            component = unplaced_pipeline_component(
                source_component,
                component_id=component_id,
                layout_part_id=layout_part_id,
                part_source=part_source_map.get(layout_part_id, {}),
            )
        component["layout_part_id"] = layout_part_id
        component["placement_status"] = "placed" if component_id in placed_by_component_id else "unplaced"
        full_components.append(component)

    return {
        "schema_version": "1.0",
        "components": full_components,
        "source": {
            "backend": "layout3dcube_v2_bom",
            "representation": "complete_pipeline_input_components",
            "id_policy": "component_id follows canonical pipeline IDs; layout_part_id preserves layout3dcube part key",
        },
    }


def unplaced_pipeline_component(
    source_component: dict[str, Any],
    *,
    component_id: str,
    layout_part_id: str,
    part_source: dict[str, Any],
) -> dict[str, Any]:
    semantic_name = str(
        part_source.get("thermal_db_component_id")
        or source_component.get("semantic_name")
        or component_id
    )
    kind = str(source_component["kind"])
    return {
        "component_id": component_id,
        "semantic_name": semantic_name,
        "kind": kind,
        "category": str(source_component.get("category") or "payload"),
        "size_mm": [float(value) for value in source_component["size_mm"]],
        "mass_kg": float(source_component.get("mass_kg", 0.0)),
        "power_W": float(source_component.get("power_W", 0.0)),
        "material_id": source_component.get("material_id", "aluminum_6061"),
        "component_subtype": part_source.get("component_subtype") or source_component.get("component_subtype"),
        "layout_part_id": layout_part_id,
        "placement_status": "unplaced",
        "mounting": default_mounting(component_id),
    }


def default_mounting(component_id: str) -> dict[str, Any]:
    component_mount_face_id = f"{component_id}.local_zmin"
    return {
        "default_component_mount_face_id": component_mount_face_id,
        "mount_faces": [
            {
                "component_mount_face_id": component_mount_face_id,
                "local_face": "zmin",
                "normal_axis": 2,
                "normal_sign": -1,
                "u_axis": 0,
                "v_axis": 1,
            }
        ],
    }


def build_layout_placement_status(
    *,
    full_components: dict[str, Any],
    placed_components: dict[str, Any],
    geom: dict[str, Any],
) -> dict[str, Any]:
    placed_ids = {
        str(component.get("component_id"))
        for component in placed_components.get("components", [])
        if isinstance(component, dict) and component.get("component_id")
    }
    geom_components = geom.get("components") if isinstance(geom.get("components"), dict) else {}
    rows = []
    for component in full_components.get("components", []):
        component_id = str(component["component_id"])
        layout_part_id = str(component.get("layout_part_id") or "")
        geom_component = geom_components.get(layout_part_id, {}) if isinstance(geom_components, dict) else {}
        placed = component_id in placed_ids
        rows.append(
            {
                "component_id": component_id,
                "semantic_name": component.get("semantic_name"),
                "layout_part_id": layout_part_id,
                "kind": component.get("kind"),
                "category": component.get("category"),
                "component_subtype": component.get("component_subtype"),
                "status": "placed" if placed else "unplaced",
                "size_mm": component.get("size_mm"),
                "bbox": geom_component.get("bbox") if placed and isinstance(geom_component, dict) else None,
                "mount_face_id": geom_component.get("mount_face_id") if placed and isinstance(geom_component, dict) else None,
            }
        )
    return {
        "schema_version": "1.0",
        "summary": {
            "total_components": len(rows),
            "placed_components": sum(1 for item in rows if item["status"] == "placed"),
            "unplaced_components": sum(1 for item in rows if item["status"] == "unplaced"),
        },
        "components": rows,
    }


def unplaced_components_doc(placement_status: dict[str, Any]) -> dict[str, Any]:
    unplaced = [
        component
        for component in placement_status.get("components", [])
        if component.get("status") == "unplaced"
    ]
    return {
        "schema_version": "1.0",
        "summary": {
            "unplaced_components": len(unplaced),
        },
        "components": unplaced,
    }


def attach_traceability(
    converted: dict[str, Any],
    geom: dict[str, Any],
    part_source_map: dict[str, Any],
) -> dict[str, Any]:
    traces: list[dict[str, Any]] = []
    trace_by_component_id: dict[str, dict[str, Any]] = {}
    trace_by_layout_id: dict[str, dict[str, Any]] = {}

    for component in converted["components"].get("components", []):
        layout_part_id = str(component.get("semantic_name"))
        source = part_source_map.get(layout_part_id)
        if not source:
            continue
        source_ref = dict(source.get("source_ref") or {})
        trace = {
            "pipeline_component_id": component.get("component_id"),
            "layout3dcube_component_id": layout_part_id,
            "thermal_db_component_id": source.get("thermal_db_component_id"),
            "instance_id": source.get("instance_id"),
            "bom_semantic_name": source.get("semantic_name"),
            "original_semantic_name": source_ref.get("original_semantic_name"),
            "component_subtype": source.get("component_subtype"),
            "source_bom_file": source_ref.get("bom_file"),
            "source_component_id": source_ref.get("source_component_id"),
            "copy_index": source_ref.get("copy_index"),
            "original_kind": source_ref.get("original_kind"),
        }
        merge_trace(component, trace)
        if source.get("component_subtype"):
            component["component_subtype"] = source["component_subtype"]
        trace_by_component_id[str(component["component_id"])] = trace
        trace_by_layout_id[layout_part_id] = trace
        traces.append(trace)

    _merge_trace_collection(converted["layout_topology"].get("placements", []), trace_by_component_id)
    _merge_trace_collection(converted["geometry_registry"].get("entities", []), trace_by_component_id)
    _merge_trace_collection(converted["thermal_model"].get("components", []), trace_by_component_id)
    _merge_trace_collection(converted["simulation_input"].get("components", []), trace_by_component_id)
    _merge_trace_collection(
        (converted["simulation_input"].get("selection_plan") or {}).get("component_selections", []),
        trace_by_component_id,
    )

    for layout_part_id, item in (geom.get("components") or {}).items():
        trace = trace_by_layout_id.get(str(layout_part_id))
        if trace:
            merge_trace(item, trace)

    return {
        "schema_version": "1.0",
        "description": "Trace layout components back to thermal DB component IDs.",
        "components": traces,
    }


def merge_trace(target: dict[str, Any], trace: dict[str, Any]) -> None:
    target.setdefault("component_id", trace.get("pipeline_component_id"))
    target["semantic_name"] = trace.get("thermal_db_component_id")
    target["component_subtype"] = trace.get("component_subtype")
    target.pop("source_ref", None)
    target.pop("component_trace", None)


def strip_geom_legacy_model(geom: dict[str, Any]) -> None:
    for item in (geom.get("components") or {}).values():
        if isinstance(item, dict):
            item.pop("model", None)


def write_component_info_outputs(
    input_dir: Path,
    layout_dir: Path,
    component_info_dir: Path,
    thermal_db: Path,
) -> None:
    component_info_dir.mkdir(parents=True, exist_ok=True)
    query_bom_component_info(
        bom_json=input_dir / "real_bom.json",
        thermal_db=thermal_db,
        output_path=input_dir / "bom_component_info.json",
    )
    query_layout_component_info(
        layout_json=layout_dir / "geom.json",
        bom_json=input_dir / "real_bom.json",
        thermal_db=thermal_db,
        output_path=component_info_dir / "geom_component_info.json",
    )
    query_layout_component_info(
        layout_json=layout_dir / "geometry_registry.json",
        bom_json=input_dir / "real_bom.json",
        thermal_db=thermal_db,
        output_path=component_info_dir / "geometry_registry_component_info.json",
    )


def _copy_layout_files(sample_work_dir: Path, layout_dir: Path) -> None:
    shutil.copy2(sample_work_dir / "sample.yaml", layout_dir / "sample.yaml")
    comsol_inputs = layout_dir / "comsol_inputs"
    comsol_inputs.mkdir(parents=True, exist_ok=True)
    for name in ("coord.txt", "channels_input.npz"):
        source = sample_work_dir / "inputs" / name
        if source.exists():
            shutil.copy2(source, comsol_inputs / name)


def _write_pipeline_inputs(
    input_dir: Path,
    *,
    real_bom: dict[str, Any],
    pipeline_real_bom: dict[str, Any],
    full_components: dict[str, Any],
) -> None:
    write_json(input_dir / "real_bom.json", pipeline_real_bom)
    write_json(input_dir / "components.json", full_components)
    write_json(
        input_dir / "design_input.json",
        {
            "schema_version": "1.0",
            "design_id": f"{real_bom.get('bom_id', 'module_db_bom')}_layout",
            "entry_mode": "real_bom",
            "units": {"length": "mm", "mass": "kg", "power": "W", "temperature": "K"},
            "source": {"type": "real_bom", "files": ["00_inputs/real_bom.json"]},
            "mission": {"description": "Generated from module_db BOM list"},
            "global_constraints": {
                "envelope_size_mm": None,
                "max_mass_kg": None,
                "target_center_of_mass_mm": None,
                "thermal_limits": {"default_allow_min_K": 273.15, "default_allow_max_K": 333.15},
            },
        },
    )
    write_json(
        input_dir / "input_validation.json",
        {"ok": True, "stage": "input_normalize", "entry_mode": "real_bom", "reports": {}},
    )


def _write_layout_docs(
    layout_dir: Path,
    *,
    geom: dict[str, Any],
    converted: dict[str, Any],
    placement_status: dict[str, Any],
) -> None:
    write_json(layout_dir / "geom.json", geom)
    write_json(layout_dir / "placed_components.json", converted["components"])
    write_json(layout_dir / "layout_placement_status.json", placement_status)
    write_json(layout_dir / "unplaced_components.json", unplaced_components_doc(placement_status))
    write_json(layout_dir / "layout_topology.json", converted["layout_topology"])
    write_json(layout_dir / "geometry_registry.json", converted["geometry_registry"])
    write_json(layout_dir / "thermal_model.json", converted["thermal_model"])
    write_json(layout_dir / "simulation_input.json", converted["simulation_input"])


def _write_layout_validation(
    layout_dir: Path,
    *,
    converted: dict[str, Any],
    full_components: dict[str, Any],
) -> None:
    reports = {
        "components": validate_components(full_components).to_dict(),
        "placed_components": validate_components(converted["components"]).to_dict(),
        "geometry_registry": validate_geometry_registry(converted["geometry_registry"], converted["layout_topology"]).to_dict(),
        "thermal_model": validate_thermal_model(converted["thermal_model"], converted["components"], converted["layout_topology"]).to_dict(),
        "layout_topology": validate_layout_topology(
            converted["layout_topology"],
            converted["components"],
            converted["geometry_registry"],
            converted["thermal_model"],
        ).to_dict(),
    }
    write_json(
        layout_dir / "layout_validation.json",
        {
            "ok": all(report["ok"] for report in reports.values()),
            "stage": "layout_generate",
            "backend": "layout3dcube_v2_bom",
            "reports": reports,
        },
    )


def _merge_trace_collection(items: list[dict[str, Any]], trace_by_component_id: dict[str, dict[str, Any]]) -> None:
    for item in items:
        trace = trace_by_component_id.get(str(item.get("component_id")))
        if trace:
            merge_trace(item, trace)
