import argparse
import math
import re
from pathlib import Path

import numpy as np
import pandas as pd
from PIL import Image, ImageDraw, ImageFont


R2D = 180.0 / math.pi
DEFAULT_WHEEL_INERTIA = 0.00068209
FONT = ImageFont.load_default()
COLORS = ["#0066cc", "#d9480f", "#2b8a3e", "#7b2cbf", "#0b7285", "#c92a2a", "#5c940d", "#862e9c"]


def q2c(q):
    # 42 writes quaternions as vector-first, scalar-last:
    # [q1, q2, q3, qs]. Keep this convention for CBN reconstruction.
    q1, q2, q3, qs = q
    return np.array(
        [
            [
                1.0 - 2.0 * (q2 * q2 + q3 * q3),
                2.0 * (q1 * q2 + qs * q3),
                2.0 * (q1 * q3 - qs * q2),
            ],
            [
                2.0 * (q1 * q2 - qs * q3),
                1.0 - 2.0 * (q1 * q1 + q3 * q3),
                2.0 * (q2 * q3 + qs * q1),
            ],
            [
                2.0 * (q1 * q3 + qs * q2),
                2.0 * (q2 * q3 - qs * q1),
                1.0 - 2.0 * (q1 * q1 + q2 * q2),
            ],
        ],
        dtype=float,
    )


def find_cln(r, v):
    h = np.cross(r, v)
    rr = np.linalg.norm(r)
    hh = np.linalg.norm(h)
    if rr <= 0.0 or hh <= 0.0:
        return np.eye(3)
    l3 = -r / rr
    l2 = -h / hh
    l1 = np.cross(l2, l3)
    l1 /= np.linalg.norm(l1)
    return np.vstack((l1, l2, l3))


def c2a_123(c):
    th1 = math.atan2(-c[2, 1], c[2, 2])
    th2 = math.asin(max(-1.0, min(1.0, c[2, 0])))
    th3 = math.atan2(-c[1, 0], c[0, 0])
    return np.array([th1, th2, th3]) * R2D


def discover_sc_files(inout_dir):
    indexed = []
    for path in sorted(inout_dir.glob("Sc*.csv")):
        m = re.fullmatch(r"Sc(\d*)\.csv", path.name)
        if m:
            idx = int(m.group(1) or 0)
            indexed.append((idx, path))
    return indexed


def load_wheel_inertias(inout_dir, count):
    inertias = []
    sc_configs = sorted(inout_dir.glob("SC_*.txt"))
    for path in sc_configs:
        lines = path.read_text(errors="ignore").splitlines()
        for i, line in enumerate(lines):
            if "Wheel Rotor Inertia" in line:
                try:
                    inertias.append(float(line.split("!")[0].split()[0]))
                except (IndexError, ValueError):
                    pass
        if len(inertias) >= count:
            break
    if len(inertias) < count:
        inertias.extend([DEFAULT_WHEEL_INERTIA] * (count - len(inertias)))
    return np.asarray(inertias[:count], dtype=float)


def load_spacecraft(sc_idx, sc_path, inout_dir):
    sc = pd.read_csv(sc_path)
    time = sc.iloc[:, 0].to_numpy(dtype=float)
    qbn = sc[["Sc_qn_1", "Sc_qn_2", "Sc_qn_3", "Sc_qn_4"]].to_numpy(dtype=float)
    wbn = sc[["Sc_wn_1", "Sc_wn_2", "Sc_wn_3"]].to_numpy(dtype=float) * R2D
    posn = sc[["Sc_PosN_1", "Sc_PosN_2", "Sc_PosN_3"]].to_numpy(dtype=float)
    veln = sc[["Sc_VelN_1", "Sc_VelN_2", "Sc_VelN_3"]].to_numpy(dtype=float)

    inertial_euler = np.zeros((len(sc), 3), dtype=float)
    orbit_euler = np.zeros((len(sc), 3), dtype=float)
    for i in range(len(sc)):
        cbn = q2c(qbn[i])
        inertial_euler[i] = c2a_123(cbn)
        cln = find_cln(posn[i], veln[i])
        cbl = cbn @ cln.T
        orbit_euler[i] = c2a_123(cbl)

    wheel_rpm = None
    wheel_time = time
    acwhl = inout_dir / f"AcWhl{sc_idx}.csv"
    fallback_acwhl = inout_dir / "AcWhl.csv"
    if not acwhl.exists() and sc_idx == 0 and fallback_acwhl.exists():
        acwhl = fallback_acwhl
    if acwhl.exists():
        whl = pd.read_csv(acwhl)
        cols = [c for c in whl.columns if c.endswith("_H")]
        if cols:
            wheel_h = whl[cols].to_numpy(dtype=float)
            wheel_j = load_wheel_inertias(inout_dir, wheel_h.shape[1])
            wheel_rpm = wheel_h / wheel_j.reshape(1, -1) * 60.0 / (2.0 * math.pi)
            wheel_time = whl.iloc[:, 0].to_numpy(dtype=float)
    else:
        hwhl = inout_dir / "Hwhl.42"
        t42 = inout_dir / "time.42"
        if sc_idx == 0 and hwhl.exists():
            wheel_h = np.loadtxt(hwhl, ndmin=2)
            wheel_j = load_wheel_inertias(inout_dir, wheel_h.shape[1])
            wheel_rpm = wheel_h / wheel_j.reshape(1, -1) * 60.0 / (2.0 * math.pi)
            wheel_time = np.loadtxt(t42, ndmin=1) if t42.exists() else np.arange(len(wheel_h), dtype=float)

    return {
        "sc_idx": sc_idx,
        "time": time,
        "wbn_deg_s": wbn,
        "inertial_euler_deg": inertial_euler,
        "orbit_euler_deg": orbit_euler,
        "wheel_time": wheel_time,
        "wheel_rpm": wheel_rpm,
    }


