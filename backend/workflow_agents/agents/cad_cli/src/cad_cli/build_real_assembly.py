#!/usr/bin/env python3
"""Build geometry_after_real_cad.glb from cad_build_spec.json via hybrid-link."""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path
from typing import Any

from .local_freecad_helpers import (
    FACE_DEFINITIONS,
    is_external_face,
    normalize_runtime_path,
    render_rpc_script,
)
from .spec_common import (
    add_common_build_args,
    component_bbox,
    default_doc_name,
    execute_freecad_code,
    freecad_rpc_settings,
    print_result,
    resolve_build_paths,
    write_json,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build supplemental real assembly GLB from cad_build_spec.json.")
    add_common_build_args(parser)
    return parser.parse_args()


def bbox_size(bbox: dict[str, list[float]]) -> list[float]:
    return [float(bbox["max"][axis]) - float(bbox["min"][axis]) for axis in range(3)]


def staged_paths(output_dir: Path, doc_name: str) -> tuple[Path, Path]:
    safe_doc_name = "".join(ch if ch.isalnum() or ch in ("-", "_") else "_" for ch in doc_name).strip("_")
    root = output_dir / ".hybrid_link" / (safe_doc_name or "real_cad")
    return root / "inputs" / "normalized_component_info_assembly.json", root / "outputs" / "geometry_after_real_cad.step"


def copy_export(staged_output: Path, final_output_root: Path) -> None:
    final_output_root.parent.mkdir(parents=True, exist_ok=True)
    for obsolete_step in (staged_output, final_output_root.with_suffix(".step")):
        if obsolete_step.exists():
            obsolete_step.unlink()
    for staged_path, final_path in (
        (staged_output.with_suffix(".glb"), final_output_root.with_suffix(".glb")),
        (staged_output.with_suffix(".hybrid_summary.json"), final_output_root.with_suffix(".hybrid_summary.json")),
    ):
        if staged_path.exists():
            shutil.copyfile(staged_path, final_path)


def envelope_payload(spec: dict[str, Any]) -> dict[str, Any]:
    envelope = spec.get("envelope") if isinstance(spec.get("envelope"), dict) else {}
    outer_bbox = envelope.get("outer_bbox") if isinstance(envelope.get("outer_bbox"), dict) else {}
    inner_bbox = envelope.get("inner_bbox") if isinstance(envelope.get("inner_bbox"), dict) else {}
    return {
        "outer_size": envelope.get("outer_size") or bbox_size({"min": outer_bbox["min"], "max": outer_bbox["max"]}),
        "inner_size": envelope.get("inner_size") or bbox_size({"min": inner_bbox["min"], "max": inner_bbox["max"]}),
        "outer_min": outer_bbox.get("min"),
        "outer_max": outer_bbox.get("max"),
        "inner_min": inner_bbox.get("min"),
        "inner_max": inner_bbox.get("max"),
        "shell_thickness": envelope.get("shell_thickness", 0.0),
    }


def placement_payload(component: dict[str, Any]) -> dict[str, Any]:
    mount = component.get("mount") if isinstance(component.get("mount"), dict) else {}
    install_face_id = mount.get("install_face_id")
    component_face_id = mount.get("component_face_id")
    component_local_face = mount.get("component_face_index")
    contact_axis = mount.get("contact_plane_axis")
    normal_sign = mount.get("normal_sign")

    if component_local_face is None:
        component_local_face = 4
    if contact_axis is None or normal_sign is None:
        raise ValueError(f"{component.get('id')} mount.contact_plane_axis and normal_sign are required for hybrid-link")

    install_face = None
    for face_id, (_label, axis, direction) in FACE_DEFINITIONS.items():
        if int(axis) == int(contact_axis) and int(direction) == int(normal_sign):
            install_face = face_id
            break
    if install_face is None:
        raise ValueError(f"{component.get('id')} cannot map mount face axis/sign to hybrid-link face id")
    _label, mount_axis, mount_direction = FACE_DEFINITIONS[int(install_face)]

    return {
        "mount_face_id": install_face_id,
        "component_mount_face_id": component_face_id,
        "alignment": {},
        "install_face": int(install_face),
        "component_local_face": int(component_local_face),
        "mount_axis": int(mount_axis),
        "mount_direction": int(mount_direction),
        "external": bool(is_external_face(int(install_face))),
    }


def normalized_real_cad_input(spec: dict[str, Any], spec_path: Path) -> dict[str, Any]:
    components: dict[str, Any] = {}
    for component in spec.get("components") or []:
        component_id = str(component.get("id") or component.get("component_id"))
        bbox = component_bbox(component)
        real_cad = component.get("real_cad") if isinstance(component.get("real_cad"), dict) else {}
        step_path = real_cad.get("step_path")
        resolved_step_path = resolve_step_path(step_path, spec_path)
        step_exists = resolved_step_path is not None and resolved_step_path.exists()
        components[component_id] = {
            "id": component_id,
            "component_id": component_id,
            "category": component.get("category"),
            "color": component.get("color"),
            "target_bbox": bbox,
            "target_size": bbox_size(bbox),
            "placement": placement_payload(component),
            "source": {
                "kind": "step" if step_exists else "box",
                "step_path": str(resolved_step_path) if step_exists else None,
                "requested_step_path": step_path,
                "step_size_bytes": resolved_step_path.stat().st_size if step_exists else None,
                "fallback_reason": None if step_exists else "missing_step_path",
                "geom_component_info_path": str(spec_path.resolve()),
            },
        }

    return {
        "schema_version": "geom_component_assembly/1.0",
        "source": {
            "kind": "cad_build_spec",
            "cad_build_spec": str(spec_path.resolve()),
            "spec_schema_version": spec.get("schema_version"),
        },
        "envelope": envelope_payload(spec),
        "walls": spec.get("walls") or [],
        "components": components,
    }


def resolve_step_path(step_path: Any, spec_path: Path) -> Path | None:
    if not isinstance(step_path, str) or not step_path.strip():
        return None
    path = Path(step_path).expanduser()
    if path.is_absolute():
        return path.resolve()
    candidates = [
        spec_path.parent / path,
        spec_path.parent.parent / path,
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate.resolve()
    return candidates[0].resolve()


def main() -> int:
    args = parse_args()
    workspace_dir, spec_path, output_dir, spec = resolve_build_paths(args)

    final_output_root = output_dir / "geometry_after_real_cad"
    glb_path = output_dir / "geometry_after_real_cad.glb"
    summary_path = output_dir / "geometry_after_real_cad.hybrid_summary.json"
    doc_name = args.doc_name or default_doc_name(workspace_dir, "real_cad")
    staged_input_path, staged_step_path = staged_paths(output_dir, doc_name)
    normalized = normalized_real_cad_input(spec, spec_path)
    write_json(staged_input_path, normalized)
    staged_step_path.parent.mkdir(parents=True, exist_ok=True)

    host, port = freecad_rpc_settings(args.host, args.port)
    hybrid_code = render_rpc_script(
        "build_real_assembly_hybrid.py",
        {
            "__FACE_DEFINITIONS__": repr(FACE_DEFINITIONS),
            "__INPUT_PATH__": json.dumps(normalize_runtime_path(staged_input_path)),
            "__DOC_NAME__": json.dumps(doc_name),
            "__SAVE_PATH__": json.dumps(normalize_runtime_path(staged_step_path)),
            "__INCLUDE_ENVELOPE__": "True",
            "__FREECAD_MODULE_DIR__": json.dumps(normalize_runtime_path(Path(__file__).resolve().parent)),
        },
    )
    hybrid_payload = execute_freecad_code(host, port, hybrid_code)
    copy_export(staged_step_path, final_output_root)

    result = {
        "success": bool(hybrid_payload.get("success")) and glb_path.exists() and summary_path.exists(),
        "backend": "hybrid-link",
        "spec_path": str(spec_path),
        "normalized_input_path": str(staged_input_path),
        "document": hybrid_payload.get("document"),
        "step_path": None,
        "staged_step_path": None,
        "glb_path": str(glb_path) if glb_path.exists() else None,
        "hybrid_summary_path": str(summary_path) if summary_path.exists() else None,
        "component_count": len(spec.get("components") or []),
        "freecad": hybrid_payload,
    }
    print_result(result)
    return 0 if result["success"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
