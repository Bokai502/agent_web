"""
配置管理模块
统一管理所有配置参数
"""

import yaml
from pathlib import Path
from typing import Dict, List, Optional
from dataclasses import dataclass, asdict


@dataclass
class ParameterDefinition:
    """参数定义"""
    name: str
    unit: str
    type: str  # 'discrete' or 'continuous'
    values: List[float]


@dataclass
class ComsolConnectionConfig:
    """COMSOL执行配置。当前 reconstructed pipeline 使用 local entry。"""
    mode: str = "local"
    # --- archived remote_hpc fields; kept only for config compatibility ---
    ssh_host_alias: str = "HPC"
    remote_project_root: str = "~/cad2comsol_comsol_runtime"
    remote_workdir: str = "~/cad2comsol_comsol_runtime/workdir"
    remote_python: str = "python"
    remote_runner_script: str = "simulation_runtime/comsol_runtime/remote/comsol_remote_entry.py"
    remote_model_file_path: Optional[str] = None
    host: str = "127.0.0.1"
    port: int = 6091
    require_tunnel: bool = False
    # --- local 专用 ---
    # COMSOL 安装根 (含 bin/comsol)
    local_comsol_home: str = "/usr/local/comsol64/multiphysics"
    # 驱动 entry.py 的 python 解释器 (需已装 mph + jpype)
    local_python: str = "/data/conda/envs/autoflowsim-comsol/bin/python"
    # 可选: 覆盖 entry.py 路径; 留空则用包内 remote/comsol_remote_entry.py
    local_entry_script: Optional[str] = None
    # 本地 mph 版本号 (mph.start(version=...))
    local_mph_version: str = "6.4"
    # 本地 COMSOL 子进程最大运行时间; <=0 表示不限制
    local_timeout_seconds: int = 0


@dataclass
class ComsolConfig:
    """COMSOL配置"""
    model_file_path: str
    export_volum_tags: List[str]
    export_face_tags: List[str]
    field_expressions: Dict[str, str]
    connection: ComsolConnectionConfig


@dataclass
class GeometryConfig:
    """几何更新配置"""
    enable_geometry_update: bool = False
    component: str = "comp1"
    geometry: str = "geom1"
    import_feature: str = "imp1"
    geometry_file_dir: Optional[str] = None
    geometry_file_pattern: str = "geometry_{sample_id:04d}.step"
    fixed_geometry_file: Optional[str] = None


@dataclass
class ProcessingConfig:
    """数据处理配置"""
    grid_size: int = 128
    interpolation_method: str = 'linear'
    num_time_steps: int = 101


@dataclass
class VisualizationConfig:
    """可视化配置"""
    gif_fps: int = 10
    variable_base_name: str = '温度'


@dataclass
class DatasetConfig:
    """数据集构建配置"""
    include_parameters: bool = True
    include_face_data: bool = True
    include_vtu_data: bool = True
    save_hdf5: bool = True
    save_matlab: bool = False
    base_filename: Optional[str] = None
    add_timestamp: bool = False
    custom_suffix: str = ""


class Config:
    """统一配置管理器"""

    def __init__(self, config_file: Optional[Path] = None):
        self.config_file = config_file
        self._load_default_config()

        if config_file and config_file.exists():
            self.load_from_file(config_file)

    def _load_default_config(self):
        self.base_output_dir = Path(r"D:\DATA\COMSOL_Work\samples")
        self.parameters = [
            ParameterDefinition('P0', '[W]', 'discrete', [0, 1]),
            ParameterDefinition('P1', '[W]', 'discrete', [0, 1]),
            ParameterDefinition('P2', '[W]', 'discrete', [0, 1]),
            ParameterDefinition('P3', '[W]', 'discrete', [0, 1]),
            ParameterDefinition('P4', '[W]', 'discrete', [0, 1]),
            ParameterDefinition('P5', '[W]', 'discrete', [0, 1]),
            ParameterDefinition('P6', '[W]', 'discrete', [0, 1]),
            ParameterDefinition('P7', '[W]', 'discrete', [0, 1]),
            ParameterDefinition('R1', '', 'continuous', [60, 70]),
            ParameterDefinition('R2', '', 'continuous', [55, 65]),
        ]
        self.comsol = ComsolConfig(
            model_file_path=r"C:\Users\WQN\Desktop\低频干涉接收\DSL_toDatabase_split.mph",
            export_volum_tags=['volum_data'],
            export_face_tags=['bottum_data', 'face_data_0', 'face_data_1', 'face_data_2',
                             'face_data_3', 'face_data_4', 'face_data_5',
                             ],
            field_expressions={
                'temperature': 'T',
            },
            connection=ComsolConnectionConfig()
        )
        self.geometry = GeometryConfig()
        self.processing = ProcessingConfig()
        self.visualization = VisualizationConfig()
        self.dataset = DatasetConfig()
        self.num_samples = 200

    def load_from_file(self, config_file: Path):
        with open(config_file, 'r', encoding='utf-8') as f:
            config_data = yaml.safe_load(f)

        if 'base_output_dir' in config_data:
            self.base_output_dir = Path(config_data['base_output_dir'])

        if 'num_samples' in config_data:
            self.num_samples = config_data['num_samples']

        if 'comsol' in config_data:
            comsol_data = dict(config_data['comsol'])
            connection_data = comsol_data.get('connection', {})
            if 'remote_model_file_path' not in connection_data and 'model_file_path' in comsol_data:
                connection_data['remote_model_file_path'] = comsol_data['model_file_path']
            comsol_data['connection'] = ComsolConnectionConfig(**connection_data)
            self.comsol = ComsolConfig(**comsol_data)

        if 'geometry' in config_data:
            geometry_data = config_data['geometry']
            self.geometry = GeometryConfig(**geometry_data)

        if 'processing' in config_data:
            processing_data = config_data['processing']
            self.processing = ProcessingConfig(**processing_data)

        if 'visualization' in config_data:
            viz_data = config_data['visualization']
            self.visualization = VisualizationConfig(**viz_data)

        if 'dataset' in config_data:
            dataset_data = config_data['dataset']
            self.dataset = DatasetConfig(**dataset_data)

    def save_to_file(self, config_file: Path):
        config_data = {
            'base_output_dir': str(self.base_output_dir),
            'num_samples': self.num_samples,
            'parameters': [asdict(p) for p in self.parameters],
            'comsol': asdict(self.comsol),
            'geometry': asdict(self.geometry),
            'processing': asdict(self.processing),
            'visualization': asdict(self.visualization),
            'dataset': asdict(self.dataset)
        }

        with open(config_file, 'w', encoding='utf-8') as f:
            yaml.dump(config_data, f, allow_unicode=True, default_flow_style=False)

    def get_sample_dir(self, sample_id: int) -> Path:
        return self.base_output_dir / f"sample_{sample_id:04d}"

    def ensure_sample_dirs(self, sample_id: int):
        sample_dir = self.get_sample_dir(sample_id)
        (sample_dir / "comsol_results").mkdir(parents=True, exist_ok=True)
        (sample_dir / "processed_data").mkdir(parents=True, exist_ok=True)
        (sample_dir / "visualizations").mkdir(parents=True, exist_ok=True)
        return sample_dir
