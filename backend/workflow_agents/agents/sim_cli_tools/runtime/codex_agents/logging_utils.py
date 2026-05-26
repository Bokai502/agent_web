from __future__ import annotations

import logging
import sys
from contextvars import ContextVar
from contextlib import contextmanager, redirect_stderr, redirect_stdout
from typing import Iterator
from pathlib import Path


LOGGER_NAME = "codex_agents"
DEFAULT_LOG_FILE_NAME = "pipeline.log"
_LOG_FILE: Path | None = None
_CURRENT_STEP: ContextVar[str] = ContextVar("bom_pipeline_step", default="-")


def get_logger(name: str | None = None) -> logging.Logger:
    if name:
        return logging.getLogger(f"{LOGGER_NAME}.{name}")
    return logging.getLogger(LOGGER_NAME)


def configure_logging(
    *,
    run_root: Path,
    level: str | int = "INFO",
    log_file: Path | None = None,
    quiet: bool = False,
) -> Path:
    global _LOG_FILE
    numeric_level = _coerce_level(level)
    log_path = log_file or run_root / "logs" / DEFAULT_LOG_FILE_NAME
    _LOG_FILE = log_path

    logger = get_logger()
    logger.setLevel(logging.DEBUG)
    logger.propagate = False
    _reset_handlers(logger)

    if not quiet:
        stream_handler = logging.StreamHandler(sys.stderr)
        stream_handler.setLevel(numeric_level)
        stream_handler.setFormatter(logging.Formatter("%(levelname)s [sim_agent] [%(pipeline_step)s] %(message)s"))
        stream_handler.addFilter(_StepContextFilter())
        logger.addHandler(stream_handler)

    return log_path


@contextmanager
def step_logging_context(step: str) -> Iterator[None]:
    token = _CURRENT_STEP.set(step)
    try:
        yield
    finally:
        _CURRENT_STEP.reset(token)


def ensure_file_logging(log_file: Path | None = None) -> Path | None:
    global _LOG_FILE
    if log_file is not None:
        _LOG_FILE = log_file
    if _LOG_FILE is None:
        return None

    logger = get_logger()
    target = _LOG_FILE
    target.parent.mkdir(parents=True, exist_ok=True)
    resolved_target = target.resolve()
    for handler in logger.handlers:
        if isinstance(handler, logging.FileHandler):
            if Path(handler.baseFilename).resolve() == resolved_target and resolved_target.exists():
                return target
            handler.close()
            logger.removeHandler(handler)

    file_handler = logging.FileHandler(target, encoding="utf-8")
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(
        logging.Formatter(
            fmt="%(asctime)s %(levelname)s [sim_agent] [%(pipeline_step)s] [%(name)s] %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
    )
    file_handler.addFilter(_StepContextFilter())
    logger.addHandler(file_handler)
    logger.debug("file logging active: %s", target)
    return target


def _reset_handlers(logger: logging.Logger) -> None:
    for handler in list(logger.handlers):
        handler.close()
        logger.removeHandler(handler)


def _coerce_level(level: str | int) -> int:
    if isinstance(level, int):
        return level
    normalized = level.upper()
    numeric_level = logging.getLevelName(normalized)
    if isinstance(numeric_level, int):
        return numeric_level
    valid_levels = ", ".join(("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"))
    raise ValueError(f"invalid log level {level!r}; expected one of: {valid_levels}")


@contextmanager
def redirect_output_to_logger(logger: logging.Logger, *, stdout_level: int = logging.INFO) -> Iterator[None]:
    stdout_stream = _BufferedLoggerStream(stdout_level)
    stderr_stream = _BufferedLoggerStream(logging.WARNING)
    with redirect_stdout(stdout_stream), redirect_stderr(stderr_stream):
        yield
    ensure_file_logging()
    for level, line in (*stdout_stream.lines, *stderr_stream.lines):
        logger.log(level, line)


class _BufferedLoggerStream:
    def __init__(self, level: int) -> None:
        self.level = level
        self._buffer = ""
        self.lines: list[tuple[int, str]] = []

    def write(self, text: str) -> int:
        self._buffer += text
        while "\n" in self._buffer:
            line, self._buffer = self._buffer.split("\n", 1)
            self._log_line(line)
        return len(text)

    def flush(self) -> None:
        if self._buffer:
            self._log_line(self._buffer)
            self._buffer = ""

    def _log_line(self, line: str) -> None:
        stripped = line.rstrip()
        if stripped:
            self.lines.append((self.level, stripped))


class _StepContextFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.pipeline_step = _CURRENT_STEP.get()
        return True
