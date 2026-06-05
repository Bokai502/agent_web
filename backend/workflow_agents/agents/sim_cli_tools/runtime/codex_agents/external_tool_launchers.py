from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any


APP_CONFIG_PATH = Path(
    os.getenv(
        "CODEX_WEB_CONFIG_PATH",
        Path(__file__).resolve().parents[6] / "config.json",
    )
)


def _load_config() -> dict[str, Any]:
    try:
        payload = json.loads(APP_CONFIG_PATH.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _tool_config(name: str) -> dict[str, Any]:
    tools = _load_config().get("tools", {})
    if not isinstance(tools, dict):
        return {}
    tool = tools.get(name, {})
    return tool if isinstance(tool, dict) else {}


def _tool_path(name: str, key: str, fallback: str) -> Path:
    value = _tool_config(name).get(key)
    return Path(str(value).strip()) if value else Path(fallback)


def _tool_string(name: str, key: str, fallback: str) -> str:
    value = _tool_config(name).get(key)
    return str(value).strip() if value else fallback


DEFAULT_COMSOL_LAUNCHER = _tool_path("comsol", "launcher", "start-comsol-remote")
DEFAULT_PARAVIEW_LAUNCHER = _tool_path("paraview", "launcher", "start-paraview-remote")
PARAVIEW_DISPLAY = _tool_string("paraview", "displayNum", ":2")
COMSOL_REMOTE_DISPLAY = _tool_string("comsol", "displayNum", ":32")


def load_simulation_outputs_in_remote_tools(
    simulation_dir: Path,
    *,
    comsol_launcher: Path = DEFAULT_COMSOL_LAUNCHER,
    paraview_launcher: Path = DEFAULT_PARAVIEW_LAUNCHER,
    async_launch: bool = False,
) -> dict[str, Any]:
    """Launch remote COMSOL and ParaView sessions for simulation outputs.

    The launchers are expected to detach or return quickly. This helper starts
    them asynchronously so the pipeline does not block on GUI sessions. The
    async_launch flag is accepted for CLI compatibility; this launcher path is
    always asynchronous.
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
            before_launch=_stop_existing_comsol_gui,
        ),
        "paraview": _launch_if_ready(
            [
                str(paraview_launcher),
                f"--script={paraview_script}",
                "--geometry=1600x1000+20+20",
            ],
            launcher=paraview_launcher,
            data_file=native_vtu,
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
    before_launch: Any | None = None,
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
    prelaunch_result = None
    if before_launch is not None:
        prelaunch_result = before_launch()
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
        **({"prelaunch": prelaunch_result} if prelaunch_result is not None else {}),
    }


def _stop_existing_comsol_gui() -> dict[str, Any]:
    """Stop only the remote COMSOL GUI client before opening the latest MPH file.

    This deliberately avoids broad `pkill comsol` behavior so private mphserver
    processes and active simulation workers are left alone.
    """
    killed: list[int] = []
    errors: list[str] = []

    try:
        completed = subprocess.run(
            ["pgrep", "-f", r"(^|/)(comsol|comsollauncher)( |$)"],
            check=False,
            capture_output=True,
            text=True,
        )
    except OSError as exc:
        return {"status": "prelaunch_check_failed", "pids": killed, "errors": [f"pgrep: {exc}"]}

    for line in completed.stdout.splitlines():
        try:
            pid = int(line.strip())
        except ValueError:
            continue
        if pid == os.getpid() or pid in killed:
            continue
        display = _read_process_display(pid)
        if display != COMSOL_REMOTE_DISPLAY:
            continue
        try:
            os.kill(pid, 15)
            killed.append(pid)
        except ProcessLookupError:
            continue
        except OSError as exc:
            errors.append(f"kill {pid}: {exc}")

    if killed:
        try:
            subprocess.run(["sleep", "2"], check=False)
        except OSError:
            pass

    return {
        "status": "stopped_existing_gui" if killed else "no_existing_gui",
        "pids": killed,
        **({"errors": errors} if errors else {}),
    }


def _read_process_display(pid: int) -> str | None:
    try:
        raw = Path(f"/proc/{pid}/environ").read_bytes()
    except OSError:
        return None
    for item in raw.split(b"\0"):
        if item.startswith(b"DISPLAY="):
            return item.split(b"=", 1)[1].decode("utf-8", errors="replace")
    return None


def _write_paraview_startup_script(script_path: Path, native_vtu: Path) -> None:
    script_path.write_text(
        f"""from paraview.simple import *

vtu = XMLUnstructuredGridReader(FileName=[{str(native_vtu)!r}])
UpdatePipeline(proxy=vtu)
view = GetActiveViewOrCreate('RenderView')
view.ViewSize = [1600, 1000]
display = Show(vtu, view)
display.Representation = 'Surface With Edges'

def _array_names(attributes):
    if attributes is None:
        return []
    return [attributes.GetArray(i).Name for i in range(attributes.GetNumberOfArrays())]

point_arrays = _array_names(vtu.PointData)
cell_arrays = _array_names(vtu.CellData)
for candidate in ('T', 'Color'):
    if candidate in point_arrays:
        ColorBy(display, ('POINTS', candidate))
        break
    if candidate in cell_arrays:
        ColorBy(display, ('CELLS', candidate))
        break
else:
    if point_arrays:
        ColorBy(display, ('POINTS', point_arrays[0]))
    elif cell_arrays:
        ColorBy(display, ('CELLS', cell_arrays[0]))

display.RescaleTransferFunctionToDataRange(True, False)

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
