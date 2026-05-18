from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class StageExecution:
    stage: dict[str, Any]
    continue_pipeline: bool
