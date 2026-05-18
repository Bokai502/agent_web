"""v2 样本处理器: build_placement_tree → synth parts(含 kind) → multistart_pack_v2 → export_cad_v2

与 v1 `sample_processor.py` 的差异:
- 不再用 Envelope + keepout_split, 改用 SatelliteModelV2 + build_placement_tree
- Part 带 kind ∈ {internal, external, radiator}
- 导出走 export_cad_v2 (OUTER_SHELL / WALL_<id> / P_<idx>_<KIND> 命名, geom.json v2 含 install_faces 注册表)
- sample.yaml v2: schema_version="2.0" + outer_shell/cabins/walls/placement_tree/install_faces/components

dataset_generator 走 v1-shape 兼容 dict (通过内存构造, 不落盘兼容 json),
因为 grid/mask/tensor 数学与 v1 一致.
"""
from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
import yaml

from src.schema_v2 import (
    AABB,
    PartV2,
    SatelliteModelV2,
    SCHEMA_VERSION,
)
from src.placement_tree import build_placement_tree
from src.pack_v2 import multistart_pack_v2
from src.export_cad_v2 import export_cad_v2
from src.dataset_generator import DatasetGenerator


# 类别颜色映射 (和 v1 synth_bom 一致)
CATEGORY_COLORS = {
    "payload": (100, 150, 255, 255),
    "avionics": (255, 200, 100, 255),
    "power": (100, 255, 150, 255),
    "thermal": (255, 100, 150, 255),
    "structure": (150, 150, 150, 255),
    "default": (200, 200, 200, 255),
}

# kind → 视觉 tint (导出时覆盖 category 颜色)
KIND_TINTS = {
    "internal": None,              # 沿用 category 颜色
    "external": (220, 140, 60, 255),    # 橙
    "radiator": (60, 200, 220, 255),    # 青
}


# ============================================================
# dist.yaml v2 抽样
# ============================================================

def _sample_value(rng: np.random.Generator, dist_range):
    if isinstance(dist_range, list) and len(dist_range) == 2:
        return float(rng.uniform(dist_range[0], dist_range[1]))
    return dist_range


def _generate_size_ratio(rng: np.random.Generator, max_ratio: float = 2.0) -> List[float]:
    for _ in range(100):
        r = rng.uniform(1.0, max_ratio, size=3)
        r = r / r.min()
        if r.max() / r.min() < max_ratio:
            return r.tolist()
    return [1.0, 1.5, 2.0]


def _sample_kind(rng: np.random.Generator, kinds_cfg: Dict) -> str:
    """按 kind_probs 抽样 kind"""
    names = list(kinds_cfg.keys())
    probs = [kinds_cfg[n]["prob"] for n in names]
    total = sum(probs)
    probs = [p / total for p in probs]
    return str(rng.choice(names, p=probs))


def _sample_dims_for_kind(rng: np.random.Generator, kind_cfg: Dict) -> Tuple[float, float, float]:
    dims_cfg = kind_cfg["dims_mm"]
    return (
        float(rng.uniform(dims_cfg["x"][0], dims_cfg["x"][1])),
        float(rng.uniform(dims_cfg["y"][0], dims_cfg["y"][1])),
        float(rng.uniform(dims_cfg["z"][0], dims_cfg["z"][1])),
    )


