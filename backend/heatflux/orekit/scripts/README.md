# Orekit Execution Note

Java is available on this server, but no local Orekit runtime/data directory was
present. The reproducible baseline therefore uses a self-contained Python
implementation of the same engineering geometry and writes its CSV output to
`data/input_data/thermal_catch/00_inputs/heatflux/orekit/exported_data/`.

A full Orekit implementation should initialize an `orekit-data` directory,
construct the same 600 km SSO dawn-dusk/noon cases, propagate each date for one
orbit or 24 h, and export position, velocity, Sun direction, eclipse state, and
face incidence quantities for postprocessing.
