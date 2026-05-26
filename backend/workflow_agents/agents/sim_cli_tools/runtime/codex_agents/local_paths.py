from __future__ import annotations

from pathlib import Path


RUN_STAGE_DIRS = {
    "simulation": "simulation",
    "postprocess": "postprocess",
    "case_build": "case_build",
    "analysis": "analysis",
}


def build_run_tree(run_root: Path | str) -> dict[str, Path]:
    root = Path(run_root)
    paths = {"run_root": root}
    for key, relative in RUN_STAGE_DIRS.items():
        paths[key] = root / relative
    for path in paths.values():
        path.mkdir(parents=True, exist_ok=True)
    return paths
