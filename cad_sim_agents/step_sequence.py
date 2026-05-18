from __future__ import annotations

from typing import Any

from codex_agents.step_registry import default_steps as registry_default_steps


def default_steps() -> list[Any]:
    return registry_default_steps()
