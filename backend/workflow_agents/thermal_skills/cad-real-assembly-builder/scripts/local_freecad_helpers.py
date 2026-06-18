"""Local helpers for the cad-real-assembly-builder skill.

This skill is intentionally self-contained and does not import
freecad_cli_tools at runtime.
"""

from __future__ import annotations

from pathlib import Path
from typing import Mapping


FACE_DEFINITIONS = {
    0: ("-x", 0, -1),
    1: ("x", 0, 1),
    2: ("-y", 1, -1),
    3: ("y", 1, 1),
    4: ("-z", 2, -1),
    5: ("z", 2, 1),
    6: ("ext-x", 0, -1),
    7: ("ext+x", 0, 1),
    8: ("ext-y", 1, -1),
    9: ("ext+y", 1, 1),
    10: ("ext-z", 2, -1),
    11: ("ext+z", 2, 1),
}


def is_external_face(face_id: int) -> bool:
    return int(face_id) >= 6


def normalize_runtime_path(path: Path) -> str:
    return str(Path(path).expanduser().resolve())


def load_rpc_script(script_name: str) -> str:
    script_path = Path(__file__).resolve().parent / "rpc_scripts" / script_name
    return script_path.read_text(encoding="utf-8")


def render_rpc_script(script_name: str, replacements: Mapping[str, str]) -> str:
    content = load_rpc_script(script_name)
    for key, value in replacements.items():
        content = content.replace(key, value)
    return content


PLACEMENT_HELPERS = r"""
def matrix_to_rotation(matrix_rows):
    matrix = FreeCAD.Matrix()
    matrix.A11 = float(matrix_rows[0][0])
    matrix.A12 = float(matrix_rows[0][1])
    matrix.A13 = float(matrix_rows[0][2])
    matrix.A14 = 0.0
    matrix.A21 = float(matrix_rows[1][0])
    matrix.A22 = float(matrix_rows[1][1])
    matrix.A23 = float(matrix_rows[1][2])
    matrix.A24 = 0.0
    matrix.A31 = float(matrix_rows[2][0])
    matrix.A32 = float(matrix_rows[2][1])
    matrix.A33 = float(matrix_rows[2][2])
    matrix.A34 = 0.0
    matrix.A41 = 0.0
    matrix.A42 = 0.0
    matrix.A43 = 0.0
    matrix.A44 = 1.0
    return FreeCAD.Placement(matrix).Rotation


def make_placement(position, rotation_rows):
    placement = FreeCAD.Placement()
    placement.Base = FreeCAD.Vector(float(position[0]), float(position[1]), float(position[2]))
    placement.Rotation = matrix_to_rotation(rotation_rows)
    return placement
"""


WALL_HELPERS = r"""
def build_walls(doc, assembly, data):
    walls = data.get("walls") or []
    if not walls:
        return []

    walls_part = doc.addObject("App::Part", "Walls_part")
    assembly.addObject(walls_part)
    created = []
    for wall in walls:
        wall_id = str(wall.get("id") or wall.get("wall_id") or f"Wall_{len(created) + 1}")
        size = wall.get("size")
        position = wall.get("position")
        if not size or not position:
            bbox = wall.get("bbox") or {}
            bbox_min = bbox.get("min")
            bbox_max = bbox.get("max")
            if not bbox_min or not bbox_max:
                continue
            position = [float(value) for value in bbox_min]
            size = [float(bbox_max[axis]) - float(bbox_min[axis]) for axis in range(3)]
        if any(float(length) <= 0.0 for length in size):
            continue
        solid = doc.addObject("Part::Box", wall_id)
        solid.Length = float(size[0])
        solid.Width = float(size[1])
        solid.Height = float(size[2])
        solid.Placement = FreeCAD.Placement(FreeCAD.Vector(*position), FreeCAD.Rotation())
        solid.ViewObject.ShapeColor = (0.85, 0.65, 0.25, 0.0)
        solid.ViewObject.Transparency = 45
        walls_part.addObject(solid)
        created.append(wall_id)
    return created
"""
