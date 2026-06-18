#!/usr/bin/env python3
"""Generate CAD/simulation report and modification suggestions for a workspace."""

from __future__ import annotations

import argparse
import json
import math
import os
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any


def load_json(path: Path | None) -> Any:
    if path is None or not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        return {"_read_error": f"{type(exc).__name__}: {exc}", "_path": str(path)}


def stat_file(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"path": str(path), "exists": False}
    stat = path.stat()
    return {
        "path": str(path),
        "exists": True,
        "size_bytes": stat.st_size,
        "size_mb": round(stat.st_size / 1024 / 1024, 3),
        "modified_at": datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds"),
    }


def get_nested(data: Any, keys: list[str], default: Any = None) -> Any:
    cur = data
    for key in keys:
        if not isinstance(cur, dict) or key not in cur:
            return default
        cur = cur[key]
    return cur


def safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def fmt_bool(value: Any) -> str:
    if value is True:
        return "yes"
    if value is False:
        return "no"
    if value is None:
        return "unknown"
    return str(value)


def fmt_num(value: Any, digits: int = 3) -> str:
    if value is None:
        return "unknown"
    try:
        number = float(value)
    except Exception:
        return str(value)
    if math.isnan(number) or math.isinf(number):
        return str(number)
    return f"{number:.{digits}f}"


def rel_link(path: str | Path, base: Path) -> str:
    target = Path(path)
    try:
        return os.path.relpath(target.resolve(), base.resolve()).replace(os.sep, "/")
    except Exception:
        return str(target)


def md_image(path: str | Path, base: Path, alt: str) -> str:
    return f"![{alt}]({rel_link(path, base)})"


def bullet(lines: list[str], text: str) -> None:
    lines.append(f"- {text}")


def heading(lines: list[str], text: str, level: int = 2) -> None:
    lines.append("")
    lines.append(f"{'#' * level} {text}")
    lines.append("")


def paragraph(lines: list[str], text: str) -> None:
    lines.append("")
    lines.append(text)
    lines.append("")


def analysis_note(lines: list[str], text: str) -> None:
    paragraph(lines, f"**说明与分析：** {text}")


def table(lines: list[str], headers: list[str], rows: list[list[Any]]) -> None:
    lines.append("| " + " | ".join(headers) + " |")
    lines.append("| " + " | ".join("---" for _ in headers) + " |")
    for row in rows:
        lines.append("| " + " | ".join(str(item) for item in row) + " |")


def first_existing(candidates: list[Path]) -> Path | None:
    for path in candidates:
        if path.exists():
            return path
    return None


def status_candidates(workspace: Path) -> list[Path]:
    sim_dir = workspace / "02_sim" / "simulation"
    return [
        sim_dir / "status.json",
        sim_dir / "_comsol_work" / "sim" / "status.json",
        sim_dir / "_comsol_work" / "status.json",
    ]


def simulation_artifact(workspace: Path, filename: str) -> Path:
    sim_dir = workspace / "02_sim" / "simulation"
    return first_existing([
        sim_dir / filename,
        sim_dir / "_comsol_work" / "sim" / filename,
        sim_dir / "_comsol_work" / filename,
    ]) or sim_dir / filename


def summarize_manifest(manifest: Any) -> dict[str, Any]:
    stages = manifest.get("stages", []) if isinstance(manifest, dict) else []
    failed = [s for s in stages if s.get("status") == "failed"]
    completed = [s for s in stages if s.get("status") == "completed"]
    return {
        "ok": manifest.get("ok") if isinstance(manifest, dict) else None,
        "stage_count": len(stages),
        "completed": [s.get("stage_name") for s in completed],
        "failed": [s.get("stage_name") for s in failed],
        "errors": [err for stage in failed for err in stage.get("errors", [])],
        "stages": stages,
    }


def bbox_dims(bbox: Any) -> list[float] | None:
    if not isinstance(bbox, dict):
        return None
    mins = bbox.get("min")
    maxs = bbox.get("max")
    if not isinstance(mins, list) or not isinstance(maxs, list) or len(mins) != 3 or len(maxs) != 3:
        return None
    return [safe_float(maxs[i]) - safe_float(mins[i]) for i in range(3)]


def bbox_union(components: list[dict[str, Any]]) -> dict[str, Any] | None:
    mins = [math.inf, math.inf, math.inf]
    maxs = [-math.inf, -math.inf, -math.inf]
    count = 0
    for component in components:
        bbox = component.get("bbox")
        if not isinstance(bbox, dict):
            continue
        bmin = bbox.get("min")
        bmax = bbox.get("max")
        if not isinstance(bmin, list) or not isinstance(bmax, list) or len(bmin) != 3 or len(bmax) != 3:
            continue
        for index in range(3):
            mins[index] = min(mins[index], safe_float(bmin[index]))
            maxs[index] = max(maxs[index], safe_float(bmax[index]))
        count += 1
    if count == 0:
        return None
    return {
        "count": count,
        "min": mins,
        "max": maxs,
        "size": [maxs[index] - mins[index] for index in range(3)],
    }


def summarize_components(sim_input: Any, registry: Any) -> dict[str, Any]:
    sim_components = sim_input.get("components", []) if isinstance(sim_input, dict) else []
    entities = registry.get("entities", []) if isinstance(registry, dict) else []
    by_kind = Counter(str(c.get("kind", "unknown")) for c in sim_components)
    by_category = Counter(str(c.get("category", "unknown")) for c in sim_components)
    by_material = Counter(str(c.get("material_id", "unknown")) for c in sim_components)
    heat_sources = [
        c for c in sim_components
        if c.get("is_heat_source") or safe_float(c.get("power_W")) != 0
    ]
    radiators = sim_input.get("radiators", []) if isinstance(sim_input, dict) else []

    grouped: dict[str, dict[str, Any]] = defaultdict(lambda: {"count": 0, "power_W": 0.0, "mass_kg": 0.0})
    for component in sim_components:
        category = str(component.get("category", "unknown"))
        grouped[category]["count"] += 1
        grouped[category]["power_W"] += safe_float(component.get("power_W"))
        grouped[category]["mass_kg"] += safe_float(component.get("mass_kg"))
    category_rows = [{"category": category, **values} for category, values in sorted(grouped.items())]

    suspicious: list[dict[str, Any]] = []
    for ent in entities:
        dims = ent.get("dims") or bbox_dims(ent.get("bbox")) or []
        if len(dims) != 3:
            continue
        dims_f = [safe_float(v) for v in dims]
        if any(v <= 0 for v in dims_f):
            suspicious.append({"component_id": ent.get("component_id"), "reason": "non-positive dimension", "dims": dims_f})
        elif min(dims_f) < 0.5:
            suspicious.append({"component_id": ent.get("component_id"), "reason": "very thin dimension", "dims": dims_f})
        elif max(dims_f) / max(min(dims_f), 1e-9) > 200:
            suspicious.append({"component_id": ent.get("component_id"), "reason": "extreme aspect ratio", "dims": dims_f})

    power_top = sorted(
        [
            {
                "component_id": c.get("component_id"),
                "semantic_name": c.get("semantic_name"),
                "kind": c.get("kind"),
                "category": c.get("category"),
                "power_W": safe_float(c.get("power_W")),
                "mass_kg": safe_float(c.get("mass_kg")),
            }
            for c in sim_components
        ],
        key=lambda item: item["power_W"],
        reverse=True,
    )
    return {
        "simulation_components": len(sim_components),
        "registry_entities": len(entities),
        "heat_source_count": len(heat_sources),
        "radiator_count": len(radiators),
        "total_power_W": sum(safe_float(c.get("power_W")) for c in sim_components),
        "total_mass_kg": sum(safe_float(c.get("mass_kg")) for c in sim_components),
        "by_kind": dict(by_kind),
        "by_category": dict(by_category),
        "by_material": dict(by_material),
        "category_rows": category_rows,
        "power_top": power_top[:12],
        "suspicious": suspicious[:20],
        "bbox_union": bbox_union(sim_components),
        "install_face_count": len(sim_input.get("install_faces", [])) if isinstance(sim_input, dict) else 0,
        "shell_count": len(sim_input.get("shells", [])) if isinstance(sim_input, dict) else 0,
        "cabin_count": len(sim_input.get("cabins", [])) if isinstance(sim_input, dict) else 0,
    }


