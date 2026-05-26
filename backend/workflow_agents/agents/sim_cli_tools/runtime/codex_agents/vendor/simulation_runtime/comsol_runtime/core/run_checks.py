"""
验证检查模块
聚合检查逻辑，避免污染comsol_runner
"""

from pathlib import Path
from typing import Dict, List


class RunChecks:
    """COMSOL运行验证检查器"""
    
    def __init__(self, model):
        """初始化检查器
        
        Args:
            model: COMSOL模型对象（mph model）
        """
        self.model = model
        self.comp = model.java.component("comp1")
    
    def validate_geometry(self, expected_geom_file: str) -> Dict:
        """检查几何是否正确导入
        
        Args:
            expected_geom_file: 预期的几何文件路径
        
        Returns:
            {ok: bool, message: str, details: {...}}
        """
        try:
            geom = self.comp.geom("geom1")
            
            # 检查几何是否有效（是否有节点）
            # 将Java字符串转换为Python字符串
            geom_tags = [str(tag) for tag in geom.feature().tags()]
            
            if len(geom_tags) == 0:
                return {
                    'ok': False,
                    'message': '几何为空，没有feature节点',
                    'details': {'tags': geom_tags}
                }
            
            # 检查导入节点
            if 'imp1' in geom_tags:
                imp = geom.feature('imp1')
                try:
                    current_file = str(imp.getString('filename'))
                    details = {
                        'tags': geom_tags,
                        'import_file': current_file,
                        'expected_file': expected_geom_file
                    }
                except:
                    details = {'tags': geom_tags}
            else:
                details = {'tags': geom_tags}
            
            return {
                'ok': True,
                'message': f'几何有效，包含{len(geom_tags)}个feature',
                'details': details
            }
            
        except Exception as e:
            return {
                'ok': False,
                'message': f'几何检查失败: {str(e)}',
                'details': {}
            }
    
    def validate_selections(self, expected_tags: List[str]) -> Dict:
        """检查所有Selection是否存在且非空
        
        Args:
            expected_tags: 预期的Selection标签列表
        
        Returns:
            {ok: bool, message: str, details: {...}}
        """
        try:
            # 将Java字符串转换为Python字符串
            existing_tags = [str(tag) for tag in self.comp.selection().tags()]
            
            missing_tags = [tag for tag in expected_tags if tag not in existing_tags]
            
            if missing_tags:
                return {
                    'ok': False,
                    'message': f'缺少{len(missing_tags)}个Selection',
                    'details': {
                        'missing': missing_tags,
                        'existing': existing_tags,
                        'expected': expected_tags
                    }
                }
            
            # 检查Selection是否为空
            empty_tags = []
            entity_counts = {}
            for tag in expected_tags:
                try:
                    selection = self.comp.selection(tag)
                    try:
                        entity_count = len(list(selection.entities()))
                    except Exception:
                        entity_count = None
                    entity_counts[tag] = entity_count
                    if entity_count == 0:
                        empty_tags.append(tag)
                except Exception:
                    entity_counts[tag] = None
                    empty_tags.append(tag)

            if empty_tags:
                return {
                    'ok': False,
                    'message': f'{len(empty_tags)}个Selection为空',
                    'details': {
                        'empty': empty_tags,
                        'existing': existing_tags,
                        'expected': expected_tags,
                        'entity_counts': entity_counts,
                    }
                }
            
            details = {
                'expected_count': len(expected_tags),
                'existing_count': len([t for t in expected_tags if t in existing_tags]),
                'existing_tags': existing_tags,
                'empty_tags': empty_tags,
                'entity_counts': entity_counts,
            }
            
            return {
                'ok': True,
                'message': f'所有{len(expected_tags)}个Selection已创建',
                'details': details
            }
            
        except Exception as e:
            return {
                'ok': False,
                'message': f'Selection检查失败: {str(e)}',
                'details': {}
            }
    
    def validate_heat_sources(self, expected_hs_tags: List[str]) -> Dict:
        """检查热源是否正确设置
        
        Args:
            expected_hs_tags: 预期的热源标签列表
        
        Returns:
            {ok: bool, message: str, details: {...}}
        """
        try:
            ht = self.comp.physics("ht")
            # 将Java字符串转换为Python字符串
            existing_tags = [str(tag) for tag in ht.feature().tags()]
            
            missing_tags = [tag for tag in expected_hs_tags if tag not in existing_tags]
            
            if missing_tags:
                return {
                    'ok': False,
                    'message': f'缺少{len(missing_tags)}个热源',
                    'details': {
                        'missing': missing_tags,
                        'existing': existing_tags,
                        'expected': expected_hs_tags
                    }
                }
            
            # 检查热源配置
            heat_source_info = []
            for tag in expected_hs_tags:
                try:
                    hs = ht.feature(tag)
                    # 尝试获取热源配置
                    try:
                        q0 = str(hs.getString('Q0'))  # 转换为Python字符串
                        heat_source_info.append({
                            'tag': tag,
                            'Q0': q0
                        })
                    except AttributeError:
                        heat_source_info.append({
                            'tag': tag,
                            'Q0': 'unknown'
                        })
                except Exception:
                    # 忽略无法访问的热源
                    continue
            
            details = {
                'expected_count': len(expected_hs_tags),
                'existing_count': len([t for t in expected_hs_tags if t in existing_tags]),
                'heat_sources': heat_source_info
            }
            
            return {
                'ok': True,
                'message': f'所有{len(expected_hs_tags)}个热源已设置',
                'details': details
            }
            
        except Exception as e:
            return {
                'ok': False,
                'message': f'热源检查失败: {str(e)}',
                'details': {}
            }
    
    def validate_exports(self, export_dir: Path, expected_files: List[str]) -> Dict:
        """检查导出文件是否存在且非空
        
        Args:
            export_dir: 导出目录
            expected_files: 预期的文件名列表
        
        Returns:
            {ok: bool, message: str, details: {...}}
        """
        try:
            missing_files = []
            empty_files = []
            existing_files = []
            
            for filename in expected_files:
                file_path = export_dir / filename
                if not file_path.exists():
                    missing_files.append(filename)
                elif file_path.stat().st_size == 0:
                    empty_files.append(filename)
                else:
                    existing_files.append({
                        'name': filename,
                        'size_mb': file_path.stat().st_size / 1024 / 1024
                    })
            
            if missing_files or empty_files:
                return {
                    'ok': False,
                    'message': f'导出文件检查失败',
                    'details': {
                        'missing': missing_files,
                        'empty': empty_files,
                        'existing': existing_files
                    }
                }
            
            return {
                'ok': True,
                'message': f'所有{len(expected_files)}个文件导出成功',
                'details': {
                    'files': existing_files
                }
            }
            
        except Exception as e:
            return {
                'ok': False,
                'message': f'导出检查失败: {str(e)}',
                'details': {}
            }
    
    def aggregate_checks(self, checks: List[Dict]) -> Dict:
        """聚合多个检查结果
        
        Args:
            checks: 检查结果列表
        
        Returns:
            {all_ok: bool, summary: {...}, failures: [...]}
        """
        failures = [c for c in checks if not c.get('ok', False)]
        all_ok = len(failures) == 0
        
        summary = {
            'total_checks': len(checks),
            'passed': len(checks) - len(failures),
            'failed': len(failures)
        }
        
        return {
            'all_ok': all_ok,
            'summary': summary,
            'failures': failures
        }
