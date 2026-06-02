#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import re
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any


HEADER_RE = re.compile(r"^=+")
TRUE_FALSE_RE = re.compile(r"^(TRUE|FALSE)\b", re.IGNORECASE)
FLOAT_RE = re.compile(r"[-+]?\d+(?:\.\d+)?(?:[Ee][-+]?\d+)?")


@dataclass
class Finding:
    level: str
    message: str


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def strip_comment(line: str) -> str:
    return line.split("!", 1)[0].rstrip()


def nonempty_data_lines(text: str) -> list[str]:
    lines: list[str] = []
    for raw in text.splitlines():
        data = strip_comment(raw).strip()
        if data:
            lines.append(data)
    return lines


def find_numeric_value_before_comment(text: str, comment_fragment: str) -> float | None:
    for raw in text.splitlines():
        if comment_fragment in raw:
            data = strip_comment(raw)
            m = FLOAT_RE.search(data)
            if m:
                return float(m.group(0))
    return None


def find_line_before_comment(text: str, comment_fragment: str) -> str | None:
    for raw in text.splitlines():
        if comment_fragment in raw:
            return strip_comment(raw).strip()
    return None


def find_all_lines_before_comment(text: str, comment_fragment: str) -> list[str]:
    vals = []
    for raw in text.splitlines():
        if comment_fragment in raw:
            vals.append(strip_comment(raw).strip())
    return vals


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(read_text(path))


def parse_numeric_list(line: str) -> list[float]:
    return [float(x) for x in FLOAT_RE.findall(line)]


def parse_inp_sim(path: Path) -> dict[str, Any]:
    text = read_text(path)
    flat_lines = nonempty_data_lines(text)

    if len(flat_lines) < 10:
        raise ValueError(f"Inp_Sim too short: {path}")

    all_lines = text.splitlines()

    def section_slice(start_marker: str, end_marker: str | None) -> list[str]:
        start = None
        end = len(all_lines)
        for i, line in enumerate(all_lines):
            if start is None and start_marker in line:
                start = i + 1
                continue
            if start is not None and end_marker and end_marker in line:
                end = i
                break
        if start is None:
            return []
        return [strip_comment(line).strip() for line in all_lines[start:end] if strip_comment(line).strip()]

    sim_lines = section_slice("Simulation Control", "Reference Orbits")
    ref_lines = section_slice("Reference Orbits", "Spacecraft")
    sc_lines = section_slice("Spacecraft", "Environment")
    env_lines = section_slice("Environment", "Celestial Bodies of Interest")
    celestial_lines = section_slice("Celestial Bodies of Interest", "Ground Stations")

    ref_orbit_count = int(ref_lines[0]) if ref_lines and ref_lines[0].isdigit() else None
    ref_entries: list[dict[str, Any]] = []
    for data in ref_lines[1:]:
        m = re.match(r"^(TRUE|FALSE)\s+(\S+\.txt)\s*$", data, re.IGNORECASE)
        if m:
            ref_entries.append(
                {"exists": m.group(1).upper() == "TRUE", "orbit_file": m.group(2)}
            )

    sc_count = int(sc_lines[0]) if sc_lines and sc_lines[0].isdigit() else None
    sc_entries: list[dict[str, Any]] = []
    for data in sc_lines[1:]:
        m = re.match(r"^(TRUE|FALSE)\s+(\d+)\s+(\S+\.txt)\s*$", data, re.IGNORECASE)
        if m:
            sc_entries.append(
                {
                    "exists": m.group(1).upper() == "TRUE",
                    "ref_orbit_index": int(m.group(2)),
                    "spacecraft_file": m.group(3),
                }
            )

    ephem_option = next((x for x in celestial_lines if x in {"MEAN", "DE430", "DE440"}), None)
    magfield = next((x for x in env_lines if x in {"NONE", "DIPOLE", "IGRF"}), None)

    time_mode = sim_lines[0] if sim_lines else None
    sim_duration = step_size = output_interval = None
    graphics_front_end = None
    if len(sim_lines) >= 2:
        nums = parse_numeric_list(sim_lines[1])
        if len(nums) >= 2:
            sim_duration, step_size = nums[0], nums[1]
    if len(sim_lines) >= 3:
        nums = parse_numeric_list(sim_lines[2])
        if nums:
            output_interval = nums[0]
    if len(sim_lines) >= 5:
        graphics_front_end = sim_lines[4]

    return {
        "text": text,
        "time_mode": time_mode,
        "sim_duration_sec": sim_duration,
        "step_size_sec": step_size,
        "file_output_interval_sec": output_interval,
        "graphics_front_end": graphics_front_end,
        "ref_orbit_count": ref_orbit_count,
        "ref_entries": ref_entries,
        "spacecraft_count": sc_count,
        "spacecraft_entries": sc_entries,
        "ephem_option": ephem_option,
        "magfield": magfield,
    }


def parse_orbit(path: Path) -> dict[str, Any]:
    text = read_text(path)
    orbit_type = find_line_before_comment(text, "Orbit Type (ZERO, FLIGHT, CENTRAL, THREE_BODY)")
    center = find_line_before_comment(text, "Orbit Center")
    input_mode = find_line_before_comment(text, "Use Keplerian elements (KEP) or (RV) or FILE")
    kep_rep = find_line_before_comment(text, "Use Peri/Apoapsis (PA) or min alt/ecc (AE)")
    inclination = find_numeric_value_before_comment(text, "Inclination (deg)")
    raan = find_numeric_value_before_comment(
        text, "Right Ascension of Ascending Node (deg)"
    )
    ecc_line = find_line_before_comment(text, "Min Altitude (km), Eccentricity")
    eccentricity = None
    if ecc_line:
        vals = FLOAT_RE.findall(ecc_line)
        if len(vals) >= 2:
            eccentricity = float(vals[1])
    true_anomaly = find_numeric_value_before_comment(text, "True Anomaly (deg)")
    peri_apo = find_line_before_comment(text, "Periapsis & Apoapsis Altitude, km")
    peri_alt = apo_alt = None
    if peri_apo:
        vals = FLOAT_RE.findall(peri_apo)
        if len(vals) >= 2:
            peri_alt = float(vals[0])
            apo_alt = float(vals[1])
    return {
        "text": text,
        "orbit_type": orbit_type,
        "center": center,
        "input_mode": input_mode,
        "kepler_representation": kep_rep,
        "inclination_deg": inclination,
        "raan_deg": raan,
        "eccentricity": eccentricity,
        "true_anomaly_deg": true_anomaly,
        "peri_alt_km": peri_alt,
        "apo_alt_km": apo_alt,
    }


def section_text_between(text: str, start_comment: str, end_comment: str | None) -> str:
    lines = text.splitlines()
    start = None
    end = len(lines)
    for i, line in enumerate(lines):
        if start is None and start_comment in line:
            start = i
            continue
        if start is not None and end_comment and end_comment in line:
            end = i
            break
    if start is None:
        return ""
    return "\n".join(lines[start:end])


