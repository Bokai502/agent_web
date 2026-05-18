"""样本处理器 - 封装单样本的布局、导出、数据生成逻辑"""

from pathlib import Path
from typing import Dict, List
import numpy as np
import yaml
import random

from src.schema import Part, Envelope, AABB
from src.synth_bom import synth_bom
from src.keepout_split import build_bins, create_keepout_aabbs
from src.pack_py3dbp import multistart_pack
from src.dataset_generator import DatasetGenerator

# 尝试导入可选依赖
try:
    from src.export_cad import export_cad
    HAS_CADQUERY = True
except ImportError:
    HAS_CADQUERY = False
    print("警告：cadquery未安装，将跳过STEP文件导出")

try:
    from src.viz3d import viz_packing_preview
    HAS_VIZ = True
except Exception as exc:
    HAS_VIZ = False
    print(f"警告：可视化模块不可用，将跳过预览图生成: {exc}")


def create_geom_json_fallback(envelope: Envelope, placed: List[Part], output_path: Path):
    """当cadquery不可用时，手动创建geom.json
    
    参数:
        envelope: 包络
        placed: 已放置的设备列表
        output_path: 输出路径
    """
    import json
    
    outer_size = envelope.outer_size()
    inner_size = envelope.inner_size()
    
    metadata = {
        "_units": {
            "length": "mm",
            "mass": "kg",
            "power": "W"
        },
        "_envelope": {
            "outer_size": outer_size.tolist(),
            "inner_size": inner_size.tolist(),
            "thickness": envelope.thickness_mm,
            "fill_ratio": envelope.fill_ratio,
            "size_ratio": list(envelope.size_ratio),
            "is_sheet": envelope.thickness_mm == 0
        }
    }
    
    for part in placed:
        actual_pos = part.get_actual_position()
        dims = part.get_actual_dims()
        
        part_meta = {
            "shape": getattr(part, 'shape', 'box'),
            "pos": [float(actual_pos[0]), float(actual_pos[1]), float(actual_pos[2])],
            "dims": [float(dims[0]), float(dims[1]), float(dims[2])],
            "category": part.category,
            "mass": float(part.mass),
            "power": float(part.power),
            "bin_index": int(part.bin_index),
            "mount_face": int(part.mount_face) if part.mount_face is not None else None,
            "mount_point": part.mount_point.tolist() if part.mount_point is not None else None,
            "install_pos": part.position.tolist() if part.position is not None else None
        }
        
        if hasattr(part, 'thermal'):
            part_meta['thermal'] = part.thermal
        if hasattr(part, 'thermoelastic'):
            part_meta['thermoelastic'] = part.thermoelastic
        
        metadata[part.id] = part_meta
    
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(metadata, f, indent=2, ensure_ascii=False)


def synth_bom_from_sample(sample_config: Dict, dist: Dict) -> List[Part]:
    """从样本配置生成BOM
    
    参数:
        sample_config: 样本配置
        dist: 分布定义
    
    返回:
        Part列表
    """
    # 设置随机种子
    seed = sample_config['seed']
    random.seed(seed)
    np.random.seed(seed)
    
    # 从分布中抽样设备数量
    n_parts = int(np.random.randint(
        dist['components']['count'][0],
        dist['components']['count'][1] + 1
    ))
    
    clearance = sample_config['packing']['clearance']
    
    # 构造synth_bom需要的cfg（使用旧格式字段名）
    cfg = {
        'n_parts': n_parts,
        'dims_min_mm': [
            dist['components']['dims']['x'][0],
            dist['components']['dims']['y'][0],
            dist['components']['dims']['z'][0]
        ],
        'dims_max_mm': [
            dist['components']['dims']['x'][1],
            dist['components']['dims']['y'][1],
            dist['components']['dims']['z'][1]
        ],
        'mass_range_kg': dist['components']['mass'],
        'power_range_W': dist['components']['power'],
        'categories': dist['components']['categories'],
        'seed': seed
    }
    
    # 使用现有的synth_bom函数
    parts = synth_bom(cfg, clearance_mm=clearance)
    
    # 添加预留字段（thermal, thermoelastic等）
    for part in parts:
        # 预留字段：默认值
        part.thermal = {
            'surface': {
                'emissivity': 0.8,
                'absorptivity': 0.3
            },
            'interfaces': {
                'contact_resistance': 0.001,
                'contact_conductance': 1000
            }
        }
        part.thermoelastic = {
            'cte': 23e-6,
            'elastic_modulus': 70,
            'poisson_ratio': 0.33
        }
        part.shape = 'box'  # 本轮只生成box
    
    return parts


