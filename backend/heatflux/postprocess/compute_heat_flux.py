#!/usr/bin/env python3
"""Engineering reproduction of CATCH02 orbit heat-flux inputs.

The implementation is intentionally self-contained so it can run on a Linux
server without STK/GMAT licenses. It uses a circular 600 km orbit and a simple
Sun-synchronous local-time geometry to generate the same downstream products
requested from STK/GMAT/Orekit.
"""

from __future__ import annotations

import argparse
import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd


MU_EARTH = 3.986004418e14
R_EARTH = 6378137.0
ALTITUDE = 600_000.0
SOLAR_CONSTANT = 1361.0
ALBEDO = 0.30
EARTH_IR = 237.0
ALPHA = 0.20
EPSILON = 0.80
SSO_INCLINATION_DEG = 97.79

FACES = ["+X", "-X", "+Y", "-Y", "+Z", "-Z"]
SEASONS = [
    ("spring", "春分", 3, 21),
    ("summer", "夏至", 6, 21),
    ("autumn", "秋分", 9, 21),
    ("winter", "冬至", 12, 21),
]

REPORT_DAWN_DUSK = {
    "春分": [54.4, 186.5, 58.0, 60.4, 289.2, 44.5],
    "夏至": [49.6, 184.2, 58.1, 59.6, 279.5, 49.8],
    "秋分": [182.3, 51.4, 56.1, 61.9, 287.6, 46.9],
    "冬至": [193.4, 49.5, 59.4, 59.1, 295.5, 50.3],
}

REPORT_NOON = {
    "春分": [65.0, 142.6, 48.6, 52.5, 210.8, 69.5],
    "夏至": [61.7, 138.8, 52.5, 54.0, 202.3, 65.4],
    "秋分": [136.5, 61.3, 52.4, 53.6, 206.5, 66.9],
    "冬至": [147.7, 63.3, 49.5, 52.0, 213.3, 69.0],
}


@dataclass(frozen=True)
class Case:
    orbit_type: str
    season_key: str
    season_cn: str
    epoch: datetime
    ltan_hours: float


