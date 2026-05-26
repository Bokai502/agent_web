from __future__ import annotations

import json
import sys
from pathlib import Path

from freecad_cli_tools.cli import main as cli_main
from freecad_cli_tools.cli import progress


def test_update_loop_progress_creates_and_finishes_loop() -> None:
    data: dict[str, object] = {"schema_version": "loop_progress/1.0", "loops": {}}

    progress.update_loop_progress(
        data,
        loop_name="freecad",
        status="running",
        completed=False,
        percentage=12.345,
        now="2026-05-23T01:00:00Z",
    )
    progress.update_loop_progress(
        data,
        loop_name="freecad",
        status="failed",
        completed=True,
        percentage=60.0,
        now="2026-05-23T01:05:00Z",
    )

    loop = data["loops"]["freecad"]  # type: ignore[index]
    assert loop["created_at"] == "2026-05-23T01:00:00Z"
    assert loop["updated_at"] == "2026-05-23T01:05:00Z"
    assert loop["finished_at"] == "2026-05-23T01:05:00Z"
    assert loop["completed"] is True
    assert loop["status"] == "failed"
    assert loop["percentage"] == 100.0
    assert loop["input"] == {
        "loop_name": "freecad",
        "status": "failed",
        "completed": True,
        "percentage": 60.0,
    }


def test_read_progress_removes_legacy_heartbeat_fields(tmp_path: Path) -> None:
    progress_path = tmp_path / "progress.json"
    data = {
        "heartbeat": {"ok": False},
        "loops": {
            "simulation": {
                "status": "running",
                "heartbeat_at": "2026-05-23T01:00:00Z",
            }
        }
    }
    progress_path.write_text(json.dumps(data), encoding="utf-8")

    payload = progress.read_progress(progress_path)

    assert "heartbeat" not in payload
    assert "heartbeat_at" not in payload["loops"]["simulation"]


def test_progress_cli_writes_workspace_progress_json(
    monkeypatch,
    tmp_path: Path,
    capsys,
) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "freecad-progress",
            "--workspace",
            str(workspace),
            "--loop-name",
            "simulation",
            "--status",
            "running",
            "--completed",
            "false",
            "--percentage",
            "40",
        ],
    )

    assert progress.main() == 0

    payload = json.loads((workspace / "logs" / "progress.json").read_text(encoding="utf-8"))
    assert payload["schema_version"] == "loop_progress/1.0"
    assert payload["loops"]["simulation"]["status"] == "running"
    assert payload["loops"]["simulation"]["completed"] is False
    assert payload["loops"]["simulation"]["percentage"] == 40.0
    assert "heartbeat" not in payload
    result = json.loads(capsys.readouterr().out)
    assert result["progress_path"] == str(workspace / "logs" / "progress.json")
    assert "heartbeat" not in result


def test_unified_cli_routes_progress_update(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_progress_main() -> int:
        captured["argv"] = list(sys.argv)
        return 0

    monkeypatch.setattr(cli_main.progress, "main", fake_progress_main)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "freecad-tools",
            "progress",
            "update",
            "--loop-name",
            "freecad",
            "--status",
            "running",
            "--completed",
            "false",
            "--percentage",
            "10",
        ],
    )

    assert cli_main.main() == 0
    assert captured["argv"] == [
        "freecad-tools progress update",
        "--loop-name",
        "freecad",
        "--status",
        "running",
        "--completed",
        "false",
        "--percentage",
        "10",
    ]
