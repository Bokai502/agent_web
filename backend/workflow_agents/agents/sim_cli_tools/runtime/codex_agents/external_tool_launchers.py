from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
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
            before_launch=_stop_existing_paraview_gui,
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
        prelaunch_status = str(prelaunch_result.get("status", "")) if isinstance(prelaunch_result, dict) else ""
        if prelaunch_status.startswith("blocked"):
            return {
                "status": "failed",
                "reason": prelaunch_status,
                "launcher": str(launcher),
                "data_file": str(data_file),
                "command": command,
                "prelaunch": prelaunch_result,
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
        **({"prelaunch": prelaunch_result} if prelaunch_result is not None else {}),
    }


def _stop_existing_comsol_gui() -> dict[str, Any]:
    """Stop only the remote COMSOL GUI client before opening the latest MPH file.

    This deliberately avoids broad `pkill comsol` behavior so private mphserver
    processes and active simulation workers are left alone.
    """
    killed: list[int] = []
    force_killed: list[int] = []
    errors: list[str] = []
    foreign_display_pids = _foreign_comsol_display_processes()
    if foreign_display_pids:
        return {
            "status": "blocked_foreign_display",
            "pids": [],
            "force_killed_pids": [],
            "remaining_pids": [],
            "foreign_display_pids": foreign_display_pids,
            "message": (
                f"COMSOL remote display {COMSOL_REMOTE_DISPLAY} is owned by another user; "
                "cannot safely clear stale GUI windows without privileges."
            ),
        }

    try:
        candidate_pids = _processes_on_display(r"(^|/)(comsol|comsollauncher)( |$)", COMSOL_REMOTE_DISPLAY)
    except OSError as exc:
        return {"status": "prelaunch_check_failed", "pids": killed, "errors": [f"pgrep: {exc}"]}

    for pid in candidate_pids:
        if pid == os.getpid() or pid in killed:
            continue
        try:
            os.kill(pid, 15)
            killed.append(pid)
        except ProcessLookupError:
            continue
        except OSError as exc:
            errors.append(f"kill {pid}: {exc}")

    remaining: list[int] = []
    if killed:
        remaining = _wait_processes_exit(killed, timeout_seconds=10.0)
    for pid in remaining:
        try:
            os.kill(pid, 9)
            force_killed.append(pid)
        except ProcessLookupError:
            continue
        except OSError as exc:
            errors.append(f"kill -9 {pid}: {exc}")
    if force_killed:
        _wait_processes_exit(force_killed, timeout_seconds=3.0)

    final_remaining = [
        pid
        for pid in _processes_on_display(r"(^|/)(comsol|comsollauncher)( |$)", COMSOL_REMOTE_DISPLAY)
        if pid != os.getpid()
    ]

    return {
        "status": "stopped_existing_gui" if killed else "no_existing_gui",
        "pids": killed,
        "force_killed_pids": force_killed,
        "remaining_pids": final_remaining,
        **({"errors": errors} if errors else {}),
    }


def _stop_existing_paraview_gui() -> dict[str, Any]:
    """Stop ParaView GUI clients on the configured remote display.

    ParaView remote sessions are shared by display. Leaving old clients alive
    can make noVNC show an earlier workspace or a hidden window instead of the
    latest VTU loaded by this run.
    """
    welcome_result = _disable_paraview_welcome_dialog()
    killed: list[int] = []
    errors: list[str] = []

    try:
        completed = subprocess.run(
            ["pgrep", "-f", r"(^|/)paraview( |$)"],
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
        if display != PARAVIEW_DISPLAY:
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
        "welcome_dialog": welcome_result,
        **({"errors": errors} if errors else {}),
    }


def _disable_paraview_welcome_dialog() -> dict[str, Any]:
    config_path = Path.home() / ".config" / "ParaView" / "ParaView5.10.0.ini"
    try:
        config_path.parent.mkdir(parents=True, exist_ok=True)
        lines = config_path.read_text(encoding="utf-8", errors="ignore").splitlines() if config_path.exists() else []
        output: list[str] = []
        in_general = False
        seen_general = False
        seen_key = False
        for line in lines:
            stripped = line.strip()
            if stripped.startswith("[") and stripped.endswith("]"):
                if in_general and not seen_key:
                    output.append("GeneralSettings.ShowWelcomeDialog=false")
                    seen_key = True
                in_general = stripped == "[General]"
                seen_general = seen_general or in_general
                output.append(line)
                continue
            if in_general and stripped.startswith("GeneralSettings.ShowWelcomeDialog="):
                output.append("GeneralSettings.ShowWelcomeDialog=false")
                seen_key = True
                continue
            output.append(line)
        if not seen_general:
            if output:
                output.append("")
            output.extend(["[General]", "GeneralSettings.ShowWelcomeDialog=false"])
        elif in_general and not seen_key:
            output.append("GeneralSettings.ShowWelcomeDialog=false")
        config_path.write_text("\n".join(output) + "\n", encoding="utf-8")
    except OSError as exc:
        return {"status": "failed", "path": str(config_path), "message": str(exc)}
    return {"status": "disabled", "path": str(config_path)}


def _read_process_display(pid: int) -> str | None:
    try:
        raw = Path(f"/proc/{pid}/environ").read_bytes()
    except OSError:
        return None
    for item in raw.split(b"\0"):
        if item.startswith(b"DISPLAY="):
            return item.split(b"=", 1)[1].decode("utf-8", errors="replace")
    return None


