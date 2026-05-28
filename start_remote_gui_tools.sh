#!/usr/bin/env bash
set -euo pipefail

DESKTOP_LAUNCHER="${DESKTOP_LAUNCHER:-/usr/local/bin/start-remote-cad-desktop}"
FREECAD_LAUNCHER="${FREECAD_LAUNCHER:-/usr/local/bin/start-freecad-remote}"
PARAVIEW_LAUNCHER="${PARAVIEW_LAUNCHER:-/usr/local/bin/start-paraview-remote}"
COMSOL_LAUNCHER="${COMSOL_LAUNCHER:-/usr/local/bin/start-comsol-remote}"

require_executable() {
  local file="$1"
  if [[ ! -x "${file}" ]]; then
    echo "missing executable: ${file}" >&2
    exit 1
  fi
}

for launcher in "${DESKTOP_LAUNCHER}" "${FREECAD_LAUNCHER}" "${PARAVIEW_LAUNCHER}" "${COMSOL_LAUNCHER}"; do
  require_executable "${launcher}"
done

"${DESKTOP_LAUNCHER}" freecad start
"${DESKTOP_LAUNCHER}" paraview start
"${DESKTOP_LAUNCHER}" comsol start

"${FREECAD_LAUNCHER}"
"${PARAVIEW_LAUNCHER}"
"${COMSOL_LAUNCHER}"

echo "Remote GUI tools requested."
echo "FreeCAD:  http://$(hostname -I 2>/dev/null | awk '{print $1}'):6080/vnc.html?autoconnect=true&resize=scale&path=websockify"
echo "ParaView: http://$(hostname -I 2>/dev/null | awk '{print $1}'):6081/vnc.html?autoconnect=true&resize=scale&path=websockify"
echo "COMSOL:   http://$(hostname -I 2>/dev/null | awk '{print $1}'):6082/vnc.html?autoconnect=true&resize=scale&path=websockify"
