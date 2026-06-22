import { useCallback, useEffect, useMemo, useState } from "react"
import type { CSSProperties } from "react"
import { useTranslation } from "react-i18next"
import { joinApiPath } from "../app/apiBase"
import {
  getWorkflowLoopProgressEntries,
  getWorkflowProgressSummary,
  type WorkflowProgressSummary,
  type WorkspaceProgressResponse,
} from "./workspace/progressUtils"
import { ExecutionFlow } from "../components/execution-flow/ExecutionFlow"

type JsonRow = Record<string, unknown>

type ComplianceCheckPayload = {
  components?: JsonRow[]
  rows?: JsonRow[]
  source_relative_path?: string
  summary?: Record<string, unknown>
}

type CompliancePayload = {
  artifact?: string
  exists?: boolean
  rows?: JsonRow[]
  source_relative_path?: string
}

type ComplianceCheckThemeVars = CSSProperties & Record<`--derating-${string}`, string>

type ComplianceCheckPanelProps = {
  theme?: "dark" | "light"
  versionId: string
  workspaceDir: string
  workspaceId: string
}

const MISSING_COLUMNS = [
  { key: "元器件名称", label: "器件名称", width: 124 },
  { key: "型号规格", label: "型号规格", width: 124 },
  { key: "生产厂商", label: "生产厂商", width: 100 },
  { key: "元器件大类", label: "大类", width: 96 },
  { key: "元器件子类", label: "子类", width: 132 },
  { key: "标准全量参数", label: "标准全量参数", width: 220 },
  { key: "已填参数", label: "已填参数", width: 170 },
  { key: "missing_standard_parameters", label: "缺少降额项", width: 230 },
] as const

const RESULT_COLUMNS = [
  { key: "序号", label: "序号", width: 56 },
  { key: "元器件名称", label: "器件名称", width: 112 },
  { key: "型号规格_规格", label: "型号规格", width: 118 },
  { key: "降额参数", label: "降额参数", width: 96 },
  { key: "参数值_额定", label: "额定值", width: 82 },
  { key: "AI分类", label: "AI分类（新）", width: 150 },
  { key: "I级降额公式", label: "I级降额公式（新）", width: 126 },
  { key: "允许值判定组合", label: "允许值 / AI判定", width: 154 },
  { key: "实际值判定组合", label: "实际值 / AI判定", width: 154 },
  { key: "降额因子判定组合", label: "规定因子 / AI判定", width: 158 },
  { key: "实际降额因子判定组合", label: "实际因子 / AI判定", width: 158 },
  { key: "判定结果", label: "判定结果", width: 96 },
  { key: "综合判定详情", label: "综合判定详情", width: 220 },
] as const

const COMPLIANCE_TABS = [
  {
    artifact: "component_classification",
    columns: [
      { key: "index", label: "序号", width: 70 },
      { key: "component_name", label: "器件名称", width: 140 },
      { key: "model", label: "型号规格", width: 140 },
      { key: "manufacturer", label: "生产厂商", width: 120 },
      { key: "category_class", label: "大类", width: 120 },
      { key: "category_name", label: "类别", width: 150 },
    ],
    description: "展示AI器件分类结果，可直接调整大类和类别。",
    emptyText: "暂无AI器件分类数据",
    key: "classification",
    title: "AI器件分类",
  },
  {
    artifact: "manufacturer_check",
    columns: [
      { key: "index", label: "序号", width: 70 },
      { key: "厂商简称", label: "厂商简称", width: 150 },
      { key: "厂商全称", label: "厂商全称", width: 220 },
      { key: "国产/进口", label: "国产/进口", width: 120 },
      { key: "目录内或外", label: "目录内或外", width: 130 },
    ],
    description: "展示厂商归一化和匹配状态，保留最关键字段供确认。",
    emptyText: "暂无厂商匹配数据",
    key: "manufacturer",
    title: "厂商匹配",
  },
  {
    artifact: "key_units_check",
    columns: [
      { key: "index", label: "序号", width: 70 },
      { key: "component_name", label: "器件名称", width: 140 },
      { key: "model", label: "型号规格", width: 140 },
      { key: "manufacturer", label: "生产厂商", width: 120 },
      { key: "is_key_part", label: "关键器件", width: 110 },
    ],
    description: "展示关键器件识别结果，可修改关键器件标记和依据。",
    emptyText: "暂无关键器件数据",
    key: "key-units",
    title: "关键器件",
  },
  {
    artifact: "catalog_match",
    columns: [
      { key: "index", label: "序号", width: 70 },
      { key: "list_model", label: "清单型号", width: 150 },
      { key: "list_manufacturer", label: "清单厂商", width: 130 },
      { key: "国产/进口", label: "国产/进口", width: 110 },
      { key: "catalog_model", label: "目录型号", width: 150 },
      { key: "catalog_manufacturer", label: "目录厂商", width: 150 },
      { key: "is_in_catalog", label: "匹配状态", width: 120 },
      { key: "score", label: "得分", width: 90 },
    ],
    description: "展示目录匹配结果，保留型号、厂商、状态和备注。",
    emptyText: "暂无目录匹配数据",
    key: "catalog",
    title: "目录匹配",
  },
  {
    artifact: "quality_level_check",
    columns: [
      { key: "index", label: "序号", width: 70 },
      { key: "名称", label: "器件名称", width: 140 },
      { key: "型号规格", label: "型号规格", width: 140 },
      { key: "厂商", label: "生产厂商", width: 130 },
      { key: "封装形式", label: "封装形式", width: 110 },
      { key: "国产/进口", label: "国产/进口", width: 110 },
      { key: "质量等级", label: "质量等级", width: 110 },
      { key: "最低要求", label: "最低要求", width: 110 },
      { key: "关键部位", label: "关键部位", width: 110 },
      { key: "是否满足要求", label: "检查状态", width: 120 },
      { key: "reason", label: "问题说明", width: 240 },
    ],
    description: "展示质量等级符合性检查结果，进口器件最低要求默认按工业级及以上判定。",
    emptyText: "暂无质量等级检查数据",
    key: "quality-level",
    title: "质量等级",
  },
  {
    artifact: "reliability_query",
    columns: [
      { key: "index", label: "序号", width: 70 },
      { key: "component_name", label: "器件名称", width: 140 },
      { key: "model", label: "型号规格", width: 140 },
      { key: "manufacturer", label: "生产厂商", width: 130 },
      { key: "quality_match_level", label: "质量命中类型", width: 120 },
      { key: "quality_count", label: "质量直接命中", width: 120 },
      { key: "quality_summary", label: "质量问题摘要", width: 280 },
      { key: "radiation_match_level", label: "辐照命中类型", width: 120 },
      { key: "radiation_count", label: "辐照直接命中", width: 120 },
      { key: "radiation_summary", label: "辐照信息摘要", width: 280 },
    ],
    description: "展示质量问题和辐照/辐射效应数据库查询结果。",
    emptyText: "暂无质量问题与辐照信息查询数据",
    key: "reliability",
    title: "质量/辐照查询",
  },
] as const

type ComplianceTab = typeof COMPLIANCE_TABS[number]
type ActiveTabKey = "dashboard" | "compliance-check" | ComplianceTab["key"]

type DashboardMetric = {
  label: string
  tone: "neutral" | "ok" | "warn" | "bad"
  value: string
}

type DashboardRiskRow = {
  action: string
  component: string
  issue: string
  manufacturer: string
  model: string
  module: string
  priority: "高" | "中" | "低"
  status: string
}

type DashboardModuleRow = {
  count: number
  done: boolean
  issue: number
  label: string
  ok: number
}

type DashboardRecommendation = {
  text: string
  tone: "neutral" | "ok" | "warn" | "bad"
}

type PercentItem = {
  color: string
  label: string
  value: number
}

type ModuleInsight = {
  catalog: {
    averageScore: number
    groupShare: PercentItem[]
    matchedCount: number
    unmatchedCount: number
  }
  classification: {
    classShare: PercentItem[]
    categoryShare: PercentItem[]
    total: number
  }
  complianceCheck: {
    aiPassRate: number
    missingItemCount: number
  }
  keyUnits: {
    keyCount: number
    keyShare: number
    samples: string[]
    total: number
  }
  qualityLevel: {
    importIndustrialCount: number
    issueCount: number
    okCount: number
    total: number
  }
  manufacturer: {
    catalogInRate: number
    unmatchedCount: number
    originShare: PercentItem[]
  }
  reliability: {
    cleanCount: number
    hitCount: number
    qualityHits: number
    radiationHits: number
    total: number
  }
}

type DashboardProgress = {
  percentage: number
  statusLabel: string
  status: WorkflowProgressSummary["status"]
}

const RESULT_CSV_COLUMNS = [
  ["excel_row", "序号"],
  ["元器件名称", "元器件名称"],
  ["型号规格_规格", "型号规格"],
  ["生产厂商_生产单位", "生产厂商"],
  ["降额参数", "降额参数"],
  ["参数值_额定", "额定值"],
  ["参数值_允许", "允许值"],
  ["参数值_实际", "实际值"],
  ["降额因子_规定", "降额因子_规定"],
  ["降额因子_实际", "降额因子_实际"],
  ["降额等级", "降额等级"],
  ["备注", "备注"],
  ["元器件大类", "LLM判定大类"],
  ["元器件子类", "LLM判定子类"],
  ["标准参数", "标准降额参数"],
  ["标准I级降额", "I级额定降额值"],
  ["缺少降额项", "缺少降额项"],
  ["降额因子判定", "降额因子判定"],
  ["允许值判定", "允许值判定"],
  ["实际值判定", "实际值判定"],
  ["实际降额因子判定", "实际降额因子判定"],
  ["温度判定", "温度判定"],
  ["综合判定", "综合判定"],
] as const

const COMPARISON_COLUMNS: Record<string, { aiKey: string; tableKey: string; tableLabel: string }> = {
  允许值判定组合: { aiKey: "允许值判定", tableKey: "参数值_允许", tableLabel: "允许值" },
  实际值判定组合: { aiKey: "实际值判定", tableKey: "参数值_实际", tableLabel: "实际值" },
  降额因子判定组合: { aiKey: "降额因子判定", tableKey: "降额因子_规定", tableLabel: "规定因子" },
  实际降额因子判定组合: { aiKey: "实际降额因子判定", tableKey: "降额因子_实际", tableLabel: "实际因子" },
}

function asText(value: unknown): string {
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join("; ")
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  if (typeof value === "boolean") return value ? "true" : "false"
  return typeof value === "string" ? value : ""
}

function buildWorkspaceQuery({ versionId, workspaceDir, workspaceId }: ComplianceCheckPanelProps) {
  const params = new URLSearchParams()
  if (workspaceId) params.set("workspaceId", workspaceId)
  if (versionId) params.set("versionId", versionId)
  if (workspaceDir) params.set("workspaceDir", workspaceDir)
  const query = params.toString()
  return query ? `?${query}` : ""
}

function buildWorkspaceApiPath(path: string, query: string) {
  return `${joinApiPath(undefined, path)}${query}`
}

function progressFromSummary(summary: WorkflowProgressSummary): DashboardProgress {
  return {
    percentage: summary.percentage,
    status: summary.status,
    statusLabel: summary.statusLabel,
  }
}

function csvEscape(value: unknown) {
  const text = asText(value)
  return /[",\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text
}

function issueText(row: JsonRow) {
  const issues = row["问题"]
  if (Array.isArray(issues)) return issues.map(asText).filter(Boolean).join("；")
  return asText(issues)
}

function rowIssues(row: JsonRow) {
  const issues = Array.isArray(row["问题"]) ? row["问题"].map(asText).filter(Boolean) : []
  const detail = asText(row["综合判定详情"])
  return detail ? [...issues, detail] : issues
}

function hasIssue(row: JsonRow, pattern: RegExp) {
  return rowIssues(row).some(issue => pattern.test(issue))
}

function valueWithSourceUnit(value: unknown, sourceValue: unknown) {
  const text = asText(value)
  const source = asText(sourceValue)
  if (!text) return ""
  if (!source) return text
  const unitMatch = source.match(/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)\s*([^\d\s].*)$/u)
  const unit = unitMatch?.[1]?.trim()
  return unit && !text.includes(unit) ? `${text}${unit}` : text
}

function statusText(row: JsonRow) {
  return asText(row["综合判定"]) || asText(row["符合性"]) || "需确认"
}

function isDeratingIssue(row: JsonRow) {
  const status = statusText(row)
  return status !== "符合"
}

function resultField(row: JsonRow, key: string) {
  if (key === "型号规格_规格") return row["型号规格_规格"] ?? row["型号规格"]
  if (key === "生产厂商_生产单位") return row["生产厂商_生产单位"] ?? row["生产厂商"]
  if (key === "参数值_额定") return row["参数值_额定"] ?? row["额定值"]
  if (key === "参数值_允许") return row["参数值_允许"] ?? row["允许值"]
  if (key === "参数值_实际") return row["参数值_实际"] ?? row["实际值"]
  if (key === "降额因子_规定") return row["降额因子_规定"] ?? row["标准I级降额"]
  if (key === "降额因子_实际") return row["降额因子_实际"] ?? row["计算实际降额因子"]
  return row[key]
}

function deratingDetailText(row: JsonRow) {
  const explicit = asText(row["综合判定详情"]) || issueText(row)
  if (explicit) return explicit

  const status = statusText(row)
  const actualValue = asText(resultField(row, "参数值_实际"))
  const allowedValue = asText(resultField(row, "参数值_允许"))
  const ratedValue = asText(resultField(row, "参数值_额定"))
  const standardFactor = asText(resultField(row, "降额因子_规定"))
  const actualFactor = asText(resultField(row, "降额因子_实际"))
  const computedAllowed = valueWithSourceUnit(row["计算允许值"], resultField(row, "参数值_额定"))
  const parts = [
    actualValue && computedAllowed ? `实际值 ${actualValue} 未超过 I级计算允许值 ${computedAllowed}` : "",
    actualValue && !computedAllowed && allowedValue ? `实际值 ${actualValue} 未超过允许值 ${allowedValue}` : "",
    ratedValue && standardFactor ? `额定值 ${ratedValue}，I级降额要求 ${standardFactor}` : "",
    allowedValue ? `表中允许值 ${allowedValue}` : "",
    actualFactor ? `实际降额因子 ${actualFactor}` : "",
  ].filter(Boolean)

  if (parts.length) return `${status}：${parts.join("；")}`
  return status === "符合" ? "符合：未发现降额问题" : status
}

function passCount(rows: JsonRow[]) {
  return rows.filter(row => statusText(row) === "符合").length
}

function problemCount(rows: JsonRow[]) {
  return rows.filter(isDeratingIssue).length
}

function stricterCount(rows: JsonRow[]) {
  return rows.filter(row => hasIssue(row, /更严格|规定降额因子小于/u)).length
}

function getResultValue(row: JsonRow, key: string) {
  if (key === "序号") return row["序号"] ?? row["excel_row"]
  if (key === "AI分类") return asText(row["AI分类"]) || [row["元器件大类"], row["元器件子类"]].map(asText).filter(Boolean).join("-")
  if (key === "I级降额公式") return asText(row["I级降额公式"]) || asText(row["标准I级降额"])
  if (key === "允许值判定组合") return asText(row["允许值判定组合"]) || [resultField(row, "参数值_允许"), row["允许值判定"]].map(asText).filter(Boolean).join(" ▸ ")
  if (key === "实际值判定组合") return asText(row["实际值判定组合"]) || [resultField(row, "参数值_实际"), row["实际值判定"]].map(asText).filter(Boolean).join(" ▸ ")
  if (key === "降额因子判定组合") return asText(row["降额因子判定组合"]) || [resultField(row, "降额因子_规定"), row["降额因子判定"]].map(asText).filter(Boolean).join(" ▸ ")
  if (key === "实际降额因子判定组合") return asText(row["实际降额因子判定组合"]) || [resultField(row, "降额因子_实际"), row["实际降额因子判定"]].map(asText).filter(Boolean).join(" ▸ ")
  if (key === "判定结果") return statusText(row)
  if (key === "综合判定详情") return deratingDetailText(row)
  return resultField(row, key)
}

function getComparisonValue(row: JsonRow, key: string) {
  const comparison = COMPARISON_COLUMNS[key]
  if (!comparison) return null

  const combined = asText(row[key]).split("▸").map(part => part.trim()).filter(Boolean)
  return {
    aiValue: asText(row[comparison.aiKey]) || combined[1] || deriveComparisonJudgement(row, key),
    tableLabel: comparison.tableLabel,
    tableValue: asText(resultField(row, comparison.tableKey)) || combined[0] || "",
  }
}

function displayNumber(value: string) {
  const text = value.trim()
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/iu.test(text)) return value
  const numberValue = Number(text)
  if (!Number.isFinite(numberValue)) return value
  const rounded = Math.round(numberValue * 10000) / 10000
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(4).replace(/0+$/u, "").replace(/\.$/u, "")
}

function deriveComparisonJudgement(row: JsonRow, key: string) {
  if (key === "允许值判定组合") {
    if (hasIssue(row, /允许值不等于|允许值.*错误|允许值.*填写错误/u)) {
      const expected = valueWithSourceUnit(row["计算允许值"], resultField(row, "参数值_允许"))
      return expected ? `表中填写错误，应为 ${expected}` : "表中填写错误"
    }
    return "正确"
  }

  if (key === "实际值判定组合") {
    if (hasIssue(row, /实际值大于允许值|实际值.*超过允许值|实际值.*错误|实际值.*不符合/u)) return "实际值大于允许值"
    return "正确"
  }

  if (key === "降额因子判定组合") {
    if (hasIssue(row, /规定降额因子大于|规定降额因子.*标准值/u)) return "规定降额因子大于 I 级标准值"
    if (hasIssue(row, /规定降额因子小于|更严格/u)) return "规定降额因子更严格"
    return "正确"
  }

  if (key === "实际降额因子判定组合") {
    if (hasIssue(row, /实际降额因子.*填写错误|实际降额因子大于规定降额因子/u)) return "实际降额因子问题"
    return "正确"
  }

  return ""
}

function isPositiveJudgement(value: string) {
  return /^(符合|满足|正确|正常|通过|目录内|ok|pass|true|yes)$/iu.test(value.trim())
}

function isNegativeJudgement(value: string) {
  return /(不符合|错误|异常|问题|失败|不通过|fail|warning|警告|应为|不等于|缺少|存在)/iu.test(value)
}

