import { describe, expect, it } from "vitest"
import i18n from "../../i18n"
import { getWorkflowLoopProgressEntries } from "./progressUtils"

describe("progressUtils", () => {
  it("initializes the three current workflow stages", () => {
    const entries = getWorkflowLoopProgressEntries(null, i18n.t)

    expect(entries.map(entry => entry.key)).toEqual(["create_cad", "simulation", "cad_sim_report"])
    expect(entries.map(entry => entry.percent)).toEqual([0, 0, 0])
    expect(entries.map(entry => entry.status)).toEqual(["pending", "pending", "pending"])
  })

  it("reads current loop progress from logs/progress.json", () => {
    const entries = getWorkflowLoopProgressEntries({
      schema_version: "loop_progress/1.0",
      loops: {
        create_cad: { status: "completed", completed: true, percentage: 100 },
        simulation: { status: "running", completed: false, percentage: 42 },
        cad_sim_report: { status: "failed", completed: true, percentage: 100 },
      },
    }, i18n.t)

    expect(Object.fromEntries(entries.map(entry => [entry.key, entry.percent]))).toEqual({
      create_cad: 100,
      simulation: 42,
      cad_sim_report: 100,
    })
    expect(Object.fromEntries(entries.map(entry => [entry.key, entry.status]))).toEqual({
      create_cad: "completed",
      simulation: "running",
      cad_sim_report: "failed",
    })
  })

  it("shows detailed simulation sub-status labels", () => {
    const entries = getWorkflowLoopProgressEntries({
      schema_version: "loop_progress/1.0",
      loops: {
        simulation: { status: "field_export_running", completed: false, percentage: 70 },
      },
    }, i18n.t)

    const simulation = entries.find(entry => entry.key === "simulation")
    expect(simulation?.status).toBe("running")
    expect(simulation?.statusLabel).toBe("场数据导出中")
  })

  it("shows config-editor progress as the first half of create CAD", () => {
    const entries = getWorkflowLoopProgressEntries({
      schema_version: "loop_progress/1.0",
      loops: {
        create_cad: { status: "config_editor_completed", completed: false, percentage: 50 },
      },
    }, i18n.t)

    const createCad = entries.find(entry => entry.key === "create_cad")
    expect(createCad?.percent).toBe(50)
    expect(createCad?.status).toBe("completed")
    expect(createCad?.statusLabel).toBe("方案配置已更新")
  })

  it("shows config-editor failures without forcing create CAD to 100 percent", () => {
    const entries = getWorkflowLoopProgressEntries({
      schema_version: "loop_progress/1.0",
      loops: {
        create_cad: { status: "config_editor_failed", completed: false, percentage: 50 },
      },
    }, i18n.t)

    const createCad = entries.find(entry => entry.key === "create_cad")
    expect(createCad?.percent).toBe(50)
    expect(createCad?.status).toBe("failed")
    expect(createCad?.statusLabel).toBe("方案配置需处理")
  })

  it("maps AIGNC numbered stages to the GNC progress rows", () => {
    const entries = getWorkflowLoopProgressEntries({
      schema_version: "loop_progress/1.0",
      loops: {
        "02_scenario_aignc-42-orchestrator": {
          completed: false,
          percentage: 20,
          stage: "02_scenario",
          status: "blocked",
        },
        "02_scenario_aignc-scenario-brainstorm": {
          completed: false,
          percentage: 65,
          stage: "02_scenario",
          status: "blocked",
        },
      },
    }, i18n.t, "gnc")

    const requirementAnalysis = entries.find(entry => entry.key === "requirement_analysis")
    expect(requirementAnalysis?.percent).toBe(65)
    expect(requirementAnalysis?.status).toBe("blocked")
    expect(requirementAnalysis?.statusLabel).toBe("阻塞")
  })
})
