from __future__ import annotations

from copy import deepcopy
import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any, Mapping

import yaml

from core.io import read_json, write_json
from apps.main_loop.run_bom_layout_batch import run_one_bom_layout


def run_freecad_skill_cli(
    input_dir: Path,
    output_dir: Path,
    config: Mapping[str, Any],
    before_geometry: Mapping[str, Any],
) -> dict[str, Any]:
    """Run the FreeCAD skill CLI workflow for stage 02.

    This backend intentionally calls the stable CLI tools behind the Codex
    FreeCAD skill instead of depending on Codex runtime skill loading.
    """
    input_dir = Path(input_dir).resolve()
    output_dir = Path(output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    before_step = output_dir / "geometry_before.step"
    after_step = output_dir / "geometry_after.step"
    after_glb = after_step.with_suffix(".glb")
    for stale_path in (before_step, after_step, after_glb):
        if stale_path.exists():
            stale_path.unlink()

    edit_plan = _load_edit_plan(config)
    edit_plan_path = write_json(output_dir / "edit_plan.json", edit_plan)

    source_topology = input_dir / "layout_topology.json"
    source_geom = input_dir / "geom.json"
    after_topology = output_dir / "geometry_after.layout_topology.json"
    after_geom = output_dir / "geometry_after.geom.json"
    sync_after_state_companion_files(input_dir, output_dir)

    command_records: list[dict[str, Any]] = []
    current_topology = source_topology
    current_geom = source_geom
    actions = edit_plan.get("actions", [])
    if not actions:
        shutil.copy2(source_topology, after_topology)
        shutil.copy2(source_geom, after_geom)

    relayout_result: dict[str, Any] | None = None
    for index, action in enumerate(actions):
        action_type = _normalize_action_type(str(action.get("type") or ""))
        final_action = index == len(actions) - 1
        step_topology = after_topology if final_action else output_dir / f"geometry_after_{index + 1:02d}.layout_topology.json"
        step_geom = after_geom if final_action else output_dir / f"geometry_after_{index + 1:02d}.geom.json"
        if action_type == "expand_shell_then_relayout":
            if index != 0:
                raise RuntimeError("expand_shell_then_relayout must be the first and only official expansion action")
            if len(actions) != 1:
                raise RuntimeError("expand_shell_then_relayout cannot be combined with patch actions in official mode")
            relayout_result = apply_expand_shell_then_relayout(
                output_dir=output_dir,
                action=action,
                config=config,
            )
            command_records.append(relayout_result["command_record"])
            break
        if action_type == "move_component":
            cmd = build_layout_safe_move_command(
                layout_topology=current_topology,
                geom=current_geom,
                layout_topology_output=step_topology,
                geom_output=step_geom,
                action=action,
                output_dir=output_dir,
                config=config,
            )
            command_records.append(_run_command(cmd, config))
        elif action_type == "add_component":
            command_records.append(
                apply_add_component_dataset_edit(
                    layout_topology=current_topology,
                    geom=current_geom,
                    layout_topology_output=step_topology,
                    geom_output=step_geom,
                    action=action,
                )
            )
        elif action_type == "expand_shell":
            command_records.append(
                apply_expand_shell_dataset_edit(
                    layout_topology=current_topology,
                    geom=current_geom,
                    layout_topology_output=step_topology,
                    geom_output=step_geom,
                    action=action,
                )
            )
        elif action_type == "delete_component":
            command_records.append(
                apply_delete_component_dataset_edit(
                    layout_topology=current_topology,
                    geom=current_geom,
                    layout_topology_output=step_topology,
                    geom_output=step_geom,
                    action=action,
                )
            )
        else:
            raise RuntimeError(f"freecad_skill_cli unsupported action type: {action.get('type')!r}")
        current_topology = step_topology
        current_geom = step_geom

    if relayout_result:
        shutil.copy2(relayout_result["layout_topology_path"], after_topology)
        shutil.copy2(relayout_result["geom_path"], after_geom)
        relayout_layout_dir = Path(relayout_result["layout_dir"])
        for name in ("sample.yaml", "simulation_input.json"):
            src = relayout_layout_dir / name
            if src.exists():
                shutil.copy2(src, output_dir / name)
        relayout_comsol_inputs = relayout_layout_dir / "comsol_inputs"
        if relayout_comsol_inputs.exists():
            output_comsol_inputs = output_dir / "comsol_inputs"
            if output_comsol_inputs.exists():
                shutil.rmtree(output_comsol_inputs)
            shutil.copytree(relayout_comsol_inputs, output_comsol_inputs)

    cad_rebuilt = False
    step_from_relayout = False
    rebuild_record: dict[str, Any] | None = None
    if relayout_result:
        relayout_step = Path(relayout_result["layout_dir"]) / "geometry.step"
        if relayout_step.exists():
            shutil.copy2(relayout_step, after_step)
            step_from_relayout = True
    if config.get("rebuild_cad_after_edit") and not step_from_relayout:
        for stale_path in (after_step, after_glb):
            if stale_path.exists():
                stale_path.unlink()
        build_cmd = build_create_assembly_command(
            layout_topology=after_topology,
            geom=after_geom,
            output_dir=output_dir,
            config=config,
        )
        rebuild_record = _run_command(build_cmd, config)
        command_records.append(rebuild_record)
        cad_rebuilt = after_step.exists()

    cad_synced = after_step.exists()
    step_copied_from_source = False
    if not cad_synced:
        step_copied_from_source = False

    after_geom_data = read_json(after_geom)
    if _normalize_geom_component_bboxes(after_geom_data):
        write_json(after_geom, after_geom_data)
    if relayout_result:
        after_registry = read_json(relayout_result["geometry_registry_path"])
        after_registry["source"] = {
            **dict(after_registry.get("source") or {}),
            "stage": "02_geometry_edit",
            "method": "expand_shell_then_relayout",
            "layout_topology": "geometry_after.layout_topology.json",
            "geom": "geometry_after.geom.json",
            "step_file": "geometry_after.step",
            "cad_synced": cad_synced,
            "cad_rebuilt": cad_rebuilt,
            "step_from_relayout": step_from_relayout,
            "step_copied_from_source": step_copied_from_source,
            "edit_plan": "edit_plan.json",
            "relayout_result": "relayout_result.json",
        }
    else:
        after_registry = build_geometry_after_registry_from_geom(
            after_geom_data,
            before_geometry,
            source={
                "stage": "02_geometry_edit",
                "method": "freecad_skill_cli_layout_dataset",
                "layout_topology": "geometry_after.layout_topology.json",
                "geom": "geometry_after.geom.json",
                "step_file": "geometry_after.step",
                "cad_synced": cad_synced,
                "cad_rebuilt": cad_rebuilt,
                "step_copied_from_source": step_copied_from_source,
                "edit_plan": "edit_plan.json",
            },
        )
    sync_simulation_input_after_registry(output_dir, after_registry)
    sync_sample_yaml_after_registry(output_dir, after_registry)

    result = {
        "schema_version": "1.0",
        "backend": "freecad_skill_cli",
        "status": "ok",
        "cad_synced": cad_synced,
        "cad_rebuilt": cad_rebuilt,
        "step_from_relayout": step_from_relayout,
        "step_copied_from_source": step_copied_from_source,
        "geometry_after_glb": str(after_glb) if after_glb.exists() else None,
        "edit_plan": str(edit_plan_path),
        "commands": command_records,
        "outputs": {
            "geometry_before_step": str(before_step),
            "geometry_after_step": str(after_step),
            "geometry_after_glb": str(after_glb),
            "layout_topology": str(after_topology),
            "geom": str(after_geom),
            "geometry_after_registry": str(output_dir / "geometry_after_registry.json"),
        },
    }
    if rebuild_record is not None:
        result["rebuild_cad_command"] = rebuild_record
    if relayout_result:
        result["relayout_result"] = "relayout_result.json"
        result["relayout_success"] = bool(relayout_result.get("relayout_success"))
        result["relayout_n_unplaced"] = relayout_result.get("relayout_n_unplaced")
    write_json(output_dir / "freecad_skill_cli_result.json", result)
    return {
        "before_step": before_step,
        "after_step": after_step,
        "after_topology_path": after_topology,
        "after_geom_path": after_geom,
        "after_registry": after_registry,
        "validation_components_path": (
            Path(relayout_result["layout_dir"]).parent / "00_inputs" / "components.json"
            if relayout_result
            else None
        ),
        "edit_plan": edit_plan,
        "edit_plan_path": edit_plan_path,
        "cad_synced": cad_synced,
        "cad_rebuilt": cad_rebuilt,
        "step_from_relayout": step_from_relayout,
        "step_copied_from_source": step_copied_from_source,
        "relayout_result": relayout_result,
        "result": result,
    }


def apply_expand_shell_then_relayout(
    *,
    output_dir: Path,
    action: Mapping[str, Any],
    config: Mapping[str, Any],
) -> dict[str, Any]:
    outer_size = _vector3(action.get("outer_size_mm"), [0.0, 0.0, 0.0])
    if min(outer_size) <= 0.0:
        outer_size = _bbox_size(action.get("outer_bbox"))
    if min(outer_size) <= 0.0:
        raise RuntimeError("expand_shell_then_relayout requires outer_size_mm or outer_bbox")

    bom_path = Path(str(config.get("source_bom_path") or "")).expanduser().resolve()
    layout3dcube_root = Path(str(config.get("layout3dcube_root") or "")).expanduser().resolve()
    dist_yaml = Path(str(config.get("dist_yaml") or "")).expanduser().resolve()
    thermal_db = Path(str(config.get("thermal_db") or "")).expanduser().resolve()
    missing = [
        name
        for name, path in (
            ("source_bom_path", bom_path),
            ("layout3dcube_root", layout3dcube_root),
            ("dist_yaml", dist_yaml),
            ("thermal_db", thermal_db),
        )
        if not path.exists()
    ]
    if missing:
        raise RuntimeError("expand_shell_then_relayout missing required config paths: " + ", ".join(missing))

    relayout_root = output_dir / "relayout"
    if relayout_root.exists():
        shutil.rmtree(relayout_root)
    relayout_root.mkdir(parents=True, exist_ok=True)
    relayout_run_dir = relayout_root / "run"
    sample_id = str(config.get("sample_id") or "relayout")
    seed = int(config.get("seed") or 1)
    result = run_one_bom_layout(
        bom_path=bom_path,
        run_dir=relayout_run_dir,
        layout3dcube_root=layout3dcube_root,
        dist_yaml=dist_yaml,
        sample_id=sample_id,
        seed=seed,
        clearance_mm=float(config.get("clearance_mm", 3.0) or 3.0),
        multistart=int(config.get("multistart", 3) or 3),
        target_fill_ratio=float(config.get("target_fill_ratio", 0.42) or 0.42),
        thermal_db=thermal_db,
        forced_outer_size_mm=outer_size,
    )
    layout_dir = relayout_run_dir / "01_layout"
    record = {
        "cmd": ["dataset-expand-shell-then-relayout", str(bom_path), json.dumps(outer_size)],
        "returncode": 0 if layout_dir.exists() else 1,
        "stdout": json.dumps(
            {
                "operation": "expand_shell_then_relayout",
                "outer_size_mm": outer_size,
                "relayout_ok": bool(result.get("ok")),
                "n_unplaced": int((result.get("stats") or {}).get("n_unplaced", -1)),
                "relayout_run_dir": str(relayout_run_dir),
            },
            ensure_ascii=False,
        ),
        "stderr": "",
    }
    write_json(
        output_dir / "relayout_result.json",
        {
            "schema_version": "1.0",
            "operation": "expand_shell_then_relayout",
            "official_expansion_path": True,
            "source_bom_path": str(bom_path),
            "outer_size_mm": outer_size,
            "expansion_mm": action.get("expansion_mm"),
            "relayout_run_dir": str(relayout_run_dir),
            "relayout_layout_dir": str(layout_dir),
            "relayout_result": result,
            "relayout_success": bool(result.get("ok")),
            "relayout_n_unplaced": int((result.get("stats") or {}).get("n_unplaced", -1)),
        },
    )
    return {
        "command_record": record,
        "relayout_result": result,
        "relayout_success": bool(result.get("ok")),
        "relayout_n_unplaced": int((result.get("stats") or {}).get("n_unplaced", -1)),
        "layout_dir": layout_dir,
        "layout_topology_path": layout_dir / "layout_topology.json",
        "geom_path": layout_dir / "geom.json",
        "geometry_registry_path": layout_dir / "geometry_registry.json",
    }


def sync_after_state_companion_files(input_dir: Path, output_dir: Path) -> None:
    for name in ("sample.yaml",):
        source = input_dir / name
        if source.exists():
            shutil.copy2(source, output_dir / name)

    simulation_input = input_dir / "simulation_input.json"
    if simulation_input.exists():
        data = read_json(simulation_input)
        if isinstance(data, dict):
            data["step_file"] = "geometry_after.step"
        write_json(output_dir / "simulation_input.json", data)

    source_comsol_inputs = input_dir / "comsol_inputs"
    if source_comsol_inputs.exists():
        output_comsol_inputs = output_dir / "comsol_inputs"
        if output_comsol_inputs.exists():
            shutil.rmtree(output_comsol_inputs)
        shutil.copytree(source_comsol_inputs, output_comsol_inputs)


def sync_simulation_input_after_registry(output_dir: Path, after_registry: Mapping[str, Any]) -> Path | None:
    simulation_input = output_dir / "simulation_input.json"
    if not simulation_input.exists():
        return None

    data = read_json(simulation_input)
    if not isinstance(data, dict):
        return None

    entities = after_registry.get("entities") if isinstance(after_registry, Mapping) else None
    if not isinstance(entities, list):
        return None

    by_component_id = {
        str(entity.get("component_id")): entity
        for entity in entities
        if isinstance(entity, Mapping) and entity.get("component_id")
    }
    for component in data.get("components") or []:
        if not isinstance(component, dict):
            continue
        entity = by_component_id.get(str(component.get("component_id")))
        if not entity:
            continue
        if isinstance(entity.get("bbox"), Mapping):
            component["bbox"] = deepcopy(entity["bbox"])
        if entity.get("geometry_id"):
            component["geometry_id"] = entity["geometry_id"]
        if entity.get("step_name"):
            component["step_name"] = entity["step_name"]

    for selection in (data.get("selection_plan") or {}).get("component_selections") or []:
        if not isinstance(selection, dict):
            continue
        entity = by_component_id.get(str(selection.get("component_id")))
        if entity and entity.get("step_name"):
            selection["step_name"] = entity["step_name"]

    write_json(simulation_input, data)
    return simulation_input


def sync_sample_yaml_after_registry(output_dir: Path, after_registry: Mapping[str, Any]) -> Path | None:
    sample_yaml = output_dir / "sample.yaml"
    if not sample_yaml.exists():
        return None

    data = yaml.safe_load(sample_yaml.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        return None
    components = data.get("components")
    if not isinstance(components, dict):
        return None

    entities = after_registry.get("entities") if isinstance(after_registry, Mapping) else None
    if not isinstance(entities, list):
        return None

    for entity in entities:
        if not isinstance(entity, Mapping):
            continue
        bbox = entity.get("bbox")
        step_name = entity.get("step_name")
        component_id = entity.get("component_id")
        if not isinstance(bbox, Mapping) or not step_name:
            continue
        component = components.get(str(step_name))
        if not isinstance(component, dict) and component_id:
            component = next(
                (
                    candidate
                    for candidate in components.values()
                    if isinstance(candidate, dict) and candidate.get("component_id") == component_id
                ),
                None,
            )
        if not isinstance(component, dict):
            continue
        old_min = _bbox_min(component.get("bbox"))
        new_min = _bbox_min(bbox)
        if old_min is None or new_min is None:
            continue
        delta = [new_min[index] - old_min[index] for index in range(3)]
        component["bbox"] = deepcopy(bbox)
        component["position"] = deepcopy(new_min)
        for key in ("install_pos", "mount_point"):
            current = component.get(key)
            if _is_xyz(current):
                component[key] = [float(current[index]) + delta[index] for index in range(3)]

    sample_yaml.write_text(yaml.safe_dump(data, sort_keys=False, allow_unicode=True), encoding="utf-8")
    return sample_yaml


def _bbox_min(bbox: Any) -> list[float] | None:
    if not isinstance(bbox, Mapping):
        return None
    value = bbox.get("min")
    if not _is_xyz(value):
        return None
    return [float(item) for item in value]


def _is_xyz(value: Any) -> bool:
    return isinstance(value, list) and len(value) == 3 and all(isinstance(item, (int, float)) for item in value)


def build_layout_safe_move_command(
    *,
    layout_topology: Path,
    geom: Path,
    layout_topology_output: Path,
    geom_output: Path,
    action: Mapping[str, Any],
    output_dir: Path,
    config: Mapping[str, Any],
) -> list[str]:
    component_id = str(action.get("component_id") or "").strip()
    if not component_id:
        raise RuntimeError("move_component requires component_id")
    delta = _action_delta_mm(action)
    executable = _freecad_cli_executable(config, "freecad-layout-safe-move")
    cmd = [
        executable,
        "--layout-topology",
        str(layout_topology.resolve()),
        "--geom",
        str(geom.resolve()),
        "--layout-topology-output",
        str(layout_topology_output.resolve()),
        "--geom-output",
        str(geom_output.resolve()),
        "--component",
        component_id,
        "--move",
        str(delta[0]),
        str(delta[1]),
        str(delta[2]),
    ]
    install_face = action.get("install_face", action.get("install_face_id"))
    if install_face is not None:
        cmd.extend(["--install-face", str(install_face)])
    if config.get("sync_cad"):
        cmd.append("--sync-cad")
        cmd.extend(["--doc-name", str(config.get("doc_name") or "LayoutAssembly")])
        cmd.extend(["--step-output", str(output_dir.resolve())])
        if config.get("host"):
            cmd.extend(["--host", str(config["host"])])
        if config.get("port"):
            cmd.extend(["--port", str(config["port"])])
    return cmd


def build_create_assembly_command(
    *,
    layout_topology: Path,
    geom: Path,
    output_dir: Path,
    config: Mapping[str, Any],
) -> list[str]:
    executable = _freecad_cli_executable(config, "freecad-create-assembly")
    cmd = [
        executable,
        "--layout-topology",
        str(layout_topology.resolve()),
        "--geom",
        str(geom.resolve()),
        "--doc-name",
        str(config.get("doc_name") or "LayoutAssembly"),
        "--output",
        str(output_dir.resolve()),
        "--no-fit-view",
    ]
    if config.get("host"):
        cmd.extend(["--host", str(config["host"])])
    if config.get("port"):
        cmd.extend(["--port", str(config["port"])])
    return cmd


def apply_add_component_dataset_edit(
    *,
    layout_topology: Path,
    geom: Path,
    layout_topology_output: Path,
    geom_output: Path,
    action: Mapping[str, Any],
) -> dict[str, Any]:
    topology_data = read_json(layout_topology)
    geom_data = read_json(geom)
    component_id = str(action.get("component_id") or "").strip()
    if not component_id:
        raise RuntimeError("add_component requires component_id")
    existing_ids = {
        str(placement.get("component_id"))
        for placement in topology_data.get("placements", [])
        if isinstance(placement, Mapping) and placement.get("component_id")
    }
    if component_id in existing_ids:
        raise RuntimeError(f"add_component component already exists in layout_topology: {component_id}")

    bbox = _bbox_snapshot(action.get("bbox"))
    size = _bbox_size(bbox)
    if min(size) <= 0.0:
        raise RuntimeError("add_component requires bbox with positive size")
    existing_geometry_ids = {
        str(placement.get("geometry_id"))
        for placement in topology_data.get("placements", [])
        if isinstance(placement, Mapping) and placement.get("geometry_id")
    }
    requested_geometry_id = str(action.get("geometry_id") or "").strip()
    if requested_geometry_id and requested_geometry_id not in existing_geometry_ids:
        geometry_id = requested_geometry_id
    else:
        geometry_id = _next_geometry_id_from_topology(topology_data)
    layout_part_id = str(action.get("layout_part_id") or action.get("step_name") or component_id)
    semantic_name = str(action.get("semantic_name") or component_id)
    kind = str(action.get("kind") or _kind_from_component_id(component_id))
    mount_face_id = str(action.get("mount_face_id") or _default_mount_face_id(topology_data, kind))
    component_mount_face_id = str(action.get("component_mount_face_id") or f"{component_id}.local_zmin")
    cabin_id = action.get("cabin_id")
    if kind == "internal" and not cabin_id:
        cabin_id = mount_face_id.split(".", 1)[0] if "." in mount_face_id else None

    topology_data.setdefault("placements", []).append(
        {
            "component_id": component_id,
            "semantic_name": semantic_name,
            "kind": kind,
            "cabin_id": cabin_id if kind == "internal" else None,
            "component_mount_face_id": component_mount_face_id,
            "mount_face_id": mount_face_id,
            "alignment": dict(action.get("alignment") or {
                "normal_alignment": "opposite",
                "component_u_axis_to_target_u_axis": True,
                "in_plane_rotation_deg": 0.0,
            }),
            "geometry_id": geometry_id,
            "thermal_id": str(action.get("thermal_id") or _next_thermal_id(topology_data)),
            "component_subtype": action.get("component_subtype"),
        }
    )

    component = {
        "id": layout_part_id,
        "geometry_id": geometry_id,
        "kind": kind,
        "category": str(action.get("category") or "payload"),
        "dims": size,
        "mass": float(action.get("mass_kg", action.get("mass", 0.0)) or 0.0),
        "power": float(action.get("power_W", action.get("power", 0.0)) or 0.0),
        "color": action.get("color") or [220, 140, 60, 255],
        "clearance_mm": float(action.get("clearance_mm", 3.0) or 3.0),
        "shape": str(action.get("shape") or "box"),
        "mount_face_id": mount_face_id,
        "position": list(bbox["min"]),
        "install_pos": list(action.get("install_pos") or bbox["min"]),
        "mount_point": _bbox_center(bbox),
        "bbox": bbox,
        "leaf_node_id": str(action.get("leaf_node_id") or _leaf_node_id_for_mount_face(mount_face_id)),
        "thermal_surface": dict(action.get("thermal_surface") or {"emissivity": 0.8, "absorptivity": 0.3}),
        "thermal_interface": dict(action.get("thermal_interface") or {"contact_resistance": 0.001}),
        "thermoelastic": dict(action.get("thermoelastic") or {}),
        "component_id": component_id,
        "semantic_name": semantic_name,
        "component_subtype": action.get("component_subtype"),
    }
    components = geom_data.setdefault("components", {})
    if not isinstance(components, dict):
        raise RuntimeError("geom.components must be an object for add_component")
    if layout_part_id in components:
        raise RuntimeError(f"add_component layout_part_id already exists in geom: {layout_part_id}")
    components[layout_part_id] = component

    write_json(layout_topology_output, topology_data)
    write_json(geom_output, geom_data)
    return {
        "cmd": ["dataset-add-component", component_id],
        "returncode": 0,
        "stdout": "\n".join(
            [
                f"target_component: {component_id}",
                f"operation: add_component",
                f"geometry_id: {geometry_id}",
                f"bbox: {json.dumps(bbox)}",
            ]
        ),
        "stderr": "",
    }


def apply_expand_shell_dataset_edit(
    *,
    layout_topology: Path,
    geom: Path,
    layout_topology_output: Path,
    geom_output: Path,
    action: Mapping[str, Any],
) -> dict[str, Any]:
    topology_data = read_json(layout_topology)
    geom_data = read_json(geom)
    outer_bbox = _bbox_snapshot(action.get("outer_bbox"))
    if min(_bbox_size(outer_bbox)) <= 0.0:
        raise RuntimeError("expand_shell requires positive outer_bbox")
    inner_bbox = _bbox_snapshot(action.get("inner_bbox")) if isinstance(action.get("inner_bbox"), Mapping) else None
    shell = geom_data.setdefault("outer_shell", {})
    if not isinstance(shell, dict):
        raise RuntimeError("geom.outer_shell must be an object for expand_shell")
    old_outer_bbox = _bbox_snapshot(shell.get("outer_bbox"))
    shell["outer_bbox"] = outer_bbox
    if inner_bbox and min(_bbox_size(inner_bbox)) > 0.0:
        shell["inner_bbox"] = inner_bbox
    _refresh_outer_shell_faces(shell)
    if isinstance(topology_data.get("outer_shell"), dict):
        topology_data["outer_shell"]["expanded_by_02_geometry_edit"] = True
        topology_data["outer_shell"]["outer_bbox"] = outer_bbox
        if inner_bbox and min(_bbox_size(inner_bbox)) > 0.0:
            topology_data["outer_shell"]["inner_bbox"] = inner_bbox
    write_json(layout_topology_output, topology_data)
    write_json(geom_output, geom_data)
    return {
        "cmd": ["dataset-expand-shell"],
        "returncode": 0,
        "stdout": "\n".join(
            [
                "operation: expand_shell",
                f"old_outer_bbox: {json.dumps(old_outer_bbox)}",
                f"new_outer_bbox: {json.dumps(outer_bbox)}",
            ]
        ),
        "stderr": "",
    }


def apply_delete_component_dataset_edit(
    *,
    layout_topology: Path,
    geom: Path,
    layout_topology_output: Path,
    geom_output: Path,
    action: Mapping[str, Any],
) -> dict[str, Any]:
    topology_data = read_json(layout_topology)
    geom_data = read_json(geom)
    component_id = str(action.get("component_id") or "").strip()
    if not component_id:
        raise RuntimeError("delete_component requires component_id")
    topology_data["placements"] = [
        placement
        for placement in topology_data.get("placements", [])
        if not (isinstance(placement, Mapping) and placement.get("component_id") == component_id)
    ]
    components = geom_data.get("components", {})
    if isinstance(components, dict):
        geom_data["components"] = {
            key: value
            for key, value in components.items()
            if not (isinstance(value, Mapping) and value.get("component_id") == component_id)
        }
    write_json(layout_topology_output, topology_data)
    write_json(geom_output, geom_data)
    return {
        "cmd": ["dataset-delete-component", component_id],
        "returncode": 0,
        "stdout": f"target_component: {component_id}\noperation: delete_component",
        "stderr": "",
    }


def build_geometry_after_registry_from_geom(
    geom: Mapping[str, Any],
    before_geometry: Mapping[str, Any],
    *,
    source: Mapping[str, Any],
) -> dict[str, Any]:
    before_entities = [
        entity
        for entity in before_geometry.get("entities", [])
        if isinstance(entity, Mapping)
    ]
    before_by_component = {
        str(entity.get("component_id")): entity
        for entity in before_entities
        if entity.get("component_id")
    }
    geom_by_component = _geom_components_by_component_id(geom)

    after_entities = []
    used_ids: set[str] = set()
    for before in before_entities:
        component_id = str(before.get("component_id") or "")
        component = geom_by_component.get(component_id)
        if not component:
            continue
        after_entities.append(_registry_entity_from_geom_component(component, before))
        used_ids.add(component_id)

    for component_id, component in geom_by_component.items():
        if component_id in used_ids:
            continue
        after_entities.append(
            _registry_entity_from_geom_component(
                component,
                {
                    "geometry_id": component.get("geometry_id") or _next_geometry_id(after_entities),
                    "component_id": component_id,
                    "entity_type": "component_solid",
                    "step_name": component.get("id") or component_id,
                },
            )
        )

    registry = deepcopy(dict(before_geometry))
    registry["entities"] = after_entities
    registry["source"] = dict(source)
    return registry


def _registry_entity_from_geom_component(
    component: Mapping[str, Any],
    base_entity: Mapping[str, Any],
) -> dict[str, Any]:
    bbox = _component_bbox(component)
    entity = dict(base_entity)
    entity["component_id"] = component.get("component_id") or base_entity.get("component_id")
    entity["entity_type"] = base_entity.get("entity_type") or "component_solid"
    entity["bbox"] = bbox
    entity["center"] = _bbox_center(bbox)
    entity["size"] = _bbox_size(bbox)
    entity["step_name"] = base_entity.get("step_name") or component.get("id") or entity["component_id"]
    if component.get("semantic_name") is not None:
        entity["semantic_name"] = component.get("semantic_name")
    if component.get("component_subtype") is not None:
        entity["component_subtype"] = component.get("component_subtype")
    return entity


def _geom_components_by_component_id(geom: Mapping[str, Any]) -> dict[str, Mapping[str, Any]]:
    components = geom.get("components", {})
    rows = components.values() if isinstance(components, Mapping) else components
    lookup: dict[str, Mapping[str, Any]] = {}
    for component in rows or []:
        if not isinstance(component, Mapping):
            continue
        component_id = str(component.get("component_id") or "").strip()
        if component_id:
            lookup[component_id] = component
    return lookup


def _component_bbox(component: Mapping[str, Any]) -> dict[str, list[float]]:
    if isinstance(component.get("position"), list) and isinstance(component.get("dims"), list):
        position = _vector3(component.get("position"), [0.0, 0.0, 0.0])
        dims = _vector3(component.get("dims"), [0.0, 0.0, 0.0])
        return {
            "min": position,
            "max": [position[index] + dims[index] for index in range(3)],
        }
    if isinstance(component.get("bbox"), Mapping):
        return _bbox_snapshot(component["bbox"])
    position = _vector3(component.get("position"), [0.0, 0.0, 0.0])
    dims = _vector3(component.get("dims"), [0.0, 0.0, 0.0])
    return {
        "min": position,
        "max": [position[index] + dims[index] for index in range(3)],
    }


def _normalize_geom_component_bboxes(geom: dict[str, Any]) -> bool:
    components = geom.get("components", {})
    rows = components.values() if isinstance(components, Mapping) else components
    changed = False
    for component in rows or []:
        if not isinstance(component, dict):
            continue
        if not isinstance(component.get("position"), list) or not isinstance(component.get("dims"), list):
            continue
        bbox = _component_bbox(component)
        if component.get("bbox") != bbox:
            component["bbox"] = bbox
            changed = True
    return changed


def _run_command(cmd: list[str], config: Mapping[str, Any]) -> dict[str, Any]:
    env = os.environ.copy()
    if config.get("workspace_dir"):
        env["WORKSPACE_DIR"] = str(config["workspace_dir"])
    execution = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        env=env,
        timeout=int(config.get("timeout_seconds", 600)),
    )
    record = {
        "cmd": cmd,
        "returncode": execution.returncode,
        "stdout": execution.stdout,
        "stderr": execution.stderr,
    }
    if execution.returncode != 0:
        raise RuntimeError(
            "FreeCAD skill CLI failed: "
            + " ".join(cmd)
            + "\n"
            + (execution.stderr.strip() or execution.stdout.strip())
        )
    return record


def _load_edit_plan(config: Mapping[str, Any]) -> dict[str, Any]:
    if isinstance(config.get("edit_plan"), Mapping):
        return deepcopy(dict(config["edit_plan"]))
    if isinstance(config.get("actions"), list):
        return {"schema_version": "1.0", "actions": deepcopy(config["actions"])}
    if config.get("edit_plan_path"):
        return read_json(Path(config["edit_plan_path"]))
    return {"schema_version": "1.0", "actions": []}


def _freecad_cli_executable(config: Mapping[str, Any], name: str) -> str:
    cli_dir = config.get("freecad_cli_dir")
    if cli_dir:
        candidate = Path(cli_dir) / name
        if candidate.exists():
            return str(candidate)
    found = shutil.which(name)
    if found:
        return found
    fallback = Path("/data/conda/bin") / name
    if fallback.exists():
        return str(fallback)
    raise RuntimeError(f"FreeCAD skill CLI not found: {name}")


def _normalize_action_type(action_type: str) -> str:
    return {
        "move": "move_component",
        "add": "add_component",
        "delete": "delete_component",
        "expand": "expand_shell",
    }.get(action_type, action_type)


def _refresh_outer_shell_faces(shell: dict[str, Any]) -> None:
    outer_bbox = _bbox_snapshot(shell.get("outer_bbox"))
    inner_bbox = _bbox_snapshot(shell.get("inner_bbox")) if isinstance(shell.get("inner_bbox"), Mapping) else None
    if inner_bbox and min(_bbox_size(inner_bbox)) > 0.0:
        _refresh_faces(shell.get("faces_inner"), inner_bbox, side="inner")
    _refresh_faces(shell.get("faces_outer"), outer_bbox, side="outer")


def _refresh_faces(faces: Any, box: Mapping[str, list[float]], *, side: str) -> None:
    if not isinstance(faces, list):
        return
    for face in faces:
        if not isinstance(face, dict):
            continue
        axis = int(face.get("plane_axis", 0) or 0)
        normal_sign = int(face.get("normal_sign", 1) or 1)
        if side == "outer":
            plane_value = box["max"][axis] if normal_sign > 0 else box["min"][axis]
        else:
            plane_value = box["max"][axis] if normal_sign < 0 else box["min"][axis]
        plane_axes = [item for item in range(3) if item != axis]
        face["plane_value"] = plane_value
        face["bbox_2d"] = [
            box["min"][plane_axes[0]],
            box["max"][plane_axes[0]],
            box["min"][plane_axes[1]],
            box["max"][plane_axes[1]],
        ]
        center = [(box["min"][idx] + box["max"][idx]) / 2.0 for idx in range(3)]
        center[axis] = plane_value
        face["center_xyz"] = center
        face["extents_xyz"] = [
            0.0 if idx == axis else box["max"][idx] - box["min"][idx]
            for idx in range(3)
        ]


def _action_delta_mm(action: Mapping[str, Any]) -> list[float]:
    if isinstance(action.get("delta_mm"), list):
        return _vector3(action["delta_mm"], [0.0, 0.0, 0.0])
    return [
        float(action.get("dx", 0.0)),
        float(action.get("dy", 0.0)),
        float(action.get("dz", 0.0)),
    ]


def _bbox_snapshot(value: Any) -> dict[str, list[float]]:
    if not isinstance(value, Mapping):
        return {"min": [0.0, 0.0, 0.0], "max": [0.0, 0.0, 0.0]}
    return {
        "min": _vector3(value.get("min"), [0.0, 0.0, 0.0]),
        "max": _vector3(value.get("max"), [0.0, 0.0, 0.0]),
    }


def _bbox_center(value: Any) -> list[float]:
    bbox = _bbox_snapshot(value)
    return [round((bbox["min"][index] + bbox["max"][index]) / 2.0, 9) for index in range(3)]


def _bbox_size(value: Any) -> list[float]:
    bbox = _bbox_snapshot(value)
    return [round(bbox["max"][index] - bbox["min"][index], 9) for index in range(3)]


def _vector3(value: Any, default: list[float]) -> list[float]:
    if not isinstance(value, list) or len(value) != 3:
        return [float(item) for item in default]
    return [float(item) for item in value]


def _next_geometry_id(entities: list[Mapping[str, Any]]) -> str:
    max_index = 0
    for entity in entities:
        geometry_id = str(entity.get("geometry_id") or "")
        if geometry_id.startswith("G") and geometry_id[1:].isdigit():
            max_index = max(max_index, int(geometry_id[1:]))
    return f"G{max_index + 1:03d}"


def _next_geometry_id_from_topology(topology: Mapping[str, Any]) -> str:
    max_index = 0
    for placement in topology.get("placements", []):
        if not isinstance(placement, Mapping):
            continue
        geometry_id = str(placement.get("geometry_id") or "")
        if geometry_id.startswith("G") and geometry_id[1:].isdigit():
            max_index = max(max_index, int(geometry_id[1:]))
    return f"G{max_index + 1:03d}"


def _next_thermal_id(topology: Mapping[str, Any]) -> str:
    max_index = 0
    for placement in topology.get("placements", []):
        if not isinstance(placement, Mapping):
            continue
        thermal_id = str(placement.get("thermal_id") or "")
        if thermal_id.startswith("T") and thermal_id[1:].isdigit():
            max_index = max(max_index, int(thermal_id[1:]))
    return f"T{max_index + 1:03d}"


def _kind_from_component_id(component_id: str) -> str:
    if component_id.startswith("E"):
        return "external"
    if component_id.startswith("R"):
        return "radiator"
    return "internal"


def _default_mount_face_id(topology: Mapping[str, Any], kind: str) -> str:
    install_faces = [
        face
        for face in topology.get("install_faces", [])
        if isinstance(face, Mapping) and face.get("id")
    ]
    if kind == "internal":
        for face in install_faces:
            face_id = str(face["id"])
            if face_id.endswith(".zmin") or face_id.endswith("zmin_inner"):
                return face_id
    for face in install_faces:
        face_id = str(face["id"])
        if "_outer" in face_id or face_id.startswith("outer."):
            return face_id
    return str(install_faces[0]["id"]) if install_faces else "outer.zmax_outer"


def _leaf_node_id_for_mount_face(mount_face_id: str) -> str:
    if mount_face_id.startswith("outer."):
        return "leaf.outer"
    cabin_id = mount_face_id.split(".", 1)[0]
    return f"leaf.{cabin_id}" if cabin_id else "leaf.outer"
