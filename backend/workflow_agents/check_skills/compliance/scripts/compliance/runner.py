from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from . import checks
from .app_config import reference_dir
from .catalog_db import PostgresCatalogConfig, query_catalog_candidate_rows
from .component_io import load_components, load_reference_rows
from .config import ComplianceConfig
from .derating import analyze_xlsx
from .input_config import read_input_config
from .io_utils import (
    ensure_dir,
    read_json_if_exists,
    read_text,
    write_json,
    write_markdown,
)
from .llm_analysis import (
    analyze_requirements_and_satellite_with_llm,
    extract_satellite_info_with_llm,
)
from .llm_classifier import classify_components_with_llm, load_llm_classifier_config
from .llm_manufacturer import (
    manufacturer_check_rows,
    manufacturer_origin_map,
    match_manufacturers_with_llm,
)
from .llm_report import LlmReportConfig, build_llm_report
from .manufacturer_db import query_manufacturer_rows
from .reliability_db import (
    PostgresReliabilityConfig,
    load_postgres_components,
    query_postgres_reliability,
)
from .schema import ComponentRecord

try:
    from progress_utils import update_loop_progress
except ImportError:  # pragma: no cover - direct package use outside skill scripts path.
    update_loop_progress = None


STAGES = {
    "load_inputs",
    "requirements_analysis",
    "satellite_info",
    "component_classification",
    "manufacturer_check",
    "key_units_check",
    "flight_history_check",
    "catalog_match",
    "quality_level_check",
    "derating_check",
    "reliability_query",
    "report_generation",
}

DEFAULT_OUTPUT_SUBDIR = Path("check_outputs") / "compliance"

STAGE_PROGRESS: dict[str, tuple[str, str, str, float, float, bool]] = {
    "load_inputs": (
        "check_compliance_prepare",
        "compliance_inputs_loading",
        "compliance_inputs_ready",
        20.0,
        100.0,
        True,
    ),
    "requirements_analysis": (
        "check_compliance_interpret",
        "compliance_requirements_extracting",
        "compliance_requirements_ready",
        8.0,
        28.0,
        False,
    ),
    "satellite_info": (
        "check_compliance_interpret",
        "compliance_mission_extracting",
        "compliance_mission_ready",
        30.0,
        42.0,
        False,
    ),
    "component_classification": (
        "check_compliance_interpret",
        "compliance_components_classifying",
        "compliance_components_classified",
        45.0,
        72.0,
        False,
    ),
    "manufacturer_check": (
        "check_compliance_interpret",
        "compliance_manufacturers_matching",
        "compliance_interpret_ready",
        75.0,
        100.0,
        True,
    ),
    "key_units_check": (
        "check_compliance_checks",
        "compliance_key_units_checking",
        "compliance_key_units_checked",
        8.0,
        16.0,
        False,
    ),
    "flight_history_check": (
        "check_compliance_checks",
        "compliance_flight_history_checking",
        "compliance_flight_history_checked",
        18.0,
        28.0,
        False,
    ),
    "catalog_match": (
        "check_compliance_checks",
        "compliance_catalog_matching",
        "compliance_catalog_matched",
        30.0,
        48.0,
        False,
    ),
    "quality_level_check": (
        "check_compliance_checks",
        "compliance_quality_checking",
        "compliance_quality_checked",
        50.0,
        62.0,
        False,
    ),
    "derating_check": (
        "check_compliance_checks",
        "compliance_derating_checking",
        "compliance_derating_checked",
        64.0,
        82.0,
        False,
    ),
    "reliability_query": (
        "check_compliance_checks",
        "compliance_reliability_querying",
        "compliance_checks_ready",
        84.0,
        100.0,
        True,
    ),
    "report_generation": (
        "check_compliance_report",
        "compliance_report_generating",
        "compliance_report_ready",
        20.0,
        100.0,
        True,
    ),
}

