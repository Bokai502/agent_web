import { FastifyInstance } from "fastify"
import fs from "fs/promises"
import path from "path"
import { spawn } from "child_process"
import type { AppConfig } from "../config.js"
import { isPathInside } from "../shared/index.js"
import { resolveProgressFromLatestSessionRun } from "./workspaceRegistry.js"
import { resolveScopedWorkspaceFilePath } from "./workspaceFiles.js"
import {
  isNonEmptyString,
  replyWithWorkspaceQueryError,
  resolveQueryWorkspaceContext,
  resolveQueryWorkspaceDir,
  WorkspaceQueryError,
} from "./workspaceQuery.js"

type WorkspaceQuery = {
  versionId?: string
  workspaceDir?: string
  workspaceId?: string
}

type WorkspaceProgressQuery = WorkspaceQuery & {
  sessionId?: string
}

type WorkspaceFilesQuery = WorkspaceQuery & {
  relativePath?: string
}

type WorkspaceFileContentQuery = WorkspaceFilesQuery
type ComplianceCheckMissingItemsQuery = WorkspaceQuery
type ComplianceCheckMissingItemsBody = {
  components?: unknown
}
type ComplianceCheckResultQuery = WorkspaceQuery
type ComplianceCheckResultBody = {
  rows?: unknown
}
type ComplianceArtifactQuery = WorkspaceQuery
type ComplianceArtifactBody = {
  rows?: unknown
}

type WorkspaceTextFileQuery = WorkspaceFilesQuery & {
  maxBytes?: string
}

type WorkspaceTextChunkQuery = WorkspaceFilesQuery & {
  length?: string
  offset?: string
}

const TEXT_FILE_EXTENSIONS = new Set([
  ".42",
  ".c",
  ".cc",
  ".cfg",
  ".cpp",
  ".cxx",
  ".csv",
  ".h",
  ".hh",
  ".hpp",
  ".hxx",
  ".ini",
  ".json",
  ".log",
  ".md",
  ".out",
  ".py",
  ".sh",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
])

type WorkspaceProgressData = {
  data: unknown
  sourcePath: string
  sourceVersion: string
  updatedAt: string
}

const DEFAULT_GEOM_COMPONENT_INFO_RELATIVE_PATH = path.join("component_info", "geom_component_info.json")
const DEFAULT_BOM_INFO_RELATIVE_PATH = path.join("00_inputs", "bom_component_info.json")
const DEFAULT_REAL_BOM_RELATIVE_PATH = path.join("00_inputs", "real_bom.json")
const DEFAULT_PROGRESS_RELATIVE_PATH = path.join("logs", "progress.json")
const AIGNC_PROGRESS_RELATIVE_PATH = path.join("AIGNC_Workflow", "loop_progress.json")
const WORKSPACE_PROGRESS_RELATIVE_PATHS = [
  AIGNC_PROGRESS_RELATIVE_PATH,
  DEFAULT_PROGRESS_RELATIVE_PATH,
]
const DEFAULT_TEMPERATURE_FIELD_RELATIVE_PATH = path.join("02_sim", "simulation", "data1.txt")
const COMPLIANCE_OUTPUT_RELATIVE_PATH = path.join("check_outputs", "compliance")
const LEGACY_COMPLIANCE_OUTPUT_RELATIVE_PATH = path.join("check_outputs", "checks", "compliance")
const DERATING_OUTPUT_RELATIVE_PATH = path.join(COMPLIANCE_OUTPUT_RELATIVE_PATH, "derating")
const DERATING_MAPPING_COMPLETENESS_RELATIVE_PATH = path.join(DERATING_OUTPUT_RELATIVE_PATH, "mapping_completeness.json")
const DERATING_TABLE_RELATIVE_PATH = path.join(DERATING_OUTPUT_RELATIVE_PATH, "table.json")
const DERATING_CHECK_RESULT_RELATIVE_PATH = path.join(COMPLIANCE_OUTPUT_RELATIVE_PATH, "stages", "derating_check.json")
const DERATING_DIRECT_CHECK_RESULT_RELATIVE_PATH = path.join(DERATING_OUTPUT_RELATIVE_PATH, "check_result.json")
const COMPLIANCE_ARTIFACTS = new Set([
  "component_classification",
  "manufacturer_check",
  "key_units_check",
  "catalog_match",
  "quality_level_check",
])
const DERATING_REFERENCE_RELATIVE_PATH = path.join(
  "workflow_agents",
  "check_skills",
  "compliance",
  "reference",
  "jiange_full.json",
)
const THERMAL_DB_JSON_RELATIVE_PATH = path.join(
  "workflow_agents",
  "thermal_skills",
  "config-editor",
  "references",
  "热仿真数据库.json",
)
const MAX_FILE_TREE_ENTRIES = 500

let workspaceFileLimits = {
  filePreviewMaxBytes: 1024 * 1024,
  textChunkBytes: 512 * 1024,
  textChunkMaxBytes: 1024 * 1024,
  textFileMaxBytes: 8 * 1024 * 1024,
}

type TemperaturePoint = {
  temperature: number
  x: number
  y: number
  z: number
}

type JsonRecord = Record<string, unknown>

type ThermalDbRecord = {
  assetRoot: string | null
  record: JsonRecord
  sheetName: string
}

type ThermalDbIndex = {
  byModel: Map<string, ThermalDbRecord | null>
  sourcePath: string
}

let thermalDbIndexPromise: Promise<ThermalDbIndex | null> | null = null

async function readWorkspaceProgress(progressPath: string): Promise<WorkspaceProgressData | null> {
  const raw = await fs.readFile(progressPath, "utf-8").catch(() => null)
  if (raw === null) return null

  const stat = await fs.stat(progressPath)
  return {
    data: JSON.parse(raw) as unknown,
    sourcePath: progressPath,
    sourceVersion: [progressPath, stat.mtimeMs, stat.size].join(":"),
    updatedAt: stat.mtime.toISOString(),
  }
}

async function readFirstWorkspaceProgress(workspaceDir: string) {
  const candidatePaths = WORKSPACE_PROGRESS_RELATIVE_PATHS.map(relativePath => path.join(workspaceDir, relativePath))

  for (const progressPath of candidatePaths) {
    const stat = await fs.stat(progressPath).catch(() => null)
    if (!stat?.isFile()) continue
    return {
      progressPath,
      stat,
      workspaceProgress: await readWorkspaceProgress(progressPath),
    }
  }

  return {
    progressPath: candidatePaths[0],
    stat: null,
    workspaceProgress: null,
  }
}

function normalizeRelativeDirectory(value: unknown) {
  if (typeof value !== "string") return ""
  const trimmed = value.trim()
  if (!trimmed || trimmed === "." || trimmed === "/") return ""
  return trimmed.replace(/\\/gu, "/").replace(/^\/+/u, "").replace(/\/+$/u, "")
}

function formatRelativePath(workspaceDir: string, fullPath: string) {
  return path.relative(workspaceDir, fullPath).split(path.sep).join("/")
}

function safeArchiveBaseName(query: WorkspaceQuery, workspaceDir: string) {
  const sourceName = query.versionId || query.workspaceId || path.basename(workspaceDir) || "workspace"
  const cleaned = sourceName.replace(/[^\p{L}\p{N}._-]+/gu, "_").replace(/^_+|_+$/gu, "")
  return cleaned || "workspace"
}