def synth_parts_v2(dist: Dict, seed: int, clearance_mm: float) -> List[PartV2]:
    """按 v2 分布生成 PartV2 列表 (含 kind / category / thermal / mass / power)"""
    rng = np.random.default_rng(seed)
    rand = random.Random(seed)

    comp = dist["components"]
    n_parts = int(rand.randint(comp["count"][0], comp["count"][1]))

    kinds_cfg = comp["kinds"]
    categories = comp["categories"]
    cat_probs = comp.get("category_probs", None)
    mass_range = comp["mass"]
    power_range = comp["power"]

    th_surf = comp.get("thermal", {}).get("surface", {})
    th_iface = comp.get("thermal", {}).get("interfaces", {})
    emis_range = th_surf.get("emissivity", [0.05, 0.95])
    absorb_range = th_surf.get("absorptivity", [0.1, 0.9])
    R_range = th_iface.get("contact_resistance", [0.0001, 0.01])

    # 每 kind 独立计数, 以便 part id 稳定
    kind_counters = {"internal": 0, "external": 0, "radiator": 0}

    parts: List[PartV2] = []
    for _ in range(n_parts):
        kind = _sample_kind(rng, kinds_cfg)
        kind_cfg = kinds_cfg[kind]
        dims = _sample_dims_for_kind(rng, kind_cfg)
        mass = float(rng.uniform(mass_range[0], mass_range[1]))
        # radiator 是被动辐射散热面 (贴膜), 自身不耗电, 功率=0
        power = 0.0 if kind == "radiator" else float(rng.uniform(power_range[0], power_range[1]))

        if cat_probs:
            # np.random.choice with probs
            idx = rng.choice(len(categories), p=np.asarray(cat_probs, dtype=float) / sum(cat_probs))
            category = categories[int(idx)]
        else:
            category = rand.choice(categories)

        # id: P_000_internal / E_000_external / R_000_radiator
        prefix = {"internal": "P", "external": "E", "radiator": "R"}[kind]
        idx = kind_counters[kind]
        kind_counters[kind] += 1
        pid = f"{prefix}_{idx:03d}_{kind}"

        base_color = CATEGORY_COLORS.get(category, CATEGORY_COLORS["default"])
        tint = KIND_TINTS.get(kind)
        color = tint if tint is not None else base_color

        thermal_surface = {
            "emissivity": float(rng.uniform(emis_range[0], emis_range[1])),
            "absorptivity": float(rng.uniform(absorb_range[0], absorb_range[1])),
        }
        thermal_interface = {
            "contact_resistance": float(rng.uniform(R_range[0], R_range[1])),
        }

        parts.append(
            PartV2(
                id=pid,
                kind=kind,
                category=category,
                dims=dims,
                mass=mass,
                power=power,
                color=color,
                clearance_mm=clearance_mm,
                thermal_surface=thermal_surface,
                thermal_interface=thermal_interface,
            )
        )

    # 统计
    counts = {k: 0 for k in kind_counters}
    for p in parts:
        counts[p.kind] += 1
    print(f"  生成 {n_parts} 个 PartV2: internal={counts['internal']}, external={counts['external']}, radiator={counts['radiator']}")
    return parts


# ============================================================
# outer_size 估算 (auto_envelope)
# ============================================================

def _estimate_outer_size(parts: List[PartV2], env_cfg: Dict, rng: np.random.Generator) -> Tuple[Tuple[float, float, float], float]:
    """返回 (outer_size, shell_thickness)"""
    fill_ratio = _sample_value(rng, env_cfg["fill_ratio"])
    shell_thickness = _sample_value(rng, env_cfg["shell_thickness"])
    size_ratio = _generate_size_ratio(rng, env_cfg.get("size_ratio_constraint", 2.0))

    if env_cfg.get("auto_envelope", True):
        # 只算 internal (cabin 内的) 总体积; external/radiator 挂外壁, 不占 inner
        internal_parts = [p for p in parts if p.kind == "internal"]
        if internal_parts:
            internal_volume = sum(float(np.prod(p.dims)) for p in internal_parts)
        else:
            internal_volume = sum(float(np.prod(p.dims)) for p in parts)  # 回退
        target_inner_volume = internal_volume / fill_ratio
        size_ratio_arr = np.array(size_ratio, dtype=float)
        k = target_inner_volume / float(np.prod(size_ratio_arr))
        scale = k ** (1.0 / 3.0)
        inner_size = size_ratio_arr * scale
        outer_size = inner_size + 2.0 * shell_thickness
        return tuple(outer_size.tolist()), float(shell_thickness)
    else:
        outer_size = env_cfg["outer_size"]
        return tuple(float(v) for v in outer_size), float(shell_thickness)


# ============================================================
# v2 模型 → v1-shape geom dict (给 DatasetGenerator 吃)
# ============================================================

def _build_v1shape_geom_dict(model: SatelliteModelV2) -> Dict:
    """为 DatasetGenerator 构造 v1 风格 dict: {_envelope, part_id: {pos, dims, power, mass, ...}, ...}

    注意: 这只是 DatasetGenerator 的 bridge, 不落盘作为正式中间文件.
    v2 正式中间文件是 export_cad_v2 生成的 geom.json v2.
    """
    outer_size = model.outer_shell.outer_bbox.size().tolist()
    inner_size = model.outer_shell.inner_bbox.size().tolist()
    thickness = float(model.outer_shell.thickness)

    d: Dict = {
        "_units": {"length": "mm", "mass": "kg", "power": "W"},
        "_envelope": {
            "outer_size": outer_size,
            "inner_size": inner_size,
            "thickness": thickness,
            "fill_ratio": 0.0,      # 不关心, DatasetGenerator 未用
            "size_ratio": [1.0, 1.0, 1.0],
            "is_sheet": thickness == 0,
        },
    }
    for p in model.parts:
        if p.position is None:
            continue
        pos = p.position.tolist()
        dims = list(p.dims)
        d[p.id] = {
            "shape": "box",
            "pos": [float(pos[0]), float(pos[1]), float(pos[2])],
            "dims": [float(dims[0]), float(dims[1]), float(dims[2])],
            "category": p.category,
            "mass": float(p.mass),
            "power": float(p.power),
            "kind": p.kind,
            "mount_face_id": p.mount_face_id,
            "leaf_node_id": p.leaf_node_id,
        }
    return d