STAGE_FAILED_STATUS = {
    "check_compliance_prepare": "compliance_prepare_failed",
    "check_compliance_interpret": "compliance_interpret_failed",
    "check_compliance_checks": "compliance_checks_failed",
    "check_compliance_report": "compliance_report_failed",
}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run one SatLab compliance stage.")
    parser.add_argument(
        "--stage", required=True, choices=sorted(STAGES), help="Single stage to run."
    )
    parser.add_argument(
        "--workspace-dir",
        default=None,
        help="Workspace root containing 00_inputs/input_config.json.",
    )
    parser.add_argument(
        "--output-dir",
        default=None,
        help="Directory for stage JSON and report outputs.",
    )
    parser.add_argument(
        "--config",
        default=None,
        help="Compliance/input config JSON. Defaults to workspace input_config.json.",
    )
    parser.add_argument(
        "--requirement-doc",
        default=None,
        help="Requirement document path. Defaults to input_config.json.",
    )
    parser.add_argument(
        "--component-list",
        default=None,
        help="Component list path. Defaults to input_config.json.",
    )
    parser.add_argument("--catalog", default=None, help="Optional local catalog table.")
    parser.add_argument(
        "--reliability-db",
        default=None,
        help="Optional local reliability evidence table.",
    )
    parser.add_argument(
        "--derating-table", default=None, help="Optional derating XLSX table."
    )
    parser.add_argument(
        "--derating-standard", default=None, help="Optional derating standard JSON."
    )
    parser.add_argument(
        "--classifier-rules", default=None, help="Classifier rules markdown."
    )
    parser.add_argument("--classifier-mode", choices=["llm", "auto"], default="llm")
    parser.add_argument("--report-mode", choices=["llm", "summary"], default="summary")
    parser.add_argument("--report-template-dir", default=None)
    parser.add_argument("--sheet-name", default=None)
    parser.add_argument(
        "--component-source", choices=["file", "postgres"], default="file"
    )
    parser.add_argument("--component-limit", type=int, default=None)
    parser.add_argument(
        "--catalog-source", choices=["file", "postgres"], default="postgres"
    )
    parser.add_argument(
        "--reliability-source", choices=["file", "postgres"], default="file"
    )
    parser.add_argument("--llm-config", default=None)
    parser.add_argument("--llm-base-url", default=None)
    parser.add_argument("--llm-api-key", default=None)
    parser.add_argument("--llm-model", default=None)
    parser.add_argument("--llm-timeout", type=int, default=None)
    parser.add_argument("--llm-batch-size", type=int, default=None)
    parser.add_argument("--llm-concurrency", type=int, default=None)
    parser.add_argument("--pg-db", default=None)
    parser.add_argument("--pg-user", default=None)
    parser.add_argument("--pg-password", default=None)
    parser.add_argument("--pg-host", default=None)
    parser.add_argument("--pg-port", default=None)
    parser.add_argument("--pg-schema", default=None)
    parser.add_argument("--reliability-limit", type=int, default=None)
    parser.add_argument("--catalog-pg-db", default=None)
    parser.add_argument("--catalog-pg-user", default=None)
    parser.add_argument("--catalog-pg-password", default=None)
    parser.add_argument("--catalog-pg-host", default=None)
    parser.add_argument("--catalog-pg-port", default=None)
    return parser


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    context = RunnerContext(args)
    update_stage_progress(context, args.stage, started=True)
    try:
        output = run_stage(args.stage, context)
    except Exception:
        update_stage_progress(context, args.stage, failed=True)
        raise
    stage_path = write_stage(context, args.stage, output)
    manifest = update_manifest(context)
    update_stage_progress(context, args.stage, completed=True)
    print(
        json.dumps(
            {"stage": args.stage, "output": str(stage_path), "manifest": str(manifest)},
            ensure_ascii=False,
            indent=2,
        )
    )


