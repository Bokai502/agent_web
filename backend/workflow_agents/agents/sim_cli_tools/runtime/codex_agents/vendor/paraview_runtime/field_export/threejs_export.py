from __future__ import annotations

import math
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

from core.io import write_json


def export_temperature_field_threejs(
    native_vtu: Path,
    output_path: Path,
    *,
    preferred_array: str | None = None,
    max_points: int = 50000,
) -> Path:
    points, temperatures, array_name = _read_ascii_vtu_points_and_temperature(
        native_vtu,
        preferred_array=preferred_array,
    )
    if max_points > 0 and len(points) > max_points:
        stride = max(1, math.ceil(len(points) / max_points))
        points = points[::stride]
        temperatures = temperatures[::stride]
    bounds = _bounds(points)
    temp_min = min(temperatures)
    temp_max = max(temperatures)
    payload = {
        "schema_version": "1.0",
        "format": "threejs_temperature_point_cloud",
        "source": {
            "native_vtu": str(native_vtu),
            "temperature_array": array_name,
        },
        "units": {
            "position": "m",
            "temperature": "K",
        },
        "point_count": len(points),
        "bounds": bounds,
        "temperature_range_K": {
            "min": temp_min,
            "max": temp_max,
        },
        "attributes": {
            "position": [value for point in points for value in point],
            "temperature_K": temperatures,
            "color_rgb": [
                channel
                for temperature in temperatures
                for channel in _temperature_color(temperature, temp_min, temp_max)
            ],
        },
        "threejs_hint": {
            "geometry": "THREE.BufferGeometry",
            "position_attribute": "position",
            "color_attribute": "color_rgb",
            "temperature_attribute": "temperature_K",
            "material": "THREE.PointsMaterial({ vertexColors: true })",
        },
    }
    return write_json(output_path, payload)


def _read_ascii_vtu_points_and_temperature(
    native_vtu: Path,
    *,
    preferred_array: str | None,
) -> tuple[list[tuple[float, float, float]], list[float], str]:
    root = ET.parse(native_vtu).getroot()
    piece = root.find(".//Piece")
    if piece is None:
        raise ValueError(f"{native_vtu} does not contain a VTU Piece")
    points_node = piece.find("./Points/DataArray")
    if points_node is None:
        raise ValueError(f"{native_vtu} does not contain point coordinates")
    point_values = _parse_ascii_float_values(points_node)
    if len(point_values) % 3 != 0:
        raise ValueError(f"{native_vtu} point coordinate count is not divisible by 3")
    points_all = [
        (point_values[index], point_values[index + 1], point_values[index + 2])
        for index in range(0, len(point_values), 3)
    ]
    temperature_node = _select_temperature_data_array(piece, preferred_array)
    temperature_name = temperature_node.get("Name") or preferred_array or "temperature"
    temperatures_all = _parse_ascii_float_values(temperature_node)
    if len(temperatures_all) != len(points_all):
        raise ValueError(
            f"{native_vtu} temperature count ({len(temperatures_all)}) does not match point count ({len(points_all)})"
        )
    points: list[tuple[float, float, float]] = []
    temperatures: list[float] = []
    for point, temperature in zip(points_all, temperatures_all):
        if math.isfinite(temperature) and all(math.isfinite(value) for value in point):
            points.append(point)
            temperatures.append(temperature)
    if not points:
        raise ValueError(f"{native_vtu} contains no finite point temperatures")
    return points, temperatures, temperature_name


def _select_temperature_data_array(piece: ET.Element, preferred_array: str | None) -> ET.Element:
    arrays = list(piece.findall("./PointData/DataArray"))
    if not arrays:
        raise ValueError("native VTU does not contain PointData arrays")
    if preferred_array:
        for array in arrays:
            if array.get("Name") == preferred_array:
                return array
        raise ValueError(f"native VTU does not contain requested temperature array {preferred_array!r}")
    for name in ("Color", "T", "temperature", "Temperature"):
        for array in arrays:
            if array.get("Name") == name:
                return array
    return arrays[0]


def _parse_ascii_float_values(data_array: ET.Element) -> list[float]:
    data_format = (data_array.get("format") or data_array.get("Format") or "ascii").lower()
    if data_format != "ascii":
        raise ValueError("only ascii VTU DataArray values are supported")
    return [float(token) for token in (data_array.text or "").split()]


def _bounds(points: list[tuple[float, float, float]]) -> dict[str, list[float]]:
    return {
        "min": [min(point[axis] for point in points) for axis in range(3)],
        "max": [max(point[axis] for point in points) for axis in range(3)],
    }


def _temperature_color(temperature: float, temp_min: float, temp_max: float) -> list[float]:
    if temp_max <= temp_min:
        value = 0.0
    else:
        value = max(0.0, min(1.0, (temperature - temp_min) / (temp_max - temp_min)))
    if value < 0.5:
        t = value / 0.5
        return [0.0, t, 1.0 - t]
    t = (value - 0.5) / 0.5
    return [t, 1.0 - t, 0.0]

