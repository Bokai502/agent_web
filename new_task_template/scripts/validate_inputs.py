#!/usr/bin/env python3
"""Validate a new satellite task input package before CAD/simulation runs."""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Any


REQUIRED_CSV_COLUMNS = {
    "器件ID",
    "长 mm",
    "宽 mm",
    "高 mm",
    "质量 g",
    "主模式功耗",
    "核心材料",
    "安装面",
    "CAD路径",
    "Rotated CAD Path",
    "CAD_rotated_path",
    "CAD_MAJOR_PATH",
}

CAD_PATH_COLUMNS = ("CAD_rotated_path", "CAD_MAJOR_PATH", "Rotated CAD Path", "CAD路径")


def load_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ValueError(f"missing file: {path}") from None
    except json.JSONDecodeError as exc:
        raise ValueError(f"invalid JSON {path}: {exc}") from None
    if not isinstance(payload, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return payload


def add_error(errors: list[str], message: str) -> None:
    errors.append(f"ERROR: {message}")


def add_warning(warnings: list[str], message: str) -> None:
    warnings.append(f"WARNING: {message}")


def vector3(value: Any) -> bool:
    return (
        isinstance(value, list)
        and len(value) == 3
        and all(isinstance(item, (int, float)) for item in value)
    )


def geom_by_component_id(geom: dict[str, Any]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    components = geom.get("components")
    if not isinstance(components, dict):
        return result
    for key, value in components.items():
        if not isinstance(value, dict):
            continue
        component_id = value.get("component_id") or value.get("id") or key
        result[str(component_id)] = value
    return result


def resolve_template_path(raw_path: str, csv_path: Path, workspace: Path) -> Path | None:
    if not raw_path.strip():
        return None
    candidate = Path(raw_path.strip())
    candidates: list[Path]
    if candidate.is_absolute():
        candidates = [candidate]
    else:
        candidates = [csv_path.parent / candidate, csv_path.parent.parent / candidate, workspace / candidate]
    for path in candidates:
        if path.exists() and path.suffix.lower() in {".step", ".stp"}:
            return path.resolve()
    return None


def load_component_csv(path: Path) -> tuple[list[str], dict[str, dict[str, str]]]:
    if not path.exists():
        raise ValueError(f"missing CSV: {path}")
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        header = list(reader.fieldnames or [])
        rows: dict[str, dict[str, str]] = {}
        for row in reader:
            device_id = (row.get("器件ID") or "").strip()
            if device_id:
                rows[device_id] = row
    return header, rows


def validate(workspace: Path) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    workspace = workspace.resolve()
    inputs = workspace / "00_inputs"

    real_bom = load_json(inputs / "real_bom.json")
    layout = load_json(inputs / "layout_topology.json")
    geom = load_json(inputs / "geom.json")

    for name, payload, keys in (
        ("real_bom.json", real_bom, ("schema_version", "units", "source", "items")),
        ("layout_topology.json", layout, ("schema_version", "outer_shell", "install_faces", "placements")),
        ("geom.json", geom, ("schema_version", "units", "outer_shell", "install_faces", "components")),
    ):
        for key in keys:
            if key not in payload:
                add_error(errors, f"{name} missing top-level field {key!r}")

    bom_items = real_bom.get("items")
    placements = layout.get("placements")
    if not isinstance(bom_items, list):
        add_error(errors, "real_bom.items must be an array")
        bom_items = []
    if not isinstance(placements, list):
        add_error(errors, "layout_topology.placements must be an array")
        placements = []
    if not isinstance(layout.get("install_faces"), list):
        add_error(errors, "layout_topology.install_faces must be an array")
    if not isinstance(geom.get("install_faces"), dict):
        add_error(errors, "geom.install_faces must be an object")
    if not isinstance(geom.get("components"), dict):
        add_error(errors, "geom.components must be an object")

    bom_by_id = {
        str(item.get("component_id")): item
        for item in bom_items
        if isinstance(item, dict) and item.get("component_id")
    }
    placement_ids = {
        str(item.get("component_id"))
        for item in placements
        if isinstance(item, dict) and item.get("component_id")
    }
    geom_components = geom_by_component_id(geom)

    duplicate_ids = len(bom_by_id) != len([item for item in bom_items if isinstance(item, dict)])
    if duplicate_ids:
        add_error(errors, "real_bom.items contains duplicate or missing component_id values")

    for component_id in sorted(set(bom_by_id) - placement_ids):
        add_warning(warnings, f"BOM component {component_id} has no placement")
    for component_id in sorted(placement_ids - set(bom_by_id)):
        add_error(errors, f"placement component {component_id} is missing in real_bom.items")
    for component_id in sorted(placement_ids - set(geom_components)):
        add_error(errors, f"placement component {component_id} is missing in geom.components")

    layout_face_ids = {
        str(face.get("id"))
        for face in layout.get("install_faces", [])
        if isinstance(face, dict) and face.get("id")
    }
    geom_face_ids = set((geom.get("install_faces") or {}).keys()) if isinstance(geom.get("install_faces"), dict) else set()
    for face_id in sorted(layout_face_ids - geom_face_ids):
        add_error(errors, f"layout install face {face_id} is missing in geom.install_faces")

    for placement in placements:
        if not isinstance(placement, dict):
            add_error(errors, "layout_topology.placements contains a non-object entry")
            continue
        component_id = str(placement.get("component_id"))
        mount_face_id = placement.get("mount_face_id")
        component_mount_face_id = placement.get("component_mount_face_id")
        if mount_face_id not in layout_face_ids:
            add_error(errors, f"{component_id} mount_face_id {mount_face_id!r} is not in layout install_faces")
        if mount_face_id not in geom_face_ids:
            add_error(errors, f"{component_id} mount_face_id {mount_face_id!r} is not in geom.install_faces")
        bom_item = bom_by_id.get(component_id)
        mount_faces = []
        if isinstance(bom_item, dict):
            mounting = bom_item.get("mounting")
            if isinstance(mounting, dict):
                mount_faces = mounting.get("mount_faces") or []
        declared_mount_faces = {
            face.get("component_mount_face_id")
            for face in mount_faces
            if isinstance(face, dict)
        }
        if component_mount_face_id not in declared_mount_faces:
            add_warning(warnings, f"{component_id} component_mount_face_id {component_mount_face_id!r} is not declared in BOM mounting.mount_faces; the CAD input builder will infer it from the local face name")

    outer_shell = geom.get("outer_shell")
    if isinstance(outer_shell, dict):
        for bbox_name in ("outer_bbox", "inner_bbox"):
            bbox = outer_shell.get(bbox_name)
            if not isinstance(bbox, dict) or not vector3(bbox.get("min")) or not vector3(bbox.get("max")):
                add_error(errors, f"geom.outer_shell.{bbox_name}.min/max must be numeric 3-vectors")
    else:
        add_error(errors, "geom.outer_shell must be an object")

    for component_id, component in geom_components.items():
        if not vector3(component.get("dims")):
            add_error(errors, f"geom component {component_id} missing numeric dims[3]")
        if not vector3(component.get("position")):
            add_error(errors, f"geom component {component_id} missing numeric position[3]")
        bbox = component.get("bbox")
        if not isinstance(bbox, dict) or not vector3(bbox.get("min")) or not vector3(bbox.get("max")):
            add_error(errors, f"geom component {component_id} missing bbox.min/max numeric 3-vectors")

    source = real_bom.get("source")
    template_csv = source.get("template_csv") if isinstance(source, dict) else None
    csv_rows: dict[str, dict[str, str]] = {}
    csv_path: Path | None = None
    if isinstance(template_csv, str) and template_csv.strip():
        csv_path = Path(template_csv)
        if not csv_path.is_absolute():
            candidates = [
                (workspace / template_csv).resolve(),
                (inputs / template_csv).resolve(),
            ]
            csv_path = next((candidate for candidate in candidates if candidate.exists()), candidates[0])
        try:
            header, csv_rows = load_component_csv(csv_path)
            missing_columns = sorted(REQUIRED_CSV_COLUMNS - set(header))
            if missing_columns:
                add_error(errors, f"component CSV missing columns: {', '.join(missing_columns)}")
        except ValueError as exc:
            add_error(errors, str(exc))
    else:
        add_warning(warnings, "real_bom.source.template_csv is not set")

    missing_semantic_names = []
    unresolved_step_paths = []
    resolved_step_count = 0
    for component_id, item in bom_by_id.items():
        source_ref = item.get("source_ref") if isinstance(item.get("source_ref"), dict) else {}
        lookup_keys = [
            item.get("semantic_name"),
            source_ref.get("template_model"),
            source_ref.get("selected_model"),
            source_ref.get("template_component_id"),
        ]
        semantic_name = next((str(key) for key in lookup_keys if isinstance(key, str) and key in csv_rows), None)
        if csv_rows and semantic_name is None:
            missing_semantic_names.append(f"{component_id}:{item.get('semantic_name')}")
            continue
        row = csv_rows.get(str(semantic_name)) if csv_rows else None
        if row and csv_path:
            resolved = None
            for column in CAD_PATH_COLUMNS:
                resolved = resolve_template_path(row.get(column, ""), csv_path, workspace)
                if resolved:
                    break
            if resolved:
                resolved_step_count += 1
            else:
                unresolved_step_paths.append(f"{component_id}:{semantic_name}")

    for item in missing_semantic_names[:20]:
        add_warning(warnings, f"CSV has no 器件ID row for {item}")
    if len(missing_semantic_names) > 20:
        add_warning(warnings, f"CSV missing semantic_name rows for {len(missing_semantic_names)} components total")
    for item in unresolved_step_paths[:20]:
        add_warning(warnings, f"CSV has no resolvable STEP/STP path for {item}; CAD build can still fall back to boxes")
    if len(unresolved_step_paths) > 20:
        add_warning(warnings, f"unresolved STEP/STP paths for {len(unresolved_step_paths)} components total")

    print(f"workspace: {workspace}")
    print(f"bom_items: {len(bom_by_id)}")
    print(f"placements: {len(placement_ids)}")
    print(f"geom_components: {len(geom_components)}")
    print(f"layout_install_faces: {len(layout_face_ids)}")
    print(f"geom_install_faces: {len(geom_face_ids)}")
    if csv_path:
        print(f"component_csv: {csv_path}")
        print(f"csv_rows_by_器件ID: {len(csv_rows)}")
        print(f"resolved_step_or_stp_paths: {resolved_step_count}")
    return errors, warnings


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", default=".", help="Workspace/template root containing 00_inputs")
    args = parser.parse_args()
    try:
        errors, warnings = validate(Path(args.workspace))
    except ValueError as exc:
        print(f"ERROR: {exc}")
        return 1

    for warning in warnings:
        print(warning)
    for error in errors:
        print(error)

    if errors:
        print(f"FAILED: {len(errors)} error(s), {len(warnings)} warning(s)")
        return 1
    print(f"OK: 0 error(s), {len(warnings)} warning(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
