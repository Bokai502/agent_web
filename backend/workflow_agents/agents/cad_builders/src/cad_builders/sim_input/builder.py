"""Class API for CAD simulation input build steps."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .after_state import build_geom, build_registry, parse_grid_shape, write_grid_inputs
from cad_builders.catch_simulation_preprocess import preprocess_catch_simulation_spec
from .support import (
    build_simulation_input,
    default_cad_dir,
    default_doc_name,
    default_spec_path,
    execute_freecad_code,
    freecad_base_script,
    freecad_rpc_settings,
    load_spec,
    normalize_runtime_path,
    read_json,
    spec_to_layout_data,
    write_json,
)


FREECAD_SCRIPT = freecad_base_script(
    extra_imports="import Import",
    constants=r'''
INPUT_PATH = __INPUT_PATH__
DOC_NAME = __DOC_NAME__
STEP_PATH = __STEP_PATH__
''',
    helpers=r'''
def simulation_components(data):
    raw_components = data.get("components") or []
    if isinstance(raw_components, dict):
        raw_components = list(raw_components.values())
    return [component for component in raw_components if isinstance(component, dict)]
''',
    body=r'''
try:
    data = json.loads(Path(INPUT_PATH).read_text(encoding="utf-8"))
    doc = open_clean_document(DOC_NAME)
    objects = []
    envelope = build_envelope(doc, data)
    if envelope:
        objects.append(envelope)
    components = simulation_components(data)
    for component in components:
        placement = component.get("placement") if isinstance(component.get("placement"), dict) else {}
        objects.append(build_box(
            doc,
            str(component.get("id") or component.get("component_id")),
            placement.get("position") or component.get("position", [0,0,0]),
            component.get("dims", [1,1,1]),
            placement.get("rotation_matrix") or component.get("rotation_rows"),
        ))
    wall_objects = []
    for wall in data.get("walls") or []:
        wall_obj = build_wall(doc, wall)
        if wall_obj:
            wall_objects.append(wall_obj)
            objects.append(wall_obj)
    doc.recompute()
    Import.export(objects, str(STEP_PATH))
    fit_active_view(doc)
    print(json.dumps({
        "success": True,
        "document": doc.Name,
        "save_path": str(STEP_PATH),
        "component_count": len(components),
        "wall_count": len(data.get("walls") or []),
        "wall_solid_count": len(wall_objects),
        "envelope": bool(envelope),
        "export_object_count": len(objects),
    }))
except Exception as exc:
    print(json.dumps({"success": False, "error": str(exc)}))
    sys.exit(1)
''',
)


@dataclass(frozen=True)
class CadSimInputBuildRequest:
    workspace_dir: str | Path
    spec_path: str | Path | None = None
    output_dir: str | Path | None = None
    doc_name: str | None = None
    host: str | None = None
    port: int | None = None
    grid_shape: str = "32,32,32"


class CadSimInputBuilder:
    """Build geometry_after_power_filtered.step and simulation_input.json."""

    def build(self, request: CadSimInputBuildRequest) -> dict[str, Any]:
        workspace_dir, spec_path, output_dir, spec = self.resolve_paths(request)
        step_path = output_dir / "geometry_after_power_filtered.step"
        simulation_input_path = output_dir / "simulation_input.json"
        simulation_spec, preprocess_report = preprocess_catch_simulation_spec(spec)
        preprocessed_spec_path = output_dir / "cad_build_spec.simulation_preprocessed.json"
        preprocess_report_path = output_dir / "cad_build_spec.simulation_preprocess_report.json"
        write_json(preprocessed_spec_path, simulation_spec)
        write_json(preprocess_report_path, preprocess_report)
        write_json(simulation_input_path, build_simulation_input(simulation_spec, step_filename=step_path.name))
        doc_name = request.doc_name or default_doc_name(workspace_dir, "simulation")
        host, port = freecad_rpc_settings(request.host, request.port)
        payload = execute_freecad_code(host, port, self.render_script(preprocessed_spec_path, step_path, doc_name))
        return {
            "success": bool(payload.get("success")) and step_path.exists() and simulation_input_path.exists(),
            "spec_path": str(spec_path),
            "preprocessed_spec_path": str(preprocessed_spec_path),
            "preprocess_report_path": str(preprocess_report_path),
            "preprocess": preprocess_report,
            "document": payload.get("document"),
            "step_path": str(step_path) if step_path.exists() else None,
            "simulation_input_path": str(simulation_input_path),
            "component_count": payload.get("component_count"),
            "wall_count": payload.get("wall_count"),
            "wall_solid_count": payload.get("wall_solid_count"),
            "envelope": payload.get("envelope"),
            "export_object_count": payload.get("export_object_count"),
            "freecad": payload,
        }

    def resolve_paths(self, request: CadSimInputBuildRequest) -> tuple[Path, Path, Path, dict[str, Any]]:
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

    def render_script(self, input_path: Path, step_path: Path, doc_name: str) -> str:
        return (
            FREECAD_SCRIPT
            .replace("__FREECAD_MODULE_DIR__", json.dumps(normalize_runtime_path(Path(__file__).resolve().parent)))
            .replace("__INPUT_PATH__", json.dumps(str(input_path.resolve())))
            .replace("__DOC_NAME__", json.dumps(doc_name))
            .replace("__STEP_PATH__", json.dumps(str(step_path.resolve())))
        )


class CadAfterStatePreparer:
    """Prepare geometry_after metadata and COMSOL grid inputs from CAD outputs."""

    def prepare(self, request: CadSimInputBuildRequest) -> dict[str, Any]:
        workspace_dir = Path(request.workspace_dir).expanduser().resolve()
        cad_dir = (
            Path(request.output_dir).expanduser().resolve()
            if request.output_dir
            else default_cad_dir(workspace_dir)
        )
        spec_path = (
            Path(request.spec_path).expanduser().resolve()
            if request.spec_path
            else default_spec_path(workspace_dir)
        )
        grid_shape = parse_grid_shape(request.grid_shape)
        simulation_input_path = cad_dir / "simulation_input.json"
        preprocessed_spec_path = cad_dir / "cad_build_spec.simulation_preprocessed.json"
        preprocess_report_path = cad_dir / "cad_build_spec.simulation_preprocess_report.json"
        if preprocessed_spec_path.exists():
            simulation_spec = read_json(preprocessed_spec_path)
            preprocess_report = read_json(preprocess_report_path) if preprocess_report_path.exists() else {}
        else:
            simulation_spec, preprocess_report = preprocess_catch_simulation_spec(read_json(spec_path))
            write_json(preprocessed_spec_path, simulation_spec)
            write_json(preprocess_report_path, preprocess_report)
        layout = spec_to_layout_data(simulation_spec, simulation_only=True, include_walls=True)
        simulation_input = read_json(simulation_input_path)
        geom = build_geom(layout, simulation_input)
        registry = build_registry(geom, simulation_input)

        after_geom_path = cad_dir / "geometry_after.geom.json"
        after_layout_path = cad_dir / "geometry_after.layout_topology.json"
        registry_path = cad_dir / "geometry_after_registry.json"
        comsol_inputs_dir = cad_dir / "comsol_inputs"
        comsol_inputs_dir.mkdir(parents=True, exist_ok=True)
        coord_path = comsol_inputs_dir / "coord.txt"
        channels_path = comsol_inputs_dir / "channels_input.npz"

        write_json(after_geom_path, geom)
        write_json(after_layout_path, layout)
        write_json(registry_path, registry)
        grid_summary = write_grid_inputs(
            geom=geom,
            coord_path=coord_path,
            channels_path=channels_path,
            grid_shape=grid_shape,
        )
        return {
            "ok": True,
            "cad_dir": str(cad_dir),
            "outputs": {
                "geometry_after_geom": str(after_geom_path),
                "geometry_after_layout_topology": str(after_layout_path),
                "geometry_after_registry": str(registry_path),
                "preprocessed_spec": str(preprocessed_spec_path),
                "preprocess_report": str(preprocess_report_path),
                "coord": str(coord_path),
                "channels_input": str(channels_path),
            },
            "counts": {
                "components": len(geom.get("components") or {}),
                "walls": len(geom.get("walls") or {}),
            },
            "grid": grid_summary,
        }
