"""Placeholder box CAD build orchestration."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .geometry import CadBoxGeometryBuilder
from .models import CadBoxBuildRequest, CadBoxBuildResult
from .screenshots import CadBoxScreenshotCapture
from .support import (
    default_cad_dir,
    default_doc_name,
    default_spec_path,
    execute_freecad_code,
    freecad_rpc_settings,
    load_spec,
    repo_root_from_box_dir,
)


class CadBoxBuilder:
    """Build placeholder box GLB geometry and FreeCAD screenshots."""

    def __init__(
        self,
        *,
        geometry_builder: CadBoxGeometryBuilder | None = None,
        screenshot_capture: CadBoxScreenshotCapture | None = None,
        box_dir: Path | None = None,
    ) -> None:
        self.screenshot_capture = screenshot_capture or CadBoxScreenshotCapture()
        self.geometry_builder = geometry_builder or CadBoxGeometryBuilder(
            screenshot_capture=self.screenshot_capture,
        )
        self.box_dir = box_dir or Path(__file__).resolve().parent

    def build(self, request: CadBoxBuildRequest) -> CadBoxBuildResult:
        workspace_dir, spec_path, output_dir, _spec = self.resolve_paths(request)
        glb_path = output_dir / "geometry_after.glb"
        doc_name = request.doc_name or default_doc_name(workspace_dir)
        host, port = freecad_rpc_settings(
            request.host,
            request.port,
            repo_root=repo_root_from_box_dir(self.box_dir),
        )
        payload = execute_freecad_code(
            host,
            port,
            self.render_script(spec_path, glb_path, output_dir, doc_name),
        )
        return self.build_result(spec_path, output_dir, glb_path, payload)

    def resolve_paths(
        self,
        request: CadBoxBuildRequest,
    ) -> tuple[Path, Path, Path, dict[str, Any]]:
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

    def render_script(self, *args: Any, **kwargs: Any) -> str:
        return self.geometry_builder.render_script(*args, **kwargs)

    def build_result(
        self,
        spec_path: Path,
        output_dir: Path,
        glb_path: Path,
        payload: dict[str, Any],
    ) -> CadBoxBuildResult:
        screenshots = self.screenshot_capture.result(output_dir, payload)
        return CadBoxBuildResult(
            success=bool(payload.get("success"))
            and glb_path.exists()
            and not screenshots["missing"],
            spec_path=spec_path,
            document=payload.get("document"),
            glb_path=glb_path if glb_path.exists() else None,
            screenshots=screenshots,
            component_count=payload.get("component_count"),
            wall_count=payload.get("wall_count"),
            freecad=payload,
        )
