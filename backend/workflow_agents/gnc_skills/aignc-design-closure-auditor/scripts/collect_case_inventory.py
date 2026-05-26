import argparse
import json
from pathlib import Path


EXPECTED = {
    "02_scenario": [
        "scenario_facts.json",
        "open_questions.json",
        "scenario_understanding.md",
    ],
    "03_capability": [
        "42_capability_assessment.md",
        "capability_assessment.json",
    ],
    "04_config": [
        "generated_config_manifest.json",
        "Inp_Sim.txt",
    ],
    "04_config/validation": [
        "config_validation_report.md",
        "config_validation_summary.json",
        "requirements_trace.md",
        "requirements_trace.json",
    ],
    "05_fsw_requirements": [
        "fsw_requirement_spec.md",
        "mode_table.json",
        "sensor_actuator_contract.json",
    ],
    "06_fsw_architecture": [
        "fsw_architecture_plan.md",
        "file_change_map.json",
        "truth_model_extension_boundary.json",
        "fsw_code_author_report.md",
    ],
    "07_fsw_implementation": [
        "fsw_code_author_report.md",
        "fsw_change_set.json",
    ],
    "08_run": [
        "run_report.md",
        "run_summary.json",
    ],
}


def stage_inventory(case_root: Path):
    data = {"case_root": str(case_root), "stages": {}, "runtime_inout": {}}
    for stage, names in EXPECTED.items():
        stage_dir = case_root / stage
        present = {}
        for name in names:
            path = stage_dir / name
            present[name] = {
                "exists": path.exists(),
                "path": str(path),
            }
        data["stages"][stage] = {
            "exists": stage_dir.exists(),
            "path": str(stage_dir),
            "expected_files": present,
        }

    inout = case_root / "08_run" / "runtime_case" / "InOut"
    data["runtime_inout"] = {
        "exists": inout.exists(),
        "path": str(inout),
        "files": sorted([p.name for p in inout.iterdir()]) if inout.exists() else [],
    }
    return data


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--case-root", required=True)
    parser.add_argument("--out", default="")
    args = parser.parse_args()

    case_root = Path(args.case_root).resolve()
    data = stage_inventory(case_root)

    text = json.dumps(data, indent=2, ensure_ascii=False)
    if args.out:
        out_path = Path(args.out).resolve()
        out_path.write_text(text, encoding="utf-8")
        print(out_path)
    else:
        print(text)


if __name__ == "__main__":
    main()