def build_envelope_from_sample(sample_config: Dict, parts: List[Part]) -> Envelope:
    """从样本配置构建envelope
    
    参数:
        sample_config: 样本配置
        parts: 设备件列表
    
    返回:
        Envelope对象
    """
    env_cfg = sample_config['envelope']
    
    if env_cfg['auto_envelope']:
        # 自动计算外壳尺寸（基于设备体积和占空比）
        total_volume = sum(np.prod(p.dims) for p in parts)
        fill_ratio = env_cfg['fill_ratio']
        target_volume = total_volume / fill_ratio
        
        # 根据size_ratio计算尺寸
        size_ratio = np.array(env_cfg['size_ratio'], dtype=float)
        # V = k * r[0] * r[1] * r[2]，求k
        k = target_volume / np.prod(size_ratio)
        scale = k ** (1./3.)
        
        inner_size = size_ratio * scale
        thickness = env_cfg['shell_thickness']
        outer_size = inner_size + 2 * thickness
    else:
        # 手动指定尺寸（未来扩展）
        outer_size = np.array(env_cfg['outer_size'], dtype=float)
        thickness = env_cfg['shell_thickness']
        inner_size = outer_size - 2 * thickness
    
    # 中心在原点
    outer_min = -outer_size / 2
    outer_max = outer_size / 2
    inner_min = -inner_size / 2
    inner_max = inner_size / 2
    
    envelope = Envelope(
        outer=AABB(min=outer_min, max=outer_max),
        inner=AABB(min=inner_min, max=inner_max),
        thickness_mm=thickness,
        fill_ratio=fill_ratio,
        size_ratio=tuple(env_cfg['size_ratio'])
    )
    
    return envelope


def update_sample_yaml_with_placement(sample_config: Dict, placed: List[Part], envelope: Envelope, yaml_path: Path):
    """更新sample.yaml，添加placement信息
    
    参数:
        sample_config: 样本配置
        placed: 已放置的设备列表
        envelope: 包络
        yaml_path: sample.yaml路径
    """
    # 更新envelope信息
    sample_config['envelope']['outer_size'] = envelope.outer_size().tolist()
    sample_config['envelope']['inner_size'] = envelope.inner_size().tolist()
    
    # 添加components信息
    components = {}
    for part in placed:
        component_data = {
            'shape': getattr(part, 'shape', 'box'),
            'dims': [float(part.dims[0]), float(part.dims[1]), float(part.dims[2])],
            'mass': float(part.mass),
            'power': float(part.power),
            'category': part.category,
            'color': list(part.color),
        }
        
        # 添加thermal和thermoelastic（如果有）
        if hasattr(part, 'thermal'):
            component_data['thermal'] = part.thermal
        if hasattr(part, 'thermoelastic'):
            component_data['thermoelastic'] = part.thermoelastic
        
        # 添加placement信息
        if part.position is not None:
            actual_pos = part.get_actual_position()
            component_data['placement'] = {
                'position': [float(actual_pos[0]), float(actual_pos[1]), float(actual_pos[2])],
                'bin_index': int(part.bin_index),
                'mount_face': int(part.mount_face) if part.mount_face is not None else None,
                'mount_point': part.mount_point.tolist() if part.mount_point is not None else None
            }
        
        components[part.id] = component_data
    
    sample_config['components'] = components
    
    # 保存更新后的sample.yaml
    with open(yaml_path, 'w', encoding='utf-8') as f:
        yaml.dump(sample_config, f, default_flow_style=False, sort_keys=False, allow_unicode=True)


