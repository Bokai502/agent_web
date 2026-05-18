from __future__ import annotations

import argparse
import copy
import json
import shutil
import sys
from pathlib import Path
from typing import Any

import yaml

from core.io import read_json, write_json
from formats.validators import validate_real_bom
from apps.main_loop.layout_bom_parts import estimate_outer_size_mm, parts_from_components
from apps.main_loop.layout_materialize import materialize_layout_outputs
from local_defaults import LAYOUT3DCUBE_ROOT, LAYOUT_DIST_YAML, THERMAL_DB
from pipeline.input_normalize import adapt_module_db_bom, normalize_bom_to_components


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate 01_layout runs from module_db BOM JSON files.")
    parser.add_argument("--bom-dir", type=Path, required=True, help="Directory containing module_db BOM JSON files.")
    parser.add_argument("--run-root", type=Path, required=True, help="Batch output root.")
    parser.add_argument("--layout3dcube-root", type=Path, default=LAYOUT3DCUBE_ROOT)
    parser.add_argument("--dist-yaml", type=Path, default=LAYOUT_DIST_YAML)
    parser.add_argument("--sample-id-start", type=int, default=920001)
    parser.add_argument("--clearance-mm", type=float, default=3.0)
    parser.add_argument("--multistart", type=int, default=3)
    parser.add_argument("--target-fill-ratio", type=float, default=0.42)
    parser.add_argument("--max-boms", type=int, default=None)
    parser.add_argument(
        "--thermal-db",
        type=Path,
        default=THERMAL_DB,
    )
    args = parser.parse_args(argv)

    manifest = run_bom_layout_batch(
        bom_dir=args.bom_dir,
        run_root=args.run_root,
        layout3dcube_root=args.layout3dcube_root,
        dist_yaml=args.dist_yaml,
        sample_id_start=args.sample_id_start,
        clearance_mm=args.clearance_mm,
        multistart=args.multistart,
        target_fill_ratio=args.target_fill_ratio,
        thermal_db=args.thermal_db,
        max_boms=args.max_boms,
    )
    return 0 if manifest["ok"] else 1


def run_bom_layout_batch(
    *,
    bom_dir: Path,
    run_root: Path,
    layout3dcube_root: Path,
    dist_yaml: Path,
    sample_id_start: int,
    clearance_mm: float,
    multistart: int,
    target_fill_ratio: float,
    thermal_db: Path = THERMAL_DB,
    max_boms: int | None = None,
) -> dict[str, Any]:
    runtime = _load_layout_runtime(layout3dcube_root)
    dist = yaml.safe_load(Path(dist_yaml).read_text(encoding="utf-8"))
    bom_files = sorted(Path(bom_dir).glob("*.json"))
    if max_boms is not None:
        bom_files = bom_files[: max(0, max_boms)]
    run_root.mkdir(parents=True, exist_ok=True)

    results = []
    for index, bom_path in enumerate(bom_files):
        run_dir = run_root / bom_path.stem
        result = _run_one_bom_layout(
            bom_path=bom_path,
            run_dir=run_dir,
            dist=dist,
            runtime=runtime,
            sample_id=str(sample_id_start + index),
            seed=sample_id_start + index,
            clearance_mm=clearance_mm,
            multistart=multistart,
            target_fill_ratio=target_fill_ratio,
            thermal_db=thermal_db,
        )
        results.append(result)

    manifest = {
        "schema_version": "1.0",
        "ok": all(item.get("ok") for item in results),
        "bom_dir": str(bom_dir),
        "run_root": str(run_root),
        "total": len(results),
        "completed": sum(1 for item in results if item.get("ok")),
        "failed": sum(1 for item in results if not item.get("ok")),
        "results": results,
    }
    write_json(run_root / "batch_layout_manifest.json", manifest)
    return manifest


def run_one_bom_layout(
    *,
    bom_path: Path,
    run_dir: Path,
    layout3dcube_root: Path,
    dist_yaml: Path,
    sample_id: str,
    seed: int,
    clearance_mm: float,
    multistart: int,
    target_fill_ratio: float,
    thermal_db: Path = THERMAL_DB,
    forced_outer_size_mm: list[float] | None = None,
) -> dict[str, Any]:
    """Run the 01 layout generator for one BOM.

    ``forced_outer_size_mm`` is used by 02 geometry-edit relayout after an
    explicit shell expansion decision. The normal batch path leaves it unset
    and keeps the original outer-size estimator.
    """
    runtime = _load_layout_runtime(layout3dcube_root)
    dist = yaml.safe_load(Path(dist_yaml).read_text(encoding="utf-8"))
    return _run_one_bom_layout(
        bom_path=Path(bom_path),
        run_dir=Path(run_dir),
        dist=dist,
        runtime=runtime,
        sample_id=str(sample_id),
        seed=int(seed),
        clearance_mm=clearance_mm,
        multistart=multistart,
        target_fill_ratio=target_fill_ratio,
        thermal_db=Path(thermal_db),
        forced_outer_size_mm=forced_outer_size_mm,
    )