def nice_limits(series_list):
    vals = np.concatenate([np.asarray(s, dtype=float).ravel() for s in series_list if s is not None])
    finite = vals[np.isfinite(vals)]
    vmax = float(np.max(np.abs(finite))) if len(finite) else 1.0
    vmax = max(vmax, 1.0e-6)
    if vmax < 1.0:
        span = math.ceil(vmax * 10.0) / 10.0
    elif vmax < 10.0:
        span = math.ceil(vmax)
    elif vmax < 100.0:
        span = math.ceil(vmax / 5.0) * 5.0
    elif vmax < 1000.0:
        span = math.ceil(vmax / 50.0) * 50.0
    else:
        span = math.ceil(vmax / 500.0) * 500.0
    return -span, span


def draw_panel(draw, rect, time, series, labels, colors, title, ylabel, ylims=None):
    x0, y0, x1, y1 = rect
    left = x0 + 72
    right = x1 - 18
    top = y0 + 36
    bottom = y1 - 52

    draw.rectangle(rect, fill="white", outline="#c9ced6", width=1)
    draw.text((x0 + 12, y0 + 10), title, fill="#101418", font=FONT)
    draw.text((x0 + 12, y1 - 18), ylabel, fill="#506070", font=FONT)

    if time is None or len(time) == 0:
        draw.text((x0 + 20, y0 + 60), "No data", fill="#7a8794", font=FONT)
        return

    if ylims is None:
        ylims = nice_limits(series)
    ymin, ymax = ylims
    tmin = float(time[0])
    tmax = float(time[-1])
    if abs(tmax - tmin) < 1.0e-12:
        tmax = tmin + 1.0
    if ymax - ymin < 1.0e-12:
        ymax += 1.0
        ymin -= 1.0

    for frac in np.linspace(0.0, 1.0, 5):
        yy = top + frac * (bottom - top)
        yv = ymax - frac * (ymax - ymin)
        draw.line((left, yy, right, yy), fill="#e7ebf0", width=1)
        draw.text((x0 + 6, yy - 6), f"{yv:.1f}", fill="#5a6470", font=FONT)

    for frac in np.linspace(0.0, 1.0, 6):
        xx = left + frac * (right - left)
        xv = tmin + frac * (tmax - tmin)
        draw.line((xx, top, xx, bottom), fill="#f1f3f6", width=1)
        lab = f"{xv/3600.0:.1f}h" if tmax >= 3600.0 else f"{xv/60.0:.0f}m" if tmax >= 60.0 else f"{xv:.0f}s"
        draw.text((xx - 16, bottom + 8), lab, fill="#5a6470", font=FONT)

    if ymin < 0.0 < ymax:
        yz = top + (ymax / (ymax - ymin)) * (bottom - top)
        draw.line((left, yz, right, yz), fill="#bcc6d2", width=1)

    def map_point(tx, ty):
        px = left + (tx - tmin) / (tmax - tmin) * (right - left)
        py = top + (ymax - ty) / (ymax - ymin) * (bottom - top)
        return px, py

    for vals, label, color in zip(series, labels, colors):
        if vals is None:
            continue
        pts = [map_point(tx, ty) for tx, ty in zip(time, vals)]
        if len(pts) >= 2:
            draw.line(pts, fill=color, width=2)
        lx = right - 170
        ly = top + 8 + labels.index(label) * 16
        draw.line((lx, ly + 6, lx + 20, ly + 6), fill=color, width=3)
        draw.text((lx + 26, ly), label, fill="#1a1f24", font=FONT)


