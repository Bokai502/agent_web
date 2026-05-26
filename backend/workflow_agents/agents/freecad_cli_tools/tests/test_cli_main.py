from __future__ import annotations

import sys

from freecad_cli_tools.cli import main as cli_main


def test_unified_cli_routes_to_nested_command(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_config_show_main() -> int:
        captured["argv"] = list(sys.argv)
        return 0

    monkeypatch.setattr(cli_main.runtime_config, "main", fake_config_show_main)
    monkeypatch.setattr(
        sys,
        "argv",
        ["freecad-tools", "config", "show", "--workspace", "/tmp/workspace"],
    )

    assert cli_main.main() == 0
    assert captured["argv"] == [
        "freecad-tools config show",
        "--workspace",
        "/tmp/workspace",
    ]


def test_unified_cli_rejects_unknown_command(monkeypatch, capsys) -> None:
    monkeypatch.setattr(sys, "argv", ["freecad-tools", "missing", "command"])

    assert cli_main.main() == 2
    captured = capsys.readouterr()
    assert "unknown command: missing command" in captured.err
    assert "freecad-tools <group> <command>" in captured.err