async function readWorkspaceDirectoryEntries(workspaceDir: string, relativePath: unknown) {
  const normalizedRelativePath = normalizeRelativeDirectory(relativePath)
  const targetDir = path.resolve(workspaceDir, normalizedRelativePath)
  if (!isPathInside(path.resolve(workspaceDir), targetDir)) {
    throw new WorkspaceQueryError("relativePath must stay inside workspaceDir", 400)
  }

  const stat = await fs.stat(targetDir).catch(() => null)
  if (!stat?.isDirectory()) {
    throw new WorkspaceQueryError("directory not found", 404)
  }

  const dirents = await fs.readdir(targetDir, { withFileTypes: true })
  const entries = await Promise.all(dirents
    .filter(dirent => !dirent.name.startsWith("."))
    .slice(0, MAX_FILE_TREE_ENTRIES)
    .map(async dirent => {
      const fullPath = path.join(targetDir, dirent.name)
      const entryStat = await fs.stat(fullPath).catch(() => null)
      const type = dirent.isDirectory() ? "directory" : "file"
      return {
        name: dirent.name,
        relativePath: formatRelativePath(workspaceDir, fullPath),
        type,
        ...(type === "file" ? { size: entryStat?.size ?? 0 } : {}),
        mtimeMs: entryStat?.mtimeMs ?? 0,
      }
    }))

  entries.sort((left, right) => {
    if (left.type !== right.type) return left.type === "directory" ? -1 : 1
    return left.name.localeCompare(right.name, "zh-CN", { numeric: true })
  })

  return {
    entries,
    relativePath: normalizedRelativePath,
    truncated: dirents.length > MAX_FILE_TREE_ENTRIES,
    workspaceDir,
  }
}

function normalizeRelativeFile(value: unknown) {
  if (typeof value !== "string") {
    throw new WorkspaceQueryError("relativePath is required", 400)
  }
  const trimmed = value.trim()
  if (!trimmed || trimmed === "." || trimmed === "/") {
    throw new WorkspaceQueryError("relativePath is required", 400)
  }
  return trimmed.replace(/\\/gu, "/").replace(/^\/+/u, "").replace(/\/+$/u, "")
}

async function readWorkspaceFileContent(workspaceDir: string, relativePath: unknown) {
  const normalizedRelativePath = normalizeRelativeFile(relativePath)
  const targetPath = path.resolve(workspaceDir, normalizedRelativePath)
  if (!isPathInside(path.resolve(workspaceDir), targetPath)) {
    throw new WorkspaceQueryError("relativePath must stay inside workspaceDir", 400)
  }

  const stat = await fs.stat(targetPath).catch(() => null)
  if (!stat?.isFile()) {
    throw new WorkspaceQueryError("file not found", 404)
  }

  const extension = path.extname(targetPath).toLowerCase()
  const mimeType = extension === ".md"
    ? "text/markdown"
    : extension === ".json"
      ? "application/json"
      : extension === ".png"
        ? "image/png"
        : extension === ".jpg" || extension === ".jpeg"
          ? "image/jpeg"
          : extension === ".webp"
            ? "image/webp"
            : extension === ".gif"
              ? "image/gif"
              : TEXT_FILE_EXTENSIONS.has(extension)
                ? "text/plain"
                : "application/octet-stream"
  const isImage = mimeType.startsWith("image/")
  const isText = mimeType.startsWith("text/") || mimeType === "application/json"

  if (isImage) {
    const data = await fs.readFile(targetPath)
    return {
      contentBase64: data.toString("base64"),
      encoding: "base64",
      mimeType,
      mtimeMs: stat.mtimeMs,
      name: path.basename(targetPath),
      relativePath: normalizedRelativePath,
      size: stat.size,
      type: "image",
    }
  }

  if (isText && stat.size <= workspaceFileLimits.filePreviewMaxBytes) {
    return {
      content: await fs.readFile(targetPath, "utf-8"),
      encoding: "utf-8",
      mimeType,
      mtimeMs: stat.mtimeMs,
      name: path.basename(targetPath),
      relativePath: normalizedRelativePath,
      size: stat.size,
      type: "text",
    }
  }

  return {
    mimeType,
    mtimeMs: stat.mtimeMs,
    name: path.basename(targetPath),
    previewable: false,
    reason: stat.size > workspaceFileLimits.filePreviewMaxBytes ? "file too large for preview" : "binary file preview is not supported",
    relativePath: normalizedRelativePath,
    size: stat.size,
    type: "binary",
  }
}

async function readWorkspaceTextFile(workspaceDir: string, relativePath: unknown, maxBytesValue: unknown) {
  const normalizedRelativePath = normalizeRelativeFile(relativePath)
  const targetPath = path.resolve(workspaceDir, normalizedRelativePath)
  if (!isPathInside(path.resolve(workspaceDir), targetPath)) {
    throw new WorkspaceQueryError("relativePath must stay inside workspaceDir", 400)
  }

  const stat = await fs.stat(targetPath).catch(() => null)
  if (!stat?.isFile()) {
    throw new WorkspaceQueryError("file not found", 404)
  }

  const extension = path.extname(targetPath).toLowerCase()
  if (!TEXT_FILE_EXTENSIONS.has(extension)) {
    throw new WorkspaceQueryError("unsupported text file type", 400)
  }

  const requestedMaxBytes = Number.parseInt(String(maxBytesValue ?? ""), 10)
  const maxBytes = Number.isFinite(requestedMaxBytes) && requestedMaxBytes > 0
    ? Math.min(requestedMaxBytes, workspaceFileLimits.textFileMaxBytes)
    : workspaceFileLimits.textFileMaxBytes
  if (stat.size > maxBytes) {
    throw new WorkspaceQueryError(`file too large for text read; size=${stat.size}, maxBytes=${maxBytes}`, 413)
  }

  return {
    content: await fs.readFile(targetPath, "utf-8"),
    encoding: "utf-8",
    mimeType: extension === ".json" ? "application/json" : extension === ".md" ? "text/markdown" : "text/plain",
    mtimeMs: stat.mtimeMs,
    name: path.basename(targetPath),
    relativePath: normalizedRelativePath,
    size: stat.size,
    type: "text",
  }
}

async function readWorkspaceTextChunk(workspaceDir: string, relativePath: unknown, offsetValue: unknown, lengthValue: unknown) {
  const normalizedRelativePath = normalizeRelativeFile(relativePath)
  const targetPath = path.resolve(workspaceDir, normalizedRelativePath)
  if (!isPathInside(path.resolve(workspaceDir), targetPath)) {
    throw new WorkspaceQueryError("relativePath must stay inside workspaceDir", 400)
  }

  const stat = await fs.stat(targetPath).catch(() => null)
  if (!stat?.isFile()) {
    throw new WorkspaceQueryError("file not found", 404)
  }

  const extension = path.extname(targetPath).toLowerCase()
  if (!TEXT_FILE_EXTENSIONS.has(extension) && extension !== ".42") {
    throw new WorkspaceQueryError("unsupported text file type", 400)
  }

  const requestedOffset = Number.parseInt(String(offsetValue ?? "0"), 10)
  const requestedLength = Number.parseInt(String(lengthValue ?? ""), 10)
  const offset = Number.isFinite(requestedOffset) && requestedOffset > 0 ? Math.min(requestedOffset, stat.size) : 0
  const length = Number.isFinite(requestedLength) && requestedLength > 0
    ? Math.min(requestedLength, workspaceFileLimits.textChunkMaxBytes)
    : workspaceFileLimits.textChunkBytes
  const byteLength = Math.max(0, Math.min(length, stat.size - offset))
  const handle = await fs.open(targetPath, "r")
  try {
    const buffer = Buffer.alloc(byteLength)
    const { bytesRead } = await handle.read(buffer, 0, byteLength, offset)
    const nextOffset = offset + bytesRead
    return {
      contentBase64: buffer.subarray(0, bytesRead).toString("base64"),
      encoding: "base64",
      mimeType: extension === ".json" ? "application/json" : extension === ".md" ? "text/markdown" : "text/plain",
      mtimeMs: stat.mtimeMs,
      name: path.basename(targetPath),
      nextOffset,
      offset,
      relativePath: normalizedRelativePath,
      size: stat.size,
      type: "text-chunk",
      complete: nextOffset >= stat.size,
    }
  } finally {
    await handle.close()
  }
}

