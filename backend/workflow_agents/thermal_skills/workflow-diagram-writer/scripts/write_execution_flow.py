#!/usr/bin/env python3
"""Normalize and write executionFlowData.json for the frontend ExecutionFlow component."""

from __future__ import annotations

import argparse
import json
import sys
from copy import deepcopy
from pathlib import Path
from typing import Any


SKILL_DIR = Path(__file__).resolve().parents[1]
DEFAULT_TEMPLATE = SKILL_DIR / "assets" / "thermal_execution_flow_template.json"

VALID_TONES = {"teal", "blue", "slate", "amber", "indigo"}
VALID_TYPES = {"files", "single", "tasks", "checks"}
DEFAULT_TONES = ["teal", "blue", "slate", "amber", "indigo"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Normalize and write execution flow JSON.")
    parser.add_argument("--workspace-dir", required=True)
    parser.add_argument("--draft-json", help="Workflow-diagram-writer generated draft flow JSON.")
    parser.add_argument("--stdin", action="store_true", help="Read draft flow JSON from stdin.")
    parser.add_argument("--template", default=str(DEFAULT_TEMPLATE))
    parser.add_argument("--output")
    parser.add_argument("--default-active-id")
    return parser.parse_args()


def read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return value


def read_stdin_json() -> dict[str, Any]:
    raw = sys.stdin.read()
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError("stdin must contain a JSON object")
    return value


def slugify(value: Any, fallback: str) -> str:
    text = str(value or "").strip().lower()
    chars = [ch if ch.isalnum() else "_" for ch in text]
    slug = "_".join("".join(chars).split("_")).strip("_")
    return slug or fallback


def normalize_items(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value if item is not None and str(item).strip()]
    if value is None:
        return []
    text = str(value).strip()
    return [text] if text else []


def normalize_node(raw: Any, index: int) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raw = {"title": str(raw)}

    node_id = slugify(raw.get("id") or raw.get("title"), f"step_{index + 1}")
    tone = raw.get("tone")
    node_type = raw.get("type")

    return {
        "id": node_id,
        "title": str(raw.get("title") or node_id),
        "tone": tone if tone in VALID_TONES else DEFAULT_TONES[min(index, len(DEFAULT_TONES) - 1)],
        "type": node_type if node_type in VALID_TYPES else ("files" if index == 0 else "tasks"),
        "output": str(raw.get("output") or ("INPUT" if index == 0 else "AI")),
        "summary": str(raw.get("summary") or ""),
        "items": normalize_items(raw.get("items")),
    }


def normalize_connections(raw_connections: Any, node_ids: list[str]) -> list[dict[str, str]]:
    node_id_set = set(node_ids)
    normalized: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()

    if isinstance(raw_connections, list):
        for connection in raw_connections:
            if not isinstance(connection, dict):
                continue
            source = connection.get("from")
            target = connection.get("to")
            if source not in node_id_set or target not in node_id_set or source == target:
                continue
            key = (str(source), str(target))
            if key in seen:
                continue
            seen.add(key)
            normalized.append({"from": key[0], "to": key[1]})

    if normalized:
        return normalized
    return [{"from": node_ids[index], "to": node_ids[index + 1]} for index in range(len(node_ids) - 1)]


def normalize_flow(data: dict[str, Any], *, default_active_id: str | None = None) -> dict[str, Any]:
    raw_nodes = data.get("nodes")
    if not isinstance(raw_nodes, list) or not raw_nodes:
        raise ValueError("flow data must contain a non-empty nodes list")

    nodes: list[dict[str, Any]] = []
    used_ids: set[str] = set()
    for index, raw_node in enumerate(raw_nodes):
        node = normalize_node(raw_node, index)
        base_id = node["id"]
        suffix = 2
        while node["id"] in used_ids:
            node["id"] = f"{base_id}_{suffix}"
            suffix += 1
        used_ids.add(node["id"])
        nodes.append(node)

    node_ids = [node["id"] for node in nodes]
    active = default_active_id or data.get("defaultActiveId") or node_ids[0]
    if active not in used_ids:
        active = node_ids[0]

    return {
        "defaultActiveId": active,
        "nodes": nodes,
        "connections": normalize_connections(data.get("connections"), node_ids),
    }


def validate_flow(data: dict[str, Any]) -> None:
    nodes = data.get("nodes")
    connections = data.get("connections")
    if not isinstance(nodes, list) or not isinstance(connections, list):
        raise ValueError("flow data must contain list fields: nodes, connections")

    node_ids: set[str] = set()
    for node in nodes:
        if not isinstance(node, dict):
            raise ValueError("each node must be an object")
        node_id = node.get("id")
        if not isinstance(node_id, str) or not node_id:
            raise ValueError("each node must have a non-empty string id")
        node_ids.add(node_id)
        if node.get("tone") not in VALID_TONES:
            raise ValueError(f"node {node_id} has invalid tone: {node.get('tone')}")
        if node.get("type") not in VALID_TYPES:
            raise ValueError(f"node {node_id} has invalid type: {node.get('type')}")
        if not isinstance(node.get("items"), list):
            raise ValueError(f"node {node_id} must contain items list")

    active = data.get("defaultActiveId")
    if active is not None and active not in node_ids:
        raise ValueError(f"defaultActiveId does not match a node id: {active}")

    for connection in connections:
        if not isinstance(connection, dict):
            raise ValueError("each connection must be an object")
        source = connection.get("from")
        target = connection.get("to")
        if source not in node_ids or target not in node_ids:
            raise ValueError(f"invalid connection: {source!r} -> {target!r}")


def main() -> int:
    args = parse_args()
    if args.stdin and args.draft_json:
        raise ValueError("use only one of --stdin or --draft-json")

    workspace_dir = Path(args.workspace_dir).expanduser().resolve()
    template_path = Path(args.template).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve() if args.output else (
        workspace_dir / "00_inputs" / "workflow_diagram" / "executionFlowData.json"
    )

    if args.stdin:
        raw_data = read_stdin_json()
        source = "stdin"
    elif args.draft_json:
        draft_path = Path(args.draft_json).expanduser().resolve()
        raw_data = read_json(draft_path)
        source = str(draft_path)
    else:
        raw_data = deepcopy(read_json(template_path))
        source = str(template_path)

    data = normalize_flow(raw_data, default_active_id=args.default_active_id)
    validate_flow(data)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(json.dumps({
        "ok": True,
        "output": str(output_path),
        "source": source,
        "node_ids": [node["id"] for node in data["nodes"]],
        "defaultActiveId": data.get("defaultActiveId"),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
