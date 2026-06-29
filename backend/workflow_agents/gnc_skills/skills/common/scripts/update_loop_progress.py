#!/usr/bin/env python3
import argparse
import json
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path

SCHEMA_VERSION = "loop_progress/1.0"
VALID_STATUS = {"pending", "running", "blocked", "failed", "completed"}
NOTE_MAX_CHARS = 80
NOTE_HELP = (
    "Required frontend-display note. Use one concise user-facing sentence or phrase "
    "that describes the current visible stage state. Do not include private reasoning, "
    "Markdown, paths, logs, percentages, timestamps, or multi-line text."
)
NOTE_FORBIDDEN_SUBSTRINGS = (
    "```",
    "Traceback",
    "File \"",
    "Exception:",
    "Error:",
    "<workspace>",
    "demo" + "_server",
    "agent-web/",
    "codex_web/",
    "/" + "data/",
    "/" + "home/",
    "/" + "tmp/",
)
NOTE_PATH_PATTERN = re.compile(r"(^|\s)(?:/[\w.-]|[A-Za-z]:\\|\S+/\S+)")
NOTE_MARKDOWN_PATTERN = re.compile(r"(^|\s)(?:#{1,6}\s|[-*]\s|\d+\.\s|>\s)|[`|{}\[\]]")
KNOWN_STAGES = (
    "01_inputs",
    "02_scenario",
    "03_capability",
    "04_config",
    "05_fsw_requirements",
    "06_fsw_architecture",
    "07_fsw_implementation",
    "08_run",
    "09_tuning_review",
    "10_reports",
)


def utc_now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_args():
    parser = argparse.ArgumentParser(
        description="Update an AIGNC loop_progress.json file.",
        epilog=(
            f"Note contract: note is shown directly by the frontend. Keep it 1 line, <= {NOTE_MAX_CHARS} "
            "characters, user-facing, action/result oriented, and free of Markdown, paths, logs, "
            "private reasoning, percentages, timestamps, and raw error text."
        ),
    )
    parser.add_argument("--progress", required=True, help="Path to loop_progress.json")
    parser.add_argument("--loop-name", required=True, help="Stable loop name. Use the stage id, such as 08_run.")
    parser.add_argument("--status", required=True, choices=sorted(VALID_STATUS))
    parser.add_argument("--percentage", type=float, required=True)
    parser.add_argument("--completed", action="store_true")
    parser.add_argument("--input-json", default="", help="Optional JSON object merged into the input field")
    parser.add_argument("--note", default="", help=NOTE_HELP)
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


def normalize_note(raw):
    note = " ".join(str(raw or "").split())
    if not note:
        raise SystemExit("--note is required because loop_progress.note is used for frontend display")
    if len(note) > NOTE_MAX_CHARS:
        raise SystemExit(f"--note must be {NOTE_MAX_CHARS} characters or fewer for frontend display")
    for marker in NOTE_FORBIDDEN_SUBSTRINGS:
        if marker in note:
            raise SystemExit(f"--note must not include paths, logs, or raw diagnostic markers: {marker}")
    if NOTE_MARKDOWN_PATTERN.search(note):
        raise SystemExit("--note must be plain display text, not Markdown, JSON, tables, or code")
    if NOTE_PATH_PATTERN.search(note):
        raise SystemExit("--note must not include file paths; put paths in workflow_log.md or artifacts")
    return note


def validate_progress_path(path):
    if path.name.isdigit():
        raise SystemExit(
            "--progress must point to a loop_progress.json file, not a bare number. "
            "Did you accidentally pass the percentage as the progress path?"
        )
    if path.name != "loop_progress.json":
        raise SystemExit(f"--progress must end with loop_progress.json, got: {path}")


def canonical_loop_name(args):
    if args.stage:
        return args.stage
    for stage in KNOWN_STAGES:
        if args.loop_name == stage or args.loop_name.startswith(f"{stage}_"):
            return stage
    return args.loop_name


def get_stage(record):
    if not isinstance(record, dict):
        return ""
    if isinstance(record.get("stage"), str):
        return record["stage"]
    input_field = record.get("input")
    if isinstance(input_field, dict) and isinstance(input_field.get("stage"), str):
        return input_field["stage"]
    return ""


def remove_same_stage_aliases(loops, stage, canonical_name):
    if not stage:
        return []
    removed = []
    for loop_name, record in list(loops.items()):
        if loop_name == canonical_name:
            continue
        if get_stage(record) == stage:
            removed.append(loop_name)
            del loops[loop_name]
    return removed


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
    note = normalize_note(args.note)
    now = utc_now()
    path = Path(args.progress).resolve()
    validate_progress_path(path)
    data = load_progress(path)
    loops = data.setdefault("loops", {})
    loop_name = canonical_loop_name(args)
    previous = loops.get(loop_name, {})
    if loop_name != args.loop_name:
        previous = previous or loops.pop(args.loop_name, {})
    removed_aliases = remove_same_stage_aliases(loops, args.stage, loop_name)
    created_at = previous.get("created_at") or now

    input_field = dict(previous.get("input", {})) if isinstance(previous.get("input"), dict) else {}
    input_field.update(parse_input_json(args.input_json))
    input_field.update({
        "completed": completed,
        "loop_name": loop_name,
        "percentage": percentage,
        "status": args.status,
    })
    if args.stage:
        input_field["stage"] = args.stage
    if args.skill:
        input_field["skill"] = args.skill
    if note:
        input_field["note"] = note
    if removed_aliases:
        input_field["removed_loop_aliases"] = removed_aliases

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
    if note:
        record["note"] = note
    if loop_name != args.loop_name:
        record["normalized_from_loop_name"] = args.loop_name
    if removed_aliases:
        record["removed_loop_aliases"] = removed_aliases

    loops[loop_name] = record
    data["updated_at"] = now
    atomic_write_json(path, data)
    print(path)


if __name__ == "__main__":
    main()
