from __future__ import annotations

from pathlib import Path

from codex_agents import dependencies
from codex_agents.config import BomExternalToolsPipelineConfig
from codex_agents.context import BomExternalToolsPipelineContext
from codex_agents.external_tool_launchers import load_simulation_outputs_in_remote_tools
from codex_agents.logging_utils import ensure_file_logging, get_logger, redirect_output_to_logger
from codex_agents.results import StageExecution
from codex_agents.stage_adapters import select_geometry_step
from codex_agents.stage_configs import (
    postprocess_stage_config,
    simulation_stage_config,
)
from codex_agents.step_base import stage_result_execution

logger = get_logger("steps")


class SimulationStep:
    def run(self, ctx: BomExternalToolsPipelineContext) -> StageExecution:
        geometry_step_path = self.select_geometry_step(ctx)
        logger.info("simulation input geometry_step=%s backend=%s", geometry_step_path, ctx.config.simulation_backend)
        with redirect_output_to_logger(logger):
            result = dependencies.run_simulation(
                ctx.paths["layout"],
                ctx.paths["simulation"],
                self.simulation_config(ctx.config, ctx.paths, geometry_step_path),
            )
        if result.status == "completed" and ctx.config.open_external_tools:
            loader_result = load_simulation_outputs_in_remote_tools(
                ctx.paths["simulation"],
                async_launch=ctx.config.open_external_tools_async,
            )
            if not hasattr(result, "checks"):
                result.checks = {}
            if not hasattr(result, "warnings"):
                result.warnings = []
            result.checks["external_tool_loaders"] = loader_result
            for tool_name in ("comsol", "paraview"):
                tool_result = loader_result.get(tool_name, {})
                logger.info(
                    "%s loader status=%s data_file=%s",
                    tool_name,
                    tool_result.get("status"),
                    tool_result.get("data_file"),
                )
                if tool_result.get("status") == "failed":
                    result.warnings.append(
                        f"{tool_name} remote loader failed: {tool_result.get('message') or tool_result.get('reason')}"
                    )
        return stage_result_execution(
            ctx,
            result,
            log_filename="simulation_run_stage_result.json",
            force_continue=result.status == "completed" and not ctx.config.skip_postprocess,
        )

    def select_geometry_step(self, ctx: BomExternalToolsPipelineContext) -> Path:
        selected = select_geometry_step(ctx.paths["layout"], ctx.paths["geometry_edit"])
        logger.debug("selected geometry step: %s", selected)
        return selected

    def simulation_config(
        self,
        config: BomExternalToolsPipelineConfig,
        paths: dict[str, Path],
        geometry_step_path: Path,
    ) -> dict[str, object]:
        return simulation_stage_config(config, paths, geometry_step_path)


class FieldExportStep:
    def run(self, ctx: BomExternalToolsPipelineContext) -> StageExecution:
        logger.info("field_export input simulation_dir=%s output_dir=%s", ctx.paths["simulation"], ctx.paths["postprocess"])
        with redirect_output_to_logger(logger):
            result = dependencies.run_field_export(ctx.paths["simulation"], ctx.paths["postprocess"], {})
        return stage_result_execution(ctx, result, log_filename="field_export_stage_result.json")


class PostprocessStep:
    def run(self, ctx: BomExternalToolsPipelineContext) -> StageExecution:
        logger.info("postprocess input_dir=%s output_dir=%s", ctx.paths["postprocess"], ctx.paths["postprocess"])
        with redirect_output_to_logger(logger):
            result = dependencies.run_postprocess(ctx.paths["postprocess"], ctx.paths["postprocess"], self.postprocess_config(ctx))
        return stage_result_execution(ctx, result, log_filename="postprocess_stage_result.json")

    def postprocess_config(self, ctx: BomExternalToolsPipelineContext) -> dict[str, object]:
        return postprocess_stage_config(ctx.config, ctx.paths)


class CaseBuildStep:
    def run(self, ctx: BomExternalToolsPipelineContext) -> StageExecution:
        logger.info("case_build input run_root=%s output_dir=%s", ctx.paths["run_root"], ctx.paths["case_build"])
        with redirect_output_to_logger(logger):
            result = dependencies.run_case_build(
                ctx.paths["run_root"],
                ctx.paths["case_build"],
                {
                    "run_root": ctx.paths["run_root"],
                    "components_path": ctx.paths["run_root"] / "components.json",
                    "simulation_input_path": ctx.paths["geometry_edit"] / "simulation_input.json",
                },
            )
        return stage_result_execution(ctx, result, log_filename="case_build_stage_result.json")


class AnalysisStep:
    def run(self, ctx: BomExternalToolsPipelineContext) -> StageExecution:
        logger.info("analysis input_dir=%s output_dir=%s", ctx.paths["case_build"], ctx.paths["analysis"])
        with redirect_output_to_logger(logger):
            result = dependencies.run_analysis(ctx.paths["case_build"], ctx.paths["analysis"], {})
        return stage_result_execution(ctx, result, log_filename="analysis_stage_result.json")
