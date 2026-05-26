from __future__ import annotations

import sys

from codex_agents.package_paths import VENDOR_ROOT


def prefer_vendor_imports() -> None:
    vendor_paths = [
        VENDOR_ROOT,
        VENDOR_ROOT / "shared_contracts",
        VENDOR_ROOT / "simulation_runtime",
        VENDOR_ROOT / "paraview_runtime",
    ]
    for path in reversed([str(item) for item in vendor_paths]):
        if path in sys.path:
            sys.path.remove(path)
        sys.path.insert(0, path)
