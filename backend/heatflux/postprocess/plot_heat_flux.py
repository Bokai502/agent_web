#!/usr/bin/env python3
"""Plot CATCH02 dawn-dusk transient heat-flux curves."""

from __future__ import annotations

import argparse
from pathlib import Path

import matplotlib.pyplot as plt
import pandas as pd


FACES = ["+X", "-X", "+Y", "-Y", "+Z", "-Z"]
FIG_MAP = {
    "spring": ("fig_5_5_dawn_dusk_spring.png", "Fig. 5-5 Dawn-dusk Spring Heat Flux"),
    "summer": ("fig_5_6_dawn_dusk_summer.png", "Fig. 5-6 Dawn-dusk Summer Heat Flux"),
    "autumn": ("fig_5_7_dawn_dusk_autumn.png", "Fig. 5-7 Dawn-dusk Autumn Heat Flux"),
    "winter": ("fig_5_8_dawn_dusk_winter.png", "Fig. 5-8 Dawn-dusk Winter Heat Flux"),
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--export-dir", type=Path, default=Path("orekit/exported_data"))
    parser.add_argument("--results-dir", type=Path, default=Path("results"))
    args = parser.parse_args()
    args.results_dir.mkdir(parents=True, exist_ok=True)

    plt.rcParams["font.family"] = "sans-serif"
    plt.rcParams["font.sans-serif"] = ["DejaVu Sans"]
    plt.rcParams["axes.unicode_minus"] = False
    for season, (filename, title) in FIG_MAP.items():
        csv_path = args.export_dir / f"dawn_dusk_{season}_timeseries.csv"
        df = pd.read_csv(csv_path)
        fig, ax = plt.subplots(figsize=(10, 5.8), dpi=160)
        x = df["time_s"] / 60.0
        for face in FACES:
            ax.plot(x, df[face], linewidth=1.7, label=face)
        ax.set_title(title)
        ax.set_xlabel("Orbit time / min")
        ax.set_ylabel("Absorbed heat flux / W m$^{-2}$")
        ax.grid(True, alpha=0.3)
        ax.legend(ncol=3, frameon=True)
        fig.tight_layout()
        fig.savefig(args.results_dir / filename)
        plt.close(fig)


if __name__ == "__main__":
    main()