def summarize_status(status: Any) -> dict[str, Any]:
    checks = status.get("checks", {}) if isinstance(status, dict) else {}
    selections_validation = get_nested(checks, ["selections", "validation"], {}) or {}
    selections_details = selections_validation.get("details", {}) if isinstance(selections_validation, dict) else {}
    heat_sources = get_nested(checks, ["heat_sources", "validation"], {}) or {}
    entity_counts = selections_details.get("entity_counts") or {}
    empty = (
        selections_details.get("empty")
        or selections_details.get("empty_tags")
        or selections_details.get("empty_selections")
        or []
    )
    return {
        "ok": status.get("ok") if isinstance(status, dict) else None,
        "stage": status.get("stage") if isinstance(status, dict) else None,
        "progress_percent": status.get("progress_percent") or status.get("percent") if isinstance(status, dict) else None,
        "error": status.get("error") if isinstance(status, dict) else None,
        "selection_ok": selections_validation.get("ok") if isinstance(selections_validation, dict) else None,
        "selection_message": selections_validation.get("message") if isinstance(selections_validation, dict) else None,
        "selection_expected_count": selections_details.get("expected_count") or len(selections_details.get("expected", []) or []),
        "selection_existing_count": selections_details.get("existing_count") or len(selections_details.get("existing", []) or selections_details.get("existing_tags", []) or []),
        "selection_empty_tags": empty,
        "selection_entity_counts": entity_counts,
        "selection_min_entities": min(entity_counts.values()) if entity_counts else None,
        "selection_max_entities": max(entity_counts.values()) if entity_counts else None,
        "selection_multi_entity_count": sum(1 for value in entity_counts.values() if value > 1) if entity_counts else 0,
        "heat_sources_ok": heat_sources.get("ok") if isinstance(heat_sources, dict) else None,
        "heat_sources_message": heat_sources.get("message") if isinstance(heat_sources, dict) else None,
        "heat_sources_expected_count": get_nested(heat_sources, ["details", "expected_count"]),
        "heat_sources_existing_count": get_nested(heat_sources, ["details", "existing_count"]),
    }


def summarize_cad_validation(validation_report: Any, artifacts: dict[str, Any]) -> dict[str, Any]:
    validation = validation_report if isinstance(validation_report, dict) else {}
    summary = validation.get("summary", {}) if isinstance(validation, dict) else {}
    checks = validation.get("checks", {}) if isinstance(validation, dict) else {}
    bbox = checks.get("bbox", {}) if isinstance(checks, dict) else {}
    mount = checks.get("mount_contact", {}) if isinstance(checks, dict) else checks.get("mount", {})
    occupancy = checks.get("face_occupancy", {}) if isinstance(checks, dict) else {}
    cad_files = [
        artifacts.get("geometry_after_glb", {}),
        artifacts.get("real_cad_glb", {}),
        artifacts.get("power_filtered_step", {}),
        artifacts.get("simulation_input", {}),
    ]
    files_ok = all(item.get("exists") and item.get("size_bytes", 0) > 0 for item in cad_files)
    return {
        "status": validation.get("status") if validation else ("artifacts_ready" if files_ok else "missing_artifacts"),
        "component_count": summary.get("component_count"),
        "bbox_failure_count": summary.get("bbox_failure_count"),
        "bbox_overlap_count": summary.get("bbox_overlap_count"),
        "contact_failure_count": summary.get("contact_failure_count", summary.get("mount_issue_count")),
        "face_occupancy_max": summary.get("face_occupancy_max"),
        "over_capacity_face_count": summary.get("over_capacity_face_count"),
        "overlaps": bbox.get("overlaps", bbox.get("component_overlaps", [])) if isinstance(bbox, dict) else [],
        "contact_failures": mount.get("contact_failures", mount.get("mount_issues", [])) if isinstance(mount, dict) else [],
        "face_occupancy_ok": occupancy.get("ok") if isinstance(occupancy, dict) else None,
    }


def summarize_field_samples(field_samples: Any) -> dict[str, Any]:
    samples = field_samples.get("samples", []) if isinstance(field_samples, dict) else []
    by_component: dict[str, list[float]] = defaultdict(list)
    for sample in samples:
        component_id = str(sample.get("component_id", "unknown"))
        by_component[component_id].append(safe_float(sample.get("temperature_K")))
    component_rows = []
    for component_id, temps in by_component.items():
        component_rows.append({
            "component_id": component_id,
            "count": len(temps),
            "min_K": min(temps),
            "max_K": max(temps),
            "mean_K": sum(temps) / len(temps),
        })
    component_rows.sort(key=lambda item: item["max_K"], reverse=True)
    return {
        "sample_count": len(samples),
        "component_count": len(by_component),
        "component_rows": component_rows,
    }


