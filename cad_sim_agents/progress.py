from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from codex_agents.local_io import read_json, write_json
from codex_agents.step_registry import PipelineStepSpec


PROGRESS_FILENAME = "progress_percentages.json"


@dataclass(frozen=True)
class StepProgress:
    command_name: str
    stage_name: str
    index: int
    weight_percent: float
    status: str = "pending"
    percent: float = 0.0
    started_at: str | None = None
    finished_at: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "command_name": self.command_name,
            "stage_name": self.stage_name,
            "index": self.index,
            "weight_percent": self.weight_percent,
            "status": self.status,
            "percent": self.percent,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
        }


class PipelineProgressTracker:
    def __init__(self, run_root: Path, step_specs: tuple[PipelineStepSpec, ...]) -> None:
        self.path = run_root / "logs" / PROGRESS_FILENAME
        self.step_specs = step_specs
        self.total_steps = len(step_specs)
        self.step_weight = round(100.0 / self.total_steps, 4) if self.total_steps else 0.0

    def initialize(self, *, reset: bool = False) -> dict[str, Any]:
        if self.path.exists() and not reset:
            return self._read()
        data = self._new_progress()
        return self._write(data)

    def mark_running(self, command_name: str) -> dict[str, Any]:
        data = self.initialize(reset=False)
        now = _utc_now()
        for step in data["steps"]:
            if step["command_name"] == command_name:
                step["status"] = "running"
                step["percent"] = max(float(step.get("percent") or 0.0), 5.0)
                step["started_at"] = step.get("started_at") or now
                step["finished_at"] = None
                break
        data["current_step"] = command_name
        data["updated_at"] = now
        data["overall_percent"] = self._overall_percent(data)
        return self._write(data)

    def mark_finished(self, command_name: str, *, status: str) -> dict[str, Any]:
        data = self.initialize(reset=False)
        now = _utc_now()
        for step in data["steps"]:
            if step["command_name"] == command_name:
                step["status"] = status
                if status == "completed":
                    step["percent"] = 100.0
                else:
                    step["percent"] = min(float(step.get("percent") or 0.0), 99.0)
                step["started_at"] = step.get("started_at") or now
                step["finished_at"] = now
                break
        data["current_step"] = None if status != "running" else command_name
        data["updated_at"] = now
        data["overall_percent"] = self._overall_percent(data)
        return self._write(data)

    def mark_blocked(self, command_name: str, *, reason: str) -> dict[str, Any]:
        data = self.mark_finished(command_name, status="blocked")
        data["error"] = reason
        return self._write(data)

    def _new_progress(self) -> dict[str, Any]:
        now = _utc_now()
        return {
            "schema_version": "1.0",
            "total_steps": self.total_steps,
            "overall_percent": 0.0,
            "current_step": None,
            "updated_at": now,
            "steps": [
                StepProgress(
                    command_name=spec.command_name,
                    stage_name=getattr(spec, "stage_name", spec.command_name),
                    index=index,
                    weight_percent=self.step_weight,
                ).to_dict()
                for index, spec in enumerate(self.step_specs, start=1)
            ],
        }

    def _overall_percent(self, data: dict[str, Any]) -> float:
        steps = data.get("steps", [])
        if not steps:
            return 0.0
        completed_weight = 0.0
        for step in steps:
            step_percent = float(step.get("percent") or 0.0)
            completed_weight += (step_percent / 100.0) * float(step.get("weight_percent") or 0.0)
        return round(completed_weight, 2)

    def _read(self) -> dict[str, Any]:
        data = read_json(self.path)
        if _is_pipeline_progress_payload(data):
            changed = self._reconcile_completed_stage_results(
                data,
                include_stage_logs=not self._has_active_fresh_progress(),
            )
            changed = self._normalize_progress_state(data) or changed
            if changed:
                return self._write(data)
            return data
        if isinstance(data, dict):
            migrated = self._new_progress()
            self._merge_legacy_freecad_progress(migrated, data)
            self._reconcile_completed_stage_results(migrated, include_stage_logs=not self._has_active_fresh_progress())
            self._normalize_progress_state(migrated)
            return self._write(migrated)
        return self._new_progress()

    def _write(self, data: dict[str, Any]) -> dict[str, Any]:
        if not _is_pipeline_progress_payload(data):
            migrated = self._new_progress()
            if isinstance(data, dict):
                self._merge_legacy_freecad_progress(migrated, data)
            self._reconcile_completed_stage_results(migrated, include_stage_logs=not self._has_active_fresh_progress())
            data = migrated
        write_json(self.path, data)
        return data

    def _has_active_fresh_progress(self) -> bool:
        """Detect a fresh run whose pipeline progress was temporarily replaced.

        FreeCAD may overwrite progress_percentages.json with its legacy payload
        during geometry-edit. On a fresh run, reconciling that payload against old
        manifest/log files can incorrectly resurrect downstream completed steps
        from a previous run in the same run_root.
        """
        manifest_path = self.path.parent.parent / "run_manifest.json"
        if not manifest_path.exists():
            return False
        try:
            manifest = read_json(manifest_path)
        except Exception:
            return False
        if not isinstance(manifest, dict):
            return False
        completed = {
            stage.get("stage_name")
            for stage in manifest.get("stages", [])
            if isinstance(stage, dict) and _is_completed_stage(stage)
        }
        return bool(completed) and "simulation_run" not in completed

    def _merge_legacy_freecad_progress(self, data: dict[str, Any], legacy: dict[str, Any]) -> None:
        progress = legacy.get("progress_percentages") or {}
        if not isinstance(progress, dict):
            progress = {}
        geometry_percent = _aggregate_freecad_progress(progress)
        freecad_progress = {
            "tool": legacy.get("tool"),
            "updated_at": legacy.get("updated_at"),
            "success": bool(legacy.get("success")),
            "progress_percentages": progress,
            "output_files": legacy.get("output_files") or {},
            **progress,
        }
        now = _utc_now()
        for step in data["steps"]:
            if step["command_name"] != "geometry-edit":
                continue
            step["status"] = "completed" if freecad_progress["success"] and geometry_percent >= 100.0 else "running"
            step["percent"] = geometry_percent
            step["started_at"] = now
            step["finished_at"] = now if step["status"] == "completed" else None
            step["freecad_progress"] = freecad_progress
            break
        data["current_step"] = None if freecad_progress["success"] and geometry_percent >= 100.0 else "geometry-edit"
        data["updated_at"] = now
        data["overall_percent"] = self._overall_percent(data)
        data["freecad_progress"] = freecad_progress
        data["output_files"] = freecad_progress["output_files"]

    def _reconcile_completed_stage_results(self, data: dict[str, Any], *, include_stage_logs: bool = True) -> bool:
        """Restore completed step state from durable stage result logs.

        FreeCAD writes progress from a separate process. If an older FreeCAD writer
        replaced the pipeline progress file, migration starts from a fresh step
        list and can otherwise lose already completed earlier steps.
        """
        changed = False
        now = _utc_now()
        run_root = self.path.parent.parent
        manifest_stages = _completed_stages_from_manifest(run_root / "run_manifest.json")
        for spec in self.step_specs:
            stage_name = getattr(spec, "stage_name", getattr(spec, "command_name", None))
            if not stage_name:
                continue
            stage = manifest_stages.get(stage_name)
            log_filename = getattr(spec, "log_filename", None)
            if stage is None and include_stage_logs and log_filename:
                stage = _read_completed_stage_result(run_root / "logs" / log_filename)
            if stage is None:
                continue
            for step in data.get("steps", []):
                if step.get("command_name") != spec.command_name:
                    continue
                if step.get("status") == "completed" and float(step.get("percent") or 0.0) >= 100.0:
                    break
                step["status"] = "completed"
                step["percent"] = 100.0
                step["started_at"] = step.get("started_at") or stage.get("started_at") or now
                step["finished_at"] = step.get("finished_at") or stage.get("finished_at") or now
                changed = True
                break
        if changed:
            data["updated_at"] = now
            data["overall_percent"] = self._overall_percent(data)
        return changed

    def _normalize_progress_state(self, data: dict[str, Any]) -> bool:
        changed = False
        for step in data.get("steps", []):
            status = step.get("status")
            if status != "completed" and float(step.get("percent") or 0.0) >= 100.0:
                step["percent"] = 99.0
                changed = True
        running_steps = [step for step in data.get("steps", []) if step.get("status") == "running"]
        expected_current = running_steps[0].get("command_name") if running_steps else None
        if data.get("current_step") != expected_current:
            data["current_step"] = expected_current
            changed = True
        overall_percent = self._overall_percent(data)
        if data.get("overall_percent") != overall_percent:
            data["overall_percent"] = overall_percent
            changed = True
        if changed:
            data["updated_at"] = _utc_now()
        return changed


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _aggregate_freecad_progress(progress: dict[str, Any]) -> float:
    values = [
        float(progress.get("layout_completion_percent") or 0.0),
        float(progress.get("modeling_percent") or 0.0),
        float(progress.get("export_file_percent") or 0.0),
    ]
    clamped = [max(0.0, min(100.0, value)) for value in values]
    return round(sum(clamped) / len(clamped), 2)


def _is_pipeline_progress_payload(data: Any) -> bool:
    return (
        isinstance(data, dict)
        and data.get("schema_version") == "1.0"
        and isinstance(data.get("steps"), list)
        and len(data.get("steps") or []) > 0
    )


def _is_completed_stage(stage: dict[str, Any]) -> bool:
    return stage.get("status") in {"completed", "completed_with_unplaced"}


def _completed_stages_from_manifest(path: Path) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}
    try:
        manifest = read_json(path)
    except Exception:
        return {}
    if not isinstance(manifest, dict):
        return {}
    stages: dict[str, dict[str, Any]] = {}
    for stage in manifest.get("stages", []):
        if isinstance(stage, dict) and isinstance(stage.get("stage_name"), str) and _is_completed_stage(stage):
            stages[stage["stage_name"]] = stage
    return stages


def _read_completed_stage_result(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        stage = read_json(path)
    except Exception:
        return None
    if isinstance(stage, dict) and _is_completed_stage(stage):
        return stage
    return None
