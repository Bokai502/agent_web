import type { TFunction } from "i18next"

export type WorkspaceProgressResponse = {
  exists?: boolean
  data?: unknown
  source_path?: string | null
  source_version?: string | null
  updated_at?: string | null
}

export type WorkflowLoopProgressEntry = {
  completed: boolean
  key: string
  label: string
  percent: number
  statusLabel: string
  status: "running" | "completed" | "failed" | "pending" | "unknown"
}

export type WorkflowProgressVariant = "thermal" | "gnc" | "check"

const THERMAL_WORKFLOW_PROGRESS_STAGES = [
  { key: "create_cad", labelKey: "workspace.progress.createCad" },
  { key: "simulation", labelKey: "workspace.progress.simulationRun" },
  { key: "cad_sim_report", labelKey: "workspace.progress.cadSimReport" },
]

const GNC_WORKFLOW_PROGRESS_STAGES = [
  { key: "requirement_analysis", labelKey: "workspace.progress.gncRequirementAnalysis" },
  { key: "architecture_generation", labelKey: "workspace.progress.gncArchitectureGeneration" },
  { key: "parameter_configuration", labelKey: "workspace.progress.gncParameterConfiguration" },
  { key: "control_law_design", labelKey: "workspace.progress.gncControlLawDesign" },
  { key: "simulation_plan", labelKey: "workspace.progress.gncSimulationPlan" },
  { key: "verification_plan", labelKey: "workspace.progress.gncVerificationPlan" },
  { key: "document_generation", labelKey: "workspace.progress.gncDocumentGeneration" },
]

const CHECK_WORKFLOW_PROGRESS_STAGES = [
  { key: "check_convert_table", labelKey: "workspace.progress.checkConvertTable" },
  { key: "check_ai_mapping", labelKey: "workspace.progress.checkAiMapping" },
  { key: "check_rule_analysis", labelKey: "workspace.progress.checkRuleAnalysis" },
]

function getWorkflowProgressStages(variant: WorkflowProgressVariant) {
  if (variant === "gnc") return GNC_WORKFLOW_PROGRESS_STAGES
  if (variant === "check") return CHECK_WORKFLOW_PROGRESS_STAGES
  return THERMAL_WORKFLOW_PROGRESS_STAGES
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizePercent(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0
  const percent = value <= 1 && value >= 0 ? value * 100 : value
  return Math.max(0, Math.min(100, Math.round(percent)))
}

function normalizeLoopStatus(value: unknown, completed: boolean): WorkflowLoopProgressEntry["status"] {
  if (typeof value !== "string") return completed ? "completed" : "pending"
  const normalized = value.toLowerCase()
  if (normalized.includes("fail") || normalized.includes("error")) return "failed"
  if (normalized.includes("complete") || normalized.includes("success")) return "completed"
  if (normalized.includes("run") || normalized.includes("progress") || normalized.endsWith("_running")) return "running"
  if (normalized.includes("pending") || normalized.includes("wait")) return "pending"
  return completed ? "completed" : "unknown"
}

function getRawStatus(value: unknown, completed: boolean) {
  return typeof value === "string" && value.trim() ? value.trim() : completed ? "completed" : "pending"
}

function getStatusLabel(rawStatus: string, fallbackStatus: WorkflowLoopProgressEntry["status"], t: TFunction) {
  return t(`workspace.progress.rawStatus.${rawStatus}`, {
    defaultValue: t(`workspace.progress.status.${fallbackStatus}`),
  })
}

export function getWorkflowLoopProgressEntries(data: unknown, t: TFunction, variant: WorkflowProgressVariant = "thermal"): WorkflowLoopProgressEntry[] {
  const loops = isRecord(data) && data.schema_version === "loop_progress/1.0" && isRecord(data.loops)
    ? data.loops
    : {}

  return getWorkflowProgressStages(variant).map(stage => {
    const loop = loops[stage.key]
    const loopData = isRecord(loop) ? loop : null
    const completed = loopData?.completed === true
    const rawStatus = loopData ? getRawStatus(loopData.status, completed) : "pending"
    const status = loopData ? normalizeLoopStatus(loopData.status, completed) : "pending"
    return {
      completed,
      key: stage.key,
      label: t(stage.labelKey),
      percent: normalizePercent(loopData?.percentage),
      status,
      statusLabel: getStatusLabel(rawStatus, status, t),
    }
  })
}

export function formatProgressUpdatedAt(progressData: WorkspaceProgressResponse | null, language: string, t: TFunction) {
  const rawUpdatedAt = progressData?.updated_at ??
    (isRecord(progressData?.data) && typeof progressData.data.updated_at === "string"
      ? progressData.data.updated_at
      : null)
  if (!rawUpdatedAt) return t("workspace.inspector.waitingUpdate")

  const parsed = new Date(rawUpdatedAt)
  if (Number.isNaN(parsed.getTime())) return rawUpdatedAt
  return parsed.toLocaleString(language.startsWith("en") ? "en-US" : "zh-CN")
}
