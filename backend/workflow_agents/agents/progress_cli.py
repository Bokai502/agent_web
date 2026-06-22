#!/usr/bin/env python3
from __future__ import annotations

import argparse
import contextlib
import fcntl
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SCHEMA_VERSION = "loop_progress/1.0"
VALID_STATUS = {"pending", "running", "blocked", "failed", "completed"}
FLOW_RELATIVE_PATH = Path("00_inputs") / "workflow_diagram" / "executionFlowData.json"
PROGRESS_RELATIVE_PATH = Path("logs") / "progress.json"


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Update workspace progress from executionFlowData run nodes.")
    parser.add_argument("--workspace-dir", required=True)
    parser.add_argument("--node-id", help="Run node id to update. Omit with --init to initialize all run nodes.")
    parser.add_argument("--role", help="Run node progressRole to update. Prefer this over --node-id for workflow-owned nodes.")
    parser.add_argument("--status", choices=sorted(VALID_STATUS), default="pending")
    parser.add_argument("--percentage", type=float, default=0.0)
    parser.add_argument("--completed", action="store_true")
    parser.add_argument("--note", default="")
    parser.add_argument("--init", action="store_true", help="Create pending progress entries for all run nodes.")
    return parser.parse_args()


def read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise SystemExit(f"{path} must contain a JSON object")
    return value


def write_json_atomic(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, path)
    finally:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)


@contextlib.contextmanager
def workspace_progress_lock(workspace: Path):
    lock_path = workspace / "logs" / ".progress.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("w", encoding="utf-8") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def clamp_percentage(value: float) -> float:
    return round(max(0.0, min(100.0, float(value))), 2)


def run_nodes(flow: dict[str, Any]) -> list[dict[str, Any]]:
    nodes = flow.get("nodes")
    if not isinstance(nodes, list):
        raise SystemExit("executionFlowData.json must contain a nodes list")
    result = []
    for node in nodes:
        if isinstance(node, dict) and node.get("kind") == "run" and isinstance(node.get("id"), str):
            result.append(node)
    return result


def load_progress(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"schema_version": SCHEMA_VERSION, "loops": {}}
    data = read_json(path)
    if data.get("schema_version") not in (None, SCHEMA_VERSION):
        raise SystemExit(f"Unsupported schema_version in {path}: {data.get('schema_version')}")
    data["schema_version"] = SCHEMA_VERSION
    if not isinstance(data.get("loops"), dict):
        data["loops"] = {}
    return data


def update_loop(
    loops: dict[str, Any],
    *,
    completed: bool,
    node: dict[str, Any],
    note: str,
    now: str,
    percentage: float,
    status: str,
) -> None:
    node_id = str(node["id"])
    loop = loops.get(node_id)
    if not isinstance(loop, dict):
        loop = {}
    loop.setdefault("created_at", now)
    loop.setdefault("started_at", now if status == "running" else None)
    if status == "running" and not loop.get("started_at"):
        loop["started_at"] = now
    if completed and not loop.get("started_at"):
        loop["started_at"] = loop.get("created_at", now)
    loop.update({
        "completed": completed,
        "finished_at": now if completed else None,
        "node_id": node_id,
        "percentage": 100.0 if completed else clamp_percentage(percentage),
        "status": status,
        "title": str(node.get("title") or node_id),
        "updated_at": now,
        "input": {
            "completed": completed,
            "loop_name": node_id,
            "node_id": node_id,
            "percentage": 100.0 if completed else clamp_percentage(percentage),
            "status": status,
        },
    })
    progress_role = node.get("progressRole")
    if isinstance(progress_role, str) and progress_role:
        loop["progress_role"] = progress_role
        loop["input"]["progress_role"] = progress_role
    if note:
        loop["note"] = " ".join(note.split())
        loop["input"]["note"] = loop["note"]
    loops[node_id] = loop


def resolve_node(
    *,
    node_by_id: dict[str, dict[str, Any]],
    nodes: list[dict[str, Any]],
    node_id: str | None,
    role: str | None,
) -> dict[str, Any] | None:
    if node_id and role:
        raise SystemExit("use only one of --node-id or --role")
    if node_id:
        if node_id not in node_by_id:
            raise SystemExit(f"node is not a run node in executionFlowData.json: {node_id}")
        return node_by_id[node_id]
    if role:
        matches = [
            node for node in nodes
            if isinstance(node.get("progressRole"), str) and node["progressRole"] == role
        ]
        if not matches:
            raise SystemExit(f"no run node with progressRole in executionFlowData.json: {role}")
        if len(matches) > 1:
            ids = ", ".join(str(node.get("id")) for node in matches)
            raise SystemExit(f"multiple run nodes share progressRole {role}: {ids}")
        return matches[0]
    return None


def update_flow_node_progress(flow: dict[str, Any], node_id: str | None, percentage: float | None) -> bool:
    nodes = flow.get("nodes")
    if not isinstance(nodes, list):
        raise SystemExit("executionFlowData.json must contain a nodes list")

    changed = False
    for node in nodes:
        if not isinstance(node, dict):
            continue
        current = node.get("progress")
        if not isinstance(current, (int, float)):
            node["progress"] = 0
            changed = True
        if node_id and node.get("id") == node_id:
            next_progress = clamp_percentage(percentage or 0.0)
            if node.get("progress") != next_progress:
                node["progress"] = next_progress
                changed = True
    return changed


def main() -> int:
    args = parse_args()
    workspace = Path(args.workspace_dir).expanduser().resolve()
    flow_path = workspace / FLOW_RELATIVE_PATH
    progress_path = workspace / PROGRESS_RELATIVE_PATH

    with workspace_progress_lock(workspace):
        if not flow_path.exists():
            raise SystemExit(f"executionFlowData.json not found: {flow_path}")

        flow = read_json(flow_path)
        nodes = run_nodes(flow)
        node_by_id = {str(node["id"]): node for node in nodes}
        target_node = resolve_node(
            node_by_id=node_by_id,
            nodes=nodes,
            node_id=args.node_id,
            role=args.role,
        )
        if not args.init and target_node is None:
            raise SystemExit("--node-id or --role is required unless --init is set")

        progress = load_progress(progress_path)
        loops = progress.setdefault("loops", {})
        for loop_id in list(loops.keys()):
            if loop_id not in node_by_id:
                del loops[loop_id]
        now = utc_now()

        flow_changed = update_flow_node_progress(flow, None, None)

        if args.init:
            for node in nodes:
                if str(node["id"]) not in loops:
                    update_loop(
                        loops,
                        completed=False,
                        node=node,
                        note="",
                        now=now,
                        percentage=0.0,
                        status="pending",
                    )

        if target_node is not None:
            completed = bool(args.completed or args.status == "completed")
            node_progress = 100.0 if completed else args.percentage
            target_node_id = str(target_node["id"])
            update_loop(
                loops,
                completed=completed,
                node=target_node,
                note=args.note,
                now=now,
                percentage=node_progress,
                status=args.status,
            )
            flow_changed = update_flow_node_progress(flow, target_node_id, node_progress) or flow_changed

        progress["loops"] = {str(node["id"]): loops[str(node["id"])] for node in nodes if str(node["id"]) in loops}
        progress["updated_at"] = now
        if flow_changed:
            write_json_atomic(flow_path, flow)
        write_json_atomic(progress_path, progress)
        node_ids = [str(node["id"]) for node in nodes]

    print(json.dumps({
        "ok": True,
        "flow": str(flow_path),
        "output": str(progress_path),
        "node_ids": node_ids,
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
