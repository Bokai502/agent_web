from __future__ import annotations

import pytest

from freecad_cli_tools.freecad_sync import normalize_sync_updates


def test_normalize_sync_updates_accepts_wrapped_payload_and_defaults_names() -> None:
    updates = normalize_sync_updates(
        {
            "updates": [
                {
                    "component": "P005",
                    "position": [1, 2, 3],
                    "orientation_rows": [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
                }
            ]
        }
    )

    assert updates == [
        {
            "component": "P005",
            "solid_name": "P005",
            "part_name": "P005_part",
            "position": [1.0, 2.0, 3.0],
            "orientation_rows": [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        }
    ]


def test_normalize_sync_updates_accepts_optional_solid_placement() -> None:
    updates = normalize_sync_updates(
        [
            {
                "component": "P011",
                "position": [1, 2, 3],
                "orientation_rows": [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
                "solid_position": [4, 5, 6],
                "solid_orientation_rows": [[0, 0, 1], [0, 1, 0], [-1, 0, 0]],
            }
        ]
    )

    assert updates == [
        {
            "component": "P011",
            "solid_name": "P011",
            "part_name": "P011_part",
            "position": [1.0, 2.0, 3.0],
            "orientation_rows": [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
            "solid_position": [4.0, 5.0, 6.0],
            "solid_orientation_rows": [[0, 0, 1], [0, 1, 0], [-1, 0, 0]],
        }
    ]


def test_normalize_sync_updates_accepts_optional_source_placement() -> None:
    updates = normalize_sync_updates(
        [
            {
                "component": "P022",
                "position": [10, 20, 30],
                "orientation_rows": [[0, 0, 1], [0, 1, 0], [-1, 0, 0]],
                "source_position": [1, 2, 3],
                "source_orientation_rows": [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
            }
        ]
    )

    assert updates == [
        {
            "component": "P022",
            "solid_name": "P022",
            "part_name": "P022_part",
            "position": [10.0, 20.0, 30.0],
            "orientation_rows": [[0, 0, 1], [0, 1, 0], [-1, 0, 0]],
            "source_position": [1.0, 2.0, 3.0],
            "source_orientation_rows": [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        }
    ]


def test_normalize_sync_updates_rejects_missing_component() -> None:
    with pytest.raises(ValueError, match="missing 'component'"):
        normalize_sync_updates(
            [
                {
                    "position": [1, 2, 3],
                    "orientation_rows": [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
                }
            ]
        )
