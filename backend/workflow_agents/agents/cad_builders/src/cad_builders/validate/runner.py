"""Class wrapper for split CAD output validation."""

from __future__ import annotations

import importlib.util
import contextlib
import io
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class CadValidateRequest:
    workspace_dir: str | Path
    spec_path: str | Path | None = None
    cad_dir: str | Path | None = None
    max_occupancy_ratio: float = 1.0
    mount_tolerance_mm: float = 0.5
    overlap_tolerance_mm3: float = 1e-3
    report_path: str | Path | None = None
    echo_validator_output: bool = False


class CadValidateRunner:
    """Run the existing split CAD validation script through a class API."""

    def __init__(self, *, script_path: str | Path | None = None) -> None:
        self.script_path = Path(script_path).expanduser().resolve() if script_path else default_validate_script_path()
        self._module: Any | None = None

    def validate(self, request: CadValidateRequest) -> dict[str, Any]:
        module = self._load_module()
        old_parse_args = module.parse_args
        try:
            module.parse_args = lambda: request_to_namespace(request)
            try:
                if request.echo_validator_output:
                    exit_code = int(module.main())
                else:
                    with contextlib.redirect_stdout(io.StringIO()):
                        exit_code = int(module.main())
            except SystemExit as exc:
                exit_code = int(exc.code or 0)
        finally:
            module.parse_args = old_parse_args
        report = getattr(module, "_LAST_REPORT", None)
        if isinstance(report, dict):
            report = dict(report)
            report.setdefault("exit_code", exit_code)
            return report
        return {"success": exit_code == 0, "exit_code": exit_code}

    def _load_module(self) -> Any:
        if self._module is not None:
            return self._module
        spec = importlib.util.spec_from_file_location("cad_validate_outputs", self.script_path)
        if spec is None or spec.loader is None:
            raise RuntimeError(f"Cannot load validate_spec_outputs.py from {self.script_path}")
        module = importlib.util.module_from_spec(spec)
        script_dir = str(self.script_path.parent)
        old_path = list(sys.path)
        try:
            if script_dir not in sys.path:
                sys.path.insert(0, script_dir)
            spec.loader.exec_module(module)
        finally:
            sys.path = old_path
        self._module = module
        return module


def request_to_namespace(request: CadValidateRequest):
    import argparse

    return argparse.Namespace(
        workspace_dir=str(Path(request.workspace_dir).expanduser().resolve()),
        spec=str(Path(request.spec_path).expanduser().resolve()) if request.spec_path else None,
        cad_dir=str(Path(request.cad_dir).expanduser().resolve()) if request.cad_dir else None,
        max_occupancy_ratio=request.max_occupancy_ratio,
        mount_tolerance_mm=request.mount_tolerance_mm,
        overlap_tolerance_mm3=request.overlap_tolerance_mm3,
        report_path=str(Path(request.report_path).expanduser().resolve()) if request.report_path else None,
    )


def default_validate_script_path() -> Path:
    return (
        Path(__file__).resolve().parent
        / "scripts"
        / "validate_spec_outputs.py"
    )
