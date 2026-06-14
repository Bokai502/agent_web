"""Validate that all RPC script templates produce valid Python after rendering."""

from __future__ import annotations

import json

import pytest

from freecad_cli_tools.freecad_sync import render_batch_sync_script
from freecad_cli_tools.rpc_script_fragments import (
    COMPONENT_SHAPE_HELPERS,
    PLACEMENT_HELPERS,
    WALL_HELPERS,
)
from freecad_cli_tools.rpc_script_loader import render_rpc_script

_DUMMY_STR = json.dumps("dummy")
_DUMMY_PATH = json.dumps("/tmp/dummy.json")
_DUMMY_OUTPUT_FILES = json.dumps(
    {
        "layout_topology": "/tmp/layout_topology.json",
        "geom": "/tmp/geom.json",
        "step": "/tmp/geometry_after.step",
        "glb": "/tmp/geometry_after.glb",
    }
)
_DUMMY_UPDATES = json.dumps(
    [
        {
            "component": "P001",
            "solid_name": "P001",
            "part_name": "P001_part",
            "position": [0.0, 0.0, 0.0],
            "orientation_rows": [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        }
    ]
)

SCRIPT_REPLACEMENTS: dict[str, dict[str, str]] = {
    "assembly_from_layout.py": {
        "__INPUT_PATH__": _DUMMY_PATH,
        "__DOC_NAME__": _DUMMY_STR,
        "__SAVE_PATH__": _DUMMY_PATH,
        "__EXPORT_GLB__": "True",
        "__FIT_VIEW__": "True",
        "__VIEW_NAME__": _DUMMY_STR,
        "__WALL_HELPERS__": WALL_HELPERS,
        "__PLACEMENT_HELPERS__": PLACEMENT_HELPERS,
        "__COMPONENT_SHAPE_HELPERS__": COMPONENT_SHAPE_HELPERS,
    },
    "assembly_from_component_info.py": {
        "__INPUT_PATH__": _DUMMY_PATH,
        "__DOC_NAME__": _DUMMY_STR,
        "__SAVE_PATH__": _DUMMY_PATH,
        "__EXPORT_GLB__": "True",
        "__FIT_VIEW__": "True",
        "__VIEW_NAME__": _DUMMY_STR,
        "__PLACEMENT_HELPERS__": PLACEMENT_HELPERS,
        "__WALL_HELPERS__": WALL_HELPERS,
    },
    "sync_component_placements.py": {
        "__DOC_NAME__": _DUMMY_STR,
        "__UPDATES__": _DUMMY_UPDATES,
        "__RECOMPUTE__": "True",
        "__EXPORT_STEP_PATH__": _DUMMY_PATH,
        "__PLACEMENT_HELPERS__": PLACEMENT_HELPERS,
    },
    "export_glb_from_step.py": {
        "__STEP_PATH__": _DUMMY_PATH,
        "__GLB_PATH__": _DUMMY_PATH,
        "__DOC_NAME__": _DUMMY_STR,
        "__FIT_VIEW__": "True",
    },
}


@pytest.mark.parametrize("script_name", sorted(SCRIPT_REPLACEMENTS))
def test_rendered_script_has_valid_syntax(script_name: str) -> None:
    replacements = SCRIPT_REPLACEMENTS[script_name]
    rendered = render_rpc_script(script_name, replacements)
    assert "__" not in rendered or _no_unreplaced_placeholders(rendered)
    compile(rendered, f"<rpc_scripts/{script_name}>", "exec")


def test_component_info_script_supports_step_and_box_generation() -> None:
    rendered = render_rpc_script(
        "assembly_from_component_info.py",
        SCRIPT_REPLACEMENTS["assembly_from_component_info.py"],
    )

    assert "def create_box_component(" in rendered
    assert "def create_step_component(" in rendered
    assert "def build_walls(" in rendered
    assert 'source.get("step_path")' in rendered
    assert '"wall_count": len(wall_names)' in rendered
    assert '"fallback_box_component_ids": fallback_box_component_ids' in rendered
    assert '"fallback_components_by_reason": fallback_components_by_reason' in rendered


def test_wall_helper_is_shared_by_layout_and_component_info_scripts() -> None:
    layout_rendered = render_rpc_script(
        "assembly_from_layout.py",
        SCRIPT_REPLACEMENTS["assembly_from_layout.py"],
    )
    component_info_rendered = render_rpc_script(
        "assembly_from_component_info.py",
        SCRIPT_REPLACEMENTS["assembly_from_component_info.py"],
    )

    assert WALL_HELPERS.count("def build_walls(") == 1
    assert layout_rendered.count("def build_walls(") == 1
    assert component_info_rendered.count("def build_walls(") == 1
    assert "Walls_part" in WALL_HELPERS


def test_hybrid_link_export_preserves_wall_parts() -> None:
    rendered = render_rpc_script(
        "export_component_info_hybrid_link.py",
        {
            "__INPUT_PATH__": _DUMMY_PATH,
            "__DOC_NAME__": _DUMMY_STR,
            "__SAVE_PATH__": _DUMMY_PATH,
            "__EXPORT_GLB__": "True",
            "__INCLUDE_ENVELOPE__": "True",
        },
    )

    assert 'obj.Name == "Walls_part"' in rendered
    assert "wall_export_count = len(" in rendered
    assert '"wall_export_count": wall_export_count' in rendered


def test_sync_component_placements_uses_delta_for_part_containers() -> None:
    rendered = render_rpc_script(
        "sync_component_placements.py",
        SCRIPT_REPLACEMENTS["sync_component_placements.py"],
    )

    assert "def apply_delta_placement(" in rendered
    assert "source_placement.inverse()" in rendered
    assert '"mode": "delta"' in rendered


@pytest.mark.parametrize(
    "script_name",
    [
        "assembly_from_layout.py",
        "assembly_from_component_info.py",
        "sync_component_placements.py",
    ],
)
def test_exporting_scripts_also_emit_glb(script_name: str) -> None:
    rendered = render_rpc_script(script_name, SCRIPT_REPLACEMENTS[script_name])
    assert "def export_step_and_glb(objects, step_path):" in rendered
    assert 'glb_path = str(Path(step_path).with_suffix(".glb"))' in rendered
    assert "Import.export(objects, step_path)" in rendered
    assert '"glb_path": ' in rendered


def test_export_glb_from_step_renders_standalone_glb_export() -> None:
    rendered = render_rpc_script(
        "export_glb_from_step.py",
        SCRIPT_REPLACEMENTS["export_glb_from_step.py"],
    )

    assert "Import.insert(STEP_PATH, doc.Name)" in rendered
    assert "def export_glb(objects, glb_path):" in rendered
    assert "ImportGui.export(objects, glb_path)" in rendered
    assert '"glb_path": GLB_PATH' in rendered


def _no_unreplaced_placeholders(code: str) -> bool:
    import re

    return not re.search(r"__[A-Z][A-Z0-9_]*__", code)
