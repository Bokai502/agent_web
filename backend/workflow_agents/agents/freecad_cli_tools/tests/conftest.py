from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))


@pytest.fixture(autouse=True)
def configured_freecad_workspace(monkeypatch, tmp_path: Path) -> None:
    import freecad_cli_tools.runtime_config as runtime_config

    config_path = tmp_path / "config.json"
    config_path.write_text(
        json.dumps({"freecad": {"workspaceDir": str(tmp_path)}}),
        encoding="utf-8",
    )
    monkeypatch.setattr(runtime_config, "CODEX_WEB_CONFIG_PATH", config_path)
    monkeypatch.setattr(runtime_config, "_CONFIG_CACHE", None)
    monkeypatch.setattr(runtime_config, "_WORKSPACE_OVERRIDE", None)
