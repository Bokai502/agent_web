"""Reusable FreeCAD RPC script fragments for CAD builders."""

from __future__ import annotations


def common_imports() -> str:
    return r'''
import importlib
import importlib.util
import json
import sys
from pathlib import Path

import FreeCAD
import FreeCADGui
import Part

FREECAD_MODULE_DIR = __FREECAD_MODULE_DIR__
if FREECAD_MODULE_DIR not in sys.path:
    sys.path.insert(0, FREECAD_MODULE_DIR)
def load_module_from_path(module_name, module_path):
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module
freecad_runtime = load_module_from_path("freecad_runtime", str(Path(FREECAD_MODULE_DIR) / "freecad_runtime.py"))
from freecad_runtime import build_box, build_envelope, build_wall, fit_active_view, open_clean_document
'''


def freecad_base_script(*, extra_imports: str = "", constants: str = "", helpers: str = "", body: str) -> str:
    return "\n".join(
        part.strip("\n")
        for part in (
            common_imports(),
            extra_imports,
            constants,
            helpers,
            body,
        )
        if part.strip()
    )
