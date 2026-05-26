"""Workspace-level pipeline.log helpers for FreeCAD CLI commands."""

from __future__ import annotations

import logging
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path
from typing import Iterator

from freecad_cli_tools.runtime_config import get_default_workspace_dir

LOGGER_NAME = "freecad_cli_tools.pipeline"
DEFAULT_LOG_FILE_NAME = "pipeline.log"
_CURRENT_STEP: ContextVar[str] = ContextVar("freecad_pipeline_step", default="-")


def get_pipeline_logger(name: str | None = None) -> logging.Logger:
    if name:
        return logging.getLogger(f"{LOGGER_NAME}.{name}")
    return logging.getLogger(LOGGER_NAME)


def configure_pipeline_logging(*, command: str, workspace: Path | None = None) -> Path:
    workspace_root = workspace or get_default_workspace_dir()
    log_path = workspace_root / "logs" / DEFAULT_LOG_FILE_NAME
    log_path.parent.mkdir(parents=True, exist_ok=True)

    logger = get_pipeline_logger()
    logger.setLevel(logging.DEBUG)
    logger.propagate = False

    resolved_target = log_path.resolve()
    for handler in logger.handlers:
        if isinstance(handler, logging.FileHandler) and Path(handler.baseFilename).resolve() == resolved_target:
            return log_path

    file_handler = logging.FileHandler(log_path, encoding="utf-8")
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(
        logging.Formatter(
            fmt="%(asctime)s %(levelname)s [cad_agent] [%(pipeline_step)s] [%(name)s] %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
    )
    file_handler.addFilter(_StepContextFilter())
    logger.addHandler(file_handler)
    logger.info("freecad command started: %s workspace=%s", command, workspace_root)
    return log_path


@contextmanager
def pipeline_step(step: str) -> Iterator[None]:
    token = _CURRENT_STEP.set(step)
    try:
        yield
    finally:
        _CURRENT_STEP.reset(token)


class _StepContextFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.pipeline_step = _CURRENT_STEP.get()
        return True
