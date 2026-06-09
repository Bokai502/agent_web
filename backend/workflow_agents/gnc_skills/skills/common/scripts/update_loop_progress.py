#!/usr/bin/env python3
import argparse
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

SCHEMA_VERSION = "loop_progress/1.0"
VALID_STATUS = {"pending", "running", "blocked", "failed", "completed"}


def utc_now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_args():
    parser = argparse.ArgumentParser(description="Update an AIGNC loop_progress.json file.")
    parser.add_argument("--progress", required=True, help="Path to loop_progress.json")
    parser.add_argument("--loop-name", required=True, help="Stable loop name, usually <stage_id>_<skill_name>")
    parser.add_argument("--status", required=True, choices=sorted(VALID_STATUS))
    parser.add_argument("--percentage", type=float, required=True)
    parser.add_argument("--completed", action="store_true")
    parser.add_argument("--input-json", default="", help="Optional JSON object merged into the input field")
    parser.add_argument("--note", default="", help="Optional short externally useful note")
    parser.add_argument("--stage", default="", help="Optional workflow stage id, such as 08_run")
    parser.add_argument("--skill", default="", help="Optional skill name")
    return parser.parse_args()


def clamp_percentage(value):
    if value < 0.0 or value > 100.0:
        raise SystemExit("--percentage must be between 0 and 100")
    return float(value)


def load_progress(path):
    if not path.exists():
        return {"schema_version": SCHEMA_VERSION, "updated_at": None, "loops": {}}
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("schema_version") != SCHEMA_VERSION:
        raise SystemExit(f"Unsupported schema_version in {path}: {data.get('schema_version')}")
    data.setdefault("loops", {})
    return data


def parse_input_json(raw):
    if not raw:
        return {}
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise SystemExit("--input-json must decode to a JSON object")
    return value


def validate_progress_path(path):
    if path.name.isdigit():
        raise SystemExit(
            "--progress must point to a loop_progress.json file, not a bare number. "
            "Did you accidentally pass the percentage as the progress path?"
        )
    if path.name != "loop_progress.json":
        raise SystemExit(f"--progress must end with loop_progress.json, got: {path}")


def atomic_write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as tmp:
            tmp.write(text)
            tmp.flush()
            os.fsync(tmp.fileno())
        os.replace(tmp_name, path)
    finally:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)


def main():
    args = parse_args()
    percentage = clamp_percentage(args.percentage)
    completed = bool(args.completed or args.status == "completed")
    now = utc_now()
    path = Path(args.progress).resolve()
    validate_progress_path(path)
    data = load_progress(path)
    loops = data.setdefault("loops", {})
    previous = loops.get(args.loop_name, {})
    created_at = previous.get("created_at") or now

    input_field = dict(previous.get("input", {})) if isinstance(previous.get("input"), dict) else {}
    input_field.update(parse_input_json(args.input_json))
    input_field.update({
        "completed": completed,
        "loop_name": args.loop_name,
        "percentage": percentage,
        "status": args.status,
    })
    if args.stage:
        input_field["stage"] = args.stage
    if args.skill:
        input_field["skill"] = args.skill
    if args.note:
        input_field["note"] = args.note

    record = dict(previous)
    record.update({
        "completed": completed,
        "created_at": created_at,
        "finished_at": now if completed else None,
        "input": input_field,
        "percentage": percentage,
        "status": args.status,
        "updated_at": now,
    })
    if args.stage:
        record["stage"] = args.stage
    if args.skill:
        record["skill"] = args.skill
    if args.note:
        record["note"] = args.note

    loops[args.loop_name] = record
    data["updated_at"] = now
    atomic_write_json(path, data)
    print(path)


if __name__ == "__main__":
    main()