def _processes_on_display(pattern: str, display: str) -> list[int]:
    completed = subprocess.run(
        ["pgrep", "-f", pattern],
        check=False,
        capture_output=True,
        text=True,
    )
    pids: list[int] = []
    for line in completed.stdout.splitlines():
        try:
            pid = int(line.strip())
        except ValueError:
            continue
        if _read_process_display(pid) == display:
            pids.append(pid)
    return pids


def _foreign_comsol_display_processes() -> list[dict[str, Any]]:
    patterns = [
        rf"Xvfb {COMSOL_REMOTE_DISPLAY}( |$)",
        rf"x11vnc .* -display {COMSOL_REMOTE_DISPLAY} .* -rfbport 5932",
        r"websockify --web .* 6082 localhost:5932",
        r"launch.sh --vnc localhost:5932 --listen 6082",
    ]
    current_uid = os.getuid()
    seen: set[int] = set()
    foreign: list[dict[str, Any]] = []
    for pattern in patterns:
        completed = subprocess.run(
            ["pgrep", "-f", pattern],
            check=False,
            capture_output=True,
            text=True,
        )
        for line in completed.stdout.splitlines():
            try:
                pid = int(line.strip())
            except ValueError:
                continue
            if pid in seen or pid == os.getpid():
                continue
            seen.add(pid)
            uid = _read_process_uid(pid)
            if uid is None or uid == current_uid:
                continue
            foreign.append(
                {
                    "pid": pid,
                    "uid": uid,
                    "cmdline": _read_process_cmdline(pid),
                }
            )
    return foreign


def _read_process_uid(pid: int) -> int | None:
    try:
        status = Path(f"/proc/{pid}/status").read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    for line in status.splitlines():
        if line.startswith("Uid:"):
            parts = line.split()
            if len(parts) >= 2:
                try:
                    return int(parts[1])
                except ValueError:
                    return None
    return None


def _read_process_cmdline(pid: int) -> str:
    try:
        raw = Path(f"/proc/{pid}/cmdline").read_bytes()
    except OSError:
        return ""
    return " ".join(part.decode("utf-8", errors="replace") for part in raw.split(b"\0") if part)


def _wait_processes_exit(pids: list[int], *, timeout_seconds: float) -> list[int]:
    deadline = time.monotonic() + timeout_seconds
    remaining = list(dict.fromkeys(pids))
    while remaining and time.monotonic() < deadline:
        remaining = [pid for pid in remaining if Path(f"/proc/{pid}").exists()]
        if not remaining:
            return []
        time.sleep(0.25)
    return [pid for pid in remaining if Path(f"/proc/{pid}").exists()]


def _write_paraview_startup_script(script_path: Path, native_vtu: Path) -> None:
    title = f"Thermal VTU: {native_vtu.parent.parent.parent.name}/{native_vtu.parent.name}"
    annotation = f"{native_vtu.parent.parent.parent.name} | {native_vtu.name}"
    script_path.write_text(
        f"""from paraview.simple import *

vtu = XMLUnstructuredGridReader(FileName=[{str(native_vtu)!r}])
UpdatePipeline(proxy=vtu)
view = GetActiveViewOrCreate('RenderView')
view.ViewSize = [1600, 1000]
view.Background = [1.0, 1.0, 1.0]
display = Show(vtu, view)
display.Representation = 'Surface With Edges'
display.LineWidth = 1.0

def _array_names(attributes):
    if attributes is None:
        return []
    return [attributes.GetArray(i).Name for i in range(attributes.GetNumberOfArrays())]

point_arrays = _array_names(vtu.PointData)
cell_arrays = _array_names(vtu.CellData)
active_array = None
active_association = None
for candidate in ('T', 'Color'):
    if candidate in point_arrays:
        active_array = candidate
        active_association = 'POINTS'
        ColorBy(display, ('POINTS', candidate))
        break
    if candidate in cell_arrays:
        active_array = candidate
        active_association = 'CELLS'
        ColorBy(display, ('CELLS', candidate))
        break
else:
    if point_arrays:
        active_array = point_arrays[0]
        active_association = 'POINTS'
        ColorBy(display, ('POINTS', active_array))
    elif cell_arrays:
        active_array = cell_arrays[0]
        active_association = 'CELLS'
        ColorBy(display, ('CELLS', active_array))

display.RescaleTransferFunctionToDataRange(True, False)
if active_array:
    lut = GetColorTransferFunction(active_array)
    display.SetScalarBarVisibility(view, True)
    scalar_bar = GetScalarBar(lut, view)
    scalar_bar.Title = active_array
    scalar_bar.ComponentTitle = 'K'

title = Text()
title.Text = {annotation!r}
title_display = Show(title, view)
title_display.WindowLocation = 'Upper Left Corner'
title_display.FontSize = 16
title_display.Color = [0.0, 0.0, 0.0]

try:
    RenameLayout({title!r})
except Exception:
    pass
ResetCamera(view)
camera = view.GetActiveCamera()
camera.Elevation(28)
camera.Azimuth(38)
camera.Roll(0)
ResetCamera(view)
Render(view)
print('Loaded VTU:', {str(native_vtu)!r})
print('Point arrays:', point_arrays)
print('Cell arrays:', cell_arrays)
print('Active coloring:', active_association, active_array)
""",
        encoding="utf-8",
    )