function parseComsolTemperatureData(data: string, sourcePath: string) {
  const points: TemperaturePoint[] = []

  for (const line of data.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("%")) continue

    const values = trimmed.split(/[,\s]+/u).map((token) => Number.parseFloat(token))
    if (values.length < 4 || values.slice(0, 4).some((value) => !Number.isFinite(value))) {
      continue
    }

    points.push({
      x: values[0],
      y: values[1],
      z: values[2],
      temperature: values[3],
    })
  }

  if (points.length === 0) {
    throw new Error("temperature field has no finite COMSOL samples")
  }

  const tempMin = Math.min(...points.map((point) => point.temperature))
  const tempMax = Math.max(...points.map((point) => point.temperature))

  return {
    schema_version: "1.0",
    format: "threejs_temperature_point_cloud",
    source: {
      comsol_data: sourcePath,
      temperature_array: "T",
    },
    units: {
      position: "m",
      temperature: "K",
    },
    point_count: points.length,
    bounds: {
      min: [
        Math.min(...points.map((point) => point.x)),
        Math.min(...points.map((point) => point.y)),
        Math.min(...points.map((point) => point.z)),
      ],
      max: [
        Math.max(...points.map((point) => point.x)),
        Math.max(...points.map((point) => point.y)),
        Math.max(...points.map((point) => point.z)),
      ],
    },
    temperature_range_K: {
      min: tempMin,
      max: tempMax,
    },
    attributes: {
      position: points.flatMap((point) => [point.x, point.y, point.z]),
      temperature_K: points.map((point) => point.temperature),
      color_rgb: points.flatMap((point) => temperatureColor(point.temperature, tempMin, tempMax)),
    },
    threejs_hint: {
      geometry: "THREE.BufferGeometry",
      position_attribute: "position",
      color_attribute: "color_rgb",
      temperature_attribute: "temperature_K",
      material: "THREE.PointsMaterial({ vertexColors: true })",
    },
  }
}

function temperatureColor(temperature: number, tempMin: number, tempMax: number) {
  const value = tempMax <= tempMin
    ? 0
    : Math.max(0, Math.min(1, (temperature - tempMin) / (tempMax - tempMin)))
  if (value < 0.5) {
    const t = value / 0.5
    return [0, t, 1 - t]
  }
  const t = (value - 0.5) / 0.5
  return [t, 1 - t, 0]
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function normalizeComplianceCheckCompletenessPayload(value: unknown) {
  if (!isRecord(value)) {
    throw new WorkspaceQueryError("derating completeness JSON root must be an object", 422)
  }
  const components = Array.isArray(value.components)
    ? value.components.filter(isRecord)
    : []
  return {
    ...value,
    components,
  }
}

function summarizeComplianceCheckCompletenessComponents(components: JsonRecord[]) {
  return {
    component_count: components.length,
    components_with_missing: components.filter(component => Number(component.missing_count ?? 0) > 0).length,
    missing_total: components.reduce((total, component) => total + Number(component.missing_count ?? 0), 0),
  }
}

function uniqueCleanStrings(values: unknown[]) {
  return Array.from(new Set(values
    .map(value => typeof value === "string" || typeof value === "number" ? String(value).trim() : "")
    .filter(Boolean)))
}

async function readJsonObject(filePath: string) {
  const raw = await fs.readFile(filePath, "utf-8").catch(() => null)
  if (raw === null) return null
  const parsed = JSON.parse(raw) as unknown
  return isRecord(parsed) ? parsed : null
}

function unwrapStageOutput(value: unknown) {
  if (isRecord(value) && isRecord(value.output)) return value.output
  return value
}

async function readComplianceCheckReferenceRows() {
  const candidatePaths = [
    path.resolve(process.cwd(), DERATING_REFERENCE_RELATIVE_PATH),
    path.resolve(process.cwd(), "backend", DERATING_REFERENCE_RELATIVE_PATH),
  ]
  for (const candidatePath of candidatePaths) {
    const raw = await fs.readFile(candidatePath, "utf-8").catch(() => null)
    if (raw === null) continue
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter(isRecord) : []
  }
  return []
}

async function resolveComplianceCheckOutputFile(workspaceDir: string, preferredRelativePaths: string[], suffix: string, outputRelativePaths: string[]) {
  for (const preferredRelativePath of preferredRelativePaths) {
    const preferredPath = path.join(workspaceDir, preferredRelativePath)
    const preferredStat = await fs.stat(preferredPath).catch(() => null)
    if (preferredStat?.isFile()) {
      return {
        fullPath: preferredPath,
        relativePath: preferredRelativePath,
        stat: preferredStat,
      }
    }
  }

  const candidates = (await Promise.all(outputRelativePaths.map(async outputRelativePath => {
    const outputDir = path.join(workspaceDir, outputRelativePath)
    const dirents = await fs.readdir(outputDir, { withFileTypes: true }).catch(() => [])
    return Promise.all(dirents
      .filter(dirent => dirent.isFile() && (
        dirent.name.endsWith(suffix) ||
        dirent.name === suffix.replace(/^_/u, "")
      ))
      .map(async dirent => {
        const fullPath = path.join(outputDir, dirent.name)
        const stat = await fs.stat(fullPath).catch(() => null)
        return stat?.isFile()
          ? {
              fullPath,
              relativePath: path.join(outputRelativePath, dirent.name),
              stat,
            }
          : null
      }))
  }))).flat()

  const sorted = candidates
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
    .sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs)

  return sorted[0] ?? null
}

async function enrichComplianceCheckCompletenessPayload(workspaceDir: string, payload: ReturnType<typeof normalizeComplianceCheckCompletenessPayload>) {
  const tablePayload = await readJsonObject(path.join(workspaceDir, DERATING_TABLE_RELATIVE_PATH))
    ?? await readJsonObject(path.join(workspaceDir, DERATING_OUTPUT_RELATIVE_PATH, "input_table.json"))
    ?? await readJsonObject(path.join(workspaceDir, LEGACY_COMPLIANCE_OUTPUT_RELATIVE_PATH, "derating", "table.json"))
    ?? await readJsonObject(path.join(workspaceDir, LEGACY_COMPLIANCE_OUTPUT_RELATIVE_PATH, "derating", "input_table.json"))
  const tableRows = Array.isArray(tablePayload?.data) ? tablePayload.data.filter(isRecord) : []
  const referenceRows = await readComplianceCheckReferenceRows()
  const requiredByType = new Map<string, string[]>()

  for (const row of referenceRows) {
    const category = cleanString(row["元器件大类"])
    const subclass = cleanString(row["元器件子类"])
    const parameter = cleanString(row["降额参数"])
    if (!category || !subclass || !parameter) continue
    const key = `${category}\n${subclass}`
    const values = requiredByType.get(key) ?? []
    if (!values.includes(parameter)) values.push(parameter)
    requiredByType.set(key, values)
  }

  const components = payload.components.map(component => {
    const componentName = cleanString(component["元器件名称"])
    const category = cleanString(component["元器件大类"])
    const subclass = cleanString(component["元器件子类"])
    const matchingRows = tableRows.filter(row => cleanString(row["元器件名称"]) === componentName)
    const requiredParameters = requiredByType.get(`${category}\n${subclass}`) ?? []
    const filledParameters = uniqueCleanStrings(matchingRows.map(row => row["降额参数"]))
    return {
      ...component,
      "型号规格": component["型号规格"] ?? uniqueCleanStrings(matchingRows.map(row => row["型号规格_规格"])).join("; "),
      "生产厂商": component["生产厂商"] ?? uniqueCleanStrings(matchingRows.map(row => row["生产厂商_生产单位"])).join("; "),
      "标准全量参数": component["标准全量参数"] ?? requiredParameters.join("; "),
      "已填参数": component["已填参数"] ?? filledParameters.join("; "),
    }
  })

  return {
    ...payload,
    components,
  }
}

