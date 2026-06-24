"""Add explicit thermal material fields to CATCH wall specs.

The CAD workflow derives simulation_input.json and sample.yaml from the source
cad_build_spec.json. This helper makes wall material data persistent at that
source level while preserving the original file by default.
"""

from __future__ import annotations

import argparse
import json
from copy import deepcopy
from pathlib import Path
from typing import Any


DEFAULT_MATERIAL = {
    "material_id": "aluminum_6061",
    "thermalconductivity": 167.0,
    "conductivity_W_mK": 167.0,
    "density": 2700.0,
    "heatcapacity": 896.0,
    "heat_capacity_J_kgK": 896.0,
}


def add_wall_materials(
    spec: dict[str, Any],
    *,
    material_id: str = DEFAULT_MATERIAL["material_id"],
    thermalconductivity: float = DEFAULT_MATERIAL["thermalconductivity"],
    density: float = DEFAULT_MATERIAL["density"],
    heatcapacity: float = DEFAULT_MATERIAL["heatcapacity"],
    overwrite: bool = False,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Return a copy of *spec* with explicit wall thermal material fields."""
    updated = deepcopy(spec)
    material = {
        "material_id": material_id,
        "thermalconductivity": float(thermalconductivity),
        "conductivity_W_mK": float(thermalconductivity),
        "density": float(density),
        "heatcapacity": float(heatcapacity),
        "heat_capacity_J_kgK": float(heatcapacity),
    }
    changes: list[dict[str, Any]] = []

    walls = updated.get("walls")
    if not isinstance(walls, list):
        return updated, {
            "ok": False,
            "wall_count": 0,
            "updated_count": 0,
            "changes": [],
            "error": "cad_build_spec.walls must be a list",
        }

    for index, wall in enumerate(walls):
        if not isinstance(wall, dict):
            continue
        wall_id = str(wall.get("id") or wall.get("wall_id") or wall.get("name") or f"wall_{index + 1}")
        thermal = wall.get("thermal")
        if not isinstance(thermal, dict):
            thermal = {}
            wall["thermal"] = thermal
        before = {key: thermal.get(key) for key in material}
        changed_keys = []
        for key, value in material.items():
            if overwrite or thermal.get(key) is None:
                if thermal.get(key) != value:
                    changed_keys.append(key)
                thermal[key] = value
        if changed_keys:
            changes.append(
                {
                    "wall_id": wall_id,
                    "changed_keys": changed_keys,
                    "before": before,
                    "after": {key: thermal.get(key) for key in material},
                }
            )

    return updated, {
        "ok": True,
        "wall_count": len(walls),
        "updated_count": len(changes),
        "changes": changes,
        "material": material,
        "overwrite": overwrite,
    }


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def default_output_path(input_path: Path) -> Path:
    return input_path.with_name(f"{input_path.stem}.with_wall_materials{input_path.suffix}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Add explicit wall thermal materials to cad_build_spec.json.")
    parser.add_argument("input", type=Path, help="Source cad_build_spec.json")
    parser.add_argument("-o", "--output", type=Path, default=None, help="Output JSON path. Defaults to *.with_wall_materials.json")
    parser.add_argument("--in-place", action="store_true", help="Overwrite the input JSON")
    parser.add_argument("--overwrite", action="store_true", help="Overwrite existing wall thermal values")
    parser.add_argument("--material-id", default=DEFAULT_MATERIAL["material_id"])
    parser.add_argument("--thermalconductivity", type=float, default=DEFAULT_MATERIAL["thermalconductivity"])
    parser.add_argument("--density", type=float, default=DEFAULT_MATERIAL["density"])
    parser.add_argument("--heatcapacity", type=float, default=DEFAULT_MATERIAL["heatcapacity"])
    parser.add_argument("--report", type=Path, default=None, help="Optional JSON report path")
    args = parser.parse_args(argv)

    input_path = args.input.expanduser().resolve()
    output_path = input_path if args.in_place else (args.output.expanduser().resolve() if args.output else default_output_path(input_path))
    report_path = args.report.expanduser().resolve() if args.report else output_path.with_name(f"{output_path.stem}.wall_material_report.json")

    spec = json.loads(input_path.read_text(encoding="utf-8"))
    updated, report = add_wall_materials(
        spec,
        material_id=args.material_id,
        thermalconductivity=args.thermalconductivity,
        density=args.density,
        heatcapacity=args.heatcapacity,
        overwrite=args.overwrite,
    )
    report.update(
        {
            "input": str(input_path),
            "output": str(output_path),
            "report": str(report_path),
        }
    )
    if not report.get("ok"):
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 1

    write_json(output_path, updated)
    write_json(report_path, report)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
