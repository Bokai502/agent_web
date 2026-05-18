"""
Selection更新模块
负责创建/更新COMSOL Selections（单机AABB框选 + 壳体6面选择）
"""

from typing import Dict, List


class SelectionUpdater:
    """COMSOL Selection管理器"""
    
    def __init__(self, model):
        """初始化Selection更新器
        
        Args:
            model: COMSOL模型对象（mph model）
        """
        self.model = model
        self.comp = model.java.component("comp1")
    
    def create_component_box_selections(self, components_data: List[Dict]) -> Dict:
        """创建单机Box Selections (P001, P002, ...)
        
        Args:
            components_data: [{name, pos_mm, dims_mm, power_W, category}, ...]
        
        Returns:
            {created: int, failed: int, tags: List[str], failed_tags: List[str]}
        """
        print("  创建单机Box Selections...")
        
        created_count = 0
        failed_tags = []
        success_tags = []
        
        for comp in components_data:
            tag = comp['name']  # 如 P017, P014
            label = f"{comp['name']}"
            
            pos = comp['pos_mm']
            dims = comp['dims_mm']
            
            # 计算边界
            xmin = pos[0]
            xmax = pos[0] + dims[0]
            ymin = pos[1]
            ymax = pos[1] + dims[1]
            zmin = pos[2]
            zmax = pos[2] + dims[2]
            
            try:
                self._upsert_box_selection(
                    tag=tag,
                    label=label,
                    xmin=f"{xmin}[mm]",
                    xmax=f"{xmax}[mm]",
                    ymin=f"{ymin}[mm]",
                    ymax=f"{ymax}[mm]",
                    zmin=f"{zmin}[mm]",
                    zmax=f"{zmax}[mm]",
                    entitydim=3  # 域选择
                )
                created_count += 1
                success_tags.append(tag)
                print(f"    ✓ {tag}: {comp['category']}")
            except Exception as e:
                failed_tags.append(tag)
                print(f"    ✗ {tag} 失败: {e}")
        
        result = {
            'created': created_count,
            'failed': len(failed_tags),
            'tags': success_tags,
            'failed_tags': failed_tags
        }
        
        print(f"    共创建 {created_count}/{len(components_data)} 个单机Selection")
        return result
    
    def create_shell_face_selections(self, shell_box: Dict, eps_mm: float = 1.0) -> Dict:
        """创建壳体6面Selections (sel_shell_xmin/xmax/ymin/ymax/zmin/zmax)
        
        使用Box Selection + 薄盒阈值，entitydim=2（边界选择）
        复用单机框选的实现机制，确保API一致性
        
        Args:
            shell_box: {outer_size_mm, inner_size_mm, thickness_mm}
                      注意：当前假设壳体中心在原点，若数据有bbox_min/bbox_max应优先使用
            eps_mm: 阈值厚度（mm），默认1.0，调试期可设2~5mm避免选中为空
        
        Returns:
            {created: int, failed: int, tags: List[str], failed_tags: List[str]}
        """
        print("  创建壳体6面Selections...")
        print(f"    使用薄盒阈值: eps_mm={eps_mm}")
        
        outer_size = shell_box['outer_size_mm']
        
        # 计算壳体中心在原点的边界（假设中心在原点）
        # 风险：若实际几何中心不在原点，此假设可能不准确
        # TODO: 优先从geom.json解析bbox_min/bbox_max（如果数据结构支持）
        half_x = outer_size[0] / 2
        half_y = outer_size[1] / 2
        half_z = outer_size[2] / 2
        
        print(f"    壳体尺寸: {outer_size} mm")
        print(f"    壳体半尺寸: [{half_x:.1f}, {half_y:.1f}, {half_z:.1f}] mm")
        
        # 定义6个面的薄盒bbox
        # 每个面：对应维度是薄层[±half-eps, ±half+eps]，其他两个维度缩小范围避免选到边/顶点
        # 例如x+面：x在[half_x-eps, half_x+eps]，y和z缩小为[-half_y+eps, half_y-eps]
        faces = [
            ('sel_shell_xmin', 'Shell Face X-', -half_x, 'x'),
            ('sel_shell_xmax', 'Shell Face X+', half_x, 'x'),
            ('sel_shell_ymin', 'Shell Face Y-', -half_y, 'y'),
            ('sel_shell_ymax', 'Shell Face Y+', half_y, 'y'),
            ('sel_shell_zmin', 'Shell Face Z-', -half_z, 'z'),
            ('sel_shell_zmax', 'Shell Face Z+', half_z, 'z'),
        ]
        
        created_count = 0
        failed_tags = []
        success_tags = []
        
        for tag, label, face_pos, axis in faces:
            try:
                # 计算薄盒bbox：
                # 对应轴：薄层 [face_pos-eps, face_pos+eps]
                # 其他两轴：缩小范围 [-half+eps, half-eps]，避免选到边/顶点
                if axis == 'x':
                    xmin = face_pos - eps_mm
                    xmax = face_pos + eps_mm
                    ymin = -half_y + eps_mm  # 缩小，避免选到y+/-面
                    ymax = half_y - eps_mm
                    zmin = -half_z + eps_mm  # 缩小，避免选到z+/-面
                    zmax = half_z - eps_mm
                elif axis == 'y':
                    xmin = -half_x + eps_mm  # 缩小，避免选到x+/-面
                    xmax = half_x - eps_mm
                    ymin = face_pos - eps_mm
                    ymax = face_pos + eps_mm
                    zmin = -half_z + eps_mm  # 缩小，避免选到z+/-面
                    zmax = half_z - eps_mm
                else:  # axis == 'z'
                    xmin = -half_x + eps_mm  # 缩小，避免选到x+/-面
                    xmax = half_x - eps_mm
                    ymin = -half_y + eps_mm  # 缩小，避免选到y+/-面
                    ymax = half_y - eps_mm
                    zmin = face_pos - eps_mm
                    zmax = face_pos + eps_mm
                
                # 复用Box Selection实现，entitydim=2（边界选择）
                self._upsert_box_selection(
                    tag=tag,
                    label=label,
                    xmin=f"{xmin}[mm]",
                    xmax=f"{xmax}[mm]",
                    ymin=f"{ymin}[mm]",
                    ymax=f"{ymax}[mm]",
                    zmin=f"{zmin}[mm]",
                    zmax=f"{zmax}[mm]",
                    entitydim=2  # 边界选择
                )
                
                created_count += 1
                success_tags.append(tag)
                print(f"    ✓ {tag}: {axis}方向薄层[{face_pos-eps_mm:.1f}, {face_pos+eps_mm:.1f}]mm")
            except Exception as e:
                failed_tags.append(tag)
                error_msg = f"{tag} 创建失败: {type(e).__name__}: {str(e)}"
                print(f"    ✗ {error_msg}")
        
        result = {
            'created': created_count,
            'failed': len(failed_tags),
            'tags': success_tags,
            'failed_tags': failed_tags
        }
        
        print(f"    共创建 {created_count}/6 个壳体面Selection")
        if failed_tags:
            print(f"    警告: {len(failed_tags)} 个Selection创建失败: {failed_tags}")
        
        return result
    
    def create_all_components_selection(self, shell_box: Dict, margin_mm: float = 2.0) -> Dict:
        """创建ALL选择（选取所有单机，排除外壳）
        
        参考example_geometry_update.py中的实现
        
        Args:
            shell_box: {outer_size_mm, inner_size_mm, thickness_mm}
            margin_mm: 边界缩小量（mm），默认2.0，确保不会选到外壳
        
        Returns:
            {created: bool, tag: str, failed: bool}
        """
        print("  创建ALL选择（选取所有单机，排除外壳）...")
        
        # 使用inner_size_mm，稍微缩小边界确保不会选到外壳
        if 'inner_size_mm' not in shell_box:
            print("    ⚠️  警告: shell_box缺少inner_size_mm，跳过ALL选择创建")
            return {'created': False, 'tag': 'ALL', 'failed': True}
        
        inner_size = shell_box['inner_size_mm']
        
        # 计算缩小后的边界（假设原点在中心）
        half_x = (inner_size[0] - margin_mm) / 2
        half_y = (inner_size[1] - margin_mm) / 2
        half_z = (inner_size[2] - margin_mm) / 2
        
        try:
            self._upsert_box_selection(
                tag="ALL",
                label="ALL",
                xmin=f"{-half_x}[mm]",
                xmax=f"{half_x}[mm]",
                ymin=f"{-half_y}[mm]",
                ymax=f"{half_y}[mm]",
                zmin=f"{-half_z}[mm]",
                zmax=f"{half_z}[mm]",
                entitydim=3  # 域选择
            )
            
            print(f"    ✓ ALL: 全部单机选择 (内部尺寸: {inner_size[0]:.1f}×{inner_size[1]:.1f}×{inner_size[2]:.1f} mm, 裕量: {margin_mm}mm)")
            return {'created': True, 'tag': 'ALL', 'failed': False}
            
        except Exception as e:
            error_msg = f"ALL 创建失败: {type(e).__name__}: {str(e)}"
            print(f"    ✗ {error_msg}")
            return {'created': False, 'tag': 'ALL', 'failed': True, 'error': error_msg}
    
    def _upsert_box_selection(self, tag: str, label: str, 
                             xmin: str, xmax: str, 
                             ymin: str, ymax: str, 
                             zmin: str, zmax: str, 
                             entitydim: int = 3,
                             condition: str = "allvertices"):
        """内部方法：创建/更新Box Selection
        
        Args:
            tag: Selection标签
            label: 显示名称
            xmin, xmax, ymin, ymax, zmin, zmax: 边界（带单位字符串）
            entitydim: 实体维度（3=域, 2=边界）
            condition: Box Selection 条件，默认 allvertices，避免薄盒误选相邻边界
        """
        # 检查是否已存在
        if tag not in list(self.comp.selection().tags()):
            self.comp.selection().create(tag, "Box")
        
        sel = self.comp.selection(tag)
        sel.label(label)
        sel.set("entitydim", str(entitydim))
        sel.set("condition", condition)
        sel.set("xmin", xmin)
        sel.set("xmax", xmax)
        sel.set("ymin", ymin)
        sel.set("ymax", ymax)
        sel.set("zmin", zmin)
        sel.set("zmax", zmax)
    
