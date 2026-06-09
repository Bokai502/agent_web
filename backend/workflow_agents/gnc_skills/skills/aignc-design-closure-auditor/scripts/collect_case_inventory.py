import argparse
import json
from pathlib import Path


EXPECTED = {
    "AIGNC_Workflow/01_inputs": [
        "input_inventory.md",
    ],
    "AIGNC_Workflow/02_scenario": [
        "scenario_facts.json",
        "open_questions.json",
        "scenario_understanding.md",
    ],
    "AIGNC_Workflow/03_capability": [
        "42_capability_assessment.md",
        "capability_assessment.json",
    ],
    "AIGNC_Workflow/04_config": [
        "generated_config_manifest.json",
        "Inp_Sim.txt",
    ],
    "AIGNC_Workflow/04_config/validation": [
        "config_validation_report.md",
        "config_validation_summary.json",
        "requirements_trace.md",
        "requirements_trace.json",
    ],
    "AIGNC_Workflow/05_fsw_requirements": [
        "fsw_requirement_spec.md",
        "mode_table.json",
        "sensor_actuator_contract.json",
    ],
    "AIGNC_Workflow/06_fsw_architecture": [
        "fsw_architecture_plan.md",
        "file_change_map.json",
        "truth_model_extension_boundary.json",
        "fsw_code_author_report.md",
    ],
    "AIGNC_Workflow/07_fsw_implementation": [
        "fsw_code_author_report.md",
        "fsw_change_set.json",
    ],
    "AIGNC_Workflow/08_run": [
        "run_report.md",
        "run_summary.json",
    ],
    "Config": [
        "Inp_Sim.txt",
    ],
    "Output/Run": [
        "Makefile",
        ("42", "42.exe"),
    ],
}


def stage_inventory(workspace_dir: Path):
    data = {"workspace_dir": str(workspace_dir), "stages": {}, "runtime_inout": {}}
    for stage, names in EXPECTED.items():
        stage_dir = workspace_dir / stage
        present = {}
        for name in names:
            if isinstance(name, tuple):
                label = " or ".join(name)
                matches = [stage_dir / item for item in name if (stage_dir / item).exists()]
                present[label] = {
                    "exists": bool(matches),
                    "path": str(matches[0] if matches else stage_dir / name[0]),
                }
                continue
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

    inout = workspace_dir / "Output" / "Run" / "runtime_case" / "InOut"
    data["runtime_inout"] = {
        "exists": inout.exists(),
        "path": str(inout),
        "files": sorted([p.name for p in inout.iterdir()]) if inout.exists() else [],
    }
    return data


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace-dir", required=True)
    parser.add_argument("--out", default="")
    args = parser.parse_args()

    workspace_dir = Path(args.workspace_dir).resolve()
    data = stage_inventory(workspace_dir)

    text = json.dumps(data, indent=2, ensure_ascii=False)
    if args.out:
        out_path = Path(args.out).resolve()
        out_path.write_text(text, encoding="utf-8")
        print(out_path)
    else:
        print(text)


if __name__ == "__main__":
    main()
