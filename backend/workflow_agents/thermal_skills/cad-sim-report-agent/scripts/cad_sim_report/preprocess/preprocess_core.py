from __future__ import annotations

from pathlib import Path
from typing import Any

from ..common import write_json
from .core_builders import build_cad_core, build_sim_core


def preprocess_core(workspace: Path, data: dict[str, Any], out_dir: Path) -> dict[str, Path]:
    outputs = {
        "cad_core": out_dir / "cad_core.json",
        "sim_core": out_dir / "sim_core.json",
    }
    write_json(outputs["cad_core"], build_cad_core(workspace, data))
    write_json(outputs["sim_core"], build_sim_core(workspace, data))
    return outputs