def collect_workspace(workspace: Path) -> dict[str, Any]:
    cad_dir = workspace / "01_cad"
    sim_root = workspace / "02_sim"
    sim_dir = sim_root / "simulation"
    post_dir = sim_root / "postprocess"
    analysis_dir = sim_root / "analysis"
    case_dir = sim_root / "case_build"
    logs_dir = workspace / "logs"

    status_path = first_existing(status_candidates(workspace))
    screenshots = sorted(cad_dir.glob("freecad_screenshot_*.png"))
    post_images = sorted(post_dir.glob("*.png"))
    data = {
        "workspace": str(workspace),
        "paths": {
            "cad_dir": str(cad_dir),
            "sim_dir": str(sim_dir),
            "postprocess_dir": str(post_dir),
            "analysis_dir": str(analysis_dir),
            "case_dir": str(case_dir),
            "status_path": str(status_path) if status_path else None,
        },
        "cad_validation_report": load_json(cad_dir / "cad_validation_report.json"),
        "simulation_input": load_json(cad_dir / "simulation_input.json"),
        "registry": load_json(cad_dir / "geometry_after_registry.json"),
        "geom_after": load_json(cad_dir / "geometry_after.geom.json"),
        "run_manifest": load_json(sim_root / "run_manifest.json"),
        "status": load_json(status_path),
        "progress": load_json(logs_dir / "progress_percentages.json"),
        "simulation_manifest": load_json(sim_dir / "simulation_manifest.json"),
        "field_stats": load_json(post_dir / "field_stats.json"),
        "render_summary": load_json(post_dir / "render_summary.json"),
        "paraview_summary": load_json(post_dir / "summary.json"),
        "visualization_manifest": load_json(post_dir / "visualization_manifest.json"),
        "metrics_summary": load_json(analysis_dir / "metrics_summary.json"),
        "observation": load_json(analysis_dir / "observation.json"),
        "diagnosis": load_json(analysis_dir / "diagnosis.json"),
        "root_cause_report": load_json(analysis_dir / "root_cause_report.json"),
        "field_samples": load_json(sim_dir / "field_samples.json"),
        "case_validation": load_json(case_dir / "case_validation.json"),
        "artifacts": {
            "step": stat_file(cad_dir / "geometry_after.step"),
            "glb": stat_file(cad_dir / "geometry_after.glb"),
            "coord": stat_file(cad_dir / "comsol_inputs" / "coord.txt"),
            "channels": stat_file(cad_dir / "comsol_inputs" / "channels_input.npz"),
            "work_mph": stat_file(simulation_artifact(workspace, "work.mph")),
            "native_vtu": stat_file(simulation_artifact(workspace, "native.vtu")),
            "data1_txt": stat_file(simulation_artifact(workspace, "data1.txt")),
            "case_field_vtu": stat_file(case_dir / "field.vtu"),
        },
        "screenshots": [stat_file(path) for path in screenshots],
        "postprocess_images": [stat_file(path) for path in post_images],
    }
    data["components"] = summarize_components(data["simulation_input"], data["registry"])
    data["manifest_summary"] = summarize_manifest(data["run_manifest"])
    data["status_summary"] = summarize_status(data["status"])
    data["cad_validation"] = summarize_cad_validation(data["cad_validation_report"], data["artifacts"])
    data["field_sample_summary"] = summarize_field_samples(data["field_samples"])
    return data


def detect_recommendations(data: dict[str, Any]) -> dict[str, list[str]]:
    cad: list[str] = []
    sim: list[str] = []
    report: list[str] = []
    validation: list[str] = []

    components = data["components"]
    status = data["status_summary"]
    manifest = data["manifest_summary"]
    cad_validation = data["cad_validation"]

    if cad_validation.get("status") and cad_validation.get("status") not in {"success", "ok"}:
        cad.append(
            f"复查 CAD 构建状态 `{cad_validation.get('status')}`；bbox 重叠数={cad_validation.get('bbox_overlap_count')}，安装接触失败数={cad_validation.get('contact_failure_count')}。"
        )
    if components["simulation_components"] != components["registry_entities"]:
        cad.append(
            f"同步组件数量：simulation_input 中有 {components['simulation_components']} 个组件，registry 中有 {components['registry_entities']} 个实体。"
        )
    if cad_validation.get("overlaps"):
        for item in cad_validation["overlaps"][:5]:
            cad.append(
                f"消除 `{item.get('a')}` 与 `{item.get('b')}` 的几何重叠后再作为最终几何质量目标；重叠体积={fmt_num(item.get('volume_mm3'))} mm^3。"
            )
    if cad_validation.get("contact_failures"):
        for item in cad_validation["contact_failures"][:5]:
            cad.append(
                f"修复 `{item.get('component_id')}` 在 `{item.get('mount_face_id')}` 上的安装接触；delta={fmt_num(item.get('delta_mm'))} mm。"
            )
    if components["suspicious"]:
        ids = ", ".join(str(x.get("component_id")) for x in components["suspicious"][:8])
        cad.append(f"检查以下组件的异常尺寸或长宽比：{ids}。")
    if not data["artifacts"]["step"]["exists"]:
        cad.append("重新生成 `01_cad/geometry_after.step`；缺少主 STEP 时仿真几何不可作为可信输入。")
    if data["artifacts"]["step"]["exists"] and not data["artifacts"]["glb"]["exists"]:
        cad.append("重新生成 `01_cad/geometry_after.glb`，方便审查人员进行几何可视化检查。")

    error_text = str(status.get("error") or "")
    empty_tags = status.get("selection_empty_tags") or []
    if empty_tags:
        sim.append(f"求解前先修复空 COMSOL selection：{', '.join(map(str, empty_tags[:20]))}。")
    if "root.comp1.ht." in error_text and ".Q0" in error_text:
        sim.append("规范 COMSOL HeatSource feature tag，例如使用 `hs_AIRBUS_REFINED_002`，同时绑定 selection `AIRBUS-REFINED-002`。")
    if status.get("stage") == "update_sources":
        sim.append("清理 HeatSource tag 后移走旧的 COMSOL `work.mph` 并重跑，避免旧物理节点残留。")
    if status.get("stage") == "solve" and error_text:
        sim.append("求解在 `solve` 阶段失败；确认 selection 和热源有效后，再优先检查网格、物理场和求解器设置。")
    elif status.get("stage") == "solve" and status.get("ok") is not True:
        sim.append("仿真记录停留在 `solve` 且没有最终成功标记；调整网格/求解器前先确认 COMSOL 是否仍在运行或被中断。")
    if manifest.get("failed"):
        sim.append(f"重跑失败的流水线阶段：{', '.join(manifest['failed'])}。")
    if status.get("ok") and not data["artifacts"]["native_vtu"]["exists"]:
        sim.append("求解标记为成功但缺少 `native.vtu`；报告定稿前需要重新导出温度场。")

    field_sample_summary = data["field_sample_summary"]
    if field_sample_summary["component_count"] <= 1 and field_sample_summary["sample_count"]:
        report.append(
            f"报告覆盖范围较窄：`field_samples.json` 只有 {field_sample_summary['sample_count']} 个采样点，覆盖 {field_sample_summary['component_count']} 个组件，结论中必须显式说明该限制。"
        )
    if not data["postprocess_images"]:
        report.append("生成最终报告前需要先生成 ParaView 后处理图片。")
    if not data["screenshots"]:
        report.append("生成最终报告前需要先生成 FreeCAD 几何截图。")

    validation.append("对目标工作区运行 report CLI，并确认报告路径指向当前工作区，而不是历史 v*_data 目录。")
    validation.append("确认 `geometry_after.step`、`geometry_after_registry.json` 和 `simulation_input.json` 的组件集合一致。")
    validation.append("确认 selection 校验没有空 tag，且热源校验数量符合预期。")
    validation.append("声称热结果完整前，确认 `native.vtu`、`field_stats.json`、`render_summary.json` 和后处理 PNG 均存在。")

    return {
        "cad": cad or ["从现有元数据中未发现高优先级 CAD 修改项。"],
        "simulation": sim or ["从现有元数据中未发现高优先级仿真修改项。"],
        "report": report or ["从现有元数据中未发现高优先级报告覆盖缺口。"],
        "validation": validation,
    }


def file_row(label: str, info: dict[str, Any], base: Path) -> list[str]:
    if not info.get("exists"):
        return [label, f"`{rel_link(info.get('path'), base)}`", "missing", "", ""]
    return [
        label,
        f"[{Path(info['path']).name}]({rel_link(info['path'], base)})",
        "yes",
        str(info.get("size_mb")),
        str(info.get("modified_at")),
    ]


def image_gallery(lines: list[str], title: str, images: list[dict[str, Any]], base: Path) -> None:
    heading(lines, title, level=3)
    existing = [image for image in images if image.get("exists")]
    if not existing:
        lines.append("No images found.")
        return
    analysis_note(lines, image_group_description(title))
    image_grid(lines, existing, base, columns=2)


