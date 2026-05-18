from __future__ import annotations

from pathlib import Path

from codex_agents import dependencies
from codex_agents.config import BomExternalToolsPipelineConfig
from codex_agents.context import BomExternalToolsPipelineContext
from codex_agents.external_tool_launchers import load_simulation_outputs_in_remote_tools
from codex_agents.logging_utils import ensure_file_logging, get_logger, redirect_output_to_logger
from codex_agents.results import StageExecution
from codex_agents.stage_adapters import case_stage, layout_stage_result, select_geometry_step
from codex_agents.stage_configs import (
    geometry_edit_call_kwargs,
    layout_call_kwargs,
    postprocess_stage_config,
    simulation_stage_config,
)
from codex_agents.step_base import require_layout_result, stage_result_execution

logger = get_logger("steps")


class LayoutGenerateStep:
    def run(self, ctx: BomExternalToolsPipelineContext) -> StageExecution:
        stable_bom = ctx.prepare_bom_snapshot()
        logger.info("layout_generate input bom=%s stable_bom=%s run_root=%s", ctx.config.bom_json, stable_bom, ctx.paths["run_root"])
        with redirect_output_to_logger(logger):
            layout_result = dependencies.run_one_bom_layout(
                **layout_call_kwargs(ctx.config, ctx.paths["run_root"], bom_json=stable_bom)
            )
        ensure_file_logging()
        ctx.layout_result = layout_result
        stage = layout_stage_result(layout_result)
        ctx.write_stage_log("layout_generate_raw_result.json", layout_result)
        ctx.write_stage_log("layout_generate_stage_result.json", stage)
        logger.info("layout_generate status=%s n_unplaced=%s", stage.get("status"), stage.get("checks", {}).get("n_unplaced"))
        return StageExecution(stage=stage, continue_pipeline=True)


class GeometryEditStep:
    def run(self, ctx: BomExternalToolsPipelineContext) -> StageExecution:
        layout_result = require_layout_result(ctx)
        stable_bom = ctx.resolved_source_bom()
        logger.info("geometry_validate input layout_dir=%s source_bom=%s", layout_result.get("layout_dir"), stable_bom)
        with redirect_output_to_logger(logger):
            geometry_result = dependencies._run_one_geometry_edit_loop_test(
                **geometry_edit_call_kwargs(ctx.config, ctx.paths, layout_result, bom_json=stable_bom)
            )
        ctx.geometry_result = geometry_result
        stage = case_stage("geometry_validate", geometry_result)
        ctx.write_stage_log("geometry_validate_raw_result.json", geometry_result)
        ctx.write_stage_log("geometry_validate_stage_result.json", stage)
        logger.info(
            "geometry_validate status=%s planner_execution_ok=%s unresolved_missing_count=%s",
            stage.get("status"),
            stage.get("checks", {}).get("planner_execution_ok"),
            stage.get("checks", {}).get("unresolved_missing_count"),
        )
        return StageExecution(stage=stage, continue_pipeline=bool(geometry_result.get("ok")))


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
        if result.status == "completed":
            loader_result = load_simulation_outputs_in_remote_tools(ctx.paths["simulation"])
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
        selected = select_geometry_step(ctx.paths["layout"], ctx.paths["run_root"] / ctx.config.geometry_edit_dir_name)
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
            result = dependencies.run_case_build(ctx.paths["run_root"], ctx.paths["case_build"], {"run_root": ctx.paths["run_root"]})
        return stage_result_execution(ctx, result, log_filename="case_build_stage_result.json")


class AnalysisStep:
    def run(self, ctx: BomExternalToolsPipelineContext) -> StageExecution:
        logger.info("analysis input_dir=%s output_dir=%s", ctx.paths["case_build"], ctx.paths["analysis"])
        with redirect_output_to_logger(logger):
            result = dependencies.run_analysis(ctx.paths["case_build"], ctx.paths["analysis"], {})
        return stage_result_execution(ctx, result, log_filename="analysis_stage_result.json")


class SuggestionStep:
    def run(self, ctx: BomExternalToolsPipelineContext) -> StageExecution:
        logger.info("suggestion input_dir=%s output_dir=%s", ctx.paths["analysis"], ctx.paths["suggestions"])
        with redirect_output_to_logger(logger):
            result = dependencies.run_suggestion(
                ctx.paths["analysis"],
                ctx.paths["suggestions"],
                {"component_index_path": ctx.paths["case_build"] / "component_index.json"},
            )
        return stage_result_execution(ctx, result, log_filename="suggestion_stage_result.json", force_continue=True)