async function buildComplianceCheckCompletenessFromCurrentOutputs(workspaceDir: string) {
  const tablePath = path.join(workspaceDir, DERATING_TABLE_RELATIVE_PATH)
  const classificationPath = path.join(workspaceDir, DERATING_OUTPUT_RELATIVE_PATH, "classification.json")
  const [tablePayload, classificationPayload] = await Promise.all([
    readJsonObject(tablePath),
    readJsonObject(classificationPath),
  ])
  const tableRows = Array.isArray(tablePayload?.data) ? tablePayload.data.filter(isRecord) : []
  const classificationRows = Array.isArray(classificationPayload?.components)
    ? classificationPayload.components.filter(isRecord)
    : []
  if (tableRows.length === 0 && classificationRows.length === 0) return null

  const tableRowsByName = new Map<string, JsonRecord[]>()
  for (const row of tableRows) {
    const name = cleanString(row["元器件名称"])
    if (!name) continue
    tableRowsByName.set(name, [...(tableRowsByName.get(name) ?? []), row])
  }

  const componentNames = uniqueCleanStrings([
    ...classificationRows.map(row => row["元器件名称"]),
    ...tableRows.map(row => row["元器件名称"]),
  ])
  const components = componentNames.map(componentName => {
    const classification = classificationRows.find(row => cleanString(row["元器件名称"]) === componentName)
    const matchingRows = tableRowsByName.get(componentName) ?? []
    const standardParameters = Array.isArray(classification?.information)
      ? uniqueCleanStrings(classification.information.filter(isRecord).map(row => row["降额参数"]))
      : []
    const filledParameters = uniqueCleanStrings([
      ...matchingRows.map(row => row["降额参数"]),
      ...(Array.isArray(classification?.["降额参数"]) ? classification["降额参数"] : []),
    ])
    const missingParameters = standardParameters.filter(parameter => !filledParameters.includes(parameter))

    return {
      "元器件名称": componentName,
      "型号规格": uniqueCleanStrings([
        ...matchingRows.map(row => row["型号规格_规格"]),
        ...(Array.isArray(classification?.sample_models) ? classification.sample_models : []),
      ]).join("; "),
      "生产厂商": uniqueCleanStrings(matchingRows.map(row => row["生产厂商_生产单位"])).join("; "),
      "元器件大类": classification?.["元器件大类"] ?? matchingRows[0]?.["元器件大类"] ?? "",
      "元器件子类": classification?.["元器件子类"] ?? matchingRows[0]?.["元器件子类"] ?? "",
      "标准全量参数": standardParameters.join("; "),
      "已填参数": filledParameters.join("; "),
      missing_count: missingParameters.length,
      missing_standard_parameters: missingParameters.join("; "),
    }
  })
  const stat = await fs.stat(classificationPath).catch(() => null) ?? await fs.stat(tablePath).catch(() => null)
  return {
    schema_version: "1.0",
    components,
    source_path: classificationPayload ? classificationPath : tablePath,
    source_relative_path: (classificationPayload
      ? path.join(DERATING_OUTPUT_RELATIVE_PATH, "classification.json")
      : DERATING_TABLE_RELATIVE_PATH
    ).split(path.sep).join("/"),
    source_version: stat ? [classificationPayload ? classificationPath : tablePath, stat.mtimeMs, stat.size].join(":") : null,
    summary: summarizeComplianceCheckCompletenessComponents(components),
    updated_at: stat?.mtime.toISOString() ?? null,
  }
}

async function readComplianceCheckMissingItems(workspaceDir: string) {
  const resolvedFile = await resolveComplianceCheckOutputFile(
    workspaceDir,
    [
      DERATING_MAPPING_COMPLETENESS_RELATIVE_PATH,
      path.join(DERATING_OUTPUT_RELATIVE_PATH, "input_mapping_completeness.json"),
    ],
    "_mapping_completeness.json",
    [DERATING_OUTPUT_RELATIVE_PATH],
  )
  if (!resolvedFile) {
    const generatedPayload = await buildComplianceCheckCompletenessFromCurrentOutputs(workspaceDir)
    if (generatedPayload) return generatedPayload
    throw new WorkspaceQueryError("derating mapping completeness JSON not found", 404)
  }
  const completenessPath = resolvedFile.fullPath
  const raw = await fs.readFile(completenessPath, "utf-8").catch(() => null)
  if (raw === null) {
    throw new WorkspaceQueryError("derating mapping completeness JSON not found", 404)
  }

  const payload = await enrichComplianceCheckCompletenessPayload(
    workspaceDir,
    normalizeComplianceCheckCompletenessPayload(JSON.parse(raw) as unknown),
  )
  return {
    ...payload,
    source_path: completenessPath,
    source_relative_path: resolvedFile.relativePath.split(path.sep).join("/"),
    source_version: [completenessPath, resolvedFile.stat.mtimeMs, resolvedFile.stat.size].join(":"),
    updated_at: resolvedFile.stat.mtime.toISOString(),
  }
}

async function writeComplianceCheckMissingItems(workspaceDir: string, body: ComplianceCheckMissingItemsBody) {
  if (!Array.isArray(body.components)) {
    throw new WorkspaceQueryError("components array is required", 400)
  }
  const completenessPath = path.join(workspaceDir, DERATING_MAPPING_COMPLETENESS_RELATIVE_PATH)
  const existingRaw = await fs.readFile(completenessPath, "utf-8").catch(() => null)
  const existingPayload = existingRaw
    ? normalizeComplianceCheckCompletenessPayload(JSON.parse(existingRaw) as unknown)
    : { schema_version: "1.0", components: [] }
  const components = body.components.filter(isRecord)
  const nextPayload = {
    ...existingPayload,
    summary: summarizeComplianceCheckCompletenessComponents(components),
    components,
  }
  await fs.mkdir(path.dirname(completenessPath), { recursive: true })
  await fs.writeFile(completenessPath, `${JSON.stringify(nextPayload, null, 2)}\n`, "utf-8")
  return readComplianceCheckMissingItems(workspaceDir)
}

function normalizeComplianceCheckResultPayload(value: unknown) {
  if (!isRecord(value)) {
    throw new WorkspaceQueryError("derating check result JSON root must be an object", 422)
  }
  const rows = Array.isArray(value.rows)
    ? value.rows.filter(isRecord)
    : []
  return {
    ...value,
    rows,
  }
}

function summarizeComplianceCheckRows(rows: JsonRecord[]) {
  const summary: Record<string, number> = { total_rows: rows.length }
  const issueCounts: Record<string, number> = {}
  for (const row of rows) {
    const status = cleanString(row["符合性"]) || cleanString(row["综合判定"]) || "未判定"
    summary[status] = (summary[status] ?? 0) + 1
    const issues = Array.isArray(row["问题"]) ? row["问题"] : []
    for (const issue of issues) {
      const text = cleanString(issue)
      if (!text) continue
      issueCounts[text] = (issueCounts[text] ?? 0) + 1
    }
  }
  return { issueCounts, summary }
}

