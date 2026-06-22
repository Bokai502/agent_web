#!/usr/bin/env python3
"""Build geometry_after_power_filtered.step and simulation_input.json from cad_build_spec.json."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .freecad_script_fragments import freecad_base_script
from .local_freecad_helpers import normalize_runtime_path
from .spec_common import add_common_build_args, build_simulation_input, default_doc_name, execute_freecad_code, freecad_rpc_settings, print_result, resolve_build_paths, write_json


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build power-filtered simulation STEP from cad_build_spec.json.")
    add_common_build_args(parser)
    return parser.parse_args()


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
    result = []
    for component in raw_components:
        thermal = component.get("thermal") if isinstance(component.get("thermal"), dict) else {}
        power = thermal.get("power_W")
        try:
            include = bool(thermal.get("include_in_simulation")) and power is not None and float(power) > 0.0
        except Exception:
            include = False
        if include:
            result.append(component)
    return result
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
    doc.recompute()
    Import.export(objects, str(STEP_PATH))
    fit_active_view(doc)
    print(json.dumps({"success": True, "document": doc.Name, "save_path": str(STEP_PATH), "component_count": len(components), "wall_count": len(data.get("walls") or []), "wall_solid_count": 0, "envelope": bool(envelope), "export_object_count": len(objects)}))
except Exception as exc:
    print(json.dumps({"success": False, "error": str(exc)}))
    sys.exit(1)
''',
)


def render_script(input_path: Path, step_path: Path, doc_name: str) -> str:
    return (
        FREECAD_SCRIPT
        .replace("__FREECAD_MODULE_DIR__", json.dumps(normalize_runtime_path(Path(__file__).resolve().parent)))
        .replace("__INPUT_PATH__", json.dumps(str(input_path.resolve())))
        .replace("__DOC_NAME__", json.dumps(doc_name))
        .replace("__STEP_PATH__", json.dumps(str(step_path.resolve())))
    )


def main() -> int:
    args = parse_args()
    workspace_dir, spec_path, output_dir, spec = resolve_build_paths(args)
    step_path = output_dir / "geometry_after_power_filtered.step"
    simulation_input_path = output_dir / "simulation_input.json"
    write_json(simulation_input_path, build_simulation_input(spec, step_filename=step_path.name))
    doc_name = args.doc_name or default_doc_name(workspace_dir, "simulation")
    host, port = freecad_rpc_settings(args.host, args.port)
    payload = execute_freecad_code(host, port, render_script(spec_path, step_path, doc_name))
    result = {
        "success": bool(payload.get("success")) and step_path.exists() and simulation_input_path.exists(),
        "spec_path": str(spec_path),
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
    print_result(result)
    return 0 if result["success"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
