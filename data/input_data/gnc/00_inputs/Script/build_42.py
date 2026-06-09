#!/usr/bin/env python3
import argparse
import shutil
import subprocess
import sys
from pathlib import Path


def parse_args():
    parser = argparse.ArgumentParser(description="Build the workspace-local 42 executable.")
    parser.add_argument("--workspace-dir", default="", help="Injected workspace_dir. Defaults to this script's parent workspace.")
    parser.add_argument("--jobs", type=int, default=4)
    parser.add_argument("--force-rebuild", action="store_true")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--gui", action="store_true", help="Build with the 42 graphics front end enabled.")
    mode.add_argument("--headless", action="store_true", help="Build without GUI libraries.")
    return parser.parse_args()


def default_workspace_dir():
    return Path(__file__).resolve().parents[1]


def require_tool(name):
    path = shutil.which(name)
    if path is None:
        raise SystemExit(f"Required tool not found on PATH: {name}")
    return path


def pkg_exists(name):
    pkg_config = shutil.which("pkg-config")
    if pkg_config is None:
        return False
    result = subprocess.run(
        [pkg_config, "--exists", name],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    return result.returncode == 0


def check_gui_deps():
    if not sys.platform.startswith("linux"):
        return
    missing = [name for name in ("glut", "glu", "gl") if not pkg_exists(name)]
    if missing:
        joined = ", ".join(missing)
        raise SystemExit(
            f"Missing Linux GUI build dependencies: {joined}. "
            "Install the GLUT, GLU, and OpenGL development packages for this system."
        )


def main():
    args = parse_args()
    workspace_dir = Path(args.workspace_dir).resolve() if args.workspace_dir else default_workspace_dir()
    run_root = workspace_dir / "Output" / "Run"
    build_dir = run_root / "build"
    makefile = run_root / "Makefile"

    if not makefile.exists():
        raise SystemExit(f"Makefile not found: {makefile}")

    build_dir.mkdir(parents=True, exist_ok=True)
    make = require_tool("make")
    enable_gui = "1" if args.gui else "0"
    if args.gui:
        check_gui_deps()

    cmd = [make]
    if args.force_rebuild:
        cmd.append("-B")
    cmd.extend([f"-j{args.jobs}", f"ENABLE_GUI={enable_gui}"])

    print(f"Building in {run_root}")
    print(" ".join(cmd))
    subprocess.run(cmd, cwd=run_root, check=True)


if __name__ == "__main__":
    main()
