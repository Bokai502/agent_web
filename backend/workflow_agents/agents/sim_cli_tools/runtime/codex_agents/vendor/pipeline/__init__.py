"""Compatibility package for vendor pipeline stage modules."""

from __future__ import annotations

from pathlib import Path

_VENDOR_ROOT = Path(__file__).resolve().parent.parent
__path__ = [
    str(_VENDOR_ROOT / "shared_contracts"),
    str(_VENDOR_ROOT / "geometry_edit_runtime"),
    str(_VENDOR_ROOT / "simulation_runtime"),
    str(_VENDOR_ROOT / "paraview_runtime"),
]
