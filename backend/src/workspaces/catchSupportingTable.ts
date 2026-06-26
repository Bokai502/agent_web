import fs from "fs/promises"
import path from "path"
import ExcelJS from "exceljs"
import JSZip from "jszip"

type JsonRecord = Record<string, unknown>
type NumberKind = "float" | "int"

export type CatchSupportingTableRow = {
  id?: string
  row?: number
} & Partial<Record<CatchSupportingTableColumn, string | number | null>> & {
  "热仿真温度（℃）"?: string | number | null
  "热仿真温度平均（℃）"?: number | null
  "热仿真温度最低（℃）"?: number | null
  "热仿真温度最高（℃）"?: number | null
  "热仿真温度状态"?: "in_range" | "high" | "low" | "missing" | "no_range"
  "热仿真温度组件ID"?: string | null
  "热仿真温度样本数"?: number | null
}

type CatchSupportingTableColumn = typeof HEADERS[number]

type LoadedTableRow = {
  category: string
  dims_mm: number[] | null
  mass_kg: number
  name: string
  peak_power_W: number | null
  power_W: number
  row: number
  subsystem: string | null
  subtype: string
}

const SUBSYSTEM_HEADER = "分系统"
const HEAT_CAPACITY_HEADER = "热容量（J/K）"
const DATA_HEADERS = ["产品名称", "重量（Kg）", "包络尺寸（mm）", "稳态功耗（W）", "峰值功耗（W）", "工作温度（℃）", HEAT_CAPACITY_HEADER, "配套单位"] as const
const HEADERS = [SUBSYSTEM_HEADER, ...DATA_HEADERS] as const
const SUMMARY_ROW_NAMES = new Set(["整星质量", "整星"])
const COMPONENT_FACE_TEMPERATURE_RELATIVE_PATH = path.join("02_sim", "simulation", "component_face_temperature.json")

const KIND_WORDS: Array<[string, string, string]> = [
  ["星箭分离", "mechanism", "separation_device"],
  ["行程开关", "mechanism", "limit_switch"],
  ["伸展", "mechanism", "deployment"],
  ["展开", "mechanism", "deployment"],
  ["反作用", "adcs", "reaction_wheel"],
  ["飞轮", "adcs", "reaction_wheel"],
  ["星敏", "adcs", "star_tracker"],
  ["太阳敏感器", "adcs", "sun_sensor"],
  ["磁强计", "adcs", "magnetometer"],
  ["磁力矩器", "adcs", "magnetorquer"],
  ["磁棒", "adcs", "magnetorquer"],
  ["陀螺", "adcs", "gyro"],
  ["电推", "propulsion", "thruster"],
  ["微推", "propulsion", "thruster"],
  ["推力器", "propulsion", "thruster"],
  ["电池", "power", "battery"],
  ["太阳电池阵", "power", "solar_array"],
  ["帆板", "power", "solar_array"],
  ["综合电子", "avionics", "electronics_box"],
  ["星务", "avionics", "onboard_computer"],
  ["测控数传", "communication", "ttc_box"],
  ["短报文", "communication", "communication_box"],
  ["GNSS", "communication", "gnss"],
  ["天线", "communication", "antenna"],
  ["微波开关", "communication", "microwave_switch"],
  ["探测器", "payload", "detector"],
  ["相机", "payload", "camera"],
  ["光学", "payload", "optical_payload"],
  ["载荷", "payload", "payload"],
  ["热控", "thermal", "thermal_control"],
  ["加热", "thermal", "heater"],
]

const SUBSYSTEM_KIND = new Map<string, [string, string]>([
  ["结构与机构分系统", ["mechanism", "mechanism"]],
  ["机构分系统", ["mechanism", "mechanism"]],
  ["结构", ["mechanism", "mechanism"]],
  ["姿轨控分系统", ["adcs", "adcs"]],
  ["姿轨控", ["adcs", "adcs"]],
  ["推进分系统", ["propulsion", "propulsion"]],
  ["电源与总体电路分系统", ["power", "power"]],
  ["电源分系统", ["power", "power"]],
  ["电源", ["power", "power"]],
  ["综合电子分系统", ["avionics", "avionics"]],
  ["综合电子", ["avionics", "avionics"]],
  ["测控 / 数传一体机分系统", ["communication", "communication"]],
  ["测控数传", ["communication", "communication"]],
  ["导航短报文", ["communication", "communication"]],
  ["载荷分系统", ["payload", "payload"]],
  ["有效载荷", ["payload", "payload"]],
  ["热控分系统", ["thermal", "thermal"]],
])