def _run_one_bom_layout(
    *,
    bom_path: Path,
    run_dir: Path,
    dist: dict[str, Any],
    runtime: dict[str, Any],
    sample_id: str,
    seed: int,
    clearance_mm: float,
    multistart: int,
    target_fill_ratio: float,
    thermal_db: Path,
    forced_outer_size_mm: list[float] | None = None,
) -> dict[str, Any]:
    input_dir = run_dir / "00_inputs"
    layout_dir = run_dir / "01_layout"
    component_info_dir = run_dir / "component_info"
    logs_dir = run_dir / "logs"
    sample_work_dir = layout_dir / "_layout3dcube_sample"
    for path in (input_dir, layout_dir, component_info_dir, logs_dir):
        if path.exists():
            shutil.rmtree(path)
        path.mkdir(parents=True, exist_ok=True)

    try:
        raw_bom = read_json(bom_path)
        adapted_bom = (
            raw_bom
            if _is_pipeline_kind_bom(raw_bom)
            else adapt_module_db_bom(raw_bom)
        )
        bom_validation = validate_real_bom(adapted_bom)
        if not bom_validation.ok:
            raise ValueError(json.dumps(bom_validation.to_dict(), ensure_ascii=False))

        components_from_bom = normalize_bom_to_components(
            adapted_bom,
            source_file=bom_path.name,
            preserve_component_id_for_instances=True,
        )
        part_bundle = parts_from_components(
            components_from_bom,
            runtime=runtime,
            clearance_mm=clearance_mm,
        )
        parts = part_bundle["parts"]
        part_source_map = part_bundle["part_source_map"]

        dist_for_sample = copy.deepcopy(dist)
        outer_size = (
            [round(float(value), 6) for value in forced_outer_size_mm]
            if forced_outer_size_mm is not None
            else estimate_outer_size_mm(
                components_from_bom,
                clearance_mm=clearance_mm,
                target_fill_ratio=target_fill_ratio,
            )
        )
        if len(outer_size) != 3 or min(outer_size) <= 0.0:
            raise ValueError(f"forced_outer_size_mm must contain 3 positive values, got {outer_size!r}")
        dist_for_sample["envelope"]["auto_envelope"] = False
        dist_for_sample["envelope"]["outer_size"] = outer_size
        sample_config = runtime["generate_sample_config_v2"](dist_for_sample, sample_id, seed)
        sample_config["packing"]["clearance"] = clearance_mm
        sample_config["packing"]["multistart"] = multistart

        if sample_work_dir.exists():
            shutil.rmtree(sample_work_dir)
        stats = runtime["process_prebuilt_sample_v2"](sample_config, sample_work_dir, dist_for_sample, parts)
        materialize_layout_outputs(
            sample_work_dir,
            layout_dir,
            input_dir,
            component_info_dir,
            adapted_bom,
            components_from_bom,
            part_source_map,
            thermal_db,
        )

        result = {
            "ok": stats.get("n_unplaced", 0) == 0,
            "bom": str(bom_path),
            "run_dir": str(run_dir),
            "sample_id": sample_id,
            "seed": seed,
            "stats": stats,
            "outer_size_mm": outer_size,
            "forced_outer_size_mm": forced_outer_size_mm,
            "target_fill_ratio": target_fill_ratio,
            "layout_dir": str(layout_dir),
            "component_info_dir": str(component_info_dir),
        }
        if stats.get("n_unplaced", 0):
            result["error"] = f"{stats['n_unplaced']} part(s) were not placed"
        write_json(logs_dir / "layout_batch_result.json", result)
        return result
    except Exception as exc:
        result = {
            "ok": False,
            "bom": str(bom_path),
            "run_dir": str(run_dir),
            "sample_id": sample_id,
            "error": f"{type(exc).__name__}: {exc}",
        }
        write_json(logs_dir / "layout_batch_result.json", result)
        return result


def _load_layout_runtime(layout3dcube_root: Path) -> dict[str, Any]:
    root = Path(layout3dcube_root).resolve()
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))

    from src.sample_processor_v2 import CATEGORY_COLORS, KIND_TINTS, generate_sample_config_v2, process_prebuilt_sample_v2
    from src.schema_v2 import PartV2

    return {
        "PartV2": PartV2,
        "CATEGORY_COLORS": CATEGORY_COLORS,
        "KIND_TINTS": KIND_TINTS,
        "generate_sample_config_v2": generate_sample_config_v2,
        "process_prebuilt_sample_v2": process_prebuilt_sample_v2,
    }


def _is_pipeline_kind_bom(bom: dict[str, Any]) -> bool:
    """Return true when a BOM has already been adapted to pipeline kinds."""
    allowed = {"internal", "external", "radiator"}
    kinds = {
        str(item.get("kind") or "").strip()
        for item in bom.get("items", [])
        if isinstance(item, dict)
    }
    return bool(kinds) and kinds <= allowed


if __name__ == "__main__":
    raise SystemExit(main())