async function readComplianceCheckResult(workspaceDir: string) {
  const resolvedFile = await resolveComplianceCheckOutputFile(
    workspaceDir,
    [
      DERATING_DIRECT_CHECK_RESULT_RELATIVE_PATH,
      DERATING_CHECK_RESULT_RELATIVE_PATH,
      path.join(DERATING_OUTPUT_RELATIVE_PATH, "input_check_result.json"),
      path.join(LEGACY_COMPLIANCE_OUTPUT_RELATIVE_PATH, "derating", "check_result.json"),
      path.join(COMPLIANCE_OUTPUT_RELATIVE_PATH, "steps", "derating_check.json"),
      path.join(LEGACY_COMPLIANCE_OUTPUT_RELATIVE_PATH, "stages", "derating_check.json"),
      path.join(LEGACY_COMPLIANCE_OUTPUT_RELATIVE_PATH, "steps", "derating_check.json"),
    ],
    "_check_result.json",
    [
      path.join(COMPLIANCE_OUTPUT_RELATIVE_PATH, "stages"),
      path.join(COMPLIANCE_OUTPUT_RELATIVE_PATH, "steps"),
      DERATING_OUTPUT_RELATIVE_PATH,
      path.join(LEGACY_COMPLIANCE_OUTPUT_RELATIVE_PATH, "stages"),
      path.join(LEGACY_COMPLIANCE_OUTPUT_RELATIVE_PATH, "steps"),
    ],
  )
  if (!resolvedFile) {
    throw new WorkspaceQueryError("derating check result JSON not found", 404)
  }
  const resultPath = resolvedFile.fullPath
  const raw = await fs.readFile(resultPath, "utf-8").catch(() => null)
  if (raw === null) {
    throw new WorkspaceQueryError("derating check result JSON not found", 404)
  }

  const payload = normalizeComplianceCheckResultPayload(unwrapStageOutput(JSON.parse(raw) as unknown))
  return {
    ...payload,
    source_path: resultPath,
    source_relative_path: resolvedFile.relativePath.split(path.sep).join("/"),
    source_version: [resultPath, resolvedFile.stat.mtimeMs, resolvedFile.stat.size].join(":"),
    updated_at: resolvedFile.stat.mtime.toISOString(),
  }
}

async function writeComplianceCheckResult(workspaceDir: string, body: ComplianceCheckResultBody) {
  if (!Array.isArray(body.rows)) {
    throw new WorkspaceQueryError("rows array is required", 400)
  }
  const resolvedFile = await resolveComplianceCheckOutputFile(
    workspaceDir,
    [
      DERATING_DIRECT_CHECK_RESULT_RELATIVE_PATH,
      DERATING_CHECK_RESULT_RELATIVE_PATH,
      path.join(DERATING_OUTPUT_RELATIVE_PATH, "input_check_result.json"),
      path.join(LEGACY_COMPLIANCE_OUTPUT_RELATIVE_PATH, "derating", "check_result.json"),
      path.join(COMPLIANCE_OUTPUT_RELATIVE_PATH, "steps", "derating_check.json"),
      path.join(LEGACY_COMPLIANCE_OUTPUT_RELATIVE_PATH, "stages", "derating_check.json"),
      path.join(LEGACY_COMPLIANCE_OUTPUT_RELATIVE_PATH, "steps", "derating_check.json"),
    ],
    "_check_result.json",
    [
      path.join(COMPLIANCE_OUTPUT_RELATIVE_PATH, "stages"),
      path.join(COMPLIANCE_OUTPUT_RELATIVE_PATH, "steps"),
      DERATING_OUTPUT_RELATIVE_PATH,
      path.join(LEGACY_COMPLIANCE_OUTPUT_RELATIVE_PATH, "stages"),
      path.join(LEGACY_COMPLIANCE_OUTPUT_RELATIVE_PATH, "steps"),
    ],
  )
  const resultPath = resolvedFile?.fullPath ?? path.join(workspaceDir, DERATING_DIRECT_CHECK_RESULT_RELATIVE_PATH)
  const existingRaw = await fs.readFile(resultPath, "utf-8").catch(() => null)
  const existingPayload = existingRaw
    ? normalizeComplianceCheckResultPayload(unwrapStageOutput(JSON.parse(existingRaw) as unknown))
    : { schema_version: "1.0", rows: [] }
  const rows = body.rows.filter(isRecord)
  const { issueCounts, summary } = summarizeComplianceCheckRows(rows)
  const nextPayload = {
    ...existingPayload,
    issue_counts: issueCounts,
    rows,
    summary,
  }
  await fs.mkdir(path.dirname(resultPath), { recursive: true })
  await fs.writeFile(resultPath, `${JSON.stringify(nextPayload, null, 2)}\n`, "utf-8")
  return readComplianceCheckResult(workspaceDir)
}

function assertComplianceArtifact(value: unknown) {
  const artifact = cleanString(value)
  if (!COMPLIANCE_ARTIFACTS.has(artifact)) {
    throw new WorkspaceQueryError("unsupported compliance artifact", 400)
  }
  return artifact
}

async function resolveComplianceArtifactFile(workspaceDir: string, artifact: string) {
  const candidates = [
    path.join(COMPLIANCE_OUTPUT_RELATIVE_PATH, "stages", `${artifact}.json`),
    path.join(COMPLIANCE_OUTPUT_RELATIVE_PATH, "steps", `${artifact}.json`),
    path.join(COMPLIANCE_OUTPUT_RELATIVE_PATH, `${artifact}.json`),
    path.join(LEGACY_COMPLIANCE_OUTPUT_RELATIVE_PATH, "stages", `${artifact}.json`),
    path.join(LEGACY_COMPLIANCE_OUTPUT_RELATIVE_PATH, "steps", `${artifact}.json`),
    path.join(LEGACY_COMPLIANCE_OUTPUT_RELATIVE_PATH, `${artifact}.json`),
  ]
  for (const relativePath of candidates) {
    const fullPath = path.join(workspaceDir, relativePath)
    const stat = await fs.stat(fullPath).catch(() => null)
    if (stat?.isFile()) {
      return {
        fullPath,
        relativePath,
        stat,
      }
    }
  }
  return {
    fullPath: path.join(workspaceDir, candidates[0]),
    relativePath: candidates[0],
    stat: null,
  }
}

function complianceRowsFromPayload(payload: unknown) {
  if (Array.isArray(payload)) return payload.filter(isRecord)
  if (!isRecord(payload)) return []
  if (Array.isArray(payload.output)) return payload.output.filter(isRecord)
  if (Array.isArray(payload.rows)) return payload.rows.filter(isRecord)
  if (Array.isArray(payload.components)) return payload.components.filter(isRecord)
  return []
}

async function readComplianceArtifact(workspaceDir: string, artifactValue: unknown) {
  const artifact = assertComplianceArtifact(artifactValue)
  const resolvedFile = await resolveComplianceArtifactFile(workspaceDir, artifact)
  const raw = await fs.readFile(resolvedFile.fullPath, "utf-8").catch(() => null)
  if (raw === null) {
    return {
      artifact,
      exists: false,
      rows: [],
      source_path: resolvedFile.fullPath,
      source_relative_path: resolvedFile.relativePath.split(path.sep).join("/"),
      source_version: null,
      updated_at: null,
    }
  }
  const stat = resolvedFile.stat ?? await fs.stat(resolvedFile.fullPath)
  const payload = JSON.parse(raw) as unknown
  return {
    artifact,
    exists: true,
    rows: complianceRowsFromPayload(payload),
    source_path: resolvedFile.fullPath,
    source_relative_path: resolvedFile.relativePath.split(path.sep).join("/"),
    source_version: [resolvedFile.fullPath, stat.mtimeMs, stat.size].join(":"),
    updated_at: stat.mtime.toISOString(),
  }
}