# ============================================================
# sample.yaml v2 输出
# ============================================================

def _sanitize(obj):
    """numpy → plain python (yaml-safe)"""
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_sanitize(x) for x in obj]
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, (np.floating,)):
        return float(obj)
    if isinstance(obj, (np.integer,)):
        return int(obj)
    return obj


def write_sample_yaml_v2(
    sample_config: Dict,
    model: SatelliteModelV2,
    yaml_path: Path,
) -> None:
    """把 v2 模型 + 样本元信息写到 sample.yaml"""
    content = {
        "schema_version": SCHEMA_VERSION,
        "units": sample_config.get("units", {"length": "mm", "mass": "kg", "power": "W"}),
        "sample_id": sample_config["sample_id"],
        "seed": sample_config["seed"],
        "envelope": sample_config.get("envelope", {}),      # 原始分布抽样出的 envelope 元信息
        "packing": sample_config.get("packing", {}),
        "cabins_layout": sample_config.get("cabins_layout", {}),
        "outer_shell": model.outer_shell.to_dict(),
        "cabins": [c.to_dict() for c in model.cabins],
        "cabin_walls": [w.to_dict() for w in model.cabin_walls],
        "placement_tree": [n.to_dict() for n in model.placement_tree],
        "install_faces": {fid: f.to_dict() for fid, f in model.install_faces.items()},
        "components": {p.id: p.to_dict() for p in model.parts},
    }
    content = _sanitize(content)
    with open(yaml_path, "w", encoding="utf-8") as f:
        yaml.dump(content, f, default_flow_style=False, sort_keys=False, allow_unicode=True)


def _write_stats_text(stats_path: Path, sample_id: str, seed: int, stats: Dict, outer_size, shell_thickness) -> None:
    with open(stats_path, "w", encoding="utf-8") as f:
        f.write(f"样本ID: {sample_id}\n")
        f.write(f"schema_version: {SCHEMA_VERSION}\n")
        f.write(f"seed: {seed}\n\n")
        f.write(f"placed: {stats['n_placed']}/{stats['n_parts']} ({stats['placement_rate'] * 100:.1f}%)\n")
        f.write(f"kind_counts: {stats['kind_counts']}\n")
        f.write(f"cabins: {stats['n_cabins']}, walls: {stats['n_walls']}, install_faces: {stats['n_install_faces']}\n")
        f.write(f"total_mass: {stats['total_mass']:.2f} kg\n")
        f.write(f"total_power: {stats['total_power']:.2f} W\n")
        f.write(f"outer_size: {outer_size}, shell_thickness: {shell_thickness}\n")


def _finalize_sample_output(
    sample_config: Dict,
    output_dir: Path,
    model: SatelliteModelV2,
    parts: List[PartV2],
    unplaced: List[PartV2],
    outer_size,
    shell_thickness: float,
) -> Dict:
    geom_dir = output_dir / "geom"
    inputs_dir = output_dir / "inputs"
    qc_dir = output_dir / "qc"
    geom_dir.mkdir(parents=True, exist_ok=True)
    inputs_dir.mkdir(parents=True, exist_ok=True)
    qc_dir.mkdir(parents=True, exist_ok=True)

    geom_json_path = geom_dir / "geom.json"
    export_cad_v2(model, "", str(geom_json_path))

    bridge_dict = _build_v1shape_geom_dict(model)
    bridge_json = inputs_dir / "_geom_for_dataset.json"
    with open(bridge_json, "w", encoding="utf-8") as f:
        json.dump(bridge_dict, f, ensure_ascii=False)

    generator = DatasetGenerator(str(bridge_json), grid_shape=(32, 32, 32))
    generator.generate_coordinates()
    mask = generator.generate_mask_tensor()
    power = generator.generate_power_tensor()
    mass = generator.generate_mass_tensor()

    coord_path = inputs_dir / "coord.txt"
    channels_path = inputs_dir / "channels_input.npz"
    generator.save_coordinates(str(coord_path), unit="m")
    np.savez_compressed(channels_path, mask=mask, power=power, mass=mass)

    sample_yaml_path = output_dir / "sample.yaml"
    sample_config_out = dict(sample_config)
    sample_config_out["envelope"] = {
        **sample_config.get("envelope", {}),
        "outer_size": list(outer_size),
        "shell_thickness": shell_thickness,
    }
    write_sample_yaml_v2(sample_config_out, model, sample_yaml_path)

    rate = len(model.parts) / max(len(parts), 1)
    stats = {
        "schema_version": SCHEMA_VERSION,
        "n_parts": len(parts),
        "n_placed": len(model.parts),
        "n_unplaced": len(unplaced),
        "placement_rate": float(rate),
        "n_cabins": len(model.cabins),
        "n_walls": len(model.cabin_walls),
        "n_install_faces": len(model.install_faces),
        "total_mass": float(sum(p.mass for p in model.parts)),
        "total_power": float(sum(p.power for p in model.parts)),
        "outer_size": list(outer_size),
        "shell_thickness": shell_thickness,
        "kind_counts": {
            "internal": sum(1 for p in model.parts if p.kind == "internal"),
            "external": sum(1 for p in model.parts if p.kind == "external"),
            "radiator": sum(1 for p in model.parts if p.kind == "radiator"),
        },
    }
    _write_stats_text(qc_dir / "stats.txt", sample_config["sample_id"], sample_config["seed"], stats, outer_size, shell_thickness)
    return stats


