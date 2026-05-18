from __future__ import annotations

from pathlib import Path


RUN_STAGE_DIRS = {
    "inputs": "00_inputs",
    "layout": "01_layout",
    "geometry_edit": "02_geometry_edit",
    "simulation": "03_simulation",
    "postprocess": "04_postprocess",
    "case_build": "05_case_build",
    "analysis": "06_analysis",
    "suggestions": "07_suggestions",
    "visualizations": "visualizations",
    "logs": "logs",
}


def build_run_tree(run_root: Path | str) -> dict[str, Path]:
    root = Path(run_root)
    paths = {"run_root": root}
    for key, relative in RUN_STAGE_DIRS.items():
        paths[key] = root / relative
    for path in paths.values():
        path.mkdir(parents=True, exist_ok=True)
    return paths
