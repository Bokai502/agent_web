from __future__ import annotations

from pathlib import Path


VENDOR_ROOT = Path(__file__).resolve().parent
MODULE_DB_ROOT = VENDOR_ROOT / "data" / "module_db"
THERMAL_DB = MODULE_DB_ROOT / "热仿真数据库.xlsx"
CAD_PREFIX = MODULE_DB_ROOT / "cad"
IMAGE_PREFIX = MODULE_DB_ROOT / "img"
DATASHEET_PREFIX = MODULE_DB_ROOT / "datasheet"

LAYOUT3DCUBE_ROOT = VENDOR_ROOT / "layout_runtime" / "layout3dcube_runtime"
LAYOUT_DIST_YAML = LAYOUT3DCUBE_ROOT / "config" / "dist_v2.yaml"
BOM_DIR = MODULE_DB_ROOT / "generated_boms"
WORKSPACE_DIR = VENDOR_ROOT.parent / "runs"
