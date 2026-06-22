import fs from "fs/promises"
import path from "path"
import ExcelJS from "exceljs"

type JsonRecord = Record<string, unknown>
type NumberKind = "float" | "int"

export type CatchSupportingTableRow = {
  id?: string
  row?: number
} & Partial<Record<CatchSupportingTableColumn, string | number | null>>

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

type DbRow = {
  category: string
  dims_mm: number[] | null
  index: number
  is_catch: boolean
  names: string[]
  norm_names: string[]
  record: JsonRecord
  sheet: unknown
  subtype: string
}

type MatchRow = {
  item: JsonRecord
  geom: JsonRecord
}

const HEADERS = ["产品名称", "重量（Kg）", "包络尺寸（mm）", "稳态功耗（W）", "峰值功耗（W）", "工作温度（℃）", "配套单位"] as const

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
  ["姿轨控分系统", ["adcs", "adcs"]],
  ["推进分系统", ["propulsion", "propulsion"]],
  ["电源与总体电路分系统", ["power", "power"]],
  ["电源分系统", ["power", "power"]],
  ["综合电子分系统", ["avionics", "avionics"]],
  ["测控 / 数传一体机分系统", ["communication", "communication"]],
  ["载荷分系统", ["payload", "payload"]],
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

function cloneJson<T>(value: T): T {
  if (Array.isArray(value)) {
    const next = value.map(item => cloneJson(item)) as T
    const sourceKinds = numberKinds.get(value)
    if (sourceKinds) {
      for (const [key, kind] of sourceKinds) markNumberKind(next, key, kind)
    }
    return next
  }
  if (isRecord(value)) {
    const next: JsonRecord = {}
    for (const [key, item] of Object.entries(value)) next[key] = cloneJson(item)
    const sourceKinds = numberKinds.get(value)
    if (sourceKinds) {
      for (const [key, kind] of sourceKinds) markNumberKind(next, key, kind)
    }
    return next as T
  }
  return value
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

function numericValue(value: number, kind: NumberKind = "float") {
  const boxed = new Number(value)
  markNumberKind(boxed, "value", kind)
  return value
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

function recordDims(record: JsonRecord): number[] | null {
  const values = ["长 mm", "宽 mm", "高 mm"].map(key => num(record[key]))
  if (values.every(value => value !== null && value > 0)) return markFloatArray(values as number[])
  const stepValues = ["STEP长", "STEP宽", "STEP高"].map(key => num(record[key]))
  if (stepValues.every(value => value !== null && value > 0)) return markFloatArray(stepValues as number[])
  return dims(record["尺寸"])
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
  await workbook.xlsx.readFile(xlsxPath)
  const worksheet = workbook.worksheets[0]
  if (!worksheet) return []
  const rows: unknown[][] = []
  worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const values = Array.isArray(row.values) ? row.values.slice(1) : []
    rows[rowNumber - 1] = values.map(value => {
      if (isRecord(value) && "result" in value) return value.result
      if (isRecord(value) && "text" in value) return value.text
      if (value instanceof Date) return value.toISOString()
      return value ?? null
    })
  })
  return rows
}

function getCellByHeader(row: unknown[] | undefined, headers: Map<string, number>, name: string): unknown {
  const index = headers.get(name)
  return index == null ? null : row?.[index] ?? null
}

export async function readCatchSupportingTable(xlsxPath: string) {
  const sheetRows = await readWorksheetRows(xlsxPath)
  const rows: CatchSupportingTableRow[] = []
  for (let index = 1; index < sheetRows.length; index += 1) {
    const values = (sheetRows[index] ?? []).slice(0, HEADERS.length)
    if (!values.some(value => value !== null && value !== undefined && String(value).trim())) continue
    const rowIndex = index + 1
    rows.push({
      id: `r${rowIndex}`,
      row: rowIndex,
      "产品名称": values[0] as string | number | null,
      "重量（Kg）": values[1] as string | number | null,
      "包络尺寸（mm）": values[2] as string | number | null,
      "稳态功耗（W）": values[3] as string | number | null,
      "峰值功耗（W）": values[4] as string | number | null,
      "工作温度（℃）": values[5] as string | number | null,
      "配套单位": values[6] as string | number | null,
    })
  }
  return { headers: HEADERS, rows, source_path: xlsxPath }
}

