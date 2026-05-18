from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from codex_agents.steps import (
    AnalysisStep,
    CaseBuildStep,
    FieldExportStep,
    GeometryEditStep,
    LayoutGenerateStep,
    PostprocessStep,
    SimulationStep,
    SuggestionStep,
)


@dataclass(frozen=True)
class PipelineStepSpec:
    command_name: str
    stage_name: str
    step_cls: type
    log_filename: str
    required_stage_names: tuple[str, ...] = ()
    required_files: tuple[str, ...] = ()

    def create_step(self) -> Any:
        return self.step_cls()


STEP_SPECS: tuple[PipelineStepSpec, ...] = (
    PipelineStepSpec(
        command_name="layout-generate",
        stage_name="layout_generate",
        step_cls=LayoutGenerateStep,
        log_filename="layout_generate_stage_result.json",
    ),
    PipelineStepSpec(
        command_name="geometry-edit",
        stage_name="geometry_validate",
        step_cls=GeometryEditStep,
        log_filename="geometry_validate_stage_result.json",
        required_stage_names=("layout_generate",),
        required_files=("logs/layout_generate_raw_result.json",),
    ),
    PipelineStepSpec(
        command_name="simulation",
        stage_name="simulation_run",
        step_cls=SimulationStep,
        log_filename="simulation_run_stage_result.json",
        required_stage_names=("geometry_validate",),
        required_files=(
            "02_geometry_edit/geometry_after.step",
            "02_geometry_edit/geometry_after.geom.json",
            "02_geometry_edit/geometry_after.layout_topology.json",
            "02_geometry_edit/geometry_after_registry.json",
            "02_geometry_edit/simulation_input.json",
            "02_geometry_edit/comsol_inputs/coord.txt",
            "02_geometry_edit/comsol_inputs/channels_input.npz",
        ),
    ),
    PipelineStepSpec(
        command_name="field-export",
        stage_name="field_export",
        step_cls=FieldExportStep,
        log_filename="field_export_stage_result.json",
        required_stage_names=("simulation_run",),
        required_files=("03_simulation/status.json", "03_simulation/field_samples.json", "03_simulation/tensors.json"),
    ),
    PipelineStepSpec(
        command_name="postprocess",
        stage_name="postprocess",
        step_cls=PostprocessStep,
        log_filename="postprocess_stage_result.json",
        required_stage_names=("field_export",),
        required_files=("04_postprocess/field_stats.json",),
    ),
    PipelineStepSpec(
        command_name="case-build",
        stage_name="case_build",
        step_cls=CaseBuildStep,
        log_filename="case_build_stage_result.json",
        required_stage_names=("postprocess",),
    ),
    PipelineStepSpec(
        command_name="analysis",
        stage_name="analysis",
        step_cls=AnalysisStep,
        log_filename="analysis_stage_result.json",
        required_stage_names=("case_build",),
    ),
    PipelineStepSpec(
        command_name="suggestion",
        stage_name="suggestion",
        step_cls=SuggestionStep,
        log_filename="suggestion_stage_result.json",
        required_stage_names=("analysis",),
        required_files=("05_case_build/component_index.json",),
    ),
)


def default_step_specs() -> tuple[PipelineStepSpec, ...]:
    return STEP_SPECS


def default_steps() -> list[Any]:
    return [spec.create_step() for spec in STEP_SPECS]


def step_command_names() -> tuple[str, ...]:
    return tuple(spec.command_name for spec in STEP_SPECS)


def get_step_spec(command_name: str) -> PipelineStepSpec:
    for spec in STEP_SPECS:
        if spec.command_name == command_name:
            return spec
    raise KeyError(f"unknown pipeline step command: {command_name}")