class RunnerContext:
    def __init__(self, args: argparse.Namespace) -> None:
        self.args = args
        self.workspace_dir = (
            Path(args.workspace_dir).resolve() if args.workspace_dir else None
        )
        self.output_dir = self._resolve_output_dir(args.output_dir)
        self.stages_dir = ensure_dir(self.output_dir / "stages")
        self.legacy_steps_dir = self.output_dir / "steps"
        self.config_path = (
            Path(args.config)
            if args.config
            else (
                self.workspace_dir / "00_inputs" / "input_config.json"
                if self.workspace_dir
                else None
            )
        )
        self.config = ComplianceConfig(self.config_path)
        self.resolved_inputs = self._resolved_input_config()
        self.requirement_doc = self._path_arg(
            args.requirement_doc, "requirement_document"
        ) or Path("missing_requirement.md")
        self.component_list = self._path_arg(
            args.component_list, "component_list"
        ) or Path("missing_component_list.xlsx")
        self.catalog_path = self._path_arg(args.catalog, "catalog") or self._path_arg(
            None, "catalog_evidence"
        )
        self.reliability_path = self._path_arg(
            args.reliability_db, "reliability_db"
        ) or self._path_arg(None, "reliability_evidence")
        self.derating_table = self._path_arg(args.derating_table, "derating_table")
        self.derating_standard = self._path_arg(
            args.derating_standard, "derating_standard"
        )
        self.classifier_standard_path = (
            Path(args.classifier_rules)
            if args.classifier_rules
            else reference_dir() / "8118_classifier_map_sys.md"
        )
        self.classifier_standard_text = (
            read_text(self.classifier_standard_path)
            if self.classifier_standard_path.exists()
            else ""
        )
        self.llm_config = load_llm_classifier_config(
            Path(args.llm_config) if args.llm_config else None,
            base_url=args.llm_base_url,
            api_key=args.llm_api_key,
            model=args.llm_model,
            timeout_seconds=args.llm_timeout,
            batch_size=args.llm_batch_size,
            concurrency=args.llm_concurrency,
        )
        self.report_config = LlmReportConfig(
            mode=args.report_mode,
            template_dir=Path(args.report_template_dir)
            if args.report_template_dir
            else reference_dir(),
        )

    def _resolve_output_dir(self, output_dir: str | None) -> Path:
        if self.workspace_dir is None:
            return Path(output_dir).resolve() if output_dir else Path("outputs").resolve()

        default_output_dir = self.workspace_dir / DEFAULT_OUTPUT_SUBDIR
        if not output_dir:
            return default_output_dir

        requested = Path(output_dir)
        if not requested.is_absolute():
            requested = self.workspace_dir / requested
        requested = requested.resolve()

        try:
            requested.relative_to(self.workspace_dir)
        except ValueError:
            return default_output_dir
        return requested

    def _resolved_input_config(self) -> dict[str, Any]:
        if not self.workspace_dir:
            return {}
        try:
            return read_input_config(self.workspace_dir, self.config_path)
        except Exception:
            return {}

    def _path_arg(self, explicit: str | None, input_key: str) -> Path | None:
        if explicit:
            return Path(explicit)
        files = (
            self.resolved_inputs.get("files")
            if isinstance(self.resolved_inputs, dict)
            else {}
        )
        if isinstance(files, dict) and files.get(input_key):
            return Path(files[input_key])
        derating = (
            self.resolved_inputs.get("derating")
            if isinstance(self.resolved_inputs, dict)
            else {}
        )
        if (
            input_key == "derating_table"
            and isinstance(derating, dict)
            and derating.get("table")
        ):
            return Path(derating["table"])
        if (
            input_key == "derating_standard"
            and isinstance(derating, dict)
            and derating.get("standard")
        ):
            return Path(derating["standard"])
        return None