function writeResultValue(row: JsonRow, key: string, value: string) {
  if (key === "序号") return { ...row, excel_row: value }
  if (key === "AI分类") return { ...row, AI分类: value }
  if (key === "I级降额公式") return { ...row, I级降额公式: value }
  if (key === "允许值判定组合") return { ...row, 允许值判定组合: value }
  if (key === "实际值判定组合") return { ...row, 实际值判定组合: value }
  if (key === "降额因子判定组合") return { ...row, 降额因子判定组合: value }
  if (key === "实际降额因子判定组合") return { ...row, 实际降额因子判定组合: value }
  if (key === "判定结果") return { ...row, 符合性: value, 综合判定: value }
  if (key === "综合判定详情") return { ...row, 综合判定详情: value }
  return { ...row, [key]: value }
}

function previousUnique(values: string[]) {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))]
}

function updateManufacturerConfirmationRow(row: JsonRow, key: string, value: string) {
  const next = { ...row, [key]: value }
  if (key === "国产/进口" && value === "进口") {
    return { ...next, "厂商全称": "无", "目录内或外": "无" }
  }
  if (key === "目录内或外" && value !== "目录内") {
    return { ...next, "厂商全称": "无" }
  }
  if (key === "厂商全称") {
    return value && value !== "无"
      ? { ...next, "国产/进口": "国产", "目录内或外": "目录内" }
      : { ...next, "目录内或外": asText(next["国产/进口"]) === "进口" ? "无" : "目录外" }
  }
  return next
}

function fullNamesFromPayload(value: unknown) {
  return isJsonRecord(value) && Array.isArray(value.full_names)
    ? previousUnique(value.full_names.map(asText))
    : []
}

function selectValueForOptions(value: string, options: string[]) {
  const trimmedValue = value.trim()
  if (options.includes(trimmedValue)) return trimmedValue
  if (options.includes("无")) return "无"
  if (options.includes("未填写")) return "未填写"
  if (isPositiveJudgement(value) && options.includes("符合")) return "符合"
  if (options.includes("不符合")) return "不符合"
  return options[0] ?? ""
}

function reliabilityBlock(row: JsonRow, key: "quality" | "radiation") {
  return isJsonRecord(row[key]) ? row[key] as JsonRow : {}
}

function reliabilityRecords(block: JsonRow) {
  return Array.isArray(block.records) ? block.records.filter(isJsonRecord) : []
}

function normalizeReliabilityModel(value: unknown) {
  return asText(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/gu, "")
    .trim()
}

function reliabilityModelFragments(value: unknown) {
  const text = asText(value).toUpperCase()
  const fragments = new Set<string>()
  const compact = normalizeReliabilityModel(text)
  if (compact.length >= 5) fragments.add(compact)

  const pieces = text
    .split(/[^A-Z0-9]+/u)
    .map(piece => piece.trim())
    .filter(piece => piece.length >= 5)
  pieces.forEach(piece => {
    fragments.add(piece)
    const suffix = piece.match(/[0-9][A-Z0-9]{4,}$/u)?.[0]
    if (suffix) fragments.add(suffix)
  })

  const compactSuffix = compact.match(/[0-9][A-Z0-9]{4,}$/u)?.[0]
  if (compactSuffix) fragments.add(compactSuffix)
  return Array.from(fragments)
}

function reliabilityRecordModels(record: JsonRow) {
  return [
    record.model,
    record.component_model,
    record["型号规格"],
    record["型号"],
  ]
    .map(normalizeReliabilityModel)
    .filter(Boolean)
}

function reliabilityDirectRecords(row: JsonRow, key: "quality" | "radiation") {
  const model = normalizeReliabilityModel(row.model ?? row["型号规格"])
  if (!model) return []
  return reliabilityRecords(reliabilityBlock(row, key))
    .filter(record => reliabilityRecordModels(record).some(recordModel => recordModel === model))
}

function reliabilityReferenceRecords(row: JsonRow, key: "quality" | "radiation") {
  const model = normalizeReliabilityModel(row.model ?? row["型号规格"])
  if (!model) return []
  const queryFragments = reliabilityModelFragments(row.model ?? row["型号规格"])
    .filter(fragment => fragment !== model)
  if (queryFragments.length === 0) return []
  return reliabilityRecords(reliabilityBlock(row, key))
    .filter(record => {
      const recordModels = reliabilityRecordModels(record)
      if (recordModels.some(recordModel => recordModel === model)) return false
      return recordModels.some(recordModel => queryFragments.some(fragment => recordModel.includes(fragment)))
    })
}

function reliabilityMatchedFragment(row: JsonRow, key: "quality" | "radiation") {
  const model = normalizeReliabilityModel(row.model ?? row["型号规格"])
  const directRecords = reliabilityDirectRecords(row, key)
  if (directRecords.length > 0) return asText(row.model ?? row["型号规格"])
  const queryFragments = reliabilityModelFragments(row.model ?? row["型号规格"])
    .filter(fragment => fragment !== model)
  const referenceRecords = reliabilityReferenceRecords(row, key)
  for (const record of referenceRecords) {
    const recordModels = reliabilityRecordModels(record)
    const fragment = queryFragments.find(candidate => recordModels.some(recordModel => recordModel.includes(candidate)))
    if (fragment) return fragment
  }
  return ""
}

function reliabilityMatchLevel(row: JsonRow, key: "quality" | "radiation") {
  const directCount = reliabilityDirectRecords(row, key).length
  if (directCount > 0) return "直接命中"
  return reliabilityReferenceRecords(row, key).length > 0 ? "参考命中" : "未命中"
}

function reliabilityDirectCount(row: JsonRow, key: "quality" | "radiation") {
  return reliabilityMatchLevel(row, key) === "直接命中" ? reliabilityDirectRecords(row, key).length : 0
}

function reliabilityDirectSummary(row: JsonRow, key: "quality" | "radiation") {
  const directRecords = reliabilityDirectRecords(row, key)
  if (directRecords.length === 0) return ""
  return reliabilityRecordsSummary(directRecords, key)
}

function reliabilityReferenceSummary(row: JsonRow, key: "quality" | "radiation") {
  const referenceRecords = reliabilityReferenceRecords(row, key)
  if (referenceRecords.length === 0) return ""
  return reliabilityRecordsSummary(referenceRecords, key)
}

function reliabilityRecordsSummary(records: JsonRow[], key: "quality" | "radiation") {
  return records.slice(0, 5).map(record => {
    if (key === "quality") {
      return [
        record.model,
        record.component_type,
        record.manufacturer,
        record.issue_description,
      ].map(asText).filter(Boolean).join("；")
    }
    return [
      record.model,
      record.component_type,
      record.radiation_source,
      record.single_event_effects ?? record.total_dose_effects ?? record.functional_impact ?? record.observed_phenomena,
    ].map(asText).filter(Boolean).join("；")
  }).filter(Boolean).join("\n")
}

function reliabilityDisplaySummary(row: JsonRow, key: "quality" | "radiation") {
  const directSummary = reliabilityDirectSummary(row, key)
  if (directSummary) return directSummary
  const referenceSummary = reliabilityReferenceSummary(row, key)
  if (referenceSummary) return `参考命中：${referenceSummary}`
  return key === "quality" ? "未检索到质量问题记录" : "未检索到辐射效应记录"
}

function normalizeComplianceRow(row: JsonRow) {
  const selectedCandidate = isJsonRecord(row.selected_candidate) ? row.selected_candidate : null
  const bestCandidate = bestCatalogCandidate(row)
  const quality = isJsonRecord(row.quality) ? row.quality : {}
  const radiation = isJsonRecord(row.radiation) ? row.radiation : {}
  const name = row.component_name ?? row.name ?? row["名称"] ?? row["元器件名称"]
  const manufacturer = row.manufacturer ?? row.normalized_manufacturer ?? row["厂商"] ?? row["生产厂商"]
  const status = row.status ?? row.result ?? row.match_status ?? row.compliance_status ?? row["状态"] ?? row["目录内或外"] ?? row.is_in_catalog ?? row["是否满足要求"]
  const normalized = {
    ...row,
    catalog_manufacturer: row.catalog_manufacturer ?? selectedCandidate?.catalog_manufacturer ?? bestCandidate?.catalog_manufacturer ?? "",
    catalog_model: row.catalog_model ?? selectedCandidate?.catalog_model ?? bestCandidate?.catalog_model ?? "",
    component_name: name,
    manufacturer,
    model: row.model ?? row["型号规格"],
    status,
  }
  return {
    ...normalized,
    quality_raw_count: row.quality_count ?? quality.count ?? 0,
    radiation_raw_count: row.radiation_count ?? radiation.count ?? 0,
    quality_count: reliabilityDirectCount(normalized, "quality"),
    quality_match_level: reliabilityMatchLevel(normalized, "quality"),
    quality_summary: reliabilityDisplaySummary(normalized, "quality"),
    radiation_count: reliabilityDirectCount(normalized, "radiation"),
    radiation_match_level: reliabilityMatchLevel(normalized, "radiation"),
    radiation_summary: reliabilityDisplaySummary(normalized, "radiation"),
  }
}

function isJsonRecord(value: unknown): value is JsonRow {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function getComplianceValue(row: JsonRow, key: string) {
  if (key === "catalog_model") {
    const selectedCandidate = isJsonRecord(row.selected_candidate) ? row.selected_candidate : null
    const bestCandidate = bestCatalogCandidate(row)
    return row.catalog_model ?? selectedCandidate?.catalog_model ?? bestCandidate?.catalog_model ?? "无"
  }
  if (key === "catalog_manufacturer") {
    const selectedCandidate = isJsonRecord(row.selected_candidate) ? row.selected_candidate : null
    const bestCandidate = bestCatalogCandidate(row)
    return row.catalog_manufacturer ?? selectedCandidate?.catalog_manufacturer ?? bestCandidate?.catalog_manufacturer ?? "无"
  }
  return row[key]
}

function catalogCandidates(row: JsonRow) {
  return flattenCatalogCandidates(row.candidates).sort((left, right) => catalogCandidateScore(right) - catalogCandidateScore(left))
}

function flattenCatalogCandidates(value: unknown): JsonRow[] {
  if (!Array.isArray(value)) return []
  const output: JsonRow[] = []
  value.forEach(item => {
    if (!isJsonRecord(item)) return
    const nested = item.candidates ?? item.items ?? item.options
    if (Array.isArray(nested)) {
      output.push(...flattenCatalogCandidates(nested))
      return
    }
    output.push(item)
  })
  return output
}

function catalogCandidateScore(candidate: JsonRow | null) {
  if (!candidate) return Number.NEGATIVE_INFINITY
  const raw = candidate.score ?? candidate._score
  if (typeof raw === "number" && Number.isFinite(raw)) return raw
  const value = Number(asText(raw))
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY
}

function bestCatalogCandidate(row: JsonRow) {
  return catalogCandidates(row)[0] ?? null
}

function selectedCatalogCandidate(row: JsonRow) {
  if (row.selected_by_user === true && isJsonRecord(row.selected_candidate)) return row.selected_candidate
  return bestCatalogCandidate(row) ?? (isJsonRecord(row.selected_candidate) ? row.selected_candidate : null)
}

function catalogCandidateKey(candidate: JsonRow | null) {
  if (!candidate) return ""
  return [
    asText(candidate.catalog_model),
    asText(candidate.catalog_manufacturer),
    asText(candidate.catalog_group),
  ].join("|")
}

function catalogDetail(candidate: JsonRow | null) {
  if (!candidate) return {}
  if (isJsonRecord(candidate.detail)) return candidate.detail
  const detail = isJsonRecord(candidate.catalog_detail) ? candidate.catalog_detail : {}
  const rawDetail = detail.detail
  if (typeof rawDetail === "string" && rawDetail.trim()) {
    try {
      const parsed = JSON.parse(rawDetail) as unknown
      return isJsonRecord(parsed) ? { ...detail, ...parsed } : detail
    } catch {
      return { ...detail, 详情: rawDetail }
    }
  }
  return detail
}

function catalogDetailText(candidate: JsonRow | null) {
  const detail = catalogDetail(candidate)
  const preferredKeys = ["执行标准", "质量等级", "封装形式", "温度范围", "TID", "SEE", "SEB"]
  const parts = preferredKeys
    .map(key => {
      const value = asText(detail[key])
      return value ? `${key}: ${value}` : ""
    })
    .filter(Boolean)
  if (parts.length) return parts.join("；")

  return Object.entries(detail)
    .filter(([key]) => !["detail"].includes(key))
    .slice(0, 6)
    .map(([key, value]) => `${key}: ${asText(value)}`)
    .filter(item => !item.endsWith(": "))
    .join("；")
}

function catalogScoreText(candidate: JsonRow | null) {
  const raw = candidate?.score
  if (typeof raw === "number" && Number.isFinite(raw)) return `${Math.round(raw * 1000) / 10}分`
  const text = asText(raw)
  if (!text) return ""
  const value = Number(text)
  return Number.isFinite(value) ? `${Math.round(value * 1000) / 10}分` : text
}

function catalogCandidateSummary(candidate: JsonRow | null) {
  if (!candidate) return null
  const detail = catalogDetail(candidate)
  return {
    detail: catalogDetailText(candidate),
    fullManufacturer: asText(detail.manufacturer_full_name),
    group: asText(candidate.catalog_group ?? detail.group),
    manufacturer: asText(candidate.catalog_manufacturer ?? detail.manufacturer),
    model: asText(candidate.catalog_model ?? detail.model),
    reason: asText(candidate.reason),
    score: catalogScoreText(candidate),
  }
}

function complianceStatusCounts(rows: JsonRow[]) {
  const issue = rows.filter(row => {
    const status = asText(row.status ?? row["目录内或外"] ?? row.is_in_catalog ?? row["是否满足要求"])
    return status && !isPositiveJudgement(status)
  }).length
  return { issue, ok: rows.length - issue }
}

function percent(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 100) : 0
}

function countBy(rows: JsonRow[], getKey: (row: JsonRow) => string, fallback = "未识别") {
  const counts = new Map<string, number>()
  rows.forEach(row => {
    const key = getKey(row) || fallback
    counts.set(key, (counts.get(key) ?? 0) + 1)
  })
  return counts
}

function percentItems(counts: Map<string, number>, colors: string[], limit = 5): PercentItem[] {
  const total = Array.from(counts.values()).reduce((sum, value) => sum + value, 0)
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([label, value], index) => ({
      color: colors[index % colors.length],
      label,
      value: percent(value, total),
    }))
}

function catalogGroup(row: JsonRow) {
  const selected = selectedCatalogCandidate(row)
  return asText(row.catalog_group ?? selected?.catalog_group ?? catalogDetail(selected).group).toUpperCase()
}

function isKnownCatalogGroup(group: string) {
  return Boolean(group && !["-", "无", "未知", "未分组"].includes(group))
}

function keyUnitFlag(row: JsonRow) {
  const value = asText(row.is_key_part ?? row["关键器件"] ?? row.status)
  return /^(true|是|关键|yes|1)$/iu.test(value)
}

function reliabilityHitCounts(row: JsonRow) {
  return {
    quality: Math.max(0, Number(row.quality_count ?? reliabilityDirectCount(row, "quality")) || 0),
    radiation: Math.max(0, Number(row.radiation_count ?? reliabilityDirectCount(row, "radiation")) || 0),
  }
}

function reliabilityIssueCount(rows: JsonRow[]) {
  return rows.filter(row => {
    const hits = reliabilityHitCounts(row)
    return hits.quality > 0 || hits.radiation > 0
  }).length
}

function buildModuleInsights(missingRows: JsonRow[], resultRows: JsonRow[], complianceRows: Record<string, JsonRow[]>): ModuleInsight {
  const classificationRows = complianceRows.classification ?? []
  const manufacturerRows = complianceRows.manufacturer ?? []
  const keyRows = complianceRows["key-units"] ?? []
  const catalogRows = complianceRows.catalog ?? []
  const qualityRows = complianceRows["quality-level"] ?? []
  const reliabilityRows = complianceRows.reliability ?? []
  const totalComponentCount = classificationRows.length || missingRows.length || resultRows.length || keyRows.length || qualityRows.length || reliabilityRows.length
  const keyCount = keyRows.filter(keyUnitFlag).length
  const qualityCounts = complianceStatusCounts(qualityRows)
  const reliabilityQualityHits = reliabilityRows.reduce((total, row) => total + reliabilityHitCounts(row).quality, 0)
  const reliabilityRadiationHits = reliabilityRows.reduce((total, row) => total + reliabilityHitCounts(row).radiation, 0)
  const reliabilityHitCount = reliabilityIssueCount(reliabilityRows)
  const groupedCatalogRows = catalogRows.filter(row => isKnownCatalogGroup(catalogGroup(row)))
  const catalogScores = groupedCatalogRows
    .map(row => catalogCandidateScore(selectedCatalogCandidate(row)) > Number.NEGATIVE_INFINITY ? catalogCandidateScore(selectedCatalogCandidate(row)) : Number(row.score))
    .filter(score => Number.isFinite(score) && score >= 0)
  const averageScore = catalogScores.length > 0
    ? Math.round((catalogScores.reduce((sum, value) => sum + value, 0) / catalogScores.length) * 1000) / 10
    : 0
  const keySamples = keyRows
    .filter(keyUnitFlag)
    .slice(0, 3)
    .map(row => [componentName(row), componentModel(row)].filter(value => value !== "-").join(" / ") || componentName(row))

  return {
    catalog: {
      averageScore,
      groupShare: percentItems(countBy(groupedCatalogRows, row => catalogGroup(row)), [KPI_BLUE, KPI_TEAL, KPI_ORANGE, KPI_VIOLET], 4),
      matchedCount: catalogRows.filter(row => /目录内/u.test(asText(row.is_in_catalog ?? row.status))).length,
      unmatchedCount: catalogRows.filter(row => !/目录内/u.test(asText(row.is_in_catalog ?? row.status))).length,
    },
    classification: {
      categoryShare: percentItems(countBy(classificationRows, row => asText(row.category_name ?? row["类别"] ?? row["元器件子类"])), [KPI_BLUE, KPI_TEAL, KPI_ORANGE, KPI_PINK, KPI_VIOLET], 6),
      classShare: percentItems(countBy(classificationRows, row => asText(row.category_class ?? row["大类"] ?? row["元器件大类"])), [KPI_BLUE, KPI_TEAL, KPI_ORANGE], 3),
      total: classificationRows.length,
    },
    complianceCheck: {
      aiPassRate: percent(passCount(resultRows), resultRows.length),
      missingItemCount: missingRows.reduce((total, row) => total + Math.max(0, Number(row.missing_count ?? 0) || 0), 0),
    },
    keyUnits: {
      keyCount,
      keyShare: percent(keyCount, totalComponentCount),
      samples: keySamples,
      total: totalComponentCount,
    },
    qualityLevel: {
      importIndustrialCount: qualityRows.filter(row => asText(row["国产/进口"]) === "进口" && /工业级/u.test(asText(row["最低要求"]))).length,
      issueCount: qualityCounts.issue,
      okCount: qualityCounts.ok,
      total: qualityRows.length,
    },
    manufacturer: {
      catalogInRate: percent(manufacturerRows.filter(row => /目录内/u.test(asText(row["目录内或外"] ?? row.status))).length, manufacturerRows.length),
      originShare: percentItems(countBy(manufacturerRows, row => asText(row["国产/进口"] ?? row.origin)), [KPI_TEAL, KPI_ORANGE, KPI_BLUE], 3),
      unmatchedCount: manufacturerRows.filter(row => {
        const status = asText(row["目录内或外"] ?? row.status)
        return status && !/目录内/u.test(status)
      }).length,
    },
    reliability: {
      cleanCount: Math.max(0, reliabilityRows.length - reliabilityHitCount),
      hitCount: reliabilityHitCount,
      qualityHits: reliabilityQualityHits,
      radiationHits: reliabilityRadiationHits,
      total: reliabilityRows.length,
    },
  }
}