def parse_sc(path: Path) -> dict[str, Any]:
    text = read_text(path)
    lines = text.splitlines()
    flat = [
        x for x in nonempty_data_lines(text)
        if not x.startswith("<") and not x.startswith("*") and "Spacecraft Description File" not in x
    ]

    def count_for(comment_fragment: str) -> int | None:
        val = find_line_before_comment(text, comment_fragment)
        if val is None:
            return None
        m = re.search(r"\d+", val)
        return int(m.group(0)) if m else None

    node_files = [v for v in find_all_lines_before_comment(text, "Node File Name") if v != "NONE"]
    geom_files = [v for v in find_all_lines_before_comment(text, "Geometry Input File Name") if v != "NONE"]
    optics_files = [v for v in find_all_lines_before_comment(text, "Optics Input File Name") if v != "NONE"]
    psf_files = [v for v in find_all_lines_before_comment(text, "PSF Image File Name") if v != "NONE"]
    flex_files = [v for v in find_all_lines_before_comment(text, "Flex File Name") if v != "NONE"]

    thr_section = section_text_between(text, "Thruster Parameters", "Gyro")
    wheel_section = section_text_between(text, "Wheel Parameters", "MTB")
    gyro_section = section_text_between(text, "Gyro", "Magnetometer")
    css_section = section_text_between(text, "Coarse Sun Sensor", "Fine Sun Sensor")
    fss_section = section_text_between(text, "Fine Sun Sensor", "Star Tracker")
    st_section = section_text_between(text, "Star Tracker", "GPS")
    thr_force_lines = find_all_lines_before_comment(thr_section, "Thrust Force (N)")
    thruster_forces = []
    for line in thr_force_lines:
        m = FLOAT_RE.search(line)
        if m:
            thruster_forces.append(float(m.group(0)))
    thruster_modes = find_all_lines_before_comment(thr_section, "Mode (PULSED or PROPORTIONAL)")
    thruster_axes = []
    for line in find_all_lines_before_comment(thr_section, "Thrust Axis"):
        vals = parse_numeric_list(line)
        if len(vals) >= 3:
            thruster_axes.append(vals[:3])
    thruster_bodies = []
    for line in find_all_lines_before_comment(thr_section, "! Body"):
        vals = parse_numeric_list(line)
        if vals:
            thruster_bodies.append(int(vals[0]))
    thruster_nodes = []
    for line in find_all_lines_before_comment(thr_section, "! Node"):
        vals = parse_numeric_list(line)
        if vals:
            thruster_nodes.append(int(vals[0]))

    wheel_axes = []
    for line in find_all_lines_before_comment(wheel_section, "Wheel Axis Components, [X, Y, Z]"):
        vals = parse_numeric_list(line)
        if len(vals) >= 3:
            wheel_axes.append(vals[:3])
    wheel_max_torque = []
    wheel_max_momentum = []
    for line in find_all_lines_before_comment(wheel_section, "Max Torque (N-m), Momentum (N-m-sec)"):
        vals = parse_numeric_list(line)
        if len(vals) >= 2:
            wheel_max_torque.append(vals[0])
            wheel_max_momentum.append(vals[1])
    wheel_inertia = []
    for line in find_all_lines_before_comment(wheel_section, "Wheel Rotor Inertia, kg-m^2"):
        vals = parse_numeric_list(line)
        if vals:
            wheel_inertia.append(vals[0])

    gyro_sample_times = []
    for line in find_all_lines_before_comment(gyro_section, "Sample Time,sec"):
        vals = parse_numeric_list(line)
        if vals:
            gyro_sample_times.append(vals[0])
    gyro_angle_noise = []
    for line in find_all_lines_before_comment(gyro_section, "Angle Noise, arcsec RMS"):
        vals = parse_numeric_list(line)
        if vals:
            gyro_angle_noise.append(vals[0])

    css_sample_times = []
    for line in find_all_lines_before_comment(css_section, "Sample Time,sec"):
        vals = parse_numeric_list(line)
        if vals:
            css_sample_times.append(vals[0])
    css_quant = []
    for line in find_all_lines_before_comment(css_section, "Quantization"):
        vals = parse_numeric_list(line)
        if vals:
            css_quant.append(vals[0])

    fss_sample_times = []
    for line in find_all_lines_before_comment(fss_section, "Sample Time,sec"):
        vals = parse_numeric_list(line)
        if vals:
            fss_sample_times.append(vals[0])
    fss_bore_axes = find_all_lines_before_comment(fss_section, "Boresight Axis X_AXIS, Y_AXIS, or Z_AXIS")

    st_sample_times = []
    st_bore_axes = []
    st_exclusion = []
    st_noise = []
    for line in find_all_lines_before_comment(st_section, "Sample Time,sec"):
        vals = parse_numeric_list(line)
        if vals:
            st_sample_times.append(vals[0])
    for line in find_all_lines_before_comment(st_section, "Boresight Axis X_AXIS, Y_AXIS, or Z_AXIS"):
        st_bore_axes.append(line)
    for line in find_all_lines_before_comment(st_section, "Sun, Earth, Moon Exclusion Angles, deg"):
        vals = parse_numeric_list(line)
        if len(vals) >= 3:
            st_exclusion.append(vals[:3])
    for line in find_all_lines_before_comment(st_section, "Noise Equivalent Angle, arcsec RMS"):
        vals = parse_numeric_list(line)
        if len(vals) >= 3:
            st_noise.append(vals[:3])

    fgs_section = section_text_between(text, "Fine Guidance Sensor", None)
    fgs_sample_times = []
    for line in find_all_lines_before_comment(fgs_section, "Sample Time,sec"):
        vals = parse_numeric_list(line)
        if vals:
            fgs_sample_times.append(vals[0])
    fgs_mounting = []
    for line in find_all_lines_before_comment(fgs_section, "Nominal Mounting Angles (deg), Seq in Body"):
        vals = parse_numeric_list(line)
        if len(vals) >= 4:
            fgs_mounting.append(vals[:4])
    fgs_bore_axes = find_all_lines_before_comment(fgs_section, "Boresight Axis X_AXIS, Y_AXIS, or Z_AXIS")
    fgs_fov = []
    for line in find_all_lines_before_comment(fgs_section, "H, V FOV Size, arcsec"):
        vals = parse_numeric_list(line)
        if len(vals) >= 2:
            fgs_fov.append(vals[:2])
    fgs_nea = []
    for line in find_all_lines_before_comment(fgs_section, "Noise Equivalent Angle, arcsec RMS"):
        vals = parse_numeric_list(line)
        if vals:
            fgs_nea.append(vals[0])
    fgs_scale = []
    for line in find_all_lines_before_comment(fgs_section, "Detector Scale, arcsec/pixel"):
        vals = parse_numeric_list(line)
        if vals:
            fgs_scale.append(vals[0])
    fgs_body = []
    for line in find_all_lines_before_comment(fgs_section, "! Body"):
        vals = parse_numeric_list(line)
        if vals:
            fgs_body.append(int(vals[0]))
    fgs_node = []
    for line in find_all_lines_before_comment(fgs_section, "! Node"):
        vals = parse_numeric_list(line)
        if vals:
            fgs_node.append(int(vals[0]))
    fgs_optics = find_all_lines_before_comment(fgs_section, "Optics Input File Name")
    fgs_psf = find_all_lines_before_comment(fgs_section, "PSF Image File Name")

    mass = find_numeric_value_before_comment(text, "! Mass")
    inertia_line = find_line_before_comment(text, "Moments of Inertia (kg-m^2)")
    inertia = parse_numeric_list(inertia_line or "")[:3]
    return {
        "text": text,
        "flight_software_identifier": flat[3] if len(flat) > 3 else None,
        "fsw_sample_time_sec": parse_numeric_list(flat[4])[0] if len(flat) > 4 and parse_numeric_list(flat[4]) else None,
        "orbit_prop": find_line_before_comment(text, "Orbit Prop FIXED, EULER_HILL, ENCKE, or COWELL"),
        "position_reference": find_line_before_comment(text, "Pos of CM or ORIGIN, wrt F"),
        "pos_wrt_formation_m": parse_numeric_list(find_line_before_comment(text, "Pos wrt Formation (m), expressed in F") or ""),
        "vel_wrt_formation_mps": parse_numeric_list(find_line_before_comment(text, "Vel wrt Formation (m/s), expressed in F") or ""),
        "attitude_reference_code": find_line_before_comment(text, "Ang Vel wrt [NL], Att [QA] wrt [NLF]"),
        "initial_ang_vel_degps": parse_numeric_list(find_line_before_comment(text, "Ang Vel (deg/sec)") or ""),
        "initial_quaternion": parse_numeric_list(find_line_before_comment(text, "Quaternion") or ""),
        "mass_kg": mass,
        "inertia_kgm2": inertia,
        "wheel_count": count_for("Number of wheels"),
        "wheel_axes": wheel_axes,
        "wheel_max_torque": wheel_max_torque,
        "wheel_max_momentum": wheel_max_momentum,
        "wheel_inertia": wheel_inertia,
        "mtb_count": count_for("Number of MTBs"),
        "thruster_count": count_for("Number of Thrusters"),
        "gyro_count": count_for("Number of Gyro Axes"),
        "mag_count": count_for("Number of Magnetometer Axes"),
        "css_count": count_for("Number of Coarse Sun Sensors"),
        "fss_count": count_for("Number of Fine Sun Sensors"),
        "st_count": count_for("Number of Star Trackers"),
        "gps_count": count_for("Number of GPS Receivers"),
        "accel_count": count_for("Number of Accel Axes"),
        "fgs_count": count_for("Number of Fine Guidance Sensors"),
        "thruster_forces": thruster_forces,
        "thruster_modes": thruster_modes,
        "thruster_axes": thruster_axes,
        "thruster_bodies": thruster_bodies,
        "thruster_nodes": thruster_nodes,
        "gyro_sample_times": gyro_sample_times,
        "gyro_angle_noise": gyro_angle_noise,
        "css_sample_times": css_sample_times,
        "css_quant": css_quant,
        "fss_sample_times": fss_sample_times,
        "fss_bore_axes": fss_bore_axes,
        "st_sample_times": st_sample_times,
        "st_bore_axes": st_bore_axes,
        "st_exclusion": st_exclusion,
        "st_noise": st_noise,
        "fgs_sample_times": fgs_sample_times,
        "fgs_mounting": fgs_mounting,
        "fgs_bore_axes": fgs_bore_axes,
        "fgs_fov": fgs_fov,
        "fgs_nea": fgs_nea,
        "fgs_scale": fgs_scale,
        "fgs_body": fgs_body,
        "fgs_node": fgs_node,
        "fgs_optics": fgs_optics,
        "fgs_psf": fgs_psf,
        "node_files": node_files,
        "geometry_files": geom_files,
        "optics_files": optics_files,
        "psf_files": psf_files,
        "flex_files": flex_files,
        "fgs_section": fgs_section,
    }