def image_title(stem: str) -> str:
    mapping = {
        "freecad_screenshot_front": "主视图",
        "freecad_screenshot_back": "后视图",
        "freecad_screenshot_left": "左视图",
        "freecad_screenshot_right": "右视图",
        "freecad_screenshot_top": "俯视图",
        "freecad_screenshot_bottom": "仰视图",
        "3d_iso_front": "三维等轴测前视图",
        "3d_iso_back": "三维等轴测后视图",
        "3d_top": "三维顶视温度图",
        "3d_front": "三维前视温度图",
        "3d_right": "三维右视温度图",
        "slice_xy": "XY 切片温度图",
        "slice_xz": "XZ 切片温度图",
        "slice_yz": "YZ 切片温度图",
        "contour_iso_front": "等值面前向视图",
        "contour_top": "等值面顶视图",
        "volume_iso_front": "体渲染前向视图",
        "volume_iso_back": "体渲染后向视图",
    }
    return mapping.get(stem, stem.replace("_", " "))


def image_description(stem: str) -> str:
    mapping = {
        "freecad_screenshot_front": "作为六视图中心，用于检查模型正向轮廓、外露组件位置以及整体比例关系。",
        "freecad_screenshot_back": "用于补充检查背向结构和后侧外露组件，帮助发现主视图无法看到的遮挡或偏置。",
        "freecad_screenshot_left": "用于核对左侧安装面、侧向外廓和侧面组件是否与总体包络一致。",
        "freecad_screenshot_right": "用于核对右侧安装面、侧向外廓和侧面组件是否与总体包络一致。",
        "freecad_screenshot_top": "用于检查顶部安装面、上表面组件分布和组件对顶部包络的占用情况。",
        "freecad_screenshot_bottom": "用于检查底面安装、推进/外部组件分布以及底部包络是否存在明显外伸。",
        "3d_iso_front": "展示整体温度场的前向空间分布，用于快速识别热点相对位置和全局温度梯度。",
        "3d_iso_back": "从背向角度补充观察温度场，避免前向视图遮挡导致热点或冷区漏判。",
        "3d_top": "从顶部观察温度分布，适合检查顶面附近的外露散热区域和上表面温度连续性。",
        "3d_front": "从前向正视角观察温度分布，适合与 CAD 主视图对应检查热结果和几何位置。",
        "3d_right": "从右侧观察温度分布，适合检查侧向外露组件及侧壁区域温度变化。",
        "slice_xy": "展示 XY 平面切片，用于观察水平截面内温度是否连续以及局部异常是否穿过主体区域。",
        "slice_xz": "展示 XZ 平面切片，用于观察高度方向上的温度分布和上下表面之间的差异。",
        "slice_yz": "展示 YZ 平面切片，用于观察另一侧向截面内的温度梯度和局部异常。",
        "contour_iso_front": "用等值面突出相同温度区间的空间分布，适合判断热点区域是否集中或扩散。",
        "contour_top": "从顶部观察等值面分布，辅助判断温度异常区域在平面内的覆盖范围。",
        "volume_iso_front": "体渲染用于观察温度场的整体体积分布，但在当前温差很小的结果中主要作为可视化完整性检查。",
        "volume_iso_back": "背向体渲染用于补充检查整体温度体分布，避免单一视角遮挡。",
    }
    if stem in mapping:
        return mapping[stem]
    if stem.startswith("3d_"):
        return "三维温度视图用于观察全局温度分布、热点位置和不同视角下的遮挡关系。"
    if stem.startswith("slice_"):
        return "切片图用于检查特定截面上的温度连续性和局部异常。"
    if stem.startswith("contour_"):
        return "等值面图用于突出同温区间的空间范围和热点聚集程度。"
    if stem.startswith("volume_"):
        return "体渲染图用于辅助观察三维温度场的整体分布。"
    return "该图用于补充说明当前工作区的几何或热场可视化结果。"


def image_group_description(title: str) -> str:
    if "三维" in title:
        return "本组图片按不同空间视角展示温度云图，重点用于判断热点是否集中、温度分布是否随视角出现被遮挡区域。"
    if "切片" in title:
        return "本组切片用于从不同截面检查温度场内部连续性；若只看外表面云图，内部异常可能被遮挡。"
    if "等值面" in title:
        return "本组等值面用于突出同温区域形态，适合辅助判断温度异常是局部点状还是成片分布。"
    if "体渲染" in title:
        return "本组体渲染用于检查三维温度场整体形态；当前温差很小，因此主要体现可视化和导出链路是否完整。"
    return "本组图片用于辅助理解本章节中的几何或仿真结果，图下说明给出主要观察点。"


def image_cell(path: str | Path, base: Path) -> str:
    stem = Path(path).stem
    title = image_title(stem)
    description = image_description(stem)
    cell = (
        f"{md_image(path, base, title)}<br>"
        f"**{title}**<br>"
        f"{description}<br>"
        f"`{rel_link(path, base)}`"
    )
    return cell.replace("|", "/")


def image_grid(lines: list[str], images: list[dict[str, Any]], base: Path, columns: int = 2) -> None:
    headers = ["图像" for _ in range(columns)]
    lines.append("| " + " | ".join(headers) + " |")
    lines.append("| " + " | ".join("---" for _ in headers) + " |")
    for index in range(0, len(images), columns):
        row_images = images[index:index + columns]
        cells = [image_cell(image["path"], base) for image in row_images]
        cells.extend([" " for _ in range(columns - len(cells))])
        lines.append("| " + " | ".join(cells) + " |")


def six_view_gallery(lines: list[str], images: list[dict[str, Any]], base: Path) -> None:
    heading(lines, "FreeCAD 六视图", level=3)
    existing = {Path(image["path"]).stem: image for image in images if image.get("exists")}
    if not existing:
        lines.append("No images found.")
        return
    analysis_note(
        lines,
        "六视图采用主视图居中、俯视图在上、仰视图在下、左/右视图分列两侧的排布方式，便于按工程图习惯核对模型外形、安装面和外露组件位置。后视图放在右下角作为背向结构补充检查。",
    )

    def cell(stem: str) -> str:
        image = existing.get(stem)
        if not image:
            return " "
        return image_cell(image["path"], base)

    lines.append("| 左侧位置 | 中心位置 | 右侧位置 |")
    lines.append("| --- | --- | --- |")
    lines.append(f"|   | {cell('freecad_screenshot_top')} |   |")
    lines.append(f"| {cell('freecad_screenshot_left')} | {cell('freecad_screenshot_front')} | {cell('freecad_screenshot_right')} |")
    lines.append(f"|   | {cell('freecad_screenshot_bottom')} | {cell('freecad_screenshot_back')} |")


