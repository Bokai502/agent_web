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
  rawStatus: string
  statusLabel: string
  status: "running" | "completed" | "failed" | "blocked" | "pending" | "unknown"
  updatedAt?: string | null
}

export type WorkflowProgressVariant = "thermal" | "gnc" | "check"

export type WorkflowProgressSummary = {
  activeKey?: string | null
  activeLabel?: string | null
  percentage: number
  status: WorkflowLoopProgressEntry["status"]
  statusLabel: string
  total: number
  completed: number
  failed: number
  running: number
  pending: number
  blocked: number
}

const THERMAL_WORKFLOW_PROGRESS_STAGES = [
  { key: "__planning__", labelKey: "workspace.progress.planning" },
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

const GNC_AIGNC_STAGE_ALIASES: Record<string, string[]> = {
  requirement_analysis: ["01_inputs", "02_scenario"],
  architecture_generation: ["03_capability"],
  parameter_configuration: ["04_config"],
  control_law_design: ["05_fsw_requirements", "06_fsw_architecture", "07_fsw_implementation"],
  simulation_plan: ["08_run"],
  verification_plan: ["09_audit", "09_tuning_review"],
  document_generation: ["10_reports"],
}

const CHECK_WORKFLOW_PROGRESS_STAGES = [
  { key: "check_compliance_prepare", labelKey: "workspace.progress.checkCompliancePrepare" },
  { key: "check_compliance_interpret", labelKey: "workspace.progress.checkComplianceInterpret" },
  { key: "check_compliance_checks", labelKey: "workspace.progress.checkComplianceChecks" },
  { key: "check_compliance_report", labelKey: "workspace.progress.checkComplianceReport" },
]

const CHECK_STAGE_ALIASES: Record<string, string[]> = {
  check_compliance_prepare: ["check_compliance_load_inputs"],
  check_compliance_interpret: [
    "check_compliance_analysis",
    "check_compliance_classification",
  ],
  check_compliance_checks: [
    "check_convert_table",
    "check_ai_mapping",
    "check_rule_analysis",
    "check_mapping_completeness",
  ],
}

function getWorkflowProgressStages(variant: WorkflowProgressVariant) {
  if (variant === "gnc") return GNC_WORKFLOW_PROGRESS_STAGES
  if (variant === "check") return CHECK_WORKFLOW_PROGRESS_STAGES
  return THERMAL_WORKFLOW_PROGRESS_STAGES
}

function getLoopLabel(loopKey: string, loop: Record<string, unknown> | null, t: TFunction) {
  const title = getStringField(loop, "title")
  if (title) return title
  return t(`workspace.progress.nodes.${loopKey}`, { defaultValue: loopKey })
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
  if (normalized.includes("block")) return "blocked"
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

function getStringField(record: Record<string, unknown> | null, field: string) {
  const value = record?.[field]
  return typeof value === "string" ? value : ""
}

function getNumberField(record: Record<string, unknown> | null, field: string) {
  const value = record?.[field]
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function getLoopStage(loopData: Record<string, unknown> | null) {
  const input = isRecord(loopData?.input) ? loopData.input : null
  return getStringField(loopData, "stage") || getStringField(input, "stage")
}

function loopMatchesStage(
  loopKey: string,
  loopData: Record<string, unknown> | null,
  stageKey: string,
  variant: WorkflowProgressVariant,
  includeAliases: boolean,
) {
  if (loopKey === stageKey) return true
  if (!includeAliases) return false
  if (variant === "check") {
    return (CHECK_STAGE_ALIASES[stageKey] ?? []).includes(loopKey)
  }
  if (variant !== "gnc") return false

  const aliases = GNC_AIGNC_STAGE_ALIASES[stageKey] ?? []
  const loopStage = getLoopStage(loopData)
  return aliases.some(alias => loopStage === alias || loopKey.startsWith(`${alias}_`))
}

function statusPriority(status: WorkflowLoopProgressEntry["status"]) {
  switch (status) {
    case "failed": return 5
    case "blocked": return 4
    case "running": return 3
    case "unknown": return 2
    case "pending": return 1
    case "completed": return 0
  }
}

function buildLoopProgressEntry(
  stage: { key: string; labelKey: string },
  matchingLoops: unknown[],
  t: TFunction,
): WorkflowLoopProgressEntry {
  let selectedLoop: Record<string, unknown> | null = null
  let selectedStatus: WorkflowLoopProgressEntry["status"] = "pending"
  let selectedRawStatus = "pending"
  let percent = 0

  for (const loop of matchingLoops) {
    if (!isRecord(loop)) continue
    const completed = loop.completed === true
    const rawStatus = getRawStatus(loop.status, completed)
    const status = normalizeLoopStatus(loop.status, completed)
    const loopPercent = normalizePercent(loop.percentage)
    const shouldSelect = !selectedLoop ||
      statusPriority(status) > statusPriority(selectedStatus) ||
      (statusPriority(status) === statusPriority(selectedStatus) && loopPercent >= percent)

    percent = Math.max(percent, loopPercent)
    if (shouldSelect) {
      selectedLoop = loop
      selectedStatus = status
      selectedRawStatus = rawStatus
    }
  }

  const completed = matchingLoops.length > 0 && matchingLoops.every(loop => isRecord(loop) && loop.completed === true)
  const displayStatus = completed && statusPriority(selectedStatus) < statusPriority("running")
    ? "completed"
    : selectedStatus
  const displayRawStatus = displayStatus === "completed" ? "completed" : selectedRawStatus
  return {
    completed,
    key: stage.key,
    label: t(stage.labelKey),
    percent,
    rawStatus: displayRawStatus,
    status: displayStatus,
    statusLabel: getStatusLabel(displayStatus === "completed" ? selectedRawStatus : displayRawStatus, displayStatus, t),
    updatedAt: getStringField(selectedLoop, "updated_at") || null,
  }
}

export function getWorkflowLoopProgressEntries(data: unknown, t: TFunction, variant: WorkflowProgressVariant = "thermal"): WorkflowLoopProgressEntry[] {
  const loops = isRecord(data) && data.schema_version === "loop_progress/1.0" && isRecord(data.loops)
    ? data.loops
    : {}

  if (variant === "thermal") {
    const loopEntries = Object.entries(loops)
      .filter(([, loop]) => isRecord(loop))
      .map(([loopKey, loop]) => {
        const loopRecord = isRecord(loop) ? loop : null
        const completed = loopRecord?.completed === true
        const rawStatus = getRawStatus(loopRecord?.status, completed)
        const status = normalizeLoopStatus(loopRecord?.status, completed)
        return {
          completed,
          key: loopKey,
          label: getLoopLabel(loopKey, loopRecord, t),
          percent: normalizePercent(loopRecord?.percentage),
          rawStatus,
          status,
          statusLabel: getStatusLabel(rawStatus, status, t),
          updatedAt: getStringField(loopRecord, "updated_at") || null,
        }
      })
    if (loopEntries.length > 0) return loopEntries
  }

  return getWorkflowProgressStages(variant).map(stage => {
    const loopEntries = Object.entries(loops)
    const exactLoops = loopEntries
      .filter(([loopKey, loop]) => loopMatchesStage(loopKey, isRecord(loop) ? loop : null, stage.key, variant, false))
      .map(([, loop]) => loop)
    const matchingLoops = exactLoops.length > 0
      ? exactLoops
      : loopEntries
        .filter(([loopKey, loop]) => loopMatchesStage(loopKey, isRecord(loop) ? loop : null, stage.key, variant, true))
        .map(([, loop]) => loop)
    return buildLoopProgressEntry(stage, matchingLoops, t)
  })
}

export function getWorkflowProgressSummary(
  data: unknown,
  entries: WorkflowLoopProgressEntry[],
  t: TFunction,
): WorkflowProgressSummary {
  const summary = isRecord(data) && isRecord(data.summary) ? data.summary : null
  const activeLoop = isRecord(summary?.active_loop) ? summary.active_loop : null
  const summaryStatus = normalizeLoopStatus(summary?.status, false)
  const summaryPercent = normalizePercent(summary?.percentage)
  const activeKey = getStringField(activeLoop, "key")
  const summaryActiveEntry = activeKey ? entries.find(item => item.key === activeKey) : null

  if (summary) {
    const status = summaryStatus === "unknown" ? "pending" : summaryStatus
    return {
      activeKey: activeKey || null,
      activeLabel: summaryActiveEntry?.label ?? null,
      percentage: summaryPercent,
      status,
      statusLabel: summaryActiveEntry
        ? `${summaryActiveEntry.label} · ${summaryActiveEntry.statusLabel}`
        : getStatusLabel(getStringField(activeLoop, "status_label") || getStringField(summary, "status") || status, status, t),
      total: getNumberField(summary, "total") ?? entries.length,
      completed: getNumberField(summary, "completed") ?? entries.filter(item => item.status === "completed").length,
      failed: getNumberField(summary, "failed") ?? entries.filter(item => item.status === "failed").length,
      running: getNumberField(summary, "running") ?? entries.filter(item => item.status === "running").length,
      pending: getNumberField(summary, "pending") ?? entries.filter(item => item.status === "pending").length,
      blocked: getNumberField(summary, "blocked") ?? entries.filter(item => item.status === "blocked").length,
    }
  }

  const activeEntry = entries.find(item => item.status === "running")
    ?? entries.find(item => item.status === "failed")
    ?? entries.find(item => item.status === "blocked")
    ?? entries.find(item => item.percent < 100)
    ?? entries[entries.length - 1]
  const percentage = entries.length > 0
    ? Math.round(entries.reduce((total, item) => total + item.percent, 0) / entries.length)
    : 0
  const status = entries.some(item => item.status === "failed")
    ? "failed"
    : entries.some(item => item.status === "blocked")
      ? "blocked"
      : entries.some(item => item.status === "running")
        ? "running"
        : entries.length > 0 && entries.every(item => item.completed)
          ? "completed"
          : "pending"

  return {
    activeKey: activeEntry?.key ?? null,
    activeLabel: activeEntry?.label ?? null,
    percentage,
    status,
    statusLabel: activeEntry ? `${activeEntry.label} · ${activeEntry.statusLabel}` : t("workspace.inspector.waitingUpdate"),
    total: entries.length,
    completed: entries.filter(item => item.status === "completed").length,
    failed: entries.filter(item => item.status === "failed").length,
    running: entries.filter(item => item.status === "running").length,
    pending: entries.filter(item => item.status === "pending").length,
    blocked: entries.filter(item => item.status === "blocked").length,
  }
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
