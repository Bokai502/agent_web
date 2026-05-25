import type { TFunction } from "i18next"
import type { ThreadEvent, Turn } from "../../types"

export type WorkspaceProgressResponse = {
  exists?: boolean
  data?: unknown
  source_path?: string | null
  source_version?: string | null
  updated_at?: string | null
}

export type ProgressEntry = {
  fileNames: string[]
  key: string
  label: string
  percent: number
}

const LEGACY_CAD_PROGRESS_KEY = ["free", "cad_progress"].join("")

const WORKFLOW_PROGRESS_STAGES: ProgressEntry[] = [
  { fileNames: [], key: "modeling", label: "workspace.progress.modeling", percent: 0 },
  { fileNames: [], key: "validation", label: "workspace.progress.validation", percent: 0 },
  { fileNames: [], key: "simulation_run", label: "workspace.progress.simulationRun", percent: 0 },
  { fileNames: [], key: "field_export", label: "workspace.progress.fieldExport", percent: 0 },
  { fileNames: [], key: "postprocess", label: "workspace.progress.postprocess", percent: 0 },
  { fileNames: [], key: "case_build", label: "workspace.progress.caseBuild", percent: 0 },
  { fileNames: [], key: "analysis", label: "workspace.progress.analysis", percent: 0 },
  { fileNames: [], key: "suggestion", label: "workspace.progress.suggestion", percent: 0 },
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function progressLabel(key: string, t: TFunction) {
  const normalized = key.toLowerCase().replace(/[\s_-]+/gu, "")
  const labels: Record<string, string> = {
    layoutcompletionpercent: t("workspace.progress.layoutComplete"),
    layout: t("workspace.progress.layout"),
    layoutpercent: t("workspace.progress.layout"),
    topology: t("workspace.progress.topology"),
    bom: "BOM",
    geometry: t("workspace.progress.geometry"),
    modeling: t("workspace.progress.modeling"),
    modelingpercent: t("workspace.progress.modeling"),
    model: t("workspace.progress.modeling"),
    build: t("workspace.progress.modeling"),
    assembly: t("workspace.progress.assembly"),
    replacement: t("workspace.progress.replacement"),
    export: t("workspace.progress.export"),
    exportfilepercent: t("workspace.progress.exportFile"),
    exportpercent: t("workspace.progress.export"),
    glb: "GLB",
    step: "STEP",
    preview: t("workspace.progress.preview"),
    validation: t("workspace.progress.validation"),
    validationpercent: t("workspace.progress.validation"),
    simulation: t("workspace.progress.simulationRun"),
    postprocess: t("workspace.progress.postprocess"),
    analysis: t("workspace.progress.analysis"),
  }
  return labels[normalized] ?? key
}

function normalizeProgressKey(key: string) {
  const normalized = key.toLowerCase().replace(/[\s_-]+/gu, "")
  const aliases: Record<string, string> = {
    layoutcompletionpercent: "layout",
    layoutpercent: "layout",
    layoutgenerate: "layout",
    layoutgeneratebom: "layout",
    modeling: "modeling",
    modelingpercent: "modeling",
    model: "modeling",
    geometry: "modeling",
    geometryedit: "modeling",
    geometryvalidate: "modeling",
    export: "export_file_percent",
    exportfilepercent: "export_file_percent",
    exportpercent: "export_file_percent",
    validationpercent: "validation",
    cadvalidation: "validation",
    casebuild: "case_build",
    simulation: "simulation_run",
    simulationrun: "simulation_run",
    fieldexport: "field_export",
    postprocess: "postprocess",
    analysis: "analysis",
    suggestion: "suggestion",
  }
  return aliases[normalized] ?? key
}

function splitSimulationLoopPercentage(value: number) {
  const percent = Math.max(0, Math.min(100, value))
  const ranges = [
    { key: "simulation_run", start: 0, end: 70 },
    { key: "field_export", start: 70, end: 80 },
    { key: "postprocess", start: 80, end: 90 },
    { key: "case_build", start: 90, end: 96 },
    { key: "analysis", start: 96, end: 100 },
  ]
  return ranges.map(range => {
    const span = range.end - range.start
    const stagePercent = span <= 0
      ? 0
      : Math.max(0, Math.min(100, ((percent - range.start) / span) * 100))
    return { key: range.key, percent: Math.round(stagePercent) }
  })
}

function getLoopProgressEntries(data: Record<string, unknown>, t: TFunction): ProgressEntry[] | null {
  if (data.schema_version !== "loop_progress/1.0" || !isRecord(data.loops)) return null
  const entries: ProgressEntry[] = []
  const createCad = data.loops.create_cad
  const modifyCad = data.loops.modify_cad
  const cadLoop = isRecord(createCad) ? createCad : isRecord(modifyCad) ? modifyCad : null
  if (cadLoop) {
    const cadPercent = normalizePercent(cadLoop.percentage)
    if (cadPercent !== null) {
      entries.push({
        fileNames: [],
        key: "modeling",
        label: progressLabel("modeling", t),
        percent: cadPercent,
      })
      entries.push({
        fileNames: [],
        key: "validation",
        label: progressLabel("validation", t),
        percent: cadLoop.completed === true ? 100 : 0,
      })
    }
  }

  const simulation = data.loops.simulation
  if (isRecord(simulation)) {
    const simulationPercent = normalizePercent(simulation.percentage)
    if (simulationPercent !== null) {
      for (const entry of splitSimulationLoopPercentage(simulationPercent)) {
        entries.push({
          fileNames: [],
          key: entry.key,
          label: progressLabel(entry.key, t),
          percent: entry.percent,
        })
      }
    }
  }

  return entries
}

export function getWorkflowProgressEntries(progressEntries: ProgressEntry[], t: TFunction) {
  const progressByKey = new Map(progressEntries.map(entry => [normalizeProgressKey(entry.key), entry]))
  return WORKFLOW_PROGRESS_STAGES.map(stage => {
    const progress = progressByKey.get(stage.key)
    const label = t(stage.label)
    return progress ? { ...stage, fileNames: progress.fileNames, label, percent: progress.percent } : { ...stage, label }
  })
}

export function getDisplayFileName(pathValue: string) {
  const normalized = pathValue.replace(/\\/gu, "/")
  return normalized.split("/").pop() || pathValue
}

function isGlbFilePath(pathValue: string) {
  return /\.glb$/iu.test(pathValue.trim())
}

export function getViewerGlbPath(filePaths: string[]) {
  return filePaths.find(isGlbFilePath) ?? null
}

export function getLatestSessionGlbPath(turns: Turn[], currentEvents: ThreadEvent[]) {
  const allEvents = [...turns.flatMap(turn => turn.events), ...currentEvents]
  for (let index = allEvents.length - 1; index >= 0; index -= 1) {
    const event = allEvents[index]
    if (event.type !== "item.completed" || event.item.type !== "file_change") continue
    for (let changeIndex = event.item.changes.length - 1; changeIndex >= 0; changeIndex -= 1) {
      const pathValue = event.item.changes[changeIndex].path
      if (isGlbFilePath(pathValue)) return pathValue
    }
  }
  return null
}

function normalizePercent(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  const percent = value <= 1 && value >= 0 ? value * 100 : value
  return Math.max(0, Math.min(100, Math.round(percent)))
}

function getStepProgressKey(item: Record<string, unknown>, index: number) {
  return typeof item.stage_name === "string"
    ? item.stage_name
    : typeof item.command_name === "string"
      ? item.command_name
      : typeof item.key === "string"
        ? item.key
        : typeof item.name === "string"
          ? item.name
          : typeof item.label === "string"
            ? item.label
            : `step_${index + 1}`
}

function getNestedCadProgress(data: unknown) {
  if (!isRecord(data)) return null
  if (isRecord(data.cad_progress)) return data.cad_progress
  const legacyProgress = data[LEGACY_CAD_PROGRESS_KEY]
  if (isRecord(legacyProgress)) return legacyProgress

  if (Array.isArray(data.steps)) {
    const cadStep = data.steps.find(step =>
      isRecord(step) && (isRecord(step.cad_progress) || isRecord(step[LEGACY_CAD_PROGRESS_KEY])),
    )
    if (isRecord(cadStep) && isRecord(cadStep.cad_progress)) {
      return cadStep.cad_progress
    }
    if (isRecord(cadStep) && isRecord(cadStep[LEGACY_CAD_PROGRESS_KEY])) {
      return cadStep[LEGACY_CAD_PROGRESS_KEY]
    }
  }

  return null
}

function collectScalarProgressEntries(data: unknown, outputFilesByKey: Map<string, string[]>, t: TFunction) {
  const progressData = isRecord(data) && isRecord(data.progress_percentages)
    ? data.progress_percentages
    : isRecord(data) && isRecord(data.progress)
      ? data.progress
      : data
  const entries: ProgressEntry[] = []

  if (!isRecord(progressData)) return entries
  for (const [key, value] of Object.entries(progressData)) {
    if (["files", "key_files", "artifacts", "outputs", "output_files", "progress", "progress_percentages", "updated_at", "tool", "success"].includes(key)) continue
    const percent = normalizePercent(value)
    if (percent === null) continue
    entries.push({
      fileNames: outputFilesByKey.get(key) ?? [],
      key,
      label: progressLabel(key, t),
      percent,
    })
  }
  return entries
}

export function getProgressEntries(data: unknown, t: TFunction): ProgressEntry[] {
  const outputFilesByKey = getProgressOutputFilesByKey(data)

  if (isRecord(data)) {
    const loopEntries = getLoopProgressEntries(data, t)
    if (loopEntries) return loopEntries
  }

  if (isRecord(data) && Array.isArray(data.steps)) {
    const entries: ProgressEntry[] = []

    data.steps.forEach((item, index) => {
      if (!isRecord(item)) return
      const key = getStepProgressKey(item, index)
      const percent = normalizePercent(item.percent ?? item.percentage ?? item.progress ?? item.value)
      if (percent === null) return
      const stepProgress = isRecord(item.cad_progress)
        ? item.cad_progress
        : isRecord(item[LEGACY_CAD_PROGRESS_KEY])
          ? item[LEGACY_CAD_PROGRESS_KEY]
          : null
      const stepFiles = stepProgress
        ? getProgressFiles(stepProgress).map(getDisplayFileName)
        : []
      entries.push({
        fileNames: outputFilesByKey.get(key) ?? outputFilesByKey.get(normalizeProgressKey(key)) ?? stepFiles,
        key,
        label: typeof item.command_name === "string" ? progressLabel(item.command_name, t) : progressLabel(key, t),
        percent,
      })
    })

    const cadProgress = getNestedCadProgress(data)
    if (isRecord(cadProgress)) {
      const cadEntries = getProgressEntries(cadProgress, t)
      const existingKeys = new Set(entries.map(entry => normalizeProgressKey(entry.key)))
      for (const entry of cadEntries) {
        const normalizedKey = normalizeProgressKey(entry.key)
        if (existingKeys.has(normalizedKey) || normalizedKey === "export_file_percent") continue
        entries.push(entry)
        existingKeys.add(normalizedKey)
      }
    }

    const existingKeys = new Set(entries.map(entry => normalizeProgressKey(entry.key)))
    for (const entry of collectScalarProgressEntries(data, outputFilesByKey, t)) {
      const normalizedKey = normalizeProgressKey(entry.key)
      if (existingKeys.has(normalizedKey) || normalizedKey === "export_file_percent") continue
      entries.push(entry)
      existingKeys.add(normalizedKey)
    }

    return entries
  }

  const progressData = isRecord(data) && isRecord(data.progress_percentages)
    ? data.progress_percentages
    : isRecord(data) && isRecord(data.progress)
      ? data.progress
      : data
  const entries: ProgressEntry[] = []

  if (Array.isArray(progressData)) {
    progressData.forEach((item, index) => {
      if (!isRecord(item)) return
      const key = typeof item.key === "string"
        ? item.key
        : typeof item.name === "string"
          ? item.name
          : typeof item.label === "string"
            ? item.label
            : `step_${index + 1}`
      const value = item.percent ?? item.percentage ?? item.progress ?? item.value
      const percent = normalizePercent(value)
      if (percent === null) return
      entries.push({
        fileNames: outputFilesByKey.get(key) ?? [],
        key,
        label: typeof item.label === "string" ? item.label : progressLabel(key, t),
        percent,
      })
    })
    return entries
  }

  return collectScalarProgressEntries(progressData, outputFilesByKey, t)
}

function getProgressOutputFilesByKey(data: unknown) {
  const files = new Map<string, string[]>()
  if (!isRecord(data)) return files

  const addOutputFiles = (source: Record<string, unknown>, showFinalOutputs: boolean) => {
    if (!isRecord(source.output_files)) return

    for (const [key, value] of Object.entries(source.output_files)) {
      const names: string[] = []
      if (typeof value === "string") {
        if (!showFinalOutputs && ["step", "glb", "replaced_step", "replaced_glb"].includes(key)) continue
        names.push(getDisplayFileName(value))
      } else if (isRecord(value)) {
        if (value.exists !== true) continue
        const pathValue = value.path ?? value.file ?? value.name
        if (typeof pathValue === "string") names.push(getDisplayFileName(pathValue))
      }

      if (names.length === 0) continue
      const existingNames = files.get(key) ?? []
      files.set(key, [...existingNames, ...names])
      if (key === "step" || key === "glb") {
        const exportNames = files.get("export_file_percent") ?? []
        files.set("export_file_percent", [...exportNames, ...names])
      }
    }
  }

  addOutputFiles(data, data.success === true || typeof data.overall_percent === "number")

  const cadProgress = getNestedCadProgress(data)
  if (isRecord(cadProgress)) addOutputFiles(cadProgress, cadProgress.success === true)

  if (Array.isArray(data.steps)) {
    for (const step of data.steps) {
      if (!isRecord(step)) continue
      addOutputFiles(step, step.status === "completed" || step.success === true)
      const stepProgress = isRecord(step.cad_progress)
        ? step.cad_progress
        : isRecord(step[LEGACY_CAD_PROGRESS_KEY])
          ? step[LEGACY_CAD_PROGRESS_KEY]
          : null
      if (stepProgress) addOutputFiles(stepProgress, stepProgress.success === true)
    }
  }

  return files
}

function collectProgressFiles(data: unknown, paths: Set<string>) {
  if (!isRecord(data)) return
  const candidates = [data.files, data.key_files, data.artifacts, data.outputs, data.output_files]
  const showFinalOutputs = data.success === true || typeof data.overall_percent === "number"

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        if (typeof item === "string") paths.add(item)
        if (isRecord(item)) {
          if (item.exists === false) continue
          const pathValue = item.path ?? item.file ?? item.name
          if (typeof pathValue === "string") paths.add(pathValue)
        }
      }
    } else if (isRecord(candidate)) {
      for (const [key, value] of Object.entries(candidate)) {
        if (typeof value === "string") {
          if (!showFinalOutputs && ["step", "glb", "replaced_step", "replaced_glb"].includes(key)) continue
          paths.add(value)
        }
        if (isRecord(value)) {
          if (value.exists !== true) continue
          const pathValue = value.path ?? value.file ?? value.name
          if (typeof pathValue === "string") paths.add(pathValue)
        }
      }
    }
  }

  const cadProgress = getNestedCadProgress(data)
  if (cadProgress && cadProgress !== data) collectProgressFiles(cadProgress, paths)

  if (Array.isArray(data.steps)) {
    for (const step of data.steps) collectProgressFiles(step, paths)
  }
}

export function getProgressFiles(data: unknown) {
  if (!isRecord(data)) return []
  const paths = new Set<string>()
  collectProgressFiles(data, paths)
  return [...paths].slice(0, 6)
}

export function getFileNames(turns: Turn[], currentEvents: ThreadEvent[]) {
  const names = new Set<string>()
  const allEvents = [...turns.flatMap(turn => turn.events), ...currentEvents]
  for (const event of allEvents) {
    if (event.type !== "item.completed" || event.item.type !== "file_change") continue
    for (const change of event.item.changes) names.add(change.path)
  }
  return [...names].slice(0, 5)
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
