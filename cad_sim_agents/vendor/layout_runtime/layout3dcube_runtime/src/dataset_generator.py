"""数据集坐标生成器

用于从 layout.meta.json 文件生成三维坐标网格、mask张量和物理属性张量
"""
import json
import numpy as np
from pathlib import Path
from typing import Tuple, Dict, Any, Mapping


class DatasetGenerator:
    """数据集生成器类
    
    从 layout.meta.json 文件读取布局信息，生成用于机器学习的训练数据：
    - 三维坐标网格
    - mask张量（标记设备占用区域）
    - 功率张量（设备功率分布）
    - 质量张量（设备质量分布）
    """
    
    def __init__(
        self, 
        json_path: str, 
        grid_shape: Tuple[int, int, int], 
        shrink_mm: float = None,
        shell_density_kg_per_m3: float = 2700.0  # 默认铝合金密度
    ):
        """初始化数据集生成器
        
        Args:
            json_path: layout.meta.json 文件路径
            grid_shape: 三维网格形状，如 (128, 128, 128)
            shrink_mm: 外壳缩小量（mm），默认None表示自动使用thickness_mm/2（采样到外壳中间）
            shell_density_kg_per_m3: 外壳材料密度（kg/m³），默认2700（铝合金）
        """
        self.json_path = json_path
        self.grid_shape = grid_shape
        self.shell_density = shell_density_kg_per_m3
        
        # 加载JSON数据
        self.meta_data = self._load_json(json_path)
        
        # 提取外壳信息（兼容新旧格式）
        envelope_data = self.meta_data['_envelope']
        # 优先使用无后缀字段名，回退到旧格式
        self.outer_size_mm = np.array(
            envelope_data.get('outer_size', envelope_data.get('outer_size_mm', [])), 
            dtype=float
        )
        self.inner_size_mm = np.array(
            envelope_data.get('inner_size', envelope_data.get('inner_size_mm', [])), 
            dtype=float
        )
        self.thickness_mm = envelope_data.get('thickness', envelope_data.get('thickness_mm', 0))
        
        # 设置缩小量：默认为外壳厚度的一半（采样点落在外壳中间）
        if shrink_mm is None:
            self.shrink_mm = self.thickness_mm / 2.0
        else:
            self.shrink_mm = shrink_mm
        
        # 计算有效空间尺寸（缩小后）
        self.effective_size_mm = self.outer_size_mm - 2 * self.shrink_mm
        
        # 存储生成的数据
        self.coordinates = None
        self.mask_tensor = None
        self.power_tensor = None
        self.mass_tensor = None
        
        print("数据集生成器初始化完成")
        print(f"  外壳尺寸: {self.outer_size_mm}")
        print(f"  内部尺寸: {self.inner_size_mm}")
        print(f"  外壳厚度: {self.thickness_mm} mm")
        print(f"  边界缩小: {self.shrink_mm} mm (采样到外壳中间)")
        print(f"  有效空间: {self.effective_size_mm}")
        print(f"  外壳密度: {self.shell_density} kg/m³")
        print(f"  网格形状: {self.grid_shape}")
        print(f"  设备数量: {len(self.meta_data) - 1}")  # 减去 _envelope
    
    def _load_json(self, json_path: str) -> Dict[str, Any]:
        """加载JSON文件
        
        Args:
            json_path: JSON文件路径
            
        Returns:
            解析后的JSON数据
        """
        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        if '_envelope' not in data:
            raise ValueError("JSON文件缺少 '_envelope' 字段")
        
        return data
    
    def generate_coordinates(self) -> np.ndarray:
        """生成三维坐标网格
        
        使用meshgrid生成均匀分布的三维坐标点。
        坐标原点为卫星中心，遍历顺序：x变化最快，然后y，最后z。
        
        Returns:
            形状为 (nx, ny, nz, 3) 的坐标tensor，最后一维是 [x, y, z]
        """
        # 生成每个维度的坐标范围（以卫星中心为原点）
        x_range = np.linspace(
            -self.effective_size_mm[0] / 2,
            self.effective_size_mm[0] / 2,
            self.grid_shape[0]
        )
        y_range = np.linspace(
            -self.effective_size_mm[1] / 2,
            self.effective_size_mm[1] / 2,
            self.grid_shape[1]
        )
        z_range = np.linspace(
            -self.effective_size_mm[2] / 2,
            self.effective_size_mm[2] / 2,
            self.grid_shape[2]
        )
        
        # 计算网格间隔
        grid_spacing = self.effective_size_mm / (np.array(self.grid_shape) - 1)
        
        # 检查网格间隔是否大于外壳厚度
        print("\n网格间隔分析:")
        print(f"  X方向间隔: {grid_spacing[0]:.3f} mm")
        print(f"  Y方向间隔: {grid_spacing[1]:.3f} mm")
        print(f"  Z方向间隔: {grid_spacing[2]:.3f} mm")
        print(f"  外壳厚度: {self.thickness_mm:.3f} mm")
        
        min_spacing = np.min(grid_spacing)
        if min_spacing < self.thickness_mm:
            print(f"  ⚠️  警告: 最小间隔 ({min_spacing:.3f} mm) < 外壳厚度 ({self.thickness_mm:.3f} mm)")
            print("       可能有多层采样点落在外壳内！")
            print("       建议: 减小网格分辨率或增大外壳厚度")
        elif min_spacing < 2 * self.thickness_mm:
            print(f"  ⚠️  注意: 最小间隔 ({min_spacing:.3f} mm) < 2×外壳厚度 ({2*self.thickness_mm:.3f} mm)")
            print("       可能有相邻采样点跨越外壳边界")
        else:
            print(f"  ✅ 网格间隔充足 ({min_spacing:.3f} mm > 2×{self.thickness_mm:.3f} mm)")
        
        # 使用meshgrid生成三维网格（indexing='ij'保证顺序）
        X, Y, Z = np.meshgrid(x_range, y_range, z_range, indexing='ij')
        
        # 组合为 (nx, ny, nz, 3) 的4D tensor
        coordinates = np.stack([X, Y, Z], axis=-1)
        
        self.coordinates = coordinates
        print(f"\n坐标生成完成: {coordinates.shape}")
        
        return coordinates
    
    def save_coordinates(self, output_path: str, unit: str = 'mm', decimal_places: int = 3):
        """保存坐标到txt文件
        
        Args:
            output_path: 输出文件路径
            unit: 坐标单位，'mm' 或 'm'，默认 'mm'
            decimal_places: 保留的小数位数，默认 3 位
        """
        if self.coordinates is None:
            raise ValueError("请先调用 generate_coordinates() 生成坐标")
        
        # 验证单位参数
        if unit not in ['mm', 'm']:
            raise ValueError(f"不支持的单位: {unit}，请使用 'mm' 或 'm'")
        
        # 确保输出目录存在
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        # 展平为 (N, 3)，保持 x变化最快的顺序
        coords_flat = self.coordinates.reshape(-1, 3)
        
        # 计算单位转换系数
        scale_factor = 0.001 if unit == 'm' else 1.0
        
        # 生成格式化字符串
        format_str = f"{{0:.{decimal_places}f}} {{1:.{decimal_places}f}} {{2:.{decimal_places}f}}\n"
        
        # 保存坐标
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(f"% x y z (unit: {unit})\n")
            for coord in coords_flat:
                # 应用单位转换
                scaled_coord = coord * scale_factor
                f.write(format_str.format(scaled_coord[0], scaled_coord[1], scaled_coord[2]))
        
        print(f"坐标已保存: {output_path} (单位: {unit}, 小数位数: {decimal_places})")
    
    def _create_aabb_mask(self, box_min_corner: np.ndarray, box_dims: np.ndarray) -> np.ndarray:
        """使用AABB快速生成设备区域的布尔mask
        
        Args:
            box_min_corner: 设备最小角点坐标 [x, y, z]
            box_dims: 设备尺寸 [dx, dy, dz]
            
        Returns:
            形状为 (nx, ny, nz) 的布尔数组，True表示在box内
        """
        box_max = box_min_corner + box_dims
        
        # 向量化判断：每个维度分别判断
        in_x = (self.coordinates[..., 0] >= box_min_corner[0]) & \
               (self.coordinates[..., 0] <= box_max[0])
        in_y = (self.coordinates[..., 1] >= box_min_corner[1]) & \
               (self.coordinates[..., 1] <= box_max[1])
        in_z = (self.coordinates[..., 2] >= box_min_corner[2]) & \
               (self.coordinates[..., 2] <= box_max[2])
        
        return in_x & in_y & in_z
    
    def _create_shell_mask(self) -> np.ndarray:
        """生成外壳区域的布尔mask
        
        Returns:
            形状为 (nx, ny, nz) 的布尔数组，True表示在外壳内
        """
        outer_half = self.outer_size_mm / 2
        inner_half = self.inner_size_mm / 2
        
        # 在外表面内
        in_outer_x = np.abs(self.coordinates[..., 0]) <= outer_half[0]
        in_outer_y = np.abs(self.coordinates[..., 1]) <= outer_half[1]
        in_outer_z = np.abs(self.coordinates[..., 2]) <= outer_half[2]
        in_outer = in_outer_x & in_outer_y & in_outer_z
        
        # 在内表面外（任意维度超出）
        out_inner_x = np.abs(self.coordinates[..., 0]) > inner_half[0]
        out_inner_y = np.abs(self.coordinates[..., 1]) > inner_half[1]
        out_inner_z = np.abs(self.coordinates[..., 2]) > inner_half[2]
        out_inner = out_inner_x | out_inner_y | out_inner_z
        
        return in_outer & out_inner

    def _device_aabb_mask(self, device_data: Mapping[str, Any]) -> np.ndarray:
        """从设备记录生成 AABB mask，兼容新旧字段名。"""
        device_min = np.array(
            device_data.get('pos', device_data.get('pos_mm', [])),
            dtype=float
        )
        device_dims = np.array(
            device_data.get('dims', device_data.get('dims_mm', [])),
            dtype=float
        )
        return self._create_aabb_mask(device_min, device_dims)

    def _device_tensor_value(
        self,
        device_data: Mapping[str, Any],
        *,
        device_value_key: str | None,
        fill_value: float,
    ) -> float:
        """提取设备区域张量填充值，兼容新旧字段名。"""
        if device_value_key is None:
            return fill_value
        if device_value_key == 'power_W':
            return device_data.get('power', device_data.get('power_W', 0))
        if device_value_key == 'mass_kg':
            return device_data.get('mass', device_data.get('mass_kg', 0))
        return device_data.get(device_value_key, 0)
    
    def _generate_tensor_base(
        self, 
        tensor_name: str, 
        device_value_key: str = None, 
        default_value: float = 0.0,
        fill_value: float = 1.0
    ) -> np.ndarray:
        """基础张量生成方法（内部使用）- 向量化版本
        
        通用的张量生成逻辑，根据参数决定填充什么值。
        使用AABB向量化判断，大幅提升性能。
        
        Args:
            tensor_name: 张量名称（用于显示）
            device_value_key: 设备数据中的值键名（如'power_W', 'mass_kg'），
                             如果为None则使用fill_value
            default_value: 空白区域的默认值
            fill_value: 当device_value_key为None时，设备区域填充的值
            
        Returns:
            生成的张量
        """
        # 如果坐标未生成，先生成坐标
        if self.coordinates is None:
            self.generate_coordinates()
        
        # 初始化张量
        tensor = np.full(self.grid_shape, default_value, dtype=np.float32)
        
        # 获取所有设备（排除以_开头的元数据字段）
        devices = {k: v for k, v in self.meta_data.items() if not k.startswith('_')}
        
        print(f"开始生成{tensor_name}张量，处理外壳 + {len(devices)} 个设备...")
        
        # 1. 生成外壳mask
        shell_mask = self._create_shell_mask()
        
        # 2. 逐个设备处理（向量化）
        device_mask = np.zeros(self.grid_shape, dtype=bool)
        
        for device_id, device_data in devices.items():
            # 生成该设备的mask（向量化）
            current_device_mask = self._device_aabb_mask(device_data)
            
            # 检查重叠
            overlap = device_mask & current_device_mask
            write_mask = current_device_mask
            if np.any(overlap):
                overlap_count = int(np.sum(overlap))
                print(
                    f"  警告: 设备重叠检测: {device_id} 与其他设备有 {overlap_count} 个体素重叠，"
                    "重叠体素保留先放置设备的值"
                )
                write_mask = current_device_mask & ~device_mask
            
            # 填充值（向量化）
            value = self._device_tensor_value(
                device_data,
                device_value_key=device_value_key,
                fill_value=fill_value,
            )
            
            tensor[write_mask] = value
            device_mask |= current_device_mask
        
        # 3. 填充外壳（排除设备区域）
        shell_only = shell_mask & ~device_mask
        
        if device_value_key == 'power_W':
            # 外壳功率为0
            tensor[shell_only] = 0.0
        elif device_value_key == 'mass_kg':
            # 外壳质量 = 体素体积 × 密度
            voxel_size = self.effective_size_mm / (np.array(self.grid_shape) - 1)
            voxel_volume_m3 = np.prod(voxel_size) / 1e9  # mm³ 转 m³
            tensor[shell_only] = voxel_volume_m3 * self.shell_density
        elif device_value_key is None:
            # Mask：外壳区域也标记为1
            tensor[shell_only] = fill_value
        
        # 统计信息
        total_voxels = np.prod(self.grid_shape)
        shell_count = np.sum(shell_only)
        device_count = np.sum(device_mask)
        
        print(f"  外壳体素: {shell_count} ({shell_count/total_voxels*100:.2f}%)")
        print(f"  设备体素: {device_count} ({device_count/total_voxels*100:.2f}%)")
        print(f"  空白体素: {total_voxels - shell_count - device_count} ({(total_voxels - shell_count - device_count)/total_voxels*100:.2f}%)")
        
        if device_value_key is None:
            # Mask张量统计
            occupied_voxels = shell_count + device_count
            print(f"{tensor_name}生成完成: 总占用 {occupied_voxels}/{total_voxels} ({occupied_voxels/total_voxels*100:.2f}%)")
        else:
            # 属性张量统计
            total_value = np.sum(tensor)
            print(f"{tensor_name}张量生成完成: 总{tensor_name} {total_value:.2f}")
        
        return tensor
    
    def generate_mask_tensor(self) -> np.ndarray:
        """生成mask张量
        
        标记设备占用区域为1，空白区域为0。
        
        Returns:
            形状为 grid_shape 的mask张量
        """
        self.mask_tensor = self._generate_tensor_base(
            tensor_name="Mask",
            device_value_key=None,
            default_value=0.0,
            fill_value=1.0
        )
        return self.mask_tensor
    
    def generate_power_tensor(self, default_value: float = 0.0) -> np.ndarray:
        """生成功率张量
        
        在设备占用区域填充该设备的功率值，空白区域填充默认值。
        
        Args:
            default_value: 空白区域的默认值
            
        Returns:
            形状为 grid_shape 的功率张量
        """
        self.power_tensor = self._generate_tensor_base(
            tensor_name="功率",
            device_value_key="power_W",
            default_value=default_value
        )
        return self.power_tensor
    
    def generate_mass_tensor(self, default_value: float = 0.0) -> np.ndarray:
        """生成质量张量
        
        在设备占用区域填充该设备的质量值，空白区域填充默认值。
        
        Args:
            default_value: 空白区域的默认值
            
        Returns:
            形状为 grid_shape 的质量张量
        """
        self.mass_tensor = self._generate_tensor_base(
            tensor_name="质量",
            device_value_key="mass_kg",
            default_value=default_value
        )
        return self.mass_tensor
    
    def _map_sparse_data(self, coords_array: np.ndarray, values_array: np.ndarray) -> np.ndarray:
        """逐点映射稀疏数据到网格（使用最近邻查找）
        
        Args:
            coords_array: 坐标数组 (M, 3)
            values_array: 数值数组 (M,)
            
        Returns:
            形状为 grid_shape 的3D张量，未映射区域为NaN
        """
        tensor = np.full(self.grid_shape, np.nan, dtype=np.float32)
        
        # 展平坐标tensor用于距离计算
        coords_flat = self.coordinates.reshape(-1, 3)
        
        mapped_count = 0
        for coord, value in zip(coords_array, values_array):
            # 向量化计算到所有体素中心的距离
            distances = np.linalg.norm(coords_flat - coord, axis=1)
            closest_idx = np.argmin(distances)
            
            # 转换为3D索引
            idx = np.unravel_index(closest_idx, self.grid_shape)
            tensor[idx] = value
            mapped_count += 1
        
        print(f"  成功映射 {mapped_count} 个数据点到网格")
        return tensor
    
    def load_data_from_txt(
        self, 
        txt_path: str, 
        value_column: int = 3,
        unit: str = 'm',
        delimiter: str = ',',
        validate_with_mask: bool = True
    ) -> np.ndarray:
        """从txt文件读取数据并转换为3D张量（向量化版本）
        
        读取包含坐标和数值的txt文件（如COMSOL导出的温度场数据），
        将数据映射到3D网格中，空白区域填充NaN。
        
        优化：如果数据是完整网格且坐标顺序一致，直接reshape（极快）；
             否则回退到最近邻映射。
        
        Args:
            txt_path: 输入txt文件路径
            value_column: 数值所在的列索引（0-based），默认3（即第4列）
            unit: 坐标单位，'mm' 或 'm'，默认 'm'
            delimiter: 分隔符，默认 ','
            validate_with_mask: 是否与mask进行校验，默认True
            
        Returns:
            形状为 grid_shape 的3D张量，空白区域为NaN
        
        Note:
            自动跳过以 % 或 # 开头的注释行和空行
        """
        if self.coordinates is None:
            self.generate_coordinates()
        
        print(f"开始从文件读取数据: {txt_path}")
        
        # 读取文件并解析数据
        coordinates_data = []
        values_data = []
        
        with open(txt_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                # 跳过注释行和空行
                if not line or line.startswith('%') or line.startswith('#'):
                    continue
                
                try:
                    parts = line.split(delimiter)
                    if len(parts) <= value_column:
                        continue
                    
                    # 提取坐标（x, y, z）
                    x, y, z = float(parts[0]), float(parts[1]), float(parts[2])
                    # 提取数值
                    value = float(parts[value_column])
                    
                    coordinates_data.append([x, y, z])
                    values_data.append(value)
                except (ValueError, IndexError):
                    continue
        
        if len(coordinates_data) == 0:
            raise ValueError(f"文件中没有找到有效数据: {txt_path}")
        
        print(f"  读取了 {len(coordinates_data)} 个数据点")
        
        # 转换为numpy数组
        coords_array = np.array(coordinates_data, dtype=float)
        values_array = np.array(values_data, dtype=float)
        
        # 单位转换（如果需要）
        if unit == 'm':
            coords_array *= 1000.0  # 转换为mm
        elif unit != 'mm':
            raise ValueError(f"不支持的单位: {unit}，请使用 'mm' 或 'm'")
        
        # 检查数据点数量
        expected_count = np.prod(self.grid_shape)
        
        if len(coords_array) == expected_count:
            # 尝试向量化：检查坐标顺序
            coords_flat = self.coordinates.reshape(-1, 3)
            
            # 检查坐标是否匹配（允许小误差）
            if np.allclose(coords_array, coords_flat, atol=1e-3):
                print("  ✅ 检测到坐标顺序一致，使用向量化处理（直接reshape）")
                tensor = values_array.reshape(self.grid_shape).astype(np.float32)
            else:
                print("  ⚠️  坐标顺序不一致，使用最近邻映射")
                tensor = self._map_sparse_data(coords_array, values_array)
        else:
            print(f"  ℹ️  数据稀疏 ({len(coords_array)}/{expected_count})，使用最近邻映射")
            tensor = self._map_sparse_data(coords_array, values_array)
        
        # 与mask校验
        if validate_with_mask:
            if self.mask_tensor is None:
                print("  警告: mask张量未生成，跳过校验")
            else:
                print("  开始与mask张量校验...")
                
                # 检查NaN位置与mask=0位置的一致性
                nan_mask = np.isnan(tensor)
                zero_mask = (self.mask_tensor == 0)
                
                # 统计
                nan_count = np.sum(nan_mask)
                zero_count = np.sum(zero_mask)
                consistent = np.sum(nan_mask == zero_mask)
                total = np.prod(self.grid_shape)
                
                print(f"  NaN体素数: {nan_count}")
                print(f"  Mask=0体素数: {zero_count}")
                print(f"  一致体素数: {consistent}/{total} ({consistent/total*100:.2f}%)")
                
                # 详细分析不一致的情况
                nan_but_not_zero = np.sum(nan_mask & ~zero_mask)
                zero_but_not_nan = np.sum(zero_mask & ~nan_mask)
                
                if nan_but_not_zero > 0:
                    print(f"  警告: {nan_but_not_zero} 个体素为NaN但mask不为0（可能是数据缺失）")
                if zero_but_not_nan > 0:
                    print(f"  警告: {zero_but_not_nan} 个体素mask为0但不是NaN（可能是额外数据）")
                
                if consistent == total:
                    print("  ✅ 校验通过：NaN位置与mask完全一致")
                elif consistent / total > 0.95:
                    print("  ⚠️  校验基本通过：一致性 > 95%")
                else:
                    print("  ❌ 校验失败：一致性过低")
        
        return tensor
    
    def save_tensor(self, tensor: np.ndarray, output_path: str):
        """保存张量到文件
        
        Args:
            tensor: 要保存的numpy数组
            output_path: 输出文件路径（.npy格式）
        """
        # 确保输出目录存在
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        # 保存为.npy文件
        np.save(output_path, tensor)
        
        print(f"张量已保存: {output_path} (形状: {tensor.shape})")
    
    def validate(self):
        """验证生成的数据
        
        检查：
        1. 坐标是否在有效范围内
        2. mask张量的占用比例
        3. 功率/质量张量的总和是否与JSON记录一致
        """
        print("\n" + "=" * 60)
        print("数据验证")
        print("=" * 60)
        
        # 1. 验证坐标范围
        if self.coordinates is not None:
            # 坐标是 (nx, ny, nz, 3)，需要展平后再找最小最大值
            coords_flat = self.coordinates.reshape(-1, 3)
            coord_min = np.min(coords_flat, axis=0)
            coord_max = np.max(coords_flat, axis=0)
            expected_min = -self.effective_size_mm / 2
            expected_max = self.effective_size_mm / 2
            
            print("\n坐标范围检查:")
            print(f"  实际范围: [{coord_min[0]:.2f}, {coord_max[0]:.2f}] x "
                  f"[{coord_min[1]:.2f}, {coord_max[1]:.2f}] x "
                  f"[{coord_min[2]:.2f}, {coord_max[2]:.2f}]")
            print(f"  期望范围: [{expected_min[0]:.2f}, {expected_max[0]:.2f}] x "
                  f"[{expected_min[1]:.2f}, {expected_max[1]:.2f}] x "
                  f"[{expected_min[2]:.2f}, {expected_max[2]:.2f}]")
            
            coord_valid = np.allclose(coord_min, expected_min, atol=0.1) and \
                         np.allclose(coord_max, expected_max, atol=0.1)
            print(f"  状态: {'✓ 通过' if coord_valid else '✗ 失败'}")
        
        # 2. 验证mask张量占用比例
        if self.mask_tensor is not None:
            occupied = np.sum(self.mask_tensor)
            total = np.prod(self.grid_shape)
            ratio = occupied / total
            
            print("\nMask张量检查:")
            print(f"  占用体素: {int(occupied)}/{total}")
            print(f"  占用比例: {ratio*100:.2f}%")
        
        # 3. 验证功率总和
        devices = {k: v for k, v in self.meta_data.items() if k != '_envelope'}
        total_power_json = sum(d['power_W'] for d in devices.values())
        
        if self.power_tensor is not None:
            # 注意：由于离散化，张量中的总功率可能与JSON不完全一致
            # 这里我们计算的是所有非零体素的功率（可能重复计数）
            unique_power = np.unique(self.power_tensor[self.power_tensor > 0])
            tensor_power_sum = np.sum(unique_power)
            
            print("\n功率张量检查:")
            print(f"  JSON总功率: {total_power_json:.2f} W")
            print(f"  张量唯一值总和: {tensor_power_sum:.2f} W")
            print(f"  唯一功率值数量: {len(unique_power)}")
        
        # 4. 验证质量总和
        total_mass_json = sum(d['mass_kg'] for d in devices.values())
        
        if self.mass_tensor is not None:
            unique_mass = np.unique(self.mass_tensor[self.mass_tensor > 0])
            tensor_mass_sum = np.sum(unique_mass)
            
            print("\n质量张量检查:")
            print(f"  JSON总质量: {total_mass_json:.2f} kg")
            print(f"  张量唯一值总和: {tensor_mass_sum:.2f} kg")
            print(f"  唯一质量值数量: {len(unique_mass)}")
        
        print("\n" + "=" * 60)
