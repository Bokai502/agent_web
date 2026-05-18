"""
文件操作工具函数
"""

import shutil
import yaml
import json
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple


def ensure_dir(path: Path):
    """确保目录存在"""
    path.mkdir(parents=True, exist_ok=True)


def clean_dir(path: Path):
    """清空目录"""
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True, exist_ok=True)


def save_yaml(data: Dict[Any, Any], file_path: Path):
    """保存数据为YAML文件"""
    with open(file_path, 'w', encoding='utf-8') as f:
        yaml.dump(data, f, allow_unicode=True, default_flow_style=False)


def load_yaml(file_path: Path) -> Dict[Any, Any]:
    """加载YAML文件"""
    with open(file_path, 'r', encoding='utf-8') as f:
        return yaml.safe_load(f)


def get_file_size_mb(file_path: Path) -> float:
    """获取文件大小（MB）"""
    if file_path.exists():
        return file_path.stat().st_size / 1024 / 1024
    return 0.0


def find_files_by_pattern(directory: Path, pattern: str) -> List[Path]:
    """根据模式查找文件"""
    return list(directory.glob(pattern))


def copy_file(src: Path, dst: Path):
    """复制文件"""
    ensure_dir(dst.parent)
    shutil.copy2(src, dst)


def move_file(src: Path, dst: Path):
    """移动文件"""
    ensure_dir(dst.parent)
    shutil.move(src, dst)


def copy_mph_template(src_mph: Path, dst_mph: Path) -> bool:
    """只读复制模板mph到工作目录
    
    Args:
        src_mph: 源模板mph文件路径
        dst_mph: 目标工作mph文件路径
    
    Returns:
        bool: 是否成功
    """
    try:
        ensure_dir(dst_mph.parent)
        shutil.copy2(src_mph, dst_mph)
        return True
    except Exception as e:
        print(f"mph复制失败: {e}")
        return False


def _convert_java_objects(obj):
    """递归转换Java对象为Python原生类型（用于JSON序列化）
    
    Args:
        obj: 任意对象（可能是Java对象、dict、list等）
    
    Returns:
        转换后的Python对象
    """
    # 检查是否是Java对象（通常有getClass方法）
    if hasattr(obj, 'getClass'):
        # Java对象，转换为字符串
        return str(obj)
    
    # 字典类型
    if isinstance(obj, dict):
        return {k: _convert_java_objects(v) for k, v in obj.items()}
    
    # 列表类型
    if isinstance(obj, (list, tuple)):
        return [_convert_java_objects(item) for item in obj]
    
    # 其他Python原生类型（str, int, float, bool, None等）直接返回
    return obj


def atomic_write_json(data: Dict, file_path: Path):
    """原子写入JSON（先写临时文件，再重命名）
    
    避免写入过程中断导致文件损坏
    自动转换Java对象为Python字符串（用于COMSOL mph库）
    
    Args:
        data: 要写入的字典数据（可能包含Java对象）
        file_path: 目标JSON文件路径
    """
    ensure_dir(file_path.parent)
    temp_path = file_path.with_suffix('.tmp')
    try:
        # 清理Java对象，转换为Python原生类型
        cleaned_data = _convert_java_objects(data)
        
        with open(temp_path, 'w', encoding='utf-8') as f:
            json.dump(cleaned_data, f, indent=2, ensure_ascii=False)
        temp_path.replace(file_path)
    except Exception as e:
        if temp_path.exists():
            temp_path.unlink()
        raise e


def detect_schema_version(sample_yaml_path: Path) -> str:
    """从 sample.yaml 读顶层 schema_version, 缺省为 '1.0'

    v1 的 sample.yaml 无 schema_version 字段 → 回退 '1.0'
    v2 的 sample.yaml 明确带 schema_version: '2.0'
    """
    if not sample_yaml_path.exists():
        return "1.0"
    data = load_yaml(sample_yaml_path)
    return str(data.get("schema_version", "1.0"))