function statusTone(status: string): "ok" | "bad" | "warn" {
  if (isPositiveJudgement(status)) return "ok"
  if (isNegativeJudgement(status)) return "bad"
  return "warn"
}

function dashboardIssueLabel(row: JsonRow) {
  const missing = asText(row["missing_standard_parameters"])
  if (missing) return "缺少降额项"
  if (hasIssue(row, /实际值/u)) return "实际值问题"
  if (hasIssue(row, /允许值/u)) return "允许值问题"
  if (hasIssue(row, /降额因子/u)) return "降额因子问题"
  return asText(row["降额参数"]) || "需人工确认"
}

function dashboardAction(row: JsonRow) {
  const detail = deratingDetailText(row)
  if (/实际值大于允许值|实际值.*超限|热设计/u.test(detail)) return "复核热设计"
  if (/允许值.*错误|应为/u.test(detail)) return "修正允许值"
  if (/降额因子/u.test(detail)) return "复核降额因子"
  if (/缺少/u.test(detail)) return "补充参数"
  return "人工确认"
}

function componentName(row: JsonRow) {
  return asText(row.component_name ?? row.name ?? row["名称"] ?? row["元器件名称"] ?? row.list_model) || "-"
}

function componentModel(row: JsonRow) {
  return asText(row.model ?? row["型号规格_规格"] ?? row["型号规格"] ?? row.list_model) || "-"
}

function componentManufacturer(row: JsonRow) {
  return asText(row.manufacturer ?? row.normalized_manufacturer ?? row["厂商"] ?? row["生产厂商_生产单位"] ?? row["生产厂商"] ?? row.list_manufacturer) || "-"
}

function modelSpecKeys(row: JsonRow) {
  return asText(row.model ?? row["型号规格_规格"] ?? row["型号规格"] ?? row.list_model)
    .split(/[;；\n\r]+/u)
    .map(value => value.trim().toLowerCase().replace(/\s+/gu, ""))
    .filter(Boolean)
}

function buildDashboardRiskRows(resultRows: JsonRow[], missingRows: JsonRow[]): DashboardRiskRow[] {
  const missingByComponent = new Map(missingRows.map(row => [asText(row["元器件名称"]), row]))
  const issueRows = resultRows
    .filter(isDeratingIssue)
    .slice(0, 5)
    .map((row): DashboardRiskRow => ({
      action: dashboardAction(row),
      component: componentName(row),
      issue: dashboardIssueLabel(row),
      manufacturer: componentManufacturer(row),
      model: componentModel(row),
      module: "降额检查",
      priority: "高",
      status: statusText(row),
    }))

  if (issueRows.length >= 5) return issueRows

  const existing = new Set(issueRows.map(row => row.component))
  const missingIssueRows = missingRows
    .filter(row => Number(row.missing_count ?? 0) > 0 && !existing.has(asText(row["元器件名称"])))
    .slice(0, 5 - issueRows.length)
    .map((row): DashboardRiskRow => {
      const component = asText(row["元器件名称"])
      const source = missingByComponent.get(component) ?? row
      return {
        action: "补充降额参数",
        component: component || "-",
        issue: asText(source["missing_standard_parameters"]) || "缺少降额项",
        manufacturer: componentManufacturer(source),
        model: componentModel(source),
        module: "降额缺项",
        priority: "高",
        status: "待确认",
      }
    })

  return [...issueRows, ...missingIssueRows]
}

function complianceIssueRows(rows: JsonRow[], module: string, issueLabel: string, action: string): DashboardRiskRow[] {
  return rows
    .filter(row => {
      const status = asText(row.status ?? row["目录内或外"] ?? row.is_in_catalog ?? row["是否满足要求"])
      return status && !isPositiveJudgement(status)
    })
    .map(row => ({
      action,
      component: componentName(row),
      issue: issueLabel,
      manufacturer: componentManufacturer(row),
      model: componentModel(row),
      module,
      priority: module === "目录匹配" ? "中" : "低",
      status: asText(row.status ?? row["目录内或外"] ?? row.is_in_catalog ?? "待确认") || "待确认",
    }))
}

function manufacturerIssueRows(rows: JsonRow[]): DashboardRiskRow[] {
  return rows
    .filter(row => {
      const status = asText(row.status ?? row["目录内或外"] ?? row["是否满足要求"])
      return status && !isPositiveJudgement(status)
    })
    .map(row => {
      const shortName = asText(row["厂商简称"] ?? row.normalized_manufacturer ?? row.manufacturer)
      const fullName = asText(row["厂商全称"] ?? row.manufacturer_full_name)
      const origin = asText(row["国产/进口"])
      const catalogStatus = asText(row["目录内或外"] ?? row.status ?? "待确认") || "待确认"
      return {
        action: "确认厂商来源与目录状态",
        component: shortName || fullName || "-",
        issue: [origin, catalogStatus].filter(Boolean).join(" / ") || "厂商状态待确认",
        manufacturer: fullName || shortName || "-",
        model: origin || "-",
        module: "厂商匹配",
        priority: "中",
        status: catalogStatus,
      }
    })
}

function catalogIssueRows(rows: JsonRow[]): DashboardRiskRow[] {
  return rows
    .filter(row => {
      const status = asText(row.status ?? row.is_in_catalog ?? row["目录内或外"])
      return status && !isPositiveJudgement(status)
    })
    .map(row => ({
      action: "选择或确认目录条目",
      component: asText(row.list_model ?? row.catalog_model) || "-",
      issue: asText(row.reason) || "目录匹配待确认",
      manufacturer: asText(row.list_manufacturer ?? row.catalog_manufacturer) || "-",
      model: asText(row.catalog_model) || "-",
      module: "目录匹配",
      priority: "中",
      status: asText(row.is_in_catalog ?? row.status ?? "待确认") || "待确认",
    }))
}

function qualityLevelIssueRows(rows: JsonRow[]): DashboardRiskRow[] {
  return rows
    .filter(row => {
      const status = asText(row.status ?? row["是否满足要求"])
      return status && !isPositiveJudgement(status)
    })
    .map(row => ({
      action: "确认质量等级",
      component: componentName(row),
      issue: asText(row.reason) || `质量等级 ${asText(row["质量等级"]) || "未填写"}，最低要求 ${asText(row["最低要求"]) || "未明确"}`,
      manufacturer: componentManufacturer(row),
      model: componentModel(row),
      module: "质量等级",
      priority: asText(row["国产/进口"]) === "进口" ? "高" : "中",
      status: asText(row["是否满足要求"] ?? row.status ?? "待确认") || "待确认",
    } satisfies DashboardRiskRow))
}

function reliabilityIssueRows(rows: JsonRow[]): DashboardRiskRow[] {
  return rows
    .filter(row => {
      const hits = reliabilityHitCounts(row)
      return hits.quality > 0 || hits.radiation > 0
    })
    .map(row => {
      const hits = reliabilityHitCounts(row)
      const qualitySummary = asText(row.quality_summary ?? (isJsonRecord(row.quality) ? row.quality.answer ?? row.quality.summary : ""))
      const radiationSummary = asText(row.radiation_summary ?? (isJsonRecord(row.radiation) ? row.radiation.answer ?? row.radiation.summary : ""))
      return {
        action: "查看数据库命中",
        component: componentName(row),
        issue: [
          hits.quality > 0 ? `确认存在历史质量问题 ${hits.quality} 条` : "",
          hits.radiation > 0 ? `确认存在辐照信息 ${hits.radiation} 条` : "",
          qualitySummary || radiationSummary,
        ].filter(Boolean).join("；"),
        manufacturer: componentManufacturer(row),
        model: componentModel(row),
        module: "质量/辐照查询",
        priority: hits.radiation > 0 ? "高" : "中",
        status: "数据库命中",
      } satisfies DashboardRiskRow
    })
}

function moduleRows(missingRows: JsonRow[], resultRows: JsonRow[], complianceRows: Record<string, JsonRow[]>, finalRows: JsonRow[], finalGenerated: boolean, progress?: DashboardProgress): DashboardModuleRow[] {
  const missingCount = missingRows.filter(row => Number(row.missing_count ?? 0) > 0).length
  const resultIssue = problemCount(resultRows)
  const progressPercentage = progress?.percentage ?? 0
  const complianceCheckComplete = progress?.status === "completed" || progressPercentage >= 100
  const finalDone = finalGenerated || finalRows.length > 0 || complianceCheckComplete
  const rows: DashboardModuleRow[] = [
    {
      count: missingRows.length,
      done: missingRows.length > 0,
      issue: missingCount,
      label: "降额缺项分析",
      ok: Math.max(0, missingRows.length - missingCount),
    },
    {
      count: resultRows.length,
      done: resultRows.length > 0,
      issue: resultIssue,
      label: "AI判定结果",
      ok: passCount(resultRows),
    },
    {
      count: finalRows.length || resultRows.length,
      done: finalDone,
      issue: resultIssue,
      label: "降额总表",
      ok: Math.max(0, (finalRows.length || resultRows.length) - resultIssue),
    },
  ]

  COMPLIANCE_TABS.forEach(tab => {
    const tabRows = complianceRows[tab.key] ?? []
    const issue = tab.key === "reliability" ? reliabilityIssueCount(tabRows) : complianceStatusCounts(tabRows).issue
    const ok = Math.max(0, tabRows.length - issue)
    rows.push({
      count: tabRows.length,
      done: tabRows.length > 0,
      issue,
      label: tab.title,
      ok,
    })
  })

  return rows
}

function buildDashboardRecommendations(
  totalIssues: number,
  missingCount: number,
  catalogIssues: number,
  reliabilityIssues: number,
  completedModules: number,
  moduleCount: number,
  qualityLevelIssues: number,
): DashboardRecommendation[] {
  const items: DashboardRecommendation[] = []
  if (completedModules < moduleCount) {
    items.push({ text: `还有 ${moduleCount - completedModules} 个报告模块未生成，建议先补齐输出后再定稿。`, tone: "warn" })
  }
  if (missingCount > 0) {
    items.push({ text: `优先补充 ${missingCount} 个器件的标准降额参数，避免后续判定依据不足。`, tone: "bad" })
  }
  if (catalogIssues > 0) {
    items.push({ text: `${catalogIssues} 条目录匹配需人工确认，建议先处理国产器件目录命中情况。`, tone: "warn" })
  }
  if (qualityLevelIssues > 0) {
    items.push({ text: `${qualityLevelIssues} 个器件质量等级低于要求，进口器件按工业级及以上优先复核。`, tone: "bad" })
  }
  if (reliabilityIssues > 0) {
    items.push({ text: `${reliabilityIssues} 个器件确认存在历史质量问题或辐照信息，建议复核数据库原始记录并写入审查结论。`, tone: "bad" })
  }
  if (totalIssues === 0 && completedModules === moduleCount) {
    items.push({ text: "所有模块已生成且暂无待确认项，可进入报告归档。", tone: "ok" })
  }
  if (items.length < 3) {
    items.push({ text: "完成确认后生成降额总表，确保确认结果与明细表保持一致。", tone: "neutral" })
  }
  return items.slice(0, 4)
}

function buildDashboardSummary(missingRows: JsonRow[], resultRows: JsonRow[], complianceRows: Record<string, JsonRow[]>, finalRows: JsonRow[], finalGenerated: boolean, progress?: DashboardProgress) {
  const missingCount = missingRows.filter(row => Number(row.missing_count ?? 0) > 0).length
  const modules = moduleRows(missingRows, resultRows, complianceRows, finalRows, finalGenerated, progress)
  const totalRows = modules.reduce((total, module) => total + module.count, 0)
  const totalIssues = modules.reduce((total, module) => total + module.issue, 0)
  const completedModules = modules.filter(module => module.done).length
  const okRows = modules.reduce((total, module) => total + module.ok, 0)
  const passPercent = totalRows > 0 ? Math.round((okRows / totalRows) * 100) : 0
  const issuePercent = totalRows > 0 ? Math.round((totalIssues / totalRows) * 100) : 0
  const manufacturerCounts = complianceStatusCounts(complianceRows.manufacturer ?? [])
  const keyUnitCounts = complianceStatusCounts(complianceRows["key-units"] ?? [])
  const catalogCounts = complianceStatusCounts(complianceRows.catalog ?? [])
  const qualityLevelCounts = complianceStatusCounts(complianceRows["quality-level"] ?? [])
  const reliabilityIssues = reliabilityIssueCount(complianceRows.reliability ?? [])
  const distribution = [
    { color: HUD_RED, key: "降额", label: "降额问题", value: missingCount + problemCount(resultRows) },
    { color: HUD_WARN, key: "厂商匹配", label: "厂商匹配", value: manufacturerCounts.issue },
    { color: HUD_MUTED, key: "关键器件", label: "关键器件", value: keyUnitCounts.issue },
    { color: HUD_CYAN, key: "目录匹配", label: "目录匹配", value: catalogCounts.issue },
    { color: KPI_ORANGE, key: "质量等级", label: "质量等级", value: qualityLevelCounts.issue },
    { color: KPI_PINK, key: "质量/辐照查询", label: "质量/辐照", value: reliabilityIssues },
    { color: HUD_GREEN, key: "AI器件分类", label: "分类确认", value: complianceStatusCounts(complianceRows.classification ?? []).issue },
  ]
  const issueTotal = distribution.reduce((total, item) => total + item.value, 0)
  const complianceRisks = [
    ...manufacturerIssueRows(complianceRows.manufacturer ?? []),
    ...complianceIssueRows(complianceRows["key-units"] ?? [], "关键器件", "关键器件标记待确认", "确认关键器件属性"),
    ...catalogIssueRows(complianceRows.catalog ?? []),
    ...qualityLevelIssueRows(complianceRows["quality-level"] ?? []),
    ...reliabilityIssueRows(complianceRows.reliability ?? []),
  ]
  const riskRows = [...buildDashboardRiskRows(resultRows, missingRows), ...complianceRisks].slice(0, 8)
  const moduleCount = modules.length
  const moduleInsights = buildModuleInsights(missingRows, resultRows, complianceRows)

  return {
    catalogIssues: catalogCounts.issue,
    completedModules,
    distribution,
    issue: totalIssues,
    issuePercent,
    issueTotal,
    moduleInsights,
    missingCount,
    moduleCount,
    modules,
    passPercent,
    recommendations: buildDashboardRecommendations(totalIssues, missingCount, catalogCounts.issue, reliabilityIssues, completedModules, moduleCount, qualityLevelCounts.issue),
    riskRows,
    totalRows,
  }
}

function buildFinalRows(rows: JsonRow[], missingRows: JsonRow[]) {
  return rows.map(row => {
    const component = missingRows.find(item => asText(item["元器件名称"]) === asText(row["元器件名称"]))
    return Object.fromEntries(RESULT_CSV_COLUMNS.map(([key, label]) => {
      if (key === "缺少降额项") return [label, component?.missing_standard_parameters ?? ""]
      if (key === "综合判定") return [label, statusText(row)]
      if (key === "备注") return [label, issueText(row)]
      return [label, resultField(row, key)]
    }))
  })
}

