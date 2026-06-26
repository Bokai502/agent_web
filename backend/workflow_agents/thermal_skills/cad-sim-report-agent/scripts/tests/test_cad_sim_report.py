from __future__ import annotations

import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from cad_sim_report.analysis_io import load_llm_analysis, write_llm_analysis
from cad_sim_report.block_specs import render_spec_blocks
from cad_sim_report.captioning import apply_captions, has_caption
from cad_sim_report.preprocess.workspace_summary import summarize_components, summarize_field_samples, summarize_status
from cad_sim_report.preprocess.xlsx_tables import build_thermal_control_table


class CaptioningTests(unittest.TestCase):
    def test_table_and_gallery_captions_are_numbered_by_chapter(self) -> None:
        context = {
            "model_section": [
                {"type": "table", "caption": "CATCH整星配套表"},
                {
                    "type": "image_gallery",
                    "caption": "FreeCAD 几何视图",
                    "images": [{"exists": True}, {"exists": True}],
                },
            ],
            "thermal_results_section": [
                {"type": "table", "caption": "星上各仪器设备的热控指标"},
            ],
        }

        result = apply_captions(context)

        self.assertEqual(result["model_section"][0]["caption"], "表 1-1 CATCH整星配套表")
        self.assertEqual(
            result["model_section"][1]["captions"],
            ["图 1-1 FreeCAD 几何视图", "图 1-2 FreeCAD 几何视图"],
        )
        self.assertEqual(result["thermal_results_section"][0]["caption"], "表 2-1 星上各仪器设备的热控指标")
        self.assertTrue(has_caption(result["model_section"], "CATCH整星配套表"))


class BlockSpecTests(unittest.TestCase):
    def test_field_placeholders_and_formats_are_resolved(self) -> None:
        blocks = render_spec_blocks(
            [
                {"type": "paragraph", "text": "组件数量 {{components.simulation_components|num}}"},
                {
                    "type": "table",
                    "caption": "统计",
                    "headers": ["项目", "值"],
                    "rows": [["ok", "{{status_summary.ok|bool}}"]],
                },
            ],
            {"components": {"simulation_components": 26}, "status_summary": {"ok": True}},
        )

        self.assertEqual(blocks[0]["text"], "组件数量 26.000")
        self.assertEqual(blocks[1]["rows"], [["ok", "yes"]])


class AnalysisIoTests(unittest.TestCase):
    def test_analysis_io_requires_all_report_sections(self) -> None:
        path = Path("/tmp/cad_sim_report_test_llm_analysis.json")
        analysis = {
            "report_sections": {
                "model_section": ["模型段落"],
                "thermal_results_section": ["结果段落"],
                "temperature_images_section": ["云图段落"],
                "validity_section": ["有效性段落"],
                "solver_section": ["求解段落"],
                "recommendations_section": ["建议段落"],
                "conclusion_section": ["结论段落"],
            }
        }

        write_llm_analysis(path, analysis)
        loaded = load_llm_analysis(path)

        self.assertEqual(loaded["schema_version"], "cad_sim_report_llm_analysis/1.0")
        self.assertEqual(loaded["report_sections"]["model_section"], ["模型段落"])


class TableAndSummaryTests(unittest.TestCase):
    def test_thermal_control_table_maps_catch_headers(self) -> None:
        source = {
            "exists": True,
            "headers": ["产品名称", "工作温度（℃）", "稳态功耗（W）"],
            "rows": [["设备A", "-10~45", "12"], ["设备B", "", ""]],
        }

        table = build_thermal_control_table(source)

        self.assertEqual(table["headers"], ["序号", "仪器设备名称", "热控指标"])
        self.assertEqual(table["rows"], [["1", "设备A", "-10~45"], ["2", "设备B", ""]])

    def test_workspace_summaries_tolerate_missing_or_partial_data(self) -> None:
        components = summarize_components(
            {
                "components": [
                    {"component_id": "a", "kind": "payload", "category": "box", "material_id": "al", "power_W": 3},
                    {"component_id": "b", "kind": "payload", "category": "box", "material_id": "al", "power_W": 0},
                ],
                "radiators": [{}],
                "install_faces": [{}, {}],
            },
            {"entities": [{"component_id": "thin", "dims": [1, 1, 0.1]}]},
        )
        status = summarize_status({"checks": {"selections": {"validation": {"ok": True, "details": {"entity_counts": {"a": 1}}}}}})
        samples = summarize_field_samples({"samples": [{"component_id": "a", "temperature_K": 300}, {"component_id": "a", "temperature_K": 302}]})

        self.assertEqual(components["simulation_components"], 2)
        self.assertEqual(components["heat_source_count"], 1)
        self.assertEqual(components["install_face_count"], 2)
        self.assertEqual(components["suspicious"][0]["component_id"], "thin")
        self.assertTrue(status["selection_ok"])
        self.assertEqual(samples["component_rows"][0]["mean_K"], 301)


if __name__ == "__main__":
    unittest.main()