def load_layout_meta_v2(sample_yaml_path: Path) -> Dict[str, Any]:
    """v2 sample.yaml 统一入口: 返回 shell_box / components / install_faces / cabins / walls

    components 采用 v1 约定字段 (name, pos_mm, dims_mm, power_W, category),
    便于沿用 v1 的 heat_source / box-selection 创建代码.
    额外字段 (kind / mount_face_id) 附上用于 v2 逻辑.
    """
    data = load_yaml(sample_yaml_path)
    schema_version = str(data.get("schema_version", "1.0"))

    outer_shell = data["outer_shell"]
    outer_bbox = outer_shell["outer_bbox"]
    inner_bbox = outer_shell["inner_bbox"]
    outer_size = [float(outer_bbox["max"][i]) - float(outer_bbox["min"][i]) for i in range(3)]
    inner_size = [float(inner_bbox["max"][i]) - float(inner_bbox["min"][i]) for i in range(3)]
    shell_box = {
        "outer_size_mm": outer_size,
        "inner_size_mm": inner_size,
        "thickness_mm": float(outer_shell["thickness"]),
        "outer_bbox": outer_bbox,
        "inner_bbox": inner_bbox,
    }

    components: List[Dict[str, Any]] = []
    for cid, cdata in (data.get("components") or {}).items():
        bbox = cdata.get("bbox")
        if isinstance(bbox, dict) and isinstance(bbox.get("min"), list) and isinstance(bbox.get("max"), list):
            pos_mm = [float(v) for v in bbox["min"]]
            dims_mm = [float(bbox["max"][i]) - float(bbox["min"][i]) for i in range(3)]
        else:
            pos_mm = [float(v) for v in cdata["position"]]
            dims_mm = [float(v) for v in cdata["dims"]]
        components.append({
            "name": cid,
            "pos_mm": pos_mm,
            "dims_mm": dims_mm,
            "bbox": {
                "min": pos_mm,
                "max": [pos_mm[i] + dims_mm[i] for i in range(3)],
            },
            "power_W": float(cdata.get("power", 0)),
            "category": cdata.get("category", ""),
            "kind": cdata.get("kind", "internal"),
            "mount_face_id": cdata.get("mount_face_id"),
            "thermal_surface": cdata.get("thermal_surface", {}),
            "thermal_interface": cdata.get("thermal_interface", {}),
        })

    return {
        "schema_version": schema_version,
        "shell_box": shell_box,
        "components": components,
        "install_faces": data.get("install_faces", {}) or {},
        "cabin_walls": data.get("cabin_walls", []) or [],
        "cabins": data.get("cabins", []) or [],
        "outer_shell": outer_shell,
        "placement_tree": data.get("placement_tree", []) or [],
        "units": data.get("units", {}),
    }


def load_layout_meta(geom_json_path: Path, sample_yaml_path: Optional[Path] = None) -> Tuple[Dict, List[Dict]]:
    """统一入口：加载几何JSON，兼容新旧schema

    Args:
        geom_json_path: geom.json路径
        sample_yaml_path: sample.yaml路径（可选，用于覆盖功率）

    Returns:
        shell_box: {outer_size_mm, inner_size_mm, thickness_mm, ...}
        components: [{name, pos_mm, dims_mm, power_W, category}, ...]
    """
    with open(geom_json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    # 提取envelope（兼容新旧字段）
    env = data['_envelope']
    shell_box = {
        'outer_size_mm': env.get('outer_size', env.get('outer_size_mm')),
        'inner_size_mm': env.get('inner_size', env.get('inner_size_mm')),
        'thickness_mm': env.get('thickness', env.get('thickness_mm')),
    }
    
    # 提取components（兼容pos/pos_mm, dims/dims_mm）
    components = []
    for key, val in data.items():
        if key.startswith('_'):
            continue
        comp = {
            'name': key,
            'pos_mm': val.get('pos', val.get('pos_mm')),
            'dims_mm': val.get('dims', val.get('dims_mm')),
            'power_W': val.get('power', val.get('power_W', 0)),
            'category': val.get('category', ''),
        }
        components.append(comp)
    
    # 如果有sample.yaml，覆盖功率
    if sample_yaml_path and sample_yaml_path.exists():
        yaml_data = load_yaml(sample_yaml_path)
        for comp in components:
            yaml_comp = yaml_data.get('components', {}).get(comp['name'])
            if yaml_comp and 'power' in yaml_comp:
                comp['power_W'] = yaml_comp['power']
    
    return shell_box, components