async function writeComplianceArtifact(workspaceDir: string, artifactValue: unknown, body: ComplianceArtifactBody) {
  const artifact = assertComplianceArtifact(artifactValue)
  if (!Array.isArray(body.rows)) {
    throw new WorkspaceQueryError("rows array is required", 400)
  }
  const resolvedFile = await resolveComplianceArtifactFile(workspaceDir, artifact)
  const rows = body.rows.filter(isRecord)
  const existingRaw = await fs.readFile(resolvedFile.fullPath, "utf-8").catch(() => null)
  const existingPayload = existingRaw ? JSON.parse(existingRaw) as unknown : null
  let nextPayload: unknown
  if (Array.isArray(existingPayload)) {
    nextPayload = rows
  } else if (isRecord(existingPayload)) {
    if (Array.isArray(existingPayload.output) || (!Array.isArray(existingPayload.rows) && !Array.isArray(existingPayload.components))) {
      nextPayload = { ...existingPayload, output: rows }
    } else if (Array.isArray(existingPayload.rows)) {
      nextPayload = { ...existingPayload, rows }
    } else {
      nextPayload = { ...existingPayload, components: rows }
    }
  } else {
    nextPayload = { stage: artifact, output: rows }
  }
  await fs.mkdir(path.dirname(resolvedFile.fullPath), { recursive: true })
  await fs.writeFile(resolvedFile.fullPath, `${JSON.stringify(nextPayload, null, 2)}\n`, "utf-8")
  return readComplianceArtifact(workspaceDir, artifact)
}

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function setUniqueModel(index: Map<string, ThermalDbRecord | null>, key: string, value: ThermalDbRecord) {
  if (!key) return
  if (index.has(key)) {
    index.set(key, null)
    return
  }
  index.set(key, value)
}

async function loadThermalDbIndex() {
  if (!thermalDbIndexPromise) {
    thermalDbIndexPromise = buildThermalDbIndex().catch(() => null)
  }
  return thermalDbIndexPromise
}

async function buildThermalDbIndex(): Promise<ThermalDbIndex | null> {
  const candidatePaths = [
    path.resolve(process.cwd(), THERMAL_DB_JSON_RELATIVE_PATH),
    path.resolve(process.cwd(), "backend", THERMAL_DB_JSON_RELATIVE_PATH),
  ]

  let sourcePath: string | null = null
  let raw: string | null = null
  for (const candidatePath of candidatePaths) {
    raw = await fs.readFile(candidatePath, "utf-8").catch(() => null)
    if (raw !== null) {
      sourcePath = candidatePath
      break
    }
  }
  if (!sourcePath || raw === null) return null

  const payload = JSON.parse(raw) as unknown
  if (!isRecord(payload) || !Array.isArray(payload.sheets)) return null

  const topLevelSourceFile = cleanString(payload.source_file)
  const topLevelAssetRoot = topLevelSourceFile ? path.dirname(topLevelSourceFile) : null
  const byModel = new Map<string, ThermalDbRecord | null>()

  for (const sheet of payload.sheets) {
    if (!isRecord(sheet) || !Array.isArray(sheet.records)) continue
    const sheetSourceFile = cleanString(sheet.source_file)
    const assetRoot = topLevelAssetRoot || (sheetSourceFile ? path.dirname(sheetSourceFile) : null)

    for (const rawRecord of sheet.records) {
      if (!isRecord(rawRecord)) continue
      const model = cleanString(rawRecord["器件型号"])
      if (!model || model === "model") continue
      setUniqueModel(byModel, model, {
        assetRoot,
        record: rawRecord,
        sheetName: cleanString(sheet.name),
      })
    }
  }

  return { byModel, sourcePath }
}

function templateCsvModelFromBomItem(item: JsonRecord) {
  const direct = cleanString(item.template_csv_model)
  if (direct) return direct

  const sourceRef = isRecord(item.source_ref) ? item.source_ref : {}
  return cleanString(sourceRef.template_csv_model) || cleanString(sourceRef.template_model)
}

function resolveAssetPath(assetRoot: string | null, value: unknown) {
  const rawPath = cleanString(value)
  if (!rawPath) return null
  if (path.isAbsolute(rawPath)) return rawPath
  return assetRoot ? path.join(assetRoot, rawPath) : rawPath
}

function assetExists(pathValue: string | null) {
  return Boolean(pathValue)
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function firstNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value !== "string") return null
  const match = value.match(/-?\d+(?:\.\d+)?/u)
  return match ? Number.parseFloat(match[0]) : null
}

function sizeMmFromRecord(record: JsonRecord) {
  const values = [record["长 mm"], record["宽 mm"], record["高 mm"]].map(finiteNumber)
  return values.every((value): value is number => value !== null) ? values : null
}

function displayInfoFromThermalRecord(match: ThermalDbRecord) {
  const record = match.record
  const imagePath = resolveAssetPath(match.assetRoot, record["图片路径"])
  const cadPath = resolveAssetPath(match.assetRoot, record["CAD路径"])
  const cadRotatedPath = resolveAssetPath(
    match.assetRoot,
    record["CAD_rotated_path"] ?? record["Rotated CAD Path"],
  )
  const datasheetPath = resolveAssetPath(match.assetRoot, record["datasheet path"])

  return {
    semantic_name: record["器件ID"] ?? null,
    model: record["器件型号"] ?? null,
    name: record["器件名称"] ?? null,
    name_cn: record["器件名称(中文)"] ?? null,
    kind: record["器件种类"] ?? null,
    subsystem: record["所属分系统"] ?? null,
    source: record["器件来源"] ?? null,
    workbook_sheet: match.sheetName,
    description: record["描述 / 用途说明）"] ?? null,
    shape: record["外形"] ?? null,
    dimensions: record["尺寸"] ?? null,
    mass_g: record["质量 g"] ?? null,
    power_main: record["主模式功耗"] ?? null,
    power_calibration: record["校准模式功耗"] ?? null,
    power_cooling: record["冷却系统功耗"] ?? null,
    operating_voltage: record["工作电压"] ?? null,
    material: record["核心材料"] ?? null,
    mount_face: record["安装面"] ?? null,
    thermal: {
      conductivity_W_mK: record["导热率W/(m·K)"] ?? null,
      emissivity: record["辐射率"] ?? null,
      thermal_resistance_K_W: record["热阻K/W"] ?? null,
      contact_resistance_K_W: record["接触热阻K/W"] ?? null,
      specific_heat_J_kgK: record["比热容J/(kg·K)"] ?? null,
      max_temp: record["最高工作温度"] ?? null,
      min_temp: record["最低工作温度"] ?? null,
      storage_temp_range: record["储存温度范围"] ?? null,
    },
    assets: {
      image_path: imagePath,
      image_path_exists: assetExists(imagePath),
      cad_path: cadPath,
      cad_path_exists: assetExists(cadPath),
      cad_rotated_path: cadRotatedPath,
      cad_rotated_path_exists: assetExists(cadRotatedPath),
      datasheet_path: datasheetPath,
      datasheet_path_exists: assetExists(datasheetPath),
    },
  }
}