def process_prebuilt_sample_v2(
    sample_config: Dict,
    output_dir: Path,
    dist: Dict,
    parts: List[PartV2],
) -> Dict:
    sample_id = sample_config["sample_id"]
    seed = sample_config["seed"]
    print("\n" + "=" * 60)
    print(f"[v2] 处理预构建样本: {sample_id} (seed={seed})")
    print("=" * 60)

    rng = np.random.default_rng(seed)
    multistart = int(sample_config["packing"].get("multistart", 3))
    outer_size, shell_thickness = _estimate_outer_size(parts, dist["envelope"], rng)
    cabins_layout = dict(dist.get("cabins_layout", {"type": "auto"}))
    cabins_layout.update(dict(sample_config.get("cabins_layout", {})))
    if "keep_out" not in cabins_layout and dist.get("keep_out") is not None:
        cabins_layout["keep_out"] = dist.get("keep_out")
    if "keepouts" not in cabins_layout and dist.get("keepouts") is not None:
        cabins_layout["keepouts"] = dist.get("keepouts")
    shell_material = dist["envelope"].get("shell_material", {})
    model = build_placement_tree(
        outer_size=outer_size,
        shell_thickness=shell_thickness,
        cabins_layout=cabins_layout,
        shell_material=shell_material,
    )
    placed, unplaced = multistart_pack_v2(model, parts, multistart=multistart, seed=seed)
    model.parts = placed

    sample_config["cabins_layout"] = cabins_layout
    return _finalize_sample_output(sample_config, output_dir, model, parts, unplaced, outer_size, shell_thickness)


# ============================================================
# 主入口
# ============================================================

def process_single_sample_v2(
    sample_config: Dict,
    output_dir: Path,
    dist: Dict,
) -> Dict:
    """处理单个 v2 样本的完整流程

    Args:
        sample_config: sample 配置 (含 sample_id, seed, packing, envelope 抽样结果)
        output_dir: 样本输出目录
        dist: v2 分布 (含 cabins_layout + components.kinds 等)
    Returns:
        stats dict
    """
    sample_id = sample_config["sample_id"]
    seed = sample_config["seed"]
    print("\n" + "=" * 60)
    print(f"[v2] 处理样本: {sample_id} (seed={seed})")
    print("=" * 60)

    rng = np.random.default_rng(seed)

    print("  [1/6] 生成 BOM...")
    clearance = float(_sample_value(rng, sample_config["packing"]["clearance"]))
    parts = synth_parts_v2(dist, seed, clearance)
    return process_prebuilt_sample_v2(sample_config, output_dir, dist, parts)


def generate_sample_config_v2(dist: Dict, sample_id: str, seed: int) -> Dict:
    """从 v2 分布生成单个样本的最上层元信息 (envelope 抽样 + packing)"""
    rng = np.random.default_rng(seed)
    env = dist["envelope"]
    sample = {
        "schema_version": SCHEMA_VERSION,
        "units": dist.get("units", {"length": "mm", "mass": "kg", "power": "W"}),
        "sample_id": sample_id,
        "seed": seed,
        "envelope": {
            "fill_ratio": _sample_value(rng, env["fill_ratio"]),
            "shell_thickness": _sample_value(rng, env["shell_thickness"]),
            "auto_envelope": env.get("auto_envelope", True),
            "shell_material": env.get("shell_material", {}),
        },
        "cabins_layout": dict(dist.get("cabins_layout", {"type": "auto"})),
        "packing": {
            "clearance": _sample_value(rng, dist["packing"]["clearance"]),
            "multistart": int(dist["packing"].get("multistart", 3)),
        },
        "components": {},
    }
    return sample
