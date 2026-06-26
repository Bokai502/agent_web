#!/usr/bin/env python3
"""Generate CAD/simulation report and modification suggestions for a workspace."""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

from cad_sim_report.analysis_io import load_llm_analysis
from cad_sim_report.common import write_json
from cad_sim_report.docx_render import render_template_docx, template_dir
from cad_sim_report.preprocess.preprocess_core import preprocess_core
from cad_sim_report.progress import update_report_progress
from cad_sim_report.summary import build_output_paths, build_summary, stringify_outputs
from cad_sim_report.table_context import build_docx_context, build_modification_context
from cad_sim_report.preprocess.workspace_collect import collect_workspace


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workspace_arg", nargs="?", type=Path, help="Workspace root.")
    parser.add_argument("--workspace", type=Path, help="Workspace root. Overrides positional workspace.")
    parser.add_argument("--out-dir", type=Path, default=None, help="Output directory. Defaults to <workspace>/reports.")
    parser.add_argument("--summary-json", type=Path, default=None, help="Summary JSON output path. Defaults to <out-dir>/summary.json.")
    parser.add_argument("--preprocess-only", action="store_true", help="Only write cad_core.json and sim_core.json for the external skill/subagent analysis step.")
    parser.add_argument("--llm-analysis-json", type=Path, default=None, help="Prebuilt llm_analysis.json from the skill/subagent analysis step. Defaults to <out-dir>/llm_analysis.json.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.workspace is None and args.workspace_arg is None:
        raise SystemExit("workspace is required: pass --workspace /path or a positional workspace")
    workspace = (args.workspace or args.workspace_arg).resolve()
    if not workspace.exists():
        raise SystemExit(f"workspace does not exist: {workspace}")
    out_dir = args.out_dir.resolve() if args.out_dir else workspace / "reports"
    out_dir.mkdir(parents=True, exist_ok=True)
    summary_path = args.summary_json.resolve() if args.summary_json else out_dir / "summary.json"
    outputs = build_output_paths(out_dir, summary_path)

    data = collect_workspace(workspace)
    summary = build_summary(data, outputs)
    core_outputs = preprocess_core(workspace, data, out_dir)
    outputs.update(core_outputs)
    summary["outputs"] = stringify_outputs(outputs)
    if args.preprocess_only:
        summary["llm"] = {
            "enabled": False,
            "mode": "preprocess_only",
            "input_jsons": [str(outputs["cad_core"]), str(outputs["sim_core"])],
        }
        write_json(outputs["summary_json"], summary)
        update_report_progress(workspace, 20.0, "报告数据预处理完成，等待 LLM 章节分析")
        print(json.dumps({
            "ok": True,
            "preprocess_only": True,
            "workspace": str(workspace),
            "outputs": stringify_outputs(outputs),
            "summary": summary,
        }, ensure_ascii=False, indent=2))
        return 0
    source_analysis = (args.llm_analysis_json.resolve() if args.llm_analysis_json else outputs["llm_analysis"])
    if not source_analysis.exists():
        raise SystemExit(
            "llm_analysis.json is required. Generate it in the skill/subagent analysis step. "
            f"Expected: {source_analysis}"
        )
    if source_analysis.resolve() != outputs["llm_analysis"].resolve():
        shutil.copyfile(source_analysis, outputs["llm_analysis"])
    summary["llm"] = {
        "enabled": True,
        "mode": "external_json",
        "analysis_json": str(outputs["llm_analysis"]),
        "source_analysis_json": str(source_analysis),
        "input_jsons": [str(outputs["cad_core"]), str(outputs["sim_core"])],
    }
    llm_analysis = load_llm_analysis(outputs["llm_analysis"])
    report_sections = llm_analysis.get("report_sections", {})
    summary["section_paragraph_counts"] = {
        key: len(value) if isinstance(value, list) else 0
        for key, value in report_sections.items()
    } if isinstance(report_sections, dict) else {}
    render_template_docx(template_dir() / "report_template.docx", build_docx_context(data, llm_analysis), outputs["report"])
    render_template_docx(template_dir() / "modifications_template.docx", build_modification_context(llm_analysis), outputs["modifications"])
    write_json(outputs["summary_json"], summary)
    update_report_progress(workspace, 100.0, "报告生成完成", "completed")

    print(json.dumps({
        "ok": True,
        "workspace": str(workspace),
        "outputs": stringify_outputs(outputs),
        "summary": summary,
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