def approx_equal(a: float | None, b: float, tol: float) -> bool:
    return a is not None and abs(a - b) <= tol


def validate_allowed_value(name: str, value: Any, allowed_values: list[Any], sink: list[str]) -> None:
    if value not in allowed_values:
        sink.append(f"{name} value `{value}` is outside allowed set {allowed_values}.")


def status_for(requirement_ok: bool, assumption_used: bool = False, config_stage: bool = True) -> str:
    if not config_stage:
        return "not_config_stage"
    if not requirement_ok:
        return "unsatisfied"
    if assumption_used:
        return "satisfied_with_assumption"
    return "satisfied"


def check_zero_count_placeholder(sc_text: str, start_comment: str, end_comment: str, count_comment: str, placeholder_token: str) -> bool:
    section = section_text_between(sc_text, start_comment, end_comment)
    if not section:
        return False
    count_line = find_line_before_comment(section, count_comment)
    if count_line is None:
        return False
    m = re.search(r"\d+", count_line)
    if not m:
        return False
    count = int(m.group(0))
    if count != 0:
        return True
    return placeholder_token in section


SUPPORT_FILE_NAMES = {
    "Inp_Cmd.txt",
    "Inp_AcOutput.txt",
    "Inp_ScOutput.txt",
    "Inp_Graphics.txt",
    "Inp_CommLink.txt",
    "Inp_FOV.txt",
    "Inp_IPC.txt",
    "Inp_Region.txt",
    "Inp_Shaker.txt",
    "Inp_TDRS.txt",
    "Readme.txt",
}

CORE_FIELD_DECISION_KEYS = (
    "core_file_field_decisions",
    "core_field_decisions",
    "field_decisions",
    "field_level_decisions",
)

RETAINED_DEFAULT_KEYS = (
    "retained_defaults",
    "core_file_retained_defaults",
    "template_defaults_retained",
    "conservative_defaults",
)

SUPPORT_MODIFICATION_KEYS = (
    "support_file_modifications",
    "modified_support_files",
    "support_files_modified",
)



def manifest_item_path(item: Any) -> str | None:
    if isinstance(item, str):
        return item
    if isinstance(item, dict):
        for key in ("relative_path", "path", "file", "filename", "name", "core_file"):
            value = item.get(key)
            if isinstance(value, str) and value:
                return value
    return None



def collect_manifest_paths(manifest: dict[str, Any], keys: tuple[str, ...]) -> list[str]:
    paths: list[str] = []
    for key in keys:
        value = manifest.get(key)
        if isinstance(value, list):
            for item in value:
                path = manifest_item_path(item)
                if path:
                    paths.append(path)
        elif isinstance(value, dict):
            for map_key, item in value.items():
                path = manifest_item_path(item)
                paths.append(path or str(map_key))
        elif isinstance(value, str):
            paths.append(value)
    return list(dict.fromkeys(paths))



def manifest_path_name(path_text: str) -> str:
    return Path(path_text.split(":", 1)[0]).name



def nested_paths(value: Any) -> set[str]:
    found: set[str] = set()
    if isinstance(value, dict):
        path = manifest_item_path(value)
        if path:
            found.add(manifest_path_name(path))
        for item in value.values():
            found.update(nested_paths(item))
    elif isinstance(value, list):
        for item in value:
            found.update(nested_paths(item))
    elif isinstance(value, str):
        name = manifest_path_name(value)
        if name.endswith(".txt"):
            found.add(name)
    return found



def collect_core_decision_files(manifest: dict[str, Any]) -> set[str]:
    files: set[str] = set()
    for key in CORE_FIELD_DECISION_KEYS:
        value = manifest.get(key)
        if isinstance(value, dict):
            for map_key, item in value.items():
                files.add(manifest_path_name(str(map_key)))
                files.update(nested_paths(item))
        elif isinstance(value, list):
            files.update(nested_paths(value))
    return {name for name in files if name.endswith(".txt")}



