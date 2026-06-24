"""
远程COMSOL执行入口
在HPC侧启动mph并执行几何更新/求解/导出
"""

import argparse
import json
import re
import shutil
import sys
import threading
import time
import traceback
from pathlib import Path
from typing import Any, Dict, List, Optional

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import mph

from pipeline.config import Config
from utils.geometry_updater import GeometryUpdater
from utils.file_utils import (
    atomic_write_json,
    copy_mph_template,
    detect_schema_version,
    load_layout_meta,
    load_layout_meta_v2,
    load_yaml,
    save_yaml,
)
from core.selection_updater import SelectionUpdater
from core.selection_updater_v2 import SelectionUpdaterV2, component_mount_face_bounds_from_target_plane
from core.run_checks import RunChecks


_V2_COMPONENT_TAG_RE = re.compile(r'^[A-Z]_\d{3}_[A-Za-z0-9_]+$')
_V1_COMPONENT_TAG_RE = re.compile(r'^[A-Z]\d{3,}$')
_DYNAMIC_SELECTION_PREFIXES = (
    'sel_f_',
    'sel_w_',
    'sel_c_',
    'sel_env_',
    'sel_env_box_',
    'sel_shell_',
    'fsurf_',
    'fadj_',
    'fbox_',
    'fplate_',
    'flocal_',
    'fmount_',
    'ftarget_',
    'radexp_',
    'adj_',
)
_DYNAMIC_HT_PREFIXES = (
    'hs_',
    'rad_',
    'solar_hf_',
    'env_hf_',
    'temp_',
    'thin_',
    'tc_',
)
_DYNAMIC_PAIR_PREFIXES = (
    'pair_',
)

_SHELL_ENV_FACES = (
    ('+X', 0, 1, 'xmax'),
    ('-X', 0, -1, 'xmin'),
    ('+Y', 1, 1, 'ymax'),
    ('-Y', 1, -1, 'ymin'),
    ('+Z', 2, 1, 'zmax'),
    ('-Z', 2, -1, 'zmin'),
)


def _direction_tag(direction: str) -> str:
    if direction.startswith('+'):
        return f"pos_{direction[1:]}"
    if direction.startswith('-'):
        return f"neg_{direction[1:]}"
    return re.sub(r'[^A-Za-z0-9_]', '_', direction)


