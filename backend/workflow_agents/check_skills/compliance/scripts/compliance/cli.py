from __future__ import annotations

import argparse
import json
from pathlib import Path

from .catalog_db import PostgresCatalogConfig
from .llm_classifier import load_llm_classifier_config
from .pipeline import CompliancePipeline
from .reliability_db import PostgresReliabilityConfig


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the standalone SatLab compliance pipeline.")
    parser.add_argument("--requirement-doc", required=True, help="Path to requirement markdown/text document.")
    parser.add_argument("--component-list", required=True, help="Path to component list xlsx/csv/json.")
    parser.add_argument("--output-dir", default="outputs", help="Directory for step outputs and final report.")
    parser.add_argument("--workspace-dir", default=None, help="Workspace root for logs/progress.json. Inferred from --output-dir when omitted.")
    parser.add_argument("--catalog", default=None, help="Optional component catalog xlsx/csv/json for catalog matching.")
    parser.add_argument("--reliability-db", default=None, help="Optional reliability evidence xlsx/csv/json in file mode.")
    parser.add_argument("--config", default=None, help="Optional JSON file fixing values that the original web flow asked users to confirm.")
    parser.add_argument("--classifier-rules", default=None, help="Path to 8118_classifier_map_sys.md. Defaults to this skill's reference directory.")
    parser.add_argument(
        "--classifier-mode",
        choices=["llm", "auto"],
        default="llm",
        help="Component classifier mode. Classification uses the 8118 markdown standard directly.",
    )
    parser.add_argument("--llm-base-url", default=None, help="OpenAI-compatible base URL. Defaults to COMPLIANCE_LLM_BASE_URL or config.json chatModel.baseUrl.")
    parser.add_argument("--llm-api-key", default=None, help="OpenAI-compatible API key. Defaults to COMPLIANCE_LLM_API_KEY or config.json chatModel.apiKey.")
    parser.add_argument("--llm-model", default=None, help="LLM model name. Defaults to COMPLIANCE_LLM_MODEL or config.json chatModel.model.")
    parser.add_argument("--llm-config", default=None, help="Optional JSON file containing apiKey/baseUrl/model. If omitted, config.json chatModel is used.")
    parser.add_argument("--llm-timeout", type=int, default=None, help="LLM request timeout in seconds.")
    parser.add_argument("--llm-batch-size", type=int, default=None, help="Number of components per LLM classification request.")
    parser.add_argument("--llm-concurrency", type=int, default=None, help="Max concurrent LLM requests. Defaults to COMPLIANCE_LLM_CONCURRENCY or config.json chatModel concurrency.")
    parser.add_argument(
        "--report-mode",
        choices=["llm"],
        default="llm",
        help="Report generation mode. Reports are written by LLM; templates are only used as writing guidance.",
    )
    parser.add_argument(
        "--report-template-dir",
        default=None,
        help="Directory containing report markdown templates. Defaults to this skill's reference directory.",
    )
    parser.add_argument(
        "--reliability-source",
        choices=["file", "postgres"],
        default="file",
        help="Reliability evidence source. Use postgres to read the original reliability database tables.",
    )
    parser.add_argument(
        "--catalog-source",
        choices=["file", "postgres"],
        default="postgres",
        help="Catalog source for step 6. Defaults to postgres; use file with --catalog for a local catalog.",
    )
    parser.add_argument("--catalog-pg-db", default=None, help="Catalog PostgreSQL database. Defaults to CATALOG_POSTGRES_DB or components_db.")
    parser.add_argument("--catalog-pg-user", default=None, help="Catalog PostgreSQL user. Defaults to CATALOG_POSTGRES_USER or postgres.")
    parser.add_argument("--catalog-pg-password", default=None, help="Catalog PostgreSQL password. Defaults to CATALOG_POSTGRES_PASSWORD or lbk123.")
    parser.add_argument("--catalog-pg-host", default=None, help="Catalog PostgreSQL host. Defaults to CATALOG_POSTGRES_HOST or 10.110.10.101.")
    parser.add_argument("--catalog-pg-port", default=None, help="Catalog PostgreSQL port. Defaults to CATALOG_POSTGRES_PORT or 5432.")
    parser.add_argument("--pg-db", default=None, help="PostgreSQL database name. Defaults to POSTGRES_DB or satllm_db.")
    parser.add_argument("--pg-user", default=None, help="PostgreSQL user. Defaults to POSTGRES_USER or postgres.")
    parser.add_argument("--pg-password", default=None, help="PostgreSQL password. Defaults to POSTGRES_PASSWORD or lbk123.")
    parser.add_argument("--pg-host", default=None, help="PostgreSQL host. Defaults to POSTGRES_HOST or localhost.")
    parser.add_argument("--pg-port", default=None, help="PostgreSQL port. Defaults to POSTGRES_PORT or 5432.")
    parser.add_argument("--pg-schema", default=None, help="PostgreSQL schema. Defaults to POSTGRES_SCHEMA or staging.")
    parser.add_argument("--reliability-limit", type=int, default=None, help="Rows per component for each reliability query.")
    parser.add_argument("--sheet-name", default=None, help="Optional Excel sheet name for component list.")
    parser.add_argument(
        "--component-source",
        choices=["file", "postgres"],
        default="file",
        help="Component list source. Use postgres to read public.component from the database.",
    )
    parser.add_argument("--component-limit", type=int, default=None, help="Optional max components when --component-source postgres.")
    parser.add_argument(
        "--stage",
        default="all",
        help=(
            "Stage selector: all, analysis, checks, report, a single stage name, "
            "or from:<stage>. Single stage names run prerequisites first."
        ),
    )
    return parser


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    pg_config = None
    if args.reliability_source == "postgres":
        defaults = PostgresReliabilityConfig()
        pg_config = PostgresReliabilityConfig(
            dbname=args.pg_db or defaults.dbname,
            user=args.pg_user or defaults.user,
            password=args.pg_password or defaults.password,
            host=args.pg_host or defaults.host,
            port=args.pg_port or defaults.port,
            schema=args.pg_schema or defaults.schema,
            limit_per_component=args.reliability_limit or defaults.limit_per_component,
        )
    catalog_pg_config = None
    if args.catalog_source == "postgres":
        defaults = PostgresCatalogConfig()
        catalog_pg_config = PostgresCatalogConfig(
            dbname=args.catalog_pg_db or defaults.dbname,
            user=args.catalog_pg_user or defaults.user,
            password=args.catalog_pg_password or defaults.password,
            host=args.catalog_pg_host or defaults.host,
            port=args.catalog_pg_port or defaults.port,
        )
    llm_config = load_llm_classifier_config(
        Path(args.llm_config) if args.llm_config else None,
        base_url=args.llm_base_url,
        api_key=args.llm_api_key,
        model=args.llm_model,
        timeout_seconds=args.llm_timeout,
        batch_size=args.llm_batch_size,
        concurrency=args.llm_concurrency,
    )

    pipeline = CompliancePipeline(
        requirement_doc=Path(args.requirement_doc),
        component_list=Path(args.component_list),
        output_dir=Path(args.output_dir),
        catalog_path=Path(args.catalog) if args.catalog else None,
        reliability_path=Path(args.reliability_db) if args.reliability_db else None,
        config_path=Path(args.config) if args.config else None,
        classifier_standard_path=Path(args.classifier_rules) if args.classifier_rules else None,
        reliability_source=args.reliability_source,
        catalog_source=args.catalog_source,
        component_source=args.component_source,
        component_limit=args.component_limit,
        postgres_config=pg_config,
        catalog_postgres_config=catalog_pg_config,
        sheet_name=args.sheet_name,
        classifier_mode=args.classifier_mode,
        llm_classifier_config=llm_config,
        report_mode=args.report_mode,
        report_template_dir=Path(args.report_template_dir) if args.report_template_dir else None,
        workspace_dir=Path(args.workspace_dir) if args.workspace_dir else None,
    )
    manifest = pipeline.run(stage=args.stage)
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
