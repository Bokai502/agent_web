"""Data models for placeholder box CAD builds."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any


SCREENSHOT_NAMES = ("front", "back", "left", "right", "top", "bottom", "isometric")


@dataclass(frozen=True)
class CadBoxBuildRequest:
    workspace_dir: str | Path
    spec_path: str | Path | None = None
    output_dir: str | Path | None = None
    doc_name: str | None = None
    host: str | None = None
    port: int | None = None


@dataclass(frozen=True)
class CadBoxBuildResult:
    success: bool
    spec_path: Path
    document: str | None
    glb_path: Path | None
    screenshots: dict[str, Any]
    component_count: int | None
    wall_count: int | None
    freecad: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {
            "success": self.success,
            "spec_path": str(self.spec_path),
            "document": self.document,
            "glb_path": str(self.glb_path) if self.glb_path else None,
            "screenshots": self.screenshots,
            "component_count": self.component_count,
            "wall_count": self.wall_count,
            "freecad": self.freecad,
        }
