#!/usr/bin/env python3
"""Build placeholder box geometry_after.glb from cad_build_spec.json."""

from __future__ import annotations

import argparse
import json

from .box import CadBoxBuilder, CadBoxBuildRequest


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build box GLB from cad_build_spec.json.")
    parser.add_argument("--workspace-dir", required=True)
    parser.add_argument("--spec")
    parser.add_argument("--output-dir")
    parser.add_argument("--doc-name")
    parser.add_argument("--host")
    parser.add_argument("--port", type=int)
    return parser.parse_args()


def render_script(*args, **kwargs) -> str:
    return CadBoxBuilder().render_script(*args, **kwargs)


def main() -> int:
    args = parse_args()
    result = CadBoxBuilder().build(
        CadBoxBuildRequest(
            workspace_dir=args.workspace_dir,
            spec_path=args.spec,
            output_dir=args.output_dir,
            doc_name=args.doc_name,
            host=args.host,
            port=args.port,
        )
    )
    print(json.dumps(result.to_dict(), ensure_ascii=False, indent=2))
    return 0 if result.success else 1


if __name__ == "__main__":
    raise SystemExit(main())
