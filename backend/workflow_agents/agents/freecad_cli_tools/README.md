# FreeCAD CLI Tools

Command-line tools for interacting with FreeCAD documents, layout datasets, and
direct assembly-build workflows. The package includes both XML-RPC-based
commands and offline dataset utilities.

Chinese version: [README.zh-CN.md](./README.zh-CN.md)

## Installation

### Method 1: Install from source

```bash
cd /path/to/open_codex_web/backend/workflow_agents/agents/freecad_cli_tools
python -m pip install -e .
```

### Method 2: Build and install wheel

```bash
cd /path/to/open_codex_web/backend/workflow_agents/agents/freecad_cli_tools
python -m pip install build
python -m build
python -m pip install dist/freecad_cli_tools-*.whl
```

## Usage

From a source checkout, run the unified CLI module from the package directory:

```bash
cd /path/to/open_codex_web/backend/workflow_agents/agents/freecad_cli_tools

# Configuration
python -m freecad_cli_tools.cli.main config show

# Assembly generation
python -m freecad_cli_tools.cli.main assembly create-from-component-info --doc-name DirectAssembly
python -m freecad_cli_tools.cli.main cad build
python -m freecad_cli_tools.cli.main cad validate

# Safe move with layout_topology.json + geom.json
python -m freecad_cli_tools.cli.main layout safe-move --component P001 --move 50 50 0
python -m freecad_cli_tools.cli.main layout safe-move --component P001 --move 50 50 0 --format json
python -m freecad_cli_tools.cli.main layout safe-move --component P001 --move 50 50 0 --no-sync-cad
python -m freecad_cli_tools.cli.main layout safe-move --component P002 --install-face 4 --move 0 0 0
```

After editable or wheel installation, `freecad-tools` is available as the
short console-script alias for the same commands.

Workspace-scoped commands resolve relative paths from
the project root `config.json` field `workspace.workspaceDir` by default. Pass
`--workspace` / `--workspace-dir` to override that default for a specific
command.

`python -m freecad_cli_tools.cli.main assembly create-from-component-info` reads
`./00_inputs/real_bom.json`, `./00_inputs/layout_topology.json`, and
`./00_inputs/geom.json`. It resolves real STEP/STP assets from
`real_bom.source.template_csv` using each BOM item's `semantic_name`; if
`--geom-component-info` is supplied, that file overrides the synthesized
component info. Missing or unreadable STEP assets fall back to `Part::Box`.
Oversized STEP assets also fall back to `Part::Box`; use `--max-step-size-mb`
to control that threshold or `-1` to disable it. The direct-build workflow exports
`./01_cad/component_info_assembly.step` and sibling
`component_info_assembly.glb`.

`python -m freecad_cli_tools.cli.main cad build` reads `./00_inputs/real_bom.json`,
`./00_inputs/layout_topology.json`, and `./00_inputs/geom.json`, then writes
the CAD-stage bundle under `./01_cad`:

- `geometry_after.step`
- `geometry_after.glb`
- `simulation_input.json`
- `cad_agent_output.json`

It also writes compatibility after-state files such as
`geometry_after.geom.json`, `geometry_after.layout_topology.json`,
`geometry_after_registry.json`, plus COMSOL input files at
`comsol_inputs/coord.txt` and `comsol_inputs/channels_input.npz`.

`python -m freecad_cli_tools.cli.main cad validate` validates the `./01_cad` bundle against
`./00_inputs` and writes the validation report directly into
`./01_cad/cad_agent_output.json` under the `validation` key. By default it also
captures six face views of the active CAD document through FreeCAD RPC, writes
`./01_cad/freecad_screenshot_top.png`,
`./01_cad/freecad_screenshot_bottom.png`,
`./01_cad/freecad_screenshot_front.png`,
`./01_cad/freecad_screenshot_back.png`,
`./01_cad/freecad_screenshot_left.png`, and
`./01_cad/freecad_screenshot_right.png`, and records the image paths under the
top-level `screenshot` key. Pass `--no-screenshot` to skip image capture.

All first-class CLI outputs include progress percentages:

- `layout_completion_percent`: dataset/layout stage completion.
- `modeling_percent`: FreeCAD modeling or CAD-sync stage completion.
- `export_file_percent`: exported-file completion; STEP and GLB count as 50% each.

For dataset-only `python -m freecad_cli_tools.cli.main layout safe-move` runs, no CAD modeling or export is requested, so
`modeling_percent` and `export_file_percent` are `0.0`.
The latest percentages are also written to
`<configured workspace>/logs/progress_percentages.json`. That file also includes
an `output_files` object with each produced file path and whether it exists.
During CAD operations, the FreeCAD-side script refreshes the file as modeling
and STEP/GLB export stages actually advance.

## Recommended Move Workflow

Use the layout dataset as the source of truth whenever you have
`layout_topology.json` and `geom.json`:

