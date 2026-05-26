from __future__ import annotations

from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parent
VENDOR_ROOT = PACKAGE_ROOT / "vendor"


def vendor_path(*parts: str) -> Path:
    return VENDOR_ROOT.joinpath(*parts)
