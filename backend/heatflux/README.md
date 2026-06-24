# CATCH02 Orbit Heat-Flux Reproduction

This workspace reproduces the external heat-flux inputs requested in
`catch02_orbit_heatflux_task.md`.

## Environment

```bash
conda env create -f environment.yml
conda activate heatflux-catch02
python postprocess/compute_heat_flux.py
python postprocess/plot_heat_flux.py
```

The current server already has Python, NumPy, pandas, SciPy, and Matplotlib in
the base conda environment. A dedicated environment file is still provided for
repeatable execution.

## Model Assumptions

- Satellite: 1 m cube.
- Surface solar absorptivity: `alpha = 0.2`.
- Surface infrared emissivity: `epsilon = 0.8`.
- Orbit: circular 600 km orbit.
- Main orbit interpretation: section 5.8 dawn-dusk and noon Sun-synchronous
  orbit cases.
- Inclination for the SSO approximation: `97.79 deg`.
- Solar constant: `1361 W/m^2`.
- Earth albedo: `0.30`.
- Earth infrared equivalent flux: `237 W/m^2`.
- Eclipse criterion: cylindrical Earth shadow.
- Attitude: LVLH fixed.
- Face convention:
  - `+Z`: nadir-facing.
  - `-Z`: zenith-facing.
  - `+X`: along-track.
  - `-X`: anti-track.
  - `+Y`: orbit-normal.
  - `-Y`: anti-normal.
- Average statistics: one complete orbit sampled every 30 s for each date.

The report also describes `600 km, 29 deg inclination, e < 0.003` in section
5.2. That is inconsistent with the section 5.8 Sun-synchronous wording. The
main reproduction uses the section 5.8 Sun-synchronous interpretation. A
separate 29 deg sensitivity case was not run because the requested deliverables
focus on the dawn-dusk/noon SSO heat-flux tables and dawn-dusk transient plots.

## Tool Status

- STK: not found on this Linux server; no STK license or Engine executable was
  detected. See `stk/scenario_or_scripts/README.md`.
- GMAT: not found on this Linux server. See `gmat/scripts/catch02_heatflux.script`
  for a script skeleton and `gmat/scripts/README.md`.
- Orekit: Java is available, but no local Orekit data directory or Orekit
  runtime was present. The repeatable baseline is implemented with Python in
  `postprocess/compute_heat_flux.py` and exports data to
  `data/heatflux/orekit/exported_data/`.

## Outputs

Baseline data is stored under `data/heatflux/` so backend workspace APIs can
use it as a shared reference data library.

- `orekit/exported_data/*_timeseries.csv`
- `results/table_5_6_reproduced.csv`
- `results/table_5_7_reproduced.csv`
- `results/table_5_6_reproduced.md`
- `results/table_5_7_reproduced.md`
- `results/fig_5_5_dawn_dusk_spring.png`
- `results/fig_5_6_dawn_dusk_summer.png`
- `results/fig_5_7_dawn_dusk_autumn.png`
- `results/fig_5_8_dawn_dusk_winter.png`
- `results/comparison_summary.md`