def unit(v: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.maximum(n, 1e-15)


def julian_day(dt: datetime) -> float:
    y = dt.year
    m = dt.month
    d = dt.day + (dt.hour + (dt.minute + dt.second / 60.0) / 60.0) / 24.0
    if m <= 2:
        y -= 1
        m += 12
    a = y // 100
    b = 2 - a + a // 4
    return int(365.25 * (y + 4716)) + int(30.6001 * (m + 1)) + d + b - 1524.5


def sun_vector_eci(dt: datetime) -> np.ndarray:
    """Approximate unit vector from Earth to Sun in J2000 ECI."""
    n = julian_day(dt) - 2451545.0
    mean_long = math.radians((280.460 + 0.9856474 * n) % 360.0)
    mean_anom = math.radians((357.528 + 0.9856003 * n) % 360.0)
    lam = mean_long + math.radians(1.915) * math.sin(mean_anom) + math.radians(0.020) * math.sin(2 * mean_anom)
    eps = math.radians(23.439 - 0.0000004 * n)
    return unit(np.array([math.cos(lam), math.cos(eps) * math.sin(lam), math.sin(eps) * math.sin(lam)]))


def orbit_basis(epoch: datetime, ltan_hours: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return RAAN basis p/q and orbit angular-momentum unit vector h.

    LTAN is represented by selecting the node direction relative to the Sun's
    right ascension. This is a standard first-order SSO local-time construction,
    not a high-fidelity precessing orbit propagator.
    """
    sun = sun_vector_eci(epoch)
    sun_ra = math.atan2(sun[1], sun[0])
    raan = sun_ra + math.pi - (ltan_hours - 12.0) * math.pi / 12.0
    inc = math.radians(SSO_INCLINATION_DEG)
    node = np.array([math.cos(raan), math.sin(raan), 0.0])
    h = np.array([math.sin(inc) * math.sin(raan), -math.sin(inc) * math.cos(raan), math.cos(inc)])
    h = unit(h)
    q = unit(np.cross(h, node))
    return node, q, h


def eclipse_mask(r_sat: np.ndarray, sun_hat: np.ndarray) -> np.ndarray:
    """Cylindrical Earth shadow test."""
    behind = np.einsum("ij,j->i", r_sat, sun_hat) < 0.0
    cross_track = np.linalg.norm(np.cross(r_sat, sun_hat), axis=1)
    return behind & (cross_track < R_EARTH)


def face_normals_lvlh(r_hat: np.ndarray, v_hat: np.ndarray, h_hat: np.ndarray) -> dict[str, np.ndarray]:
    """Report face convention used here.

    +Z is nadir-facing, -Z is zenith-facing, +X is along-track, -X is anti-track,
    +Y is orbit-normal, and -Y is anti-normal.
    """
    z_plus = -r_hat
    x_plus = v_hat
    y_plus = np.broadcast_to(h_hat, r_hat.shape)
    return {
        "+X": x_plus,
        "-X": -x_plus,
        "+Y": y_plus,
        "-Y": -y_plus,
        "+Z": z_plus,
        "-Z": -z_plus,
    }


def run_case(case: Case, outdir: Path, sample_step_s: int = 30) -> pd.DataFrame:
    radius = R_EARTH + ALTITUDE
    period = 2.0 * math.pi * math.sqrt(radius**3 / MU_EARTH)
    p, q, h = orbit_basis(case.epoch, case.ltan_hours)
    times = np.arange(0.0, period + sample_step_s, sample_step_s)
    theta = 2.0 * math.pi * times / period
    r_hat = np.outer(np.cos(theta), p) + np.outer(np.sin(theta), q)
    v_hat = -np.outer(np.sin(theta), p) + np.outer(np.cos(theta), q)
    r_sat = radius * r_hat

    sun_hat = sun_vector_eci(case.epoch)
    in_eclipse = eclipse_mask(r_sat, sun_hat)
    normals = face_normals_lvlh(r_hat, v_hat, h)

    earth_view_factor = 0.5 * (1.0 - np.sqrt(np.maximum(0.0, 1.0 - (R_EARTH / radius) ** 2)))
    sun_to_nadir = np.maximum(0.0, np.einsum("ij,j->i", -r_hat, sun_hat))
    earth_day_factor = 0.35 + 0.65 * sun_to_nadir

    rows = []
    for i, t in enumerate(times):
        row = {
            "orbit_type": case.orbit_type,
            "season": case.season_cn,
            "season_key": case.season_key,
            "epoch_utc": (case.epoch + timedelta(seconds=float(t))).isoformat(),
            "time_s": float(t),
            "in_eclipse": bool(in_eclipse[i]),
        }
        for face in FACES:
            n = normals[face][i]
            cos_sun = max(0.0, float(np.dot(n, sun_hat)))
            cos_earth = max(0.0, float(np.dot(n, -r_hat[i])))
            direct = ALPHA * SOLAR_CONSTANT * cos_sun * (0.0 if in_eclipse[i] else 1.0)
            albedo = ALPHA * SOLAR_CONSTANT * ALBEDO * earth_view_factor * cos_earth * earth_day_factor[i]
            infrared = EPSILON * EARTH_IR * earth_view_factor * cos_earth
            row[f"{face}_direct"] = direct
            row[f"{face}_albedo"] = albedo
            row[f"{face}_ir"] = infrared
            row[face] = direct + albedo + infrared
        rows.append(row)

    df = pd.DataFrame(rows)
    path = outdir / f"{case.orbit_type}_{case.season_key}_timeseries.csv"
    df.to_csv(path, index=False)
    return df


def make_markdown_table(df: pd.DataFrame) -> str:
    formatted = df.copy()
    for col in formatted.columns:
        if pd.api.types.is_float_dtype(formatted[col]):
            formatted[col] = formatted[col].map(lambda value: f"{value:.1f}")
    headers = list(formatted.columns)
    rows = formatted.astype(str).values.tolist()
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join(["---"] * len(headers)) + " |",
    ]
    lines.extend("| " + " | ".join(row) + " |" for row in rows)
    return "\n".join(lines)


def summary_table(cases: list[Case], outdir: Path) -> tuple[pd.DataFrame, pd.DataFrame, dict[str, pd.DataFrame]]:
    all_series: dict[str, pd.DataFrame] = {}
    rows = []
    for case in cases:
        df = run_case(case, outdir)
        all_series[f"{case.orbit_type}_{case.season_key}"] = df
        means = df[FACES].mean()
        row = {"名称": case.season_cn, "日期": f"{case.epoch.month}月{case.epoch.day}日"}
        row.update({face: means[face] for face in FACES})
        rows.append((case.orbit_type, row))

    dawn = pd.DataFrame([r for orbit, r in rows if orbit == "dawn_dusk"])
    noon = pd.DataFrame([r for orbit, r in rows if orbit == "noon"])
    return dawn, noon, all_series


def add_error_columns(table: pd.DataFrame, report: dict[str, list[float]]) -> pd.DataFrame:
    out = table.copy()
    for face_idx, face in enumerate(FACES):
        out[f"{face}_报告"] = out["名称"].map(lambda s: report[s][face_idx])
        out[f"{face}_偏差"] = out[face] - out[f"{face}_报告"]
    return out


def write_comparison(dawn: pd.DataFrame, noon: pd.DataFrame, results_dir: Path) -> None:
    dawn_err = add_error_columns(dawn, REPORT_DAWN_DUSK)
    noon_err = add_error_columns(noon, REPORT_NOON)
    lines = [
        "# CATCH02 外热流复现对比摘要",
        "",
        "## 工具运行状态",
        "",
        "- STK：当前 Linux 环境未发现 STK Desktop/Engine 或许可证，未能直接运行；已保留脚本目录和环境限制说明。",
        "- GMAT：当前环境未发现 GMAT 可执行文件，未能直接运行；已保留 GMAT 脚本骨架和说明。",
        "- Orekit/Python：使用自包含 Python 工程模型完成可复现计算；Java 可用，但未下载外部 Orekit data 包，因此未运行高保真 Orekit 传播。",
        "",
        "## 主计算口径",
        "",
        "- 轨道：600 km 圆轨道，按晨昏/正午太阳同步轨道的当地时近似构造轨道面。",
        "- 姿态：LVLH 固连；+Z 指向地心，-Z 指向天顶，+X 沿速度方向，-X 反速度方向，+Y 为轨道角动量方向。",
        "- 外热流：太阳直射、地球反照、地球红外；地影使用圆柱影判据。",
        "- 注意：报告 5.2 节的 `600 km、29° 倾角` 与 5.8 节太阳同步轨道口径不一致。本次主复现采用 5.8 节口径；未另做 29° 敏感性对比。",
        "",
        "## 与报告差异",
        "",
        "本结果是工程几何复现，不是 STK/GMAT/Orekit 高保真热分析。偏差主要来自姿态定义、反照模型、地球红外视因子、地影模型和太阳同步轨道当地时近似。",
        "",
        "### 晨昏轨道偏差 W/m^2",
        "",
        make_markdown_table(dawn_err[["名称"] + [f"{f}_偏差" for f in FACES]]),
        "",
        "### 正午轨道偏差 W/m^2",
        "",
        make_markdown_table(noon_err[["名称"] + [f"{f}_偏差" for f in FACES]]),
        "",
        "## 瞬态曲线趋势",
        "",
        "晨昏轨道四季瞬态图已输出至 `results/fig_5_5` 至 `fig_5_8`。曲线包含直射、反照和红外叠加后的六面总吸收热流，能够体现随轨道相位变化的周期性；由于报告原图数据点不可得，只做趋势级复现。",
        "",
    ]
    (results_dir / "comparison_summary.md").write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--year", type=int, default=2026)
    parser.add_argument("--results-dir", type=Path, default=Path("results"))
    parser.add_argument("--export-dir", type=Path, default=Path("orekit/exported_data"))
    args = parser.parse_args()

    args.results_dir.mkdir(parents=True, exist_ok=True)
    args.export_dir.mkdir(parents=True, exist_ok=True)
    cases: list[Case] = []
    for key, cn, month, day in SEASONS:
        epoch = datetime(args.year, month, day, tzinfo=timezone.utc)
        cases.append(Case("dawn_dusk", key, cn, epoch, 6.0))
        cases.append(Case("noon", key, cn, epoch, 12.0))

    dawn, noon, _ = summary_table(cases, args.export_dir)
    dawn.to_csv(args.results_dir / "table_5_6_reproduced.csv", index=False)
    noon.to_csv(args.results_dir / "table_5_7_reproduced.csv", index=False)
    (args.results_dir / "table_5_6_reproduced.md").write_text(make_markdown_table(dawn), encoding="utf-8")
    (args.results_dir / "table_5_7_reproduced.md").write_text(make_markdown_table(noon), encoding="utf-8")
    write_comparison(dawn, noon, args.results_dir)


if __name__ == "__main__":
    main()
