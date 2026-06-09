#!/usr/bin/env python3
import argparse
import platform
import shutil
import subprocess
from pathlib import Path


def parse_args():
    parser = argparse.ArgumentParser(description="Assemble and run a workspace-local 42 package.")
    parser.add_argument("--workspace-dir", default="", help="Injected workspace_dir. Defaults to this script's parent workspace.")
    parser.add_argument("--reuse-runtime", action="store_true", help="Reuse the existing runtime_case/InOut directory.")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--gui", action="store_true", help="Force the runtime copy of Inp_Sim.txt to GUI mode.")
    mode.add_argument("--headless", action="store_true", help="Force the runtime copy of Inp_Sim.txt to non-GUI mode.")
    return parser.parse_args()


def default_workspace_dir():
    return Path(__file__).resolve().parents[1]


def project_root(workspace_dir):
    for candidate in [workspace_dir, *workspace_dir.parents]:
        resources = candidate / "codex_web" / "AIGNC"
        if (resources / "42" / "Model").exists() and (candidate / "demo_server" / "open_codex_web").exists():
            return candidate
    raise SystemExit(f"Project root with codex_web/AIGNC/42/Model not found above {workspace_dir}")


def sync_config(workspace_dir, inout, reuse_runtime):
    config = workspace_dir / "Config"
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


def executable_path(workspace_dir):
    run_root = workspace_dir / "Output" / "Run"
    names = ["42.exe", "42"] if platform.system() == "Windows" else ["42", "42.exe"]
    for name in names:
        path = run_root / name
        if path.exists():
            return path
    raise SystemExit(f"Case executable not found in {run_root}; expected one of: {', '.join(names)}")


def main():
    args = parse_args()
    workspace_dir = Path(args.workspace_dir).resolve() if args.workspace_dir else default_workspace_dir()
    root = project_root(workspace_dir)
    resources = root / "codex_web" / "AIGNC"
    runtime = workspace_dir / "Output" / "Run" / "runtime_case"
    inout = runtime / "InOut"
    model = resources / "42" / "Model"

    sync_config(workspace_dir, inout, args.reuse_runtime)
    inp_sim = inout / "Inp_Sim.txt"
    if args.gui or args.headless:
        set_graphics_mode(inp_sim, args.gui)

    if not (model / "42.mtl").exists():
        raise SystemExit(f"42 model directory is incomplete: {model}")

    exe = executable_path(workspace_dir)
    subprocess.run([str(exe), str(inout), str(model)], cwd=resources, check=True)


if __name__ == "__main__":
    main()
