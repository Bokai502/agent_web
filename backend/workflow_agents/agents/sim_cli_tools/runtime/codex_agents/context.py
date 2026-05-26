from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from codex_agents.config import BomExternalToolsPipelineConfig
from codex_agents.local_io import read_json, write_json
from codex_agents.local_paths import build_run_tree
from codex_agents.logging_utils import ensure_file_logging, get_logger
from codex_agents.stage_adapters import case_stage, write_manifest

logger = get_logger("context")


@dataclass
class BomExternalToolsPipelineContext:
    config: BomExternalToolsPipelineConfig
    restore_existing: bool = True
    paths: dict[str, Path] = field(init=False)
    stages: list[dict[str, Any]] = field(default_factory=list)
    layout_result: dict[str, Any] | None = None
    geometry_result: dict[str, Any] | None = None
    stable_bom_json: Path | None = None

    def __post_init__(self) -> None:
        self.paths = build_run_tree(self.config.run_root)
        if self.restore_existing:
            self.restore_from_disk()

    @property
    def logs_dir(self) -> Path:
        return self.paths["logs"]

    @property
    def pipeline_inputs_dir(self) -> Path:
        return self.paths["run_root"] / ".pipeline_inputs"

    def prepare_bom_snapshot(self) -> Path:
        source = self.config.bom_json.expanduser().resolve()
        target = (self.pipeline_inputs_dir / "real_bom.json").resolve()
        if source != target:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(source.read_bytes())
            logger.info("prepared stable BOM snapshot: source=%s snapshot=%s", source, target)
        self.stable_bom_json = target
        return target

    def resolved_source_bom(self) -> Path:
        if self.stable_bom_json and self.stable_bom_json.exists():
            return self.stable_bom_json
        if self.layout_result and self.layout_result.get("bom"):
            layout_bom = Path(str(self.layout_result["bom"])).expanduser()
            if layout_bom.exists():
                self.stable_bom_json = layout_bom
                return layout_bom
        snapshot = self.pipeline_inputs_dir / "real_bom.json"
        if snapshot.exists():
            self.stable_bom_json = snapshot
            return snapshot
        return self.config.bom_json

    def write_stage_log(self, filename: str, result: dict[str, Any]) -> None:
        ensure_file_logging()
        path = write_json(self.logs_dir / filename, result)
        logger.debug("wrote stage artifact: %s", path)

    def append_stage(self, stage: dict[str, Any]) -> None:
        stage_name = stage.get("stage_name")
        if stage_name:
            self.stages = [existing for existing in self.stages if existing.get("stage_name") != stage_name]
        self.stages.append(stage)
        logger.debug("recorded stage: %s status=%s", stage_name, stage.get("status"))

    def write_manifest(self) -> dict[str, Any]:
        ensure_file_logging()
        manifest = write_manifest(self.paths, self.stages)
        logger.info(
            "manifest written: %s stages=%d ok=%s",
            self.paths["run_root"] / "run_manifest.json",
            len(self.stages),
            manifest.get("ok"),
        )
        return manifest

    def restore_from_disk(self) -> None:
        manifest_path = self.paths["run_root"] / "run_manifest.json"
        if manifest_path.exists():
            manifest = read_json(manifest_path)
            self.stages = list(manifest.get("stages", []))
            logger.info("restored manifest: %s stages=%d", manifest_path, len(self.stages))

        existing_stage_names = {stage.get("stage_name") for stage in self.stages}
        for filename in (
            "layout_generate_stage_result.json",
            "geometry_validate_stage_result.json",
            "simulation_run_stage_result.json",
            "field_export_stage_result.json",
            "postprocess_stage_result.json",
            "case_build_stage_result.json",
            "analysis_stage_result.json",
            "suggestion_stage_result.json",
        ):
            stage_path = self.logs_dir / filename
            if stage_path.exists():
                stage = self._stage_from_log(filename, read_json(stage_path))
                stage_name = stage.get("stage_name")
                if stage_name and stage_name not in existing_stage_names:
                    self.append_stage(stage)
                    existing_stage_names.add(stage_name)
                    logger.info("restored stage artifact: %s", stage_path)

        raw_layout_path = self.logs_dir / "layout_generate_raw_result.json"
        if raw_layout_path.exists():
            self.layout_result = read_json(raw_layout_path)
            logger.debug("restored raw layout result: %s", raw_layout_path)
            if self.layout_result.get("bom"):
                layout_bom = Path(str(self.layout_result["bom"])).expanduser()
                if layout_bom.exists():
                    self.stable_bom_json = layout_bom

        geometry_result_path = self.logs_dir / "geometry_validate_stage_result.json"
        if geometry_result_path.exists():
            self.geometry_result = read_json(geometry_result_path)
            logger.debug("restored geometry result: %s", geometry_result_path)

    def _stage_from_log(self, filename: str, log_data: dict[str, Any]) -> dict[str, Any]:
        if log_data.get("stage_name"):
            return log_data
        if filename == "geometry_validate_stage_result.json":
            return case_stage("geometry_validate", log_data)
        return log_data

    def completed_stage_names(self) -> set[str]:
        return {
            str(stage.get("stage_name"))
            for stage in self.stages
            if stage.get("status") in {"completed", "completed_with_unplaced"}
        }
