from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

from . import checks
from .catalog_db import PostgresCatalogConfig, query_catalog_candidate_rows, query_catalog_rows
from .component_io import load_components, load_reference_rows
from .app_config import reference_dir
from .config import ComplianceConfig
from .io_utils import ensure_dir, read_text, write_json, write_markdown
from .llm_analysis import analyze_requirements_and_satellite_with_llm, analyze_requirements_with_llm, extract_satellite_info_with_llm
from .llm_classifier import LlmClassifierConfig, classify_components_with_llm, load_llm_classifier_config
from .llm_report import LlmReportConfig, build_llm_report
from .reliability_db import PostgresReliabilityConfig, load_postgres_components, query_postgres_reliability
from .schema import PipelineContext

try:
    from progress_utils import update_loop_progress
except ImportError:  # pragma: no cover - direct package use outside the skill CLI.
    update_loop_progress = None


StageFunc = Callable[[PipelineContext], Any]


STAGE_PROGRESS: dict[str, tuple[str, str, str, float, float]] = {
    "load_inputs": (
        "check_compliance_load_inputs",
        "load_inputs_running",
        "load_inputs_completed",
        20.0,
        100.0,
    ),
    "requirements_analysis": (
        "check_compliance_analysis",
        "analysis_running",
        "analysis_completed",
        15.0,
        55.0,
    ),
    "satellite_info": (
        "check_compliance_analysis",
        "analysis_running",
        "analysis_completed",
        60.0,
        100.0,
    ),
    "component_classification": (
        "check_compliance_classification",
        "classification_running",
        "classification_completed",
        20.0,
        100.0,
    ),
    "manufacturer_check": (
        "check_compliance_checks",
        "checks_running",
        "checks_completed",
        10.0,
        20.0,
    ),
    "key_units_check": (
        "check_compliance_checks",
        "checks_running",
        "checks_completed",
        25.0,
        40.0,
    ),
    "flight_history_check": (
        "check_compliance_checks",
        "checks_running",
        "checks_completed",
        45.0,
        55.0,
    ),
    "catalog_match": (
        "check_compliance_checks",
        "checks_running",
        "checks_completed",
        60.0,
        75.0,
    ),
    "quality_level_check": (
        "check_compliance_checks",
        "checks_running",
        "checks_completed",
        80.0,
        90.0,
    ),
    "reliability_query": (
        "check_compliance_checks",
        "checks_running",
        "checks_completed",
        92.0,
        100.0,
    ),
    "report_generation": (
        "check_compliance_report",
        "report_running",
        "report_completed",
        30.0,
        100.0,
    ),
}

LOOP_FINAL_STAGES = {
    "load_inputs",
    "satellite_info",
    "component_classification",
    "reliability_query",
    "report_generation",
}


