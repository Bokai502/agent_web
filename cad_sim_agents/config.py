from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

from codex_agents.package_paths import vendor_path


@dataclass(frozen=True)
class BomExternalToolsPipelineConfig:
    bom_json: Path
    run_root: Path
    layout3dcube_root: Path = vendor_path("layout_runtime", "layout3dcube_runtime")
    dist_yaml: Path = vendor_path("layout_runtime", "layout3dcube_runtime", "config", "dist_v2.yaml")
    thermal_db: Path = vendor_path("data", "module_db", "热仿真数据库.xlsx")
    sample_id: str = "930001"
    seed: int = 930001
    clearance_mm: float = 3.0
    multistart: int = 3
    target_fill_ratio: float = 0.42
    geometry_edit_dir_name: str = "02_geometry_edit"
    rebuild_cad_after_edit: bool = True
    max_actions_per_case: int = 3
    simulation_backend: str = "comsol_local"
    thermal_sim_config: Path = vendor_path("simulation_runtime", "comsol_runtime", "configs", "thermal_sim.yaml")
    comsol_connection_config: Path = vendor_path("simulation_runtime", "comsol_runtime", "configs", "comsol_connection_local.yaml")
    comsol_runtime_root: Path = vendor_path("simulation_runtime", "comsol_runtime")
    connect_existing_mphserver: bool = False
    paraview_render: Path = vendor_path("paraview_runtime", "paraview_renderer", "render_temperature.py")
    skip_postprocess: bool = False

    @classmethod
    def from_namespace(cls, args: argparse.Namespace) -> "BomExternalToolsPipelineConfig":
        return cls(
            bom_json=Path(args.bom_json),
            run_root=Path(args.run_root),
            layout3dcube_root=Path(getattr(args, "layout3dcube_root", cls.layout3dcube_root)),
            dist_yaml=Path(getattr(args, "dist_yaml", cls.dist_yaml)),
            thermal_db=Path(getattr(args, "thermal_db", cls.thermal_db)),
            sample_id=str(getattr(args, "sample_id", cls.sample_id)),
            seed=int(getattr(args, "seed", cls.seed)),
            clearance_mm=float(getattr(args, "clearance_mm", cls.clearance_mm)),
            multistart=int(getattr(args, "multistart", cls.multistart)),
            target_fill_ratio=float(getattr(args, "target_fill_ratio", cls.target_fill_ratio)),
            geometry_edit_dir_name=str(getattr(args, "geometry_edit_dir_name", cls.geometry_edit_dir_name)),
            rebuild_cad_after_edit=bool(getattr(args, "rebuild_cad_after_edit", cls.rebuild_cad_after_edit)),
            max_actions_per_case=int(getattr(args, "max_actions_per_case", cls.max_actions_per_case)),
            simulation_backend=str(getattr(args, "simulation_backend", cls.simulation_backend)),
            thermal_sim_config=Path(getattr(args, "thermal_sim_config", cls.thermal_sim_config)),
            comsol_connection_config=Path(getattr(args, "comsol_connection_config", cls.comsol_connection_config)),
            comsol_runtime_root=Path(getattr(args, "comsol_runtime_root", cls.comsol_runtime_root)),
            connect_existing_mphserver=bool(getattr(args, "connect_existing_mphserver", cls.connect_existing_mphserver)),
            paraview_render=Path(getattr(args, "paraview_render", cls.paraview_render)),
            skip_postprocess=bool(getattr(args, "skip_postprocess", cls.skip_postprocess)),
        )
