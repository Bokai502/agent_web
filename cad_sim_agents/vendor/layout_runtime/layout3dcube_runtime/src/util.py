"""工具函数模块"""
from pathlib import Path
import yaml


def get_next_version_dir(base_dir: str, config_name: str) -> str:
    """
    获取下一个版本号的单次运行输出目录

    参数:
        base_dir: 单次运行输出根目录（如 "out"）
        config_name: 配置文件名（如 "demo"）

    返回:
        版本化目录路径（如 "out/demo_v001"）
    """
    base_path = Path(base_dir)
    base_path.mkdir(parents=True, exist_ok=True)
    
    # 查找已存在的版本号
    existing = list(base_path.glob(f"{config_name}_v*"))
    
    if not existing:
        version = 1
    else:
        # 提取版本号
        versions = []
        for p in existing:
            try:
                v_str = p.name.split('_v')[-1]
                versions.append(int(v_str))
            except (ValueError, IndexError):
                pass
        version = max(versions) + 1 if versions else 1
    
    version_dir = base_path / f"{config_name}_v{version:03d}"
    version_dir.mkdir(parents=True, exist_ok=True)
    
    return str(version_dir)


def load_config(config_path: str) -> dict:
    """加载YAML配置"""
    with open(config_path, 'r', encoding='utf-8') as f:
        cfg = yaml.safe_load(f)
    return cfg