def update_stage_progress(
    context: RunnerContext,
    stage: str,
    *,
    started: bool = False,
    completed: bool = False,
    failed: bool = False,
) -> None:
    if update_loop_progress is None or context.workspace_dir is None:
        return
    progress = STAGE_PROGRESS.get(stage)
    if progress is None:
        return
    (
        loop_name,
        running_status,
        completed_status,
        started_percent,
        completed_percent,
        complete_loop,
    ) = progress
    if failed:
        update_loop_progress(
            context.workspace_dir,
            loop_name=loop_name,
            status=STAGE_FAILED_STATUS.get(loop_name, f"{stage}_failed"),
            completed=False,
            percentage=started_percent,
        )
        return
    if started:
        update_loop_progress(
            context.workspace_dir,
            loop_name=loop_name,
            status=running_status,
            completed=False,
            percentage=started_percent,
        )
        return
    if completed:
        update_loop_progress(
            context.workspace_dir,
            loop_name=loop_name,
            status=completed_status,
            completed=complete_loop,
            percentage=completed_percent,
        )


def run_stage(stage: str, context: RunnerContext) -> Any:
    if stage == "load_inputs":
        return load_inputs(context)
    components = load_components_from_step(context)
    requirement_text = load_requirement_text(context)
    artifacts = load_artifacts(context)
    if stage == "requirements_analysis":
        requirements, satellite = analyze_requirements_and_satellite_with_llm(
            requirement_text, context.llm_config
        )
        write_stage(context, "satellite_info", satellite)
        return requirements
    if stage == "satellite_info":
        return extract_satellite_info_with_llm(requirement_text, context.llm_config)
    if stage == "component_classification":
        rows = classify_components_with_llm(
            components,
            context.config,
            context.llm_config,
            context.args.classifier_mode,
            context.classifier_standard_text,
        )
        write_stage(
            context,
            "category_summary",
            checks.summarize_category(
                components,
                manufacturer_origins_for_stage(context, components, artifacts),
            ),
        )
        return rows
    if stage == "manufacturer_check":
        return run_manufacturer_check(context, components)
    if stage == "key_units_check":
        return checks.select_key_units(components)
    if stage == "flight_history_check":
        return checks.check_flight_history(
            components, manufacturer_origins_for_stage(context, components, artifacts)
        )
    if stage == "catalog_match":
        if context.args.catalog_source == "postgres":
            catalog_components = domestic_components_for_catalog(
                context, components, artifacts
            )
            rows = query_catalog_candidate_rows(
                catalog_components, catalog_postgres_config(context)
            )
        else:
            rows = load_reference_rows(context.catalog_path)
        configured = context.config.external_results("catalog_match_results")
        return checks.catalog_match_with_candidates(
            components,
            rows,
            configured,
            manufacturer_origins_for_stage(context, components, artifacts),
            catalog_match_threshold(context),
            context.llm_config,
        )
    if stage == "quality_level_check":
        configured = context.config.external_results("quality_compare_results")
        return configured or checks.detect_low_quality(
            components,
            config=context.config,
            manufacturer_origins=manufacturer_origins_for_stage(
                context, components, artifacts
            ),
        )
    if stage == "derating_check":
        return run_derating(context)
    if stage == "reliability_query":
        return run_reliability(context, components)
    if stage == "report_generation":
        required = [
            "load_inputs",
            "requirements_analysis",
            "satellite_info",
            "component_classification",
        ]
        missing = [name for name in required if name not in artifacts]
        if missing:
            raise ValueError(
                f"Missing prerequisite step JSON for report_generation: {', '.join(missing)}"
            )
        markdown, report_meta = build_llm_report(
            "航天元器件选用报告", artifacts, context.llm_config, context.report_config
        )
        report_path = write_markdown(
            context.output_dir / "compliance_report.md", markdown
        )
        return {"report_path": str(report_path), **report_meta}
    raise ValueError(f"Unknown stage: {stage}")


def catalog_match_threshold(context: RunnerContext) -> float:
    value = context.config.get("catalog_match.threshold", checks.CATALOG_MATCH_THRESHOLD)
    try:
        threshold = float(value)
    except (TypeError, ValueError):
        return checks.CATALOG_MATCH_THRESHOLD
    if 0 <= threshold <= 1:
        return threshold
    return checks.CATALOG_MATCH_THRESHOLD


