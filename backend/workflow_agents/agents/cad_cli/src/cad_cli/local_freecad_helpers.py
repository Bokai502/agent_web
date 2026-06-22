"""Local helpers for the cad-real-assembly-builder skill."""

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