export async function writeCatchSupportingTable(xlsxPath: string, rows: JsonRecord[]) {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet("CATCH整星配套表")
  worksheet.addRow([...HEADERS])
  for (const row of rows) {
    worksheet.addRow(HEADERS.map(header => row[header] ?? null))
  }
  ;[32, 14, 22, 14, 14, 18, 16].forEach((width, index) => {
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
    const name = asString(getCellByHeader(row, headers, "产品名称")).trim()
    if (!name) continue
    const mass = num(getCellByHeader(row, headers, "重量（Kg）"))
    const size = dims(getCellByHeader(row, headers, "包络尺寸（mm）"))
    const avgPower = power(getCellByHeader(row, headers, "稳态功耗（W）"))
    const peakPower = power(getCellByHeader(row, headers, "峰值功耗（W）"))
    if (SUBSYSTEM_KIND.has(name)) {
      subsystem = name
      continue
    }
    if (name === "整星质量") continue
    if (mass === null && size === null && avgPower === null && peakPower === null) continue
    const [category, subtype] = inferKind(name, subsystem)
    rows.push({
      row: index + 1,
      name,
      mass_kg: mass ?? 0,
      dims_mm: size,
      power_W: avgPower ?? 0,
      peak_power_W: peakPower,
      subsystem,
      category,
      subtype,
    })
  }
  return rows
}

function loadDbRows(db: unknown): DbRow[] {
  const out: DbRow[] = []
  for (const sheet of asRecordArray(asRecord(db).sheets)) {
    const records = asRecordArray(sheet.records)
    records.forEach((record, index) => {
      if (index === 0 && record["器件型号"] === "model") return
      const names = ["器件型号", "器件名称", "器件名称(中文)", "器件ID"]
        .map(key => record[key])
        .filter(value => value != null && String(value).trim())
        .map(value => String(value).trim())
      if (!names.length) return
      const [category, subtype] = inferKind(
        names.join(" "),
        asString(record["所属分系统"]),
        asString(record["器件种类"]),
      )
      const source = asString(record["器件来源"])
      out.push({
        record,
        sheet: sheet.name,
        index,
        names,
        norm_names: names.map(norm),
        dims_mm: recordDims(record),
        is_catch: source.toUpperCase() === "CATCH" || source.toLowerCase().startsWith("catch"),
        category,
        subtype,
      })
    })
  }
  return out
}

function dimScore(left: number[] | null, right: number[] | null) {
  if (!left || !right) return 99
  const sortedRight = [...right].sort((a, b) => a - b)
  return [...left].sort((a, b) => a - b)
    .reduce((sum, value, index) => {
      const other = sortedRight[index]
      return sum + Math.abs(value - other) / Math.max(value, other, 1)
    }, 0)
}

function matchRow(row: LoadedTableRow, dbRows: DbRow[]): [DbRow, string, number] {
  const rowName = norm(row.name)
  const catchHits = dbRows
    .filter(candidate => candidate.is_catch && candidate.norm_names.some(name => name && (rowName.includes(name) || name.includes(rowName))))
    .map(candidate => [dimScore(row.dims_mm, candidate.dims_mm), candidate] as const)
  if (catchHits.length) {
    const [score, candidate] = catchHits.sort((left, right) => left[0] - right[0])[0]
    return [candidate, "catch_name", score]
  }

  const pool = dbRows.filter(candidate => candidate.subtype === row.subtype || candidate.category === row.category)
  const scored = (pool.length ? pool : dbRows).map(candidate => [dimScore(row.dims_mm, candidate.dims_mm), candidate] as const)
  const [score, candidate] = scored.sort((left, right) => left[0] - right[0])[0]
  return [candidate, "similar_kind_size", score]
}

function templateMaps(realBom: JsonRecord, geom: JsonRecord): Map<string, MatchRow> {
  const geomByComponent = new Map<string, JsonRecord>()
  for (const comp of Object.values(asRecord(geom.components)).filter(isRecord)) {
    if (comp.component_id) geomByComponent.set(String(comp.component_id), comp)
  }
  const byName = new Map<string, MatchRow>()
  for (const item of asRecordArray(realBom.items)) {
    const compId = item.component_id
    const comp = compId == null ? null : geomByComponent.get(String(compId))
    if (!comp) continue
    for (const value of [item.semantic_name, asRecord(item.source_ref).display_name]) {
      if (value) byName.set(norm(value), { item, geom: comp })
    }
  }
  return byName
}

function axesFromFace(faceId: string): [string, number, number, number, number] {
  const local = faceId.includes(".local_") ? faceId.split(".local_").at(-1) || "zmax" : "zmax"
  const axisRaw = "xyz".indexOf(local[0] ?? "z")
  const axis = axisRaw >= 0 ? axisRaw : 2
  const sign = local.endsWith("max") ? 1 : -1
  const axes = [0, 1, 2].filter(value => value !== axis)
  return [local, axis, sign, axes[0], axes[1]]
}

function firstFace(layout: JsonRecord): JsonRecord {
  const faces = asRecordArray(layout.install_faces)
  const outer = faces.filter(face => face.side === "outer")
  return (outer[0] ?? faces[0] ?? {}) as JsonRecord
}

function syntheticBox(face: JsonRecord, size: number[], index: number) {
  const axis = Number(face.plane_axis ?? 2)
  const sign = Number(face.normal_sign ?? 1)
  const axes = [0, 1, 2].filter(value => value !== axis)
  const [u, v] = axes
  const col = index % 5
  const row = Math.floor(index / 5)
  const center = [0, 0, 0]
  center[u] = -120 + col * 60
  center[v] = -120 + (row % 5) * 60
  const plane = Number(face.plane_value ?? 0)
  const min = center.map((value, itemIndex) => value - size[itemIndex] / 2)
  const max = center.map((value, itemIndex) => value + size[itemIndex] / 2)
  if (sign >= 0) {
    min[axis] = plane + 1
    max[axis] = plane + 1 + size[axis]
  } else {
    min[axis] = plane - 1 - size[axis]
    max[axis] = plane - 1
  }
  return { min: markFloatArray(min), max: markFloatArray(max) }
}

export async function generateCatch00InputsFromSupportingTable(options: {
  dbPath: string
  outputDir: string
  templateDir: string
  xlsxPath: string
}) {
  const rows = await loadTableRows(options.xlsxPath)
  const dbRows = loadDbRows(await readJson(options.dbPath))
  if (rows.length > 0 && dbRows.length === 0) {
    throw new Error("thermal database has no usable records")
  }
  const realBom = cloneJson(asRecord(await readJson(path.join(options.templateDir, "real_bom.json"))))
  const geom = cloneJson(asRecord(await readJson(path.join(options.templateDir, "geom.json"))))
  const layout = cloneJson(asRecord(await readJson(path.join(options.templateDir, "layout_topology.json"))))
  const templates = templateMaps(realBom, geom)

  realBom.items = []
  geom.components = {}
  layout.placements = []
  const realBomItems = realBom.items as unknown[]
  const geomComponents = geom.components as JsonRecord
  const layoutPlacements = layout.placements as unknown[]

  const report: JsonRecord[] = []
  const defaultFace = firstFace(layout)

  rows.forEach((row, index) => {
    const [match, mode, score] = matchRow(row, dbRows)
    const record = match.record
    const size = row.dims_mm ?? match.dims_mm ?? [50, 50, 50]
    markFloatArray(size)
    const compId = `P${String(index + 1).padStart(3, "0")}`
    const geomId = `G${String(index + 1).padStart(3, "0")}`
    const thermalId = `T${String(index + 1).padStart(3, "0")}`

    const template = templates.get(norm(row.name))
    let comp: JsonRecord
    let faceId: string
    let bbox: { min: number[]; max: number[] }
    let mountFaceId: unknown
    let kind: unknown
    if (template) {
      comp = cloneJson(template.geom)
      faceId = asString(comp.component_mount_face_id || `${compId}.local_zmax`)
      const oldId = asString(comp.component_id)
      if (oldId && faceId.startsWith(`${oldId}.`)) faceId = compId + faceId.slice(oldId.length)
      const bboxRecord = asRecord(comp.bbox)
      const bboxMin = (Array.isArray(bboxRecord.min) ? bboxRecord.min : Array.isArray(comp.position) ? comp.position : [0, 0, 0]).map(Number)
      bbox = { min: markFloatArray(bboxMin), max: markFloatArray(bboxMin.map((value, itemIndex) => value + size[itemIndex])) }
      mountFaceId = comp.mount_face_id
      kind = comp.kind ?? "external"
    } else {
      comp = {}
      faceId = `${compId}.local_zmax`
      bbox = syntheticBox(defaultFace, size, index)
      mountFaceId = defaultFace.id
      kind = "external"
    }

    const geomKey = `${geomId}_${compId}`
    const thermalSurface = comp.thermal_surface ?? { absorptivity: 0.3, emissivity: num(record["辐射率"]) ?? 0.8 }
    const thermalInterface = comp.thermal_interface ?? { contact_resistance: num(record["接触热阻K/W"]) ?? 0.001 }
    markFloat(thermalSurface, "absorptivity")
    markFloat(thermalSurface, "emissivity")
    markFloat(thermalInterface, "contact_resistance")

    Object.assign(comp, {
      id: geomKey,
      component_id: compId,
      semantic_name: row.name,
      kind,
      category: row.category,
      component_subtype: row.subtype,
      dims: size,
      mass: row.mass_kg,
      power: row.power_W,
      shape: record["外形"] ?? comp.shape ?? "box",
      bbox,
      position: bbox.min,
      mount_face_id: mountFaceId,
      component_mount_face_id: faceId,
      thermal_surface: thermalSurface,
      thermal_interface: thermalInterface,
    })
    markFloat(comp, "mass")
    markFloat(comp, "power")
    geomComponents[geomKey] = comp

    const [local, axis, sign, uAxis, vAxis] = axesFromFace(faceId)
    const realBomItem = {
      component_id: compId,
      semantic_name: row.name,
      kind,
      category: row.category,
      size_mm: size,
      mass_kg: row.mass_kg,
      power_W: row.power_W,
      peak_power_W: row.peak_power_W,
      material_id: "aluminum_6061",
      mounting: {
        default_component_mount_face_id: faceId,
        mount_faces: [{
          component_mount_face_id: faceId,
          local_face: local,
          normal_axis: axis,
          normal_sign: sign,
          u_axis: uAxis,
          v_axis: vAxis,
        }],
      },
      quantity: 1,
      source_ref: {
        supporting_table_row: row.row,
        matched_sheet: match.sheet,
        matched_row_index: match.index,
        matched_model: record["器件型号"],
        matched_name: record["器件名称"],
        matched_name_cn: record["器件名称(中文)"],
        matched_source: record["器件来源"],
        cad_path: record["CAD路径"],
        cad_rotated_path: record["CAD_rotated_path"] ?? record["Rotated CAD Path"],
        cad_major_path: record["CAD_MAJOR_PATH"],
      },
    }
    markFloat(realBomItem, "mass_kg")
    markFloat(realBomItem, "power_W")
    realBomItems.push(realBomItem)

    const alignment = { normal_alignment: "opposite", in_plane_rotation_deg: 0 }
    markFloat(alignment, "in_plane_rotation_deg")
    layoutPlacements.push({
      component_id: compId,
      semantic_name: row.name,
      kind,
      cabin_id: null,
      component_mount_face_id: faceId,
      mount_face_id: mountFaceId,
      alignment,
      geometry_id: geomId,
      thermal_id: thermalId,
      category: row.category,
    })
    const reportItem = {
      row: row.row,
      name: row.name,
      component_id: compId,
      match_mode: mode,
      match_score: Math.round(score * 1_000_000) / 1_000_000,
      matched_model: record["器件型号"],
      matched_name_cn: record["器件名称(中文)"],
      matched_source: record["器件来源"],
      mass_kg: row.mass_kg,
      power_W: row.power_W,
      peak_power_W: row.peak_power_W,
      size_mm: size,
    }
    markFloat(reportItem, "match_score")
    markFloat(reportItem, "mass_kg")
    markFloat(reportItem, "power_W")
    report.push(reportItem)
  })

  realBom.bom_id = `${path.basename(options.xlsxPath, path.extname(options.xlsxPath))}_generated_bom`
  realBom.source = { type: "supporting_table", xlsx: options.xlsxPath, database: options.dbPath }
  geom.meta = { ...asRecord(geom.meta), source_supporting_table: options.xlsxPath }
  layout.layout_id = `${path.basename(options.xlsxPath, path.extname(options.xlsxPath))}_generated_layout`
  layout.source_design_id = "supporting_table"

  await writeJson(path.join(options.outputDir, "real_bom.json"), realBom)
  await writeJson(path.join(options.outputDir, "geom.json"), geom)
  await writeJson(path.join(options.outputDir, "layout_topology.json"), layout)
  await writeJson(path.join(options.outputDir, "match_report.json"), { component_count: rows.length, matches: report })
  return { output_dir: options.outputDir, component_count: rows.length }
}

export async function writeAndRefreshCatchSupportingTable(options: {
  dbPath: string
  outputDir: string
  rows: JsonRecord[]
  templateDir: string
  xlsxPath: string
}) {
  await fs.mkdir(path.dirname(options.xlsxPath), { recursive: true })
  await writeCatchSupportingTable(options.xlsxPath, options.rows)
  const generation = await generateCatch00InputsFromSupportingTable(options)
  return {
    table: await readCatchSupportingTable(options.xlsxPath),
    generation,
  }
}
