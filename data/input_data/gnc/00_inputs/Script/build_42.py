#!/usr/bin/env python3
import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path


def parse_args():
    parser = argparse.ArgumentParser(description="Build the mission-local 42 executable.")
    parser.add_argument("--case-root", default="", help="Mission case root. Defaults to this script's parent case.")
    parser.add_argument("--input-root", default="", help="Input package root containing FSW/ and Output/Run/Makefile. Defaults to workspace-dir/00_inputs or this case root.")
    parser.add_argument("--workspace-dir", default="", help="Versioned web workspace directory. Build output defaults under this directory.")
    parser.add_argument("--output-root", default="", help="Build output root. Defaults to workspace-dir/02_sim/42_run or case-root/Output/Run.")
    parser.add_argument("--jobs", type=int, default=4)
    parser.add_argument("--force-rebuild", action="store_true")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--gui", action="store_true", help="Build with the 42 graphics front end enabled.")
    mode.add_argument("--headless", action="store_true", help="Build without GUI libraries.")
    return parser.parse_args()


def default_case_root():
    return Path(__file__).resolve().parents[1]


def default_agnc_root():
    env_root = os.environ.get("AIGNC_ROOT", "").strip()
    if env_root:
        return Path(env_root).resolve()
    for candidate in [Path(__file__).resolve(), *Path(__file__).resolve().parents]:
        if (candidate / "AIGNC" / "42" / "Model").exists():
            return candidate / "AIGNC"
        if (candidate / "42" / "Model").exists() and (candidate / "bridge").exists():
            return candidate
    fallback = Path("/data/lbk/codex_web/AIGNC")
    if (fallback / "42" / "Model").exists():
        return fallback
    raise SystemExit("AIGNC root with 42/Model not found; set AIGNC_ROOT.")


def default_input_root(case_root, workspace_dir):
    if workspace_dir:
        return workspace_dir / "00_inputs"
    return case_root


def output_root_from_args(case_root, workspace_dir, output_root):
    if output_root:
        return Path(output_root).resolve()
    if workspace_dir:
        return workspace_dir / "02_sim" / "42_run"
    return case_root / "Output" / "Run"


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
    case_root = Path(args.case_root).resolve() if args.case_root else default_case_root()
    workspace_dir = Path(args.workspace_dir).resolve() if args.workspace_dir else None
    input_root = Path(args.input_root).resolve() if args.input_root else default_input_root(case_root, workspace_dir)
    run_root = output_root_from_args(case_root, workspace_dir, args.output_root)
    aignc_root = default_agnc_root()
    build_dir = run_root / "build"
    makefile = run_root / "Makefile"
    template_makefile = input_root / "Output" / "Run" / "Makefile"
    fsw_dir = input_root / "FSW" / "ADCS"

    if not template_makefile.exists() and not makefile.exists():
        raise SystemExit(f"Makefile template not found: {template_makefile}")
    if not fsw_dir.exists():
        raise SystemExit(f"FSW directory not found: {fsw_dir}")

    build_dir.mkdir(parents=True, exist_ok=True)
    if not makefile.exists() or (template_makefile.exists() and template_makefile.resolve() != makefile.resolve()):
        shutil.copy2(template_makefile, makefile)
    make = require_tool("make")
    enable_gui = "1" if args.gui else "0"
    if args.gui:
        check_gui_deps()

    cmd = [make]
    if args.force_rebuild:
        cmd.append("-B")
    cmd.extend([f"-j{args.jobs}", f"ENABLE_GUI={enable_gui}"])
    cmd.extend([
        f"AIGNC_ROOT={aignc_root}",
        f"CASE_ROOT={input_root}",
        f"FSWDIR={fsw_dir}/",
        f"SIMDIR={aignc_root / '42'}/",
        f"BRIDGEDIR={aignc_root / 'bridge' / 'mission_bypass'}/",
        f"INOUT={run_root / 'runtime_case' / 'InOut'}/",
        f"GSFCSRC={aignc_root.parent / 'GSFC'}/",
        f"META={aignc_root / 'MetaCode'}/",
    ])

    print(f"Building in {run_root}")
    print(" ".join(cmd))
    subprocess.run(cmd, cwd=run_root, check=True)


if __name__ == "__main__":
    main()