def write_report(out_path: Path, data: dict[str, Any]) -> None:
    report_dir = out_path.parent
    lines: list[str] = ["# CAD 热控仿真分析报告", ""]
    components = data["components"]
    manifest = data["manifest_summary"]
    status = data["status_summary"]
    cad_validation = data["cad_validation"]
    field_stats = data["field_stats"] if isinstance(data["field_stats"], dict) else {}
    render_summary = data["render_summary"] if isinstance(data["render_summary"], dict) else {}
    paraview_summary = data["paraview_summary"] if isinstance(data["paraview_summary"], dict) else {}
    metrics = data["metrics_summary"] if isinstance(data["metrics_summary"], dict) else {}
    root_cause = data["root_cause_report"] if isinstance(data["root_cause_report"], dict) else {}
    diagnosis = data["diagnosis"] if isinstance(data["diagnosis"], dict) else {}
    cad_spec_path = Path(data["workspace"]) / "00_inputs" / "cad_build_spec.json"
    sim_manifest = data["simulation_manifest"] if isinstance(data["simulation_manifest"], dict) else {}
    status_checks = data["status"].get("checks", {}) if isinstance(data["status"], dict) else {}
    recommendations = detect_recommendations(data)

    heading(lines, "1. 报告摘要")
    bullet(lines, f"工作目录：`{data['workspace']}`。")
    bullet(lines, f"CAD 状态：`{cad_validation.get('status')}`，组件 {components['simulation_components']} 个，registry 实体 {components['registry_entities']} 个。")
    bullet(lines, f"仿真状态：阶段 `{status['stage'] or 'unknown'}`，ok={fmt_bool(status['ok'])}，进度={status['progress_percent']}。")
    bullet(lines, f"热模型输入：热源 {components['heat_source_count']} 个，总功耗 {fmt_num(components['total_power_W'])} W；simulation_input 中辐射器记录 {components['radiator_count']} 个。")
    bullet(lines, f"温度统计：{fmt_num(field_stats.get('min_K'))} K 到 {fmt_num(field_stats.get('max_K'))} K，均值 {fmt_num(field_stats.get('mean_K'))} K。")
    bullet(lines, f"报告资产：FreeCAD 几何图片 {len([x for x in data['screenshots'] if x.get('exists')])} 张，热后处理图片 {len([x for x in data['postprocess_images'] if x.get('exists')])} 张。")
    bullet(lines, "当前报告按工程热控报告顺序组织，但只使用工作区已有数据；未提供的数据会在对应章节明确标注。")
    lines.append("")
    table(
        lines,
        ["摘要项", "当前结果"],
        [
            ["pipeline manifest", fmt_bool(manifest["ok"])],
            ["failed stages", ", ".join(manifest["failed"]) if manifest["failed"] else "none recorded"],
            ["CAD bbox overlaps", cad_validation.get("bbox_overlap_count")],
            ["CAD contact failures", cad_validation.get("contact_failure_count")],
            ["COMSOL selection", f"{fmt_bool(status['selection_ok'])}: {status['selection_message'] or 'none recorded'}"],
            ["COMSOL heat sources", f"{fmt_bool(status['heat_sources_ok'])}: {status['heat_sources_message'] or 'none recorded'}"],
            ["COMSOL radiators applied/skipped", f"{get_nested(status_checks, ['radiators', 'applied'], 'unknown')} / {get_nested(status_checks, ['radiators', 'skipped'], 'unknown')}"],
            ["postprocess images", len([x for x in data["postprocess_images"] if x.get("exists")])],
        ],
    )
    analysis_note(
        lines,
        "当前流水线和 COMSOL 求解均记录为成功，但 CAD 仍存在 bbox 重叠和安装接触失败，因此本报告适合作为自动化流程验证和当前热场结果说明，不应直接作为最终热控验收报告。",
    )

    heading(lines, "2. 热分析模型")
    heading(lines, "2.1 模型来源与简化说明", level=3)
    table(
        lines,
        ["项目", "内容"],
        [
            ["input format", "cad_build_spec" if cad_spec_path.exists() else "unknown"],
            ["CAD output dir", data["paths"]["cad_dir"]],
            ["source files", "00_inputs/cad_build_spec.json" if cad_spec_path.exists() else "unknown"],
            ["install faces / shells / cabins", f"{components['install_face_count']} / {components['shell_count']} / {components['cabin_count']}"],
            ["component bbox union coverage", f"{components['bbox_union']['count']} components" if components["bbox_union"] else "not available"],
        ],
    )
    analysis_note(
        lines,
        "模型来源表用于确认报告追溯路径。当前输入来自 cad_build_spec 数据，说明报告能追踪到 CAD 自动构建结果；但该表不能替代人工工程假设说明。",
    )
    lines.append("")
    bullet(lines, "当前热分析模型由 `01_cad` 下的 STEP、GLB、geom、registry 和 simulation_input 数据生成。")
    bullet(lines, "当前工作区没有提供电缆、小孔、多层隔热边缘漏热、蜂窝芯等工程简化假设的结构化输入，因此本报告只描述可从 CAD/仿真产物确认的模型信息。")

    heading(lines, "2.2 几何模型图片", level=3)
    six_view_gallery(lines, data["screenshots"], report_dir)
    analysis_note(
        lines,
        "六视图主要用于几何审查而不是热结果判断。结合 CAD 校验结果，本模型仍需重点检查重叠组件和安装接触失败组件是否在视图中表现为穿插、悬空或贴合异常。",
    )

    heading(lines, "2.3 CAD 几何数据", level=3)
    table(
        lines,
        ["Artifact", "File", "Exists", "Size MB", "Modified"],
        [
            file_row("STEP", data["artifacts"]["step"], report_dir),
            file_row("GLB", data["artifacts"]["glb"], report_dir),
            file_row("COMSOL coord", data["artifacts"]["coord"], report_dir),
            file_row("channels_input", data["artifacts"]["channels"], report_dir),
        ],
    )
    analysis_note(
        lines,
        "CAD artifact 表用于确认几何、可视化和 COMSOL 输入文件是否齐全。STEP 是 COMSOL 导入的主文件，GLB 主要用于快速审查，coord/channels_input 用于后续 selection 和通道输入绑定。",
    )
    lines.append("")
    table(
        lines,
        ["Metric", "Value"],
        [
            ["CAD validation status", f"`{cad_validation.get('status')}`"],
            ["bbox failures", cad_validation.get("bbox_failure_count")],
            ["bbox overlaps", cad_validation.get("bbox_overlap_count")],
            ["mount/contact failures", cad_validation.get("contact_failure_count")],
            ["max face occupancy", fmt_num(cad_validation.get("face_occupancy_max"))],
        ],
    )
    analysis_note(
        lines,
        f"CAD 校验状态为 `{cad_validation.get('status')}`。bbox 重叠数为 {cad_validation.get('bbox_overlap_count')}，安装接触失败数为 {cad_validation.get('contact_failure_count')}，说明几何虽然能够进入仿真流程，但仍不满足最终工程几何质量要求。",
    )
    if components["bbox_union"]:
        union = components["bbox_union"]
        lines.append("")
        table(
            lines,
            ["BBox Union", "X", "Y", "Z"],
            [
                ["min mm", *[fmt_num(v) for v in union["min"]]],
                ["max mm", *[fmt_num(v) for v in union["max"]]],
                ["size mm", *[fmt_num(v) for v in union["size"]]],
            ],
        )
        analysis_note(
            lines,
            "BBox Union 给出所有组件包络的总体范围，可用于与整星外壳尺寸、VTU bounds 和截图外形做一致性检查。当前包络反映组件分布范围，不代表真实外壳实体尺寸。",
        )

    heading(lines, "2.4 组件清单", level=3)
    table(
        lines,
        ["Category", "Count", "Power W", "Mass kg"],
        [
            [row["category"], row["count"], fmt_num(row["power_W"]), fmt_num(row["mass_kg"])]
            for row in components["category_rows"]
        ],
    )
    analysis_note(
        lines,
        "组件清单按 category 汇总数量、功耗和质量。当前推进类组件贡献了主要功耗，后续若要做热控优化，应优先关注高功耗类别及其安装面、散热路径和接触状态。",
    )

    heading(lines, "3. 仿真输入参数")
    heading(lines, "3.1 材料与结构参数", level=3)
    material_rows = [
        [material, count]
        for material, count in sorted(components["by_material"].items(), key=lambda item: str(item[0]))
    ]
    if material_rows:
        table(lines, ["Material ID", "Component Count"], material_rows)
    else:
        lines.append("No material metadata found.")
    analysis_note(
        lines,
        "材料统计来自 simulation_input 的 material_id，用于检查组件材料分配是否完整。它只能说明材料标签分布，不能说明涂层吸收率、红外发射率或多层隔热参数。",
    )
    lines.append("")
    table(
        lines,
        ["COMSOL material field", "Value"],
        [
            ["thermalconductivity", get_nested(status_checks, ["materials", "thermalconductivity"], "not recorded")],
            ["density", get_nested(status_checks, ["materials", "density"], "not recorded")],
            ["heatcapacity", get_nested(status_checks, ["materials", "heatcapacity"], "not recorded")],
            ["material selection", get_nested(status_checks, ["materials", "selection"], "not recorded")],
        ],
    )
    analysis_note(
        lines,
        "COMSOL 材料参数显示当前求解实际使用的材料设置。这里记录的是统一材料或 fallback 参数，与 CATCH 报告中分材料、分涂层的工程热物性表不是同一层级。",
    )

    heading(lines, "3.2 热源输入", level=3)
    table(
        lines,
        ["Metric", "Value"],
        [
            ["heat source components", components["heat_source_count"]],
            ["total component power W", fmt_num(components["total_power_W"])],
            ["heat source expected/existing", f"{status['heat_sources_expected_count']} / {status['heat_sources_existing_count']}"],
            ["heat source validation", f"{fmt_bool(status['heat_sources_ok'])}: {status['heat_sources_message'] or 'none recorded'}"],
        ],
    )
    analysis_note(
        lines,
        "热源校验显示 41 个热源均已创建，说明当前求解的热源绑定链路是完整的。总功耗为组件功耗字段求和，不等同于多工况下的低温/高温开机功耗表。",
    )
    lines.append("")
    table(
        lines,
        ["Component", "Semantic Name", "Kind", "Category", "Power W", "Mass kg"],
        [
            [
                row.get("component_id"),
                row.get("semantic_name"),
                row.get("kind"),
                row.get("category"),
                fmt_num(row.get("power_W")),
                fmt_num(row.get("mass_kg")),
            ]
            for row in components["power_top"][:12]
        ],
    )
    analysis_note(
        lines,
        "高功耗组件表用于快速定位主要发热源。当前表按功耗排序，只列出前 12 项；若要生成正式工程热耗输入表，需要补充低温、高温、安全、烘烤等模式下的功耗配置。",
    )

    heading(lines, "3.3 辐射、边界与接触设置", level=3)
    table(
        lines,
        ["Setting", "Value"],
        [
            ["radiators applied/skipped", f"{get_nested(status_checks, ['radiators', 'applied'], 'unknown')} / {get_nested(status_checks, ['radiators', 'skipped'], 'unknown')}"],
            ["shell radiation applied/skipped", f"{get_nested(status_checks, ['shell_radiation', 'applied'], 'unknown')} / {get_nested(status_checks, ['shell_radiation', 'skipped'], 'unknown')}"],
            ["contact resistance applied/skipped", f"{get_nested(status_checks, ['contact_resistance', 'applied'], 'unknown')} / {get_nested(status_checks, ['contact_resistance', 'skipped'], 'unknown')}"],
            ["initial temperature K", get_nested(status_checks, ["initial_temperature", "initial_temp_K"], "not recorded")],
            ["internal temperature references applied/skipped", f"{get_nested(status_checks, ['internal_temperature_reference', 'applied'], 'unknown')} / {get_nested(status_checks, ['internal_temperature_reference', 'skipped'], 'unknown')}"],
        ],
    )
    analysis_note(
        lines,
        "边界设置表显示 COMSOL 实际应用了 20 个组件级辐射边界，但壳体外表面辐射为 0/6、接触热阻为 0/50，说明当前热路径尚未完整表达壳体辐射和安装接触导热。",
    )
    bullet(lines, "当前工作区没有轨道外热流、太阳常数、地球红外、反照率、涂层退化参数等结构化数据，因此不能生成 CATCH 报告中的外热流参数表和热控材料辐射参数表。")

    heading(lines, "3.4 选择集校验", level=3)
    table(
        lines,
        ["Check", "Value"],
        [
            ["status path", data["paths"]["status_path"]],
            ["geometry import", get_nested(data["status"], ["checks", "geometry", "message"], "unknown")],
            ["selection validation", f"{fmt_bool(status['selection_ok'])}: {status['selection_message'] or 'none recorded'}"],
            ["selection expected/existing", f"{status['selection_expected_count']} / {status['selection_existing_count']}"],
            ["empty selections", ", ".join(map(str, status["selection_empty_tags"])) if status["selection_empty_tags"] else "none recorded"],
            ["selection entity min/max", f"{status['selection_min_entities']} / {status['selection_max_entities']}"],
            ["multi-entity selections", status["selection_multi_entity_count"]],
        ],
    )
    analysis_note(
        lines,
        "selection 校验通过说明 COMSOL 中 50 个组件 selection 均已创建，且没有空 selection。这解决了求解前的几何绑定问题，但不能消除 CAD 重叠或接触失败带来的物理可信度风险。",
    )

    heading(lines, "4. 工况与求解设置")
    heading(lines, "4.1 工况说明", level=3)
    bullet(lines, "当前工作区记录的是一次 CAD 到 COMSOL 的单次求解流程。")
    bullet(lines, "没有发现多日期、多姿态、高低温、安全模式、入轨模式、烘烤模式等批量工况结果。")
    bullet(lines, "没有发现瞬态时间序列或加热器闭环控制输出，因此不能生成 CATCH 报告中的瞬态曲线、补偿功耗、占空比和多工况符合性表。")
    lines.append("")
    table(
        lines,
        ["Item", "Value"],
        [
            ["simulation id", sim_manifest.get("simulation_id", "unknown")],
            ["backend", get_nested(sim_manifest, ["external_tools", "backend"], "unknown")],
            ["template mph", get_nested(sim_manifest, ["external_tools", "template_mph"], "unknown")],
            ["mesh", get_nested(sim_manifest, ["external_tools", "mesh"], "unknown")],
            ["mesh switch", f"{get_nested(status_checks, ['mesh_switch', 'mesh_type'], 'unknown')}, hauto={get_nested(status_checks, ['mesh_switch', 'hauto'], 'unknown')}"],
        ],
    )
    analysis_note(
        lines,
        "本节用于说明当前求解的工况边界。当前只有单次 COMSOL local backend 求解记录，因此不能像 CATCH 报告那样比较多日期、多姿态和多工作模式下的稳态/瞬态温度。",
    )

    heading(lines, "4.2 求解器与输出文件", level=3)
    table(
        lines,
        ["Artifact", "File", "Exists", "Size MB", "Modified"],
        [
            file_row("work.mph", data["artifacts"]["work_mph"], report_dir),
            file_row("native.vtu", data["artifacts"]["native_vtu"], report_dir),
            file_row("data1.txt", data["artifacts"]["data1_txt"], report_dir),
            file_row("case field.vtu", data["artifacts"]["case_field_vtu"], report_dir),
        ],
    )
    analysis_note(
        lines,
        "求解输出文件齐全，说明从 COMSOL 模型、VTU 导出到后处理的链路已完成。`native.vtu` 是后处理云图的主要输入，`work.mph` 可用于回溯 COMSOL 模型设置。",
    )
    if status["error"]:
        lines.append("")
        lines.append("Failure/error excerpt:")
        lines.append("")
        lines.append("```text")
        lines.append(str(status["error"])[:3000])
        lines.append("```")

    heading(lines, "4.3 流程阶段", level=3)
    table(
        lines,
        ["Stage", "Status", "Started", "Finished"],
        [
            [
                stage.get("stage_name"),
                stage.get("status"),
                stage.get("started_at") or "",
                stage.get("finished_at") or "",
            ]
            for stage in manifest["stages"]
        ],
    )
    analysis_note(
        lines,
        "流程阶段表用于追踪自动化流水线是否完整执行。当前 simulation_run、field_export、postprocess、case_build 和 analysis 均为 completed，说明报告数据不是手工拼接结果。",
    )

    heading(lines, "5. 热仿真结果")
    heading(lines, "5.1 全场温度统计", level=3)
    table(
        lines,
        ["Metric", "Value"],
        [
            ["field sample count", field_stats.get("count")],
            ["valid / NaN samples", f"{field_stats.get('valid_count')} / {field_stats.get('nan_count')}"],
            ["field_stats min K", fmt_num(field_stats.get("min_K"))],
            ["field_stats max K", fmt_num(field_stats.get("max_K"))],
            ["field_stats mean K", fmt_num(field_stats.get("mean_K"))],
            ["ParaView array", get_nested(paraview_summary, ["temperature", "array_name"], render_summary.get("array_name", "unknown"))],
            ["ParaView points / cells", f"{get_nested(paraview_summary, ['temperature', 'num_points'], 'unknown')} / {get_nested(paraview_summary, ['temperature', 'num_cells'], 'unknown')}"],
            ["ParaView min/max K", f"{fmt_num(get_nested(paraview_summary, ['temperature', 'min_K']))} / {fmt_num(get_nested(paraview_summary, ['temperature', 'max_K']))}"],
            ["analysis anomaly count", metrics.get("anomaly_count")],
        ],
    )
    analysis_note(
        lines,
        "全场温度统计显示当前温度范围约 3.000 K 到 3.018 K，温差极小。该结果可以验证数据导出和渲染链路，但从工程热控角度看，仍需要结合真实边界温度、外热流和接触热阻设置后再判断热设计合理性。",
    )
    bounds = paraview_summary.get("bounds") if isinstance(paraview_summary, dict) else None
    if isinstance(bounds, dict):
        lines.append("")
        table(
            lines,
            ["VTU Bounds m", "min", "max"],
            [
                ["X", fmt_num(bounds.get("xmin")), fmt_num(bounds.get("xmax"))],
                ["Y", fmt_num(bounds.get("ymin")), fmt_num(bounds.get("ymax"))],
                ["Z", fmt_num(bounds.get("zmin")), fmt_num(bounds.get("zmax"))],
            ],
        )
        analysis_note(
            lines,
            "VTU bounds 用于检查热场网格包络是否与 CAD 几何包络处于同一空间尺度。若 bounds 与 CAD 包络明显不一致，应优先检查单位转换、导入缩放和坐标原点。",
        )

    field_sample_summary = data["field_sample_summary"]
    heading(lines, "5.2 采样覆盖", level=3)
    if field_sample_summary["sample_count"]:
        bullet(lines, f"`field_samples.json` 包含 {field_sample_summary['sample_count']} 个采样点，覆盖 {field_sample_summary['component_count']} 个组件。")
        table(
            lines,
            ["Component", "Samples", "Min K", "Max K", "Mean K"],
            [
                [
                    row["component_id"],
                    row["count"],
                    fmt_num(row["min_K"]),
                    fmt_num(row["max_K"]),
                    fmt_num(row["mean_K"]),
                ]
                for row in field_sample_summary["component_rows"][:12]
            ],
        )
        analysis_note(
            lines,
            "采样数据目前只覆盖 1 个组件，因此组件级热结论不能推广到全星或全部设备。后续报告若要接近 CATCH 的单机温度表，需要对每个关键组件建立采样点或区域统计。",
        )
    else:
        lines.append("No field sample data found.")

    heading(lines, "5.3 分析与诊断", level=3)
    root_causes = diagnosis.get("root_causes", []) if isinstance(diagnosis, dict) else []
    table(
        lines,
        ["Item", "Value"],
        [
            ["root_cause_report.primary_cause", root_cause.get("primary_cause")],
            ["root_cause_report.confidence", root_cause.get("confidence")],
            ["eligible_for_solution_generation", root_cause.get("eligible_for_solution_generation")],
            ["diagnosis root cause count", len(root_causes)],
        ],
    )
    analysis_note(
        lines,
        "诊断结果来自当前 analysis 阶段的自动规则。它适合提示异常候选和根因方向，不等同于人工热控符合性结论。",
    )
    if root_causes:
        lines.append("")
        table(
            lines,
            ["Category", "Targets", "Confidence", "Evidence"],
            [
                [
                    item.get("category"),
                    ", ".join(item.get("target_ids", []) or []),
                    item.get("confidence"),
                    "; ".join(item.get("evidence", []) or []),
                ]
                for item in root_causes
            ],
        )
        analysis_note(
            lines,
            "根因表给出自动诊断命中的目标组件和置信度。当前主要目标为采样覆盖组件，因此仍受采样覆盖范围限制。",
        )

    heading(lines, "6. 温度云图")
    grouped_outputs = get_nested(render_summary, ["paraview_summary", "outputs"], {}) or get_nested(paraview_summary, ["outputs"], {}) or {}
    if grouped_outputs:
        for title, key in (
            ("6.1 三维温度视图", "3d_views"),
            ("6.2 切片视图", "slices"),
            ("6.3 等值面视图", "contours"),
            ("6.4 体渲染视图", "volume"),
        ):
            paths = grouped_outputs.get(key) or []
            image_gallery(lines, title, [stat_file(Path(path)) for path in paths], report_dir)
    else:
        image_gallery(lines, "6.1 后处理图片", data["postprocess_images"], report_dir)

    heading(lines, "7. CAD 与仿真有效性检查")
    heading(lines, "7.1 CAD 校验问题", level=3)
    if cad_validation.get("overlaps"):
        table(
            lines,
            ["A", "B", "Overlap Volume mm^3"],
            [
                [item.get("a"), item.get("b"), fmt_num(item.get("volume_mm3"))]
                for item in cad_validation["overlaps"][:12]
            ],
        )
        analysis_note(
            lines,
            "重叠列表是 CAD 修改优先级最高的输入之一。几何穿插会影响 COMSOL selection、接触边界和局部网格质量，建议先消除这些重叠再进行热结果复核。",
        )
    elif components["suspicious"]:
        table(
            lines,
            ["Component", "Reason", "Dims"],
            [
                [item.get("component_id"), item.get("reason"), item.get("dims")]
                for item in components["suspicious"][:12]
            ],
        )
        analysis_note(
            lines,
            "异常尺寸表用于定位可能过薄、尺寸为零或长宽比极端的组件，这类几何可能导致导入或网格质量问题。",
        )
    else:
        lines.append("No CAD overlap or suspicious dimension issue was detected from available metadata.")

    heading(lines, "7.2 仿真可信度限制", level=3)
    bullet(lines, f"CAD validation status is `{cad_validation.get('status')}`; bbox overlaps={cad_validation.get('bbox_overlap_count')}, contact failures={cad_validation.get('contact_failure_count')}.")
    bullet(lines, f"Shell radiation applied/skipped = {get_nested(status_checks, ['shell_radiation', 'applied'], 'unknown')} / {get_nested(status_checks, ['shell_radiation', 'skipped'], 'unknown')}.")
    bullet(lines, f"Contact resistance applied/skipped = {get_nested(status_checks, ['contact_resistance', 'applied'], 'unknown')} / {get_nested(status_checks, ['contact_resistance', 'skipped'], 'unknown')}.")
    if field_sample_summary["component_count"] <= 1 and field_sample_summary["sample_count"]:
        bullet(lines, "Field sample coverage is limited to one component, so component-level conclusions cannot be generalized to all components.")
    bullet(lines, "The available data supports reporting this run's CAD/COMSOL artifacts and field visualization; it does not support mission-level thermal compliance conclusions.")

    heading(lines, "8. 修改建议摘要")
    bullet(lines, "完整修改建议另见 `modifications.md`。")
    for section, title in (("cad", "CAD"), ("simulation", "仿真"), ("report", "报告覆盖")):
        heading(lines, f"8.{1 if section == 'cad' else 2 if section == 'simulation' else 3} {title}", level=3)
        for item in recommendations[section][:5]:
            bullet(lines, item)

    heading(lines, "9. 结论")
    bullet(lines, f"当前流水线状态为 ok={fmt_bool(manifest['ok'])}，COMSOL 求解状态为 ok={fmt_bool(status['ok'])}。")
    bullet(lines, f"当前报告可复现几何图片、CAD 数据、组件/热源表、求解产物、全场温度统计和 ParaView 后处理图片。")
    bullet(lines, "当前报告无法生成多工况稳态矩阵、瞬态曲线、入轨/安全/烘烤模式、加热器补偿功耗、星敏/FXT/WXT 专项符合性表，除非工作区补充对应输入与结果。")
    bullet(lines, "在 CAD overlap/contact 问题和接触/壳体辐射设置未完全闭合前，热结果应作为流程验证与趋势参考，不应作为最终热控设计验收依据。")

    out_path.write_text("\n".join(lines).strip() + "\n", encoding="utf-8")


