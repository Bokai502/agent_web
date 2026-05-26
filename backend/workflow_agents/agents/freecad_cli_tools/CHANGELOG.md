# Changelog

## [0.9.0] - 2026-04-09

### Added

- External envelope face support (faces 6–11) in `geometry.py`, `yaml_schema.py`, and
  `rpc_script_fragments.py`. Faces 0–5 remain internal; faces 6–11 mount components on the
  *outside* of the envelope using `outer_size` as the wall reference.
- New helpers `is_external_face()` and `component_contact_face()` in `geometry.py`.
  `component_mount_face()` now always returns the physical contact face (0–5) regardless of whether
  the YAML stores an internal or external installation face.
- `build_analysis_context()` gains a `check_envelope` parameter; `analyze_bounds()` skips the
  `ENVELOPE_BOUNDARY` blocker when `check_envelope=False` (used for external-face moves).
- `find_best_safe_scale()` skips `envelope_safe_interval` for external faces and uses full-range
  obstacle-only collision search instead.
- `freecad-yaml-safe-move` now accepts `--install-face 6..11`. For external faces it reads
  `envelope.outer_size` as the wall reference and disables the inner-envelope containment check.

### Changed

- `centered_face_position()` and `constrain_position_to_envelope_face()` parameter `inner_size`
  renamed to `wall_size`; callers pass `outer_size` for external faces, `inner_size` for internal.
- `cylinder_axis_index()` in `geometry.py` now uses `FACE_DEFINITIONS[mount_face][1]` dict lookup
  instead of integer arithmetic, correctly handling all 12 face IDs.
- `cylinder_axis_index()` fragment in `rpc_script_fragments.py` updated to support faces 0–11
  via `(mount_face % 6) // 2`; bounds check widened from `> 5` to `> 11`.
- `_VALID_FACE_IDS` in `yaml_schema.py` expanded from `range(6)` to `range(12)`; all "0..5" error
  messages updated to "0..11".

### Tests

- `test_yaml_schema.py`: invalid `mount_face` test value updated from `7` to `13`.
- `test_fragment_sync.py`: `cylinder_axis_index` parametrize range extended from `range(6)` to
  `range(12)`.

### Updated

- Bumped package version from `0.8.0` to `0.9.0` in `pyproject.toml` and `__init__.py`.
- Updated FreeCAD skill docs: `SKILL.md` and `guides/safe-move-workflow.md` — `--install-face`
  range documented as `<0..11>` with notes on internal vs external face semantics.
- Refreshed FreeCAD skill backup under `skill_backups/freecad/`.

## [0.8.0] - 2026-04-08

### Refactored

- Extract `geometry.py` module: all 44 pure geometry functions and 8 constants moved out of
  `yaml_component_safe_move.py` (1081 -> ~280 lines). CLI file now focuses on parsing, YAML I/O,
  CAD sync, and orchestration only.
- Add cross-reference comments in `rpc_script_fragments.py` mapping each FreeCAD-side fragment
  function to its `geometry.py` equivalent.
- Backward-compatible re-exports kept in `yaml_component_safe_move.py`; new code should import
  from `freecad_cli_tools.geometry` directly.

### Added

- `yaml_schema.py`: YAML assembly schema validation with `validate_assembly()` and
  `AssemblyValidationError`. Provides clear error messages (including component ID) instead of
  cryptic `KeyError`. Called automatically in `freecad-yaml-safe-move` after loading YAML.
- `tests/test_yaml_schema.py`: 15 tests for schema validation.
- `tests/test_fragment_sync.py`: cross-validation tests ensuring `rpc_script_fragments.py` string
  fragments stay in sync with `geometry.py` functions.
- `tests/test_rpc_script_templates.py`: renders all 6 RPC script templates with dummy placeholders
  and verifies valid Python syntax via `compile()`.

### Fixed

- Replace manual `try/except/else` with `pytest.raises` in test suite; fix `AssertionError` typo.

## [0.7.0] - 2025

### Added

- In-place move workflow with `--spin` and `--install-face` support.
- Cylinder shape support for YAML assemblies and safe moves.
- Batched CAD placement sync via `freecad-sync-placements`.

## [0.6.0] - 2025

### Added

- Bilingual documentation (English and Chinese).
- Architecture diagrams.

## [0.4.0 - 0.5.0] - 2025

### Added

- CI pipeline and test suite.
- Batched CAD sync helpers.

## [0.2.0 - 0.3.0] - 2025

### Improved

- Startup reliability and performance.
- Move workflow enhancements.

## [0.1.0] - 2025

### Added

- Initial project setup with XML-RPC client, CLI commands, and FreeCAD-side script templates.
