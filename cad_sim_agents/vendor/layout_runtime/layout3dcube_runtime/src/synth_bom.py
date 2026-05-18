"""BOM合成模块 - 随机生成矩形设备"""
import random
from typing import List, Dict
from src.schema import Part


# 类别颜色映射 (RGBA)
CATEGORY_COLORS = {
    "payload": (100, 150, 255, 255),    # 蓝色
    "avionics": (255, 200, 100, 255),   # 橙色
    "power": (100, 255, 150, 255),      # 绿色
    "thermal": (255, 100, 150, 255),    # 粉色
    "structure": (150, 150, 150, 255),  # 灰色
    "default": (200, 200, 200, 255),    # 默认灰色
}


def synth_bom(cfg: Dict, clearance_mm: float = 0.0) -> List[Part]:
    """
    合成随机BOM
    
    参数:
        cfg: 配置字典，包含：
            - n_parts: 设备数量
            - dims_min_mm: 最小尺寸 [x, y, z]
            - dims_max_mm: 最大尺寸 [x, y, z]
            - mass_range_kg: 质量范围 [min, max]
            - power_range_W: 功率范围 [min, max]
            - categories: 类别列表
            - seed: 随机种子
        clearance_mm: 间隙（mm），默认0.0
    
    返回:
        Part 列表
    """
    n_parts = cfg["n_parts"]
    dims_min = cfg["dims_min_mm"]
    dims_max = cfg["dims_max_mm"]
    mass_range = cfg["mass_range_kg"]
    power_range = cfg["power_range_W"]
    categories = cfg["categories"]
    seed = cfg.get("seed", 42)
    
    # 设置随机种子
    random.seed(seed)
    
    parts = []
    for i in range(n_parts):
        # 随机生成尺寸
        x = random.uniform(dims_min[0], dims_max[0])
        y = random.uniform(dims_min[1], dims_max[1])
        z = random.uniform(dims_min[2], dims_max[2])
        
        # 随机生成质量和功率
        mass = random.uniform(mass_range[0], mass_range[1])
        power = random.uniform(power_range[0], power_range[1])
        
        # 随机选择类别
        category = random.choice(categories)
        
        # 获取类别颜色
        color = CATEGORY_COLORS.get(category, CATEGORY_COLORS["default"])
        
        # 创建Part对象
        part = Part(
            id=f"P{i:03d}",
            dims=(x, y, z),
            mass=mass,
            power=power,
            category=category,
            color=color,
            clearance_mm=clearance_mm,
            position=None,
            bin_index=-1,
            mount_face=None,
            mount_point=None
        )
        parts.append(part)
    
    print(f"生成 {n_parts} 个设备件")
    print(f"  类别分布: {dict((cat, sum(1 for p in parts if p.category == cat)) for cat in categories)}")
    
    return parts