def run_manufacturer_check(
    context: RunnerContext, components: list[ComponentRecord]
) -> list[dict[str, Any]]:
    try:
        manufacturer_rows = query_manufacturer_rows(postgres_config(context))
        matches = match_manufacturers_with_llm(
            components, manufacturer_rows, context.llm_config
        )
        write_stage(context, "manufacturer_match", matches)
    except Exception as exc:
        write_stage(
            context,
            "manufacturer_check_issue",
            {
                "source": "postgres.public.manufacturer + llm",
                "status": "unavailable",
                "message": str(exc),
                "fallback": "continued_with_config_and_local_rules",
            },
        )
        matches = {}
    return manufacturer_check_rows(components, matches, context.config)


def manufacturer_origins_for_stage(
    context: RunnerContext,
    components: list[ComponentRecord],
    artifacts: dict[str, Any],
) -> dict[str, str]:
    rows = artifacts.get("manufacturer_check")
    if not rows:
        rows = run_manufacturer_check(context, components)
        write_stage(context, "manufacturer_check", rows)
    return manufacturer_origin_map(rows if isinstance(rows, list) else [])


def domestic_components_for_catalog(
    context: RunnerContext,
    components: list[ComponentRecord],
    artifacts: dict[str, Any],
) -> list[ComponentRecord]:
    manufacturer_rows = artifacts.get("manufacturer_check")
    if not manufacturer_rows:
        manufacturer_rows = run_manufacturer_check(context, components)
        write_stage(context, "manufacturer_check", manufacturer_rows)
    domestic_names = {
        str(row.get("厂商简称") or "").strip()
        for row in manufacturer_rows
        if isinstance(row, dict) and str(row.get("国产/进口") or "").strip() == "国产"
    }
    return [comp for comp in components if comp.manufacturer in domestic_names]


def load_inputs(context: RunnerContext) -> dict[str, Any]:
    if context.args.component_source == "postgres":
        components = load_postgres_components(
            postgres_config(context), context.args.component_limit
        )
    else:
        if not context.component_list.exists():
            raise FileNotFoundError(
                f"Component list not found: {context.component_list}"
            )
        components, missing = load_components(
            context.component_list, context.args.sheet_name
        )
        if missing:
            raise ValueError(
                f"Component list missing required fields: {', '.join(missing)}"
            )
    return {
        "requirement_doc": str(context.requirement_doc),
        "component_list": str(context.component_list),
        "config_file": str(context.config_path) if context.config_path else None,
        "config_loaded": context.config.enabled,
        "classifier_standard_file": str(context.classifier_standard_path),
        "classifier_standard_loaded": bool(context.classifier_standard_text),
        "component_count": len(components),
        "components": [component.to_dict() for component in components],
    }


def load_requirement_text(context: RunnerContext) -> str:
    if context.requirement_doc.exists():
        return read_text(context.requirement_doc)
    return (
        "未提供本地需求文档，使用自动流程默认要求：关键件重点审查，质量等级不低于CAST C，"
        "检查目录匹配、国产/进口、飞行经历、质量问题与辐射效应数据库记录。"
    )


def load_components_from_step(context: RunnerContext) -> list[ComponentRecord]:
    load_payload = step_output(context, "load_inputs")
    rows = load_payload.get("components") if isinstance(load_payload, dict) else []
    if not rows:
        load_payload = load_inputs(context)
        write_stage(context, "load_inputs", load_payload)
        rows = load_payload.get("components", [])
    return [ComponentRecord(**row) for row in rows if isinstance(row, dict)]