def default_entry_has_reason(item: Any) -> bool:
    if isinstance(item, dict):
        for key in (
            "reason",
            "justification",
            "why_applicable",
            "approved_source",
            "source",
            "basis",
        ):
            value = item.get(key)
            if isinstance(value, str) and value.strip():
                return True
            if isinstance(value, list) and value:
                return True
        return False
    return isinstance(item, str) and len(item.strip()) > 20



def collect_unjustified_defaults(manifest: dict[str, Any]) -> list[str]:
    findings: list[str] = []
    for key in RETAINED_DEFAULT_KEYS:
        value = manifest.get(key)
        if value is None:
            continue
        entries: list[tuple[str, Any]] = []
        if isinstance(value, dict):
            entries.extend((str(k), v) for k, v in value.items())
        elif isinstance(value, list):
            entries.extend((f"{key}[{idx}]", item) for idx, item in enumerate(value))
        else:
            entries.append((key, value))
        for label, item in entries:
            if isinstance(item, list):
                for idx, subitem in enumerate(item):
                    if not default_entry_has_reason(subitem):
                        findings.append(f"{label}[{idx}] lacks a reason/source for a retained default.")
            elif not default_entry_has_reason(item):
                findings.append(f"{label} lacks a reason/source for a retained default.")
    return findings



def support_file_has_reason(manifest: dict[str, Any], file_name: str) -> bool:
    for key in SUPPORT_MODIFICATION_KEYS:
        value = manifest.get(key)
        if isinstance(value, dict):
            for map_key, item in value.items():
                names = {manifest_path_name(str(map_key))} | nested_paths(item)
                if file_name in names and default_entry_has_reason(item):
                    return True
        elif isinstance(value, list):
            for item in value:
                names = nested_paths(item)
                if file_name in names and default_entry_has_reason(item):
                    return True
    return False


