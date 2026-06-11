#!/usr/bin/env python3
import argparse
import os
import platform
import shutil
import subprocess
from pathlib import Path


def parse_args():
    parser = argparse.ArgumentParser(description="Assemble and run a mission-local 42 case.")
    parser.add_argument("--case-root", default="", help="Mission case root. Defaults to this script's parent case.")
    parser.add_argument("--input-root", default="", help="Input package root containing Config/. Defaults to workspace-dir/00_inputs or this case root.")
    parser.add_argument("--workspace-dir", default="", help="Versioned web workspace directory. Defaults to this script's parent version workspace when installed under 00_inputs/Script.")
    parser.add_argument("--output-root", default="", help="Output root. Defaults to workspace-dir/02_sim/42_run or case-root/Output/Run.")
    parser.add_argument("--reuse-runtime", action="store_true", help="Reuse the existing runtime_case/InOut directory.")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--gui", action="store_true", help="Force the runtime copy of Inp_Sim.txt to GUI mode.")
    mode.add_argument("--headless", action="store_true", help="Force the runtime copy of Inp_Sim.txt to non-GUI mode.")
    return parser.parse_args()


def default_case_root():
    return Path(__file__).resolve().parents[1]


def default_workspace_dir():
    script = Path(__file__).resolve()
    if script.parent.name == "Script" and script.parent.parent.name == "00_inputs":
        return script.parents[2]
    return None


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


def sync_config(input_root, inout, reuse_runtime):
    config = input_root / "Config"
    if not config.exists():
        raise SystemExit(f"Config directory not found: {config}")
    if not reuse_runtime:
        if inout.exists():
            shutil.rmtree(inout)
        inout.mkdir(parents=True, exist_ok=True)
        for src in config.iterdir():
            if src.is_file():
                shutil.copy2(src, inout / src.name)
    elif not (inout / "Inp_Sim.txt").exists():
        inout.mkdir(parents=True, exist_ok=True)
        for src in config.iterdir():
            if src.is_file():
                shutil.copy2(src, inout / src.name)


def set_graphics_mode(inp_sim, enabled):
    lines = inp_sim.read_text(encoding="utf-8").splitlines()
    for idx, line in enumerate(lines):
        if "Graphics Front End?" in line:
            marker = "TRUE" if enabled else "FALSE"
            suffix = line[line.find("!_graphics") :] if "!_graphics" in line else None
            if suffix is None:
                comment_index = line.find("!")
                suffix = line[comment_index:] if comment_index >= 0 else ""
            lines[idx] = f"{marker:<32}{suffix}".rstrip()
            inp_sim.write_text("\n".join(lines) + "\n", encoding="utf-8")
            return
    raise SystemExit(f"Graphics Front End line not found in {inp_sim}")


def output_root_from_args(case_root, workspace_dir, output_root):
    if output_root:
        return Path(output_root).resolve()
    if workspace_dir:
        return workspace_dir / "02_sim" / "42_run"
    return case_root / "Output" / "Run"


def executable_path_from_run_root(run_root):
    names = ["42.exe", "42"] if platform.system() == "Windows" else ["42", "42.exe"]
    for name in names:
        exe = run_root / name
        if exe.exists():
            return exe
    raise SystemExit(f"Case executable not found in {run_root}; expected one of: {', '.join(names)}")


def main():
    args = parse_args()
    workspace_dir = Path(args.workspace_dir).resolve() if args.workspace_dir else default_workspace_dir()
    case_root = Path(args.case_root).resolve() if args.case_root else default_case_root()
    input_root = Path(args.input_root).resolve() if args.input_root else default_input_root(case_root, workspace_dir)
    run_root = output_root_from_args(case_root, workspace_dir, args.output_root)
    aignc_root = default_agnc_root()
    runtime = run_root / "runtime_case"
    inout = runtime / "InOut"
    model = aignc_root / "42" / "Model"

    sync_config(input_root, inout, args.reuse_runtime)
    inp_sim = inout / "Inp_Sim.txt"
    if args.gui or args.headless:
        set_graphics_mode(inp_sim, args.gui)

    if not (model / "42.mtl").exists():
        raise SystemExit(f"42 model directory is incomplete: {model}")

    exe = executable_path_from_run_root(run_root)
    subprocess.run([str(exe), str(inout), str(model)], cwd=run_root, check=True)


if __name__ == "__main__":
    main()
