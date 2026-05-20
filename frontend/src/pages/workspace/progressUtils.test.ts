import { describe, expect, it } from "vitest"
import i18n from "../../i18n"
import {
  getProgressEntries,
  getProgressFiles,
  getViewerGlbPath,
  getWorkflowProgressEntries,
} from "./progressUtils"

describe("progressUtils", () => {
  it("parses the pipeline progress file with nested FreeCAD outputs", () => {
    const data = {
      schema_version: "1.0",
      total_steps: 8,
      overall_percent: 87.5,
      steps: [
        { command_name: "layout-generate", stage_name: "layout_generate", index: 1, status: "pending", percent: 0 },
        {
          command_name: "geometry-edit",
          stage_name: "geometry_validate",
          index: 2,
          status: "completed",
          percent: 100,
          freecad_progress: {
            success: true,
            progress_percentages: {
              layout_completion_percent: 100,
              modeling_percent: 100,
              export_file_percent: 100,
            },
            output_files: {
              step: { path: "/workspace/02_geometry_edit/geometry_after.step", exists: true },
              glb: { path: "/workspace/02_geometry_edit/geometry_after.glb", exists: true },
            },
          },
        },
        { command_name: "simulation", stage_name: "simulation_run", index: 3, status: "completed", percent: 100 },
        { command_name: "field-export", stage_name: "field_export", index: 4, status: "completed", percent: 100 },
        { command_name: "postprocess", stage_name: "postprocess", index: 5, status: "completed", percent: 100 },
        { command_name: "case-build", stage_name: "case_build", index: 6, status: "completed", percent: 100 },
        { command_name: "analysis", stage_name: "analysis", index: 7, status: "completed", percent: 100 },
        { command_name: "suggestion", stage_name: "suggestion", index: 8, status: "completed", percent: 100 },
      ],
      freecad_progress: {
        success: true,
        output_files: {
          glb: { path: "/workspace/02_geometry_edit/geometry_after.glb", exists: true },
        },
      },
    }

    const entries = getProgressEntries(data, i18n.t)
    const workflowEntries = getWorkflowProgressEntries(entries, i18n.t)
    const progressFiles = getProgressFiles(data)

    expect(workflowEntries).toHaveLength(8)
    expect(workflowEntries.map(entry => entry.key)).toEqual([
      "modeling",
      "validation",
      "simulation_run",
      "field_export",
      "postprocess",
      "case_build",
      "analysis",
      "suggestion",
    ])
    expect(workflowEntries.find(entry => entry.key === "modeling")?.percent).toBe(100)
    expect(progressFiles).toContain("/workspace/02_geometry_edit/geometry_after.glb")
    expect(getViewerGlbPath(progressFiles)).toBe("/workspace/02_geometry_edit/geometry_after.glb")
  })

  it("keeps simulation and downstream pipeline stages when present", () => {
    const entries = getWorkflowProgressEntries(getProgressEntries({
      schema_version: "1.0",
      total_steps: 8,
      overall_percent: 62.5,
      steps: [
        { command_name: "layout-generate", stage_name: "layout_generate", percent: 100 },
        { command_name: "geometry-edit", stage_name: "geometry_validate", percent: 100 },
        { command_name: "simulation", stage_name: "simulation_run", percent: 100 },
        { command_name: "field-export", stage_name: "field_export", percent: 100 },
        { command_name: "postprocess", stage_name: "postprocess", percent: 100 },
        { command_name: "case-build", stage_name: "case_build", percent: 0 },
        { command_name: "analysis", stage_name: "analysis", percent: 0 },
        { command_name: "suggestion", stage_name: "suggestion", percent: 0 },
      ],
    }, i18n.t), i18n.t)

    expect(Object.fromEntries(entries.map(entry => [entry.key, entry.percent]))).toMatchObject({
      modeling: 100,
      validation: 0,
      simulation_run: 100,
      field_export: 100,
      postprocess: 100,
      case_build: 0,
      analysis: 0,
      suggestion: 0,
    })
  })

  it("keeps top-level CAD progress while simulation steps are running", () => {
    const entries = getWorkflowProgressEntries(getProgressEntries({
      schema_version: "freecad_progress/1.0",
      workflow: "simulation",
      stage: "simulation",
      status: "running",
      overall_percent: 16,
      modeling_percent: 100,
      export_file_percent: 100,
      validation_percent: 100,
      steps: [
        { command_name: "simulation", stage_name: "simulation_run", percent: 80 },
        { command_name: "field_export", stage_name: "field_export", percent: 0 },
        { command_name: "postprocess", stage_name: "postprocess", percent: 0 },
        { command_name: "case_build", stage_name: "case_build", percent: 0 },
        { command_name: "analysis", stage_name: "analysis", percent: 0 },
      ],
    }, i18n.t), i18n.t)

    expect(Object.fromEntries(entries.map(entry => [entry.key, entry.percent]))).toMatchObject({
      modeling: 100,
      validation: 100,
      simulation_run: 80,
      field_export: 0,
      postprocess: 0,
      case_build: 0,
      analysis: 0,
    })
  })
})
