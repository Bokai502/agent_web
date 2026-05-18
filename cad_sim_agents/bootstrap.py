from __future__ import annotations

import sys

from codex_agents.package_paths import VENDOR_ROOT


def prefer_vendor_imports() -> None:
    vendor_paths = [
        VENDOR_ROOT,
        VENDOR_ROOT / "layout_runtime",
        VENDOR_ROOT / "shared_contracts",
    ]
    for path in reversed([str(item) for item in vendor_paths]):
        if path in sys.path:
            sys.path.remove(path)
        sys.path.insert(0, path)

    import apps

    vendor_apps = str(VENDOR_ROOT / "layout_runtime" / "apps")
    app_paths = list(getattr(apps, "__path__", []))
    if vendor_apps in app_paths:
        app_paths.remove(vendor_apps)
    app_paths.insert(0, vendor_apps)
    apps.__path__ = app_paths