function excelAndCadFromThermalRecord(match: ThermalDbRecord) {
  const record = match.record
  const displayInfo = displayInfoFromThermalRecord(match)
  return {
    thermal_db_component_id: record["器件ID"] ?? null,
    excel_model: record["器件型号"] ?? null,
    excel_name: record["器件名称"] ?? null,
    excel_name_cn: record["器件名称(中文)"] ?? null,
    excel_kind: record["器件种类"] ?? null,
    excel_subsystem: record["所属分系统"] ?? null,
    excel_source: record["器件来源"] ?? null,
    excel_description: record["描述 / 用途说明）"] ?? null,
    excel_dimensions: record["尺寸"] ?? null,
    excel_material: record["核心材料"] ?? null,
    excel_mount_face: record["安装面"] ?? null,
    ...displayInfo.assets,
  }
}

function enrichRealBomPayload(payload: unknown, index: ThermalDbIndex | null) {
  if (!index || !isRecord(payload) || !Array.isArray(payload.items)) return payload

  const unmatchedKeys: string[] = []
  let ambiguousRecords = 0
  let matchedRecords = 0
  let missingRecords = 0

  const items = payload.items.map((rawItem) => {
    if (!isRecord(rawItem)) return rawItem
    const lookupKey = templateCsvModelFromBomItem(rawItem)
    if (!lookupKey) return rawItem

    const match = index.byModel.get(lookupKey)
    if (match === null) {
      ambiguousRecords += 1
      unmatchedKeys.push(lookupKey)
      return rawItem
    }
    if (!match) {
      missingRecords += 1
      unmatchedKeys.push(lookupKey)
      return rawItem
    }

    matchedRecords += 1
    const record = match.record
    const massG = finiteNumber(record["质量 g"])
    const powerW = firstNumber(record["主模式功耗"])
    const sizeMm = sizeMmFromRecord(record)

    return {
      ...rawItem,
      ...(massG !== null ? { mass_kg: massG / 1000 } : {}),
      ...(powerW !== null ? { power_W: powerW } : {}),
      ...(sizeMm ? { size_mm: sizeMm } : {}),
      thermal_db_component_id: record["器件ID"] ?? rawItem.thermal_db_component_id,
      display_info: {
        ...(isRecord(rawItem.display_info) ? rawItem.display_info : {}),
        ...displayInfoFromThermalRecord(match),
      },
      excel_and_cad: {
        ...(isRecord(rawItem.excel_and_cad) ? rawItem.excel_and_cad : {}),
        ...excelAndCadFromThermalRecord(match),
      },
    }
  })

  return {
    ...payload,
    items,
    total_records: items.length,
    matched_records: matchedRecords,
    missing_records: missingRecords,
    bom_lookup: {
      ambiguous_records: ambiguousRecords,
      database_path: index.sourcePath,
      matched_records: matchedRecords,
      missing_records: missingRecords,
      unmatched_keys: Array.from(new Set(unmatchedKeys)).slice(0, 50),
    },
  }
}