1. Run `python -m freecad_cli_tools.cli.main layout safe-move` on the dataset pair.
2. Let it compute a safe move, write new dataset files under `./01_cad`, and update the CAD STEP/GLB artifacts.
3. Use `--no-sync-cad` only when you explicitly want a JSON-only offline update.
4. Use `python -m freecad_cli_tools.cli.main cad build` when you need to rebuild the full CAD-stage bundle from `00_inputs`.

## Layout Dataset Safe Move Command

`python -m freecad_cli_tools.cli.main layout safe-move` is the layout-dataset move command. By default
it syncs the approved result into a running FreeCAD document and exports
`geometry_after.step` plus `geometry_after.glb`; pass `--no-sync-cad` for a
JSON-only offline update.

Use it when you want to:

- move one component in `layout_topology.json + geom.json`
- detect component collisions against other components using their current bounded geometry
- preserve the component's current orientation while moving it, or explicitly reorient it onto a
  different envelope face
- keep internal components (faces 0–5) inside `envelope.inner_size`, or place external components
  (faces 6–11) on the outside of the envelope using `envelope.outer_size`
- write the updated dataset placement and geometry fields into new JSON files under `./01_cad`
- update the matching component in an open FreeCAD document and export STEP/GLB by default
- keep external-face moves inside the selected wall's in-plane 2D footprint and surface
  `FACE_BOUNDARY` when a requested path would slide past the wall edge

The command treats `placement.position` as the component local-bounds minimum
corner and performs collision-safe moves for the component's current
orientation by default. In the current normalized model, `placement.mount_face`
stores the *installation face* (0–11): faces 0–5 are internal (inside
the envelope, wall reference = `inner_size`); faces 6–11 are external (outside the envelope, wall
reference = `outer_size`). `placement.rotation_matrix` captures the assembly
orientation. When `--install-face` is supplied (accepts 0–11), the command
rotates the component so its own contact face is installed onto the requested envelope face, starts
from the centered position on that face, and applies the requested move as an in-plane offset there.
For external faces, the component is oriented outward (contact face points inward toward the
envelope center) and the envelope-boundary containment check is skipped. `--install-face` and
the requested move can be combined. If the full requested move is safe, it applies it directly. If not, it
finds the closest safe prefix on that segment. If no safe point exists on the requested segment, it
reports that no solution was found and still writes the constrained dataset
state. Unless `--no-sync-cad` is supplied, it then updates the matching component object in the
target FreeCAD document directly from the computed final placement and exports STEP/GLB.

External-face note: although faces `6-11` skip the inner-envelope containment check, they are still
clamped to the selected wall's in-plane boundary using `envelope.outer_size`. When the requested
segment would cross that footprint, the command truncates the move to the closest safe prefix and
includes `FACE_BOUNDARY` in the blocker list.

In the v9 workspace workflow, move and rotation requests now default
to reading from `./00_inputs` and writing new dataset files plus
`geometry_after.step` / `geometry_after.glb` under `./01_cad`, so the
source dataset remains unchanged unless the user explicitly overrides the paths.

Workspace resolution is deterministic: configure
`project root config.json` field `workspace.workspaceDir`, then use
`python -m freecad_cli_tools.cli.main config show` to inspect the resolved absolute paths.

## Development Layout

- `src/freecad_cli_tools/cli/`: thin command entry points
- `src/freecad_cli_tools/geometry.py`: pure geometry, collision detection, and component-shape helpers (no external dependencies)
- `src/freecad_cli_tools/layout_dataset.py`: layout dataset normalization and reverse write-back
- `src/freecad_cli_tools/layout_dataset_common.py`: shared validation helpers for layout dataset parsing
- `src/freecad_cli_tools/layout_dataset_faces.py`: install-face mapping and reverse face resolution
- `src/freecad_cli_tools/layout_dataset_io.py`: atomic JSON I/O helpers for layout dataset files
- `src/freecad_cli_tools/component_info_assembly.py`: normalization for direct assembly builds from `00_inputs/real_bom.json` and optional `geom_component_info.json`
- `src/freecad_cli_tools/freecad_sync.py`: reusable placement sync helpers for single or batched CAD updates
- `src/freecad_cli_tools/cli_support.py`: shared CLI-side helpers for RPC calls, output parsing, and file input
- `src/freecad_cli_tools/rpc_scripts/`: FreeCAD-side Python scripts executed over XML-RPC
- `src/freecad_cli_tools/rpc_script_loader.py`: packaged script loader and placeholder renderer
- `src/freecad_cli_tools/rpc_script_fragments.py`: reusable FreeCAD-side code fragments injected into script templates
- `tests/`: unit tests for geometry algorithms, schema validation, fragment sync verification, and RPC template syntax

## Requirements

- For RPC commands: FreeCAD with the MCP addon running on the host/port from the CLI flags or environment
- Relative input and output paths are resolved against `workspace.workspaceDir` from `project root config.json`
- For offline layout-dataset use of `python -m freecad_cli_tools.cli.main layout safe-move`: Python 3.9+ only
- Python 3.9+

## License

MIT