def make_figure(output_path, row_def, sc_data, subtitle):
    width = 2200
    row_h = 360
    height = 88 + row_h
    image = Image.new("RGB", (width, height), "#f4f6f8")
    draw = ImageDraw.Draw(image)

    draw.text((24, 18), "Post-run GNC Summary", fill="#101418", font=FONT)
    draw.text((24, 40), subtitle, fill="#55606d", font=FONT)

    panel_w = (width - 72) // 2
    y0 = 74
    key = row_def["key"]
    available = [d[key][:, i] for d in sc_data[:2] if d[key] is not None for i in range(d[key].shape[1])]
    ylims = nice_limits(available) if available else (-1.0, 1.0)

    for col_idx, sc in enumerate(sc_data[:2]):
        x0 = 24 + col_idx * (panel_w + 24)
        rect = (x0, y0, x0 + panel_w, y0 + row_h - 18)
        block = sc[key]
        time = sc["wheel_time"] if key == "wheel_rpm" else sc["time"]
        if block is None:
            series = [None for _ in row_def["labels"]]
        else:
            series = [block[:, i] for i in range(block.shape[1])]
        draw_panel(
            draw,
            rect,
            time if block is not None else None,
            series,
            row_def["labels"],
            row_def["colors"],
            f"SC{sc['sc_idx']} {row_def['title']}",
            row_def["ylabel"],
            ylims,
        )
        if block is None:
            draw.text((x0 + 20, y0 + 60), "Telemetry unavailable", fill="#7a8794", font=FONT)

    image.save(output_path)


def discover_thruster_data(inout_dir):
    candidates = []
    for pattern in ("AcThr*.csv", "Thr*.csv"):
        candidates.extend(sorted(inout_dir.glob(pattern)))
    for path in candidates:
        df = pd.read_csv(path)
        if df.empty:
            continue
        time_col = df.columns[0]
        numeric_cols = []
        for col in df.columns[1:]:
            vals = pd.to_numeric(df[col], errors="coerce")
            if vals.notna().any() and vals.abs().max(skipna=True) > 0.0:
                numeric_cols.append(col)
        if numeric_cols:
            return path, df, time_col, numeric_cols[:8]
    return None


def make_thruster_figure(output_path, thruster):
    path, df, time_col, cols = thruster
    width = 2200
    height = 448
    image = Image.new("RGB", (width, height), "#f4f6f8")
    draw = ImageDraw.Draw(image)
    draw.text((24, 18), "Post-run GNC Summary", fill="#101418", font=FONT)
    draw.text((24, 40), f"Thruster output from {path.name}.", fill="#55606d", font=FONT)
    time = pd.to_numeric(df[time_col], errors="coerce").to_numpy(dtype=float)
    series = [pd.to_numeric(df[col], errors="coerce").to_numpy(dtype=float) for col in cols]
    draw_panel(
        draw,
        (24, 74, width - 24, height - 18),
        time,
        series,
        cols,
        COLORS[: len(cols)],
        "Thruster Output",
        "native units",
    )
    image.save(output_path)


def discover_mode_trace(inout_dir):
    paths = sorted(inout_dir.glob("ModeTrace_SC*.csv"))
    if not paths:
        paths = sorted(inout_dir.glob("*Mode*.csv"))
    for path in paths:
        df = pd.read_csv(path)
        if {"TimeSec", "Mode"}.issubset(df.columns):
            return path, df
    return None