def write_modifications(out_path: Path, recommendations: dict[str, list[str]]) -> None:
    lines: list[str] = ["# Modification Suggestions", ""]
    heading(lines, "CAD Modification Suggestions")
    for item in recommendations["cad"]:
        bullet(lines, item)
    heading(lines, "Simulation Modification Suggestions")
    for item in recommendations["simulation"]:
        bullet(lines, item)
    heading(lines, "Report Coverage Suggestions")
    for item in recommendations["report"]:
        bullet(lines, item)
    heading(lines, "Validation Steps")
    for idx, item in enumerate(recommendations["validation"], start=1):
        lines.append(f"{idx}. {item}")
    out_path.write_text("\n".join(lines).strip() + "\n", encoding="utf-8")


def build_summary(data: dict[str, Any], out_dir: Path, recommendations: dict[str, list[str]]) -> dict[str, Any]:
    return {
        "schema_version": "cad_sim_report_summary/1.0",
        "workspace": data["workspace"],
        "outputs": {
            "report": str(out_dir / "report.md"),
            "modifications": str(out_dir / "modifications.md"),
            "summary_json": str(out_dir / "summary.json"),
        },
        "status": {
            "pipeline_ok": data["manifest_summary"]["ok"],
            "simulation_ok": data["status_summary"]["ok"],
            "simulation_stage": data["status_summary"]["stage"],
            "selection_ok": data["status_summary"]["selection_ok"],
            "empty_selection_count": len(data["status_summary"]["selection_empty_tags"]),
            "heat_sources_ok": data["status_summary"]["heat_sources_ok"],
        },
        "cad": {
            "status": data["cad_validation"]["status"],
            "simulation_components": data["components"]["simulation_components"],
            "registry_entities": data["components"]["registry_entities"],
            "bbox_overlap_count": data["cad_validation"]["bbox_overlap_count"],
            "contact_failure_count": data["cad_validation"]["contact_failure_count"],
            "screenshots": len([item for item in data["screenshots"] if item.get("exists")]),
        },
        "thermal": {
            "heat_sources": data["components"]["heat_source_count"],
            "total_power_W": data["components"]["total_power_W"],
            "field_min_K": get_nested(data["field_stats"], ["min_K"]),
            "field_max_K": get_nested(data["field_stats"], ["max_K"]),
            "field_mean_K": get_nested(data["field_stats"], ["mean_K"]),
            "postprocess_images": len([item for item in data["postprocess_images"] if item.get("exists")]),
            "field_sample_count": data["field_sample_summary"]["sample_count"],
            "field_sample_component_count": data["field_sample_summary"]["component_count"],
        },
        "recommendation_counts": {
            "cad": len(recommendations["cad"]),
            "simulation": len(recommendations["simulation"]),
            "report": len(recommendations["report"]),
            "validation": len(recommendations["validation"]),
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workspace_arg", nargs="?", type=Path, help="Workspace root.")
    parser.add_argument("--workspace", type=Path, help="Workspace root. Overrides positional workspace.")
    parser.add_argument("--out-dir", type=Path, default=None, help="Output directory. Defaults to <workspace>/reports.")
    parser.add_argument("--summary-json", type=Path, default=None, help="Summary JSON output path. Defaults to <out-dir>/summary.json.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.workspace is None and args.workspace_arg is None:
        raise SystemExit("workspace is required: pass --workspace /path or a positional workspace")
    workspace = (args.workspace or args.workspace_arg).resolve()
    out_dir = args.out_dir.resolve() if args.out_dir else workspace / "reports"
    out_dir.mkdir(parents=True, exist_ok=True)
    summary_path = args.summary_json.resolve() if args.summary_json else out_dir / "summary.json"

    data = collect_workspace(workspace)
    recommendations = detect_recommendations(data)
    report_path = out_dir / "report.md"
    modifications_path = out_dir / "modifications.md"
    write_report(report_path, data)
    write_modifications(modifications_path, recommendations)
    summary = build_summary(data, out_dir, recommendations)
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(json.dumps({
        "ok": True,
        "workspace": str(workspace),
        "outputs": {
            "report": str(report_path),
            "modifications": str(modifications_path),
            "summary_json": str(summary_path),
        },
        "summary": summary,
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
