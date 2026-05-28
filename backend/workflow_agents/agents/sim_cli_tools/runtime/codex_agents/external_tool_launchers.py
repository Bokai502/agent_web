from __future__ import annotations

import os
import shlex
import shutil
import signal
import socket
import subprocess
from pathlib import Path
from typing import Any


DEFAULT_COMSOL_LAUNCHER = Path("/usr/local/bin/comsol")
DEFAULT_PARAVIEW_LAUNCHER = Path("/usr/local/bin/start-paraview-remote")
COMSOL_DISPLAY = ":32"
COMSOL_TMUX_SESSION = "comsol-remote-6082"
COMSOL_VNC_PORT = 5932
COMSOL_NOVNC_PORT = 6082
COMSOL_NOVNC_URL = (
    "http://10.110.10.11:6082/vnc.html?autoconnect=true&resize=scale&path=websockify"
)
COMSOL_LOG_DIR = Path("/home/lbk/.remote-cad/logs")
PARAVIEW_DISPLAY = ":2"


def load_simulation_outputs_in_remote_tools(
    simulation_dir: Path,
    *,
    comsol_launcher: Path = DEFAULT_COMSOL_LAUNCHER,
    paraview_launcher: Path = DEFAULT_PARAVIEW_LAUNCHER,
    async_launch: bool = False,
) -> dict[str, Any]:
    """Launch remote COMSOL and ParaView sessions for simulation outputs.

    By default this waits for the launcher commands to finish so callers know
    whether GUI loading completed. Use async_launch=True for the old detached
    fire-and-forget behavior.
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
        "comsol": _launch_comsol_if_ready(work_mph, launcher=comsol_launcher, async_launch=async_launch),
        "paraview": _launch_if_ready(
            [
                str(paraview_launcher),
                f"--script={paraview_script}",
                "--geometry=1600x1000+20+20",
            ],
            launcher=paraview_launcher,
            data_file=native_vtu,
            existing_process_policy=_existing_paraview_policy,
            async_launch=async_launch,
        ),
    }
    result["ok"] = all(
        item.get("status") in {"completed", "launched", "skipped"}
        for item in (result["comsol"], result["paraview"])
    )
    return result


def _launch_comsol_if_ready(
    data_file: Path,
    *,
    launcher: Path,
    async_launch: bool = False,
) -> dict[str, Any]:
    command = _comsol_open_command(launcher, data_file)
    common = {
        "launcher": str(launcher),
        "data_file": str(data_file),
        "command": command,
        "display": COMSOL_DISPLAY,
        "vnc_port": COMSOL_VNC_PORT,
        "novnc_port": COMSOL_NOVNC_PORT,
        "novnc_url": COMSOL_NOVNC_URL,
        "tmux_session": COMSOL_TMUX_SESSION,
    }
    if not data_file.exists():
        return {
            "status": "skipped",
            "reason": "missing_data_file",
            **common,
        }
    if shutil.which("tmux") is None:
        return {
            "status": "skipped",
            "reason": "missing_tmux",
            **common,
        }
    if shutil.which(str(launcher)) is None:
        return {
            "status": "skipped",
            "reason": "missing_launcher",
            **common,
        }

    try:
        session_result = _ensure_comsol_remote_session()
    except OSError as exc:
        return {
            "status": "failed",
            "reason": exc.__class__.__name__,
            "message": str(exc),
            **common,
        }
    if session_result.get("status") == "failed":
        return {
            **session_result,
            **common,
        }

    try:
        send_result = _send_comsol_open_command(command)
    except OSError as exc:
        return {
            "status": "failed",
            "reason": exc.__class__.__name__,
            "message": str(exc),
            **common,
        }
    if send_result.returncode != 0:
        return {
            "status": "failed",
            "reason": "tmux_send_keys_failed",
            "returncode": send_result.returncode,
            "stdout": send_result.stdout[-4000:],
            "stderr": send_result.stderr[-4000:],
            **common,
        }

    return {
        "status": "launched" if async_launch else "completed",
        "returncode": 0,
        **common,
    }


def _ensure_comsol_remote_session() -> dict[str, Any]:
    has_session = subprocess.run(
        ["tmux", "has-session", "-t", COMSOL_TMUX_SESSION],
        check=False,
        capture_output=True,
        text=True,
    )
    if has_session.returncode == 0:
        if not _comsol_remote_ports_ready():
            _stop_wrong_comsol_websockify_processes()
            bootstrap = _send_comsol_bootstrap_command()
            if bootstrap.returncode != 0:
                return {
                    "status": "failed",
                    "reason": "tmux_bootstrap_failed",
                    "returncode": bootstrap.returncode,
                    "stdout": bootstrap.stdout[-4000:],
                    "stderr": bootstrap.stderr[-4000:],
                }
        return {"status": "completed", "reason": "existing_tmux_session"}

    COMSOL_LOG_DIR.mkdir(parents=True, exist_ok=True)
    session_command = f"{_comsol_bootstrap_shell_command()}; exec bash"
    created = subprocess.run(
        [
            "tmux",
            "new-session",
            "-d",
            "-s",
            COMSOL_TMUX_SESSION,
            "-c",
            "/data/lbk/codex_web",
            session_command,
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    if created.returncode != 0:
        return {
            "status": "failed",
            "reason": "tmux_new_session_failed",
            "returncode": created.returncode,
            "stdout": created.stdout[-4000:],
            "stderr": created.stderr[-4000:],
        }
    return {"status": "completed", "reason": "created_tmux_session"}


def _send_comsol_bootstrap_command() -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["tmux", "send-keys", "-t", COMSOL_TMUX_SESSION, _comsol_bootstrap_shell_command(), "Enter"],
        check=False,
        capture_output=True,
        text=True,
    )


def _send_comsol_open_command(command: list[str]) -> subprocess.CompletedProcess[str]:
    shell_command = _comsol_open_shell_command(command)
    return subprocess.run(
        ["tmux", "send-keys", "-t", COMSOL_TMUX_SESSION, shell_command, "Enter"],
        check=False,
        capture_output=True,
        text=True,
    )


def _comsol_open_shell_command(command: list[str]) -> str:
    quoted_command = " ".join(shlex.quote(part) for part in command)
    log_path = shlex.quote(str(COMSOL_LOG_DIR / "comsol-32.log"))
    return f"{quoted_command} >{log_path} 2>&1 &"


def _comsol_bootstrap_shell_command() -> str:
    log_dir = shlex.quote(str(COMSOL_LOG_DIR))
    display = shlex.quote(COMSOL_DISPLAY)
    xvfb = _background_if_missing(
        "Xvfb :32",
        f"Xvfb {display} -screen 0 1920x1080x24 -ac -listen tcp",
        COMSOL_LOG_DIR / "xvfb-comsol-32.log",
    )
    openbox = _background_if_missing(
        f"DISPLAY={COMSOL_DISPLAY} openbox|openbox .*{COMSOL_DISPLAY}",
        f"env DISPLAY={display} openbox",
        COMSOL_LOG_DIR / "openbox-comsol-32.log",
    )
    x11vnc = _background_if_missing(
        f"x11vnc .*{COMSOL_VNC_PORT}",
        f"x11vnc -display {display} -localhost -noshm -forever -shared -nopw -rfbport {COMSOL_VNC_PORT}",
        COMSOL_LOG_DIR / "x11vnc-comsol-32.log",
    )
    novnc = _background_if_missing(
        f"launch.sh --vnc localhost:{COMSOL_VNC_PORT} --listen {COMSOL_NOVNC_PORT}",
        f"/usr/share/novnc/utils/launch.sh --vnc localhost:{COMSOL_VNC_PORT} --listen {COMSOL_NOVNC_PORT}",
        COMSOL_LOG_DIR / "novnc-comsol-32.log",
    )
    return (
        f"mkdir -p {log_dir}; "
        f"{xvfb}; sleep 1; "
        f"{openbox}; sleep 1; "
        f"{x11vnc}; sleep 1; "
        f"{novnc}; sleep 1"
    )


def _background_if_missing(pattern: str, command: str, log_path: Path) -> str:
    return (
        f"pgrep -f {shlex.quote(pattern)} >/dev/null || "
        f"( {command} >{shlex.quote(str(log_path))} 2>&1 & )"
    )


def _comsol_remote_ports_ready() -> bool:
    return (
        _tcp_port_is_open(COMSOL_VNC_PORT)
        and _tcp_port_is_open(COMSOL_NOVNC_PORT)
        and _has_process_matching(["x11vnc", f"{COMSOL_VNC_PORT}"])
        and _has_process_matching(["websockify", f"{COMSOL_NOVNC_PORT}", f"localhost:{COMSOL_VNC_PORT}"])
    )


def _tcp_port_is_open(port: int) -> bool:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.2)
            return sock.connect_ex(("127.0.0.1", port)) == 0
    except OSError:
        return False


def _stop_wrong_comsol_websockify_processes() -> None:
    for pid, command in _processes_matching(["websockify", f"{COMSOL_NOVNC_PORT}"]):
        if f"localhost:{COMSOL_VNC_PORT}" in command:
            continue
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError:
            pass


def _has_process_matching(parts: list[str]) -> bool:
    return any(True for _pid, _command in _processes_matching(parts))


def _processes_matching(parts: list[str]) -> list[tuple[int, str]]:
    try:
        completed = subprocess.run(
            ["pgrep", "-af", parts[0]],
            check=False,
            capture_output=True,
            text=True,
        )
    except OSError:
        return []
    matches: list[tuple[int, str]] = []
    for line in completed.stdout.splitlines():
        try:
            pid_text, command = line.split(maxsplit=1)
            pid = int(pid_text)
        except ValueError:
            continue
        if pid == os.getpid():
            continue
        if all(part in command for part in parts):
            matches.append((pid, command))
    return matches


def _comsol_open_command(launcher: Path, data_file: Path) -> list[str]:
    return [
        "env",
        f"DISPLAY={COMSOL_DISPLAY}",
        "LIBGL_ALWAYS_SOFTWARE=1",
        "MESA_GL_VERSION_OVERRIDE=3.3",
        str(launcher),
        "-open",
        str(data_file),
    ]


def _launch_if_ready(
    command: list[str],
    *,
    launcher: Path,
    data_file: Path,
    existing_process_policy: Any | None = None,
    async_launch: bool = False,
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
    if not async_launch:
        try:
            completed = subprocess.run(
                command,
                check=False,
                capture_output=True,
                text=True,
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
        if completed.returncode != 0:
            return {
                "status": "failed",
                "reason": "nonzero_exit",
                "returncode": completed.returncode,
                "stdout": completed.stdout[-4000:],
                "stderr": completed.stderr[-4000:],
                "launcher": str(launcher),
                "data_file": str(data_file),
                "command": command,
            }
        return {
            "status": "completed",
            "returncode": completed.returncode,
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
