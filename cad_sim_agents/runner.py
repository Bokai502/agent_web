from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

from codex_agents.config import BomExternalToolsPipelineConfig
from codex_agents.context import BomExternalToolsPipelineContext
from codex_agents.logging_utils import get_logger, step_logging_context
from codex_agents.progress import PipelineProgressTracker
from codex_agents.step_registry import PipelineStepSpec, default_step_specs, get_step_spec

logger = get_logger("runner")


def run_bom_external_tools_pipeline(args: argparse.Namespace) -> dict[str, Any]:
    config = BomExternalToolsPipelineConfig.from_namespace(args)
    command = getattr(args, "command", None) or "run-all"
    if command == "run-all":
        return BomExternalToolsPipelineRunner(config).run()
    return BomExternalToolsPipelineRunner(config).run_step(command)


class BomExternalToolsPipelineRunner:
    def __init__(self, config: BomExternalToolsPipelineConfig) -> None:
        self.config = config
        self.step_specs = default_step_specs()

    def run(self) -> dict[str, Any]:
        ctx = BomExternalToolsPipelineContext(self.config, restore_existing=False)
        progress = PipelineProgressTracker(ctx.paths["run_root"], self.step_specs)
        progress.initialize(reset=True)
        logger.info("run-all started with %d steps", len(self.step_specs))
        for spec in self.step_specs:
            with step_logging_context(spec.command_name):
                progress.mark_running(spec.command_name)
                logger.info("step started: %s", spec.command_name)
                step = spec.create_step()
                execution = step.run(ctx)
                ctx.append_stage(execution.stage)
                progress.mark_finished(
                    spec.command_name,
                    status=self._progress_status(execution.stage),
                )
                logger.info(
                    "step finished: %s stage=%s status=%s continue=%s",
                    spec.command_name,
                    execution.stage.get("stage_name"),
                    execution.stage.get("status"),
                    execution.continue_pipeline,
                )
                if not execution.continue_pipeline:
                    manifest = ctx.write_manifest()
                    logger.info("run-all stopped after %s ok=%s", spec.command_name, manifest.get("ok"))
                    return manifest
        manifest = ctx.write_manifest()
        logger.info("run-all finished ok=%s", manifest.get("ok"))
        return manifest

    def run_step(self, command_name: str) -> dict[str, Any]:
        spec = get_step_spec(command_name)
        ctx = BomExternalToolsPipelineContext(self.config)
        progress = PipelineProgressTracker(ctx.paths["run_root"], self.step_specs)
        progress.initialize(reset=False)
        with step_logging_context(spec.command_name):
            logger.info("single step requested: %s", command_name)
            try:
                self._ensure_prerequisites(ctx, spec)
            except RuntimeError as exc:
                progress.mark_blocked(spec.command_name, reason=str(exc))
                raise
            progress.mark_running(spec.command_name)
            logger.info("step started: %s", spec.command_name)
            execution = spec.create_step().run(ctx)
            ctx.append_stage(execution.stage)
            progress.mark_finished(
                spec.command_name,
                status=self._progress_status(execution.stage),
            )
            manifest = ctx.write_manifest()
            logger.info(
                "step finished: %s stage=%s status=%s ok=%s",
                spec.command_name,
                execution.stage.get("stage_name"),
                execution.stage.get("status"),
                manifest.get("ok"),
            )
            return manifest

    def _progress_status(self, stage: dict[str, Any]) -> str:
        return "completed" if stage.get("status") in {"completed", "completed_with_unplaced"} else "failed"

    def _ensure_prerequisites(self, ctx: BomExternalToolsPipelineContext, spec: PipelineStepSpec) -> None:
        completed = ctx.completed_stage_names()
        missing_stages = [stage_name for stage_name in spec.required_stage_names if stage_name not in completed]
        missing_files = [
            relative_path
            for relative_path in spec.required_files
            if not (ctx.paths["run_root"] / Path(relative_path)).exists()
        ]
        if missing_stages or missing_files:
            details = []
            if missing_stages:
                details.append(f"missing completed stages: {', '.join(missing_stages)}")
            if missing_files:
                details.append(f"missing files: {', '.join(missing_files)}")
            logger.error("prerequisite check failed for %s: %s", spec.command_name, "; ".join(details))
            raise RuntimeError(f"cannot run {spec.command_name}: {'; '.join(details)}")
        logger.debug("prerequisite check passed for %s", spec.command_name)
