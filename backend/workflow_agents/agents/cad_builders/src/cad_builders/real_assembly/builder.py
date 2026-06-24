"""Class-based supplemental real assembly CAD builder."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .models import CadRealAssemblyBuildRequest, CadRealAssemblyBuildResult
from .support import (
    FACE_DEFINITIONS,
    component_bbox,
    default_cad_dir,
    default_doc_name,
    default_spec_path,
    execute_freecad_code,
    freecad_rpc_settings,
    is_external_face,
    load_spec,
    normalize_runtime_path,
    render_rpc_script,
    write_json,
)


class CadRealAssemblyBuilder:
    """Build supplemental real assembly GLB geometry through hybrid-link."""

    def __init__(self, *, module_dir: Path | None = None, real_assembly_dir: Path | None = None) -> None:
        self.real_assembly_dir = real_assembly_dir or Path(__file__).resolve().parent
        self.module_dir = module_dir or self.real_assembly_dir.parent

    def build(self, request: CadRealAssemblyBuildRequest) -> CadRealAssemblyBuildResult:
        workspace_dir, spec_path, output_dir, spec = self.resolve_paths(request)
        glb_path = output_dir / "geometry_after_real_cad.glb"
        summary_path = output_dir / "geometry_after_real_cad.hybrid_summary.json"
        step_path = output_dir / "geometry_after_real_cad.step"
        doc_name = request.doc_name or default_doc_name(workspace_dir, "real_cad")
        normalized_input_path = self.normalized_input_path(output_dir)
        normalized = self.normalized_real_cad_input(spec, spec_path, workspace_dir)
        write_json(normalized_input_path, normalized)
        self.prepare_output_paths(glb_path, summary_path, step_path)

        host, port = freecad_rpc_settings(request.host, request.port)
        hybrid_payload = execute_freecad_code(
            host,
            port,
            self.render_hybrid_script(normalized_input_path, step_path, doc_name),
        )
        self.remove_step_artifact(step_path)
        return self.build_result(spec_path, normalized_input_path, glb_path, summary_path, spec, hybrid_payload)

    def resolve_paths(self, request: CadRealAssemblyBuildRequest) -> tuple[Path, Path, Path, dict[str, Any]]:
        workspace_dir = Path(request.workspace_dir).expanduser().resolve()
        spec_path = (
            Path(request.spec_path).expanduser().resolve()
            if request.spec_path
            else default_spec_path(workspace_dir)
        )
        output_dir = (
            Path(request.output_dir).expanduser().resolve()
            if request.output_dir
            else default_cad_dir(workspace_dir)
        )
        output_dir.mkdir(parents=True, exist_ok=True)
        spec = load_spec(spec_path)
        return workspace_dir, spec_path, output_dir, spec

    def normalized_input_path(self, output_dir: Path) -> Path:
        return output_dir / "normalized_component_info_assembly.json"

    def prepare_output_paths(self, glb_path: Path, summary_path: Path, step_path: Path) -> None:
        for path in (glb_path, summary_path, step_path):
            path.parent.mkdir(parents=True, exist_ok=True)
            if path.exists():
                path.unlink()

    def remove_step_artifact(self, step_path: Path) -> None:
        if step_path.exists():
            step_path.unlink()

    def normalized_real_cad_input(self, spec: dict[str, Any], spec_path: Path, workspace_dir: Path) -> dict[str, Any]:
        components: dict[str, Any] = {}
        for component in spec.get("components") or []:
            component_id = str(component.get("id") or component.get("component_id"))
            bbox = component_bbox(component)
            real_cad = component.get("real_cad") if isinstance(component.get("real_cad"), dict) else {}
            step_path = real_cad.get("step_path")
            resolved_step_path = self.resolve_step_path(step_path, spec_path, workspace_dir)
            step_exists = resolved_step_path is not None and resolved_step_path.exists()
            components[component_id] = {
                "id": component_id,
                "component_id": component_id,
                "category": component.get("category"),
                "color": component.get("color"),
                "target_bbox": bbox,
                "target_size": self.bbox_size(bbox),
                "placement": self.placement_payload(component),
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
            "envelope": self.envelope_payload(spec),
            "walls": spec.get("walls") or [],
            "components": components,
        }

    def render_hybrid_script(self, input_path: Path, step_path: Path, doc_name: str) -> str:
        return render_rpc_script(
            "build_real_assembly_hybrid.py",
            {
                "__FACE_DEFINITIONS__": repr(FACE_DEFINITIONS),
                "__INPUT_PATH__": json.dumps(normalize_runtime_path(input_path)),
                "__DOC_NAME__": json.dumps(doc_name),
                "__SAVE_PATH__": json.dumps(normalize_runtime_path(step_path)),
                "__INCLUDE_ENVELOPE__": "True",
                "__FREECAD_MODULE_DIR__": json.dumps(normalize_runtime_path(self.module_dir)),
            },
            module_dir=self.module_dir,
        )

    def build_result(
        self,
        spec_path: Path,
        normalized_input_path: Path,
        glb_path: Path,
        summary_path: Path,
        spec: dict[str, Any],
        hybrid_payload: dict[str, Any],
    ) -> CadRealAssemblyBuildResult:
        return CadRealAssemblyBuildResult(
            success=bool(hybrid_payload.get("success")) and glb_path.exists() and summary_path.exists(),
            backend="hybrid-link",
            spec_path=spec_path,
            normalized_input_path=normalized_input_path,
            document=hybrid_payload.get("document"),
            step_path=None,
            temporary_step_path=None,
            glb_path=glb_path if glb_path.exists() else None,
            hybrid_summary_path=summary_path if summary_path.exists() else None,
            component_count=len(spec.get("components") or []),
            freecad=hybrid_payload,
        )

    def envelope_payload(self, spec: dict[str, Any]) -> dict[str, Any]:
        envelope = spec.get("envelope") if isinstance(spec.get("envelope"), dict) else {}
        outer_bbox = envelope.get("outer_bbox") if isinstance(envelope.get("outer_bbox"), dict) else {}
        inner_bbox = envelope.get("inner_bbox") if isinstance(envelope.get("inner_bbox"), dict) else {}
        return {
            "outer_size": envelope.get("outer_size") or self.bbox_size_or_none(outer_bbox),
            "inner_size": envelope.get("inner_size") or self.bbox_size_or_none(inner_bbox),
            "outer_min": outer_bbox.get("min"),
            "outer_max": outer_bbox.get("max"),
            "inner_min": inner_bbox.get("min"),
            "inner_max": inner_bbox.get("max"),
            "shell_thickness": envelope.get("shell_thickness", 0.0),
        }

    def placement_payload(self, component: dict[str, Any]) -> dict[str, Any]:
        mount = component.get("mount") if isinstance(component.get("mount"), dict) else {}
        install_face_id = mount.get("install_face_id")
        component_face_id = mount.get("component_face_id")
        component_local_face = mount.get("component_face_index")
        contact_axis = mount.get("contact_plane_axis")
        normal_sign = mount.get("normal_sign")

        if component_local_face is None:
            component_local_face = 4
        if contact_axis is None or normal_sign is None:
            raise ValueError(
                f"{component.get('id')} mount.contact_plane_axis and normal_sign are required for hybrid-link"
            )

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

    def resolve_step_path(self, step_path: Any, spec_path: Path, workspace_dir: Path) -> Path | None:
        if not isinstance(step_path, str) or not step_path.strip():
            return None
        path = Path(step_path).expanduser()
        if path.is_absolute():
            return path.resolve()
        candidates = [
            workspace_dir / path,
            spec_path.parent / path,
            spec_path.parent.parent / path,
        ]
        for candidate in candidates:
            if candidate.exists():
                return candidate.resolve()
        return candidates[0].resolve()

    def bbox_size(self, bbox: dict[str, list[float]]) -> list[float]:
        return [float(bbox["max"][axis]) - float(bbox["min"][axis]) for axis in range(3)]

    def bbox_size_or_none(self, bbox: dict[str, Any]) -> list[float] | None:
        bbox_min = bbox.get("min")
        bbox_max = bbox.get("max")
        if not isinstance(bbox_min, list) or not isinstance(bbox_max, list):
            return None
        if len(bbox_min) != 3 or len(bbox_max) != 3:
            return None
        return self.bbox_size({"min": bbox_min, "max": bbox_max})