export function ComplianceCheckPanel(props: ComplianceCheckPanelProps) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<ActiveTabKey>("dashboard")
  const [dashboardFilter] = useState("全部")
  const [missingRows, setMissingRows] = useState<JsonRow[]>([])
  const [resultRows, setResultRows] = useState<JsonRow[]>([])
  const [finalRows, setFinalRows] = useState<JsonRow[]>([])
  const [complianceRows, setComplianceRows] = useState<Record<string, JsonRow[]>>({})
  const [complianceSources, setComplianceSources] = useState<Record<string, string>>({})
  const [progressData, setProgressData] = useState<WorkspaceProgressResponse | null>(null)
  const [missingSourcePath, setMissingSourcePath] = useState("")
  const [resultSourcePath, setResultSourcePath] = useState("")
  const [savingResults, setSavingResults] = useState(false)
  const [savingCompliance, setSavingCompliance] = useState("")
  const [manufacturerFullNames, setManufacturerFullNames] = useState<string[]>([])
  const [finalGenerated, setFinalGenerated] = useState(false)
  const query = useMemo(() => buildWorkspaceQuery(props), [props.versionId, props.workspaceDir, props.workspaceId])
  const themeVars = props.theme === "light" ? lightThemeVars : darkThemeVars

  const loadAll = useCallback(() => {
    Promise.allSettled([
      fetch(buildWorkspaceApiPath("/workspace/derating/missing-items", query), { cache: "no-store" }).then(async response => {
        const data = await response.json().catch(() => null) as ComplianceCheckPayload | { error?: string } | null
        if (!response.ok) throw new Error(data && "error" in data && data.error ? data.error : "缺项 JSON 不可用")
        return data as ComplianceCheckPayload
      }),
      fetch(buildWorkspaceApiPath("/workspace/derating/check-result", query), { cache: "no-store" }).then(async response => {
        const data = await response.json().catch(() => null) as ComplianceCheckPayload | { error?: string } | null
        if (!response.ok) throw new Error(data && "error" in data && data.error ? data.error : "校验结果 JSON 不可用")
        return data as ComplianceCheckPayload
      }),
    ]).then(([missingResult, checkResult]) => {
      if (missingResult.status === "fulfilled") {
        setMissingRows(Array.isArray(missingResult.value.components) ? missingResult.value.components : [])
        setMissingSourcePath(missingResult.value.source_relative_path ?? "")
      } else {
        setMissingRows([])
        setMissingSourcePath(missingResult.reason instanceof Error ? missingResult.reason.message : "缺项 JSON 加载失败")
      }

      if (checkResult.status === "fulfilled") {
        setResultRows(Array.isArray(checkResult.value.rows) ? checkResult.value.rows : [])
        setResultSourcePath(checkResult.value.source_relative_path ?? "")
        setFinalRows([])
        setFinalGenerated(false)
      } else {
        setResultRows([])
        setResultSourcePath(checkResult.reason instanceof Error ? checkResult.reason.message : "校验结果 JSON 加载失败")
      }
    }).catch(error => {
      console.error(error)
    })

    Promise.allSettled(COMPLIANCE_TABS.map(tab =>
      fetch(buildWorkspaceApiPath(`/workspace/compliance/artifact/${tab.artifact}`, query), { cache: "no-store" }).then(async response => {
        const data = await response.json().catch(() => null) as CompliancePayload | { error?: string } | null
        if (!response.ok) throw new Error(data && "error" in data && data.error ? data.error : `${tab.title} JSON 不可用`)
        return { tab, payload: data as CompliancePayload }
      })
    )).then(results => {
      const nextRows: Record<string, JsonRow[]> = {}
      const nextSources: Record<string, string> = {}
      results.forEach(result => {
        if (result.status === "fulfilled") {
          const rows = Array.isArray(result.value.payload.rows) ? result.value.payload.rows.map(normalizeComplianceRow) : []
          nextRows[result.value.tab.key] = rows
          nextSources[result.value.tab.key] = result.value.payload.source_relative_path ?? ""
        } else {
          const message = result.reason instanceof Error ? result.reason.message : "加载失败"
          COMPLIANCE_TABS.forEach(tab => {
            if (!(tab.key in nextSources)) nextSources[tab.key] = message
          })
        }
      })
      setComplianceRows(nextRows)
      setComplianceSources(nextSources)
    })

    fetch(buildWorkspaceApiPath("/workspace/compliance/manufacturer-full-names", query), { cache: "no-store" })
      .then(async response => {
        const data = await response.json().catch(() => null) as JsonRow | null
        if (!response.ok) throw new Error(data && "error" in data && data.error ? asText(data.error) : "厂商全称列表不可用")
        return fullNamesFromPayload(data)
      })
      .then(setManufacturerFullNames)
      .catch(error => console.error(error))
  }, [query])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  useEffect(() => {
    let cancelled = false
    let controller: AbortController | null = null

    const loadProgress = () => {
      controller?.abort()
      controller = new AbortController()
      fetch(buildWorkspaceApiPath("/workspace/progress", query), {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(response => response.ok ? response.json() as Promise<WorkspaceProgressResponse> : null)
        .then(data => {
          if (!cancelled) setProgressData(data)
        })
        .catch(error => {
          if (error instanceof DOMException && error.name === "AbortError") return
          if (!cancelled) setProgressData(null)
        })
    }

    loadProgress()
    const intervalId = window.setInterval(loadProgress, 3000)
    return () => {
      cancelled = true
      controller?.abort()
      window.clearInterval(intervalId)
    }
  }, [query])

  const missingSummary = useMemo(() => {
    const listRows = complianceRows.classification ?? []
    const listKeys = new Set(listRows.flatMap(row => modelSpecKeys(row)))
    const deratingKeys = new Set(resultRows.flatMap(row => modelSpecKeys(row)))
    const missingKeys = new Set(missingRows.filter(row => Number(row.missing_count ?? 0) > 0).flatMap(row => modelSpecKeys(row)))
    const unmatchedKeys = new Set(missingRows.filter(row => !asText(row["元器件大类"]) || !asText(row["元器件子类"])).flatMap(row => modelSpecKeys(row)))
    const incompleteKeys = new Set([...missingKeys, ...unmatchedKeys])
    const completenessKeys = new Set(missingRows.flatMap(row => modelSpecKeys(row)))
    const coveredCount = [...listKeys].filter(key => deratingKeys.has(key)).length
    const listCount = listKeys.size || completenessKeys.size
    return {
      completeCount: Math.max(0, completenessKeys.size - incompleteKeys.size),
      coveredCount,
      completenessCount: completenessKeys.size,
      listCount,
      missingCount: missingKeys.size,
      uncoveredCount: Math.max(0, listCount - coveredCount),
      unmatchedCount: unmatchedKeys.size,
    }
  }, [complianceRows, missingRows, resultRows])

  const workflowProgressEntries = useMemo(
    () => getWorkflowLoopProgressEntries(progressData?.data, t, "check"),
    [progressData?.data, t],
  )
  const workflowProgressSummary = useMemo(
    () => getWorkflowProgressSummary(progressData?.data, workflowProgressEntries, t),
    [progressData?.data, t, workflowProgressEntries],
  )
  const dashboardProgress = useMemo(
    () => progressFromSummary(workflowProgressSummary),
    [workflowProgressSummary],
  )
  const dashboardSummary = useMemo(
    () => buildDashboardSummary(missingRows, resultRows, complianceRows, finalRows, finalGenerated, dashboardProgress),
    [complianceRows, dashboardProgress, finalGenerated, finalRows, missingRows, resultRows],
  )

  const navIssueCounts = useMemo(() => {
    const counts: Partial<Record<ActiveTabKey, number>> = {
      dashboard: dashboardSummary.issue,
      "compliance-check": dashboardSummary.missingCount + problemCount(resultRows),
    }
    COMPLIANCE_TABS.forEach(tab => {
      const rows = complianceRows[tab.key] ?? []
      counts[tab.key] = tab.key === "reliability" ? reliabilityIssueCount(rows) : complianceStatusCounts(rows).issue
    })
    return counts
  }, [complianceRows, dashboardSummary.issue, dashboardSummary.missingCount, resultRows])

  const updateResultCell = (rowIndex: number, key: string, value: string) => {
    setResultRows(previous => previous.map((row, index) => index === rowIndex ? writeResultValue(row, key, value) : row))
    setFinalGenerated(false)
  }

  const updateComplianceCell = (tabKey: string, rowIndex: number, key: string, value: string) => {
    setComplianceRows(previous => ({
      ...previous,
      [tabKey]: (previous[tabKey] ?? []).map((row, index) => {
        if (index !== rowIndex) return row
        if (tabKey !== "manufacturer") return { ...row, [key]: value }
        return updateManufacturerConfirmationRow(row, key, value)
      }),
    }))
  }

  const updateComplianceRow = (tabKey: string, rowIndex: number, nextRow: JsonRow) => {
    setComplianceRows(previous => ({
      ...previous,
      [tabKey]: (previous[tabKey] ?? []).map((row, index) => index === rowIndex ? nextRow : row),
    }))
  }

  const confirmAndGenerateFinal = () => {
    setSavingResults(true)
    fetch(buildWorkspaceApiPath("/workspace/derating/check-result", query), {
      body: JSON.stringify({ rows: resultRows }),
      headers: { "Content-Type": "application/json" },
      method: "PUT",
    })
      .then(async response => {
        const data = await response.json().catch(() => null) as ComplianceCheckPayload | { error?: string } | null
        if (!response.ok) throw new Error(data && "error" in data && data.error ? data.error : "保存失败")
        const payload = data as ComplianceCheckPayload
        const savedRows = Array.isArray(payload.rows) ? payload.rows : resultRows
        setResultRows(savedRows)
        setFinalRows(buildFinalRows(savedRows, missingRows))
        setFinalGenerated(true)
      })
      .catch(error => console.error(error))
      .finally(() => setSavingResults(false))
  }

  const saveComplianceTab = (tab: ComplianceTab) => {
    setSavingCompliance(tab.key)
    fetch(buildWorkspaceApiPath(`/workspace/compliance/artifact/${tab.artifact}`, query), {
      body: JSON.stringify({ rows: complianceRows[tab.key] ?? [] }),
      headers: { "Content-Type": "application/json" },
      method: "PUT",
    })
      .then(async response => {
        const data = await response.json().catch(() => null) as CompliancePayload | { error?: string } | null
        if (!response.ok) throw new Error(data && "error" in data && data.error ? data.error : "保存失败")
        const payload = data as CompliancePayload
        setComplianceRows(previous => ({
          ...previous,
          [tab.key]: Array.isArray(payload.rows) ? payload.rows.map(normalizeComplianceRow) : previous[tab.key] ?? [],
        }))
        setComplianceSources(previous => ({
          ...previous,
          [tab.key]: payload.source_relative_path ?? previous[tab.key] ?? "",
        }))
      })
      .catch(error => console.error(error))
      .finally(() => setSavingCompliance(""))
  }

  const addManufacturerFullName = () => {
    const fullName = window.prompt("新增目录内厂商全称")?.trim()
    if (!fullName) return
    fetch(buildWorkspaceApiPath("/workspace/compliance/manufacturer-full-names", query), {
      body: JSON.stringify({ full_name: fullName }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
      .then(async response => {
        const data = await response.json().catch(() => null) as JsonRow | null
        if (!response.ok) throw new Error(data && "error" in data && data.error ? asText(data.error) : "新增失败")
        const nextFullNames = fullNamesFromPayload(data)
        setManufacturerFullNames(nextFullNames.length ? nextFullNames : previousUnique([...manufacturerFullNames, fullName]))
      })
      .catch(error => console.error(error))
  }

  const downloadMissingCsv = () => {
    const header = [...MISSING_COLUMNS.map(column => column.label), "缺项数"]
    const csvRows = missingRows.map(row => [
      ...MISSING_COLUMNS.map(column => csvEscape(row[column.key])),
      csvEscape(row.missing_count ?? 0),
    ].join(","))
    downloadCsv("derating-missing-items.csv", [header.join(","), ...csvRows].join("\n"))
  }

  const downloadResultCsv = () => {
    const header = RESULT_CSV_COLUMNS.map(([, label]) => label)
    const csvRows = resultRows.map(row => RESULT_CSV_COLUMNS.map(([key]) => {
      if (key === "缺少降额项") {
        const component = missingRows.find(item => asText(item["元器件名称"]) === asText(row["元器件名称"]))
        return csvEscape(component?.missing_standard_parameters ?? "")
      }
      if (key === "综合判定") return csvEscape(statusText(row))
      if (key === "备注") return csvEscape(issueText(row))
      return csvEscape(row[key])
    }).join(","))
    downloadCsv("derating-check-result.csv", [header.join(","), ...csvRows].join("\n"))
  }

  const downloadFinalCsv = () => {
    const header = RESULT_CSV_COLUMNS.map(([, label]) => label)
    const csvRows = finalRows.map(row => RESULT_CSV_COLUMNS.map(([, label]) => csvEscape(row[label])).join(","))
    downloadCsv("derating-final-summary.csv", [header.join(","), ...csvRows].join("\n"))
  }

  const activeComplianceTab = COMPLIANCE_TABS.find(tab => tab.key === activeTab)
  const navItems = [
    { key: "dashboard" as const, label: "报告看板", meta: "总览" },
    { key: "compliance-check" as const, label: "降额检查", meta: "Compliance Check" },
    ...COMPLIANCE_TABS.map(tab => ({ key: tab.key, label: tab.title, meta: tab.artifact })),
  ]
  const renderComplianceTab = (tab: ComplianceTab) => {
    const rows = complianceRows[tab.key] ?? []
    const counts = complianceStatusCounts(rows)
    return (
      <section style={sectionStyle}>
        <details open>
          <summary style={summaryStyle}>{tab.title}（可编辑确认）</summary>
          <div style={sectionBodyStyle}>
            <div style={metricsStyle}>
              <span>共 <b>{rows.length}</b> 行 · <b style={greenText}>{counts.ok} 正常</b> · <b style={redText}>{counts.issue} 待确认</b></span>
              <span style={mutedTextStyle}>{tab.description}</span>
            </div>
            {tab.key === "catalog" ? (
              <CatalogMatchView
                emptyText={complianceSources[tab.key] || tab.emptyText}
                onRowChange={(rowIndex, nextRow) => updateComplianceRow(tab.key, rowIndex, nextRow)}
                rows={rows}
              />
            ) : tab.key === "reliability" ? (
              <ReliabilityQueryView
                emptyText={complianceSources[tab.key] || tab.emptyText}
                rows={rows}
              />
            ) : (
              <EditableTable
                columns={tab.columns}
                emptyText={complianceSources[tab.key] || tab.emptyText}
                getValue={getComplianceValue}
                onChange={(rowIndex, key, value) => updateComplianceCell(tab.key, rowIndex, key, value)}
                rows={rows}
                selectColumns={{
                  "厂商全称": ["无", ...manufacturerFullNames],
                  "国产/进口": ["国产", "进口", "无"],
                  "目录内或外": ["目录内", "目录外", "无"],
                  "是否满足要求": ["满足", "需关注", "不满足", "无法确认"],
                  "质量等级": ["CAST A", "CAST B", "CAST C", "GJB", "军品级", "工业级", "民品级", "商业级", "未填写"],
                  "最低要求": ["CAST A", "CAST B", "CAST C", "GJB", "军品级", "工业级"],
                  is_key_part: ["true", "false"],
                  is_in_catalog: ["目录内", "目录外", "未提供目录", "无"],
                  status: ["符合", "不符合", "需确认"],
                }}
                stickyRightColumns={tab.key === "manufacturer" ? ["目录内或外"] : []}
              />
            )}
            <div style={actionsStyle}>
              {tab.key === "manufacturer" ? <button type="button" onClick={addManufacturerFullName} style={toolbarButtonStyle}>新增目录内厂商全称</button> : null}
              <button type="button" onClick={() => downloadCsv(`${tab.artifact}.csv`, tableToCsv(tab.columns, rows, getComplianceValue))} disabled={rows.length === 0} style={toolbarButtonStyle}>下载 CSV</button>
              <button type="button" onClick={() => saveComplianceTab(tab)} disabled={rows.length === 0 || savingCompliance === tab.key} style={primaryButtonStyle}>{savingCompliance === tab.key ? "保存中" : "保存修改"}</button>
            </div>
          </div>
        </details>
      </section>
    )
  }

  return (
    <div style={{ ...pageStyle, ...themeVars }}>
      <div style={viewerShellStyle}>
        <aside style={sideNavStyle}>
          {navItems.map(item => (
            <button key={item.key} type="button" onClick={() => setActiveTab(item.key)} style={sideNavButtonStyle(activeTab === item.key)}>
              <span style={sideNavIconStyle}>{navIcon(item.key)}</span>
              <span style={sideNavTextStyle}>{item.label}</span>
              <span style={sideNavBadgeStyle(navIssueCounts[item.key] ?? 0)}>{navIssueCounts[item.key] ?? 0}</span>
            </button>
          ))}
        </aside>

        <main style={viewerContentStyle}>
          {activeTab === "dashboard" ? (
          <ComplianceCheckReportDashboard
            onConfirm={confirmAndGenerateFinal}
            onDownload={downloadFinalCsv}
            progress={dashboardProgress}
            saving={savingResults}
            selectedFilter={dashboardFilter}
            setActiveTab={setActiveTab}
            summary={dashboardSummary}
            theme={props.theme === "light" ? "light" : "dark"}
            versionId={props.versionId}
            workspaceDir={props.workspaceDir}
            workspaceId={props.workspaceId}
          />
          ) : activeTab === "compliance-check" ? (
        <>
          <section style={sectionStyle}>
        <details open>
          <summary style={summaryStyle}>步骤1：降额缺项分析（各器件降额项完整性检查）</summary>
          <div style={sectionBodyStyle}>
            <div style={metricsStyle}>
              <span>元器件清单覆盖性：清单中 <b>{missingSummary.listCount}</b> 个型号规格，<b style={greenText}>{missingSummary.coveredCount}</b> 个已在降额表中覆盖，<b style={redText}>{missingSummary.uncoveredCount}</b> 个未覆盖</span>
              <span>降额缺项完整性：共检查 <b>{missingSummary.completenessCount}</b> 个型号规格，<b style={redText}>{missingSummary.missingCount}</b> 个型号规格存在缺项，<b style={redText}>{missingSummary.unmatchedCount}</b> 个型号规格未找到分类，<b style={greenText}>{missingSummary.completeCount}</b> 个型号规格完整</span>
            </div>
            <EditableTable
              columns={MISSING_COLUMNS}
              emptyText={missingSourcePath || "暂无缺项数据"}
              getValue={(row, key) => row[key]}
              readOnly
              rows={missingRows}
            />
            <div style={actionsStyle}>
              <button type="button" onClick={downloadMissingCsv} disabled={missingRows.length === 0} style={toolbarButtonStyle}>下载缺项分析 CSV</button>
            </div>
          </div>
        </details>
      </section>

      <section style={sectionStyle}>
        <details open>
          <summary style={summaryStyle}>步骤2：AI 判定结果（可编辑确认）</summary>
          <div style={sectionBodyStyle}>
            <div style={metricsStyle}>
              <span>共 <b>{resultRows.length}</b> 行 · <b style={greenText}>✔ {passCount(resultRows)} 通过</b> · <b style={redText}>✕ {problemCount(resultRows)} 问题</b>{stricterCount(resultRows) > 0 ? <b> · 其中 {stricterCount(resultRows)} 行更严格</b> : null}</span>
              <span style={hintTextStyle}>可直接点击单元格编辑判定内容</span>
            </div>
            <EditableTable
              columns={RESULT_COLUMNS}
              emptyText={resultSourcePath || "暂无校验结果数据"}
              getValue={getResultValue}
              onChange={updateResultCell}
              rows={resultRows}
              selectColumns={{ 判定结果: ["符合", "不符合", "需人工确认", "更严格"] }}
              stickyRightColumns={["判定结果", "综合判定详情"]}
            />
            <div style={actionsStyle}>
              <button type="button" onClick={downloadResultCsv} disabled={resultRows.length === 0} style={toolbarButtonStyle}>下载校验结果 CSV</button>
              <button type="button" onClick={confirmAndGenerateFinal} disabled={resultRows.length === 0 || savingResults} style={primaryButtonStyle}>{savingResults ? "生成中" : "确认并生成降额总表"}</button>
            </div>
          </div>
        </details>
      </section>

      <section style={sectionStyle}>
        <details open={finalGenerated}>
          <summary style={summaryStyle}>步骤3：降额总表（原始数据 + AI 分析 + 确认结果）</summary>
          <div style={sectionBodyStyle}>
            <div style={metricsStyle}>
              <span>根据步骤2当前确认结果生成：共 <b>{finalRows.length}</b> 行 · <b style={greenText}>{passCount(finalRows)} 通过</b> · <b style={redText}>{problemCount(finalRows)} 问题</b>{stricterCount(finalRows) > 0 ? <b> · 其中 {stricterCount(finalRows)} 行更严格</b> : null}</span>
              <span style={mutedTextStyle}>{finalGenerated ? "已生成降额总表，可下载 CSV。" : "点击步骤2“确认并生成降额总表”后生成。"}</span>
            </div>
            <EditableTable
              columns={RESULT_CSV_COLUMNS.map(([, label]) => ({ key: label, label, width: label.length > 7 ? 150 : 110 }))}
              emptyText="尚未生成降额总表"
              getValue={(row, key) => row[key]}
              readOnly
              rows={finalRows}
            />
            <div style={actionsStyle}>
              <button type="button" onClick={downloadFinalCsv} disabled={finalRows.length === 0} style={toolbarButtonStyle}>下载降额总表 CSV</button>
            </div>
          </div>
        </details>
      </section>
        </>
          ) : activeComplianceTab ? renderComplianceTab(activeComplianceTab) : null}
        </main>
      </div>
    </div>
  )
}

function ComplianceCheckReportDashboard({
  onConfirm,
  onDownload,
  progress,
  saving,
  selectedFilter,
  setActiveTab,
  summary,
  theme,
  versionId,
  workspaceDir,
  workspaceId,
}: {
  onConfirm: () => void
  onDownload: () => void
  progress: DashboardProgress
  saving: boolean
  selectedFilter: string
  setActiveTab: (tab: ActiveTabKey) => void
  summary: ReturnType<typeof buildDashboardSummary>
  theme: "dark" | "light"
  versionId: string
  workspaceDir: string
  workspaceId: string
}) {
  const [priorityFilter, setPriorityFilter] = useState("全部")
  const [statusFilter, setStatusFilter] = useState("全部")
  const [manufacturerFilter, setManufacturerFilter] = useState("")
  const moduleFilteredRiskRows = selectedFilter === "全部"
    ? summary.riskRows
    : summary.riskRows.filter(row => row.module.includes(selectedFilter) || selectedFilter.includes(row.module))
  const statusOptions = Array.from(new Set(moduleFilteredRiskRows.map(row => row.status).filter(Boolean)))
  const filteredRiskRows = moduleFilteredRiskRows.filter(row => {
    if (priorityFilter !== "全部" && row.priority !== priorityFilter) return false
    if (statusFilter !== "全部" && row.status !== statusFilter) return false
    if (manufacturerFilter.trim() && !row.manufacturer.toLowerCase().includes(manufacturerFilter.trim().toLowerCase())) return false
    return true
  })
  const selectedDistribution = summary.distribution.find(item => item.key === selectedFilter)
  const filteredRecommendations = selectedFilter === "全部"
    ? summary.recommendations
    : [
        {
          text: `当前聚焦 ${selectedFilter}，共 ${selectedDistribution?.value ?? filteredRiskRows.length} 项待处理，请优先关闭表格中的高优先级记录。`,
          tone: (filteredRiskRows.some(row => row.priority === "高") ? "bad" : "warn") as DashboardRecommendation["tone"],
        },
        ...summary.recommendations,
      ].slice(0, 4)
  const canFinalize = summary.issue === 0 && summary.completedModules === summary.moduleCount

  return (
    <section style={dashboardStyle}>
      <div style={dashboardHeaderStyle}>
        <div style={dashboardTitleGroupStyle}>
          <strong style={dashboardTitleStyle}>合规报告总览</strong>
          <span style={dashboardSubtitleStyle}>任务进度 {progress.percentage}% · {progress.statusLabel}</span>
        </div>
        <div style={dashboardActionGroupStyle}>
          <button type="button" onClick={onDownload} disabled={summary.totalRows === 0} style={toolbarButtonStyle}>导出总表</button>
          <button
            title={canFinalize ? "确认生成总表" : `仍有 ${summary.issue} 项待确认，建议处理后再生成`}
            type="button"
            onClick={onConfirm}
            disabled={summary.totalRows === 0 || saving}
            style={canFinalize ? primaryButtonStyle : secondaryPrimaryButtonStyle}
          >
            {saving ? "生成中" : "确认生成总表"}
          </button>
        </div>
      </div>

      <div style={dashboardKpiGridStyle}>
        <KpiTile
          detail={summary.moduleInsights.classification.classShare.slice(0, 3).map(item => `${item.label} ${item.value}%`).join(" · ") || "暂无分类数据"}
          label="AI器件分类"
          palette="orange"
          value={`${summary.moduleInsights.classification.total}项`}
        />
        <KpiTile
          detail={`缺少${summary.moduleInsights.complianceCheck.missingItemCount}降额项 · 降额检查通过率${summary.moduleInsights.complianceCheck.aiPassRate}%`}
          label="AI降额检查"
          palette="violet"
          value={`${summary.moduleInsights.complianceCheck.aiPassRate}%`}
        />
        <KpiTile
          detail={`国产比例 ${summary.moduleInsights.manufacturer.originShare.find(item => item.label === "国产")?.value ?? 0}% · 目录内比例 ${summary.moduleInsights.manufacturer.catalogInRate}%`}
          label="AI厂商匹配"
          palette="teal"
          value={`${summary.moduleInsights.manufacturer.catalogInRate}%`}
        />
        <KpiTile label="关键器件" palette="pink" value={`${summary.moduleInsights.keyUnits.keyCount}/${summary.moduleInsights.keyUnits.total}`} />
        <KpiTile
          detail={`平均分 ${summary.moduleInsights.catalog.averageScore}分`}
          label="AI目录匹配"
          palette="blue"
          value={`${summary.moduleInsights.catalog.matchedCount}个`}
        />
        <KpiTile
          detail={`进口工业级基线 ${summary.moduleInsights.qualityLevel.importIndustrialCount} 项 · 正常 ${summary.moduleInsights.qualityLevel.okCount} 项`}
          label="质量等级"
          palette="orange"
          value={`${summary.moduleInsights.qualityLevel.issueCount}项`}
        />
        <KpiTile
          detail={`确认质量 ${summary.moduleInsights.reliability.qualityHits} 条 · 确认辐照 ${summary.moduleInsights.reliability.radiationHits} 条`}
          label="质量/辐照查询"
          palette="red"
          value={`${summary.moduleInsights.reliability.hitCount}项`}
        />
      </div>

      <div style={dashboardFlowPanelStyle}>
        <div style={dashboardPanelHeaderStyle}>
          <strong>执行流程</strong>
        </div>
        <ExecutionFlow
          className="execution-flow-embedded"
          height={360}
          showThemeSwitch={false}
          theme={theme}
          versionId={versionId}
          workspaceDir={workspaceDir}
          workspaceId={workspaceId}
        />
      </div>

      <div style={dashboardAnalyticsGridStyle}>
        <ModuleInsightCard title="AI器件分类" variant="large">
          <div style={moduleChartSplitStyle}>
            <PercentDonut items={summary.moduleInsights.classification.classShare} centerLabel="大类" />
            <div>
              <div style={moduleSubTitleStyle}>类别占比</div>
              <SmallBarChart items={summary.moduleInsights.classification.categoryShare} compact />
            </div>
          </div>
        </ModuleInsightCard>

        <ModuleInsightCard title="厂商匹配">
          <PercentDonut items={summary.moduleInsights.manufacturer.originShare} centerLabel="来源" />
          <div style={moduleMetricPairStyle}>
            <DashboardSignal label="目录内占比" value={`${summary.moduleInsights.manufacturer.catalogInRate}%`} tone={summary.moduleInsights.manufacturer.catalogInRate >= 90 ? "ok" : "warn"} />
            <DashboardSignal label="未匹配数量" value={`${summary.moduleInsights.manufacturer.unmatchedCount}`} tone={summary.moduleInsights.manufacturer.unmatchedCount > 0 ? "bad" : "ok"} />
          </div>
        </ModuleInsightCard>

        <ModuleInsightCard title="目录匹配">
          <DashboardSignal label="AI平均分" value={`${summary.moduleInsights.catalog.averageScore}`} tone={summary.moduleInsights.catalog.averageScore >= 80 ? "ok" : summary.moduleInsights.catalog.averageScore >= 60 ? "warn" : "bad"} />
          <SmallBarChart items={summary.moduleInsights.catalog.groupShare} />
        </ModuleInsightCard>
      </div>

      <div style={dashboardStatusGridStyle}>
        <ModuleInsightCard title="降额检查">
          <div style={moduleMetricPairStyle}>
            <DashboardSignal label="缺少降额项" value={`${summary.moduleInsights.complianceCheck.missingItemCount}`} tone={summary.moduleInsights.complianceCheck.missingItemCount > 0 ? "bad" : "ok"} />
            <DashboardSignal label="AI降额检查" value={`${summary.moduleInsights.complianceCheck.aiPassRate}%`} tone={summary.moduleInsights.complianceCheck.aiPassRate >= 90 ? "ok" : summary.moduleInsights.complianceCheck.aiPassRate >= 70 ? "warn" : "bad"} />
          </div>
          <MiniGauge value={summary.moduleInsights.complianceCheck.aiPassRate} tone={summary.moduleInsights.complianceCheck.aiPassRate >= 90 ? "ok" : summary.moduleInsights.complianceCheck.aiPassRate >= 70 ? "warn" : "bad"} />
        </ModuleInsightCard>

        <ModuleInsightCard title="关键器件">
          <div style={moduleMetricPairStyle}>
            <DashboardSignal label="关键器件" value={`${summary.moduleInsights.keyUnits.keyCount}/${summary.moduleInsights.keyUnits.total}`} tone={summary.moduleInsights.keyUnits.keyCount > 0 ? "warn" : "ok"} />
            <DashboardSignal label="关键占比" value={`${summary.moduleInsights.keyUnits.keyShare}%`} tone={summary.moduleInsights.keyUnits.keyShare > 20 ? "warn" : "neutral"} />
          </div>
          <div style={moduleListStyle}>
            {(summary.moduleInsights.keyUnits.samples.length ? summary.moduleInsights.keyUnits.samples : ["暂无关键器件"]).map(item => <span key={item}>{item}</span>)}
          </div>
        </ModuleInsightCard>

        <ModuleInsightCard title="质量等级">
          <div style={moduleMetricPairStyle}>
            <DashboardSignal label="等级问题" value={`${summary.moduleInsights.qualityLevel.issueCount}`} tone={summary.moduleInsights.qualityLevel.issueCount > 0 ? "bad" : "ok"} />
            <DashboardSignal label="通过器件" value={`${summary.moduleInsights.qualityLevel.okCount}/${summary.moduleInsights.qualityLevel.total}`} tone={summary.moduleInsights.qualityLevel.issueCount > 0 ? "warn" : "ok"} />
          </div>
          <DashboardSignal label="进口工业级基线" value={`${summary.moduleInsights.qualityLevel.importIndustrialCount}`} tone="neutral" />
        </ModuleInsightCard>

        <ModuleInsightCard title="质量/辐照查询">
          <div style={moduleMetricPairStyle}>
            <DashboardSignal label="确认质量问题" value={`${summary.moduleInsights.reliability.qualityHits}`} tone={summary.moduleInsights.reliability.qualityHits > 0 ? "bad" : "ok"} />
            <DashboardSignal label="确认辐照信息" value={`${summary.moduleInsights.reliability.radiationHits}`} tone={summary.moduleInsights.reliability.radiationHits > 0 ? "bad" : "ok"} />
          </div>
          <DashboardSignal label="无命中器件" value={`${summary.moduleInsights.reliability.cleanCount}/${summary.moduleInsights.reliability.total}`} tone={summary.moduleInsights.reliability.hitCount > 0 ? "warn" : "ok"} />
        </ModuleInsightCard>
      </div>

      <div style={dashboardLowerGridStyle}>
        <div style={dashboardPanelStyle}>
          <div style={dashboardPanelHeaderStyle}>
            <strong>重点待处理事项</strong>
            <span style={mutedTextStyle}>{selectedFilter === "全部" ? "优先处理前" : selectedFilter} {filteredRiskRows.length} 项</span>
          </div>
          <div style={dashboardRiskToolbarStyle}>
            {["全部", "高", "中", "低"].map(priority => (
              <button
                key={priority}
                type="button"
                onClick={() => setPriorityFilter(priority)}
                style={dashboardFilterButtonStyle(priorityFilter === priority, priority === "全部" ? moduleFilteredRiskRows.length > 0 : moduleFilteredRiskRows.filter(row => row.priority === priority).length > 0)}
              >
                {priority === "全部" ? "全部优先级" : `${priority}优先级`}
              </button>
            ))}
            <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} style={dashboardFilterSelectStyle}>
              <option value="全部" style={optionStyle}>全部状态</option>
              {statusOptions.map(status => <option key={status} value={status} style={optionStyle}>{status}</option>)}
            </select>
            <input
              value={manufacturerFilter}
              onChange={event => setManufacturerFilter(event.target.value)}
              placeholder="筛选厂商"
              style={dashboardFilterInputStyle}
            />
          </div>
          <div style={dashboardRiskTableWrapStyle}>
            <table style={dashboardRiskTableStyle}>
              <thead>
                <tr>
                  {["优先级", "模块", "器件名称", "型号规格", "生产厂商", "问题原因", "当前状态", "操作"].map(label => (
                    <th key={label} style={dashboardRiskHeaderStyle}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRiskRows.map((row, index) => (
                  <tr key={`${row.component}-${row.model}-${index}`}>
                    <td style={{ ...dashboardRiskCellStyle, color: priorityToneColor(row.priority), fontWeight: 900 }}>{row.priority}</td>
                    <td style={dashboardRiskCellStyle}>{row.module}</td>
                    <td style={dashboardRiskCellStyle}>{row.component}</td>
                    <td style={dashboardRiskCellStyle}>{row.model}</td>
                    <td style={dashboardRiskCellStyle}>{row.manufacturer}</td>
                    <td style={dashboardRiskCellStyle}>{row.issue}</td>
                    <td style={{ ...dashboardRiskCellStyle, color: metricToneColor(statusTone(row.status)), fontWeight: 800 }}>{row.status}</td>
                    <td style={dashboardRiskCellStyle}>
                      <button type="button" onClick={() => setActiveTab(tabForDashboardModule(row.module))} style={dashboardInlineActionStyle}>{row.action}</button>
                    </td>
                  </tr>
                ))}
                {filteredRiskRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={emptyCellStyle}>暂无待处理事项</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div style={dashboardPanelStyle}>
          <div style={dashboardPanelHeaderStyle}>
            <strong>处理建议</strong>
            <span style={mutedTextStyle}>自动汇总</span>
          </div>
          <div style={dashboardAdviceListStyle}>
            {filteredRecommendations.map((item, index) => (
              <div key={`${item.text}-${index}`} style={dashboardAdviceItemStyle}>
                <span style={{ ...dashboardAdviceMarkStyle, background: metricToneColor(item.tone) }} />
                <span>{item.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function DashboardSignal({ label, tone, value }: { label: string; tone: DashboardMetric["tone"]; value: string }) {
  return (
    <div style={dashboardSignalStyle}>
      <span style={dashboardSignalLabelStyle}>{label}</span>
      <b style={{ ...dashboardSignalValueStyle, color: metricToneColor(tone) }}>{value}</b>
    </div>
  )
}

type KpiPalette = "orange" | "violet" | "teal" | "pink" | "blue" | "red"

const KPI_ORANGE = "#ff5a1f"
const KPI_ORANGE_2 = "#ff8a3d"
const KPI_VIOLET = "#7c5cff"
const KPI_VIOLET_2 = "#a78bfa"
const KPI_TEAL = "#10b981"
const KPI_TEAL_2 = "#34d399"
const KPI_PINK = "#ec4899"
const KPI_PINK_2 = "#fb7185"
const KPI_BLUE = "#0ea5e9"
const KPI_BLUE_2 = "#38bdf8"
const KPI_RED = "#ef4444"
const KPI_RED_2 = "#f97316"

function KpiTile({ detail, label, palette, value }: { detail?: string; label: string; palette: KpiPalette; value: string }) {
  return (
    <div style={kpiTileStyle(palette)}>
      <span style={kpiLabelStyle}>{label}</span>
      <strong style={kpiValueStyle}>{value}</strong>
      {detail ? <span style={kpiDetailStyle}>{detail}</span> : null}
    </div>
  )
}

function ModuleInsightCard({ children, title, variant = "default" }: { children: React.ReactNode; title: string; variant?: "default" | "large" }) {
  return (
    <div style={moduleInsightCardStyle(variant)}>
      <div style={dashboardPanelHeaderStyle}>
        <strong>{title}</strong>
      </div>
      <div style={moduleInsightBodyStyle}>{children}</div>
    </div>
  )
}

function SmallBarChart({ compact = false, items }: { compact?: boolean; items: PercentItem[] }) {
  if (items.length === 0) return <div style={moduleEmptyStyle}>暂无数据</div>
  return (
    <div style={compact ? smallBarCompactListStyle : smallBarListStyle}>
      {items.map(item => (
        <div key={item.label} style={smallBarItemStyle}>
          <div style={smallBarLabelRowStyle}>
            <span>{item.label}</span>
            <b>{item.value}%</b>
          </div>
          <div style={smallBarTrackStyle}>
            <span style={{ ...smallBarFillStyle, background: item.color, width: `${Math.max(0, Math.min(100, item.value))}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function PercentDonut({ centerLabel, items }: { centerLabel: string; items: PercentItem[] }) {
  const radius = 34
  const circumference = 2 * Math.PI * radius
  let offset = 0
  const normalizedItems = items.filter(item => item.value > 0)

  if (normalizedItems.length === 0) return <div style={moduleEmptyStyle}>暂无数据</div>

  return (
    <div style={percentDonutWrapStyle}>
      <svg aria-hidden="true" height="104" viewBox="0 0 104 104" width="104">
        <circle cx="52" cy="52" fill="none" r={radius} stroke={HUD_LINE} strokeWidth="12" />
        {normalizedItems.map(item => {
          const length = (item.value / 100) * circumference
          const dashOffset = -offset
          offset += length
          return (
            <circle
              key={item.label}
              cx="52"
              cy="52"
              fill="none"
              r={radius}
              stroke={item.color}
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              strokeWidth="12"
              transform="rotate(-90 52 52)"
            />
          )
        })}
        <text fill={HUD_TEXT} fontSize="14" fontWeight="900" textAnchor="middle" x="52" y="50">{normalizedItems[0]?.value ?? 0}%</text>
        <text fill={HUD_MUTED} fontSize="9" fontWeight="800" textAnchor="middle" x="52" y="64">{centerLabel}</text>
      </svg>
      <div style={percentDonutLegendStyle}>
        {normalizedItems.map(item => (
          <div key={item.label} style={percentDonutLegendItemStyle}>
            <span style={{ ...dashboardLegendDotStyle, background: item.color }} />
            <span>{item.label}</span>
            <b>{item.value}%</b>
          </div>
        ))}
      </div>
    </div>
  )
}

function MiniGauge({ tone, value }: { tone: DashboardMetric["tone"]; value: number }) {
  return (
    <div style={miniGaugeTrackStyle}>
      <span style={{ ...miniGaugeFillStyle, background: metricToneColor(tone), width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  )
}

function navIcon(key: ActiveTabKey) {
  if (key === "dashboard") return "□"
  if (key === "compliance-check") return "✓"
  if (key === "classification") return "◇"
  if (key === "manufacturer") return "↔"
  if (key === "key-units") return "◆"
  if (key === "quality-level") return "Q"
  return "◎"
}

function metricToneColor(tone: "neutral" | "ok" | "warn" | "bad") {
  if (tone === "ok") return HUD_GREEN
  if (tone === "bad") return HUD_RED
  if (tone === "warn") return HUD_WARN
  return HUD_CYAN
}

function priorityToneColor(priority: DashboardRiskRow["priority"]) {
  if (priority === "高") return HUD_RED
  if (priority === "中") return HUD_WARN
  return HUD_CYAN
}

function optionToneColor(key: string, value: string) {
  const text = value.trim()
  if (key === "国产/进口") {
    if (text === "国产") return KPI_TEAL
    if (text === "进口") return KPI_ORANGE
    return HUD_MUTED
  }
  if (key === "目录内或外" || key === "is_in_catalog") {
    if (text === "目录内") return KPI_TEAL
    if (text === "目录外") return KPI_PINK
    if (text === "未提供目录") return KPI_ORANGE
    return HUD_MUTED
  }
  if (isPositiveJudgement(text)) return KPI_TEAL
  if (isNegativeJudgement(text)) return KPI_PINK
  return HUD_TEXT
}

function tabForDashboardModule(module: string): ActiveTabKey {
  if (module.includes("质量等级")) return "quality-level"
  if (module.includes("厂商")) return "manufacturer"
  if (module.includes("关键")) return "key-units"
  if (module.includes("目录")) return "catalog"
  if (module.includes("分类")) return "classification"
  if (module.includes("质量") || module.includes("辐照") || module.includes("辐射")) return "reliability"
  return "compliance-check"
}

function tableToCsv(
  columns: readonly { key: string; label: string; width: number }[],
  rows: JsonRow[],
  getValue: (row: JsonRow, key: string) => unknown = (row, key) => row[key],
) {
  const header = columns.map(column => column.label).join(",")
  const csvRows = rows.map(row => columns.map(column => csvEscape(getValue(row, column.key))).join(","))
  return [header, ...csvRows].join("\n")
}

function EditableTable({
  columns,
  emptyText,
  getValue,
  onChange,
  readOnly = false,
  rows,
  selectColumns = {},
  stickyRightColumns = [],
}: {
  columns: readonly { key: string; label: string; width: number }[]
  emptyText: string
  getValue: (row: JsonRow, key: string) => unknown
  onChange?: (rowIndex: number, key: string, value: string) => void
  readOnly?: boolean
  rows: JsonRow[]
  selectColumns?: Record<string, string[]>
  stickyRightColumns?: string[]
}) {
  const stickyOffsets = new Map<string, number>()
  let rightOffset = 0
  for (let index = columns.length - 1; index >= 0; index -= 1) {
    const column = columns[index]
    if (!stickyRightColumns.includes(column.key)) continue
    stickyOffsets.set(column.key, rightOffset)
    rightOffset += column.width
  }

  return (
    <div style={tableWrapStyle}>
      <table style={{ borderCollapse: "separate", borderSpacing: 0, minWidth: Math.max(980, columns.reduce((total, column) => total + column.width, 76)), tableLayout: "fixed", width: "100%" }}>
        <thead>
          <tr>
            {columns.map(column => (
              <th key={column.key} style={{ ...headerCellStyle, ...stickyRightStyle(column.key, stickyOffsets, true), width: column.width }}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`${asText(row["元器件名称"])}-${rowIndex}`}>
              {columns.map(column => {
                const value = asText(getValue(row, column.key))
                const isWarning = column.key.includes("判定") || column.key === "missing_standard_parameters"
                const valueColor = isWarning && value ? optionToneColor(column.key, value) : HUD_TEXT
                const comparison = getComparisonValue(row, column.key)
                const options = selectColumns[column.key]
                const selectValue = options ? selectValueForOptions(value, options) : ""
                return (
                  <td key={column.key} style={{ ...bodyCellStyle, ...stickyRightStyle(column.key, stickyOffsets, false) }}>
                    {comparison ? (
                      <ComparisonCell
                        aiValue={comparison.aiValue}
                        onAiChange={value => onChange?.(rowIndex, COMPARISON_COLUMNS[column.key].aiKey, value)}
                        onTableChange={value => onChange?.(rowIndex, COMPARISON_COLUMNS[column.key].tableKey, value)}
                        readOnly={readOnly}
                        tableLabel={comparison.tableLabel}
                        tableValue={comparison.tableValue}
                      />
                    ) : options ? (
                      <select
                        value={selectValue}
                        onChange={event => onChange?.(rowIndex, column.key, event.target.value)}
                        style={{
                          ...selectCellStyle,
                          backgroundImage: selectArrowBackground(optionToneColor(column.key, selectValue)),
                          borderColor: optionToneColor(column.key, selectValue),
                          color: optionToneColor(column.key, selectValue),
                        }}
                      >
                        {options.map(option => <option key={option} value={option} style={{ ...optionStyle, color: optionToneColor(column.key, option) }}>{option}</option>)}
                      </select>
                    ) : readOnly ? (
                      <div style={{
                        ...readOnlyCellStyle,
                        color: valueColor,
                        fontWeight: isWarning ? 700 : 600,
                      }}>
                        {value || "-"}
                      </div>
                    ) : (
                      <textarea
                        value={value}
                        onChange={event => onChange?.(rowIndex, column.key, event.target.value)}
                        style={{
                          ...cellInputStyle,
                          color: valueColor,
                          fontWeight: isWarning ? 700 : 600,
                          minHeight: column.key === "综合判定详情" ? 88 : value.length > 28 ? 46 : 34,
                        }}
                      />
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} style={emptyCellStyle}>
                {emptyText}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  )
}

function CatalogMatchView({
  emptyText,
  onRowChange,
  rows,
}: {
  emptyText: string
  onRowChange: (rowIndex: number, nextRow: JsonRow) => void
  rows: JsonRow[]
}) {
  const visibleRows = rows
    .map((row, rowIndex) => ({ row, rowIndex }))
    .filter(({ row }) => asText(row["国产/进口"]) !== "进口")

  if (visibleRows.length === 0) {
    return <div style={catalogEmptyStyle}>{emptyText}</div>
  }

  const selectCandidate = (row: JsonRow, rowIndex: number, candidate: JsonRow) => {
    onRowChange(rowIndex, {
      ...row,
      catalog_manufacturer: candidate.catalog_manufacturer ?? "",
      catalog_model: candidate.catalog_model ?? "",
      is_in_catalog: "目录内",
      score: candidate.score ?? 0,
      selected_candidate: candidate,
    })
  }

  const clearCandidate = (row: JsonRow, rowIndex: number) => {
    onRowChange(rowIndex, {
      ...row,
      catalog_manufacturer: "",
      catalog_model: "",
      is_in_catalog: "目录外",
      score: 0,
      selected_candidate: null,
    })
  }

  return (
    <div style={catalogListStyle}>
      {visibleRows.map(({ row, rowIndex }) => {
        const candidates = catalogCandidates(row)
        const selected = selectedCatalogCandidate(row)
        const selectedSummary = catalogCandidateSummary(selected)
        const selectedKey = catalogCandidateKey(selected)
        const hasSelected = Boolean(asText(row.catalog_model) || selected)
        const status = asText(row.is_in_catalog) || (hasSelected ? "目录内" : "目录外")

        return (
          <section key={`${asText(row.index)}-${asText(row.list_model)}-${rowIndex}`} style={catalogItemStyle}>
            <div style={catalogHeaderStyle}>
              <div style={catalogTitleGroupStyle}>
                <span style={catalogIndexStyle}>#{asText(row.index) || rowIndex + 1}</span>
                <strong style={catalogModelStyle}>{asText(row.list_model) || "-"}</strong>
                <span style={catalogMutedStyle}>{asText(row.list_manufacturer) || "未提供厂商"}</span>
              </div>
              <div style={catalogBadgeGroupStyle}>
                <span style={{ ...catalogBadgeStyle, color: optionToneColor("国产/进口", asText(row["国产/进口"])) }}>{asText(row["国产/进口"]) || "未知来源"}</span>
                <span style={{ ...catalogBadgeStyle, color: optionToneColor("目录内或外", status) }}>{status}</span>
                <button type="button" onClick={() => clearCandidate(row, rowIndex)} style={catalogActionButtonStyle}>都不匹配</button>
              </div>
            </div>

            <div style={catalogSelectedGridStyle}>
              <CatalogInfoCell label="目录型号" value={selectedSummary?.model || asText(row.catalog_model) || "-"} strong />
              <CatalogInfoCell label="类别" value={selectedSummary?.group || "-"} />
              <CatalogInfoCell label="厂商" value={selectedSummary?.fullManufacturer || selectedSummary?.manufacturer || asText(row.catalog_manufacturer) || "-"} />
              <CatalogInfoCell label="详情" value={selectedSummary?.detail || "-"} wide />
              <CatalogInfoCell label="匹配原因" value={selectedSummary?.reason || "-"} wide />
              <CatalogInfoCell label="评分" value={selectedSummary?.score || asText(row.score) || "-"} strong />
            </div>

            <details style={catalogDetailsStyle}>
              <summary style={catalogDetailsSummaryStyle}>所有匹配结果（{candidates.length}）</summary>
              {candidates.length > 0 ? (
                <div style={catalogCandidateWrapStyle}>
                  <table style={catalogCandidateTableStyle}>
                    <thead>
                      <tr>
                        <th style={{ ...headerCellStyle, width: 72 }}>选择</th>
                        <th style={{ ...headerCellStyle, width: 150 }}>目录型号</th>
                        <th style={{ ...headerCellStyle, width: 80 }}>类别</th>
                        <th style={{ ...headerCellStyle, width: 170 }}>目录厂商</th>
                        <th style={{ ...headerCellStyle, width: 310 }}>详情</th>
                        <th style={{ ...headerCellStyle, width: 300 }}>匹配原因</th>
                        <th style={{ ...headerCellStyle, width: 90 }}>评分</th>
                      </tr>
                    </thead>
                    <tbody>
                      {candidates.map((candidate, candidateIndex) => {
                        const summary = catalogCandidateSummary(candidate)
                        const candidateKey = catalogCandidateKey(candidate)
                        const checked = selectedKey === candidateKey
                        return (
                          <tr key={`${candidateKey}-${candidateIndex}`}>
                            <td style={catalogCandidateCellStyle}>
                              <input
                                aria-label={`选择 ${summary?.model || candidateIndex + 1}`}
                                checked={checked}
                                name={`catalog-candidate-${rowIndex}`}
                                onChange={() => selectCandidate(row, rowIndex, candidate)}
                                type="radio"
                              />
                            </td>
                            <td style={catalogCandidateCellStyle}><b>{summary?.model || "-"}</b></td>
                            <td style={catalogCandidateCellStyle}>{summary?.group || "-"}</td>
                            <td style={catalogCandidateCellStyle}>{summary?.fullManufacturer || summary?.manufacturer || "-"}</td>
                            <td style={catalogCandidateCellStyle}>{summary?.detail || "-"}</td>
                            <td style={catalogCandidateCellStyle}>{summary?.reason || "-"}</td>
                            <td style={{ ...catalogCandidateCellStyle, color: HUD_CYAN, fontWeight: 800 }}>{summary?.score || "-"}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={catalogNoCandidateStyle}>暂无候选匹配结果</div>
              )}
            </details>
          </section>
        )
      })}
    </div>
  )
}

function CatalogInfoCell({ label, strong = false, value, wide = false }: { label: string; strong?: boolean; value: string; wide?: boolean }) {
  return (
    <div style={wide ? { ...catalogInfoCellStyle, gridColumn: "span 2" } : catalogInfoCellStyle}>
      <span style={catalogInfoLabelStyle}>{label}</span>
      <span style={{ ...catalogInfoValueStyle, color: strong ? HUD_CYAN : HUD_TEXT, fontWeight: strong ? 800 : 650 }}>{value}</span>
    </div>
  )
}

type ReliabilityKind = "quality" | "radiation"
type ReliabilityFilter = "全部" | "直接命中" | "参考命中"

const RELIABILITY_COLUMNS = [
  { key: "index", label: "序号", width: 70 },
  { key: "component_name", label: "元器件名称", width: 150 },
  { key: "model", label: "型号规格", width: 160 },
  { key: "manufacturer", label: "生产厂商", width: 140 },
  { key: "match_level", label: "命中类型", width: 100 },
  { key: "match_reason", label: "匹配依据", width: 180 },
  { key: "match_fragment", label: "匹配片段", width: 160 },
  { key: "matched_models", label: "匹配数据库型号", width: 190 },
  { key: "summary", label: "摘要", width: 360 },
] as const

function ReliabilityQueryView({
  emptyText,
  rows,
}: {
  emptyText: string
  rows: JsonRow[]
}) {
  return (
    <div style={reliabilitySplitStyle}>
      <ReliabilityResultTable emptyText={emptyText} kind="quality" rows={rows} title="质量问题查询" />
      <ReliabilityResultTable emptyText={emptyText} kind="radiation" rows={rows} title="辐照效应查询" />
    </div>
  )
}

function ReliabilityResultTable({
  emptyText,
  kind,
  rows,
  title,
}: {
  emptyText: string
  kind: ReliabilityKind
  rows: JsonRow[]
  title: string
}) {
  const [filter, setFilter] = useState<ReliabilityFilter>("全部")
  const displayRows = rows.map(row => reliabilityDisplayRow(row, kind))
  const directCount = displayRows.filter(row => row.match_level === "直接命中").length
  const referenceCount = displayRows.filter(row => row.match_level === "参考命中").length
  const hitCount = directCount + referenceCount
  const filteredRows = displayRows.filter(row => filter === "全部" ? true : row.match_level === filter)
  const titleHint = kind === "quality" ? "展示质量问题数据库查询结果。" : "展示辐照/辐射效应数据库查询结果。"

  return (
    <section style={reliabilityPanelStyle}>
      <div style={reliabilityPanelHeaderStyle}>
        <div>
          <h3 style={reliabilityTitleStyle}>{title}</h3>
          <div style={reliabilitySubtitleStyle}>{titleHint}</div>
        </div>
      </div>

      <div style={reliabilityToolbarStyle}>
        <span style={reliabilityChipStyle("info")}>型号 {rows.length} 个</span>
        <span style={reliabilityChipStyle("ok")}>记录 {hitCount} 条</span>
        {(["全部", "直接命中", "参考命中"] as const).map(option => (
          <button
            key={option}
            type="button"
            onClick={() => setFilter(option)}
            style={reliabilityFilterButtonStyle(filter === option, option)}
          >
            {option}
          </button>
        ))}
        <span style={mutedTextStyle}>点击行可查看该型号的数据库明细。</span>
      </div>

      <div style={reliabilityTableWrapStyle}>
        <table style={reliabilityTableStyle}>
          <thead>
            <tr>
              {RELIABILITY_COLUMNS.map(column => (
                <th key={column.key} style={{ ...reliabilityHeaderCellStyle, width: column.width }}>{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row, rowIndex) => (
              <tr key={`${kind}-${row.index}-${row.model}-${rowIndex}`} style={rowIndex % 2 === 1 ? reliabilityAltRowStyle : undefined}>
                {RELIABILITY_COLUMNS.map(column => (
                  <td key={column.key} style={reliabilityBodyCellStyle(column.key)}>
                    <div style={reliabilityCellTextStyle(column.key, asText(row.match_level))}>
                      {asText(row[column.key]) || "-"}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={RELIABILITY_COLUMNS.length} style={emptyCellStyle}>{emptyText}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function reliabilityDisplayRow(row: JsonRow, kind: ReliabilityKind): JsonRow {
  const matchLevel = reliabilityMatchLevel(row, kind)
  const matchedRecords = matchLevel === "直接命中"
    ? reliabilityDirectRecords(row, kind)
    : matchLevel === "参考命中"
      ? reliabilityReferenceRecords(row, kind)
      : []
  const matchedModels = Array.from(new Set(
    matchedRecords.flatMap(record => reliabilityRecordModels(record)),
  )).join(", ")
  return {
    count: matchedRecords.length,
    index: row.index,
    component_name: componentName(row),
    manufacturer: componentManufacturer(row),
    match_fragment: reliabilityMatchedFragment(row, kind),
    match_level: matchLevel,
    match_reason: matchLevel === "直接命中"
      ? "型号精准匹配"
      : matchLevel === "参考命中"
        ? "型号片段相似"
        : "未命中",
    matched_models: matchedModels,
    model: componentModel(row),
    summary: matchLevel === "直接命中"
      ? reliabilityDirectSummary(row, kind)
      : matchLevel === "参考命中"
        ? reliabilityDisplaySummary(row, kind).replace(/^参考命中：/u, "")
        : "",
  }
}

function stickyRightStyle(key: string, offsets: Map<string, number>, header: boolean): CSSProperties {
  const right = offsets.get(key)
  if (right === undefined) return {}

  return {
    background: header ? HUD_TABLE_HEADER : HUD_TABLE_CELL,
    boxShadow: right === 0
      ? `-12px 0 22px ${HUD_STICKY_SHADOW}`
      : `-1px 0 0 ${HUD_LINE}`,
    position: "sticky",
    right,
    zIndex: header ? 6 : right === 0 ? 4 : 5,
  }
}

function selectArrowBackground(color: string) {
  return `linear-gradient(45deg, transparent 50%, ${color} 50%), linear-gradient(135deg, ${color} 50%, transparent 50%)`
}

function ComparisonCell({
  aiValue,
  onAiChange,
  onTableChange,
  readOnly,
  tableLabel,
  tableValue,
}: {
  aiValue: string
  onAiChange?: (value: string) => void
  onTableChange?: (value: string) => void
  readOnly: boolean
  tableLabel: string
  tableValue: string
}) {
  const displayTableValue = displayNumber(tableValue)
  const aiTone = isPositiveJudgement(aiValue)
    ? "ok"
    : isNegativeJudgement(aiValue)
      ? "bad"
      : "neutral"
  const tableTone = isNegativeJudgement(aiValue) ? "bad" : "neutral"

  if (readOnly) {
    return (
      <div style={comparisonCellStyle}>
        <div style={comparisonRowStyle}>
          <span style={comparisonLabelStyle}>{tableLabel}</span>
          <span style={{ ...comparisonValueStyle, color: tableTone === "bad" ? HUD_RED : HUD_TEXT }}>{displayTableValue || "-"}</span>
        </div>
        <div style={comparisonDividerStyle} />
        <div style={comparisonRowStyle}>
          <span style={comparisonLabelStyle}>AI判定</span>
          <span style={{ ...comparisonValueStyle, color: aiTone === "ok" ? HUD_GREEN : aiTone === "bad" ? HUD_RED : HUD_CYAN }}>{aiValue || "-"}</span>
        </div>
      </div>
    )
  }

  return (
    <div style={comparisonCellStyle}>
      <label style={comparisonEditorLabelStyle}>
        <span style={comparisonEditorTextStyle}>{tableLabel}</span>
        <textarea
          value={displayTableValue}
          onChange={event => onTableChange?.(event.target.value)}
          style={{
            ...comparisonTextareaStyle,
            color: tableTone === "bad" ? HUD_RED : HUD_TEXT,
          }}
        />
      </label>
      <label style={comparisonEditorLabelStyle}>
        <span style={comparisonEditorTextStyle}>AI判定</span>
        <textarea
          value={aiValue}
          onChange={event => onAiChange?.(event.target.value)}
          style={{
            ...comparisonTextareaStyle,
            color: aiTone === "ok" ? HUD_GREEN : aiTone === "bad" ? HUD_RED : HUD_CYAN,
          }}
        />
      </label>
    </div>
  )
}

function downloadCsv(filename: string, content: string) {
  const normalizedContent = content.replace(/\r?\n/gu, "\r\n")
  const blob = new Blob([`\ufeff${normalizedContent}`], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

const HUD_BG = "var(--derating-bg)"
const HUD_PANEL = "var(--derating-panel)"
const HUD_PANEL_SOFT = "var(--derating-panel-soft)"
const HUD_LINE = "var(--derating-line)"
const HUD_LINE_SOFT = "var(--derating-line-soft)"
const HUD_TEXT = "var(--derating-text)"
const HUD_MUTED = "var(--derating-muted)"
const HUD_DIM = "var(--derating-dim)"
const HUD_CYAN = "var(--derating-cyan)"
const HUD_GREEN = "var(--derating-green)"
const HUD_RED = "var(--derating-red)"
const HUD_WARN = "var(--derating-warn)"
const HUD_CONTROL_BG = "var(--derating-control-bg)"
const HUD_PRIMARY_BG = "var(--derating-primary-bg)"
const HUD_PRIMARY_BORDER = "var(--derating-primary-border)"
const HUD_PRIMARY_TEXT = "var(--derating-primary-text)"
const HUD_PRIMARY_SHADOW = "var(--derating-primary-shadow)"
const HUD_SECTION_SHADOW = "var(--derating-section-shadow)"
const HUD_TABLE_BG = "var(--derating-table-bg)"
const HUD_TABLE_HEADER = "var(--derating-table-header)"
const HUD_TABLE_CELL = "var(--derating-table-cell)"
const HUD_TABLE_HEADER_TEXT = "var(--derating-table-header-text)"
const HUD_INPUT_BG = "var(--derating-input-bg)"
const HUD_LABEL_BG = "var(--derating-label-bg)"
const HUD_STICKY_SHADOW = "var(--derating-sticky-shadow)"
const HUD_SCROLLBAR = "var(--derating-scrollbar)"
const HUD_OPTION_BG = "var(--derating-option-bg)"

const darkThemeVars = {
  "--derating-bg": "#0f172a",
  "--derating-control-bg": "rgba(15, 23, 42, 0.76)",
  "--derating-cyan": "#38bdf8",
  "--derating-dim": "rgba(226, 232, 240, 0.42)",
  "--derating-green": "#10b981",
  "--derating-input-bg": "rgba(15, 23, 42, 0.24)",
  "--derating-label-bg": "transparent",
  "--derating-line": "rgba(148, 163, 184, 0.22)",
  "--derating-line-soft": "rgba(148, 163, 184, 0.14)",
  "--derating-muted": "rgba(226, 232, 240, 0.62)",
  "--derating-option-bg": "#111827",
  "--derating-page-top": "#111827",
  "--derating-panel": "rgba(17, 24, 39, 0.92)",
  "--derating-panel-soft": "rgba(30, 41, 59, 0.7)",
  "--derating-primary-bg": "linear-gradient(135deg, #0ea5e9 0%, #38bdf8 100%)",
  "--derating-primary-border": "#38bdf8",
  "--derating-primary-shadow": "0 14px 28px rgba(14, 165, 233, 0.2)",
  "--derating-primary-text": "#f8fafc",
  "--derating-red": "#fb7185",
  "--derating-scrollbar": "rgba(96, 165, 250, 0.36)",
  "--derating-section-shadow": "0 18px 40px rgba(0, 0, 0, 0.22)",
  "--derating-sticky-shadow": "rgba(0, 0, 0, 0.28)",
  "--derating-table-bg": "rgba(2, 8, 16, 0.64)",
  "--derating-table-cell": "rgba(3, 13, 24, 0.96)",
  "--derating-table-header": "rgba(30, 41, 59, 0.98)",
  "--derating-table-header-text": "rgba(226, 232, 240, 0.72)",
  "--derating-text": "#e2e8f0",
  "--derating-warn": "#ff8a3d",
} satisfies ComplianceCheckThemeVars

const lightThemeVars = {
  "--derating-bg": "#f3f6fa",
  "--derating-control-bg": "#ffffff",
  "--derating-cyan": "#0ea5e9",
  "--derating-dim": "#94a3b8",
  "--derating-green": "#10b981",
  "--derating-input-bg": "rgba(255, 255, 255, 0.86)",
  "--derating-label-bg": "#eef2f7",
  "--derating-line": "rgba(100, 116, 139, 0.18)",
  "--derating-line-soft": "rgba(100, 116, 139, 0.11)",
  "--derating-muted": "#64748b",
  "--derating-option-bg": "#ffffff",
  "--derating-page-top": "#f8fafc",
  "--derating-panel": "rgba(255, 255, 255, 0.96)",
  "--derating-panel-soft": "#ffffff",
  "--derating-primary-bg": "linear-gradient(135deg, #0ea5e9 0%, #38bdf8 100%)",
  "--derating-primary-border": "#38bdf8",
  "--derating-primary-shadow": "0 14px 28px rgba(14, 165, 233, 0.18)",
  "--derating-primary-text": "#ffffff",
  "--derating-red": "#ec4899",
  "--derating-scrollbar": "rgba(37, 99, 235, 0.24)",
  "--derating-section-shadow": "0 16px 40px rgba(15, 23, 42, 0.07)",
  "--derating-sticky-shadow": "rgba(18, 34, 51, 0.12)",
  "--derating-table-bg": "#ffffff",
  "--derating-table-cell": "#ffffff",
  "--derating-table-header": "#f1f5f9",
  "--derating-table-header-text": "#475569",
  "--derating-text": "#0f172a",
  "--derating-warn": "#ff5a1f",
} satisfies ComplianceCheckThemeVars

const greenText = { color: HUD_GREEN }
const redText = { color: HUD_RED }
const mutedTextStyle = { color: HUD_MUTED } satisfies CSSProperties
const hintTextStyle = { color: HUD_CYAN, fontWeight: 800 } satisfies CSSProperties

const pageStyle = {
  background: HUD_BG,
  color: HUD_TEXT,
  height: "100%",
  overflow: "auto",
  padding: "16px",
} satisfies CSSProperties

const viewerShellStyle = {
  alignItems: "start",
  display: "grid",
  gap: 14,
  gridTemplateColumns: "190px minmax(0, 1fr)",
  minHeight: 0,
} satisfies CSSProperties

const sideNavStyle = {
  background: HUD_PANEL,
  border: `1px solid ${HUD_LINE}`,
  borderRadius: 8,
  boxShadow: HUD_SECTION_SHADOW,
  display: "grid",
  gap: 6,
  marginTop: 14,
  padding: 8,
  position: "sticky",
  top: 12,
} satisfies CSSProperties

function sideNavButtonStyle(active: boolean): CSSProperties {
  return {
    alignItems: "center",
    background: active ? HUD_PRIMARY_BG : "transparent",
    border: `1px solid ${active ? HUD_PRIMARY_BORDER : HUD_LINE}`,
    borderRadius: 6,
    boxShadow: active ? HUD_PRIMARY_SHADOW : "none",
    color: active ? HUD_PRIMARY_TEXT : HUD_TEXT,
    cursor: "pointer",
    display: "grid",
    fontSize: 13,
    gap: 9,
    gridTemplateColumns: "24px minmax(0, 1fr) auto",
    fontWeight: 800,
    minHeight: 42,
    padding: "0 10px",
    textAlign: "left",
  }
}

function sideNavBadgeStyle(count: number): CSSProperties {
  return {
    background: count > 0 ? HUD_LABEL_BG : "transparent",
    border: `1px solid ${count > 0 ? HUD_LINE : "transparent"}`,
    borderRadius: 999,
    color: count > 0 ? HUD_WARN : HUD_GREEN,
    fontSize: 11,
    fontWeight: 900,
    lineHeight: 1,
    minWidth: 22,
    padding: "4px 6px",
    textAlign: "center",
  }
}

const sideNavIconStyle = {
  alignItems: "center",
  background: HUD_LABEL_BG,
  border: `1px solid ${HUD_LINE_SOFT}`,
  borderRadius: 6,
  color: HUD_CYAN,
  display: "inline-flex",
  fontSize: 13,
  height: 24,
  justifyContent: "center",
  width: 24,
} satisfies CSSProperties

const sideNavTextStyle = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
} satisfies CSSProperties

const viewerContentStyle = {
  minWidth: 0,
} satisfies CSSProperties

const sectionStyle = {
  background: HUD_PANEL,
  border: `1px solid ${HUD_LINE}`,
  borderRadius: 8,
  boxShadow: HUD_SECTION_SHADOW,
  marginTop: 14,
  overflow: "hidden",
} satisfies CSSProperties

const summaryStyle = {
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 800,
  padding: "12px 14px",
  color: HUD_TEXT,
} satisfies CSSProperties

const sectionBodyStyle = {
  background: HUD_PANEL_SOFT,
  borderTop: `1px solid ${HUD_LINE_SOFT}`,
  padding: "12px 14px",
} satisfies CSSProperties

const metricsStyle = {
  color: HUD_MUTED,
  display: "grid",
  fontSize: 13,
  gap: 5,
  lineHeight: 1.45,
  marginBottom: 10,
} satisfies CSSProperties

const tableWrapStyle = {
  background: HUD_TABLE_BG,
  border: `1px solid ${HUD_LINE}`,
  borderRadius: 6,
  boxShadow: HUD_SECTION_SHADOW,
  maxHeight: 360,
  minHeight: 0,
  overflow: "auto",
  scrollbarColor: `${HUD_SCROLLBAR} transparent`,
} satisfies CSSProperties

const reliabilitySplitStyle = {
  display: "grid",
  gap: 14,
} satisfies CSSProperties

const reliabilityPanelStyle = {
  background: HUD_TABLE_BG,
  border: `1px solid ${HUD_LINE}`,
  borderRadius: 6,
  overflow: "hidden",
} satisfies CSSProperties

const reliabilityPanelHeaderStyle = {
  alignItems: "center",
  background: HUD_PANEL_SOFT,
  borderBottom: `1px solid ${HUD_LINE_SOFT}`,
  display: "flex",
  justifyContent: "space-between",
  padding: "10px 12px",
} satisfies CSSProperties

const reliabilityTitleStyle = {
  color: HUD_TEXT,
  fontSize: 14,
  lineHeight: 1.25,
  margin: 0,
} satisfies CSSProperties

const reliabilitySubtitleStyle = {
  color: HUD_MUTED,
  fontSize: 12,
  fontWeight: 650,
  marginTop: 4,
} satisfies CSSProperties

const reliabilityToolbarStyle = {
  alignItems: "center",
  background: HUD_PANEL_SOFT,
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  padding: "10px 12px",
} satisfies CSSProperties

function reliabilityChipStyle(tone: "info" | "ok"): CSSProperties {
  return {
    background: tone === "ok" ? "rgba(16, 185, 129, 0.12)" : "rgba(14, 165, 233, 0.12)",
    border: `1px solid ${tone === "ok" ? "rgba(16, 185, 129, 0.24)" : "rgba(14, 165, 233, 0.24)"}`,
    borderRadius: 4,
    color: tone === "ok" ? HUD_GREEN : HUD_CYAN,
    fontSize: 12,
    fontWeight: 850,
    padding: "4px 8px",
  }
}

function reliabilityFilterButtonStyle(active: boolean, filter: ReliabilityFilter): CSSProperties {
  const isDirect = filter === "直接命中"
  const isReference = filter === "参考命中"
  return {
    background: active
      ? isDirect
        ? "rgba(236, 72, 153, 0.14)"
        : isReference
          ? "rgba(255, 138, 61, 0.16)"
          : "rgba(14, 165, 233, 0.14)"
      : HUD_CONTROL_BG,
    border: `1px solid ${active ? isDirect ? "rgba(236, 72, 153, 0.34)" : isReference ? "rgba(255, 138, 61, 0.34)" : "rgba(14, 165, 233, 0.34)" : HUD_LINE}`,
    borderRadius: 999,
    color: active ? isDirect ? HUD_RED : isReference ? HUD_WARN : HUD_CYAN : HUD_TEXT,
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 850,
    height: 28,
    padding: "0 12px",
  }
}

const reliabilityTableWrapStyle = {
  maxHeight: 300,
  overflow: "auto",
  scrollbarColor: `${HUD_SCROLLBAR} transparent`,
} satisfies CSSProperties

const reliabilityTableStyle = {
  borderCollapse: "collapse",
  minWidth: 1510,
  tableLayout: "fixed",
  width: "100%",
} satisfies CSSProperties

const reliabilityHeaderCellStyle = {
  background: HUD_TABLE_HEADER,
  border: `1px solid ${HUD_LINE_SOFT}`,
  color: HUD_TABLE_HEADER_TEXT,
  fontSize: 12,
  fontWeight: 800,
  padding: "9px 8px",
  position: "sticky",
  textAlign: "left",
  top: 0,
  zIndex: 2,
} satisfies CSSProperties

function reliabilityBodyCellStyle(key: string): CSSProperties {
  return {
    background: "transparent",
    border: `1px solid ${HUD_LINE_SOFT}`,
    fontSize: 12,
    padding: key === "summary" ? "8px 10px" : "8px",
    verticalAlign: "top",
  }
}

function reliabilityCellTextStyle(key: string, matchLevel: string): CSSProperties {
  return {
    color: key === "match_level"
      ? matchLevel === "直接命中"
        ? HUD_RED
        : matchLevel === "参考命中"
          ? HUD_WARN
          : HUD_TEXT
      : HUD_TEXT,
    fontWeight: key === "match_level" || key === "component_name" || key === "model" ? 800 : 650,
    lineHeight: 1.45,
    maxHeight: key === "summary" ? 92 : undefined,
    overflow: key === "summary" ? "auto" : "hidden",
    overflowWrap: "anywhere",
    whiteSpace: key === "summary" ? "pre-wrap" : "normal",
  }
}

const reliabilityAltRowStyle = {
  background: "rgba(100, 116, 139, 0.06)",
} satisfies CSSProperties

const actionsStyle = {
  display: "flex",
  gap: 10,
  justifyContent: "flex-end",
  paddingTop: 10,
} satisfies CSSProperties

const toolbarButtonStyle = {
  background: HUD_CONTROL_BG,
  border: `1px solid ${HUD_LINE}`,
  borderRadius: 6,
  color: HUD_TEXT,
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 700,
  height: 32,
  padding: "0 12px",
} satisfies CSSProperties

const primaryButtonStyle = {
  ...toolbarButtonStyle,
  background: HUD_PRIMARY_BG,
  border: `1px solid ${HUD_PRIMARY_BORDER}`,
  boxShadow: HUD_PRIMARY_SHADOW,
  color: HUD_PRIMARY_TEXT,
} satisfies CSSProperties

const secondaryPrimaryButtonStyle = {
  ...primaryButtonStyle,
  opacity: 0.78,
} satisfies CSSProperties

const dashboardStyle = {
  background: HUD_PANEL,
  border: `1px solid ${HUD_LINE}`,
  borderRadius: 8,
  boxShadow: HUD_SECTION_SHADOW,
  display: "grid",
  gap: 12,
  marginTop: 14,
  padding: 14,
} satisfies CSSProperties

const dashboardHeaderStyle = {
  alignItems: "center",
  display: "flex",
  flexWrap: "wrap",
  gap: 12,
  justifyContent: "space-between",
} satisfies CSSProperties

const dashboardTitleGroupStyle = {
  display: "grid",
  gap: 4,
  minWidth: 260,
} satisfies CSSProperties

const dashboardTitleStyle = {
  color: HUD_TEXT,
  fontSize: 18,
  lineHeight: 1.2,
} satisfies CSSProperties

const dashboardSubtitleStyle = {
  color: HUD_MUTED,
  fontSize: 12,
  fontWeight: 700,
} satisfies CSSProperties

const dashboardActionGroupStyle = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
} satisfies CSSProperties

const dashboardKpiGridStyle = {
  display: "grid",
  gap: 12,
  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
} satisfies CSSProperties

function kpiGradient(palette: KpiPalette) {
  if (palette === "orange") return `linear-gradient(135deg, ${KPI_ORANGE} 0%, ${KPI_ORANGE_2} 100%)`
  if (palette === "violet") return `linear-gradient(135deg, ${KPI_VIOLET} 0%, ${KPI_VIOLET_2} 100%)`
  if (palette === "teal") return `linear-gradient(135deg, ${KPI_TEAL} 0%, ${KPI_TEAL_2} 100%)`
  if (palette === "pink") return `linear-gradient(135deg, ${KPI_PINK} 0%, ${KPI_PINK_2} 100%)`
  if (palette === "red") return `linear-gradient(135deg, ${KPI_RED} 0%, ${KPI_RED_2} 100%)`
  return `linear-gradient(135deg, ${KPI_BLUE} 0%, ${KPI_BLUE_2} 100%)`
}

function kpiShadow(palette: KpiPalette) {
  if (palette === "orange") return "0 16px 26px rgba(255, 90, 31, 0.22)"
  if (palette === "violet") return "0 16px 26px rgba(124, 92, 255, 0.2)"
  if (palette === "teal") return "0 16px 26px rgba(16, 185, 129, 0.2)"
  if (palette === "pink") return "0 16px 26px rgba(236, 72, 153, 0.2)"
  if (palette === "red") return "0 16px 26px rgba(239, 68, 68, 0.2)"
  return "0 16px 26px rgba(14, 165, 233, 0.2)"
}

function kpiTileStyle(palette: KpiPalette): CSSProperties {
  return {
    background: kpiGradient(palette),
    border: "1px solid rgba(255, 255, 255, 0.32)",
    borderRadius: 8,
    boxShadow: kpiShadow(palette),
    color: "#ffffff",
    display: "grid",
    gap: 10,
    minHeight: 86,
    padding: "14px 16px",
  }
}

const kpiLabelStyle = {
  color: "rgba(255, 255, 255, 0.86)",
  fontSize: 12,
  fontWeight: 850,
} satisfies CSSProperties

const kpiValueStyle = {
  fontSize: 27,
  lineHeight: 1,
} satisfies CSSProperties

const kpiDetailStyle = {
  color: "rgba(255, 255, 255, 0.82)",
  fontSize: 11,
  fontWeight: 750,
  lineHeight: 1.25,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
} satisfies CSSProperties

const dashboardAnalyticsGridStyle = {
  display: "grid",
  gap: 12,
  gridTemplateColumns: "minmax(360px, 1.3fr) repeat(2, minmax(240px, 0.85fr))",
} satisfies CSSProperties

const dashboardFlowPanelStyle = {
  background: HUD_PANEL_SOFT,
  border: `1px solid ${HUD_LINE_SOFT}`,
  borderRadius: 8,
  boxShadow: HUD_SECTION_SHADOW,
  minWidth: 0,
  overflow: "hidden",
  padding: 12,
} satisfies CSSProperties

const dashboardStatusGridStyle = {
  display: "grid",
  gap: 12,
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
} satisfies CSSProperties

function moduleInsightCardStyle(variant: "default" | "large" = "default"): CSSProperties {
  return {
    background: HUD_PANEL_SOFT,
    border: `1px solid ${HUD_LINE_SOFT}`,
    borderRadius: 8,
    boxShadow: HUD_SECTION_SHADOW,
    gridColumn: variant === "large" ? "span 1" : undefined,
    minWidth: 0,
    padding: 12,
  }
}

const moduleInsightBodyStyle = {
  display: "grid",
  gap: 10,
} satisfies CSSProperties

const moduleMetricPairStyle = {
  display: "grid",
  gap: 8,
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
} satisfies CSSProperties

const moduleChartSplitStyle = {
  alignItems: "start",
  display: "grid",
  gap: 12,
  gridTemplateColumns: "minmax(230px, 0.9fr) minmax(180px, 1fr)",
} satisfies CSSProperties

const moduleSubTitleStyle = {
  color: HUD_MUTED,
  fontSize: 11,
  fontWeight: 900,
  marginTop: 2,
} satisfies CSSProperties

const moduleListStyle = {
  color: HUD_MUTED,
  display: "grid",
  fontSize: 12,
  fontWeight: 750,
  gap: 6,
  lineHeight: 1.35,
} satisfies CSSProperties

const moduleEmptyStyle = {
  color: HUD_DIM,
  fontSize: 12,
  fontWeight: 800,
  minHeight: 28,
  paddingTop: 6,
} satisfies CSSProperties

const smallBarListStyle = {
  display: "grid",
  gap: 8,
} satisfies CSSProperties

const smallBarCompactListStyle = {
  display: "grid",
  gap: 6,
  maxHeight: 130,
  overflow: "auto",
} satisfies CSSProperties

const smallBarItemStyle = {
  display: "grid",
  gap: 4,
} satisfies CSSProperties

const smallBarLabelRowStyle = {
  alignItems: "center",
  color: HUD_MUTED,
  display: "flex",
  fontSize: 12,
  fontWeight: 800,
  gap: 8,
  justifyContent: "space-between",
} satisfies CSSProperties

const smallBarTrackStyle = {
  background: HUD_TABLE_BG,
  border: `1px solid ${HUD_LINE_SOFT}`,
  borderRadius: 999,
  height: 8,
  overflow: "hidden",
} satisfies CSSProperties

const smallBarFillStyle = {
  display: "block",
  height: "100%",
} satisfies CSSProperties

const percentDonutWrapStyle = {
  alignItems: "center",
  display: "grid",
  gap: 10,
  gridTemplateColumns: "104px minmax(0, 1fr)",
} satisfies CSSProperties

const percentDonutLegendStyle = {
  display: "grid",
  gap: 7,
  minWidth: 0,
} satisfies CSSProperties

const percentDonutLegendItemStyle = {
  alignItems: "center",
  color: HUD_MUTED,
  display: "grid",
  fontSize: 12,
  fontWeight: 800,
  gap: 7,
  gridTemplateColumns: "10px minmax(0, 1fr) auto",
} satisfies CSSProperties

const miniGaugeTrackStyle = {
  background: HUD_TABLE_BG,
  border: `1px solid ${HUD_LINE_SOFT}`,
  borderRadius: 999,
  height: 12,
  overflow: "hidden",
} satisfies CSSProperties

const miniGaugeFillStyle = {
  display: "block",
  height: "100%",
} satisfies CSSProperties

const dashboardLowerGridStyle = {
  display: "grid",
  gap: 12,
  gridTemplateColumns: "minmax(420px, 1.4fr) minmax(260px, 0.6fr)",
} satisfies CSSProperties

const dashboardPanelStyle = {
  background: HUD_PANEL_SOFT,
  border: `1px solid ${HUD_LINE_SOFT}`,
  borderRadius: 8,
  minWidth: 0,
  padding: 12,
} satisfies CSSProperties

const dashboardPanelHeaderStyle = {
  alignItems: "center",
  color: HUD_TEXT,
  display: "flex",
  gap: 10,
  justifyContent: "space-between",
  marginBottom: 10,
} satisfies CSSProperties

const dashboardLegendDotStyle = {
  borderRadius: 999,
  height: 10,
  width: 10,
} satisfies CSSProperties

const dashboardSignalStyle = {
  alignItems: "center",
  background: HUD_LABEL_BG,
  border: `1px solid ${HUD_LINE_SOFT}`,
  borderRadius: 8,
  display: "flex",
  justifyContent: "space-between",
  minHeight: 48,
  padding: "0 12px",
} satisfies CSSProperties

const dashboardSignalLabelStyle = {
  color: HUD_MUTED,
  fontSize: 12,
  fontWeight: 800,
} satisfies CSSProperties

const dashboardSignalValueStyle = {
  fontSize: 18,
  lineHeight: 1,
} satisfies CSSProperties

const dashboardRiskToolbarStyle = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
  marginBottom: 8,
} satisfies CSSProperties

function dashboardFilterButtonStyle(active: boolean, enabled: boolean): CSSProperties {
  return {
    background: active ? HUD_LABEL_BG : "transparent",
    border: `1px solid ${active ? HUD_LINE : HUD_LINE_SOFT}`,
    borderRadius: 999,
    color: enabled ? active ? HUD_TEXT : HUD_MUTED : HUD_DIM,
    cursor: enabled ? "pointer" : "default",
    fontSize: 11,
    fontWeight: 850,
    height: 28,
    lineHeight: 1,
    padding: "5px 7px",
  }
}

const dashboardFilterSelectStyle = {
  background: HUD_CONTROL_BG,
  border: `1px solid ${HUD_LINE_SOFT}`,
  borderRadius: 6,
  color: HUD_TEXT,
  fontSize: 12,
  fontWeight: 800,
  height: 28,
  outline: "none",
  padding: "0 8px",
} satisfies CSSProperties

const dashboardFilterInputStyle = {
  ...dashboardFilterSelectStyle,
  minWidth: 120,
  width: 140,
} satisfies CSSProperties

const dashboardRiskTableWrapStyle = {
  border: `1px solid ${HUD_LINE_SOFT}`,
  borderRadius: 6,
  overflow: "auto",
  scrollbarColor: `${HUD_SCROLLBAR} transparent`,
} satisfies CSSProperties

const dashboardRiskTableStyle = {
  borderCollapse: "collapse",
  minWidth: 780,
  tableLayout: "fixed",
  width: "100%",
} satisfies CSSProperties

const dashboardRiskHeaderStyle = {
  background: HUD_TABLE_HEADER,
  border: `1px solid ${HUD_LINE_SOFT}`,
  color: HUD_TABLE_HEADER_TEXT,
  fontSize: 12,
  fontWeight: 800,
  padding: "9px 8px",
  position: "static",
  textAlign: "left",
} satisfies CSSProperties

const dashboardRiskCellStyle = {
  background: HUD_TABLE_CELL,
  border: `1px solid ${HUD_LINE_SOFT}`,
  color: HUD_TEXT,
  fontSize: 12,
  fontWeight: 650,
  lineHeight: 1.4,
  overflowWrap: "anywhere",
  padding: "8px",
  verticalAlign: "top",
} satisfies CSSProperties

const dashboardInlineActionStyle = {
  ...toolbarButtonStyle,
  color: HUD_CYAN,
  height: 28,
  maxWidth: "100%",
  padding: "0 8px",
} satisfies CSSProperties

const dashboardAdviceListStyle = {
  display: "grid",
  gap: 9,
} satisfies CSSProperties

const dashboardAdviceItemStyle = {
  alignItems: "start",
  background: HUD_TABLE_BG,
  border: `1px solid ${HUD_LINE_SOFT}`,
  borderRadius: 6,
  color: HUD_MUTED,
  display: "grid",
  fontSize: 12,
  fontWeight: 750,
  gap: 8,
  gridTemplateColumns: "8px minmax(0, 1fr)",
  lineHeight: 1.45,
  padding: "9px 10px",
} satisfies CSSProperties

const dashboardAdviceMarkStyle = {
  borderRadius: 999,
  height: 8,
  marginTop: 5,
  width: 8,
} satisfies CSSProperties

const headerCellStyle = {
  background: HUD_TABLE_HEADER,
  border: `1px solid ${HUD_LINE_SOFT}`,
  boxShadow: `0 1px 0 ${HUD_LINE}`,
  color: HUD_TABLE_HEADER_TEXT,
  fontSize: 12,
  fontWeight: 800,
  padding: "9px 8px",
  position: "sticky",
  textAlign: "left",
  top: 0,
  zIndex: 2,
} satisfies CSSProperties

const bodyCellStyle = {
  background: HUD_TABLE_CELL,
  border: `1px solid ${HUD_LINE_SOFT}`,
  fontSize: 12,
  padding: 0,
  verticalAlign: "top",
} satisfies CSSProperties

const cellInputStyle = {
  background: HUD_INPUT_BG,
  border: 0,
  boxSizing: "border-box",
  color: HUD_TEXT,
  display: "block",
  font: "inherit",
  lineHeight: 1.45,
  outline: "none",
  padding: "8px",
  resize: "vertical",
  scrollbarColor: `${HUD_SCROLLBAR} transparent`,
  width: "100%",
} satisfies CSSProperties

const readOnlyCellStyle = {
  boxSizing: "border-box",
  color: HUD_TEXT,
  lineHeight: 1.45,
  minHeight: 34,
  padding: "8px",
  whiteSpace: "pre-wrap",
  width: "100%",
  wordBreak: "break-word",
} satisfies CSSProperties

const selectCellStyle = {
  appearance: "none",
  background: HUD_CONTROL_BG,
  backgroundPosition: "calc(100% - 14px) 50%, calc(100% - 8px) 50%",
  backgroundRepeat: "no-repeat",
  backgroundSize: "6px 6px, 6px 6px",
  border: `1px solid ${HUD_LINE}`,
  borderRadius: 6,
  boxSizing: "border-box",
  font: "inherit",
  fontWeight: 800,
  height: 32,
  margin: 6,
  outline: "none",
  padding: "0 24px 0 8px",
  width: "calc(100% - 12px)",
} satisfies CSSProperties

const comparisonCellStyle = {
  display: "grid",
  gap: 6,
  padding: 8,
} satisfies CSSProperties

const comparisonRowStyle = {
  alignItems: "start",
  display: "grid",
  gap: 6,
  gridTemplateColumns: "64px minmax(0, 1fr)",
  minHeight: 22,
} satisfies CSSProperties

const comparisonLabelStyle = {
  alignSelf: "start",
  border: `1px solid ${HUD_LINE_SOFT}`,
  background: HUD_LABEL_BG,
  borderRadius: 4,
  color: HUD_DIM,
  fontSize: 10,
  fontWeight: 800,
  lineHeight: 1.2,
  padding: "3px 5px",
  textAlign: "center",
  whiteSpace: "nowrap",
} satisfies CSSProperties

const comparisonValueStyle = {
  fontSize: 12,
  fontWeight: 800,
  lineHeight: 1.35,
  minWidth: 0,
  overflowWrap: "anywhere",
  paddingTop: 2,
  whiteSpace: "pre-wrap",
} satisfies CSSProperties

const comparisonDividerStyle = {
  borderTop: `1px solid ${HUD_LINE_SOFT}`,
} satisfies CSSProperties

const comparisonEditorLabelStyle = {
  display: "grid",
  gap: 4,
} satisfies CSSProperties

const comparisonEditorTextStyle = {
  color: HUD_DIM,
  fontSize: 10,
  fontWeight: 800,
  lineHeight: 1.2,
} satisfies CSSProperties

const comparisonTextareaStyle = {
  ...cellInputStyle,
  background: HUD_CONTROL_BG,
  border: `1px solid ${HUD_LINE_SOFT}`,
  borderRadius: 4,
  minHeight: 30,
  padding: "6px 7px",
} satisfies CSSProperties

const catalogListStyle = {
  display: "grid",
  gap: 12,
} satisfies CSSProperties

const catalogEmptyStyle = {
  background: HUD_TABLE_BG,
  border: `1px solid ${HUD_LINE}`,
  borderRadius: 6,
  color: HUD_DIM,
  padding: 24,
  textAlign: "center",
} satisfies CSSProperties

const catalogItemStyle = {
  background: HUD_TABLE_BG,
  border: `1px solid ${HUD_LINE}`,
  borderRadius: 6,
  boxShadow: HUD_SECTION_SHADOW,
  overflow: "hidden",
} satisfies CSSProperties

const catalogHeaderStyle = {
  alignItems: "center",
  background: HUD_TABLE_HEADER,
  borderBottom: `1px solid ${HUD_LINE_SOFT}`,
  display: "flex",
  flexWrap: "wrap",
  gap: 10,
  justifyContent: "space-between",
  padding: "10px 12px",
} satisfies CSSProperties

const catalogTitleGroupStyle = {
  alignItems: "center",
  display: "flex",
  flexWrap: "wrap",
  gap: 9,
  minWidth: 0,
} satisfies CSSProperties

const catalogIndexStyle = {
  color: HUD_DIM,
  fontSize: 12,
  fontWeight: 800,
} satisfies CSSProperties

const catalogModelStyle = {
  color: HUD_TEXT,
  fontSize: 15,
  overflowWrap: "anywhere",
} satisfies CSSProperties

const catalogMutedStyle = {
  color: HUD_MUTED,
  fontSize: 12,
  fontWeight: 700,
} satisfies CSSProperties

const catalogBadgeGroupStyle = {
  alignItems: "center",
  display: "flex",
  flexWrap: "wrap",
  gap: 7,
} satisfies CSSProperties

const catalogBadgeStyle = {
  background: HUD_LABEL_BG,
  border: `1px solid ${HUD_LINE_SOFT}`,
  borderRadius: 999,
  color: HUD_TEXT,
  fontSize: 12,
  fontWeight: 800,
  lineHeight: 1,
  padding: "6px 8px",
} satisfies CSSProperties

const catalogActionButtonStyle = {
  ...toolbarButtonStyle,
  color: HUD_RED,
  height: 28,
  padding: "0 10px",
} satisfies CSSProperties

const catalogSelectedGridStyle = {
  display: "grid",
  gap: 8,
  gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
  padding: 12,
} satisfies CSSProperties

const catalogInfoCellStyle = {
  background: HUD_TABLE_CELL,
  border: `1px solid ${HUD_LINE_SOFT}`,
  borderRadius: 6,
  display: "grid",
  gap: 5,
  minHeight: 58,
  padding: "8px 9px",
} satisfies CSSProperties

const catalogInfoLabelStyle = {
  color: HUD_DIM,
  fontSize: 11,
  fontWeight: 800,
} satisfies CSSProperties

const catalogInfoValueStyle = {
  fontSize: 12,
  lineHeight: 1.45,
  overflowWrap: "anywhere",
  whiteSpace: "pre-wrap",
} satisfies CSSProperties

const catalogDetailsStyle = {
  borderTop: `1px solid ${HUD_LINE_SOFT}`,
} satisfies CSSProperties

const catalogDetailsSummaryStyle = {
  color: HUD_CYAN,
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 800,
  padding: "10px 12px",
} satisfies CSSProperties

const catalogCandidateWrapStyle = {
  maxHeight: 340,
  overflow: "auto",
  scrollbarColor: `${HUD_SCROLLBAR} transparent`,
} satisfies CSSProperties

const catalogCandidateTableStyle = {
  borderCollapse: "collapse",
  minWidth: 1262,
  tableLayout: "fixed",
  width: "100%",
} satisfies CSSProperties

const catalogCandidateCellStyle = {
  background: HUD_TABLE_CELL,
  border: `1px solid ${HUD_LINE_SOFT}`,
  color: HUD_TEXT,
  fontSize: 12,
  lineHeight: 1.45,
  overflowWrap: "anywhere",
  padding: "8px",
  verticalAlign: "top",
  whiteSpace: "pre-wrap",
} satisfies CSSProperties

const catalogNoCandidateStyle = {
  color: HUD_DIM,
  padding: "0 12px 14px",
} satisfies CSSProperties

const emptyCellStyle = {
  color: HUD_DIM,
  padding: 24,
  textAlign: "center",
} satisfies CSSProperties

const optionStyle = {
  background: HUD_OPTION_BG,
  color: HUD_TEXT,
} satisfies CSSProperties