export function registerWorkspaceDataRoutes(fastify: FastifyInstance, { config }: { config: AppConfig }) {
  workspaceFileLimits = {
    filePreviewMaxBytes: config.workspace.filePreviewMaxBytes,
    textChunkBytes: config.workspace.textChunkBytes,
    textChunkMaxBytes: config.workspace.textChunkMaxBytes,
    textFileMaxBytes: config.workspace.textFileMaxBytes,
  }
  fastify.get<{ Querystring: WorkspaceFilesQuery }>("/api/workspace/files/tree", async (req, reply) => {
    try {
      const workspaceDir = await resolveQueryWorkspaceDir(req.query)
      reply.header("Cache-Control", "no-cache")
      return reply.send(await readWorkspaceDirectoryEntries(workspaceDir, req.query.relativePath))
    } catch (err) {
      return replyWithWorkspaceQueryError(reply, err, "failed to resolve workspace files")
    }
  })

  fastify.get<{ Querystring: WorkspaceFileContentQuery }>("/api/workspace/files/content", async (req, reply) => {
    try {
      const workspaceDir = await resolveQueryWorkspaceDir(req.query)
      reply.header("Cache-Control", "no-cache")
      return reply.send(await readWorkspaceFileContent(workspaceDir, req.query.relativePath))
    } catch (err) {
      return replyWithWorkspaceQueryError(reply, err, "failed to resolve workspace file")
    }
  })

  fastify.get<{ Querystring: ComplianceCheckMissingItemsQuery }>("/api/workspace/derating/missing-items", async (req, reply) => {
    try {
      const workspaceDir = await resolveQueryWorkspaceDir(req.query)
      reply.header("Cache-Control", "no-cache")
      return reply.send(await readComplianceCheckMissingItems(workspaceDir))
    } catch (err) {
      return replyWithWorkspaceQueryError(reply, err, "failed to resolve derating missing items")
    }
  })

  fastify.put<{ Body: ComplianceCheckMissingItemsBody; Querystring: ComplianceCheckMissingItemsQuery }>("/api/workspace/derating/missing-items", async (req, reply) => {
    try {
      const workspaceDir = await resolveQueryWorkspaceDir(req.query)
      reply.header("Cache-Control", "no-cache")
      return reply.send(await writeComplianceCheckMissingItems(workspaceDir, req.body ?? {}))
    } catch (err) {
      return replyWithWorkspaceQueryError(reply, err, "failed to save derating missing items")
    }
  })

  fastify.get<{ Querystring: ComplianceCheckResultQuery }>("/api/workspace/derating/check-result", async (req, reply) => {
    try {
      const workspaceDir = await resolveQueryWorkspaceDir(req.query)
      reply.header("Cache-Control", "no-cache")
      return reply.send(await readComplianceCheckResult(workspaceDir))
    } catch (err) {
      return replyWithWorkspaceQueryError(reply, err, "failed to resolve derating check result")
    }
  })

  fastify.put<{ Body: ComplianceCheckResultBody; Querystring: ComplianceCheckResultQuery }>("/api/workspace/derating/check-result", async (req, reply) => {
    try {
      const workspaceDir = await resolveQueryWorkspaceDir(req.query)
      reply.header("Cache-Control", "no-cache")
      return reply.send(await writeComplianceCheckResult(workspaceDir, req.body ?? {}))
    } catch (err) {
      return replyWithWorkspaceQueryError(reply, err, "failed to save derating check result")
    }
  })

  fastify.get<{ Params: { artifact: string }; Querystring: ComplianceArtifactQuery }>(
    "/api/workspace/compliance/artifact/:artifact",
    async (req, reply) => {
      try {
        const workspaceDir = await resolveQueryWorkspaceDir(req.query)
        reply.header("Cache-Control", "no-cache")
        return reply.send(await readComplianceArtifact(workspaceDir, req.params.artifact))
      } catch (err) {
        return replyWithWorkspaceQueryError(reply, err, "failed to resolve compliance artifact")
      }
    }
  )

  fastify.put<{ Body: ComplianceArtifactBody; Params: { artifact: string }; Querystring: ComplianceArtifactQuery }>(
    "/api/workspace/compliance/artifact/:artifact",
    async (req, reply) => {
      try {
        const workspaceDir = await resolveQueryWorkspaceDir(req.query)
        reply.header("Cache-Control", "no-cache")
        return reply.send(await writeComplianceArtifact(workspaceDir, req.params.artifact, req.body ?? {}))
      } catch (err) {
        return replyWithWorkspaceQueryError(reply, err, "failed to save compliance artifact")
      }
    }
  )

  fastify.get<{ Querystring: WorkspaceTextFileQuery }>("/api/workspace/files/text", async (req, reply) => {
    try {
      const workspaceDir = await resolveQueryWorkspaceDir(req.query)
      reply.header("Cache-Control", "no-cache")
      return reply.send(await readWorkspaceTextFile(workspaceDir, req.query.relativePath, req.query.maxBytes))
    } catch (err) {
      return replyWithWorkspaceQueryError(reply, err, "failed to read workspace text file")
    }
  })

  fastify.get<{ Querystring: WorkspaceTextChunkQuery }>("/api/workspace/files/text-chunk", async (req, reply) => {
    try {
      const workspaceDir = await resolveQueryWorkspaceDir(req.query)
      reply.header("Cache-Control", "no-cache")
      return reply.send(await readWorkspaceTextChunk(workspaceDir, req.query.relativePath, req.query.offset, req.query.length))
    } catch (err) {
      return replyWithWorkspaceQueryError(reply, err, "failed to read workspace text chunk")
    }
  })

  fastify.get<{ Querystring: WorkspaceQuery }>("/api/workspace/files/archive", async (req, reply) => {
    try {
      const workspaceDir = await resolveQueryWorkspaceDir(req.query)
      const stat = await fs.stat(workspaceDir).catch(() => null)
      if (!stat?.isDirectory()) {
        return reply.status(404).send({ error: "workspace directory not found" })
      }

      const archiveName = `${safeArchiveBaseName(req.query, workspaceDir)}.zip`
      const zip = spawn("zip", ["-r", "-", "."], {
        cwd: workspaceDir,
        stdio: ["ignore", "pipe", "pipe"],
      })
      let stderr = ""
      zip.stderr.setEncoding("utf-8")
      zip.stderr.on("data", chunk => {
        stderr += String(chunk)
      })
      zip.on("error", err => {
        req.log.error({ err, workspaceDir }, "workspace archive process failed")
      })
      zip.on("close", code => {
        if (code !== 0) {
          req.log.error({ code, stderr: stderr.slice(0, 2000), workspaceDir }, "workspace archive process exited with failure")
        }
      })

      reply.header("Cache-Control", "no-cache")
      reply.header("Content-Type", "application/zip")
      reply.header("Content-Disposition", `attachment; filename="${archiveName}"`)
      return reply.send(zip.stdout)
    } catch (err) {
      return replyWithWorkspaceQueryError(reply, err, "failed to archive workspace files")
    }
  })

  fastify.get<{ Querystring: WorkspaceQuery }>("/api/workspace/component-info", async (req, reply) => {
    try {
      const workspaceDir = await resolveQueryWorkspaceDir(req.query)
      const componentInfoPath = path.join(workspaceDir, DEFAULT_GEOM_COMPONENT_INFO_RELATIVE_PATH)
      const raw = await fs.readFile(componentInfoPath, "utf-8").catch(() => null)

      if (raw === null) {
        return reply.status(404).send({ error: "component info data not found" })
      }

      const stat = await fs.stat(componentInfoPath)

      reply.header("Cache-Control", "no-cache")
      return reply.send({
        ...JSON.parse(raw),
        source_path: componentInfoPath,
        source_version: [componentInfoPath, stat.mtimeMs, stat.size].join(":"),
      })
    } catch (err) {
      return replyWithWorkspaceQueryError(reply, err, "failed to resolve component info data")
    }
  })

  fastify.get<{ Querystring: WorkspaceQuery }>("/api/workspace/bom", async (req, reply) => {
    try {
      const workspaceDir = await resolveQueryWorkspaceDir(req.query)
      const candidatePaths = [
        path.join(workspaceDir, DEFAULT_BOM_INFO_RELATIVE_PATH),
        path.join(workspaceDir, DEFAULT_REAL_BOM_RELATIVE_PATH),
      ]

      let bomInfoPath: string | null = null
      let raw: string | null = null
      for (const candidatePath of candidatePaths) {
        raw = await fs.readFile(candidatePath, "utf-8").catch(() => null)
        if (raw !== null) {
          bomInfoPath = candidatePath
          break
        }
      }

      if (!bomInfoPath || raw === null) {
        reply.header("Cache-Control", "no-cache")
        return reply.send({
          bom_id: "-",
          components: [],
          matched_records: 0,
          missing_records: 0,
          schema_version: "-",
          source_path: "",
          source_version: "",
          total_records: 0,
        })
      }

      const stat = await fs.stat(bomInfoPath)
      const payload = JSON.parse(raw) as unknown
      const isRealBom = path.basename(bomInfoPath) === path.basename(DEFAULT_REAL_BOM_RELATIVE_PATH)
      const responsePayload = isRealBom
        ? enrichRealBomPayload(payload, await loadThermalDbIndex())
        : payload

      reply.header("Cache-Control", "no-cache")
      return reply.send({
        ...(isRecord(responsePayload) ? responsePayload : {}),
        source_path: bomInfoPath,
        source_version: [bomInfoPath, stat.mtimeMs, stat.size].join(":"),
      })
    } catch (err) {
      return replyWithWorkspaceQueryError(reply, err, "failed to resolve BOM data")
    }
  })

  fastify.get<{ Querystring: WorkspaceProgressQuery }>("/api/workspace/progress", async (req, reply) => {
    try {
      const workspaceDir = await resolveQueryWorkspaceDir(req.query)

      let workspaceProgress: WorkspaceProgressData | null = null
      let progressPath = path.join(workspaceDir, AIGNC_PROGRESS_RELATIVE_PATH)
      let progressStat: { mtime: Date; mtimeMs: number; size: number } | null = null
      try {
        const progressResult = await readFirstWorkspaceProgress(workspaceDir)
        progressPath = progressResult.progressPath
        progressStat = progressResult.stat
        workspaceProgress = progressResult.workspaceProgress
      } catch {
        reply.header("Cache-Control", "no-cache")
        return reply.send({
          exists: false,
          data: null,
          error: "progress json is not valid yet",
          source_path: progressPath,
          source_version: progressStat ? [progressPath, progressStat.mtimeMs, progressStat.size].join(":") : null,
          updated_at: progressStat?.mtime.toISOString() ?? null,
        })
      }

      reply.header("Cache-Control", "no-cache")
      if (!workspaceProgress) {
        if (isNonEmptyString(req.query.sessionId)) {
          const sessionProgress = await resolveProgressFromLatestSessionRun(req.query.sessionId, workspaceDir)
          if (sessionProgress) {
            return reply.send({
              exists: true,
              data: sessionProgress.data,
              source_path: sessionProgress.sourcePath,
              source_version: sessionProgress.sourceVersion,
            })
          }
        }
        return reply.send({
          exists: false,
          data: null,
          source_path: progressPath,
          source_version: null,
        })
      }

      return reply.send({
        exists: true,
        data: workspaceProgress.data,
        source_path: workspaceProgress.sourcePath,
        source_version: workspaceProgress.sourceVersion,
        updated_at: workspaceProgress.updatedAt,
      })
    } catch (err) {
      return replyWithWorkspaceQueryError(reply, err, "failed to resolve workspace progress data")
    }
  })

  fastify.get<{ Querystring: WorkspaceQuery }>(
    "/api/workspace/temperature-field",
    async (req, reply) => {
      try {
        const workspaceDir = (await resolveQueryWorkspaceContext(req.query)).workspaceDir
        const fieldPath = resolveScopedWorkspaceFilePath(DEFAULT_TEMPERATURE_FIELD_RELATIVE_PATH, workspaceDir)
        if (!fieldPath) {
          return reply.status(404).send({ error: "temperature field not found" })
        }

        const data = parseComsolTemperatureData(await fs.readFile(fieldPath, "utf-8"), fieldPath)
        reply.header("Content-Type", "application/json; charset=utf-8")
        reply.header("Cache-Control", "no-cache")
        return reply.send(data)
      } catch (err) {
        if (err instanceof WorkspaceQueryError) {
          return reply.status(err.statusCode).send({ error: err.message })
        }
        return reply.status(404).send({ error: "temperature field not found" })
      }
    },
  )
}
