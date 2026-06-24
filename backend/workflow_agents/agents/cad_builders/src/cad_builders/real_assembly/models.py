"""Data models for supplemental real assembly CAD builds."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class CadRealAssemblyBuildRequest:
    workspace_dir: str | Path
    spec_path: str | Path | None = None
    output_dir: str | Path | None = None
    doc_name: str | None = None
    host: str | None = None
    port: int | None = None


@dataclass(frozen=True)
class CadRealAssemblyBuildResult:
    success: bool
    backend: str
    spec_path: Path
    normalized_input_path: Path
    document: str | None
    step_path: None
    temporary_step_path: None
    glb_path: Path | None
    hybrid_summary_path: Path | None
    component_count: int
    freecad: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {
            "success": self.success,
            "backend": self.backend,
            "spec_path": str(self.spec_path),
            "normalized_input_path": str(self.normalized_input_path),
            "document": self.document,
            "step_path": self.step_path,
            "temporary_step_path": self.temporary_step_path,
            "glb_path": str(self.glb_path) if self.glb_path else None,
            "hybrid_summary_path": str(self.hybrid_summary_path) if self.hybrid_summary_path else None,
            "component_count": self.component_count,
            "freecad": self.freecad,
        }