def run_derating(context: RunnerContext) -> dict[str, Any]:
    configured = context.config.external_results("derating_results")
    if configured:
        return {
            "source": "compliance_config.external_results.derating_results",
            "summary": context.config.get("external_results.derating_summary", {}),
            "issue_counts": context.config.get(
                "external_results.derating_issue_counts", {}
            ),
            "rows": configured,
        }
    if context.derating_table is None:
        return {
            "source": "compliance.derating",
            "status": "unavailable",
            "message": "No derating_table configured.",
            "rows": [],
            "results": [],
        }
    if not context.derating_table.exists():
        return {
            "source": "compliance.derating",
            "status": "unavailable",
            "message": f"Derating table not found: {context.derating_table}",
            "rows": [],
            "results": [],
        }
    standard = context.derating_standard
    if not standard or standard.suffix.lower() != ".json" or not standard.exists():
        standard = reference_dir() / "jiange_full.json"
    output = analyze_xlsx.run_analysis(
        xlsx_path=context.derating_table,
        workspace_dir=context.workspace_dir,
        reference_path=standard,
        rules_path=reference_dir() / "rules.md",
        output_dir=context.output_dir / "derating",
    )
    return output["result"]


def run_reliability(
    context: RunnerContext, components: list[ComponentRecord]
) -> list[dict[str, Any]]:
    if context.args.reliability_source == "postgres":
        configured = context.config.external_results("reliability_results")
        if configured:
            return configured
        try:
            return query_postgres_reliability(components, postgres_config(context))
        except Exception as exc:
            fallback = checks.reliability_query(components, [])
            for row in fallback:
                row["sql_mode"] = "postgres_unavailable"
                row["source_status"] = "unavailable"
                row["source_error"] = str(exc)
            return fallback
    return checks.reliability_query(
        components, load_reference_rows(context.reliability_path)
    )


def postgres_config(context: RunnerContext) -> PostgresReliabilityConfig:
    defaults = PostgresReliabilityConfig()
    args = context.args
    return PostgresReliabilityConfig(
        dbname=args.pg_db or defaults.dbname,
        user=args.pg_user or defaults.user,
        password=args.pg_password or defaults.password,
        host=args.pg_host or defaults.host,
        port=args.pg_port or defaults.port,
        schema=args.pg_schema or defaults.schema,
        limit_per_component=args.reliability_limit or defaults.limit_per_component,
    )


def catalog_postgres_config(context: RunnerContext) -> PostgresCatalogConfig:
    defaults = PostgresCatalogConfig()
    args = context.args
    return PostgresCatalogConfig(
        dbname=args.catalog_pg_db or defaults.dbname,
        user=args.catalog_pg_user or defaults.user,
        password=args.catalog_pg_password or defaults.password,
        host=args.catalog_pg_host or defaults.host,
        port=args.catalog_pg_port or defaults.port,
    )


def load_artifacts(context: RunnerContext) -> dict[str, Any]:
    artifacts = {}
    stage_paths = list(context.stages_dir.glob("*.json"))
    if not stage_paths and context.legacy_steps_dir.exists():
        stage_paths = list(context.legacy_steps_dir.glob("*.json"))
    for path in sorted(stage_paths):
        payload = read_json_if_exists(path)
        if isinstance(payload, dict) and "output" in payload:
            artifacts[path.stem] = payload["output"]
        else:
            artifacts[path.stem] = payload
    return artifacts


def step_output(context: RunnerContext, name: str) -> Any:
    payload = read_json_if_exists(context.stages_dir / f"{name}.json")
    if payload is None:
        payload = read_json_if_exists(context.legacy_steps_dir / f"{name}.json")
    if isinstance(payload, dict) and "output" in payload:
        return payload["output"]
    return payload


def write_stage(context: RunnerContext, stage: str, output: Any) -> Path:
    return write_json(
        context.stages_dir / f"{stage}.json", {"stage": stage, "output": output}
    )


def update_manifest(context: RunnerContext) -> Path:
    artifacts = {
        path.stem: f"stages/{path.name}"
        for path in sorted(context.stages_dir.glob("*.json"))
    }
    return write_json(context.output_dir / "manifest.json", {"artifacts": artifacts})


if __name__ == "__main__":
    main()