def process_single_sample(
    sample_config: Dict,
    output_dir: Path,
    dist: Dict
) -> Dict:
    """处理单个样本的完整流程
    
    参数:
        sample_config: 样本配置（来自步骤B）
        output_dir: 样本输出目录
        dist: 分布定义（用于获取组件参数范围）
    
    返回:
        处理结果统计
    """
    sample_id = sample_config['sample_id']
    print("\n" + "=" * 60)
    print(f"处理样本: {sample_id}")
    print("=" * 60)
    
    # 创建子目录
    geom_dir = output_dir / 'geom'
    inputs_dir = output_dir / 'inputs'
    qc_dir = output_dir / 'qc'
    geom_dir.mkdir(exist_ok=True)
    inputs_dir.mkdir(exist_ok=True)
    qc_dir.mkdir(exist_ok=True)
    
    # 1. BOM生成
    print("  [1/5] 生成BOM...")
    parts = synth_bom_from_sample(sample_config, dist)
    print(f"    生成 {len(parts)} 个设备")
    
    # 2. 舱体和装箱
    print("  [2/5] 构建舱体和装箱...")
    envelope = build_envelope_from_sample(sample_config, parts)
    print(f"    外壳尺寸: {envelope.outer_size()}")
    print(f"    内部尺寸: {envelope.inner_size()}")
    
    keepouts = create_keepout_aabbs(dist)  # 从dist读取禁区
    bins = build_bins(envelope.inner, keepouts)
    print(f"    子容器数: {len(bins)}")
    
    clearance = sample_config['packing']['clearance']
    multistart = sample_config['packing']['multistart']
    print(f"    装箱参数: clearance={clearance}mm, multistart={multistart}")
    
    placed, unplaced = multistart_pack(parts, bins, clearance, multistart)
    print(f"    放置结果: {len(placed)}/{len(parts)} ({len(placed)/len(parts)*100:.1f}%)")
    
    # 3. 导出几何
    print("  [3/5] 导出几何...")
    step_path = geom_dir / 'geometry.step'
    geom_json_path = geom_dir / 'geom.json'
    
    if HAS_CADQUERY:
        export_cad(envelope, placed, str(step_path), str(geom_json_path))
        print(f"    STEP: {step_path.name}")
        print(f"    JSON: {geom_json_path.name}")
    else:
        # 如果没有cadquery，手动生成geom.json
        print("    ⚠️  跳过STEP导出（缺少cadquery）")
        print("    手动生成geom.json...")
        create_geom_json_fallback(envelope, placed, geom_json_path)
        print(f"    JSON: {geom_json_path.name}")
    
    # 4. 生成数据
    print("  [4/5] 生成体素数据...")
    generator = DatasetGenerator(
        str(geom_json_path),
        grid_shape=(32, 32, 32)
    )
    generator.generate_coordinates()
    mask = generator.generate_mask_tensor()
    power = generator.generate_power_tensor()
    mass = generator.generate_mass_tensor()
    
    # 保存数据
    coord_path = inputs_dir / 'coord.txt'
    channels_path = inputs_dir / 'channels_input.npz'
    
    generator.save_coordinates(str(coord_path), unit='m')
    np.savez_compressed(
        channels_path,
        mask=mask,
        power=power,
        mass=mass
    )
    print(f"    坐标: {coord_path.name}")
    print(f"    通道: {channels_path.name}")
    
    # 5. QC可视化和统计
    print("  [5/5] 生成QC...")
    preview_path = qc_dir / 'preview.png'
    
    if HAS_VIZ:
        try:
            viz_packing_preview(envelope, bins, keepouts, placed, unplaced, str(preview_path))
            print(f"    预览图: {preview_path.name}")
        except Exception as e:
            print(f"    ⚠️  预览图生成失败: {e}")
    else:
        print("    ⚠️  跳过预览图生成（缺少可视化库）")
    
    # 统计信息
    stats = {
        'n_parts': len(parts),
        'n_placed': len(placed),
        'n_unplaced': len(unplaced),
        'placement_rate': len(placed) / len(parts) if parts else 0,
        'total_mass': float(sum(p.mass for p in placed)),
        'total_power': float(sum(p.power for p in placed)),
        'envelope_outer_size': envelope.outer_size().tolist(),
        'envelope_inner_size': envelope.inner_size().tolist(),
        'fill_ratio': float(envelope.fill_ratio)
    }
    
    stats_path = qc_dir / 'stats.txt'
    with open(stats_path, 'w', encoding='utf-8') as f:
        f.write(f"样本ID: {sample_id}\n")
        f.write(f"随机种子: {sample_config['seed']}\n")
        f.write(f"\n设备统计:\n")
        f.write(f"  设备总数: {stats['n_parts']}\n")
        f.write(f"  已放置: {stats['n_placed']}\n")
        f.write(f"  未放置: {stats['n_unplaced']}\n")
        f.write(f"  放置率: {stats['placement_rate']*100:.2f}%\n")
        f.write(f"\n物理参数:\n")
        f.write(f"  总质量: {stats['total_mass']:.2f} kg\n")
        f.write(f"  总功率: {stats['total_power']:.2f} W\n")
        f.write(f"\n舱体尺寸:\n")
        f.write(f"  外壳: {stats['envelope_outer_size']}\n")
        f.write(f"  内部: {stats['envelope_inner_size']}\n")
        f.write(f"  占空比: {stats['fill_ratio']:.3f}\n")
    
    # 更新sample.yaml（添加布局结果）
    update_sample_yaml_with_placement(sample_config, placed, envelope, output_dir / 'sample.yaml')
    
    print(f"\n  ✅ 样本 {sample_id} 处理完成!")
    print(f"  放置率: {stats['placement_rate']*100:.1f}%, 总质量: {stats['total_mass']:.1f}kg, 总功率: {stats['total_power']:.1f}W")
    
    return stats
