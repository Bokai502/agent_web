"""Geometry export v2: geom.json with install_faces registry.

与 v1 export_cad.py 的差异:
- OUTER_SHELL 单 solid (保留 v1 行为)
- 新增 WALL_<id> 每墙 1 solid (有厚度薄板)
- 组件命名带 kind 后缀: P_<idx>_internal / E_<idx>_external / R_<idx>_radiator
- geom.json v2: schema_version="2.0", 带 outer_shell / cabins / cabin_walls / placement_tree / install_faces / components
- v1 的 ENVELOPE_SHELL / ENVELOPE_X_PLUS 等名字不再使用

STEP/GLB CAD artifacts are generated later by the FreeCAD create-assembly workflow.
"""
from __future__ import annotations

import json

from src.schema_v2 import (
    SatelliteModelV2,
    SCHEMA_VERSION,
)


def export_cad_v2(
    model: SatelliteModelV2,
    out_step: str,
    out_geom_json: str,
) -> None:
    """Write the canonical v2 geometry JSON.

    ``out_step`` is accepted for backward-compatible call sites but ignored.
    """
    print(f"\n[v2 export] {len(model.parts)} parts, {len(model.cabin_walls)} walls")

    _write_geom_json(out_geom_json, model)
    print(f"  saved geom.json: {out_geom_json}")
    _print_export_counts(model)


def _write_geom_json(out_geom_json: str, model: SatelliteModelV2) -> None:
    geom = _geom_document(model)
    with open(out_geom_json, "w", encoding="utf-8") as f:
        json.dump(geom, f, indent=2, ensure_ascii=False)


def _geom_document(model: SatelliteModelV2) -> dict:
    return {
        "schema_version": SCHEMA_VERSION,
        "units": dict(model.units) if model.units else {"length": "mm", "mass": "kg", "power": "W"},
        "meta": dict(model.meta),
        "outer_shell": model.outer_shell.to_dict(),
        "cabins": [c.to_dict() for c in model.cabins],
        "cabin_walls": [w.to_dict() for w in model.cabin_walls],
        "placement_tree": [n.to_dict() for n in model.placement_tree],
        "install_faces": {fid: f.to_dict() for fid, f in model.install_faces.items()},
        "components": {p.id: p.to_dict() for p in model.parts},
    }


def _print_export_counts(model: SatelliteModelV2) -> None:
    print(
        f"  counts: cabins={len(model.cabins)}, walls={len(model.cabin_walls)}, "
        f"install_faces={len(model.install_faces)}, parts={len(model.parts)}"
    )
