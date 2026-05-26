from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@dataclass
class StageResult:
    """Standard result envelope required by reconstructed pipeline stages."""

    stage_name: str
    status: str
    inputs: dict[str, Any] = field(default_factory=dict)
    outputs: dict[str, Any] = field(default_factory=dict)
    checks: dict[str, Any] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    errors: list[dict[str, Any] | str] = field(default_factory=list)
    started_at: str = field(default_factory=utc_now_iso)
    finished_at: str | None = None

    def finish(self, status: str | None = None) -> "StageResult":
        if status is not None:
            self.status = status
        self.finished_at = utc_now_iso()
        return self

    def to_dict(self) -> dict[str, Any]:
        return {
            "stage_name": self.stage_name,
            "status": self.status,
            "inputs": _stringify_paths(self.inputs),
            "outputs": _stringify_paths(self.outputs),
            "checks": self.checks,
            "warnings": self.warnings,
            "errors": self.errors,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
        }


def _stringify_paths(value: Any) -> Any:
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, Mapping):
        return {str(key): _stringify_paths(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_stringify_paths(item) for item in value]
    return value
