from __future__ import annotations

from typing import Any

from codex_agents.context import BomExternalToolsPipelineContext
from codex_agents.logging_utils import get_logger
from codex_agents.results import StageExecution

logger = get_logger("step")


def stage_result_execution(
    ctx: BomExternalToolsPipelineContext,
    result: Any,
    *,
    log_filename: str,
    continue_on_completed: bool = True,
    force_continue: bool | None = None,
) -> StageExecution:
    stage = result.to_dict()
    ctx.write_stage_log(log_filename, stage)
    logger.info(
        "stage result: stage=%s status=%s artifact=%s",
        stage.get("stage_name"),
        stage.get("status"),
        ctx.logs_dir / log_filename,
    )
    if force_continue is not None:
        continue_pipeline = force_continue
    else:
        continue_pipeline = result.status == "completed" if continue_on_completed else True
    logger.debug("stage continuation: stage=%s continue=%s", stage.get("stage_name"), continue_pipeline)
    return StageExecution(stage=stage, continue_pipeline=continue_pipeline)


def require_layout_result(ctx: BomExternalToolsPipelineContext) -> dict[str, Any]:
    if ctx.layout_result is None:
        raise RuntimeError("layout_result is required before geometry edit")
    return ctx.layout_result
