import { FastifyInstance } from "fastify"
import fs from "fs/promises"
import path from "path"
import { pinyin } from "pinyin-pro"
import { Client } from "pg"
import { spawn } from "child_process"
import { fileURLToPath } from "url"
import type { AppConfig } from "../config.js"
import { isPathInside } from "../shared/index.js"
import { readCatchSupportingTable, writeAndRefreshCatchSupportingTable } from "./catchSupportingTable.js"
import { resolveProgressFromLatestSessionRun } from "./workspaceRegistry.js"
import { resolveScopedWorkspaceFilePath } from "./workspaceFiles.js"
import {
  isNonEmptyString,
  replyWithWorkspaceQueryError,
  resolveQueryWorkspaceContext,
  resolveQueryWorkspaceDir,
  WorkspaceQueryError,
} from "./workspaceQuery.js"
import { resolveWorkspaceTemplateRoot } from "./workspacePaths.js"

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
type ManufacturerFullNameBody = {
  full_name?: unknown
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

const OFFICE_FILE_MIME_TYPES = new Map([
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
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
const DEFAULT_CAD_BUILD_SPEC_RELATIVE_PATH = path.join("00_inputs", "cad_build_spec.json")
const CATCH_SUPPORTING_TABLE_RELATIVE_PATH = path.join("00_inputs", "CATCH整星配套表.xlsx")
const LEGACY_CATCH_SUPPORTING_TABLE_TEMPLATE_RELATIVE_PATH = path.join("catch_task", "CATCH整星配套表.xlsx")
const CATCH_SUPPORTING_TEMPLATE_RELATIVE_PATH = path.join("data", "input_data", "thermal_catch", "00_inputs")
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
const CONFIRMED_RESULTS_RELATIVE_PATH = path.join(COMPLIANCE_OUTPUT_RELATIVE_PATH, "confirmed_results.json")
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
  "reliability_query",
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
const TEMPERATURE_SURFACE_THREEJS_RELATIVE_PATH = "02_sim/postprocess/temperature_surface_threejs.json"
const TEMPERATURE_SURFACE_THREEJS_MAX_BYTES = 64 * 1024 * 1024

let workspaceFileLimits = {
  filePreviewMaxBytes: 1024 * 1024,
  textChunkBytes: 512 * 1024,
  textChunkMaxBytes: 1024 * 1024,
  textFileMaxBytes: 64 * 1024 * 1024,
}

type TemperaturePoint = {
  temperature: number
  x: number
  y: number
  z: number
}

type JsonRecord = Record<string, unknown>

type ManufacturerDatabaseConfig = AppConfig["compliance"]["database"]

function manufacturerPinyinSortKey(value: string) {
  const initials = pinyin(value, { pattern: "first", toneType: "none", type: "array" }).join("")
  const fullPinyin = pinyin(value, { toneType: "none", type: "array" }).join("")
  return `${initials}|${fullPinyin}|${value.toLowerCase()}`
}

function compareChinesePinyin(left: string, right: string) {
  return manufacturerPinyinSortKey(left).localeCompare(manufacturerPinyinSortKey(right), "en", { numeric: true })
}

async function withManufacturerDb<T>(config: ManufacturerDatabaseConfig, fn: (client: Client) => Promise<T>) {
  const client = new Client({
    database: config.reliability.db,
    host: config.host,
    password: config.password,
    port: Number(config.port),
    user: config.user,
  })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

async function readManufacturerFullNameOptions(config: ManufacturerDatabaseConfig): Promise<string[]> {
  return withManufacturerDb(config, async client => {
    return readManufacturerFullNamesFromClient(client)
  })
}

async function addManufacturerFullName(config: ManufacturerDatabaseConfig, body: ManufacturerFullNameBody) {
  const fullName = cleanString(body.full_name)
  if (!isValidManufacturerFullName(fullName)) {
    throw new WorkspaceQueryError("manufacturer full name is required", 400)
  }

  return withManufacturerDb(config, async client => {
    const existing = await client.query<{ id: string }>(
      "select id::text as id from public.manufacturer where full_name = $1 limit 1",
      [fullName],
    )
    const beforeSize = existing.rowCount ?? 0
    if (beforeSize === 0) {
      await client.query(
        "insert into public.manufacturer (full_name, main_products) values ($1, '')",
        [fullName],
      )
    }
    return {
      added: beforeSize === 0,
      full_names: await readManufacturerFullNamesFromClient(client),
    }
  })
}

async function readManufacturerFullNamesFromClient(client: Client): Promise<string[]> {
  const result = await client.query<{ full_name: string }>(`
    select full_name::text as full_name
    from public.manufacturer
    where full_name is not null and btrim(full_name::text) <> ''
    order by full_name
  `)
  return [...new Set(result.rows.map(row => cleanString(row.full_name)).filter(isNonEmptyString))]
    .sort(compareChinesePinyin)
}

async function saveManufacturerAliases(config: ManufacturerDatabaseConfig, rows: JsonRecord[]) {
  const aliasRows = rows
    .map(row => ({
      alias: cleanString(row["厂商简称"]) || cleanString(row["厂商名称"]) || cleanString(row.manufacturer),
      fullName: cleanString(row["厂商全称"]) || cleanString(row.full_name),
    }))
    .filter(row => row.alias && isValidManufacturerFullName(row.fullName))
  if (aliasRows.length === 0) return

  await withManufacturerDb(config, async client => {
    for (const row of aliasRows) {
      const manufacturer = await client.query<{ id: string }>(
        "select id::text as id from public.manufacturer where full_name = $1 limit 1",
        [row.fullName],
      )
      if ((manufacturer.rowCount ?? 0) === 0) {
        throw new WorkspaceQueryError("manufacturer full name must exist in manufacturer database", 400)
      }
      await upsertManufacturerAlias(client, row.alias, manufacturer.rows[0].id)
    }
  })
}

async function assertKnownManufacturerFullNames(config: ManufacturerDatabaseConfig, artifact: string, rows: JsonRecord[]) {
  if (artifact !== "manufacturer_check") return
  let knownFullNames: Set<string> | null = null
  for (const row of rows) {
    const fullName = cleanString(row["厂商全称"]) || cleanString(row.full_name)
    const hasFullName = isValidManufacturerFullName(fullName)
    const origin = cleanString(row["国产/进口"]) || cleanString(row.origin)
    const catalogStatus = cleanString(row["目录内或外"]) || cleanString(row.catalog_status)
    if (!hasFullName && catalogStatus !== "目录内") continue
    knownFullNames ??= new Set(await readManufacturerFullNameOptions(config))
    if (hasFullName && !knownFullNames.has(fullName)) {
      throw new WorkspaceQueryError("manufacturer full name must exist in manufacturer database", 400)
    }
    if (hasFullName && origin === "进口") {
      throw new WorkspaceQueryError("imported manufacturers cannot use catalog full names", 400)
    }
    if (catalogStatus === "目录内" && !hasFullName) {
      throw new WorkspaceQueryError("catalog manufacturer full name is required for in-catalog manufacturers", 400)
    }
  }
}

async function upsertManufacturerAlias(client: Client, alias: string, manufacturerId: string) {
  const existing = await client.query<{ id: string }>(
    "select id::text as id from public.manufacturer_alias where alias_name = $1 limit 1",
    [alias],
  )
  if ((existing.rowCount ?? 0) > 0) {
    await client.query(
      "update public.manufacturer_alias set manufacturer_id = $2 where alias_name = $1",
      [alias, manufacturerId],
    )
    return
  }
  await client.query(
    "insert into public.manufacturer_alias (alias_name, manufacturer_id) values ($1, $2)",
    [alias, manufacturerId],
  )
}

type ThermalDbRecord = {
  assetRoot: string | null
  record: JsonRecord
  sheetName: string
}

type ThermalDbIndex = {
  byModel: Map<string, ThermalDbRecord | null>
  sourcePath: string
}

type CadComponentDisplayNamePayload = {
  components: Array<{
    component_id: string
    dimensions?: string
    display_name: string
    kind?: string
    model_name?: string
    semantic_name?: string
    subsystem?: string
  }>
  schema_version: string
  source_path: string
  source_version: string
}

const WORKSPACE_DATA_ROUTES_DIR = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT_DIR = path.resolve(WORKSPACE_DATA_ROUTES_DIR, "..", "..", "..")

type CatchSupportingTableBody = {
  rows?: unknown
}

type HeatfluxSelectionBody = {
  season?: unknown
  time?: unknown
}

const HEATFLUX_OUTPUT_RELATIVE_DIR = path.join("00_inputs", "heatflux")
const HEATFLUX_SELECTED_JSON_RELATIVE_PATH = path.join(HEATFLUX_OUTPUT_RELATIVE_DIR, "selected_heatflux.json")
const HEATFLUX_CURVE_IMAGE_RELATIVE_PATH = path.join(HEATFLUX_OUTPUT_RELATIVE_DIR, "heatflux_curve.png")
const HEATFLUX_MARKED_CURVE_RELATIVE_PATH = path.join(HEATFLUX_OUTPUT_RELATIVE_DIR, "heatflux_curve_marked.svg")
const HEATFLUX_DATA_RELATIVE_DIR = path.join("data", "heatflux")
const HEATFLUX_TEMPLATE_RELATIVE_DIR = path.join("00_inputs", "heatflux")
const HEATFLUX_FACE_NAMES = ["+X", "-X", "+Y", "-Y", "+Z", "-Z"] as const
const HEATFLUX_MU_EARTH = 3.986004418e14
const HEATFLUX_R_EARTH = 6378137.0
const HEATFLUX_ALTITUDE = 600_000.0
const HEATFLUX_FACE_COLORS: Record<typeof HEATFLUX_FACE_NAMES[number], string> = {
  "+X": "#1f77b4",
  "-X": "#ff7f0e",
  "+Y": "#2ca02c",
  "-Y": "#d62728",
  "+Z": "#9467bd",
  "-Z": "#8c564b",
}
const HEATFLUX_SEASON_OPTIONS = {
  "春分": {
    figureRelativePath: path.join("results", "fig_5_5_dawn_dusk_spring.png"),
    key: "spring",
    seriesRelativePath: path.join("orekit", "exported_data", "dawn_dusk_spring_timeseries.csv"),
  },
  "夏至": {
    figureRelativePath: path.join("results", "fig_5_6_dawn_dusk_summer.png"),
    key: "summer",
    seriesRelativePath: path.join("orekit", "exported_data", "dawn_dusk_summer_timeseries.csv"),
  },
  "秋分": {
    figureRelativePath: path.join("results", "fig_5_7_dawn_dusk_autumn.png"),
    key: "autumn",
    seriesRelativePath: path.join("orekit", "exported_data", "dawn_dusk_autumn_timeseries.csv"),
  },
  "冬至": {
    figureRelativePath: path.join("results", "fig_5_8_dawn_dusk_winter.png"),
    key: "winter",
    seriesRelativePath: path.join("orekit", "exported_data", "dawn_dusk_winter_timeseries.csv"),
  },
} as const

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
      : OFFICE_FILE_MIME_TYPES.get(extension) ?? (extension === ".png"
          ? "image/png"
          : extension === ".jpg" || extension === ".jpeg"
            ? "image/jpeg"
            : extension === ".webp"
              ? "image/webp"
              : extension === ".gif"
                ? "image/gif"
                : TEXT_FILE_EXTENSIONS.has(extension)
                  ? "text/plain"
                  : "application/octet-stream")
  const isImage = mimeType.startsWith("image/")
  const isText = mimeType.startsWith("text/") || mimeType === "application/json"
  const isOfficePreview = OFFICE_FILE_MIME_TYPES.has(extension)

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

  if (isOfficePreview && stat.size <= workspaceFileLimits.filePreviewMaxBytes) {
    const data = await fs.readFile(targetPath)
    return {
      contentBase64: data.toString("base64"),
      encoding: "base64",
      mimeType,
      mtimeMs: stat.mtimeMs,
      name: path.basename(targetPath),
      relativePath: normalizedRelativePath,
      size: stat.size,
      type: "binary",
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
  const configuredMaxBytes = normalizedRelativePath === TEMPERATURE_SURFACE_THREEJS_RELATIVE_PATH
    ? Math.max(workspaceFileLimits.textFileMaxBytes, TEMPERATURE_SURFACE_THREEJS_MAX_BYTES)
    : workspaceFileLimits.textFileMaxBytes
  const maxBytes = Number.isFinite(requestedMaxBytes) && requestedMaxBytes > 0
    ? Math.min(requestedMaxBytes, configuredMaxBytes)
    : configuredMaxBytes
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

function resolveRepoRoot() {
  return path.resolve(WORKSPACE_DATA_ROUTES_DIR, "..", "..", "..")
}

function normalizeCatchSupportingRows(value: unknown) {
  if (!Array.isArray(value)) {
    throw new WorkspaceQueryError("rows array is required", 400)
  }
  return value.map(row => {
    if (!isRecord(row)) throw new WorkspaceQueryError("each row must be an object", 400)
    return row
  })
}

function parseHeatfluxTimeSeconds(value: unknown) {
  const text = cleanString(value)
  const match = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/u)
  if (!match) {
    throw new WorkspaceQueryError("time must use HH:mm or HH:mm:ss", 400)
  }

  const hours = Number.parseInt(match[1], 10)
  const minutes = Number.parseInt(match[2], 10)
  const seconds = Number.parseInt(match[3] ?? "0", 10)
  if (hours < 0 || hours > 23 || minutes > 59 || seconds > 59) {
    throw new WorkspaceQueryError("time is out of range", 400)
  }
  return hours * 3600 + minutes * 60 + seconds
}

function formatHeatfluxTime(secondsValue: number) {
  const seconds = Math.max(0, Math.round(secondsValue))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = seconds % 60
  return [hours, minutes, remainingSeconds]
    .map(value => String(value).padStart(2, "0"))
    .join(":")
}

function parseCsvLine(line: string) {
  const cells: string[] = []
  let current = ""
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (char === "," && !quoted) {
      cells.push(current)
      current = ""
    } else {
      current += char
    }
  }
  cells.push(current)
  return cells
}

async function resolveHeatfluxRoot(workspaceDir: string, config: AppConfig) {
  const templateRoot = resolveWorkspaceTemplateRoot(config)
  const workspaceRoot = path.basename(path.dirname(workspaceDir)) === "versions"
    ? path.dirname(path.dirname(workspaceDir))
    : workspaceDir
  const workspaceTemplateName = path.basename(workspaceRoot).replace(/^ws_/u, "")
  const candidateRoots = [
    path.join(resolveRepoRoot(), HEATFLUX_DATA_RELATIVE_DIR),
    path.join(templateRoot, workspaceTemplateName, HEATFLUX_TEMPLATE_RELATIVE_DIR),
    path.join(templateRoot, "thermal_catch", HEATFLUX_TEMPLATE_RELATIVE_DIR),
    path.join(templateRoot, "thermal", HEATFLUX_TEMPLATE_RELATIVE_DIR),
    path.join(resolveRepoRoot(), "data", "input_data", workspaceTemplateName, HEATFLUX_TEMPLATE_RELATIVE_DIR),
    path.join(resolveRepoRoot(), "data", "input_data", "thermal_catch", HEATFLUX_TEMPLATE_RELATIVE_DIR),
    path.join(resolveRepoRoot(), "data", "input_data", "thermal", HEATFLUX_TEMPLATE_RELATIVE_DIR),
    path.join(resolveRepoRoot(), "backend", "heatflux"),
  ]

  for (const candidateRoot of candidateRoots) {
    const stat = await fs.stat(candidateRoot).catch(() => null)
    if (stat?.isDirectory()) return candidateRoot
  }

  return candidateRoots[0]
}

function normalizeHeatfluxSeason(value: unknown) {
  const season = cleanString(value)
  if (!Object.prototype.hasOwnProperty.call(HEATFLUX_SEASON_OPTIONS, season)) {
    throw new WorkspaceQueryError("season must be one of 春分, 夏至, 秋分, 冬至", 400)
  }
  return season as keyof typeof HEATFLUX_SEASON_OPTIONS
}

function heatfluxOrbitPeriodSeconds() {
  const radius = HEATFLUX_R_EARTH + HEATFLUX_ALTITUDE
  return 2.0 * Math.PI * Math.sqrt(radius ** 3 / HEATFLUX_MU_EARTH)
}

function escapeSvgText(value: string) {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
}

function buildHeatfluxMarkedSvg({
  dataRows,
  matchedTimeS,
  phaseTimeS,
  season,
}: {
  dataRows: Array<{ faces: Record<typeof HEATFLUX_FACE_NAMES[number], number>; timeS: number }>
  matchedTimeS: number
  phaseTimeS: number
  season: string
}) {
  const width = 1080
  const height = 560
  const margin = { bottom: 64, left: 76, right: 150, top: 44 }
  const plotWidth = width - margin.left - margin.right
  const plotHeight = height - margin.top - margin.bottom
  const maxTimeS = Math.max(...dataRows.map(row => row.timeS))
  const maxFlux = Math.max(1, ...dataRows.flatMap(row => HEATFLUX_FACE_NAMES.map(face => row.faces[face])))
  const yMax = Math.ceil(maxFlux / 50) * 50
  const xScale = (timeS: number) => margin.left + (timeS / maxTimeS) * plotWidth
  const yScale = (value: number) => margin.top + plotHeight - (value / yMax) * plotHeight
  const yTicks = Array.from({ length: Math.floor(yMax / 50) + 1 }, (_, index) => index * 50)
  const xTicks = Array.from({ length: 6 }, (_, index) => index * 20)
  const linePath = (face: typeof HEATFLUX_FACE_NAMES[number]) => dataRows
    .map((row, index) => `${index === 0 ? "M" : "L"} ${xScale(row.timeS).toFixed(2)} ${yScale(row.faces[face]).toFixed(2)}`)
    .join(" ")
  const markerX = xScale(Math.max(0, Math.min(maxTimeS, matchedTimeS)))
  const markerLabel = `${formatHeatfluxTime(phaseTimeS)} / ${formatHeatfluxTime(matchedTimeS)}`

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Heat flux curve with selected time marker">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <text x="${width / 2}" y="22" text-anchor="middle" fill="#111827" font-family="Arial, sans-serif" font-size="15" font-weight="700">Dawn-dusk ${escapeSvgText(season)} Heat Flux</text>
  <g font-family="Arial, sans-serif" font-size="12" fill="#4b5563">
    ${yTicks.map(tick => `<line x1="${margin.left}" x2="${width - margin.right}" y1="${yScale(tick).toFixed(2)}" y2="${yScale(tick).toFixed(2)}" stroke="#e5e7eb"/><text x="${margin.left - 12}" y="${(yScale(tick) + 4).toFixed(2)}" text-anchor="end">${tick}</text>`).join("\n    ")}
    ${xTicks.map(minute => {
      const x = xScale(minute * 60)
      return `<line x1="${x.toFixed(2)}" x2="${x.toFixed(2)}" y1="${margin.top}" y2="${height - margin.bottom}" stroke="#f1f5f9"/><text x="${x.toFixed(2)}" y="${height - margin.bottom + 24}" text-anchor="middle">${minute}</text>`
    }).join("\n    ")}
  </g>
  <rect x="${margin.left}" y="${margin.top}" width="${plotWidth}" height="${plotHeight}" fill="none" stroke="#111827"/>
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
    ${HEATFLUX_FACE_NAMES.map(face => `<path d="${linePath(face)}" stroke="${HEATFLUX_FACE_COLORS[face]}" stroke-width="2.4"/>`).join("\n    ")}
  </g>
  <line x1="${markerX.toFixed(2)}" x2="${markerX.toFixed(2)}" y1="${margin.top}" y2="${height - margin.bottom}" stroke="#ef4444" stroke-width="2.6" stroke-dasharray="8 6"/>
  <circle cx="${markerX.toFixed(2)}" cy="${yScale(0).toFixed(2)}" r="4" fill="#ef4444"/>
  <g font-family="Arial, sans-serif">
    <rect x="${Math.min(markerX + 8, width - margin.right - 186).toFixed(2)}" y="${margin.top + 8}" width="178" height="42" rx="6" fill="#ffffff" stroke="#ef4444" opacity="0.96"/>
    <text x="${Math.min(markerX + 18, width - margin.right - 176).toFixed(2)}" y="${margin.top + 26}" fill="#991b1b" font-size="12" font-weight="700">selected phase</text>
    <text x="${Math.min(markerX + 18, width - margin.right - 176).toFixed(2)}" y="${margin.top + 43}" fill="#991b1b" font-size="12">${escapeSvgText(markerLabel)}</text>
  </g>
  <text x="${margin.left + plotWidth / 2}" y="${height - 20}" text-anchor="middle" fill="#374151" font-family="Arial, sans-serif" font-size="13">Orbit time / min</text>
  <text transform="translate(22 ${margin.top + plotHeight / 2}) rotate(-90)" text-anchor="middle" fill="#374151" font-family="Arial, sans-serif" font-size="13">Absorbed heat flux / W m^-2</text>
  <g font-family="Arial, sans-serif" font-size="12">
    ${HEATFLUX_FACE_NAMES.map((face, index) => {
      const x = width - margin.right + 28
      const y = margin.top + 18 + index * 24
      return `<line x1="${x}" x2="${x + 22}" y1="${y}" y2="${y}" stroke="${HEATFLUX_FACE_COLORS[face]}" stroke-width="3"/><text x="${x + 30}" y="${y + 4}" fill="#111827">${face}</text>`
    }).join("\n    ")}
  </g>
</svg>
`
}

async function readHeatfluxNearestRow(
  workspaceDir: string,
  config: AppConfig,
  season: keyof typeof HEATFLUX_SEASON_OPTIONS,
  requestedTimeS: number,
) {
  const heatfluxRoot = await resolveHeatfluxRoot(workspaceDir, config)
  const option = HEATFLUX_SEASON_OPTIONS[season]
  const csvPath = path.join(heatfluxRoot, option.seriesRelativePath)
  const raw = await fs.readFile(csvPath, "utf-8").catch(() => null)
  if (raw === null) {
    throw new WorkspaceQueryError("heatflux timeseries CSV not found", 404)
  }

  const lines = raw.split(/\r?\n/u).filter(line => line.trim())
  const headers = lines[0] ? parseCsvLine(lines[0]) : []
  const timeIndex = headers.indexOf("time_s")
  const faceIndexes = Object.fromEntries(HEATFLUX_FACE_NAMES.map(face => [face, headers.indexOf(face)])) as Record<typeof HEATFLUX_FACE_NAMES[number], number>
  if (timeIndex < 0 || HEATFLUX_FACE_NAMES.some(face => faceIndexes[face] < 0)) {
    throw new WorkspaceQueryError("heatflux timeseries CSV has invalid columns", 500)
  }

  const dataRows = lines.slice(1)
    .map(line => {
      const cells = parseCsvLine(line)
      const timeS = Number.parseFloat(cells[timeIndex] ?? "")
      if (!Number.isFinite(timeS)) return null
      const faces = Object.fromEntries(HEATFLUX_FACE_NAMES.map(face => {
        const value = Number.parseFloat(cells[faceIndexes[face]] ?? "")
        return [face, Number.isFinite(value) ? value : 0]
      })) as Record<typeof HEATFLUX_FACE_NAMES[number], number>
      return { cells, faces, timeS }
    })
    .filter((row): row is { cells: string[]; faces: Record<typeof HEATFLUX_FACE_NAMES[number], number>; timeS: number } => row !== null)
  if (dataRows.length === 0) {
    throw new WorkspaceQueryError("heatflux timeseries CSV has no usable rows", 500)
  }

  const orbitPeriodS = heatfluxOrbitPeriodSeconds()
  const phaseTimeS = orbitPeriodS > 0
    ? ((requestedTimeS % orbitPeriodS) + orbitPeriodS) % orbitPeriodS
    : requestedTimeS

  let best: { cells: string[]; faces: Record<typeof HEATFLUX_FACE_NAMES[number], number>; timeS: number } | null = null
  for (const row of dataRows) {
    if (!best || Math.abs(row.timeS - phaseTimeS) < Math.abs(best.timeS - phaseTimeS)) {
      best = row
    }
  }
  if (!best) {
    throw new WorkspaceQueryError("heatflux timeseries CSV has no usable rows", 500)
  }

  return {
    csvPath,
    dataRows,
    faces: best.faces,
    matchedTimeS: best.timeS,
    orbitPeriodS,
    phaseTimeS,
  }
}

async function writeHeatfluxSelection(workspaceDir: string, config: AppConfig, body: HeatfluxSelectionBody) {
  const season = normalizeHeatfluxSeason(body.season)
  const requestedTimeS = parseHeatfluxTimeSeconds(body.time)
  const option = HEATFLUX_SEASON_OPTIONS[season]
  const selected = await readHeatfluxNearestRow(workspaceDir, config, season, requestedTimeS)
  const outputDir = path.join(workspaceDir, HEATFLUX_OUTPUT_RELATIVE_DIR)
  const selectedJsonPath = path.join(workspaceDir, HEATFLUX_SELECTED_JSON_RELATIVE_PATH)
  const imagePath = path.join(workspaceDir, HEATFLUX_CURVE_IMAGE_RELATIVE_PATH)
  const markedImagePath = path.join(workspaceDir, HEATFLUX_MARKED_CURVE_RELATIVE_PATH)
  const heatfluxRoot = await resolveHeatfluxRoot(workspaceDir, config)
  const sourceImagePath = path.join(heatfluxRoot, option.figureRelativePath)
  const sourceImageStat = await fs.stat(sourceImagePath).catch(() => null)
  if (!sourceImageStat?.isFile()) {
    throw new WorkspaceQueryError("heatflux curve image not found", 404)
  }

  await fs.mkdir(outputDir, { recursive: true })
  await fs.copyFile(sourceImagePath, imagePath)
  await fs.writeFile(markedImagePath, buildHeatfluxMarkedSvg({
    dataRows: selected.dataRows,
    matchedTimeS: selected.matchedTimeS,
    phaseTimeS: selected.phaseTimeS,
    season,
  }), "utf-8")
  const updatedAt = new Date().toISOString()
  const payload = {
    schema_version: "1.0",
    orbit_type: "dawn_dusk",
    season,
    season_key: option.key,
    requested_time: formatHeatfluxTime(requestedTimeS),
    requested_time_s: requestedTimeS,
    orbit_phase_time: formatHeatfluxTime(selected.phaseTimeS),
    orbit_phase_time_s: selected.phaseTimeS,
    matched_time: formatHeatfluxTime(selected.matchedTimeS),
    matched_time_s: selected.matchedTimeS,
    orbit_period_s: selected.orbitPeriodS,
    units: {
      heat_flux: "W/m^2",
      time: "s",
    },
    faces: selected.faces,
    source: {
      csv_path: selected.csvPath,
      figure_path: sourceImagePath,
    },
    output: {
      image_relative_path: HEATFLUX_CURVE_IMAGE_RELATIVE_PATH.split(path.sep).join("/"),
      marked_image_relative_path: HEATFLUX_MARKED_CURVE_RELATIVE_PATH.split(path.sep).join("/"),
      json_relative_path: HEATFLUX_SELECTED_JSON_RELATIVE_PATH.split(path.sep).join("/"),
    },
    updated_at: updatedAt,
  }
  await fs.writeFile(selectedJsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8")
  const stat = await fs.stat(selectedJsonPath)

  return {
    ...payload,
    image_relative_path: HEATFLUX_MARKED_CURVE_RELATIVE_PATH.split(path.sep).join("/"),
    image_path: markedImagePath,
    image_url: `/api/image?path=${encodeURIComponent(markedImagePath)}`,
    json_relative_path: HEATFLUX_SELECTED_JSON_RELATIVE_PATH.split(path.sep).join("/"),
    original_image_relative_path: HEATFLUX_CURVE_IMAGE_RELATIVE_PATH.split(path.sep).join("/"),
    original_image_path: imagePath,
    json_path: selectedJsonPath,
    source_path: selectedJsonPath,
    source_version: [selectedJsonPath, stat.mtimeMs, stat.size].join(":"),
    workspace_dir: workspaceDir,
  }
}

async function firstExistingFile(paths: string[]) {
  for (const filePath of paths) {
    const stat = await fs.stat(filePath).catch(() => null)
    if (stat?.isFile()) return filePath
  }
  return null
}

async function ensureCatchSupportingTable(workspaceDir: string, config: AppConfig) {
  const tablePath = path.join(workspaceDir, CATCH_SUPPORTING_TABLE_RELATIVE_PATH)
  const existing = await fs.stat(tablePath).catch(() => null)
  if (existing?.isFile()) return tablePath

  const templateRoot = resolveWorkspaceTemplateRoot(config)
  const workspaceRoot = path.basename(path.dirname(workspaceDir)) === "versions"
    ? path.dirname(path.dirname(workspaceDir))
    : workspaceDir
  const workspaceTemplateName = path.basename(workspaceRoot).replace(/^ws_/u, "")
  const candidateTemplates = [
    path.join(templateRoot, workspaceTemplateName, CATCH_SUPPORTING_TABLE_RELATIVE_PATH),
    path.join(templateRoot, "thermal_catch", CATCH_SUPPORTING_TABLE_RELATIVE_PATH),
    path.join(templateRoot, "thermal", CATCH_SUPPORTING_TABLE_RELATIVE_PATH),
    path.join(templateRoot, LEGACY_CATCH_SUPPORTING_TABLE_TEMPLATE_RELATIVE_PATH),
    path.join(resolveRepoRoot(), "data", "input_data", workspaceTemplateName, CATCH_SUPPORTING_TABLE_RELATIVE_PATH),
    path.join(resolveRepoRoot(), "data", "input_data", "thermal_catch", CATCH_SUPPORTING_TABLE_RELATIVE_PATH),
    path.join(resolveRepoRoot(), "data", "input_data", "thermal", CATCH_SUPPORTING_TABLE_RELATIVE_PATH),
    path.join(resolveRepoRoot(), "data", "input_data", LEGACY_CATCH_SUPPORTING_TABLE_TEMPLATE_RELATIVE_PATH),
  ]
  const sourcePath = await firstExistingFile(candidateTemplates)
  if (!sourcePath) {
    throw new WorkspaceQueryError("CATCH supporting table template not found under input_data/*/00_inputs", 500)
  }
  await fs.mkdir(path.dirname(tablePath), { recursive: true })
  await fs.copyFile(sourcePath, tablePath)
  return tablePath
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

async function updateConfirmedResults(workspaceDir: string, stage: string, rows: JsonRecord[]) {
  if (stage === "manufacturer_check") return
  const confirmedPath = path.join(workspaceDir, CONFIRMED_RESULTS_RELATIVE_PATH)
  const existingRaw = await fs.readFile(confirmedPath, "utf-8").catch(() => null)
  const existing = existingRaw ? JSON.parse(existingRaw) as unknown : {}
  const existingStages = isRecord(existing) && isRecord(existing.stages) ? existing.stages : {}
  const updatedAt = new Date().toISOString()
  const nextPayload = {
    ...(isRecord(existing) ? existing : {}),
    schema_version: "1.0",
    updated_at: updatedAt,
    stages: {
      ...existingStages,
      [stage]: {
        rows,
        updated_at: updatedAt,
      },
    },
  }
  await fs.mkdir(path.dirname(confirmedPath), { recursive: true })
  await fs.writeFile(confirmedPath, `${JSON.stringify(nextPayload, null, 2)}\n`, "utf-8")
}

function isValidManufacturerFullName(value: string) {
  return Boolean(value && value !== "无" && !value.startsWith("未找到"))
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
  await updateConfirmedResults(workspaceDir, "derating_check", rows)
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

async function writeComplianceArtifact(workspaceDir: string, artifactValue: unknown, body: ComplianceArtifactBody, databaseConfig: ManufacturerDatabaseConfig) {
  const artifact = assertComplianceArtifact(artifactValue)
  if (!Array.isArray(body.rows)) {
    throw new WorkspaceQueryError("rows array is required", 400)
  }
  const resolvedFile = await resolveComplianceArtifactFile(workspaceDir, artifact)
  const rows = body.rows.filter(isRecord)
  await assertKnownManufacturerFullNames(databaseConfig, artifact, rows)
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
  await updateConfirmedResults(workspaceDir, artifact, rows)
  if (artifact === "manufacturer_check") {
    await saveManufacturerAliases(databaseConfig, rows)
  }
  return readComplianceArtifact(workspaceDir, artifact)
}

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function cleanNumberArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is number => typeof item === "number" && Number.isFinite(item))
    : []
}

function formatDimensionValue(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim()
  const values = cleanNumberArray(value)
  if (values.length === 0) return ""
  return values.map(item => Number.isInteger(item) ? String(item) : item.toFixed(3).replace(/\.?0+$/u, "")).join(" x ")
}

function pickCleanString(...values: unknown[]) {
  for (const value of values) {
    const text = cleanString(value)
    if (text) return text
  }
  return ""
}

async function readCadComponentDisplayNamesFromSpec(specPath: string): Promise<CadComponentDisplayNamePayload | null> {
  const raw = await fs.readFile(specPath, "utf-8").catch(() => null)
  if (raw === null) return null

  const stat = await fs.stat(specPath)
  const payload = JSON.parse(raw) as unknown
  const components = isRecord(payload) && Array.isArray(payload.components)
    ? payload.components
      .filter(isRecord)
      .map((component) => {
        const componentId = pickCleanString(component.id, component.component_id)
        const displayName = pickCleanString(component.display_name, component.semantic_name, componentId)
        return {
          component_id: componentId,
          dimensions: formatDimensionValue(component.dims ?? component.dimensions ?? component.size_mm),
          display_name: displayName,
          kind: pickCleanString(component.kind, component.type, component.component_type, component.component_subtype),
          model_name: pickCleanString(component.model, component.model_name, component.template_model),
          semantic_name: pickCleanString(component.semantic_name, componentId),
          subsystem: pickCleanString(component.subsystem, component.system, component.sub_system),
        }
      })
      .filter(component => component.component_id && component.display_name)
    : []

  return {
    components,
    schema_version: isRecord(payload) ? cleanString(payload.schema_version) || "1.0" : "1.0",
    source_path: specPath,
    source_version: [specPath, stat.mtimeMs, stat.size].join(":"),
  }
}

async function readCadComponentDisplayNamesFromRealBom(realBomPath: string): Promise<CadComponentDisplayNamePayload | null> {
  const raw = await fs.readFile(realBomPath, "utf-8").catch(() => null)
  if (raw === null) return null

  const stat = await fs.stat(realBomPath)
  const payload = JSON.parse(raw) as unknown
  const items = isRecord(payload) && Array.isArray(payload.items) ? payload.items.filter(isRecord) : []
  const components = items
    .map((item) => {
      const sourceRef = isRecord(item.source_ref) ? item.source_ref : {}
      const displayInfo = isRecord(item.display_info) ? item.display_info : {}
      const excelAndCad = isRecord(item.excel_and_cad) ? item.excel_and_cad : {}
      const componentId = pickCleanString(item.component_id, item.id)
      const displayName = pickCleanString(
        displayInfo.name_cn,
        displayInfo.name,
        sourceRef.display_name,
        sourceRef.selected_name,
        sourceRef.template_name,
        excelAndCad.excel_name_cn,
        excelAndCad.excel_name,
        item.name,
        item.semantic_name,
        componentId,
      )
      return {
        component_id: componentId,
        dimensions: formatDimensionValue(displayInfo.dimensions ?? excelAndCad.excel_dimensions ?? item.size_mm),
        display_name: displayName,
        kind: pickCleanString(displayInfo.kind, excelAndCad.excel_kind, sourceRef.selected_kind, sourceRef.template_kind, item.kind, item.component_subtype, item.category),
        model_name: pickCleanString(displayInfo.model, excelAndCad.excel_model, sourceRef.selected_model, sourceRef.template_model, sourceRef.template_csv_model, item.model),
        semantic_name: pickCleanString(displayInfo.semantic_name, item.semantic_name, componentId),
        subsystem: pickCleanString(displayInfo.subsystem, excelAndCad.excel_subsystem, item.subsystem),
      }
    })
    .filter(component => component.component_id && component.display_name)

  return {
    components,
    schema_version: isRecord(payload) ? cleanString(payload.schema_version) || "1.0" : "1.0",
    source_path: realBomPath,
    source_version: [realBomPath, stat.mtimeMs, stat.size].join(":"),
  }
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
    cad_local_mount_face: record["CAD_LOCAL_MOUNT_FACE"] ?? null,
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
    cad_local_mount_face: record["CAD_LOCAL_MOUNT_FACE"] ?? null,
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
        return reply.send(await writeComplianceArtifact(workspaceDir, req.params.artifact, req.body ?? {}, config.compliance.database))
      } catch (err) {
        return replyWithWorkspaceQueryError(reply, err, "failed to save compliance artifact")
      }
    }
  )

  fastify.get<{ Querystring: WorkspaceQuery }>("/api/workspace/compliance/manufacturer-full-names", async (req, reply) => {
    try {
      reply.header("Cache-Control", "no-cache")
      return reply.send({ full_names: await readManufacturerFullNameOptions(config.compliance.database) })
    } catch (err) {
      return replyWithWorkspaceQueryError(reply, err, "failed to resolve manufacturer full names")
    }
  })

  fastify.post<{ Body: ManufacturerFullNameBody }>("/api/workspace/compliance/manufacturer-full-names", async (req, reply) => {
    try {
      reply.header("Cache-Control", "no-cache")
      return reply.send(await addManufacturerFullName(config.compliance.database, req.body ?? {}))
    } catch (err) {
      return replyWithWorkspaceQueryError(reply, err, "failed to add manufacturer full name")
    }
  })

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

  fastify.get<{ Querystring: WorkspaceQuery }>("/api/workspace/cad-component-display-names", async (req, reply) => {
    try {
      const workspaceDir = await resolveQueryWorkspaceDir(req.query)
      const specPath = path.join(workspaceDir, DEFAULT_CAD_BUILD_SPEC_RELATIVE_PATH)
      const realBomPath = path.join(workspaceDir, DEFAULT_REAL_BOM_RELATIVE_PATH)
      const payload =
        await readCadComponentDisplayNamesFromSpec(specPath) ??
        await readCadComponentDisplayNamesFromRealBom(realBomPath)

      if (!payload) {
        reply.header("Cache-Control", "no-cache")
        return reply.send({
          components: [],
          schema_version: "-",
          source_path: "",
          source_version: "",
        })
      }

      reply.header("Cache-Control", "no-cache")
      return reply.send(payload)
    } catch (err) {
      return replyWithWorkspaceQueryError(reply, err, "failed to resolve CAD component display names")
    }
  })

  fastify.get<{ Querystring: WorkspaceQuery }>("/api/workspace/catch-supporting-table", async (req, reply) => {
    try {
      const workspaceDir = await resolveQueryWorkspaceDir(req.query)
      const tablePath = await ensureCatchSupportingTable(workspaceDir, config)
      const payload = await readCatchSupportingTable(tablePath, { workspaceDir })
      const stat = await fs.stat(tablePath)
      reply.header("Cache-Control", "no-cache")
      return reply.send({
        ...payload,
        source_path: tablePath,
        source_version: [tablePath, stat.mtimeMs, stat.size].join(":"),
      })
    } catch (err) {
      return replyWithWorkspaceQueryError(reply, err, "failed to read CATCH supporting table")
    }
  })

  fastify.put<{ Body: CatchSupportingTableBody; Querystring: WorkspaceQuery }>("/api/workspace/catch-supporting-table", async (req, reply) => {
    try {
      const workspaceDir = await resolveQueryWorkspaceDir(req.query)
      const rows = normalizeCatchSupportingRows(req.body?.rows)
      const tablePath = await ensureCatchSupportingTable(workspaceDir, config)
      const payload = await writeAndRefreshCatchSupportingTable({
        outputDir: path.join(workspaceDir, "00_inputs"),
        rows,
        workspaceDir,
        xlsxPath: tablePath,
      })
      const stat = await fs.stat(tablePath)
      reply.header("Cache-Control", "no-cache")
      return reply.send({
        ...payload,
        source_path: tablePath,
        source_version: [tablePath, stat.mtimeMs, stat.size].join(":"),
      })
    } catch (err) {
      return replyWithWorkspaceQueryError(reply, err, "failed to save CATCH supporting table")
    }
  })

  fastify.post<{ Body: HeatfluxSelectionBody; Querystring: WorkspaceQuery }>("/api/workspace/heatflux/selection", async (req, reply) => {
    try {
      const workspaceDir = await resolveQueryWorkspaceDir(req.query)
      reply.header("Cache-Control", "no-cache")
      return reply.send(await writeHeatfluxSelection(workspaceDir, config, req.body ?? {}))
    } catch (err) {
      return replyWithWorkspaceQueryError(reply, err, "failed to save heatflux selection")
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
