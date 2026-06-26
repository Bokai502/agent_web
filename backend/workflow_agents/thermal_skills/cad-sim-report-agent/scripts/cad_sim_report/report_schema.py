from __future__ import annotations


REPORT_SECTION_KEYS = [
    "model_section",
    "thermal_results_section",
    "temperature_images_section",
    "validity_section",
    "solver_section",
    "recommendations_section",
    "conclusion_section",
]
SECTION_CHAPTERS = {
    "model_section": 1,
    "validity_section": 1,
    "thermal_results_section": 2,
    "temperature_images_section": 2,
    "conclusion_section": 3,
}
ALLOWED_FIELD_REFS = [
    "cad_validation.status",
    "cad_validation.bbox_overlap_count",
    "cad_validation.contact_failure_count",
    "components.simulation_components",
    "components.registry_entities",
    "components.heat_source_count",
    "components.total_power_W",
    "components.install_face_count",
    "components.shell_count",
    "components.cabin_count",
    "field_stats.count",
    "field_stats.valid_count",
    "field_stats.nan_count",
    "field_stats.min_K",
    "field_stats.max_K",
    "field_stats.mean_K",
    "status_summary.stage",
    "status_summary.ok",
    "screenshots",
    "postprocess_images",
    "paraview_summary.temperature.num_points",
    "paraview_summary.temperature.num_cells",
    "metrics_summary.anomaly_count",
]