def make_mode_timeline(output_path, mode_trace):
    path, df = mode_trace
    width = 2200
    height = 520
    image = Image.new("RGB", (width, height), "#f4f6f8")
    draw = ImageDraw.Draw(image)
    draw.text((24, 18), "Post-run Mode Timeline", fill="#101418", font=FONT)
    draw.text((24, 40), f"Mode sequence from {path.name}.", fill="#55606d", font=FONT)

    times = pd.to_numeric(df["TimeSec"], errors="coerce").to_numpy(dtype=float)
    modes = df["Mode"].astype(str).to_numpy()
    valid = np.isfinite(times)
    times = times[valid]
    modes = modes[valid]
    if len(times) == 0:
        draw.text((48, 110), "No mode data", fill="#7a8794", font=FONT)
        image.save(output_path)
        return

    ordered_modes = []
    for mode in modes:
        if mode not in ordered_modes:
            ordered_modes.append(mode)
    lane = {mode: idx for idx, mode in enumerate(ordered_modes)}
    left, right, top, bottom = 150, width - 60, 90, height - 72
    draw.rectangle((24, 74, width - 24, height - 18), fill="white", outline="#c9ced6", width=1)
    tmin, tmax = float(times[0]), float(times[-1])
    if tmax <= tmin:
        tmax = tmin + 1.0
    lane_h = (bottom - top) / max(1, len(ordered_modes))

    for idx, mode in enumerate(ordered_modes):
        y = top + idx * lane_h + lane_h / 2
        draw.line((left, y, right, y), fill="#e7ebf0", width=1)
        draw.text((36, y - 6), mode[:16], fill="#1a1f24", font=FONT)

    def x_at(t):
        return left + (float(t) - tmin) / (tmax - tmin) * (right - left)

    for i, mode in enumerate(modes):
        x0 = x_at(times[i])
        x1 = x_at(times[i + 1]) if i + 1 < len(times) else right
        y = top + lane[mode] * lane_h + lane_h / 2
        color = COLORS[lane[mode] % len(COLORS)]
        draw.line((x0, y, x1, y), fill=color, width=max(4, int(lane_h * 0.18)))
        draw.ellipse((x0 - 3, y - 3, x0 + 3, y + 3), fill=color)

    for frac in np.linspace(0.0, 1.0, 6):
        x = left + frac * (right - left)
        t = tmin + frac * (tmax - tmin)
        draw.line((x, top - 8, x, bottom + 8), fill="#f1f3f6", width=1)
        lab = f"{t/3600.0:.1f}h" if tmax >= 3600.0 else f"{t:.0f}s"
        draw.text((x - 16, bottom + 20), lab, fill="#5a6470", font=FONT)

    image.save(output_path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--inout", required=True, help="Path to runtime InOut directory")
    args = parser.parse_args()

    inout_dir = Path(args.inout).resolve()
    sc_files = discover_sc_files(inout_dir)
    if not sc_files:
        raise SystemExit(f"No Sc*.csv files found under {inout_dir}")

    sc_data = [load_spacecraft(sc_idx, path, inout_dir) for sc_idx, path in sc_files[:2]]
    generated = []
    missing = []

    plot_specs = [
        (
            "gnc_body_angular_velocity_xyz.png",
            {
                "key": "wbn_deg_s",
                "labels": ["wx", "wy", "wz"],
                "colors": COLORS[:3],
                "title": "Body Angular Velocity",
                "ylabel": "deg/s",
            },
            "Three-axis spacecraft body angular velocity.",
        ),
        (
            "gnc_inertial_attitude_xyz.png",
            {
                "key": "inertial_euler_deg",
                "labels": ["roll", "pitch", "yaw"],
                "colors": COLORS[:3],
                "title": "Inertial-frame Attitude",
                "ylabel": "deg",
            },
            "Inertial-frame Euler-123 attitude angles.",
        ),
        (
            "gnc_orbit_attitude_error_xyz.png",
            {
                "key": "orbit_euler_deg",
                "labels": ["roll", "pitch", "yaw"],
                "colors": COLORS[:3],
                "title": "Orbit-frame Attitude Error",
                "ylabel": "deg",
            },
            "Orbit-frame Euler-123 attitude error using 42 quaternion convention.",
        ),
        (
            "gnc_reaction_wheel_speed.png",
            {
                "key": "wheel_rpm",
                "labels": ["wheel0", "wheel1", "wheel2", "wheel3"],
                "colors": COLORS[:4],
                "title": "Reaction Wheel Speed",
                "ylabel": "rpm",
            },
            "Reaction wheel speed reconstructed from wheel momentum telemetry.",
        ),
    ]

    for filename, row_def, subtitle in plot_specs:
        make_figure(inout_dir / filename, row_def, sc_data, subtitle)
        generated.append(filename)

    thruster = discover_thruster_data(inout_dir)
    if thruster:
        make_thruster_figure(inout_dir / "gnc_thruster_output.png", thruster)
        generated.append("gnc_thruster_output.png")
    else:
        missing.append("gnc_thruster_output.png")

    mode_trace = discover_mode_trace(inout_dir)
    if mode_trace:
        make_mode_timeline(inout_dir / "gnc_mode_timeline.png", mode_trace)
        generated.append("gnc_mode_timeline.png")
    else:
        missing.append("gnc_mode_timeline.png")

    for name in generated:
        print(str(inout_dir / name))
    for name in missing:
        print(f"missing telemetry: {name}")


if __name__ == "__main__":
    main()
