import argparse
import math
import re
from pathlib import Path

import numpy as np
import pandas as pd
from PIL import Image, ImageDraw, ImageFont


R2D = 180.0 / math.pi
WHEEL_INERTIA = 0.00068209
FONT = ImageFont.load_default()


def q2c(q):
    # 42 writes quaternions as vector-first, scalar-last:
    # [q1, q2, q3, qs].  Keep the same convention here so the
    # reconstructed CBN matches the simulator's attitude math.
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
        m = re.fullmatch(r"Sc(\d+)\.csv", path.name)
        if m:
            indexed.append((int(m.group(1)), path))
    return indexed


def load_spacecraft(sc_idx, sc_path, inout_dir):
    sc = pd.read_csv(sc_path)
    time = sc.iloc[:, 0].to_numpy(dtype=float)
    qbn = sc[["Sc_qn_1", "Sc_qn_2", "Sc_qn_3", "Sc_qn_4"]].to_numpy(dtype=float)
    wbn = sc[["Sc_wn_1", "Sc_wn_2", "Sc_wn_3"]].to_numpy(dtype=float) * R2D
    posn = sc[["Sc_PosN_1", "Sc_PosN_2", "Sc_PosN_3"]].to_numpy(dtype=float)
    veln = sc[["Sc_VelN_1", "Sc_VelN_2", "Sc_VelN_3"]].to_numpy(dtype=float)

    euler_err = np.zeros((len(sc), 3), dtype=float)
    for i in range(len(sc)):
        cbn = q2c(qbn[i])
        cln = find_cln(posn[i], veln[i])
        cbl = cbn @ cln.T
        euler_err[i] = c2a_123(cbl)

    wheel_rpm = None
    wheel_time = time
    acwhl = inout_dir / f"AcWhl{sc_idx}.csv"
    if acwhl.exists():
        whl = pd.read_csv(acwhl)
        cols = [c for c in whl.columns if c.endswith("_H")]
        if cols:
            wheel_h = whl[cols].to_numpy(dtype=float)
            wheel_rpm = wheel_h / WHEEL_INERTIA * 60.0 / (2.0 * math.pi)
            wheel_time = whl.iloc[:, 0].to_numpy(dtype=float)
    else:
        hwhl = inout_dir / "Hwhl.42"
        t42 = inout_dir / "time.42"
        if sc_idx == 0 and hwhl.exists():
            wheel_h = np.loadtxt(hwhl, ndmin=2)
            wheel_rpm = wheel_h / WHEEL_INERTIA * 60.0 / (2.0 * math.pi)
            if t42.exists():
                wheel_time = np.loadtxt(t42, ndmin=1)
            else:
                wheel_time = np.arange(len(wheel_h), dtype=float)

    return {
        "sc_idx": sc_idx,
        "time": time,
        "wbn_deg_s": wbn,
        "euler_err_deg": euler_err,
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


def draw_panel(draw, rect, time, series, labels, colors, title, ylabel, ylims):
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
        if tmax >= 3600.0:
            lab = f"{xv/3600.0:.1f}h"
        elif tmax >= 60.0:
            lab = f"{xv/60.0:.0f}m"
        else:
            lab = f"{xv:.0f}s"
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
        draw.line(pts, fill=color, width=2)
        lx = right - 150
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--inout", required=True, help="Path to runtime InOut directory")
    args = parser.parse_args()

    inout_dir = Path(args.inout).resolve()
    sc_files = discover_sc_files(inout_dir)
    if not sc_files:
        raise SystemExit(f"No Sc*.csv files found under {inout_dir}")

    sc_data = [load_spacecraft(sc_idx, path, inout_dir) for sc_idx, path in sc_files[:2]]

    make_figure(
        inout_dir / "gnc_body_angular_velocity_xyz.png",
        {
            "key": "wbn_deg_s",
            "labels": ["wx", "wy", "wz"],
            "colors": ["#0066cc", "#d9480f", "#2b8a3e"],
            "title": "Body Angular Velocity",
            "ylabel": "deg/s",
        },
        sc_data,
        "Three-axis spacecraft body angular velocity.",
    )

    make_figure(
        inout_dir / "gnc_orbit_attitude_error_xyz.png",
        {
            "key": "euler_err_deg",
            "labels": ["roll", "pitch", "yaw"],
            "colors": ["#0066cc", "#d9480f", "#2b8a3e"],
            "title": "Orbit-frame Attitude Error",
            "ylabel": "deg",
        },
        sc_data,
        "Orbit-frame attitude error using 42 Euler-123 convention.",
    )

    make_figure(
        inout_dir / "gnc_reaction_wheel_speed.png",
        {
            "key": "wheel_rpm",
            "labels": ["wheel0", "wheel1", "wheel2", "wheel3"],
            "colors": ["#0066cc", "#d9480f", "#2b8a3e", "#7b2cbf"],
            "title": "Reaction Wheel Speed",
            "ylabel": "rpm",
        },
        sc_data,
        "Reaction wheel speed reconstructed from wheel momentum telemetry.",
    )

    print(str(inout_dir / "gnc_body_angular_velocity_xyz.png"))
    print(str(inout_dir / "gnc_orbit_attitude_error_xyz.png"))
    print(str(inout_dir / "gnc_reaction_wheel_speed.png"))


if __name__ == "__main__":
    main()