const numberKinds = new WeakMap<object, Map<PropertyKey, NumberKind>>()

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {}
}

function asRecordArray(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function asString(value: unknown) {
  return value == null ? "" : String(value)
}

function markNumberKind(parent: unknown, key: PropertyKey, kind: NumberKind) {
  if (parent === null || typeof parent !== "object") return
  let map = numberKinds.get(parent)
  if (!map) {
    map = new Map()
    numberKinds.set(parent, map)
  }
  map.set(key, kind)
}

function markFloat(parent: unknown, key: PropertyKey) {
  markNumberKind(parent, key, "float")
}

function getNumberKind(parent: unknown, key: PropertyKey | null) {
  if (parent === null || typeof parent !== "object" || key === null) return null
  return numberKinds.get(parent)?.get(key) ?? null
}

function markFloatArray(values: number[]) {
  values.forEach((_, index) => markFloat(values, index))
  return values
}

function skipJsonWhitespace(text: string, cursor: { index: number }) {
  while (/\s/u.test(text[cursor.index] ?? "")) cursor.index += 1
}

function parseJsonStringToken(text: string, cursor: { index: number }) {
  const start = cursor.index
  cursor.index += 1
  while (cursor.index < text.length) {
    const char = text[cursor.index]
    if (char === "\\") {
      cursor.index += 2
      continue
    }
    cursor.index += 1
    if (char === "\"") break
  }
  return JSON.parse(text.slice(start, cursor.index)) as string
}

function annotateJsonNumberKinds(text: string, value: unknown, parent: unknown = null, key: PropertyKey | null = null, cursor = { index: 0 }) {
  skipJsonWhitespace(text, cursor)
  const char = text[cursor.index]
  if (char === "{") {
    cursor.index += 1
    skipJsonWhitespace(text, cursor)
    if (text[cursor.index] === "}") {
      cursor.index += 1
      return
    }
    while (cursor.index < text.length) {
      skipJsonWhitespace(text, cursor)
      const objectKey = parseJsonStringToken(text, cursor)
      skipJsonWhitespace(text, cursor)
      cursor.index += 1
      annotateJsonNumberKinds(text, isRecord(value) ? value[objectKey] : undefined, value, objectKey, cursor)
      skipJsonWhitespace(text, cursor)
      const separator = text[cursor.index]
      cursor.index += 1
      if (separator === "}") break
    }
    return
  }
  if (char === "[") {
    cursor.index += 1
    skipJsonWhitespace(text, cursor)
    if (text[cursor.index] === "]") {
      cursor.index += 1
      return
    }
    let index = 0
    while (cursor.index < text.length) {
      annotateJsonNumberKinds(text, Array.isArray(value) ? value[index] : undefined, value, index, cursor)
      index += 1
      skipJsonWhitespace(text, cursor)
      const separator = text[cursor.index]
      cursor.index += 1
      if (separator === "]") break
    }
    return
  }
  if (char === "\"") {
    parseJsonStringToken(text, cursor)
    return
  }
  if (char === "-" || /\d/u.test(char ?? "")) {
    const start = cursor.index
    while (/[-+0-9.eE]/u.test(text[cursor.index] ?? "")) cursor.index += 1
    const token = text.slice(start, cursor.index)
    if (parent !== null && key !== null) markNumberKind(parent, key, /[.eE]/u.test(token) ? "float" : "int")
    return
  }
  if (text.startsWith("true", cursor.index)) cursor.index += 4
  else if (text.startsWith("false", cursor.index)) cursor.index += 5
  else if (text.startsWith("null", cursor.index)) cursor.index += 4
}

async function readJson(filePath: string): Promise<unknown> {
  const raw = await fs.readFile(filePath, "utf-8")
  const parsed = JSON.parse(raw) as unknown
  annotateJsonNumberKinds(raw, parsed)
  return parsed
}

async function writeJson(filePath: string, data: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${stringifyPythonJson(data)}\n`, "utf-8")
}

function formatPythonExponent(value: number) {
  return value.toExponential().replace(/e([+-])(\d)$/u, "e$10$2")
}

function formatPythonNumber(value: number, kind: NumberKind | null) {
  if (!Number.isFinite(value)) return String(value)
  if (kind !== "float") return String(Math.trunc(value))
  if (Object.is(value, -0)) return "-0.0"
  if (Number.isInteger(value)) return `${value}.0`
  const absolute = Math.abs(value)
  if (absolute !== 0 && absolute < 0.0001) return formatPythonExponent(value)
  return String(value)
}

function stringifyPythonJson(value: unknown, indent = 0, parent: unknown = null, key: PropertyKey | null = null): string {
  if (value === null) return "null"
  if (typeof value === "number") return formatPythonNumber(value, getNumberKind(parent, key))
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)
  const currentIndent = " ".repeat(indent)
  const childIndent = " ".repeat(indent + 2)
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]"
    const lines = value.map((item, index) => `${childIndent}${stringifyPythonJson(item, indent + 2, value, index)}`)
    return `[\n${lines.join(",\n")}\n${currentIndent}]`
  }
  if (isRecord(value)) {
    const entries = Object.entries(value)
    if (entries.length === 0) return "{}"
    const lines = entries.map(([entryKey, item]) => (
      `${childIndent}${JSON.stringify(entryKey)}: ${stringifyPythonJson(item, indent + 2, value, entryKey)}`
    ))
    return `{\n${lines.join(",\n")}\n${currentIndent}}`
  }
  return "null"
}

function norm(value: unknown) {
  return asString(value)
    .trim()
    .replace(/^CATCH-P\d+\s*/iu, "")
    .replace(/[^0-9a-zA-Z\u4e00-\u9fff]+/gu, "")
    .toLowerCase()
}

function num(value: unknown): number | null {
  if (value == null || value === "" || typeof value === "boolean") return null
  if (typeof value === "number") return Number.isNaN(value) ? null : value
  const text = String(value).replace(/,/gu, "")
  const match = /[-+]?\d+(?:\.\d+)?/u.exec(text)
  if (!match) return null
  const parsed = Number.parseFloat(match[0])
  return /\bmw\b/iu.test(text) ? parsed / 1000 : parsed
}

function power(value: unknown): number | null {
  if (typeof value === "string" && value.includes("=")) {
    const values = Array.from(value.matchAll(/[-+]?\d+(?:\.\d+)?/gu), match => Number.parseFloat(match[0]))
    return values.length ? values[values.length - 1] : null
  }
  return num(value)
}

function dims(value: unknown): number[] | null {
  if (value == null) return null
  const values = Array.from(String(value).replace(/,/gu, "").matchAll(/[-+]?\d+(?:\.\d+)?/gu), match => Number.parseFloat(match[0]))
  return values.length >= 3 && values.slice(0, 3).every(item => item > 0) ? markFloatArray(values.slice(0, 3)) : null
}

function temperatureRange(value: string | null): [number, number] | null {
  if (!value) return null
  const values = Array.from(value.replace(/,/gu, "").matchAll(/[-+]?\d+(?:\.\d+)?/gu), match => Number.parseFloat(match[0]))
  return values.length >= 2 && values.slice(0, 2).every(Number.isFinite) ? [values[0], values[1]] : null
}

function componentIdFromName(value: unknown) {
  const match = asString(value).match(/\bP\d{1,4}\b/iu)
  return match ? match[0].toUpperCase() : null
}

function temperatureStatus(valueC: number | null, range: [number, number] | null): CatchSupportingTableRow["热仿真温度状态"] {
  if (valueC === null) return "missing"
  if (!range) return "no_range"
  if (valueC < range[0]) return "low"
  if (valueC > range[1]) return "high"
  return "in_range"
}

function inferKind(name: string, subsystem?: string | null, dbKind?: string | null): [string, string] {
  const text = `${name} ${dbKind ?? ""}`.toLowerCase()
  for (const [word, category, subtype] of KIND_WORDS) {
    if (text.includes(word.toLowerCase())) return [category, subtype]
  }
  if (subsystem && SUBSYSTEM_KIND.has(subsystem)) return SUBSYSTEM_KIND.get(subsystem)!
  return ["payload", "payload"]
}

async function readWorksheetRows(xlsxPath: string): Promise<unknown[][]> {
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.readFile(xlsxPath)
  } catch (err) {
    return readWorksheetRowsFromXml(xlsxPath)
  }
  const worksheet = workbook.worksheets[0]
  if (!worksheet) return []
  const rows: unknown[][] = []
  worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const values = Array.isArray(row.values) ? row.values.slice(1) : []
    rows[rowNumber - 1] = values.map(value => {
      if (isRecord(value) && "result" in value) return value.result
      if (isRecord(value) && "text" in value) return value.text
      if (isRecord(value) && "formula" in value) return null
      if (value instanceof Date) return value.toISOString()
      return value ?? null
    })
  })
  return rows
}

function columnIndexFromCellRef(ref: string) {
  const letters = ref.replace(/[0-9]/gu, "").toUpperCase()
  let index = 0
  for (const letter of letters) index = index * 26 + letter.charCodeAt(0) - 64
  return index - 1
}

function rowIndexFromCellRef(ref: string) {
  const match = ref.match(/\d+/u)
  return match ? Number.parseInt(match[0], 10) - 1 : 0
}

function xmlUnescape(value: string) {
  return value
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, "\"")
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, "&")
}

function xmlTexts(xml: string, tagName: string) {
  return Array.from(xml.matchAll(new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "gu")), match => xmlUnescape(match[1] ?? ""))
}

function xmlCellValue(cellXml: string, sharedStrings: string[]) {
  const type = cellXml.match(/\st="([^"]+)"/u)?.[1] ?? ""
  if (type === "inlineStr") return xmlTexts(cellXml, "t").join("")
  const raw = cellXml.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/u)?.[1]
  if (raw == null || raw === "") return null
  if (type === "s") return sharedStrings[Number.parseInt(raw, 10)] ?? null
  if (type === "str") return xmlUnescape(raw)
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : xmlUnescape(raw)
}

async function readWorksheetRowsFromXml(xlsxPath: string): Promise<unknown[][]> {
  const zip = await JSZip.loadAsync(await fs.readFile(xlsxPath))
  const sharedStringsXml = await zip.file("xl/sharedStrings.xml")?.async("string")
  const sharedStrings = sharedStringsXml
    ? Array.from(sharedStringsXml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/gu), match => xmlTexts(match[1] ?? "", "t").join(""))
    : []
  const worksheetXml = await zip.file("xl/worksheets/sheet1.xml")?.async("string")
  if (!worksheetXml) return []
  const rows: unknown[][] = []
  const rowPattern = /<row\b((?:(?!\/>)[^>])*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/gu
  const cellPattern = /<c\b((?:(?!\/>)[^>])*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/gu
  let fallbackRowIndex = 0
  for (const rowMatch of worksheetXml.matchAll(rowPattern)) {
    const rowAttrs = rowMatch[1] ?? rowMatch[3] ?? ""
    const rowNumber = rowAttrs.match(/\br="(\d+)"/u)?.[1]
    const rowIndex = rowNumber ? Number.parseInt(rowNumber, 10) - 1 : fallbackRowIndex
    fallbackRowIndex = rowIndex + 1
    const rowXml = rowMatch[2] ?? ""
    const row = rows[rowIndex] ?? []
    let fallbackColumnIndex = 0
    for (const cellMatch of rowXml.matchAll(cellPattern)) {
      const attrs = cellMatch[1] ?? cellMatch[3] ?? ""
      const ref = attrs.match(/\br="([^"]+)"/u)?.[1]
      const columnIndex = ref ? columnIndexFromCellRef(ref) : fallbackColumnIndex
      fallbackColumnIndex = columnIndex + 1
      row[columnIndex] = cellMatch[2] ? xmlCellValue(`<c ${attrs}>${cellMatch[2]}</c>`, sharedStrings) : null
    }
    rows[rowIndex] = row
  }
  return rows
}

function getCellByHeader(row: unknown[] | undefined, headers: Map<string, number>, name: string): unknown {
  const index = headers.get(name)
  return index == null ? null : row?.[index] ?? null
}

function getTableCell(row: unknown[] | undefined, headers: Map<string, number>, name: string, legacyIndex: number): unknown {
  return headers.has(name) ? getCellByHeader(row, headers, name) : row?.[legacyIndex] ?? null
}

function getOptionalCellByHeader(row: unknown[] | undefined, headers: Map<string, number>, name: string): unknown {
  return headers.has(name) ? getCellByHeader(row, headers, name) : null
}

function worksheetProductName(row: unknown[] | undefined, headers: Map<string, number>) {
  return asString(getTableCell(row, headers, "产品名称", 0)).trim()
}

function worksheetEnvelopeSize(row: unknown[] | undefined, headers: Map<string, number>) {
  return asString(getTableCell(row, headers, "包络尺寸（mm）", 2)).trim()
}

function isSummaryWorksheetRow(row: unknown[], headers: Map<string, number>) {
  const name = worksheetProductName(row, headers)
  const size = worksheetEnvelopeSize(row, headers)
  return SUMMARY_ROW_NAMES.has(name) || (!name && size === "整星") || (name === "整星质量" && size === "平台")
}

function isSummaryJsonRow(row: JsonRecord) {
  const name = asString(row["产品名称"]).trim()
  const size = asString(row["包络尺寸（mm）"]).trim()
  return SUMMARY_ROW_NAMES.has(name) || (!name && size === "整星") || (name === "整星质量" && size === "平台")
}

type ComponentTemperatureSummary = {
  averageC: number | null
  componentId: string | null
  maxC: number | null
  minC: number | null
  sampleCount: number
}

type ComponentTemperatureIndex = {
  byId: Map<string, ComponentTemperatureSummary>
  byName: Map<string, ComponentTemperatureSummary[]>
  sourcePath: string
}

function temperatureSummaryFromComponent(component: JsonRecord): ComponentTemperatureSummary | null {
  const averageK: number[] = []
  const minK: number[] = []
  const maxK: number[] = []
  let sampleCount = 0
  for (const stats of Object.values(asRecord(component.faces))) {
    const face = asRecord(stats)
    const faceSamples = num(face.sample_count) ?? 0
    sampleCount += faceSamples
    const average = num(face.average_temperature_K)
    const min = num(face.min_temperature_K)
    const max = num(face.max_temperature_K)
    if (average !== null) averageK.push(average)
    if (min !== null) minK.push(min)
    if (max !== null) maxK.push(max)
  }
  if (!averageK.length && !minK.length && !maxK.length) return null
  const componentId = asString(component.component_id || component.id).trim() || null
  return {
    averageC: averageK.length ? averageK.reduce((sum, value) => sum + value, 0) / averageK.length - 273.15 : null,
    componentId,
    maxC: maxK.length ? Math.max(...maxK) - 273.15 : null,
    minC: minK.length ? Math.min(...minK) - 273.15 : null,
    sampleCount,
  }
}

async function readComponentTemperatureIndex(workspaceDir?: string): Promise<ComponentTemperatureIndex | null> {
  if (!workspaceDir) return null
  const sourcePath = path.join(workspaceDir, COMPONENT_FACE_TEMPERATURE_RELATIVE_PATH)
  let payload: JsonRecord
  try {
    payload = asRecord(await readJson(sourcePath))
  } catch {
    return null
  }
  const byId = new Map<string, ComponentTemperatureSummary>()
  const byName = new Map<string, ComponentTemperatureSummary[]>()
  for (const component of asRecordArray(payload.components)) {
    const summary = temperatureSummaryFromComponent(component)
    if (!summary) continue
    const componentId = asString(component.component_id || component.id || summary.componentId).trim().toUpperCase()
    if (componentId) byId.set(componentId, { ...summary, componentId })
    for (const key of [component.semantic_name, component.display_name, component.name].map(norm).filter(Boolean)) {
      const bucket = byName.get(key) ?? []
      bucket.push(summary)
      byName.set(key, bucket)
    }
  }
  return { byId, byName, sourcePath }
}

function findComponentTemperature(rowName: unknown, index: ComponentTemperatureIndex | null) {
  if (!index) return null
  const componentId = componentIdFromName(rowName)
  if (componentId) {
    const match = index.byId.get(componentId)
    if (match) return match
  }
  const nameKey = norm(rowName)
  const byName = nameKey ? index.byName.get(nameKey)?.[0] : null
  return byName ?? null
}

function formatTemperatureSummary(summary: ComponentTemperatureSummary | null) {
  if (!summary || summary.averageC === null) return null
  const average = summary.averageC.toFixed(1)
  if (summary.minC === null || summary.maxC === null) return `${average}℃`
  return `${average}℃ (${summary.minC.toFixed(1)}~${summary.maxC.toFixed(1)}℃)`
}

export async function readCatchSupportingTable(xlsxPath: string, options: { workspaceDir?: string } = {}) {
  const sheetRows = await readWorksheetRows(xlsxPath)
  const temperatureIndex = await readComponentTemperatureIndex(options.workspaceDir)
  const headers = new Map<string, number>()
  sheetRows[0]?.forEach((value, index) => {
    if (value != null && String(value).trim()) headers.set(String(value).trim(), index)
  })
  const rows: CatchSupportingTableRow[] = []
  let currentSubsystem = ""
  for (let index = 1; index < sheetRows.length; index += 1) {
    const worksheetRow = sheetRows[index] ?? []
    if (!worksheetRow.some(value => value !== null && value !== undefined && String(value).trim())) continue
    const name = worksheetProductName(worksheetRow, headers)
    if (SUBSYSTEM_KIND.has(name) && !asString(getCellByHeader(worksheetRow, headers, SUBSYSTEM_HEADER)).trim()) {
      currentSubsystem = name
      continue
    }
    if (isSummaryWorksheetRow(worksheetRow, headers)) continue
    const rowIndex = index + 1
    const subsystem = asString(getCellByHeader(worksheetRow, headers, SUBSYSTEM_HEADER)).trim() || currentSubsystem || "未分组"
    const mass = getTableCell(worksheetRow, headers, "重量（Kg）", 1) as string | number | null
    const size = getTableCell(worksheetRow, headers, "包络尺寸（mm）", 2) as string | number | null
    const steadyPower = getTableCell(worksheetRow, headers, "稳态功耗（W）", 3) as string | number | null
    const peakPower = getTableCell(worksheetRow, headers, "峰值功耗（W）", 4) as string | number | null
    const operatingTemperature = getTableCell(worksheetRow, headers, "工作温度（℃）", 5) as string | number | null
    const heatCapacity = getOptionalCellByHeader(worksheetRow, headers, HEAT_CAPACITY_HEADER) as string | number | null
    const supplier = getTableCell(worksheetRow, headers, "配套单位", 6) as string | number | null
    const temperature = findComponentTemperature(name, temperatureIndex)
    const operatingRange = temperatureRange(asString(operatingTemperature).trim())
    rows.push({
      id: `r${rowIndex}`,
      row: rowIndex,
      "分系统": subsystem,
      "产品名称": name,
      "重量（Kg）": mass,
      "包络尺寸（mm）": size,
      "稳态功耗（W）": steadyPower,
      "峰值功耗（W）": peakPower,
      "工作温度（℃）": operatingTemperature,
      "热容量（J/K）": heatCapacity,
      "配套单位": supplier,
      "热仿真温度（℃）": formatTemperatureSummary(temperature),
      "热仿真温度平均（℃）": temperature?.averageC ?? null,
      "热仿真温度最低（℃）": temperature?.minC ?? null,
      "热仿真温度最高（℃）": temperature?.maxC ?? null,
      "热仿真温度状态": temperatureStatus(temperature?.averageC ?? null, operatingRange),
      "热仿真温度组件ID": temperature?.componentId ?? componentIdFromName(name),
      "热仿真温度样本数": temperature?.sampleCount ?? null,
    })
  }
  return {
    headers: HEADERS,
    result_headers: ["热仿真温度（℃）"],
    rows,
    source_path: xlsxPath,
    temperature_source_path: temperatureIndex?.sourcePath ?? null,
  }
}

export async function writeCatchSupportingTable(xlsxPath: string, rows: JsonRecord[]) {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet("CATCH整星配套表")
  worksheet.addRow([...HEADERS])
  for (const row of rows) {
    if (isSummaryJsonRow(row)) continue
    if (SUBSYSTEM_KIND.has(asString(row["产品名称"]).trim()) && !asString(row[SUBSYSTEM_HEADER]).trim()) continue
    worksheet.addRow(HEADERS.map(header => row[header] ?? null))
  }
  ;[18, 32, 14, 22, 14, 14, 18, 16, 16].forEach((width, index) => {
    worksheet.getColumn(index + 1).width = width
  })
  await workbook.xlsx.writeFile(xlsxPath)
}

async function loadTableRows(xlsxPath: string): Promise<LoadedTableRow[]> {
  const sheetRows = await readWorksheetRows(xlsxPath)
  if (!sheetRows.length) return []
  const headers = new Map<string, number>()
  sheetRows[0].forEach((value, index) => {
    if (value != null && String(value).trim()) headers.set(String(value).trim(), index)
  })

  const rows: LoadedTableRow[] = []
  let subsystem: string | null = null
  for (let index = 1; index < sheetRows.length; index += 1) {
    const row = sheetRows[index] ?? []
    const name = worksheetProductName(row, headers)
    if (!name) continue
    const explicitSubsystem = asString(getCellByHeader(row, headers, SUBSYSTEM_HEADER)).trim()
    const mass = num(getTableCell(row, headers, "重量（Kg）", 1))
    const size = dims(getTableCell(row, headers, "包络尺寸（mm）", 2))
    const avgPower = power(getTableCell(row, headers, "稳态功耗（W）", 3))
    const peakPower = power(getTableCell(row, headers, "峰值功耗（W）", 4))
    if (SUBSYSTEM_KIND.has(name) && !explicitSubsystem) {
      subsystem = name
      continue
    }
    if (isSummaryWorksheetRow(row, headers)) continue
    if (mass === null && size === null && avgPower === null && peakPower === null) continue
    const rowSubsystem = explicitSubsystem || subsystem
    const [category, subtype] = inferKind(name, rowSubsystem)
    rows.push({
      row: index + 1,
      name,
      mass_kg: mass ?? 0,
      dims_mm: size,
      power_W: avgPower ?? 0,
      peak_power_W: peakPower,
      subsystem: rowSubsystem,
      category,
      subtype,
    })
  }
  return rows
}

function componentNameKeys(component: JsonRecord) {
  return [
    component.display_name,
    component.semantic_name,
    component.id,
  ]
    .map(value => norm(value))
    .filter(Boolean)
}

function componentNumericId(component: JsonRecord) {
  const match = asString(component.id).match(/\d+/u)
  return match ? Number.parseInt(match[0], 10) : 0
}

function createSpecComponent(row: LoadedTableRow, numericId: number): JsonRecord {
  const componentId = `P${String(numericId).padStart(3, "0")}`
  const dimsMm = markFloatArray(row.dims_mm ?? [50, 50, 50])
  const position = markFloatArray([0, 0, 0])
  const bboxMax = markFloatArray(dimsMm.map(value => value))
  return {
    id: componentId,
    geometry_id: `CATCH-G${String(numericId).padStart(3, "0")}`,
    thermal_id: `CATCH-T${String(numericId).padStart(3, "0")}`,
    semantic_name: row.name,
    display_name: row.name,
    kind: "internal",
    category: row.category,
    shape: "box",
    position,
    dims: dimsMm,
    rotation_rows: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    bbox: {
      min: position,
      max: bboxMax,
    },
    color: [96, 165, 250, 255],
    mount: {
      install_face_id: null,
      component_face_id: `${componentId}.local_zmin`,
      component_face_index: 4,
    },
    thermal: {
      include_in_simulation: row.power_W > 0,
      power_W: row.power_W,
      mass_kg: row.mass_kg,
      material_id: "aluminum_6061",
      contact_resistance: 0.001,
    },
    real_cad: {
      source_kind: "box",
      fallback_shape: "box",
    },
  }
}

function updateSpecComponentFromRow(component: JsonRecord, row: LoadedTableRow) {
  const dimsMm = markFloatArray(row.dims_mm ?? (Array.isArray(component.dims) ? component.dims.map(Number) : [50, 50, 50]))
  const bboxRecord = asRecord(component.bbox)
  const bboxMin = Array.isArray(bboxRecord.min)
    ? markFloatArray(bboxRecord.min.map(Number))
    : Array.isArray(component.position)
      ? markFloatArray(component.position.map(Number))
      : markFloatArray([0, 0, 0])
  const bboxMax = markFloatArray(bboxMin.map((value, index) => value + dimsMm[index]))
  const thermal = asRecord(component.thermal)

  component.display_name = row.name
  component.semantic_name = row.name
  component.category = row.category
  component.dims = dimsMm
  component.position = bboxMin
  component.bbox = { ...bboxRecord, min: bboxMin, max: bboxMax }
  thermal.mass_kg = row.mass_kg
  thermal.power_W = row.power_W
  thermal.include_in_simulation = row.power_W > 0
  delete thermal.operating_temperature
  delete thermal.operating_temperature_min_C
  delete thermal.operating_temperature_max_C
  delete thermal.operating_temperature_source
  component.thermal = thermal

  markFloatArray(dimsMm)
  markFloatArray(bboxMin)
  markFloatArray(bboxMax)
  markFloat(thermal, "mass_kg")
  markFloat(thermal, "power_W")
}

async function refreshCadBuildSpecFromSupportingTable(outputDir: string, xlsxPath: string) {
  const rows = await loadTableRows(xlsxPath)
  const cadBuildSpecPath = path.join(outputDir, "cad_build_spec.json")
  const spec = asRecord(await readJson(cadBuildSpecPath))
  const existingComponents = asRecordArray(spec.components)
  const componentsByName = new Map<string, JsonRecord[]>()
  for (const component of existingComponents) {
    for (const key of componentNameKeys(component)) {
      const bucket = componentsByName.get(key) ?? []
      bucket.push(component)
      componentsByName.set(key, bucket)
    }
  }

  let nextNumericId = existingComponents.reduce((maxId, component) => Math.max(maxId, componentNumericId(component)), 0) + 1
  const nextComponents: JsonRecord[] = []
  for (const [index, row] of rows.entries()) {
    const rowKey = norm(row.name)
    const candidates = componentsByName.get(rowKey) ?? []
    const component = candidates.shift() ?? existingComponents[index] ?? createSpecComponent(row, nextNumericId++)
    updateSpecComponentFromRow(component, row)
    nextComponents.push(component)
  }

  spec.components = nextComponents
  const summary = {
    ...asRecord(spec.summary),
    component_count: nextComponents.length,
    wall_count: asRecordArray(spec.walls).length,
    simulation_component_count: nextComponents.filter(component => Boolean(asRecord(component.thermal).include_in_simulation)).length,
    real_cad_step_count: nextComponents.filter(component => asString(asRecord(component.real_cad).step_path)).length,
    total_mass_kg: nextComponents.reduce((sum, component) => sum + (num(asRecord(component.thermal).mass_kg) ?? 0), 0),
    total_power_W: nextComponents.reduce((sum, component) => sum + (num(asRecord(component.thermal).power_W) ?? 0), 0),
  }
  markFloat(summary, "total_mass_kg")
  markFloat(summary, "total_power_W")
  spec.summary = summary
  spec.source_files = { ...asRecord(spec.source_files), supporting_table: path.basename(xlsxPath) }

  await writeJson(cadBuildSpecPath, spec)
  return {
    cad_build_spec_path: cadBuildSpecPath,
    component_count: rows.length,
    output_dir: outputDir,
  }
}

export async function writeAndRefreshCatchSupportingTable(options: {
  outputDir: string
  rows: JsonRecord[]
  workspaceDir?: string
  xlsxPath: string
}) {
  await fs.mkdir(path.dirname(options.xlsxPath), { recursive: true })
  await writeCatchSupportingTable(options.xlsxPath, options.rows)
  const generation = await refreshCadBuildSpecFromSupportingTable(options.outputDir, options.xlsxPath)
  return {
    table: await readCatchSupportingTable(options.xlsxPath, { workspaceDir: options.workspaceDir }),
    generation,
  }
}