class RemoteComsolExecutor:
    def __init__(self, payload: Dict[str, Any]):
        self.payload = payload
        self.client = None
        self.model = None

    def _thermal_solver_config(self) -> Dict[str, Any]:
        thermal_sim = self.payload.get('thermal_sim') or {}
        if not isinstance(thermal_sim, dict):
            return {}
        solver_cfg = thermal_sim.get('solver') or {}
        if not solver_cfg:
            extra = self.payload.get('extra') or {}
            if isinstance(extra, dict):
                solver_cfg = extra.get('solver') or {}
        return solver_cfg if isinstance(solver_cfg, dict) else {}

    def _load_scale_parameter_name(self) -> Optional[str]:
        solver_cfg = self._thermal_solver_config()
        load_scale_cfg = solver_cfg.get('load_scale') or {}
        if not isinstance(load_scale_cfg, dict) or not load_scale_cfg.get('enabled', False):
            return None
        return str(load_scale_cfg.get('parameter', 'load_scale'))

    def _ensure_solver_parameters(self) -> Dict[str, Any]:
        load_scale = self._load_scale_parameter_name()
        if not load_scale:
            return {'load_scale': {'enabled': False}}

        solver_cfg = self._thermal_solver_config()
        load_scale_cfg = solver_cfg.get('load_scale') or {}
        values = load_scale_cfg.get('values') or [1.0]
        final_value = float(values[-1] if isinstance(values, list) and values else values)
        self.model.parameter(load_scale, str(final_value))
        return {
            'load_scale': {
                'enabled': True,
                'parameter': load_scale,
                'values': values,
                'active_value': final_value,
                'note': 'Thermal loads reference this parameter; current run solves the final load value directly.',
            }
        }

    def smoke_test(self) -> Dict[str, Any]:
        return {
            'message': 'remote mph is available',
            'model_file_path': self.payload['model_file_path'],
            'loaded_model': self.model is not None,
        }

    def connect(self):
        runtime = self.payload.get('runtime', {})
        version = str(runtime.get('mph_version') or '6.4')
        port = int(runtime.get('mph_port') or 2036)
        self.client = mph.start(version=version, port=port)

    def load_model(self, model_path: Optional[str] = None):
        target_model_path = model_path or self.payload['model_file_path']
        self.model = self.client.load(target_model_path)

    def close(self):
        if self.client:
            try:
                self.client.clear()
            except Exception:
                pass

    def _write_sample_status(self, status_json: Path, status: Dict[str, Any]) -> None:
        status['updated_at'] = time.strftime('%Y-%m-%d %H:%M:%S')
        atomic_write_json(status, status_json)

    def _start_status_heartbeat(
        self,
        status_json: Path,
        progress_json: Path,
        status: Dict[str, Any],
        *,
        sample_id: str,
        stage: str,
        percent: float,
        interval_seconds: float = 10.0,
    ) -> tuple[threading.Event, threading.Thread]:
        stop_event = threading.Event()

        def heartbeat() -> None:
            while not stop_event.wait(interval_seconds):
                status['stage'] = stage
                status['progress_percent'] = percent
                status['heartbeat_at'] = time.strftime('%Y-%m-%d %H:%M:%S')
                self._write_sample_status(status_json, status)
                self._write_sample_status(
                    progress_json,
                    {
                        'sample_id': sample_id,
                        'stage': stage,
                        'percent': percent,
                        'ok': status.get('ok', False),
                        'heartbeat_at': status['heartbeat_at'],
                    },
                )

        thread = threading.Thread(target=heartbeat, daemon=True)
        thread.start()
        return stop_event, thread

    def _selection_entity_ids(self, selection) -> List[int]:
        try:
            return [int(entity_id) for entity_id in list(selection.entities())]
        except Exception:
            return []

    def _is_generated_component_tag(self, tag: str) -> bool:
        return bool(_V2_COMPONENT_TAG_RE.match(tag) or _V1_COMPONENT_TAG_RE.match(tag))

    def _is_generated_selection_tag(self, tag: str) -> bool:
        return tag == 'ALL' or tag.startswith(_DYNAMIC_SELECTION_PREFIXES) or self._is_generated_component_tag(tag)

    def _is_generated_heat_source_tag(self, tag: str) -> bool:
        return tag.startswith('hs_') or self._is_generated_component_tag(tag)

    def _is_generated_ht_feature_tag(self, tag: str) -> bool:
        return tag.startswith(_DYNAMIC_HT_PREFIXES) or self._is_generated_component_tag(tag)

    def _is_generated_pair_tag(self, tag: str) -> bool:
        return tag.startswith(_DYNAMIC_PAIR_PREFIXES)

    def _remove_generated_ht_features(self) -> Dict[str, Any]:
        ht = self.model.java.component('comp1').physics('ht')
        removed: List[str] = []
        failed: List[Dict[str, str]] = []

        for tag in list(ht.feature().tags()):
            tag_str = str(tag)
            if not self._is_generated_ht_feature_tag(tag_str):
                continue
            try:
                ht.feature().remove(tag)
                removed.append(tag_str)
            except Exception as exc:
                failed.append({'tag': tag_str, 'error': f'{type(exc).__name__}: {exc}'})

        return {
            'removed': removed,
            'removed_count': len(removed),
            'failed': failed,
            'failed_count': len(failed),
        }

    def _remove_generated_selections(self) -> Dict[str, Any]:
        comp_sel_root = self.model.java.component('comp1').selection()
        remove_method = getattr(comp_sel_root, 'remove', None)
        if not callable(remove_method):
            return {
                'removed': [],
                'removed_count': 0,
                'failed': [],
                'failed_count': 0,
                'note': 'selection.remove() is unavailable; skipped',
            }

        removed: List[str] = []
        failed: List[Dict[str, str]] = []
        for tag in list(comp_sel_root.tags()):
            tag_str = str(tag)
            if not self._is_generated_selection_tag(tag_str):
                continue
            try:
                remove_method(tag)
                removed.append(tag_str)
            except Exception as exc:
                failed.append({'tag': tag_str, 'error': f'{type(exc).__name__}: {exc}'})

        return {
            'removed': removed,
            'removed_count': len(removed),
            'failed': failed,
            'failed_count': len(failed),
        }

    def _remove_generated_pairs(self) -> Dict[str, Any]:
        pair_root = self.model.java.component('comp1').pair()
        remove_method = getattr(pair_root, 'remove', None)
        if not callable(remove_method):
            return {
                'removed': [],
                'removed_count': 0,
                'failed': [],
                'failed_count': 0,
                'note': 'pair.remove() is unavailable; skipped',
            }

        removed: List[str] = []
        failed: List[Dict[str, str]] = []
        for tag in list(pair_root.tags()):
            tag_str = str(tag)
            if not self._is_generated_pair_tag(tag_str):
                continue
            try:
                remove_method(tag)
                removed.append(tag_str)
            except Exception as exc:
                failed.append({'tag': tag_str, 'error': f'{type(exc).__name__}: {exc}'})

        return {
            'removed': removed,
            'removed_count': len(removed),
            'failed': failed,
            'failed_count': len(failed),
        }

    def _cleanup_generated_runtime_nodes(self) -> Dict[str, Any]:
        ht_result = self._remove_generated_ht_features()
        pair_result = self._remove_generated_pairs()
        selection_result = self._remove_generated_selections()
        return {
            'ok': (
                ht_result['failed_count'] == 0
                and pair_result['failed_count'] == 0
                and selection_result['failed_count'] == 0
            ),
            'ht_features': ht_result,
            'pairs': pair_result,
            'selections': selection_result,
        }

    def _save_model_snapshot(self, target_path: Path, status: Dict[str, Any], reason: str) -> None:
        if self.model is None:
            return
        snapshot = {'reason': reason, 'path': str(target_path), 'ok': False}
        try:
            target_path.parent.mkdir(parents=True, exist_ok=True)
            save_method = getattr(self.model, 'save', None)
            if callable(save_method):
                save_method(str(target_path))
            else:
                self.model.java.save(str(target_path))
            snapshot['ok'] = True
        except Exception as exc:
            snapshot['error'] = f'{type(exc).__name__}: {exc}'
        status.setdefault('artifacts', {}).setdefault('model_snapshots', []).append(snapshot)

    def _update_geometry_for_samples(self, sample_dirs: List[Path]) -> Dict[str, Any]:
        config = Config()
        geometry_payload = self.payload.get('geometry', {})
        config.geometry.enable_geometry_update = geometry_payload.get('enable_geometry_update', False)
        config.geometry.component = geometry_payload.get('component', config.geometry.component)
        config.geometry.geometry = geometry_payload.get('geometry', config.geometry.geometry)
        config.geometry.import_feature = geometry_payload.get('import_feature', config.geometry.import_feature)

        updater = GeometryUpdater(config)
        updater.set_model(self.model)
        result = updater.update_batch_geometries(sample_dirs)
        result['sample_dirs'] = [str(path) for path in sample_dirs]
        return result

    def _reset_sample_outputs(self, sample_dir: Path) -> None:
        comsol_results_dir = sample_dir / 'comsol_results'
        if comsol_results_dir.exists():
            shutil.rmtree(comsol_results_dir)
        comsol_results_dir.mkdir(parents=True, exist_ok=True)

        export_summary_path = sample_dir / 'export_summary.yaml'
        if export_summary_path.exists():
            export_summary_path.unlink()

    def _run_comsol_for_samples(self, sample_dirs: List[Path]) -> Dict[str, Any]:
        success_count = 0
        failed_samples = []
        sample_results = []

        export_face_tags = self.payload['comsol']['export_face_tags']
        export_volum_tags = self.payload['comsol']['export_volum_tags']

        for sample_dir in sample_dirs:
            try:
                sample_config = load_yaml(sample_dir / 'config.yaml')
                param_config = sample_config['parameters']
                for name, unit, value in zip(
                    param_config['param_name_in_comsol'],
                    param_config['param_unit'],
                    param_config['param_values'],
                ):
                    self.model.parameter(name, f'{value}{unit}')

                self.model.solve()

                self._reset_sample_outputs(sample_dir)
                comsol_results_dir = sample_dir / 'comsol_results'

                face_files = []
                for i, export_tag in enumerate(export_face_tags):
                    output_path = comsol_results_dir / f'face_{i}_result.txt'
                    self.model.export(export_tag, str(output_path))
                    if output_path.exists():
                        face_files.append(str(output_path))

                vtu_files = []
                for i, export_tag in enumerate(export_volum_tags):
                    output_path = comsol_results_dir / f'volum_{i}_result.vtu'
                    self.model.export(export_tag, str(output_path))
                    if output_path.exists():
                        vtu_files.append(str(output_path))

                export_summary_path = sample_dir / 'export_summary.yaml'
                save_yaml(
                    {
                        'sample_id': sample_config['sample_info']['sample_id'],
                        'face_files': face_files,
                        'vtu_files': vtu_files,
                        'export_time': time.strftime('%Y-%m-%d %H:%M:%S'),
                        'success': True,
                    },
                    export_summary_path,
                )
                sample_results.append(
                    {
                        'sample_dir': str(sample_dir),
                        'face_files': face_files,
                        'vtu_files': vtu_files,
                        'export_summary': str(export_summary_path),
                    }
                )
                success_count += 1
            except Exception as e:
                failed_samples.append({'sample_dir': str(sample_dir), 'error': str(e)})

        total_processed = len(sample_dirs)
        return {
            'total_samples': total_processed,
            'successful': success_count,
            'failed': len(failed_samples),
            'failed_samples': failed_samples,
            'sample_results': sample_results,
            'success_rate': success_count / total_processed if total_processed else 0,
        }

    def _create_heat_source(self, component_name: str, power_w: float, dims_mm: List[float]) -> Dict[str, Any]:
        from core.selection_updater_v2 import _safe_tag

        ht = self.model.java.component('comp1').physics('ht')
        feature_tag = _safe_tag(f'hs_{component_name}')
        feature_tags = [str(tag) for tag in ht.feature().tags()]
        if feature_tag not in feature_tags:
            ht.create(feature_tag, 'HeatSource', 3)

        hs = ht.feature(feature_tag)
        hs.label(component_name)
        hs.selection().named(component_name)

        vol_m3 = (dims_mm[0] * dims_mm[1] * dims_mm[2]) * 1e-9
        q0 = power_w / vol_m3 if vol_m3 > 0 else 0.0
        load_scale = self._load_scale_parameter_name()
        q0_expr = f'{q0}[W/m^3]'
        if load_scale:
            q0_expr = f'{load_scale}*({q0_expr})'
        hs.set('Q0', q0_expr)
        return {
            'tag': feature_tag,
            'component_name': component_name,
            'power_W': power_w,
            'Q0': q0,
            'Q0_expression': q0_expr,
        }

    def _prepare_mesh_for_v2(self, hauto: int = 3) -> dict:
        """Replace sweep mesh with free tetrahedral for v2 multi-domain geometry.

        v2 geometry (multi-cabin + wall + external solids) creates domains with two
        face components that the template's sweep mesh can't handle. FreeTet handles
        arbitrary topology.
        """
        mesh = self.model.java.component('comp1').mesh('mesh1')
        removed = []
        for tag in list(mesh.feature().tags()):
            tag_str = str(tag)
            try:
                mesh.feature().remove(tag)
                removed.append(tag_str)
            except Exception as e:
                print(f"    mesh.remove({tag_str}) failed (non-fatal): {e}")

        try:
            mesh.feature().create('size1', 'Size')
            mesh.feature('size1').set('hauto', str(hauto))
        except Exception as e:
            print(f"    Creating Size node failed (non-fatal): {e}")

        mesh.feature().create('ftet1', 'FreeTet')
        print(f"  [v2] mesh: replaced with FreeTet hauto={hauto} (removed {len(removed)} nodes: {removed})")
        return {'removed': removed, 'mesh_type': 'FreeTet', 'hauto': hauto, 'ok': True}

    def _clear_mesh_features(self, mesh) -> List[str]:
        removed = []
        for tag in list(mesh.feature().tags()):
            tag_str = str(tag)
            try:
                mesh.feature().remove(tag)
                removed.append(tag_str)
            except Exception as e:
                print(f"    mesh.remove({tag_str}) failed (non-fatal): {e}")
        return removed

    def _prepare_mesh_mode2_for_v2(self, components: List[Dict[str, Any]], mesh_config: Dict[str, Any]) -> dict:
        """Experimental hybrid mesh: Sweep for configured component boxes, FreeTet elsewhere.

        All mesh features stay in one COMSOL mesh sequence. Shared boundaries are
        therefore owned by COMSOL's mesh builder; if Sweep cannot be applied to a
        component domain, the global FreeTet node remains the fallback.
        """
        from core.selection_updater_v2 import _safe_tag

        mode2 = mesh_config.get('mesh_mode2') or {}
        sweep_kinds = set(mode2.get('sweep_component_kinds') or ['internal'])
        sweep_component_ids = {str(item) for item in (mode2.get('sweep_component_ids') or [])}
        hauto = int(mesh_config.get('v2_hauto', 3))
        mesh = self.model.java.component('comp1').mesh('mesh1')
        removed = self._clear_mesh_features(mesh)
        result: Dict[str, Any] = {
            'ok': True,
            'mesh_type': 'hybrid_mode2',
            'hauto': hauto,
            'removed': removed,
            'mode2': mode2,
            'structured': {
                'attempted': 0,
                'created': 0,
                'skipped': 0,
                'failed': [],
                'sweep_component_kinds': sorted(sweep_kinds),
                'sweep_component_ids': sorted(sweep_component_ids),
                'attempted_by_kind': {},
                'created_by_kind': {},
                'skipped_by_kind': {},
            },
            'unstructured': {'tag': 'ftet1', 'type': 'FreeTet', 'selection': 'remaining/all domains'},
            'notes': [
                'FreeTet is kept as a fallback for shell, cabin wall, and any swept-failed domains.',
                'Sweep nodes are assigned to existing per-component domain selections for configured component kinds.',
                'Sweep domain selections are de-duplicated by COMSOL domain entity id before mesh feature creation.',
            ],
        }

        try:
            mesh.feature().create('size1', 'Size')
            mesh.feature('size1').set('hauto', str(hauto))
        except Exception as e:
            result['warnings'] = [f'Creating Size node failed: {type(e).__name__}: {e}']
            print(f"    Creating Size node failed (non-fatal): {e}")

        swept_domain_ids: set[int] = set()
        for comp in components:
            kind = comp.get('kind') or 'unknown'
            name = comp['name']
            if kind not in sweep_kinds and name not in sweep_component_ids:
                continue
            safe_name = _safe_tag(name)
            sweep_tag = f"swe_{safe_name}"
            domain_ids = self._selection_entity_ids(self.model.java.component('comp1').selection(name))
            record: Dict[str, Any] = {
                'component': name,
                'kind': kind,
                'tag': sweep_tag,
                'feature_type': 'Sweep',
                'selection': name,
                'domain_ids': domain_ids,
                'ok': False,
            }
            result['structured']['attempted'] += 1
            result['structured']['attempted_by_kind'][kind] = (
                result['structured']['attempted_by_kind'].get(kind, 0) + 1
            )
            if not domain_ids:
                record['note'] = 'skipped: component domain selection is empty'
                result['structured']['skipped'] += 1
                result['structured']['skipped_by_kind'][kind] = (
                    result['structured']['skipped_by_kind'].get(kind, 0) + 1
                )
                result['structured'].setdefault('skipped_records', []).append(record)
                continue
            duplicate_domain_ids = sorted(set(domain_ids) & swept_domain_ids)
            if duplicate_domain_ids:
                record['note'] = 'skipped: component selection overlaps earlier Sweep domains'
                record['duplicate_domain_ids'] = duplicate_domain_ids
                result['structured']['skipped'] += 1
                result['structured']['skipped_by_kind'][kind] = (
                    result['structured']['skipped_by_kind'].get(kind, 0) + 1
                )
                result['structured'].setdefault('skipped_records', []).append(record)
                continue
            try:
                mesh.feature().create(sweep_tag, 'Sweep')
                sweep = mesh.feature(sweep_tag)
                sweep.selection().named(name)
                record['ok'] = True
                swept_domain_ids.update(domain_ids)
                result['structured']['created'] += 1
                result['structured']['created_by_kind'][kind] = (
                    result['structured']['created_by_kind'].get(kind, 0) + 1
                )
                result['structured'].setdefault('created_records', []).append(record)
            except Exception as e:
                record['error'] = f'{type(e).__name__}: {e}'
                result['structured']['failed'].append(record)
                try:
                    mesh.feature().remove(sweep_tag)
                except Exception:
                    pass
                continue

        try:
            mesh.feature().create('ftet1', 'FreeTet')
        except Exception as e:
            result['ok'] = False
            result['unstructured']['error'] = f'{type(e).__name__}: {e}'
            return result

        print(
            "  [v2] mesh_mode2: "
            f"Sweep components={result['structured']['created']}/{result['structured']['attempted']} "
            f"kinds={sorted(sweep_kinds)}, "
            f"FreeTet fallback hauto={hauto}"
        )
        return result

    def _build_component_boundary_selection(self, name: str, pos_mm: list, dims_mm: list) -> str:
        comp_sel_root = self.model.java.component('comp1').selection()
        face_sel_tag = f'fsurf_{name}'
        existing_sel_tags = {str(t) for t in comp_sel_root.tags()}
        if face_sel_tag not in existing_sel_tags:
            comp_sel_root.create(face_sel_tag, 'Box')
        fsel = self.model.java.component('comp1').selection(face_sel_tag)
        fsel.label(f'fsurf:{name}')
        fsel.set('entitydim', '2')
        fsel.set('xmin', f'{float(pos_mm[0])}[mm]')
        fsel.set('xmax', f'{float(pos_mm[0]) + float(dims_mm[0])}[mm]')
        fsel.set('ymin', f'{float(pos_mm[1])}[mm]')
        fsel.set('ymax', f'{float(pos_mm[1]) + float(dims_mm[1])}[mm]')
        fsel.set('zmin', f'{float(pos_mm[2])}[mm]')
        fsel.set('zmax', f'{float(pos_mm[2]) + float(dims_mm[2])}[mm]')
        fsel.set('condition', 'allvertices')
        return face_sel_tag

    def _build_component_mount_boundary_selection(
        self,
        name: str,
        pos_mm: list,
        dims_mm: list,
        mount_face: Dict[str, Any],
        component_mount_face: Optional[Dict[str, Any]] = None,
    ) -> str:
        """为组件创建“贴装那一侧”的单一边界 Selection.

        component_mount_face_id/local_* 描述的是组件自身语义面，不一定等同于装配
        后的全局 xmin/xmax/ymin/...。这里用目标安装面的全局平面，反推组件 bbox
        上最接近该平面的那一侧，作为真实热交界面。
        """
        comp_sel_root = self.model.java.component('comp1').selection()
        adj_tag = f'fadj_{name}'
        box_tag = f'fbox_{name}'
        face_sel_tag = f'fmount_{name}'
        existing_sel_tags = {str(t) for t in comp_sel_root.tags()}
        if adj_tag not in existing_sel_tags:
            comp_sel_root.create(adj_tag, 'Adjacent')
        adj_sel = self.model.java.component('comp1').selection(adj_tag)
        adj_sel.label(f'fadj:{name}')
        adj_sel.set('entitydim', '3')
        adj_sel.set('input', [name])
        adj_sel.set('outputdim', '2')

        existing_sel_tags = {str(t) for t in comp_sel_root.tags()}
        if box_tag not in existing_sel_tags:
            comp_sel_root.create(box_tag, 'Box')
        box_sel = self.model.java.component('comp1').selection(box_tag)
        box_sel.label(f'fbox:{name}')
        box_sel.set('entitydim', '2')
        box_sel.set('condition', 'allvertices')

        bounds = component_mount_face_bounds_from_target_plane(pos_mm, dims_mm, mount_face, eps_mm=1.0)

        box_sel.set('xmin', f'{bounds[0][0]}[mm]')
        box_sel.set('xmax', f'{bounds[0][1]}[mm]')
        box_sel.set('ymin', f'{bounds[1][0]}[mm]')
        box_sel.set('ymax', f'{bounds[1][1]}[mm]')
        box_sel.set('zmin', f'{bounds[2][0]}[mm]')
        box_sel.set('zmax', f'{bounds[2][1]}[mm]')

        existing_sel_tags = {str(t) for t in comp_sel_root.tags()}
        if face_sel_tag not in existing_sel_tags:
            comp_sel_root.create(face_sel_tag, 'Intersection')
        fsel = self.model.java.component('comp1').selection(face_sel_tag)
        fsel.label(f'fmount:{name}')
        fsel.set('entitydim', '2')
        fsel.set('input', [adj_tag, box_tag])
        return face_sel_tag

    def _build_component_target_boundary_selection(
        self,
        name: str,
        comp_mount_bnd_sel_tag: str,
        face_sel_tag: str,
    ) -> str:
        """Create a local target boundary for one component contact pair."""
        comp_sel_root = self.model.java.component('comp1').selection()
        local_face_tag = f'flocal_{name}'
        target_tag = f'ftarget_{name}'
        box_tag = f'fbox_{name}'

        existing_sel_tags = {str(t) for t in comp_sel_root.tags()}
        if local_face_tag not in existing_sel_tags:
            comp_sel_root.create(local_face_tag, 'Intersection')
        local_sel = self.model.java.component('comp1').selection(local_face_tag)
        local_sel.label(f'flocal:{name}')
        local_sel.set('entitydim', '2')
        local_sel.set('input', [box_tag, face_sel_tag])

        existing_sel_tags = {str(t) for t in comp_sel_root.tags()}
        if target_tag not in existing_sel_tags:
            comp_sel_root.create(target_tag, 'Difference')
        target_sel = self.model.java.component('comp1').selection(target_tag)
        target_sel.label(f'ftarget:{name}')
        target_sel.set('entitydim', '2')
        target_sel.set('add', [local_face_tag])
        target_sel.set('subtract', [comp_mount_bnd_sel_tag])
        return target_tag

    def _build_non_component_boundary_selection(
        self,
        components_data: list,
        outer_shell: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Create a boundary selection for the imported shell/non-component domain.

        In v2 assembly geometry, install face box selections often pick the
        component-side mounting faces, not the shell-side face. The shell body is
        recovered as all domains inside the model bbox minus every component
        domain, then converted to adjacent boundaries.
        """
        comp_sel_root = self.model.java.component('comp1').selection()
        all_tag = 'shell_domain_box'
        shell_tag = 'shell_domain'
        bnd_tag = 'shell_boundary'

        bbox = (outer_shell or {}).get('outer_bbox', {}) if isinstance(outer_shell, dict) else {}
        bmin = bbox.get('min') if isinstance(bbox, dict) else None
        bmax = bbox.get('max') if isinstance(bbox, dict) else None
        if not (isinstance(bmin, list) and isinstance(bmax, list) and len(bmin) == 3 and len(bmax) == 3):
            bmin = [-10000.0, -10000.0, -10000.0]
            bmax = [10000.0, 10000.0, 10000.0]
        pad_mm = 20.0

        existing = {str(t) for t in comp_sel_root.tags()}
        if all_tag not in existing:
            comp_sel_root.create(all_tag, 'Box')
        all_sel = self.model.java.component('comp1').selection(all_tag)
        all_sel.label('shell:all_domain_box')
        all_sel.set('entitydim', '3')
        all_sel.set('condition', 'intersects')
        all_sel.set('xmin', f'{float(bmin[0]) - pad_mm}[mm]')
        all_sel.set('xmax', f'{float(bmax[0]) + pad_mm}[mm]')
        all_sel.set('ymin', f'{float(bmin[1]) - pad_mm}[mm]')
        all_sel.set('ymax', f'{float(bmax[1]) + pad_mm}[mm]')
        all_sel.set('zmin', f'{float(bmin[2]) - pad_mm}[mm]')
        all_sel.set('zmax', f'{float(bmax[2]) + pad_mm}[mm]')

        component_tags = [
            comp['name']
            for comp in components_data
            if comp.get('name') in {str(t) for t in comp_sel_root.tags()}
        ]
        existing = {str(t) for t in comp_sel_root.tags()}
        if shell_tag not in existing:
            comp_sel_root.create(shell_tag, 'Difference')
        shell_sel = self.model.java.component('comp1').selection(shell_tag)
        shell_sel.label('shell:domain')
        shell_sel.set('entitydim', '3')
        shell_sel.set('add', [all_tag])
        shell_sel.set('subtract', component_tags)

        existing = {str(t) for t in comp_sel_root.tags()}
        if bnd_tag not in existing:
            comp_sel_root.create(bnd_tag, 'Adjacent')
        bnd_sel = self.model.java.component('comp1').selection(bnd_tag)
        bnd_sel.label('shell:boundary')
        bnd_sel.set('entitydim', '3')
        bnd_sel.set('input', [shell_tag])
        bnd_sel.set('outputdim', '2')

        domain_ids = self._selection_entity_ids(shell_sel)
        boundary_ids = self._selection_entity_ids(bnd_sel)
        return {
            'domain_selection': shell_tag,
            'boundary_selection': bnd_tag,
            'domain_ids': domain_ids,
            'boundary_ids': boundary_ids,
            'component_domain_count': len(component_tags),
        }

    def _resolve_heat_flux_json_path(
        self,
        input_json_path: Any,
        sample_dir: Path,
    ) -> Path:
        path_text = str(input_json_path or '').strip()
        if path_text:
            path = Path(path_text).expanduser()
            if not path.is_absolute():
                path = (sample_dir / path).resolve()
            return path
        return (sample_dir.parent.parent / '00_inputs' / 'heatflux' / 'selected_heatflux.json').resolve()

    def _load_solar_heat_flux_config(
        self,
        solar_config: Dict[str, Any],
        sample_dir: Path,
    ) -> Dict[str, Any]:
        input_path = self._resolve_heat_flux_json_path(solar_config.get('input_json_path'), sample_dir)
        if not input_path.exists():
            raise FileNotFoundError(f'solar heat flux json not found: {input_path}')
        data = json.loads(input_path.read_text(encoding='utf-8'))
        units = data.get('units') if isinstance(data.get('units'), dict) else {}
        if units.get('heat_flux') != 'W/m^2':
            raise ValueError(f"solar heat flux units.heat_flux must be W/m^2, got {units.get('heat_flux')!r}")
        faces = data.get('faces') if isinstance(data.get('faces'), dict) else {}
        missing = [direction for direction, *_ in _SHELL_ENV_FACES if direction not in faces]
        if missing:
            raise ValueError(f'solar heat flux faces missing directions: {missing}')
        parsed_faces: Dict[str, float] = {}
        for direction, *_ in _SHELL_ENV_FACES:
            value = float(faces[direction])
            if not value == value or value in (float('inf'), float('-inf')):
                raise ValueError(f'solar heat flux for {direction} must be finite')
            parsed_faces[direction] = value
        return {
            'path': str(input_path),
            'input_kind': str(solar_config.get('input_kind') or 'incident'),
            'default_absorptivity': float(solar_config.get('default_absorptivity', 0.3)),
            'faces': parsed_faces,
            'metadata': {
                key: data.get(key)
                for key in (
                    'schema_version',
                    'orbit_type',
                    'season',
                    'season_key',
                    'requested_time',
                    'requested_time_s',
                    'orbit_phase_time',
                    'orbit_phase_time_s',
                    'matched_time',
                    'matched_time_s',
                    'orbit_period_s',
                    'source',
                    'updated_at',
                )
                if key in data
            },
        }

    def _build_shell_environment_face_selections(
        self,
        outer_shell: Optional[Dict[str, Any]],
        shell_boundary_selection: Optional[str],
        *,
        eps_mm: float = 1.0,
    ) -> Dict[str, Any]:
        """Create six shell-only outer face selections for external environment loads."""
        comp_sel_root = self.model.java.component('comp1').selection()
        bbox = (outer_shell or {}).get('outer_bbox', {}) if isinstance(outer_shell, dict) else {}
        bmin = bbox.get('min') if isinstance(bbox, dict) else None
        bmax = bbox.get('max') if isinstance(bbox, dict) else None
        if not (isinstance(bmin, list) and isinstance(bmax, list) and len(bmin) == 3 and len(bmax) == 3):
            raise ValueError('outer_shell.outer_bbox with min/max length 3 is required for shell environment faces')

        bounds = [[float(bmin[i]), float(bmax[i])] for i in range(3)]
        existing = {str(t) for t in comp_sel_root.tags()}
        faces: Dict[str, Dict[str, Any]] = {}
        created = 0
        failed: List[Dict[str, str]] = []

        for direction, axis, sign, face_name in _SHELL_ENV_FACES:
            direction_tag = _direction_tag(direction)
            box_tag = f"sel_env_box_{direction_tag}"
            face_tag = f"sel_env_{direction_tag}"
            plane_value = bounds[axis][1] if sign > 0 else bounds[axis][0]
            face_bounds = [list(item) for item in bounds]
            face_bounds[axis] = [plane_value - eps_mm, plane_value + eps_mm]
            try:
                if box_tag not in existing:
                    comp_sel_root.create(box_tag, 'Box')
                    existing.add(box_tag)
                box_sel = self.model.java.component('comp1').selection(box_tag)
                box_sel.label(f'env-box:{direction}')
                box_sel.set('entitydim', '2')
                box_sel.set('condition', 'allvertices')
                box_sel.set('xmin', f'{face_bounds[0][0]}[mm]')
                box_sel.set('xmax', f'{face_bounds[0][1]}[mm]')
                box_sel.set('ymin', f'{face_bounds[1][0]}[mm]')
                box_sel.set('ymax', f'{face_bounds[1][1]}[mm]')
                box_sel.set('zmin', f'{face_bounds[2][0]}[mm]')
                box_sel.set('zmax', f'{face_bounds[2][1]}[mm]')

                if shell_boundary_selection:
                    if face_tag not in existing:
                        comp_sel_root.create(face_tag, 'Intersection')
                        existing.add(face_tag)
                    face_sel = self.model.java.component('comp1').selection(face_tag)
                    face_sel.label(f'env:{direction}')
                    face_sel.set('entitydim', '2')
                    face_sel.set('input', [box_tag, shell_boundary_selection])
                else:
                    face_tag = box_tag

                entities = self._selection_entity_ids(self.model.java.component('comp1').selection(face_tag))
                if not entities:
                    raise RuntimeError('shell environment face selection is empty')
                created += 1
                faces[direction] = {
                    'direction': direction,
                    'axis': axis,
                    'sign': sign,
                    'face_name': face_name,
                    'plane_value_mm': plane_value,
                    'selection': face_tag,
                    'box_selection': box_tag,
                    'boundary_count': len(entities),
                    'boundary_ids': entities,
                    'ok': True,
                }
            except Exception as exc:
                failed.append({
                    'direction': direction,
                    'selection': face_tag,
                    'error': f'{type(exc).__name__}: {exc}',
                })

        result = {
            'ok': len(faces) == len(_SHELL_ENV_FACES) and not failed,
            'created': created,
            'failed': failed,
            'faces': faces,
            'source': {
                'outer_shell_bbox': bbox,
                'shell_boundary_selection': shell_boundary_selection,
                'eps_mm': eps_mm,
            },
        }
        if not result['ok']:
            raise RuntimeError(f"shell environment face selection failed: {failed}")
        return result

    def _apply_radiator_surface_to_ambient_v2(
        self,
        components_data: list,
        install_faces: dict,
        boundary_conditions: Optional[Dict[str, Any]] = None,
    ) -> dict:
        """为外露组件表面施加 COMSOL SurfaceToAmbient 辐射 BC.

        radiator 和 external 组件都暴露在环境中。对组件边界做 boundary box
        selection, 再扣掉挂载接触面, 仅对外露面施加辐射.
        """
        from core.selection_updater_v2 import _safe_tag

        ht = self.model.java.component('comp1').physics('ht')
        comp_sel_root = self.model.java.component('comp1').selection()
        applied, skipped = 0, 0
        details = []
        shell_face_bc = (boundary_conditions or {}).get('shell_faces', {})
        ambient_temp_k = float(shell_face_bc.get('ambient_temp', 300.0))

        for comp in components_data:
            if comp.get('kind') not in {'radiator', 'external'}:
                continue
            name = comp['name']
            ts = comp.get('thermal_surface', {})
            emissivity = ts.get('emissivity')
            mount_face_id = comp.get('mount_face_id')
            pos_mm = comp.get('pos_mm')
            dims_mm = comp.get('dims_mm')
            mount_face = install_faces.get(mount_face_id) if mount_face_id else None

            if emissivity is None or not mount_face_id or not pos_mm or not dims_mm or not mount_face:
                skipped += 1
                details.append({'name': name, 'ok': False, 'note': 'missing emissivity, mount_face_id/install_face, or bbox'})
                continue

            rad_tag = f'rad_{safe_name}'
            comp_bnd_sel_tag = self._build_component_boundary_selection(name, pos_mm, dims_mm)
            mount_bnd_sel_tag = self._build_component_mount_boundary_selection(name, pos_mm, dims_mm, mount_face)
            exposed_sel_tag = f'radexp_{safe_name}'
            try:
                existing_sel_tags = {str(t) for t in comp_sel_root.tags()}
                if exposed_sel_tag not in existing_sel_tags:
                    comp_sel_root.create(exposed_sel_tag, 'Difference')
                exposed_sel = self.model.java.component('comp1').selection(exposed_sel_tag)
                exposed_sel.label(f'radexp:{name}')
                exposed_sel.set('entitydim', '2')
                exposed_sel.set('add', [comp_bnd_sel_tag])
                exposed_sel.set('subtract', [mount_bnd_sel_tag])
                exposed_entities = self._selection_entity_ids(exposed_sel)
                if not exposed_entities:
                    raise RuntimeError('radiator exposed boundary selection is empty')

                ht_tags = {str(t) for t in ht.feature().tags()}
                bc_type = shell_face_bc.get('type', 'radiation')
                feature_type = 'TemperatureBoundary' if bc_type == 'temperature' else 'SurfaceToAmbientRadiation'
                if rad_tag not in ht_tags:
                    ht.create(rad_tag, feature_type, 2)
                feat = ht.feature(rad_tag)
                feat.label(f'rad:{name}')
                feat.selection().named(exposed_sel_tag)
                if bc_type == 'temperature':
                    feat.set('T0', f'{ambient_temp_k}[K]')
                else:
                    self._set_surface_to_ambient_radiation(feat, emissivity, ambient_temp_k)
                applied += 1
                details.append({
                    'name': name,
                    'emissivity': emissivity,
                    'ambient_temp_K': ambient_temp_k,
                    'mount_face_id': mount_face_id,
                    'selection': exposed_sel_tag,
                    'boundary_count': len(exposed_entities),
                    'rad_tag': rad_tag,
                    'ok': True,
                })
                print(f"    ✓ {rad_tag}: epsilon_rad={emissivity:.3f}, Tamb={ambient_temp_k}K")
            except Exception as e:
                skipped += 1
                details.append({'name': name, 'ok': False, 'note': f'{type(e).__name__}: {e}'})
                print(f"    ✗ {rad_tag} 失败: {type(e).__name__}: {e}")

        print(f"  [v2] SurfaceToAmbientRadiation: applied={applied}, skipped={skipped}")
        return {'applied': applied, 'skipped': skipped, 'details': details}

    def _apply_shell_surface_to_ambient_v2(
        self,
        shell_environment_faces: Dict[str, Any],
        boundary_conditions: Optional[Dict[str, Any]] = None,
    ) -> dict:
        """Apply SurfaceToAmbient radiation to the six shell environment faces."""
        shell_face_bc = (boundary_conditions or {}).get('shell_faces', {})
        emissivity = float(shell_face_bc.get('emissivity', 0.8))
        ambient_temp_k = float(shell_face_bc.get('ambient_temp', 300.0))
        ht = self.model.java.component('comp1').physics('ht')
        applied, skipped = 0, 0
        details = []

        for direction, face in shell_environment_faces.get('faces', {}).items():
            sel_tag = face['selection']
            rad_tag = f"rad_shell_{_direction_tag(direction)}"
            try:
                entities = self._selection_entity_ids(self.model.java.component('comp1').selection(sel_tag))
                if not entities:
                    raise RuntimeError('shell outer face selection is empty')

                ht_tags = {str(t) for t in ht.feature().tags()}
                if rad_tag not in ht_tags:
                    ht.create(rad_tag, 'SurfaceToAmbientRadiation', 2)
                feat = ht.feature(rad_tag)
                feat.label(f'rad:shell:{direction}')
                feat.selection().named(sel_tag)
                self._set_surface_to_ambient_radiation(feat, emissivity, ambient_temp_k)
                applied += 1
                details.append({
                    'direction': direction,
                    'selection': sel_tag,
                    'boundary_count': len(entities),
                    'emissivity': emissivity,
                    'ambient_temp_K': ambient_temp_k,
                    'rad_tag': rad_tag,
                    'ok': True,
                })
                print(f"    ✓ {rad_tag}: epsilon_rad={emissivity:.3f}, Tamb={ambient_temp_k}K")
            except Exception as e:
                skipped += 1
                details.append({'direction': direction, 'selection': sel_tag, 'ok': False, 'note': f'{type(e).__name__}: {e}'})
                print(f"    ✗ {rad_tag} 失败: {type(e).__name__}: {e}")

        print(f"  [v2] shell SurfaceToAmbientRadiation: applied={applied}, skipped={skipped}")
        return {
            'applied': applied,
            'skipped': skipped,
            'details': details,
            'note': 'Deep-space radiation is applied only to the six cabin outer shell faces.',
        }

    def _set_heat_flux_boundary(self, feature: Any, q0_w_m2: float) -> None:
        self._set_heat_flux_boundary_expression(feature, f'{q0_w_m2}[W/m^2]')

    def _set_heat_flux_boundary_expression(self, feature: Any, q0_expr: str) -> None:
        for key in ('HeatFluxType', 'heatFluxType'):
            try:
                feature.set(key, 'GeneralInwardHeatFlux')
            except Exception:
                pass
        feature.set('q0', q0_expr)

    def _apply_solar_heat_flux_v2(
        self,
        shell_environment_faces: Dict[str, Any],
        solar_config: Optional[Dict[str, Any]],
        sample_dir: Path,
    ) -> dict:
        """Apply absorbed solar heat flux to six cabin outer shell faces."""
        solar_config = solar_config or {}
        if not solar_config.get('enabled', False):
            return {
                'enabled': False,
                'applied': 0,
                'skipped': 0,
                'details': [],
                'note': 'solar_heat_flux.enabled is false',
            }

        loaded = self._load_solar_heat_flux_config(solar_config, sample_dir)
        ht = self.model.java.component('comp1').physics('ht')
        ht_tags = {str(t) for t in ht.feature().tags()}
        applied, skipped = 0, 0
        details = []

        for direction, face in shell_environment_faces.get('faces', {}).items():
            sel_tag = face['selection']
            hf_tag = f"solar_hf_{_direction_tag(direction)}"
            incident_w_m2 = float(loaded['faces'][direction])
            try:
                absorptivity = float(face.get('absorptivity', loaded['default_absorptivity']))
                absorbed_w_m2 = absorptivity * incident_w_m2
                q0_expr = f'{absorbed_w_m2:.12g}[W/m^2]'
                load_scale = self._load_scale_parameter_name()
                if load_scale:
                    q0_expr = f'{load_scale}*({q0_expr})'
                entities = self._selection_entity_ids(self.model.java.component('comp1').selection(sel_tag))
                if not entities:
                    raise RuntimeError('shell solar heat flux face selection is empty')
                if hf_tag not in ht_tags:
                    created = False
                    last_error: Optional[Exception] = None
                    for feature_type in ('HeatFluxBoundary', 'HeatFlux'):
                        try:
                            ht.create(hf_tag, feature_type, 2)
                            created = True
                            break
                        except Exception as exc:
                            last_error = exc
                    if not created:
                        raise RuntimeError(f'failed to create COMSOL heat flux feature: {last_error}')
                    ht_tags.add(hf_tag)
                feat = ht.feature(hf_tag)
                feat.label(f'solar heat flux:{direction}')
                feat.selection().named(sel_tag)
                self._set_heat_flux_boundary_expression(feat, q0_expr)
                applied += 1
                details.append({
                    'direction': direction,
                    'selection': sel_tag,
                    'boundary_count': len(entities),
                    'incident_W_m2': incident_w_m2,
                    'absorptivity': absorptivity,
                    'absorbed_W_m2': absorbed_w_m2,
                    'q0_expression': q0_expr,
                    'feature': hf_tag,
                    'ok': True,
                })
                print(f"    ✓ {hf_tag}: q_incident={incident_w_m2:.6g} W/m^2, alpha={absorptivity:.3f}, q0={absorbed_w_m2:.6g} W/m^2")
            except Exception as e:
                skipped += 1
                details.append({'direction': direction, 'selection': sel_tag, 'ok': False, 'note': f'{type(e).__name__}: {e}'})
                print(f"    ✗ {hf_tag} 失败: {type(e).__name__}: {e}")

        return {
            'enabled': True,
            'applied': applied,
            'skipped': skipped,
            'input_json_path': loaded['path'],
            'input_kind': loaded['input_kind'],
            'default_absorptivity': loaded['default_absorptivity'],
            'metadata': loaded['metadata'],
            'details': details,
            'note': 'Incident solar heat flux is multiplied by absorptivity and applied only to the six cabin outer shell faces.',
        }

    def _apply_linearized_shell_environment_heat_flux_v2(
        self,
        shell_environment_faces: Dict[str, Any],
        boundary_conditions: Optional[Dict[str, Any]],
        sample_dir: Path,
    ) -> dict:
        """Apply absorbed solar plus linearized deep-space radiation as Heat Flux features."""
        boundary_conditions = boundary_conditions or {}
        shell_face_bc = boundary_conditions.get('shell_faces', {})
        solar_config = boundary_conditions.get('solar_heat_flux', {})
        emissivity = float(shell_face_bc.get('emissivity', 0.8))
        ambient_temp_k = float(shell_face_bc.get('ambient_temp', 3.0))
        reference_temp_k = float(
            shell_face_bc.get(
                'linearization_temperature',
                shell_face_bc.get('reference_temperature', 300.0),
            )
        )
        if reference_temp_k <= 0.0:
            raise ValueError('shell_faces.linearization_temperature must be > 0 K')

        sigma = 5.670374419e-8
        h_rad = 4.0 * emissivity * sigma * reference_temp_k ** 3
        q_rad_at_ref = emissivity * sigma * (ambient_temp_k ** 4 - reference_temp_k ** 4)
        # q_rad ~= h_rad * (t_eq - T), equivalent to first-order expansion at T_ref.
        t_eq = reference_temp_k + q_rad_at_ref / h_rad if h_rad > 0.0 else ambient_temp_k

        loaded: Optional[Dict[str, Any]] = None
        if solar_config.get('enabled', False):
            loaded = self._load_solar_heat_flux_config(solar_config, sample_dir)

        ht = self.model.java.component('comp1').physics('ht')
        ht_tags = {str(t) for t in ht.feature().tags()}
        applied, skipped = 0, 0
        details = []

        for direction, face in shell_environment_faces.get('faces', {}).items():
            sel_tag = face['selection']
            hf_tag = f"env_hf_{_direction_tag(direction)}"
            incident_w_m2 = float(loaded['faces'][direction]) if loaded else 0.0
            absorptivity = float(face.get('absorptivity', loaded['default_absorptivity'] if loaded else solar_config.get('default_absorptivity', 0.3)))
            absorbed_w_m2 = absorptivity * incident_w_m2
            q0_expr = (
                f'{absorbed_w_m2:.12g}[W/m^2]'
                f' + {h_rad:.12g}[W/(m^2*K)]*({t_eq:.12g}[K]-T)'
            )
            load_scale = self._load_scale_parameter_name()
            if load_scale:
                q0_expr = (
                    f'{load_scale}*({absorbed_w_m2:.12g}[W/m^2])'
                    f' + {h_rad:.12g}[W/(m^2*K)]*({t_eq:.12g}[K]-T)'
                )
            try:
                entities = self._selection_entity_ids(self.model.java.component('comp1').selection(sel_tag))
                if not entities:
                    raise RuntimeError('shell environment heat flux face selection is empty')
                if hf_tag not in ht_tags:
                    created = False
                    last_error: Optional[Exception] = None
                    for feature_type in ('HeatFluxBoundary', 'HeatFlux'):
                        try:
                            ht.create(hf_tag, feature_type, 2)
                            created = True
                            break
                        except Exception as exc:
                            last_error = exc
                    if not created:
                        raise RuntimeError(f'failed to create COMSOL heat flux feature: {last_error}')
                    ht_tags.add(hf_tag)
                feat = ht.feature(hf_tag)
                feat.label(f'linearized shell environment:{direction}')
                feat.selection().named(sel_tag)
                self._set_heat_flux_boundary_expression(feat, q0_expr)
                applied += 1
                details.append({
                    'direction': direction,
                    'selection': sel_tag,
                    'boundary_count': len(entities),
                    'incident_W_m2': incident_w_m2,
                    'absorptivity': absorptivity,
                    'absorbed_W_m2': absorbed_w_m2,
                    'emissivity': emissivity,
                    'ambient_temp_K': ambient_temp_k,
                    'linearization_temperature_K': reference_temp_k,
                    'linearized_radiation_h_W_m2K': h_rad,
                    'linearized_radiation_equivalent_temperature_K': t_eq,
                    'radiation_q_at_reference_W_m2': q_rad_at_ref,
                    'q0_expression': q0_expr,
                    'feature': hf_tag,
                    'ok': True,
                })
                print(f"    ✓ {hf_tag}: q_solar={absorbed_w_m2:.6g} W/m^2, h_rad={h_rad:.6g} W/(m^2*K), Teq={t_eq:.6g} K")
            except Exception as e:
                skipped += 1
                details.append({'direction': direction, 'selection': sel_tag, 'ok': False, 'note': f'{type(e).__name__}: {e}'})
                print(f"    ✗ {hf_tag} 失败: {type(e).__name__}: {e}")

        return {
            'enabled': True,
            'mode': 'linearized_heat_flux',
            'applied': applied,
            'skipped': skipped,
            'input_json_path': loaded['path'] if loaded else '',
            'input_kind': loaded['input_kind'] if loaded else solar_config.get('input_kind', ''),
            'default_absorptivity': loaded['default_absorptivity'] if loaded else solar_config.get('default_absorptivity', 0.3),
            'metadata': loaded['metadata'] if loaded else {},
            'emissivity': emissivity,
            'ambient_temp_K': ambient_temp_k,
            'linearization_temperature_K': reference_temp_k,
            'linearized_radiation_h_W_m2K': h_rad,
            'linearized_radiation_equivalent_temperature_K': t_eq,
            'details': details,
            'note': 'Absorbed solar input and first-order linearized deep-space radiation are applied as Heat Flux features on the six cabin outer shell faces.',
        }

    def _set_thin_layer_conduction(
        self,
        feature: Any,
        thickness_mm: float,
        conductivity_w_mk: float,
        density_kg_m3: float,
        heat_capacity_j_kgk: float,
    ) -> Dict[str, Any]:
        """Best-effort Thin Layer setup across COMSOL versions."""
        attempted: List[Dict[str, Any]] = []

        def set_many(keys: List[str], value: Any) -> None:
            for key in keys:
                try:
                    feature.set(key, value)
                    attempted.append({'key': key, 'value': value, 'ok': True})
                    return
                except Exception as exc:
                    attempted.append({'key': key, 'value': value, 'ok': False, 'error': f'{type(exc).__name__}: {exc}'})

        set_many(['LayerType', 'layerType', 'layertype'], 'Conductive')
        set_many(['ds', 'd', 'thickness', 'Lth'], f'{thickness_mm}[mm]')
        set_many(['ks', 'k', 'k_mat', 'thermalconductivity'], [f'{conductivity_w_mk}[W/(m*K)]'])
        set_many(['rho', 'density'], f'{density_kg_m3}[kg/m^3]')
        set_many(['Cp', 'C', 'heatcapacity'], f'{heat_capacity_j_kgk}[J/(kg*K)]')
        return {'attempted': attempted}

    def _set_thin_layer_resistance(
        self,
        feature: Any,
        resistance_k_m2_w: float,
        equivalent_thickness_mm: float = 1.0,
    ) -> Dict[str, Any]:
        """Represent contact resistance as a conductive thin layer with k=d/R."""
        attempted: List[Dict[str, Any]] = []

        def set_many(keys: List[str], value: Any) -> None:
            for key in keys:
                try:
                    feature.set(key, value)
                    attempted.append({'key': key, 'value': value, 'ok': True})
                    return
                except Exception as exc:
                    attempted.append({'key': key, 'value': value, 'ok': False, 'error': f'{type(exc).__name__}: {exc}'})

        thickness_m = equivalent_thickness_mm * 1e-3
        conductivity = thickness_m / resistance_k_m2_w if resistance_k_m2_w > 0.0 else 0.0
        conductance = 1.0 / resistance_k_m2_w if resistance_k_m2_w > 0.0 else 0.0
        set_many(['LayerType', 'layerType', 'layertype'], 'Conductive')
        set_many(['ds', 'd', 'thickness', 'Lth'], f'{equivalent_thickness_mm}[mm]')
        set_many(['ks', 'k', 'k_mat', 'thermalconductivity'], [f'{conductivity}[W/(m*K)]'])
        return {
            'attempted': attempted,
            'equivalent_thickness_mm': equivalent_thickness_mm,
            'equivalent_thermalconductivity_W_mK': conductivity,
            'equivalent_conductance_W_m2K': conductance,
        }

    def _apply_wall_conduction_v2(
        self,
        cabin_walls: List[Dict[str, Any]],
        boundary_conditions: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Apply boundary Thin Layer conduction for walls modeled as conductive boundaries."""
        from core.selection_updater_v2 import _safe_tag

        wall_cfg = (boundary_conditions or {}).get('wall_conduction', {})
        if wall_cfg.get('enabled', True) is False:
            return {
                'enabled': False,
                'applied': 0,
                'skipped': 0,
                'details': [],
                'note': 'wall_conduction.enabled is false',
            }

        conductivity = float(wall_cfg.get('thermalconductivity', wall_cfg.get('conductivity_W_mK', 167.0)))
        density = float(wall_cfg.get('density', 2700.0))
        heat_capacity = float(wall_cfg.get('heatcapacity', wall_cfg.get('heat_capacity_J_kgK', 896.0)))
        inflate_mm = float(wall_cfg.get('selection_inflate_mm', 0.2))
        comp = self.model.java.component('comp1')
        sel_root = comp.selection()
        ht = comp.physics('ht')
        existing_selections = {str(t) for t in sel_root.tags()}
        existing_features = {str(t) for t in ht.feature().tags()}
        applied, skipped = 0, 0
        details: List[Dict[str, Any]] = []

        for wall in cabin_walls:
            wall_id = str(wall.get('id') or wall.get('wall_id') or wall.get('component_id') or '')
            modeling = str(wall.get('modeling') or wall.get('entity_model') or '').lower()
            if not wall_id or modeling not in {'conductive_boundary', 'boundary'}:
                skipped += 1
                details.append({'wall_id': wall_id, 'ok': False, 'note': f'skipped modeling={modeling!r}'})
                continue

            bbox = wall.get('bbox') if isinstance(wall.get('bbox'), dict) else {}
            bmin = bbox.get('min') if isinstance(bbox.get('min'), list) else None
            bmax = bbox.get('max') if isinstance(bbox.get('max'), list) else None
            thickness = wall.get('thickness_mm', wall.get('thickness'))
            if not (isinstance(bmin, list) and isinstance(bmax, list) and len(bmin) == 3 and len(bmax) == 3 and thickness):
                skipped += 1
                details.append({'wall_id': wall_id, 'ok': False, 'note': 'missing bbox or thickness'})
                continue

            tag_suffix = _safe_tag(wall_id)
            sel_tag = f"sel_w_{tag_suffix}"
            thin_tag = f"thin_wall_{tag_suffix}"
            bmin_f = [float(v) - inflate_mm for v in bmin]
            bmax_f = [float(v) + inflate_mm for v in bmax]
            thickness_mm = float(thickness)
            wall_conductivity = float(wall.get('thermalconductivity', wall.get('conductivity_W_mK', conductivity)))
            wall_density = float(wall.get('density', density))
            wall_heat_capacity = float(wall.get('heatcapacity', wall.get('heat_capacity_J_kgK', heat_capacity)))
            try:
                if sel_tag not in existing_selections:
                    sel_root.create(sel_tag, 'Box')
                    existing_selections.add(sel_tag)
                selection = comp.selection(sel_tag)
                selection.label(f'wall-boundary:{wall_id}')
                selection.set('entitydim', '2')
                selection.set('condition', 'allvertices')
                selection.set('xmin', f'{bmin_f[0]}[mm]')
                selection.set('xmax', f'{bmax_f[0]}[mm]')
                selection.set('ymin', f'{bmin_f[1]}[mm]')
                selection.set('ymax', f'{bmax_f[1]}[mm]')
                selection.set('zmin', f'{bmin_f[2]}[mm]')
                selection.set('zmax', f'{bmax_f[2]}[mm]')
                entities = self._selection_entity_ids(selection)
                if not entities:
                    raise RuntimeError('wall boundary selection is empty')

                if thin_tag not in existing_features:
                    ht.create(thin_tag, 'ThinLayer', 2)
                    existing_features.add(thin_tag)
                feature = ht.feature(thin_tag)
                feature.label(f'thin wall conduction:{wall_id}')
                feature.selection().named(sel_tag)
                property_result = self._set_thin_layer_conduction(
                    feature,
                    thickness_mm,
                    wall_conductivity,
                    wall_density,
                    wall_heat_capacity,
                )
                applied += 1
                details.append({
                    'wall_id': wall_id,
                    'selection': sel_tag,
                    'feature': thin_tag,
                    'feature_type': 'ThinLayer',
                    'boundary_count': len(entities),
                    'boundary_ids': entities,
                    'thickness_mm': thickness_mm,
                    'material_id': wall.get('material_id', 'aluminum_6061'),
                    'thermalconductivity_W_mK': wall_conductivity,
                    'surface_conductance_W_m2K': wall_conductivity / (thickness_mm / 1000.0),
                    'density_kg_m3': wall_density,
                    'heatcapacity_J_kgK': wall_heat_capacity,
                    'property_setup': property_result,
                    'ok': True,
                })
                print(f"    ✓ {thin_tag}: wall={wall_id}, boundary_count={len(entities)}, k={wall_conductivity:g} W/(m*K), d={thickness_mm:g} mm")
            except Exception as exc:
                skipped += 1
                details.append({
                    'wall_id': wall_id,
                    'selection': sel_tag,
                    'feature': thin_tag,
                    'ok': False,
                    'note': f'{type(exc).__name__}: {exc}',
                })
                print(f"    ✗ {thin_tag} 失败: {type(exc).__name__}: {exc}")

        return {
            'enabled': True,
            'applied': applied,
            'skipped': skipped,
            'thermalconductivity_W_mK': conductivity,
            'density_kg_m3': density,
            'heatcapacity_J_kgK': heat_capacity,
            'details': details,
            'note': 'Conductive-boundary walls are represented by COMSOL ThinLayer boundary features.',
        }

    def _set_surface_to_ambient_radiation(self, feature: Any, emissivity: float, ambient_temp_k: float) -> None:
        """Set SurfaceToAmbientRadiation to explicit emissivity instead of material lookup."""
        for source_key in ('epsilon_rad_mat', 'epsilon_mat'):
            try:
                feature.set(source_key, 'userdef')
            except Exception:
                pass
        feature.set('epsilon_rad', str(emissivity))
        feature.set('Tamb', f'{ambient_temp_k}[K]')

    def _set_heat_transfer_initial_temperature_v2(
        self,
        boundary_conditions: Optional[Dict[str, Any]] = None,
    ) -> dict:
        initial_temp_cfg = (boundary_conditions or {}).get('initial_temperature', {})
        initial_temp_k = float(initial_temp_cfg.get('temperature', 100.0))
        ht = self.model.java.component('comp1').physics('ht')
        try:
            init = ht.feature('init1')
            init.set('Tinit', f'{initial_temp_k}[K]')
            print(f"  [v2] heat transfer initial temperature: Tinit={initial_temp_k}K")
            return {'ok': True, 'initial_temp_K': initial_temp_k, 'feature': 'init1'}
        except Exception as e:
            print(f"  [v2] heat transfer initial temperature failed: {type(e).__name__}: {e}")
            return {'ok': False, 'initial_temp_K': initial_temp_k, 'feature': 'init1', 'error': f'{type(e).__name__}: {e}'}

    def _ensure_v2_fallback_material(self) -> dict:
        """Ensure imported v2 domains have finite thermal material properties."""
        comp = self.model.java.component('comp1')
        materials = comp.material()
        tag = 'mat_v2_fallback'
        try:
            existing = {str(t) for t in materials.tags()}
            if tag not in existing:
                materials.create(tag, 'Common')
            mat = comp.material(tag)
            mat.label('v2 fallback aluminum thermal material')
            mat.selection().all()
            pg = mat.propertyGroup('def')
            pg.set('thermalconductivity', ['167[W/(m*K)]'])
            pg.set('density', '2700[kg/m^3]')
            pg.set('heatcapacity', '896[J/(kg*K)]')
            print("  [v2] fallback material applied to all domains")
            return {
                'ok': True,
                'tag': tag,
                'selection': 'all domains',
                'thermalconductivity': '167[W/(m*K)]',
                'density': '2700[kg/m^3]',
                'heatcapacity': '896[J/(kg*K)]',
            }
        except Exception as e:
            print(f"  [v2] fallback material failed: {type(e).__name__}: {e}")
            return {'ok': False, 'tag': tag, 'error': f'{type(e).__name__}: {e}'}

    def _apply_contact_resistance_v2(
        self,
        components_data: list,
        install_faces: dict,
        outer_shell: Optional[Dict[str, Any]] = None,
        boundary_conditions: Optional[Dict[str, Any]] = None,
    ) -> dict:
        """为每个 v2 组件添加组件底面热接触.

        舱板安装侧在 STEP 导入后的几何实体层面通常仍是一张大面，不能通过
        Selection Difference 切出每个组件的局部补丁面。因此这里创建手工
        Identity pair: source=舱板整张安装面, destination=组件安装面；
        PairThermalContact 再显式绑定这些 pair。
        """
        from core.selection_updater_v2 import _safe_tag

        ht = self.model.java.component('comp1').physics('ht')
        comp_sel_root = self.model.java.component('comp1').selection()
        applied, skipped = 0, 0
        details = []
        contact_pairs: List[str] = []
        contact_cfg = (boundary_conditions or {}).get('contact_resistance', {})
        contact_mode = str(contact_cfg.get('mode', 'identity_pair')).lower()
        use_shared_boundary = contact_mode in {
            'shared_boundary',
            'shared_boundary_thin_layer',
            'internal_boundary',
            'thin_layer',
        }
        shell_boundary = self._build_non_component_boundary_selection(components_data, outer_shell)
        shell_boundary_sel_tag = shell_boundary['boundary_selection']

        for comp in components_data:
            name = comp['name']
            safe_name = _safe_tag(name)
            record: Dict[str, Any] = {
                'name': name,
                'R': None,
                'ok': False,
                'note': 'not processed',
            }

            try:
                ti = comp.get('thermal_interface', {})
                R_raw = ti.get('contact_resistance')
                record['R'] = R_raw
                R = float(R_raw) if R_raw is not None else None
            except (TypeError, ValueError):
                R = None
            mount_face_id = comp.get('mount_face_id')
            component_mount_face = comp.get('component_mount_face')
            pos_mm = comp.get('pos_mm')
            dims_mm = comp.get('dims_mm')
            mount_face = install_faces.get(mount_face_id) if mount_face_id else None

            if R is None or R <= 0 or not mount_face_id or not pos_mm or not dims_mm or not mount_face:
                record['note'] = 'skipped: R<=0 or missing mount_face_id/install_face/bbox'
                details.append(record)
                continue

            face_sel_tag = f"sel_f_{_safe_tag(mount_face_id)}"
            comp_mount_bnd_sel_tag = self._build_component_mount_boundary_selection(
                name, pos_mm, dims_mm, mount_face, component_mount_face
            )
            pair_tag = f"pair_{safe_name}"
            adj_tag = f"adj_{safe_name}"

            try:
                existing_tags = {str(t) for t in comp_sel_root.tags()}
                if adj_tag not in existing_tags:
                    comp_sel_root.create(adj_tag, 'Intersection')
                adj_sel = self.model.java.component('comp1').selection(adj_tag)
                adj_sel.label(f"adj:{name}")
                adj_sel.set('entitydim', '2')
                adj_sel.set('input', [comp_mount_bnd_sel_tag, face_sel_tag])
                adj_entities = self._selection_entity_ids(adj_sel)

                comp_mount_entities = self._selection_entity_ids(
                    self.model.java.component('comp1').selection(comp_mount_bnd_sel_tag)
                )
                plate_face_entities = self._selection_entity_ids(
                    self.model.java.component('comp1').selection(face_sel_tag)
                )
                if not comp_mount_entities or not plate_face_entities:
                    raise RuntimeError('contact pair source/destination selection is empty')
                overlap_entities = sorted(set(plate_face_entities) & set(comp_mount_entities))
                source_destination_same = sorted(plate_face_entities) == sorted(comp_mount_entities)

                if use_shared_boundary and overlap_entities:
                    contact_tag = f"thin_contact_{safe_name}"
                    if contact_tag not in ht.feature().tags():
                        ht.create(contact_tag, 'ThinLayer', 2)
                    contact = ht.feature(contact_tag)
                    contact.label(f'thin contact:{name}')
                    contact_entities = overlap_entities
                    contact.selection().set(contact_entities)
                    property_result = self._set_thin_layer_resistance(contact, R)

                    record['ok'] = True
                    record['selection'] = adj_tag
                    record['pair'] = None
                    record['pair_type'] = None
                    record['contact_mode'] = 'shared_boundary_thin_layer'
                    record['source_selection'] = face_sel_tag
                    record['global_shell_boundary_selection'] = shell_boundary_sel_tag
                    record['raw_plate_selection'] = face_sel_tag
                    record['destination_selection'] = comp_mount_bnd_sel_tag
                    record['source_boundary_count'] = len(plate_face_entities)
                    record['destination_boundary_count'] = len(comp_mount_entities)
                    record['source_boundary_ids'] = plate_face_entities
                    record['destination_boundary_ids'] = comp_mount_entities
                    record['source_destination_overlap_ids'] = overlap_entities
                    record['source_destination_same_entities'] = source_destination_same
                    record['feature'] = contact_tag
                    record['feature_type'] = 'ThinLayer'
                    record['boundary_count'] = len(contact_entities)
                    record['pair_selection'] = None
                    record['Req'] = R
                    record['layer_conductance_W_m2K'] = 1.0 / R
                    record['property_setup'] = property_result
                    record['note'] = (
                        f'Equivalent ThinLayer contact; '
                        f'Req={R:.4g} K*m^2/W'
                    )
                    applied += 1
                    print(f"    ✓ {name}: ThinLayer {contact_tag}: boundaries={contact_entities}")
                    details.append(record)
                    continue

                pair_root = self.model.java.component('comp1').pair()
                pair_tags = {str(t) for t in pair_root.tags()}
                if pair_tag not in pair_tags:
                    pair_root.create(pair_tag, 'Identity', 'geom1')
                pair = self.model.java.component('comp1').pair(pair_tag)
                pair.label(f'pair:{name}')
                pair.source().named(face_sel_tag)
                pair.destination().named(comp_mount_bnd_sel_tag)
                try:
                    pair.searchMethod('direct')
                except Exception:
                    pass
                try:
                    pair.manualDist(True)
                    pair.searchDist('10[mm]')
                except Exception:
                    pass

                record['ok'] = True
                record['selection'] = adj_tag
                record['pair'] = pair_tag
                record['pair_type'] = 'Identity'
                record['contact_mode'] = 'identity_pair_shell_boundary_source'
                record['source_selection'] = face_sel_tag
                record['global_shell_boundary_selection'] = shell_boundary_sel_tag
                record['raw_plate_selection'] = face_sel_tag
                record['destination_selection'] = comp_mount_bnd_sel_tag
                record['source_boundary_count'] = len(plate_face_entities)
                record['destination_boundary_count'] = len(comp_mount_entities)
                record['source_boundary_ids'] = plate_face_entities
                record['destination_boundary_ids'] = comp_mount_entities
                record['source_destination_overlap_ids'] = overlap_entities
                record['source_destination_same_entities'] = source_destination_same
                record['feature'] = None
                record['feature_type'] = None
                record['boundary_count'] = len(adj_entities)
                record['pair_selection'] = None
                record['layer_conductance_W_m2K'] = 1.0 / R
                record['note'] = (
                    f'Identity pair created; shared PairThermalContact '
                    f'Req={R:.4g} K·m²/W'
                )
                applied += 1
                contact_pairs.append(pair_tag)
                print(f"    ✓ {name}: IdentityPair {pair_tag}: {face_sel_tag} -> {comp_mount_bnd_sel_tag}")

            except Exception as e:
                record['note'] = f'skipped: {type(e).__name__}: {e}'
                print(f"    ✗ {name}: contact R 失败 ({type(e).__name__}): {e}")

            details.append(record)

        applied = sum(1 for record in details if record.get('ok'))
        skipped = len(details) - applied
        shared_contact: Dict[str, Any] = {
            'ok': False,
            'feature': 'tc_all_contact_pairs',
            'feature_type': 'PairThermalContact',
            'pair_selection': 'list',
            'pair_count': len(contact_pairs),
            'pairs': contact_pairs,
        }
        if contact_pairs:
            try:
                contact_tag = 'tc_all_contact_pairs'
                ht_tags = {str(t) for t in ht.feature().tags()}
                if contact_tag not in ht_tags:
                    ht.create(contact_tag, 'PairThermalContact', 2)
                contact = ht.feature(contact_tag)
                contact.label('tc:all_contact_pairs')
                contact.set('pairSelection', 'list')
                contact.set('pairs', contact_pairs)
                contact.set('ContactModel', 'EquThinLayer')
                req_values = sorted({
                    float(record['R'])
                    for record in details
                    if record.get('ok') and record.get('R') is not None
                })
                if len(req_values) == 1:
                    req = req_values[0]
                    heq = 1.0 / req
                    contact.set('Req', f'{req}[K*m^2/W]')
                    shared_contact['Req'] = req
                    shared_contact['heq_W_m2K'] = heq
                    shared_contact['ok'] = True
                    shared_contact['note'] = (
                        f'One PairThermalContact applied to listed Identity pairs, '
                        f'Req={req:.4g} K·m²/W'
                    )
                    for record in details:
                        if record.get('ok'):
                            record['feature'] = contact_tag
                            record['feature_type'] = 'PairThermalContact'
                            record['pair_selection'] = 'list'
                else:
                    shared_contact['note'] = f'skipped: contact pairs have nonuniform Req values: {req_values}'
            except Exception as e:
                shared_contact['note'] = f'failed: {type(e).__name__}: {e}'

        mode_counts: Dict[str, int] = {}
        for record in details:
            mode = str(record.get('contact_mode') or 'skipped')
            mode_counts[mode] = mode_counts.get(mode, 0) + 1
        print(f"  [v2] 接触热阻: applied={applied}, skipped={skipped}")
        return {
            'applied': applied,
            'skipped': skipped,
            'mode_counts': mode_counts,
            'shared_pair_thermal_contact': shared_contact,
            'shell_boundary_source': shell_boundary,
            'details': details,
        }

    def _clear_existing_heat_sources(self) -> int:
        ht = self.model.java.component('comp1').physics('ht')
        removed_count = 0
        for tag in list(ht.feature().tags()):
            tag_str = str(tag)
            if self._is_generated_heat_source_tag(tag_str):
                ht.feature().remove(tag)
                removed_count += 1
        return removed_count

    def _solve_model(self) -> None:
        self.model.solve()

    def _export_data_with_coords(self, export_tag: str, output_path: Path, coord_path: Optional[Path]) -> bool:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        export_node = self.model.java.result().export(export_tag)
        export_node.set('filename', str(output_path))
        if coord_path is not None:
            export_node.set('coordfilename', str(coord_path))
        export_node.run()
        return output_path.exists() and output_path.stat().st_size > 0

    def _export_vtu_with_fallback(self, export_tag: str, fallback_export_tag: str, output_path: Path) -> bool:
        """[DEPRECATED] 旧路径: 复制 Data 节点 + 改 .vtu 扩展, 实际产物是 sectionwise 文本.
        保留以兼容旧配置; 真正的 VTU 走 _export_native_vtu_via_plot()。
        """
        output_path.parent.mkdir(parents=True, exist_ok=True)
        exports = self.model.java.result().export()
        export_tags = {str(tag) for tag in exports.tags()}
        active_tag = export_tag
        if export_tag not in export_tags:
            exports.copy(export_tag, fallback_export_tag)
        export_node = self.model.java.result().export(active_tag)
        export_node.set('filename', str(output_path))
        try:
            export_node.set('coordfilename', '')
        except Exception:
            pass
        try:
            export_node.set('struct', 'sectionwise')
        except Exception:
            pass
        export_node.run()
        return output_path.exists() and output_path.stat().st_size > 0

    def _export_native_vtu_via_plot(self, output_path: Path, plotgroup_tag: Optional[str] = None) -> Dict[str, Any]:
        """通过 Plot 节点产生真 ParaView VTU (XML, UnstructuredGrid + 真 tet mesh).

        已验证路径: model.result().export().create(tag, 'Plot')
        + set('plotgroup', pg) + set('filename', *.vtu) + run() 直接写出 VTU XML.

        Args:
            output_path: 目标 .vtu 路径
            plotgroup_tag: 用哪个 3D PlotGroup 作为数据源 (默认自动选第一个 3D 组)

        Returns: {ok, path, plotgroup, size_bytes, num_points?, num_cells?}
        """
        output_path.parent.mkdir(parents=True, exist_ok=True)
        result = {'ok': False, 'path': str(output_path)}

        # 自动选 plotgroup
        if plotgroup_tag is None:
            try:
                pg_tags = [str(t) for t in self.model.java.result().tags()]
                if not pg_tags:
                    result['error'] = '模板无 PlotGroup, 无法导出 VTU'
                    return result
                plotgroup_tag = pg_tags[0]
            except Exception as e:
                result['error'] = f'枚举 plot groups 失败: {e}'
                return result
        result['plotgroup'] = plotgroup_tag

        # 创建临时 Plot export 节点 (run 后即删, 不污染模板)
        export_tag = f'_native_vtu_{int(time.time() * 1000)}'
        exports = self.model.java.result().export()
        try:
            exports.create(export_tag, 'Plot')
            node = self.model.java.result().export(export_tag)
            node.set('plotgroup', plotgroup_tag)
            node.set('filename', str(output_path))
            node.run()
        except Exception as e:
            result['error'] = f'Plot export 失败: {e}'
            try:
                exports.remove(export_tag)
            except Exception:
                pass
            return result

        # 清理临时节点
        try:
            exports.remove(export_tag)
        except Exception:
            pass

        if output_path.exists() and output_path.stat().st_size > 0:
            result['ok'] = True
            result['size_bytes'] = output_path.stat().st_size
            # 读 XML 头确认格式 + 解析点/单元数
            try:
                with open(output_path, 'rb') as f:
                    head = f.read(500).decode('utf-8', errors='replace')
                import re as _re
                m = _re.search(r'NumberOfPoints="(\d+)"\s+NumberOfCells="(\d+)"', head)
                if m:
                    result['num_points'] = int(m.group(1))
                    result['num_cells'] = int(m.group(2))
                result['is_vtu_xml'] = head.startswith('<?xml') and 'VTKFile' in head
            except Exception:
                pass
        else:
            result['error'] = 'VTU 文件未生成或为空'
        return result

    def _export_cubesat_outputs(self, sim_dir: Path, coord_txt: Path, export_tags: List[str], export_volum_tags: List[str]) -> Dict[str, Any]:
        txt_files = []
        for export_tag in export_tags:
            output_filename = f'{export_tag}.txt'
            output_path = sim_dir / output_filename
            coord_path = coord_txt if coord_txt.exists() else None
            if self._export_data_with_coords(export_tag, output_path, coord_path):
                txt_files.append(output_filename)

        vtu_files = []
        vtu_details = []
        fallback_export_tag = export_tags[0] if export_tags else 'data1'
        for i, export_tag in enumerate(export_volum_tags):
            output_filename = f'volum_{i}_result.vtu'
            output_path = sim_dir / output_filename
            if self._export_vtu_with_fallback(export_tag, fallback_export_tag, output_path):
                vtu_files.append(output_filename)

        # 原生 VTU (Plot 节点 + filename=*.vtu, COMSOL tet mesh + UnstructuredGrid XML)
        # 与 export_volum_tags 解耦: 只要模板有 3D PlotGroup 就能产出
        native_vtu_path = sim_dir / 'native_volum_data.vtu'
        native_result = self._export_native_vtu_via_plot(native_vtu_path)
        vtu_details.append(native_result)
        if native_result.get('ok'):
            vtu_files.append(native_vtu_path.name)

        exported_files = txt_files + vtu_files
        return {
            'files': exported_files,
            'txt_files': txt_files,
            'vtu_files': vtu_files,
            'vtu_details': vtu_details,
            'count': len(exported_files),
        }

    def _postprocess_temperature_field(self, sim_dir: Path, postprocess_config: Dict[str, Any]) -> List[str]:
        tensors_dir = sim_dir / 'tensors'
        tensors_dir.mkdir(exist_ok=True)
        manifest_path = tensors_dir / 'postprocess_manifest.json'
        manifest = {
            'grid_shape': postprocess_config.get('grid_shape', [64, 64, 64]),
            'status': 'skipped_remote_stub',
        }
        atomic_write_json(manifest, manifest_path)
        return [str(manifest_path)]

    def _run_cubesat_for_one_sample(self, sample_dir: Path, template_mph: Path, config: Config, export_tags: List[str], export_volum_tags: List[str], postprocess: Dict[str, Any], mesh_config: Dict[str, Any], boundary_conditions: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        sample_id = sample_dir.name
        status = {'sample_id': sample_id, 'stage': 'init', 'ok': False, 'checks': {}}
        sim_dir = sample_dir / 'sim'
        sim_dir.mkdir(parents=True, exist_ok=True)
        work_mph = sim_dir / 'work.mph'
        status_json = sim_dir / 'status.json'
        progress_json = sim_dir / 'comsol_progress.json'
        progress_by_stage = {
            'init': 0.0,
            'prepare_mph': 5.0,
            'update_geometry': 15.0,
            'cleanup_template': 25.0,
            'update_selections': 35.0,
            'update_sources': 45.0,
            'apply_environment_bc': 52.0,
            'apply_contact_resistance': 58.0,
            'prepare_mesh': 65.0,
            'solve': 80.0,
            'export': 92.0,
            'postprocess': 97.0,
            'completed': 100.0,
        }

        def set_stage(stage: str) -> None:
            heartbeat_at = time.strftime('%Y-%m-%d %H:%M:%S')
            status['stage'] = stage
            status['progress_percent'] = progress_by_stage.get(stage, status.get('progress_percent', 0.0))
            status['heartbeat_at'] = heartbeat_at
            self._write_sample_status(status_json, status)
            self._write_sample_status(
                progress_json,
                {
                    'sample_id': sample_id,
                    'stage': stage,
                    'percent': status['progress_percent'],
                    'ok': status.get('ok', False),
                    'heartbeat_at': heartbeat_at,
                },
            )

        try:
            set_stage('prepare_mph')
            if not copy_mph_template(template_mph, work_mph):
                raise RuntimeError('mph复制失败')
            self.load_model(str(work_mph))

            sample_yaml = sample_dir / 'sample.yaml'
            schema_version = detect_schema_version(sample_yaml)
            status['schema_version'] = schema_version

            set_stage('update_geometry')
            geom_file = sample_dir / 'geom' / 'geometry.step'
            updater = GeometryUpdater(config)
            updater.set_model(self.model)
            if not updater.update_geometry_import(
                str(geom_file),
                config.geometry.component,
                config.geometry.geometry,
                config.geometry.import_feature,
                form_assembly=schema_version.startswith('2'),
            ):
                raise RuntimeError('几何更新失败')

            checker = RunChecks(self.model)
            geom_check = checker.validate_geometry(str(geom_file))
            status['checks']['geometry'] = geom_check
            if not geom_check['ok']:
                raise RuntimeError(f"几何检查失败: {geom_check['message']}")

            geom_json = sample_dir / 'geom' / 'geom.json'
            self._write_sample_status(status_json, status)

            set_stage('cleanup_template')
            cleanup_result = self._cleanup_generated_runtime_nodes()
            status['checks']['cleanup'] = cleanup_result
            self._write_sample_status(status_json, status)

            set_stage('update_selections')

            if schema_version.startswith('2'):
                # ---- v2 分派 ----
                meta_v2 = load_layout_meta_v2(sample_yaml)
                shell_box = meta_v2['shell_box']
                components = meta_v2['components']

                sel_updater = SelectionUpdaterV2(self.model)
                comp_sel_result = sel_updater.create_component_box_selections(components)
                face_sel_result = sel_updater.create_install_face_selections(
                    meta_v2['install_faces'], eps_mm=1.0, outer_shell=meta_v2.get('outer_shell'),
                )
                wall_sel_result = sel_updater.create_wall_box_selections(
                    meta_v2['cabin_walls'], inflate_mm=0.2,
                )
                cabin_sel_result = sel_updater.create_cabin_volume_selections(
                    meta_v2['cabins'], shrink_mm=0.5,
                )

                expected_tags = (
                    [c['name'] for c in components]
                    + wall_sel_result['tags']
                )
                sel_check = checker.validate_selections(expected_tags)
                empty_tags = set(sel_check.get('details', {}).get('empty') or [])
                zero_power_component_tags = {
                    c['name']
                    for c in components
                    if float(c.get('power_W') or 0.0) == 0.0
                }
                zero_power_empty_tags = sorted(empty_tags & zero_power_component_tags)
                if zero_power_empty_tags and empty_tags == set(zero_power_empty_tags):
                    sel_check = {
                        **sel_check,
                        'ok': True,
                        'message': (
                            sel_check.get('message', '')
                            + '; zero-power empty component selections treated as optional'
                        ),
                        'warnings': [
                            *list(sel_check.get('warnings') or []),
                            {
                                'type': 'zero_power_empty_component_selections',
                                'tags': zero_power_empty_tags,
                                'note': 'STEP import may merge or drop very small zero-power components; they are excluded from heat sources.',
                            },
                        ],
                    }
                status['checks']['selections'] = {
                    'selection_create': {
                        'components': comp_sel_result,
                        'install_faces': face_sel_result,
                        'cabin_walls': wall_sel_result,
                        'cabins': cabin_sel_result,
                    },
                    'validation_scope': {
                        'required_tags': expected_tags,
                        'optional_tags': cabin_sel_result['tags'],
                        'note': 'cabin volume selections stay optional until the STEP contains explicit cabin air domains',
                    },
                    'validation': sel_check,
                }
                status['checks']['wall_modeling'] = {
                    'mode': 'solid' if wall_sel_result.get('created', 0) else 'conductive_boundary',
                    'wall_count': len(meta_v2.get('cabin_walls') or []),
                    'solid_selection_count': wall_sel_result.get('created', 0),
                    'solid_selection_tags': wall_sel_result.get('tags', []),
                    'boundary_mode_count': wall_sel_result.get('boundary_mode_count', 0),
                    'boundary_mode_tags': wall_sel_result.get('boundary_mode_tags', []),
                    'note': 'Solid-mode walls are imported STEP domains and use the normal material path; boundary-mode walls use ThinLayer features.',
                }
            else:
                # ---- v1 原路径 ----
                shell_box, components = load_layout_meta(geom_json, sample_yaml)
                sel_updater = SelectionUpdater(self.model)
                comp_sel_result = sel_updater.create_component_box_selections(components)
                shell_sel_result = sel_updater.create_shell_face_selections(shell_box, eps_mm=1.0)
                all_sel_result = sel_updater.create_all_components_selection(shell_box, margin_mm=2.0)

                expected_tags = [c['name'] for c in components] + shell_sel_result['tags']
                if all_sel_result['created']:
                    expected_tags.append('ALL')
                sel_check = checker.validate_selections(expected_tags)
                status['checks']['selections'] = {
                    'selection_create': {
                        'components': comp_sel_result,
                        'shell': shell_sel_result,
                        'all': all_sel_result,
                    },
                    'validation': sel_check,
                }
            if not sel_check['ok']:
                raise RuntimeError(f"Selection检查失败: {sel_check['message']}")

            if schema_version.startswith('2'):
                solver_parameter_result = self._ensure_solver_parameters()
                status['checks']['solver_parameters'] = solver_parameter_result
                self._write_sample_status(status_json, status)
                material_result = self._ensure_v2_fallback_material()
                status['checks']['materials'] = material_result
                self._write_sample_status(status_json, status)
                if not material_result['ok']:
                    raise RuntimeError(f"材料设置失败: {material_result.get('error')}")
                boundary_walls = [
                    wall for wall in (meta_v2.get('cabin_walls') or [])
                    if str(wall.get('modeling') or wall.get('entity_model') or '').lower() in {
                        'conductive_boundary',
                        'boundary',
                    }
                ]
                wall_conduction_result = self._apply_wall_conduction_v2(
                    boundary_walls,
                    boundary_conditions,
                )
                status['checks']['wall_conduction'] = wall_conduction_result
                self._write_sample_status(status_json, status)
                if wall_conduction_result.get('enabled') and wall_conduction_result.get('skipped', 0):
                    raise RuntimeError(f"边界导热设置失败: {wall_conduction_result}")

            set_stage('update_sources')
            removed_count = self._clear_existing_heat_sources()
            # radiator (kind="radiator") 功率=0, 由 SurfaceToAmbient BC 处理, 不作为热源
            heat_source_comps = [
                c for c in components
                if c.get('kind') != 'radiator'
                and float(c.get('power_W') or 0.0) != 0.0
            ]
            heat_sources = [
                self._create_heat_source(comp['name'], comp['power_W'], comp['dims_mm'])
                for comp in heat_source_comps
            ]
            hs_check = checker.validate_heat_sources([hs['tag'] for hs in heat_sources])
            status['checks']['heat_sources'] = {
                'removed_existing': removed_count,
                'created': heat_sources,
                'validation': hs_check,
            }
            if not hs_check['ok']:
                raise RuntimeError(f"热源检查失败: {hs_check['message']}")

            # v2: 散热面 SurfaceToAmbient BC + 组件级接触热阻
            if schema_version.startswith('2'):
                set_stage('apply_environment_bc')
                status['checks']['radiators'] = {
                    'applied': 0,
                    'skipped': 0,
                    'details': [],
                    'note': 'external/radiator component environment boundaries are disabled; only the six cabin shell faces receive external heat environment BCs',
                }
                shell_boundary_result = self._build_non_component_boundary_selection(
                    meta_v2['components'], meta_v2.get('outer_shell')
                )
                shell_environment_faces = self._build_shell_environment_face_selections(
                    meta_v2.get('outer_shell'),
                    shell_boundary_result.get('boundary_selection'),
                    eps_mm=1.0,
                )
                status['checks']['shell_environment_faces'] = shell_environment_faces
                shell_face_bc = (boundary_conditions or {}).get('shell_faces', {})
                env_mode = str(shell_face_bc.get('type', 'radiation')).lower()
                if env_mode in {'linearized_heat_flux', 'linearized_net_heat_flux', 'net_heat_flux_linearized'}:
                    env_hf_result = self._apply_linearized_shell_environment_heat_flux_v2(
                        shell_environment_faces,
                        boundary_conditions,
                        sample_dir,
                    )
                    status['checks']['shell_radiation'] = {
                        'applied': 0,
                        'skipped': 6,
                        'details': [],
                        'note': 'SurfaceToAmbientRadiation skipped because shell_faces.type uses linearized Heat Flux.',
                    }
                    status['checks']['solar_heat_flux'] = {
                        'enabled': bool((boundary_conditions or {}).get('solar_heat_flux', {}).get('enabled', False)),
                        'applied': 0,
                        'skipped': 6,
                        'details': [],
                        'note': 'Standalone solar Heat Flux skipped because solar input is included in shell_environment_heat_flux.',
                    }
                    status['checks']['shell_environment_heat_flux'] = env_hf_result
                else:
                    shell_rad_result = self._apply_shell_surface_to_ambient_v2(
                        shell_environment_faces, boundary_conditions
                    )
                    status['checks']['shell_radiation'] = shell_rad_result
                    solar_result = self._apply_solar_heat_flux_v2(
                        shell_environment_faces,
                        (boundary_conditions or {}).get('solar_heat_flux', {}),
                        sample_dir,
                    )
                    status['checks']['solar_heat_flux'] = solar_result
                self._write_sample_status(status_json, status)
                set_stage('apply_contact_resistance')
                cr_result = self._apply_contact_resistance_v2(
                    meta_v2['components'],
                    meta_v2['install_faces'],
                    meta_v2.get('outer_shell'),
                    boundary_conditions,
                )
                status['checks']['contact_resistance'] = cr_result
                init_result = self._set_heat_transfer_initial_temperature_v2(boundary_conditions)
                status['checks']['initial_temperature'] = init_result
                self._write_sample_status(status_json, status)

            if schema_version.startswith('2'):
                set_stage('prepare_mesh')
                mesh_mode2 = mesh_config.get('mesh_mode2') or {}
                if mesh_mode2.get('enabled'):
                    mesh_result = self._prepare_mesh_mode2_for_v2(components, mesh_config)
                    if not mesh_result.get('ok') and mesh_mode2.get('fallback_to_freetet', True):
                        mesh_result['fallback'] = self._prepare_mesh_for_v2(
                            hauto=int(mesh_config.get('v2_hauto', 3))
                        )
                else:
                    mesh_result = self._prepare_mesh_for_v2(
                        hauto=int(mesh_config.get('v2_hauto', 3))
                    )
                status['checks']['mesh_switch'] = mesh_result
                self._write_sample_status(status_json, status)
                self._save_model_snapshot(work_mph, status, 'pre_solve')

            set_stage('solve')
            heartbeat_stop, heartbeat_thread = self._start_status_heartbeat(
                status_json,
                progress_json,
                status,
                sample_id=sample_id,
                stage='solve',
                percent=progress_by_stage['solve'],
            )
            try:
                self._solve_model()
            finally:
                heartbeat_stop.set()
                heartbeat_thread.join(timeout=2.0)

            set_stage('export')
            coord_txt = sample_dir / 'inputs' / 'coord.txt'
            export_result = self._export_cubesat_outputs(sim_dir, coord_txt, export_tags, export_volum_tags)
            export_check = checker.validate_exports(sim_dir, export_result['files'])
            status['checks']['exports'] = {
                'export': export_result,
                'validation': export_check,
            }
            if not export_check['ok']:
                raise RuntimeError(f"导出检查失败: {export_check['message']}")

            set_stage('postprocess')
            postprocess_files = self._postprocess_temperature_field(sim_dir, postprocess)
            status['checks']['postprocess'] = {
                'files': postprocess_files,
            }

            status['ok'] = True
            self._save_model_snapshot(work_mph, status, 'completed')
            status.setdefault('artifacts', {})['work_mph'] = str(work_mph)
            set_stage('completed')
            self.model = None
            time.sleep(1.0)
        except Exception as e:
            status['ok'] = False
            status['error'] = str(e)
            self._save_model_snapshot(work_mph, status, f"error:{status.get('stage', 'unknown')}")
        finally:
            atomic_write_json(status, status_json)

        return status

    def _run_cubesat_for_samples(self, sample_dirs: List[Path]) -> Dict[str, Any]:
        config = Config()
        geometry_payload = self.payload.get('geometry', {})
        config.geometry.enable_geometry_update = geometry_payload.get('enable_geometry_update', False)
        config.geometry.component = geometry_payload.get('component', config.geometry.component)
        config.geometry.geometry = geometry_payload.get('geometry', config.geometry.geometry)
        config.geometry.import_feature = geometry_payload.get('import_feature', config.geometry.import_feature)

        extra = self.payload.get('extra', {})
        export_tags = extra.get('export_tags', [])
        export_volum_tags = self.payload.get('comsol', {}).get('export_volum_tags', [])
        postprocess = extra.get('postprocess', {})
        mesh_config = extra.get('mesh', {})
        boundary_conditions = extra.get('boundary_conditions', {})
        template_mph = Path(self.payload['template_mph_path'])

        sample_results = []
        failed_samples = []
        success_count = 0

        for sample_dir in sample_dirs:
            result = self._run_cubesat_for_one_sample(sample_dir, template_mph, config, export_tags, export_volum_tags, postprocess, mesh_config, boundary_conditions)
            sample_results.append(result)
            if result.get('ok'):
                success_count += 1
            else:
                failed_samples.append({
                    'sample_dir': str(sample_dir),
                    'error': result.get('error', 'unknown error'),
                    'stage': result.get('stage'),
                })
            self.model = None

        total_processed = len(sample_dirs)
        return {
            'total_samples': total_processed,
            'successful': success_count,
            'failed': len(failed_samples),
            'failed_samples': failed_samples,
            'sample_results': sample_results,
            'success_rate': success_count / total_processed if total_processed else 0,
        }

    def run(self) -> Dict[str, Any]:
        action = self.payload['action']
        sample_dirs = [Path(path) for path in self.payload['sample_dirs']]

        self.connect()
        if action != 'cubesat':
            self.load_model()
        try:
            if action == 'ping':
                result = self.smoke_test()
            elif action == 'geometry':
                result = self._update_geometry_for_samples(sample_dirs)
            elif action == 'comsol':
                result = self._run_comsol_for_samples(sample_dirs)
            elif action == 'cubesat':
                result = self._run_cubesat_for_samples(sample_dirs)
            else:
                raise ValueError(f'未知远程动作: {action}')
        finally:
            self.close()

        success = True
        if isinstance(result, dict) and 'failed' in result:
            success = result.get('failed', 0) == 0

        return {
            'success': success,
            'action': action,
            'result': result,
        }


def main():
    parser = argparse.ArgumentParser(description='Remote COMSOL executor')
    parser.add_argument('--payload', required=True, help='payload json path')
    parser.add_argument('--result', required=True, help='result json path')
    args = parser.parse_args()

    payload_path = Path(args.payload)
    result_path = Path(args.result)

    payload = json.loads(payload_path.read_text(encoding='utf-8'))
    executor = RemoteComsolExecutor(payload)

    try:
        result = executor.run()
    except Exception as e:
        result = {
            'success': False,
            'action': payload.get('action'),
            'error': str(e),
            'error_type': type(e).__name__,
            'traceback': traceback.format_exc(),
        }

    result_path.parent.mkdir(parents=True, exist_ok=True)
    result_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
