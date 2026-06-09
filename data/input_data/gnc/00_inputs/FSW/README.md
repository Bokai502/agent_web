# FSW CFS-Only Implementation Template

This folder contains the workspace-local flight-software scaffold used by `demo_server/open_codex_web/data/input_data/gnc`.
It is intended to look like a small but real ADCS FSW stack: 42 owns the truth
simulation, this FSW owns the `AC` data mirror, mode logic, control commands,
and actuator dispatch.

The scaffold is compilable and runnable, but it is not a mission-validated GNC
controller. Mission workspaces should replace the default thresholds, pointing laws,
filters, control gains, and actuator allocation details with design-specific
logic.

## Architecture

- `ADCS/src/42fsw.c` is the 42 adapter. It is intentionally CFS-only: `FlightSoftWare()` only runs `CFS_FSW`, calls `AcFsw(&S->AC)`, and maps `AC` commands back to 42 actuators.
- `ADCS/src/AcSensors.c` synchronizes standard 42 sensor/reference state into `AC`, including `CBN`, `CLN`, `qln`, `wln`, ephemeris validity, and the coarse Earth-sensor surrogate.
- `ADCS/src/AcMode.c` defines mode names, transition conditions, and mode-entry hooks.
- `ADCS/src/AcStateMachine.c` provides the per-spacecraft FSW cycle: process sensors, clear commands, determine mode, apply transition, run control, and dispatch actuators.
- `ADCS/src/AcControl.c` implements the default per-mode controller dispatch.
- `ADCS/src/AcActuators.c` maps vector commands in `AC` to wheel, magnetic torquer, and thruster command fields.
- `ADCS/include/AcFswModules.h` contains the template mode IDs, thresholds, control gains, state structure, and module prototypes.
- `ADCS/include/Ac.h` and `ADCS/include/AcTypes.h` preserve the 42 FSW interface types.

## Default Modes

The template defines four modes:

- `SAFE`: quiet hold mode; commands remain zero.
- `DETUMBLE`: rate damping mode; uses the common torque-command path with magnetic torquer support when magnetic field data is valid.
- `ACQUIRE`: coarse acquisition; rate damping plus Earth-sensor roll/pitch feedback when available.
- `TRACK`: LVLH tracking; uses `qbn/qln` attitude error and `wbn/wln` rate error for a simple three-axis PD law.

Mode transitions are deliberately simple and are defined in `AcDetermineMode()`.
The default sequence is `SAFE -> DETUMBLE -> ACQUIRE -> TRACK`, with fallback
from `ACQUIRE` or `TRACK` to `DETUMBLE` when attitude validity or rate limits are
violated.

## Command Flow

The intended data path is:

```text
SC truth/sensors -> AC measurements -> AcFsw mode/control -> AC commands -> SC actuators
```

Control laws should operate on `struct AcType` only. Direct access to `struct
SCType` should stay inside `42fsw.c`, where 42 initialization and actuator mapping
are handled.