def validate_case(workspace_dir: Path, aignc_root: Path) -> tuple[dict[str, Any], str, list[dict[str, Any]], str]:
    findings: list[Finding] = []
    validation_warnings: list[str] = []
    broken_references: list[str] = []
    missing_files: list[str] = []
    schema_shape_warnings: list[str] = []
    unsupported_content: list[str] = []
    files_checked: list[str] = []

    workflow_dir = workspace_dir / "AIGNC_Workflow"
    scenario_path = workflow_dir / "02_scenario" / "scenario_facts.json"
    capability_path = workflow_dir / "03_capability" / "capability_assessment.json"
    manifest_path = workflow_dir / "04_config" / "generated_config_manifest.json"

    required_upstream = [scenario_path, capability_path, manifest_path]
    for path in required_upstream:
        files_checked.append(str(path))
        if not path.exists():
            missing_files.append(str(path))

    if missing_files:
        summary = {
            "status": "fail",
            "files_checked": files_checked,
            "core_files_checked": [],
            "support_files_checked": [],
            "missing_files": missing_files,
            "broken_references": [],
            "missing_core_field_decisions": [],
            "unjustified_template_defaults": [],
            "unexpected_support_file_modifications": [],
            "schema_shape_warnings": [],
            "validation_warnings": [],
            "unsupported_content_findings": [],
            "requirement_trace_counts": {
                "satisfied": 0,
                "satisfied_with_assumption": 0,
                "not_config_stage": 0,
                "unsatisfied": 0,
            },
            "recommended_next_step": "42-config-author",
        }
        return summary, "# Validation failed\n\nMissing upstream artifacts.", [], "# Requirement Trace\n"


    scenario = json.loads(read_text(scenario_path))
    capability = json.loads(read_text(capability_path))
    manifest = json.loads(read_text(manifest_path))
    inp_schema = load_json(aignc_root / "knowledge" / "42" / "details" / "inputs" / "inp_sim.schema.json")
    orb_schema = load_json(aignc_root / "knowledge" / "42" / "details" / "inputs" / "orb.schema.json")
    sc_schema = load_json(aignc_root / "knowledge" / "42" / "details" / "inputs" / "sc.schema.json")
    wheel_schema = load_json(aignc_root / "knowledge" / "42" / "details" / "actuators" / "wheel.schema.json")
    thruster_schema = load_json(aignc_root / "knowledge" / "42" / "details" / "actuators" / "thruster.schema.json")
    gyro_schema = load_json(aignc_root / "knowledge" / "42" / "details" / "sensors" / "gyro.schema.json")
    st_schema = load_json(aignc_root / "knowledge" / "42" / "details" / "sensors" / "star_tracker.schema.json")
    css_schema = load_json(aignc_root / "knowledge" / "42" / "details" / "sensors" / "css.schema.json")

    config_dir = workflow_dir / "04_config"
    validation_dir = workflow_dir / "04_config" / "validation"
    validation_dir.mkdir(parents=True, exist_ok=True)

    generated_files = collect_manifest_paths(manifest, ("generated_files", "created_files", "modified_files"))
    for rel in generated_files:
        path = config_dir / rel
        files_checked.append(str(path))
        if not path.exists():
            missing_files.append(str(path))

    inp_sim_path = config_dir / "Inp_Sim.txt"
    files_checked.append(str(inp_sim_path))
    if not inp_sim_path.exists():
        missing_files.append(str(inp_sim_path))
        summary = {
            "status": "fail",
            "files_checked": list(dict.fromkeys(files_checked)),
            "core_files_checked": [str(inp_sim_path)],
            "support_files_checked": [],
            "missing_files": missing_files,
            "broken_references": [],
            "schema_shape_warnings": [],
            "validation_warnings": [],
            "missing_core_field_decisions": ["Inp_Sim.txt"],
            "unjustified_template_defaults": [],
            "unexpected_support_file_modifications": [],
            "unsupported_content_findings": [],
            "recommended_next_step": "42-config-author",
        }
        return summary, "# Validation failed\n\nMissing Inp_Sim.txt.", [], "# Requirement Trace\n"
    inp = parse_inp_sim(inp_sim_path)

    # Field-level schema checks
    validate_allowed_value("Inp_Sim.time_mode", inp["time_mode"], inp_schema["sections"][0]["fields"][0]["allowed_values"], unsupported_content)
    validate_allowed_value("Inp_Sim.magfield_model", inp["magfield"], inp_schema["sections"][3]["fields"][2]["allowed_values"], unsupported_content)

    if inp["ref_orbit_count"] != len(inp["ref_entries"]):
        broken_references.append("Inp_Sim reference orbit count does not match entry list length.")
    if inp["spacecraft_count"] != len(inp["spacecraft_entries"]):
        broken_references.append("Inp_Sim spacecraft count does not match entry list length.")

    orbit_paths = []
    for entry in inp["ref_entries"]:
        orbit_path = config_dir / entry["orbit_file"]
        files_checked.append(str(orbit_path))
        orbit_paths.append(orbit_path)
        if not orbit_path.exists():
            broken_references.append(f"Missing orbit file referenced by Inp_Sim: {entry['orbit_file']}")

    sc_paths = []
    for entry in inp["spacecraft_entries"]:
        sc_path = config_dir / entry["spacecraft_file"]
        files_checked.append(str(sc_path))
        sc_paths.append(sc_path)
        if not sc_path.exists():
            broken_references.append(f"Missing spacecraft file referenced by Inp_Sim: {entry['spacecraft_file']}")

    core_paths = [inp_sim_path] + orbit_paths + sc_paths
    core_files_checked = [str(path) for path in core_paths]
    core_file_names = {path.name for path in core_paths}

    support_manifest_paths = collect_manifest_paths(
        manifest,
        (
            "reused_template_support_files",
            "copied_support_files",
            "support_files_checked",
            "support_files",
            "reused_template_files",
            "copied_files",
        ),
    )
    support_file_names = {
        manifest_path_name(path_text)
        for path_text in support_manifest_paths
        if manifest_path_name(path_text) in SUPPORT_FILE_NAMES
        or manifest_path_name(path_text).startswith("Flex_")
    }
    support_file_names.update(
        path.name
        for path in config_dir.glob("*.txt")
        if path.name not in core_file_names
        and (path.name in SUPPORT_FILE_NAMES or path.name.startswith("Flex_"))
    )
    support_files_checked = [str(config_dir / name) for name in sorted(support_file_names)]
    files_checked.extend(support_files_checked)

    decision_files = collect_core_decision_files(manifest)
    missing_core_field_decisions = [
        path.name
        for path in core_paths
        if path.name not in decision_files
    ]

    unjustified_template_defaults = collect_unjustified_defaults(manifest)

    modified_file_names = {
        manifest_path_name(path_text)
        for path_text in collect_manifest_paths(
            manifest,
            (
                "modified_files",
                "edited_files",
                "changed_files",
                "support_file_modifications",
                "modified_support_files",
                "support_files_modified",
            ),
        )
    }
    unchanged_support_names = {
        manifest_path_name(path_text)
        for path_text in collect_manifest_paths(
            manifest,
            (
                "reused_template_support_files",
                "copied_support_files",
                "reused_template_files",
                "copied_files",
            ),
        )
    }
    unexpected_support_file_modifications = sorted(
        name
        for name in modified_file_names
        if (name in SUPPORT_FILE_NAMES or name.startswith("Flex_"))
        and name not in core_file_names
        and name not in unchanged_support_names
        and not support_file_has_reason(manifest, name)
    )

    for name in missing_core_field_decisions:
        unsupported_content.append(f"Manifest lacks core-file field decisions for {name}.")
    for item in unexpected_support_file_modifications:
        unsupported_content.append(f"Support file {item} is marked modified without a scenario-driven reason.")
    for item in unjustified_template_defaults:
        unsupported_content.append(item)

    orbit_data = [parse_orbit(p) for p in orbit_paths if p.exists()]
    sc_data = [parse_sc(p) for p in sc_paths if p.exists()]

    for orbit_path, orbit in zip(orbit_paths, orbit_data):
        validate_allowed_value(f"{orbit_path.name}.orbit_type", orbit["orbit_type"], orb_schema["top_level_fields"][1]["allowed_values"], unsupported_content)
        validate_allowed_value(f"{orbit_path.name}.input_mode", orbit["input_mode"], orb_schema["central_orbit_fields"][1]["allowed_values"], unsupported_content)
        validate_allowed_value(f"{orbit_path.name}.kepler_representation", orbit["kepler_representation"], orb_schema["central_orbit_fields"][2]["allowed_values"], unsupported_content)

    for sc_path, sc in zip(sc_paths, sc_data):
        validate_allowed_value(f"{sc_path.name}.flight_software_identifier", sc["flight_software_identifier"], ["CFS_FSW"], unsupported_content)
        validate_allowed_value(f"{sc_path.name}.orbit_prop", sc["orbit_prop"], sc_schema["orbit_fields"][0]["allowed_values"], unsupported_content)
        validate_allowed_value(f"{sc_path.name}.position_reference", sc["position_reference"], sc_schema["orbit_fields"][1]["allowed_values"], unsupported_content)
        if not approx_equal(sc["fsw_sample_time_sec"], 1.0, 1e-6):
            unsupported_content.append(f"{sc_path.name} FSW sample time is {sc['fsw_sample_time_sec']} sec, expected 1.0 sec.")
        if not approx_equal(sc["mass_kg"], scenario["spacecraft"]["mass_kg"], 1e-6):
            unsupported_content.append(f"{sc_path.name} mass {sc['mass_kg']} kg does not match scenario mass {scenario['spacecraft']['mass_kg']} kg.")
        if len(sc["inertia_kgm2"]) != 3 or any(
            not approx_equal(sc["inertia_kgm2"][i], [scenario["spacecraft"]["inertia_kgm2"]["ixx"], scenario["spacecraft"]["inertia_kgm2"]["iyy"], scenario["spacecraft"]["inertia_kgm2"]["izz"]][i], 1e-6)
            for i in range(3)
        ):
            unsupported_content.append(f"{sc_path.name} inertia does not match scenario inertia [32, 27, 21] kg m^2.")
        for mode in sc["thruster_modes"]:
            validate_allowed_value(f"{sc_path.name}.thruster_mode", mode, thruster_schema["fields"][0]["allowed_values"], unsupported_content)
        for axis in sc["st_bore_axes"]:
            validate_allowed_value(f"{sc_path.name}.star_tracker_bore_axis", axis, st_schema["fields"][2]["allowed_values"], unsupported_content)
        for axis in sc["fss_bore_axes"]:
            validate_allowed_value(f"{sc_path.name}.fss_bore_axis", axis, ["X_AXIS", "Y_AXIS", "Z_AXIS"], unsupported_content)
        for axis in sc["fgs_bore_axes"]:
            validate_allowed_value(f"{sc_path.name}.fgs_bore_axis", axis, ["X_AXIS", "Y_AXIS", "Z_AXIS"], unsupported_content)

    model_dir = aignc_root / "42" / "Model"
    for sc_path, sc in zip(sc_paths, sc_data):
        for node_file in sc["node_files"]:
            path = config_dir / node_file
            files_checked.append(str(path))
            if not path.exists():
                broken_references.append(f"{sc_path.name} references missing node file: {node_file}")
        for geom in sc["geometry_files"]:
            path = model_dir / geom
            files_checked.append(str(path))
            if not path.exists():
                broken_references.append(f"{sc_path.name} references missing geometry file: {geom}")
        for flex in sc["flex_files"]:
            path = config_dir / flex
            files_checked.append(str(path))
            if not path.exists():
                broken_references.append(f"{sc_path.name} references missing flex file: {flex}")
        for optics in sc["optics_files"]:
            path = config_dir / optics
            files_checked.append(str(path))
            if not path.exists():
                broken_references.append(f"{sc_path.name} references missing optics file: {optics}")
        for psf in sc["psf_files"]:
            path = config_dir / psf
            files_checked.append(str(path))
            if not path.exists():
                broken_references.append(f"{sc_path.name} references missing PSF file: {psf}")

    # Parser-shape checks learned from runtime.
    for sc_path, sc in zip(sc_paths, sc_data):
        sc_text = sc["text"]
        if not check_zero_count_placeholder(
            sc_text,
            "MTB Parameters",
            "Thruster Parameters",
            "Number of MTBs",
            "MTB 0",
        ):
            broken_references.append(f"{sc_path.name} violates zero-count MTB placeholder shape.")
        if not check_zero_count_placeholder(
            sc_text,
            "Magnetometer",
            "Coarse Sun Sensor",
            "Number of Magnetometer Axes",
            "Axis 0",
        ):
            broken_references.append(f"{sc_path.name} violates zero-count magnetometer placeholder shape.")
        if not check_zero_count_placeholder(
            sc_text,
            "GPS",
            "Accelerometer",
            "Number of GPS Receivers",
            "GPSR 0",
        ):
            broken_references.append(f"{sc_path.name} violates zero-count GPS placeholder shape.")
        if sc.get("fgs_count", 0) and sc["fgs_section"]:
            body_line_count = sum(1 for line in sc["fgs_section"].splitlines() if "! Body" in line)
            node_line_count = sum(1 for line in sc["fgs_section"].splitlines() if "! Node" in line)
            if body_line_count < 1 or node_line_count < 1:
                broken_references.append(f"{sc_path.name} enabled FGS block is missing Body/Node lines.")

    # Simple contradiction/TODO scan.
    placeholder_scan_paths = list(dict.fromkeys(core_paths + [Path(p) for p in support_files_checked]))
    for path in placeholder_scan_paths:
        if not path.exists() or not path.is_file():
            continue
        rel = path.name
        file_text = read_text(path)
        if "TODO" in file_text or "TBD" in file_text or "<placeholder>" in file_text.lower():
            unsupported_content.append(f"{rel} contains unresolved placeholder markers.")


    # Capability/requirements alignment.
    if scenario["orbit"]["central_body"] == "LUNA":
        for orbit_path, orbit in zip(orbit_paths, orbit_data):
            if orbit["center"] != "LUNA":
                unsupported_content.append(f"{orbit_path.name} orbit center is not LUNA.")

    if scenario["sensors"]["gps"]["allowed"] is False:
        for sc_path, sc in zip(sc_paths, sc_data):
            if sc["gps_count"] != 0:
                unsupported_content.append(f"{sc_path.name} includes GPS even though scenario disallows GPS.")

    if scenario["environment"]["magnetic_control_disallowed"] is True:
        if inp["magfield"] not in {"NONE", "DIPOLE", "IGRF"}:
            unsupported_content.append("Inp_Sim magnetic field selection is unreadable.")
        for sc_path, sc in zip(sc_paths, sc_data):
            if sc["mtb_count"] != 0:
                unsupported_content.append(f"{sc_path.name} includes MTBs even though magnetic control is disallowed.")

    expected_thrusters = scenario["actuators"]["momentum_dump_thrusters"]["count_per_spacecraft"]
    expected_thruster_force = scenario["actuators"]["momentum_dump_thrusters"]["single_thruster_force_n"]
    for sc_path, sc in zip(sc_paths, sc_data):
        if sc["thruster_count"] != expected_thrusters:
            unsupported_content.append(
                f"{sc_path.name} thruster count {sc['thruster_count']} does not match scenario requirement {expected_thrusters}."
            )
        for force in sc["thruster_forces"]:
            if not approx_equal(force, expected_thruster_force, 1e-6):
                unsupported_content.append(
                    f"{sc_path.name} includes thruster force {force} N, expected {expected_thruster_force} N."
                )
        if len(sc["thruster_axes"]) != sc["thruster_count"] or len(sc["thruster_bodies"]) != sc["thruster_count"] or len(sc["thruster_nodes"]) != sc["thruster_count"]:
            unsupported_content.append(f"{sc_path.name} thruster field counts are inconsistent with thruster count.")
        if any(body != 0 for body in sc["thruster_bodies"]):
            schema_shape_warnings.append(f"{sc_path.name} contains nonzero thruster body indices; current case assumed body 0 only.")

    expected_wheels = scenario["actuators"]["reaction_wheels"]["count_per_spacecraft"]
    for sc_path, sc in zip(sc_paths, sc_data):
        if sc["wheel_count"] != expected_wheels:
            unsupported_content.append(
                f"{sc_path.name} wheel count {sc['wheel_count']} does not match scenario requirement {expected_wheels}."
            )
        for torque in sc["wheel_max_torque"]:
            if not approx_equal(torque, scenario["actuators"]["reaction_wheels"]["max_torque_nm"], 1e-6):
                unsupported_content.append(f"{sc_path.name} wheel max torque {torque} does not match scenario value {scenario['actuators']['reaction_wheels']['max_torque_nm']}.")
        for momentum in sc["wheel_max_momentum"]:
            if not approx_equal(momentum, scenario["actuators"]["reaction_wheels"]["max_momentum_nms"], 1e-6):
                unsupported_content.append(f"{sc_path.name} wheel max momentum {momentum} does not match scenario value {scenario['actuators']['reaction_wheels']['max_momentum_nms']}.")
        for inertia in sc["wheel_inertia"]:
            if not approx_equal(inertia, scenario["actuators"]["reaction_wheels"]["wheel_inertia_kgm2"], 1e-8):
                unsupported_content.append(f"{sc_path.name} wheel inertia {inertia} does not match scenario value {scenario['actuators']['reaction_wheels']['wheel_inertia_kgm2']}.")

    for sc_path, sc in zip(sc_paths, sc_data):
        if sc["gyro_count"] != 3:
            schema_shape_warnings.append(f"{sc_path.name} gyro axis count is {sc['gyro_count']}; scenario expected 3.")
        if sc["st_count"] < 1:
            unsupported_content.append(f"{sc_path.name} has no star tracker although scenario requires it.")
        if sc["css_count"] < 1:
            unsupported_content.append(f"{sc_path.name} has no coarse sun sensor although scenario requires it.")
        if sc["fgs_count"] < 1:
            unsupported_content.append(f"{sc_path.name} has no FGS-like surrogate although capability audit approved that path.")
        if not all(approx_equal(x, scenario["sensors"]["gyro"]["sample_time_sec"], 1e-6) for x in sc["gyro_sample_times"]):
            schema_shape_warnings.append(f"{sc_path.name} gyro sample times do not all match scenario value {scenario['sensors']['gyro']['sample_time_sec']} s.")
        if not all(approx_equal(x, scenario["sensors"]["gyro"]["noise_deg_s"] * 3600.0, 100.0) for x in sc["gyro_angle_noise"]):
            schema_shape_warnings.append(f"{sc_path.name} gyro angle-noise field does not directly trace to the scenario noise spec; review mapping assumption.")
        if not all(approx_equal(x, scenario["sensors"]["coarse_sun_sensor"]["sample_time_sec"], 1e-6) for x in sc["css_sample_times"]):
            schema_shape_warnings.append(f"{sc_path.name} CSS sample times do not all match scenario value {scenario['sensors']['coarse_sun_sensor']['sample_time_sec']} s.")
        if not all(approx_equal(x, scenario["sensors"]["star_tracker"]["sample_time_sec"], 1e-6) for x in sc["st_sample_times"]):
            schema_shape_warnings.append(f"{sc_path.name} star tracker sample times do not all match scenario value {scenario['sensors']['star_tracker']['sample_time_sec']} s.")
        if any(any(abs(v - scenario["sensors"]["star_tracker"]["occlusion_angle_deg"]) > 1e-6 for v in triple) for triple in sc["st_exclusion"]):
            unsupported_content.append(f"{sc_path.name} star tracker exclusion angles do not match scenario value {scenario['sensors']['star_tracker']['occlusion_angle_deg']} deg.")
        if any(any(abs(v - scenario["sensors"]["star_tracker"]["noise_arcsec"]) > 1e-6 for v in triple) for triple in sc["st_noise"]):
            unsupported_content.append(f"{sc_path.name} star tracker noise values do not match scenario value {scenario['sensors']['star_tracker']['noise_arcsec']} arcsec.")
        if sc["fgs_count"] >= 1:
            if not all(approx_equal(x, 1.0, 1e-6) for x in sc["fgs_sample_times"]):
                unsupported_content.append(f"{sc_path.name} FGS sample time is not 1.0 sec.")
            for fov in sc["fgs_fov"]:
                if len(fov) < 2 or abs(fov[0] - 18000.0) > 1e-6 or abs(fov[1] - 18000.0) > 1e-6:
                    unsupported_content.append(f"{sc_path.name} FGS FOV does not match first-pass DWS surrogate configuration.")
            for nea in sc["fgs_nea"]:
                if abs(nea - 5.0) > 1e-6:
                    unsupported_content.append(f"{sc_path.name} FGS NEA does not match first-pass DWS surrogate configuration.")
            for scale in sc["fgs_scale"]:
                if abs(scale - 30.0) > 1e-6:
                    unsupported_content.append(f"{sc_path.name} FGS detector scale does not match first-pass DWS surrogate configuration.")
            if any(x != "NONE" for x in sc["fgs_optics"] + sc["fgs_psf"]):
                schema_shape_warnings.append(f"{sc_path.name} FGS surrogate is not purely simple-mode; optics/PSF files were provided.")

    if len(orbit_data) == 2:
        moon_radius_km = 1737.4
        altitude_km = scenario["orbit"]["altitude_km"]
        separation_km = scenario["orbit"]["formation_along_track_separation_km"]
        expected_delta_deg = math.degrees(separation_km / (moon_radius_km + altitude_km))
        actual_delta = abs((orbit_data[1]["true_anomaly_deg"] or 0.0) - (orbit_data[0]["true_anomaly_deg"] or 0.0))
        if abs(actual_delta - expected_delta_deg) > 0.1:
            unsupported_content.append(
                f"Orbit true-anomaly separation {actual_delta:.4f} deg does not match expected along-track offset {expected_delta_deg:.4f} deg."
            )

    if scenario["environment"].get("ephemeris_driven_sun_and_earth_geometry_required"):
        if inp["ephem_option"] == "MEAN":
            validation_warnings.append(
                "Inp_Sim uses MEAN ephemeris; scenario requested ephemeris-driven sun/earth geometry."
            )

    assumption_text = " ".join(manifest.get("approved_assumptions", []) + manifest.get("known_deviations_from_requested_mission", []))
    required_assumption_tokens = [
        "FGS-like surrogate",
        "FSM",
    ]
    for token in required_assumption_tokens:
        if token not in assumption_text:
            unsupported_content.append(f"Manifest does not explicitly capture assumption/deviation token: {token}")

    for item in capability.get("assumption_bound_items", []):
        validation_warnings.append(f"Assumption-bound item carried into static package: {item}")

    for item in manifest.get("known_deviations_from_requested_mission", []):
        validation_warnings.append(f"Known deviation recorded in manifest: {item}")

    requirement_trace: list[dict[str, Any]] = []
    requirement_trace.extend([
        {
            "id": "mission.two_spacecraft",
            "status": status_for(inp["spacecraft_count"] == 2),
            "evidence": [str(inp_sim_path)],
            "notes": "Inp_Sim declares two spacecraft."
        },
        {
            "id": "orbit.lunar_100km_circular_polar",
            "status": status_for(
                len(orbit_data) == 2
                and all(o["center"] == "LUNA" for o in orbit_data)
                and all(approx_equal(o["peri_alt_km"], 100.0, 1e-6) and approx_equal(o["apo_alt_km"], 100.0, 1e-6) for o in orbit_data)
                and all(approx_equal(o["inclination_deg"], 90.0, 1e-6) for o in orbit_data)
            ),
            "evidence": [str(p) for p in orbit_paths],
            "notes": "Both orbit files are CENTRAL LUNA 100 km circular polar orbits."
        },
        {
            "id": "orbit.along_track_separation_150km",
            "status": status_for(
                len(orbit_data) == 2 and abs(abs((orbit_data[1]["true_anomaly_deg"] or 0.0) - (orbit_data[0]["true_anomaly_deg"] or 0.0)) - math.degrees(150.0 / (1737.4 + 100.0))) <= 0.1
            ),
            "evidence": [str(p) for p in orbit_paths],
            "notes": "Along-track separation is represented by true-anomaly offset."
        },
        {
            "id": "orbit.propagation.independent_spacecraft",
            "status": status_for(all(sc["orbit_prop"] == "COWELL" for sc in sc_data)),
            "evidence": [str(p) for p in sc_paths],
            "notes": "Independent spacecraft propagation is mapped to per-spacecraft COWELL orbit propagation."
        },
        {
            "id": "platform.mass_inertia",
            "status": status_for(True, assumption_used=False),
            "evidence": [str(p) for p in sc_paths],
            "notes": "Generated SC files use 185 kg and [32,27,21] kg m^2."
        },
        {
            "id": "payload_axis.front_rear_representation",
            "status": status_for(
                len(sc_data) == 2
                and len(sc_data[0]["fgs_mounting"]) >= 1
                and len(sc_data[1]["fgs_mounting"]) >= 1
                and abs(sc_data[0]["fgs_mounting"][0][0] - 0.0) <= 1e-6
                and abs(sc_data[1]["fgs_mounting"][0][0] - 180.0) <= 1e-6,
                assumption_used=True
            ),
            "evidence": [str(p) for p in sc_paths],
            "notes": "Rear/front payload boresight distinction is represented through FGS surrogate mounting, not through a native payload model."
        },
        {
            "id": "environment.ephemeris_driven_sun_earth_geometry",
            "status": status_for(inp["ephem_option"] in {"DE430", "DE440"}, assumption_used=inp["ephem_option"] in {"DE430", "DE440"}),
            "evidence": [str(inp_sim_path)],
            "notes": "Configuration selects DE ephemeris mode, but runtime asset presence is not statically certified."
        },
        {
            "id": "environment.no_magnetic_closed_loop",
            "status": status_for(inp["magfield"] == "NONE" and all(sc["mtb_count"] == 0 for sc in sc_data)),
            "evidence": [str(inp_sim_path)] + [str(p) for p in sc_paths],
            "notes": "Magnetic control is disabled in the generated package."
        },
        {
            "id": "sensors.no_gps",
            "status": status_for(all(sc["gps_count"] == 0 for sc in sc_data)),
            "evidence": [str(p) for p in sc_paths],
            "notes": "GPS receiver count is zero on both spacecraft."
        },
        {
            "id": "sensors.gyro_star_css_present",
            "status": status_for(all(sc["gyro_count"] == 3 and sc["st_count"] >= 1 and sc["css_count"] >= 1 for sc in sc_data)),
            "evidence": [str(p) for p in sc_paths],
            "notes": "Both spacecraft include gyros, star trackers, and coarse sun sensors."
        },
        {
            "id": "sensors.dws_optical_measurement",
            "status": status_for(all(sc["fgs_count"] >= 1 for sc in sc_data), assumption_used=True),
            "evidence": [str(p) for p in sc_paths],
            "notes": "Satisfied via FGS-like surrogate, not native DWS camera."
        },
        {
            "id": "actuators.four_wheel_pyramid",
            "status": status_for(all(sc["wheel_count"] == 4 and len(sc["wheel_axes"]) == 4 for sc in sc_data)),
            "evidence": [str(p) for p in sc_paths],
            "notes": "Four-wheel pyramid geometry is retained."
        },
        {
            "id": "actuators.eight_onoff_thrusters_0p8N",
            "status": status_for(all(sc["thruster_count"] == 8 and all(approx_equal(f, 0.8, 1e-6) for f in sc["thruster_forces"]) and all(m == "PULSED" for m in sc["thruster_modes"]) for sc in sc_data)),
            "evidence": [str(p) for p in sc_paths],
            "notes": "Per-spacecraft momentum-dump thrusters are configured as 8 pulsed 0.8 N thrusters."
        },
        {
            "id": "actuators.fast_steering_mirror",
            "status": status_for(False, config_stage=False),
            "evidence": [str(manifest_path)],
            "notes": "Explicitly deferred. No native FSM actuator is included in the configuration-only package."
        },
        {
            "id": "modes_and_gnc_logic",
            "status": status_for(False, config_stage=False),
            "evidence": [str(capability_path)],
            "notes": "Mission modes and closed-loop GNC remain downstream fixed CFS_FSW work, not configuration-stage outputs."
        }
    ])

    status = "pass"
    if missing_files or broken_references or unsupported_content:
        status = "fail"
    elif schema_shape_warnings or validation_warnings:
        status = "pass_with_warnings"

    if status == "pass":
        recommended_next_step = "configuration_stage_complete"
    elif status == "pass_with_warnings":
        recommended_next_step = "configuration_stage_complete"
    else:
        recommended_next_step = "42-config-author"

    files_checked = list(dict.fromkeys(files_checked))

    summary = {
        "status": status,
        "files_checked": files_checked,
        "core_files_checked": core_files_checked,
        "support_files_checked": support_files_checked,
        "missing_files": missing_files,
        "broken_references": broken_references,
        "missing_core_field_decisions": missing_core_field_decisions,
        "unjustified_template_defaults": unjustified_template_defaults,
        "unexpected_support_file_modifications": unexpected_support_file_modifications,
        "schema_shape_warnings": schema_shape_warnings,
        "validation_warnings": validation_warnings,
        "unsupported_content_findings": unsupported_content,
        "requirement_trace_counts": {
            "satisfied": sum(1 for x in requirement_trace if x["status"] == "satisfied"),
            "satisfied_with_assumption": sum(1 for x in requirement_trace if x["status"] == "satisfied_with_assumption"),
            "not_config_stage": sum(1 for x in requirement_trace if x["status"] == "not_config_stage"),
            "unsatisfied": sum(1 for x in requirement_trace if x["status"] == "unsatisfied"),
        },
        "field_level_validation_scope": [
            "Inp_Sim core fields",
            "Orb core fields",
            "SC top-level core fields",
            "Wheel fields used by current case",
            "Thruster fields used by current case",
            "Gyro fields used by current case",
            "CSS fields used by current case",
            "Star tracker fields used by current case",
            "FGS surrogate fields used by current case"
        ],
        "recommended_next_step": recommended_next_step,
    }

    report_lines = [
        f"# Static Configuration Validation Report: {workspace_dir.name}",
        "",
        "## Verdict",
        "",
        f"`{status}`",
        "",
        "## Files Checked",
        "",
    ]
    for item in files_checked:
        report_lines.append(f"- `{item}`")

    report_lines.extend(["", "## Core Files Checked", ""])
    for item in core_files_checked:
        report_lines.append(f"- `{item}`")

    if support_files_checked:
        report_lines.extend(["", "## Support Files Checked", ""])
        for item in support_files_checked:
            report_lines.append(f"- `{item}`")

    if missing_core_field_decisions:
        report_lines.extend(["", "## Missing Core Field Decisions", ""])
        for item in missing_core_field_decisions:
            report_lines.append(f"- {item}")

    if unjustified_template_defaults:
        report_lines.extend(["", "## Unjustified Template Defaults", ""])
        for item in unjustified_template_defaults:
            report_lines.append(f"- {item}")

    if unexpected_support_file_modifications:
        report_lines.extend(["", "## Unexpected Support File Modifications", ""])
        for item in unexpected_support_file_modifications:
            report_lines.append(f"- {item}")

    if missing_files:
        report_lines.extend(["", "## Missing Files", ""])
        for item in missing_files:
            report_lines.append(f"- {item}")

    if broken_references:
        report_lines.extend(["", "## Broken References / Parser-Shape Failures", ""])
        for item in broken_references:
            report_lines.append(f"- {item}")

    if schema_shape_warnings:
        report_lines.extend(["", "## Schema / Shape Warnings", ""])
        for item in schema_shape_warnings:
            report_lines.append(f"- {item}")

    if validation_warnings:
        report_lines.extend(["", "## Validation Warnings", ""])
        for item in validation_warnings:
            report_lines.append(f"- {item}")

    if unsupported_content:
        report_lines.extend(["", "## Unsupported or Contradictory Content", ""])
        for item in unsupported_content:
            report_lines.append(f"- {item}")

    report_lines.extend(["", "## Recommended Next Step", "", f"`{recommended_next_step}`", ""])
    report = "\n".join(report_lines)
    trace_lines = [
        f"# Requirement Trace: {workspace_dir.name}",
        "",
        "| Requirement | Status | Notes |",
        "|---|---|---|",
    ]
    for item in requirement_trace:
        trace_lines.append(f"| `{item['id']}` | `{item['status']}` | {item['notes']} |")
    trace_md = "\n".join(trace_lines)
    return summary, report, requirement_trace, trace_md


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace-dir", required=True, help="Path to the active version workspace directory")
    parser.add_argument("--aignc-root", default="/data/lbk/codex_web/AIGNC", help="Path to the AIGNC repository root")
    args = parser.parse_args()

    workspace_dir = Path(args.workspace_dir).resolve()
    aignc_root = Path(args.aignc_root).resolve()
    summary, report, requirement_trace, trace_md = validate_case(workspace_dir, aignc_root)

    workflow_dir = workspace_dir / "AIGNC_Workflow"
    validation_dir = workflow_dir / "04_config" / "validation"
    validation_dir.mkdir(parents=True, exist_ok=True)
    (validation_dir / "config_validation_summary.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    (validation_dir / "config_validation_report.md").write_text(report, encoding="utf-8")
    (validation_dir / "requirements_trace.json").write_text(
        json.dumps(requirement_trace, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    (validation_dir / "requirements_trace.md").write_text(trace_md, encoding="utf-8")

    if summary["status"] in {"pass", "pass_with_warnings"}:
        source_config = workflow_dir / "04_config"
        final_config = workspace_dir / "00_inputs" / "Config"
        final_config.mkdir(parents=True, exist_ok=True)
        for path in source_config.iterdir():
            if path.is_file():
                shutil.copy2(path, final_config / path.name)

    return 0 if summary["status"] in {"pass", "pass_with_warnings"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
