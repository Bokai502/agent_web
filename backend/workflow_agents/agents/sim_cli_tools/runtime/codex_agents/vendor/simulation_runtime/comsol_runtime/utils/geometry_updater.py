"""
几何更新模块
负责在COMSOL计算前更新模型的几何导入路径
"""

import os
from pathlib import Path
from typing import Dict, Any, List, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from pipeline.config import Config

from utils.file_utils import load_yaml


class GeometryUpdater:
    """几何路径更新器"""
    
    def __init__(self, config: 'Config'):
        self.config = config
        self.model = None  # COMSOL模型对象，由外部传入
    
    def set_model(self, model):
        """设置COMSOL模型对象"""
        self.model = model
    
    
    def update_geometry_import(self, 
                               geometry_file: str,
                               component: str = "comp1",
                               geometry: str = "geom1", 
                               import_feature: str = "imp1",
                               ):
        """更新几何导入节点的文件路径
        
        Args:
            geometry_file: 新的几何文件路径（支持 .step, .iges, .stl 等）
            component: 组件标签，默认 "comp1"
            geometry: 几何标签，默认 "geom1"
            import_feature: 导入节点标签，默认 "imp1"
            save_as: 更新后另存为的文件路径（可选），如果不指定则不保存
        
        Returns:
            bool: 是否成功
        """
        if self.model is None:
            raise ValueError("模型未设置，请先调用 set_model()")
        print(f"\n更新几何导入节点 '{import_feature}'...")
        print(f"  新文件路径: {geometry_file}")
        
        try:
            # 1. 检查文件是否存在
            if not Path(geometry_file).exists():
                print(f"  警告: 几何文件不存在: {geometry_file}")
                return False
            
            # 2. 转换路径格式（COMSOL需要绝对路径，且用正斜杠）
            abs_path = os.path.abspath(geometry_file).replace("\\", "/")
            print(f"  绝对路径: {abs_path}")
            
            # 3. 获取几何节点
            geom = self.model.java.component(component).geom(geometry)

            # 4. 获取导入特征节点
            imp = geom.feature(import_feature)
            
            # 5. 更新文件名
            imp.set("filename", abs_path)
            imp.importData()
            geom.run()    
            print("✓ 几何更新成功")
            return True
            
        except Exception as e:
            print(f"✗ 几何更新失败: {e}")
            return False
    
    def update_geometry_for_sample(self, sample_config: Dict[str, Any]) -> bool:
        """为单个样本更新几何
        
        Args:
            sample_config: 样本配置
        
        Returns:
            bool: 是否成功
        """
        if self.model is None:
            raise ValueError("模型未设置，请先调用 set_model()")
        
        sample_id = sample_config['sample_info']['sample_id']
        print(f"\n{'='*60}")
        print(f"更新样本 {sample_id:04d} 的几何")
        print(f"{'='*60}")
        
        # 检查配置中是否有几何配置
        if 'geometry_config' not in sample_config:
            print("  未配置几何更新，跳过")
            return True
        
        geom_config = sample_config['geometry_config']
        
        # 检查是否需要更新几何
        if not geom_config.get('update_geometry', False):
            print("  不需要更新几何")
            return True
        
        # 获取几何文件路径
        geometry_file = geom_config.get('geometry_file', None)
        if geometry_file is None:
            print("  警告: 未指定几何文件路径")
            return False
        
        # 获取几何节点配置
        component = geom_config.get('component', 'comp1')
        geometry = geom_config.get('geometry', 'geom1')
        import_feature = geom_config.get('import_feature', 'imp1')
        
        # 更新几何
        success = self.update_geometry_import(
            geometry_file=geometry_file,
            component=component,
            geometry=geometry,
            import_feature=import_feature
        )
        
        return success
    
    def update_batch_geometries(self, 
                                sample_dirs: List[Path],
                                start_from: int = 1, 
                                end_at: Optional[int] = None) -> Dict[str, Any]:
        """批量更新样本几何
        
        Args:
            sample_dirs: 样本目录列表
            start_from: 起始样本编号
            end_at: 结束样本编号
        
        Returns:
            dict: 更新结果统计
        """
        if self.model is None:
            raise ValueError("模型未设置，请先调用 set_model()")
        
        print(f"\n{'='*60}")
        print("开始批量更新几何")
        print(f"{'='*60}")
        
        if end_at is None:
            end_at = len(sample_dirs)
        
        # 过滤需要处理的样本
        samples_to_process = sample_dirs[start_from-1:end_at]
        
        success_count = 0
        skip_count = 0
        failed_samples = []
        
        for i, sample_dir in enumerate(samples_to_process, start_from):
            # 加载样本配置
            config_file = sample_dir / "config.yaml"
            if not config_file.exists():
                print(f"样本 {i:04d} 配置文件不存在，跳过")
                skip_count += 1
                continue
            
            sample_config = load_yaml(config_file)
            
            # 检查是否需要更新几何
            if 'geometry_config' not in sample_config:
                skip_count += 1
                continue
            
            if not sample_config['geometry_config'].get('update_geometry', False):
                skip_count += 1
                continue
            
            # 更新几何
            if self.update_geometry_for_sample(sample_config):
                success_count += 1
            else:
                failed_samples.append(i)
        
        # 统计结果
        total_updated = success_count + len(failed_samples)
        result_summary = {
            'total_samples': len(samples_to_process),
            'total_updated': total_updated,
            'successful': success_count,
            'failed': len(failed_samples),
            'skipped': skip_count,
            'failed_sample_ids': failed_samples,
            'success_rate': success_count / total_updated if total_updated > 0 else 1.0
        }
        
        print(f"\n{'='*60}")
        print("批量几何更新完成")
        print(f"总计: {len(samples_to_process)}, 需更新: {total_updated}, 成功: {success_count}, 失败: {len(failed_samples)}, 跳过: {skip_count}")
        if total_updated > 0:
            print(f"成功率: {result_summary['success_rate']:.1%}")
        if failed_samples:
            print(f"失败样本: {failed_samples}")
        print(f"{'='*60}")
        
        return result_summary
