from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path
from typing import Any


DEFAULT_COMSOL_LAUNCHER = Path("/usr/local/bin/start-comsol-remote")
DEFAULT_PARAVIEW_LAUNCHER = Path("/usr/local/bin/start-paraview-remote")
PARAVIEW_DISPLAY = ":2"


def load_simulation_outputs_in_remote_tools(
    simulation_dir: Path,
    *,
    comsol_launcher: Path = DEFAULT_COMSOL_LAUNCHER,
    paraview_launcher: Path = DEFAULT_PARAVIEW_LAUNCHER,
) -> dict[str, Any]:
    """Launch remote COMSOL and ParaView sessions for simulation outputs.

    The launchers are expected to detach or return quickly. This helper starts
    them asynchronously so the pipeline does not block on GUI sessions.
    """
    simulation_dir = Path(simulation_dir)
    work_mph = simulation_dir / "work.mph"
    native_vtu = simulation_dir / "native.vtu"
    paraview_script = simulation_dir / "open_native_vtu_in_paraview.py"
    if native_vtu.exists():
        _write_paraview_startup_script(paraview_script, native_vtu)
    result: dict[str, Any] = {
        "work_mph": str(work_mph),
        "native_vtu": str(native_vtu),
        "comsol": _launch_if_ready(
            [str(comsol_launcher), "-open", str(work_mph)],
            launcher=comsol_launcher,
            data_file=work_mph,
        ),
        "paraview": _launch_if_ready(
            [
                str(paraview_launcher),
                f"--script={paraview_script}",
                "--geometry=1600x1000+20+20",
            ],
            launcher=paraview_launcher,
            data_file=native_vtu,
            existing_process_policy=_existing_paraview_policy,
        ),
    }
    result["ok"] = all(item.get("status") in {"launched", "skipped"} for item in (result["comsol"], result["paraview"]))
    return result


def _launch_if_ready(
    command: list[str],
    *,
    launcher: Path,
    data_file: Path,
    existing_process_policy: Any | None = None,
) -> dict[str, Any]:
    if not data_file.exists():
        return {
            "status": "skipped",
            "reason": "missing_data_file",
            "launcher": str(launcher),
            "data_file": str(data_file),
            "command": command,
        }
    if existing_process_policy is not None:
        policy_result = existing_process_policy()
        if policy_result is not None:
            return {
                **policy_result,
                "launcher": str(launcher),
                "data_file": str(data_file),
                "command": command,
            }
    if shutil.which(str(launcher)) is None:
        return {
            "status": "skipped",
            "reason": "missing_launcher",
            "launcher": str(launcher),
            "data_file": str(data_file),
            "command": command,
        }
    try:
        process = subprocess.Popen(
            command,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
    except OSError as exc:
        return {
            "status": "failed",
            "reason": exc.__class__.__name__,
            "message": str(exc),
            "launcher": str(launcher),
            "data_file": str(data_file),
            "command": command,
        }
    return {
        "status": "launched",
        "pid": process.pid,
        "launcher": str(launcher),
        "data_file": str(data_file),
        "command": command,
    }


def _existing_paraview_policy() -> dict[str, Any] | None:
    if not _has_existing_paraview_process():
        return None
    return {
        "status": "skipped",
        "reason": "existing_process_no_ipc",
        "message": (
            "A ParaView GUI process is already running. The current remote launcher "
            "does not expose a stable IPC/RPC endpoint that can load a new file into "
            "that existing GUI process, so the pipeline did not start another ParaView."
        ),
    }


def _has_existing_paraview_process() -> bool:
    try:
        completed = subprocess.run(
            ["pgrep", "-f", "(^|/)paraview( |$)"],
            check=False,
            capture_output=True,
            text=True,
        )
    except OSError:
        return False
    current_pid = os.getpid()
    for line in completed.stdout.splitlines():
        try:
            pid = int(line.strip())
        except ValueError:
            continue
        if pid != current_pid:
            return True
    return False

def _write_paraview_startup_script(script_path: Path, native_vtu: Path) -> None:
    script_path.write_text(
        f"""from paraview.simple import *

vtu = XMLUnstructuredGridReader(FileName=[{str(native_vtu)!r}])
view = GetActiveViewOrCreate('RenderView')
view.ViewSize = [1600, 1000]
display = Show(vtu, view)
display.Representation = 'Surface With Edges'

try:
    ColorBy(display, ('POINTS', 'T'))
    display.RescaleTransferFunctionToDataRange(True, False)
except Exception:
    try:
        ColorBy(display, ('CELLS', 'T'))
        display.RescaleTransferFunctionToDataRange(True, False)
    except Exception:
        pass

view.Background = [1.0, 1.0, 1.0]
ResetCamera(view)
camera = view.GetActiveCamera()
camera.Elevation(28)
camera.Azimuth(38)
camera.Roll(0)
ResetCamera(view)
Render(view)
""",
        encoding="utf-8",
    )