class CompliancePipeline:
    """Automated compliance pipeline with explicit stage inputs and outputs."""

    def __init__(
        self,
        requirement_doc: str | Path,
        component_list: str | Path,
        output_dir: str | Path,
        catalog_path: str | Path | None = None,
        reliability_path: str | Path | None = None,
        config_path: str | Path | None = None,
        classifier_standard_path: str | Path | None = None,
        reliability_source: str = "file",
        catalog_source: str = "postgres",
        component_source: str = "file",
        component_limit: int | None = None,
        postgres_config: PostgresReliabilityConfig | None = None,
        catalog_postgres_config: PostgresCatalogConfig | None = None,
        sheet_name: str | None = None,
        classifier_mode: str = "llm",
        llm_classifier_config: LlmClassifierConfig | None = None,
        report_mode: str = "llm",
        report_template_dir: str | Path | None = None,
        workspace_dir: str | Path | None = None,
    ) -> None:
        self.context = PipelineContext(
            requirement_doc=Path(requirement_doc),
            component_list=Path(component_list),
            output_dir=Path(output_dir),
            catalog_path=Path(catalog_path) if catalog_path else None,
            reliability_path=Path(reliability_path) if reliability_path else None,
        )
        self.config = ComplianceConfig(config_path)
        default_classifier_standard = reference_dir() / "8118_classifier_map_sys.md"
        self.classifier_standard_path = Path(classifier_standard_path) if classifier_standard_path else default_classifier_standard
        self.classifier_standard_text = read_text(self.classifier_standard_path) if self.classifier_standard_path.exists() else ""
        self.classifier_mode = classifier_mode
        self.llm_classifier_config = llm_classifier_config or load_llm_classifier_config()
        self.report_config = LlmReportConfig(
            mode=report_mode,
            template_dir=Path(report_template_dir) if report_template_dir else reference_dir(),
        )
        self.sheet_name = sheet_name
        self.reliability_source = reliability_source
        self.catalog_source = catalog_source
        self.component_source = component_source
        self.component_limit = component_limit
        self.postgres_config = postgres_config
        self.catalog_postgres_config = catalog_postgres_config
        self.workspace_dir = Path(workspace_dir) if workspace_dir else self._infer_workspace_dir(Path(output_dir))
        self.steps_dir = ensure_dir(self.context.output_dir / "steps")
        self.stage_order = [
            "load_inputs",
            "requirements_analysis",
            "satellite_info",
            "component_classification",
            "manufacturer_check",
            "key_units_check",
            "flight_history_check",
            "catalog_match",
            "quality_level_check",
            "reliability_query",
            "report_generation",
        ]
        self.stage_inputs: dict[str, list[str]] = {
            "load_inputs": ["requirement_doc", "component_list", "component_source", "config_path"],
            "requirements_analysis": ["load_inputs.requirement_text", "analysis_mode"],
            "satellite_info": ["load_inputs.requirement_text", "analysis_mode"],
            "component_classification": ["load_inputs.components", "classifier_standard_path", "classifier_mode"],
            "manufacturer_check": ["load_inputs.components"],
            "key_units_check": ["load_inputs.components"],
            "flight_history_check": ["load_inputs.components"],
            "catalog_match": ["load_inputs.components", "catalog_source", "catalog_path"],
            "quality_level_check": ["load_inputs.components"],
            "reliability_query": ["load_inputs.components", "reliability_path"],
            "report_generation": [
                "requirements_analysis",
                "satellite_info",
                "component_classification",
                "manufacturer_check",
                "flight_history_check",
                "catalog_match",
                "quality_level_check",
                "reliability_query",
                "report_mode",
            ],
        }
        self.stage_funcs: dict[str, StageFunc] = {
            "load_inputs": self.load_inputs,
            "requirements_analysis": self.requirements_analysis,
            "satellite_info": self.satellite_info,
            "component_classification": self.component_classification,
            "manufacturer_check": self.manufacturer_check,
            "key_units_check": self.key_units_check,
            "flight_history_check": self.flight_history_check,
            "catalog_match": self.catalog_match,
            "quality_level_check": self.quality_level_check,
            "reliability_query": self.reliability_query,
            "report_generation": self.report_generation,
        }

    def run(self, stage: str = "all") -> dict[str, Any]:
        stages = self._selected_stages(stage)
        executed = []
        for stage_name in stages:
            self._update_stage_progress(stage_name, started=True)
            try:
                result = self.stage_funcs[stage_name](self.context)
                executed.append({"stage": stage_name, "output": str(self._write_stage(stage_name, result))})
            except Exception:
                self._update_stage_progress(stage_name, failed=True)
                raise
            self._update_stage_progress(stage_name, completed=True)
        for artifact_name, artifact_value in self.context.artifacts.items():
            artifact_path = self.steps_dir / f"{artifact_name}.json"
            if not artifact_path.exists():
                write_json(artifact_path, artifact_value)
        manifest = {
            "executed": executed,
            "artifacts": {name: f"steps/{name}.json" for name in self.context.artifacts},
        }
        write_json(self.context.output_dir / "manifest.json", manifest)
        return manifest

    def _infer_workspace_dir(self, output_dir: Path) -> Path | None:
        resolved = output_dir.resolve()
        for parent in (resolved, *resolved.parents):
            if parent.name == "check_outputs":
                return parent.parent
        return None

    def _update_stage_progress(
        self,
        stage_name: str,
        *,
        started: bool = False,
        completed: bool = False,
        failed: bool = False,
    ) -> None:
        if update_loop_progress is None or self.workspace_dir is None:
            return
        progress = STAGE_PROGRESS.get(stage_name)
        if progress is None:
            return
        loop_name, running_status, completed_status, started_percent, completed_percent = progress
        if failed:
            status = running_status.replace("_running", "_failed")
            update_loop_progress(
                self.workspace_dir,
                loop_name=loop_name,
                status=status,
                completed=False,
                percentage=started_percent,
            )
            return
        if started:
            update_loop_progress(
                self.workspace_dir,
                loop_name=loop_name,
                status=running_status,
                completed=False,
                percentage=started_percent,
            )
            return
        if completed:
            is_loop_final = stage_name in LOOP_FINAL_STAGES
            update_loop_progress(
                self.workspace_dir,
                loop_name=loop_name,
                status=completed_status if is_loop_final else running_status,
                completed=is_loop_final,
                percentage=completed_percent,
            )

    def _selected_stages(self, stage: str) -> list[str]:
        if stage in {"all", "*"}:
            return self.stage_order
        if stage.startswith("from:"):
            start = stage.split(":", 1)[1]
            if start not in self.stage_order:
                raise ValueError(f"Unknown stage: {start}")
            return self.stage_order[self.stage_order.index(start) :]
        if stage in self.stage_funcs:
            index = self.stage_order.index(stage)
            prerequisites = self.stage_order[: index + 1]
            return prerequisites
        groups = {
            "analysis": ["load_inputs", "requirements_analysis", "satellite_info", "component_classification", "manufacturer_check"],
            "checks": [
                "load_inputs",
                "component_classification",
                "manufacturer_check",
                "key_units_check",
                "flight_history_check",
                "catalog_match",
                "quality_level_check",
                "reliability_query",
            ],
            "report": self.stage_order,
        }
        if stage in groups:
            return groups[stage]
        raise ValueError(f"Unknown stage or group: {stage}")

    def _write_stage(self, stage_name: str, result: Any) -> Path:
        payload = {
            "stage": stage_name,
            "inputs": self._stage_input_manifest(stage_name),
            "output": result,
        }
        return write_json(self.steps_dir / f"{stage_name}.json", payload)

    def _stage_input_manifest(self, stage_name: str) -> dict[str, Any]:
        inputs: dict[str, Any] = {}
        for item in self.stage_inputs.get(stage_name, []):
            if item == "requirement_doc":
                inputs[item] = str(self.context.requirement_doc)
            elif item == "component_list":
                inputs[item] = str(self.context.component_list)
            elif item == "component_source":
                inputs[item] = self.component_source
            elif item == "config_path":
                inputs[item] = str(self.config.path) if self.config.path else None
            elif item == "classifier_standard_path":
                inputs[item] = str(self.classifier_standard_path) if self.classifier_standard_path else None
            elif item == "classifier_mode":
                inputs[item] = self.classifier_mode
                inputs["llm_classifier_enabled"] = self.llm_classifier_config.enabled
                inputs["llm_base_url"] = self.llm_classifier_config.base_url or None
                inputs["llm_model"] = self.llm_classifier_config.model or None
            elif item == "catalog_source":
                inputs[item] = self.catalog_source
                if self.catalog_source == "postgres":
                    config = self.catalog_postgres_config or PostgresCatalogConfig()
                    inputs["catalog_postgres"] = {
                        "dbname": config.dbname,
                        "user": config.user,
                        "host": config.host,
                        "port": config.port,
                        "mode": "bounded_candidate_recall",
                        "recall_limit_per_component": config.recall_limit_per_component,
                        "tables": ["component_series", "component_series_outside"],
                        "fields": [
                            "id",
                            "name",
                            "model",
                            "manufacturer",
                            "manufacturer_full_name",
                            "group",
                            "detail",
                            "source_table",
                        ],
                    }
            elif item == "analysis_mode":
                inputs[item] = "llm_only"
                inputs["llm_analysis_enabled"] = self.llm_classifier_config.enabled
                inputs["llm_base_url"] = self.llm_classifier_config.base_url or None
                inputs["llm_model"] = self.llm_classifier_config.model or None
            elif item == "catalog_path":
                inputs[item] = str(self.context.catalog_path) if self.context.catalog_path else None
            elif item == "reliability_path":
                inputs[item] = str(self.context.reliability_path) if self.context.reliability_path else None
            elif item == "report_mode":
                inputs[item] = self.report_config.mode
                inputs["report_template_dir"] = str(self.report_config.template_dir) if self.report_config.template_dir else None
            elif item.startswith("load_inputs."):
                inputs[item] = "steps/load_inputs.json"
            else:
                inputs[item] = f"steps/{item}.json"
        return inputs

    def load_inputs(self, context: PipelineContext) -> dict[str, Any]:
        if context.requirement_doc.exists():
            context.requirement_text = read_text(context.requirement_doc)
        else:
            context.requirement_text = (
                "未提供本地需求文档，使用自动流程默认要求：关键件重点审查，质量等级不低于CAST C，"
                "检查目录匹配、国产/进口、飞行经历、质量问题与辐射效应数据库记录。"
            )
        if self.component_source == "postgres":
            components = load_postgres_components(self.postgres_config, self.component_limit)
        else:
            if not context.component_list.exists():
                raise FileNotFoundError(f"Component list not found: {context.component_list}")
            components, missing = load_components(context.component_list, self.sheet_name)
            if missing:
                raise ValueError(f"Component list missing required fields: {', '.join(missing)}")
        context.components = components
        return context.set_artifact(
            "load_inputs",
            {
                "requirement_doc": str(context.requirement_doc),
                "component_list": str(context.component_list),
                "config_file": str(self.config.path) if self.config.path else None,
                "config_loaded": self.config.enabled,
                "classifier_standard_file": str(self.classifier_standard_path) if self.classifier_standard_path else None,
                "classifier_standard_loaded": bool(self.classifier_standard_text),
                "component_count": len(components),
                "components": [c.to_dict() for c in components],
            },
        )

    def requirements_analysis(self, context: PipelineContext) -> list[dict[str, str]]:
        self._ensure_loaded(context)
        if not context.get_artifact("satellite_info"):
            requirements, satellite = analyze_requirements_and_satellite_with_llm(
                context.requirement_text,
                self.llm_classifier_config,
            )
            context.set_artifact("satellite_info", satellite)
            return context.set_artifact("requirements_analysis", requirements)
        return context.set_artifact(
            "requirements_analysis",
            analyze_requirements_with_llm(context.requirement_text, self.llm_classifier_config),
        )

    def satellite_info(self, context: PipelineContext) -> list[dict[str, str]]:
        self._ensure_loaded(context)
        existing = context.get_artifact("satellite_info")
        if existing:
            return existing
        return context.set_artifact(
            "satellite_info",
            extract_satellite_info_with_llm(
                context.requirement_text,
                self.llm_classifier_config,
            ),
        )

    def component_classification(self, context: PipelineContext) -> list[dict[str, Any]]:
        self._ensure_loaded(context)
        result = classify_components_with_llm(
            context.components,
            self.config,
            self.llm_classifier_config,
            self.classifier_mode,
            self.classifier_standard_text,
        )
        context.set_artifact("category_summary", checks.summarize_category(context.components))
        return context.set_artifact("component_classification", result)

    def manufacturer_check(self, context: PipelineContext) -> list[dict[str, Any]]:
        self._ensure_loaded(context)
        return context.set_artifact("manufacturer_check", checks.normalize_manufacturers(context.components, config=self.config))

    def key_units_check(self, context: PipelineContext) -> list[dict[str, Any]]:
        self._ensure_loaded(context)
        return context.set_artifact("key_units_check", checks.select_key_units(context.components, self.config))

    def flight_history_check(self, context: PipelineContext) -> list[dict[str, Any]]:
        self._ensure_loaded(context)
        return context.set_artifact("flight_history_check", checks.check_flight_history(context.components))

    def catalog_match(self, context: PipelineContext) -> list[dict[str, Any]]:
        self._ensure_loaded(context)
        if self.catalog_source == "postgres":
            catalog_components = [comp for comp in context.components if checks._is_domestic(comp.manufacturer)]
            rows = query_catalog_candidate_rows(catalog_components, self.catalog_postgres_config)
        else:
            rows = load_reference_rows(context.catalog_path)
        configured = self.config.external_results("catalog_match_results")
        return context.set_artifact("catalog_match", checks.catalog_match_with_candidates(context.components, rows, configured))

    def quality_level_check(self, context: PipelineContext) -> list[dict[str, Any]]:
        self._ensure_loaded(context)
        configured = self.config.external_results("quality_compare_results")
        if configured:
            return context.set_artifact("quality_level_check", configured)
        return context.set_artifact("quality_level_check", checks.detect_low_quality(context.components, config=self.config))

    def reliability_query(self, context: PipelineContext) -> list[dict[str, Any]]:
        self._ensure_loaded(context)
        if self.reliability_source == "postgres":
            configured = self.config.external_results("reliability_results")
            if configured:
                return context.set_artifact("reliability_query", configured)
            pg_config = self.postgres_config or PostgresReliabilityConfig()
            try:
                return context.set_artifact(
                    "reliability_query",
                    query_postgres_reliability(context.components, pg_config),
                )
            except Exception as exc:
                issue = {
                    "source": "postgres",
                    "status": "unavailable",
                    "message": str(exc),
                    "db": pg_config.dbname,
                    "user": pg_config.user,
                    "host": pg_config.host,
                    "port": pg_config.port,
                    "schema": pg_config.schema,
                    "fallback": "continued_without_reliability_database",
                }
                context.set_artifact("reliability_query_issue", issue)
                fallback_rows = checks.reliability_query(context.components, [])
                for row in fallback_rows:
                    row["sql_mode"] = "postgres_unavailable"
                    row["source_status"] = "unavailable"
                    row["source_error"] = str(exc)
                return context.set_artifact("reliability_query", fallback_rows)
        rows = load_reference_rows(context.reliability_path)
        return context.set_artifact("reliability_query", checks.reliability_query(context.components, rows))

    def report_generation(self, context: PipelineContext) -> dict[str, str]:
        self._ensure_loaded(context)
        requirements = context.get_artifact("requirements_analysis") or self.requirements_analysis(context)
        satellite = context.get_artifact("satellite_info") or self.satellite_info(context)
        if not context.get_artifact("component_classification"):
            self.component_classification(context)
        title = "航天元器件选用报告"
        markdown, report_meta = build_llm_report(
            title,
            context.artifacts,
            self.llm_classifier_config,
            self.report_config,
        )
        report_path = write_markdown(context.output_dir / "compliance_report.md", markdown)
        result = {"report_path": str(report_path), **report_meta}
        return context.set_artifact("report_generation", result)

    def _ensure_loaded(self, context: PipelineContext) -> None:
        if not context.components or not context.requirement_text:
            self.load_inputs(context)
