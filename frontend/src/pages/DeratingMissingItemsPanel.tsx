import { useCallback, useEffect, useMemo, useState } from "react"
import type { CSSProperties } from "react"
import { joinApiPath } from "../app/apiBase"

type JsonRow = Record<string, unknown>

type DeratingPayload = {
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

type DeratingThemeVars = CSSProperties & Record<`--derating-${string}`, string>

type DeratingMissingItemsPanelProps = {
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
  { key: "序号", label: "序号", width: 70 },
  { key: "元器件名称", label: "器件名称", width: 130 },
  { key: "型号规格_规格", label: "型号规格", width: 130 },
  { key: "降额参数", label: "降额参数", width: 118 },
  { key: "参数值_额定", label: "额定值", width: 92 },
  { key: "AI分类", label: "AI分类（新）", width: 180 },
  { key: "I级降额公式", label: "I级降额公式（新）", width: 150 },
  { key: "允许值判定组合", label: "允许值 / AI判定", width: 220 },
  { key: "实际值判定组合", label: "实际值 / AI判定", width: 220 },
  { key: "降额因子判定组合", label: "降额因子_规定 / AI判定", width: 230 },
  { key: "实际降额因子判定组合", label: "实际降额因子 / AI判定", width: 230 },
  { key: "判定结果", label: "判定结果", width: 142 },
  { key: "综合判定详情", label: "综合判定详情", width: 260 },
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
    description: "展示器件分类结果，可直接调整大类和类别。",
    emptyText: "暂无器件分类数据",
    key: "classification",
    title: "器件分类",
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
      { key: "reason", label: "依据", width: 220 },
      { key: "status", label: "状态", width: 110 },
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
] as const

type ComplianceTab = typeof COMPLIANCE_TABS[number]
type ActiveTabKey = "derating" | ComplianceTab["key"]

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

function buildWorkspaceQuery({ versionId, workspaceDir, workspaceId }: DeratingMissingItemsPanelProps) {
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

function csvEscape(value: unknown) {
  const text = asText(value)
  return /[",\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text
}

function issueText(row: JsonRow) {
  const issues = Array.isArray(row["问题"]) ? row["问题"] : []
  return issues.map(asText).filter(Boolean).join("；")
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

function passCount(rows: JsonRow[]) {
  return rows.filter(row => statusText(row) === "符合").length
}

function problemCount(rows: JsonRow[]) {
  return rows.filter(row => statusText(row) !== "符合").length
}

function getResultValue(row: JsonRow, key: string) {
  if (key === "序号") return row["序号"] ?? row["excel_row"]
  if (key === "AI分类") return asText(row["AI分类"]) || [row["元器件大类"], row["元器件子类"]].map(asText).filter(Boolean).join("-")
  if (key === "I级降额公式") return asText(row["I级降额公式"]) || asText(row["标准I级降额"])
  if (key === "允许值判定组合") return asText(row["允许值判定组合"]) || [row["参数值_允许"], row["允许值判定"]].map(asText).filter(Boolean).join(" ▸ ")
  if (key === "实际值判定组合") return asText(row["实际值判定组合"]) || [row["参数值_实际"], row["实际值判定"]].map(asText).filter(Boolean).join(" ▸ ")
  if (key === "降额因子判定组合") return asText(row["降额因子判定组合"]) || [row["降额因子_规定"], row["降额因子判定"]].map(asText).filter(Boolean).join(" ▸ ")
  if (key === "实际降额因子判定组合") return asText(row["实际降额因子判定组合"]) || [row["降额因子_实际"], row["实际降额因子判定"]].map(asText).filter(Boolean).join(" ▸ ")
  if (key === "判定结果") return statusText(row)
  if (key === "综合判定详情") return asText(row["综合判定详情"]) || issueText(row)
  return row[key]
}

function getComparisonValue(row: JsonRow, key: string) {
  const comparison = COMPARISON_COLUMNS[key]
  if (!comparison) return null

  const combined = asText(row[key]).split("▸").map(part => part.trim()).filter(Boolean)
  return {
    aiValue: asText(row[comparison.aiKey]) || combined[1] || deriveComparisonJudgement(row, key),
    tableLabel: comparison.tableLabel,
    tableValue: asText(row[comparison.tableKey]) || combined[0] || "",
  }
}

function deriveComparisonJudgement(row: JsonRow, key: string) {
  if (key === "允许值判定组合") {
    if (hasIssue(row, /允许值不等于|允许值.*错误|允许值.*填写错误/u)) {
      const expected = valueWithSourceUnit(row["计算允许值"], row["参数值_允许"])
      return expected ? `表中填写错误，应为 ${expected}` : "表中填写错误"
    }
    return "正确"
  }

  if (key === "实际值判定组合") {
    if (hasIssue(row, /实际值大于允许值|实际值.*错误|实际值.*不符合/u)) return "实际值大于允许值"
    return "正确"
  }

  if (key === "降额因子判定组合") {
    if (hasIssue(row, /规定降额因子大于|规定降额因子.*标准值/u)) return "规定降额因子大于 I 级标准值"
    if (hasIssue(row, /规定降额因子小于|更严格/u)) return "规定降额因子更严格"
    return "正确"
  }

  if (key === "实际降额因子判定组合") {
    if (hasIssue(row, /实际降额因子大于规定降额因子/u)) return "实际降额因子大于规定降额因子"
    return "正确"
  }

  return ""
}

function isPositiveJudgement(value: string) {
  return /^(符合|正确|正常|通过|ok|pass)$/iu.test(value.trim())
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

function normalizeComplianceRow(row: JsonRow) {
  const selectedCandidate = isJsonRecord(row.selected_candidate) ? row.selected_candidate : null
  const firstCandidate = Array.isArray(row.candidates) && isJsonRecord(row.candidates[0]) ? row.candidates[0] : null
  const name = row.component_name ?? row.name ?? row["元器件名称"]
  const manufacturer = row.manufacturer ?? row.normalized_manufacturer ?? row["生产厂商"]
  const status = row.status ?? row.result ?? row.match_status ?? row.compliance_status ?? row["状态"] ?? row["目录内或外"] ?? row.is_in_catalog
  return {
    ...row,
    catalog_manufacturer: row.catalog_manufacturer ?? selectedCandidate?.catalog_manufacturer ?? firstCandidate?.catalog_manufacturer ?? "",
    catalog_model: row.catalog_model ?? selectedCandidate?.catalog_model ?? firstCandidate?.catalog_model ?? "",
    component_name: name,
    manufacturer,
    model: row.model ?? row["型号规格"],
    status,
  }
}

function isJsonRecord(value: unknown): value is JsonRow {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function getComplianceValue(row: JsonRow, key: string) {
  if (key === "catalog_model") {
    const selectedCandidate = isJsonRecord(row.selected_candidate) ? row.selected_candidate : null
    const firstCandidate = Array.isArray(row.candidates) && isJsonRecord(row.candidates[0]) ? row.candidates[0] : null
    return row.catalog_model ?? selectedCandidate?.catalog_model ?? firstCandidate?.catalog_model ?? "无"
  }
  if (key === "catalog_manufacturer") {
    const selectedCandidate = isJsonRecord(row.selected_candidate) ? row.selected_candidate : null
    const firstCandidate = Array.isArray(row.candidates) && isJsonRecord(row.candidates[0]) ? row.candidates[0] : null
    return row.catalog_manufacturer ?? selectedCandidate?.catalog_manufacturer ?? firstCandidate?.catalog_manufacturer ?? "无"
  }
  return row[key]
}

function complianceStatusCounts(rows: JsonRow[]) {
  const issue = rows.filter(row => {
    const status = asText(row.status ?? row["目录内或外"] ?? row.is_in_catalog ?? row["是否满足要求"])
    return status && !isPositiveJudgement(status)
  }).length
  return { issue, ok: rows.length - issue }
}

function buildFinalRows(rows: JsonRow[], missingRows: JsonRow[]) {
  return rows.map(row => {
    const component = missingRows.find(item => asText(item["元器件名称"]) === asText(row["元器件名称"]))
    return Object.fromEntries(RESULT_CSV_COLUMNS.map(([key, label]) => {
      if (key === "缺少降额项") return [label, component?.missing_standard_parameters ?? ""]
      if (key === "综合判定") return [label, statusText(row)]
      if (key === "备注") return [label, issueText(row)]
      return [label, row[key]]
    }))
  })
}

export function DeratingMissingItemsPanel(props: DeratingMissingItemsPanelProps) {
  const [activeTab, setActiveTab] = useState<ActiveTabKey>("derating")
  const [missingRows, setMissingRows] = useState<JsonRow[]>([])
  const [resultRows, setResultRows] = useState<JsonRow[]>([])
  const [finalRows, setFinalRows] = useState<JsonRow[]>([])
  const [complianceRows, setComplianceRows] = useState<Record<string, JsonRow[]>>({})
  const [complianceSources, setComplianceSources] = useState<Record<string, string>>({})
  const [missingSourcePath, setMissingSourcePath] = useState("")
  const [resultSourcePath, setResultSourcePath] = useState("")
  const [status, setStatus] = useState("加载中...")
  const [savingResults, setSavingResults] = useState(false)
  const [savingCompliance, setSavingCompliance] = useState("")
  const [finalGenerated, setFinalGenerated] = useState(false)
  const query = useMemo(() => buildWorkspaceQuery(props), [props.versionId, props.workspaceDir, props.workspaceId])
  const themeVars = props.theme === "light" ? lightThemeVars : darkThemeVars

  const loadAll = useCallback(() => {
    setStatus("加载中...")
    Promise.allSettled([
      fetch(buildWorkspaceApiPath("/workspace/derating/missing-items", query), { cache: "no-store" }).then(async response => {
        const data = await response.json().catch(() => null) as DeratingPayload | { error?: string } | null
        if (!response.ok) throw new Error(data && "error" in data && data.error ? data.error : "缺项 JSON 不可用")
        return data as DeratingPayload
      }),
      fetch(buildWorkspaceApiPath("/workspace/derating/check-result", query), { cache: "no-store" }).then(async response => {
        const data = await response.json().catch(() => null) as DeratingPayload | { error?: string } | null
        if (!response.ok) throw new Error(data && "error" in data && data.error ? data.error : "校验结果 JSON 不可用")
        return data as DeratingPayload
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

      setStatus("")
    }).catch(error => {
      setStatus(error instanceof Error ? error.message : "加载失败")
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
  }, [query])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  const missingSummary = useMemo(() => {
    const componentCount = missingRows.length
    const missingCount = missingRows.filter(row => Number(row.missing_count ?? 0) > 0).length
    const unmatchedCount = missingRows.filter(row => !asText(row["元器件大类"]) || !asText(row["元器件子类"])).length
    return {
      completeCount: Math.max(0, componentCount - missingCount - unmatchedCount),
      componentCount,
      missingCount,
      unmatchedCount,
    }
  }, [missingRows])

  const updateResultCell = (rowIndex: number, key: string, value: string) => {
    setResultRows(previous => previous.map((row, index) => index === rowIndex ? writeResultValue(row, key, value) : row))
    setFinalGenerated(false)
  }

  const updateComplianceCell = (tabKey: string, rowIndex: number, key: string, value: string) => {
    setComplianceRows(previous => ({
      ...previous,
      [tabKey]: (previous[tabKey] ?? []).map((row, index) => index === rowIndex ? { ...row, [key]: value } : row),
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
        const data = await response.json().catch(() => null) as DeratingPayload | { error?: string } | null
        if (!response.ok) throw new Error(data && "error" in data && data.error ? data.error : "保存失败")
        const payload = data as DeratingPayload
        const savedRows = Array.isArray(payload.rows) ? payload.rows : resultRows
        setResultRows(savedRows)
        setFinalRows(buildFinalRows(savedRows, missingRows))
        setFinalGenerated(true)
      })
      .catch(error => setStatus(error instanceof Error ? error.message : "保存失败"))
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
      .catch(error => setStatus(error instanceof Error ? error.message : "保存失败"))
      .finally(() => setSavingCompliance(""))
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
            <EditableTable
              columns={tab.columns}
              emptyText={complianceSources[tab.key] || tab.emptyText}
              getValue={getComplianceValue}
              onChange={(rowIndex, key, value) => updateComplianceCell(tab.key, rowIndex, key, value)}
              rows={rows}
              selectColumns={{
                "国产/进口": ["国产", "进口", "无"],
                "目录内或外": ["目录内", "目录外", "无"],
                is_key_part: ["true", "false"],
                is_in_catalog: ["目录内", "目录外", "未提供目录", "无"],
                status: ["符合", "不符合", "需确认"],
              }}
              stickyRightColumns={tab.key === "manufacturer" ? ["目录内或外"] : tab.key === "catalog" ? ["is_in_catalog"] : ["status"]}
            />
            <div style={actionsStyle}>
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
      <div style={topbarStyle}>
        <strong>合规检查</strong>
        <span style={statusTextStyle}>{status}</span>
      </div>

      <div style={tabsStyle}>
        <button type="button" onClick={() => setActiveTab("derating")} style={tabButtonStyle(activeTab === "derating")}>降额检查</button>
        {COMPLIANCE_TABS.map(tab => (
          <button key={tab.key} type="button" onClick={() => setActiveTab(tab.key)} style={tabButtonStyle(activeTab === tab.key)}>{tab.title}</button>
        ))}
      </div>

      {activeTab === "derating" ? (
        <>
          <section style={sectionStyle}>
        <details open>
          <summary style={summaryStyle}>步骤1：降额缺项分析（各器件降额项完整性检查）</summary>
          <div style={sectionBodyStyle}>
            <div style={metricsStyle}>
              <span>元器件清单覆盖性：清单中 <b>{missingSummary.componentCount}</b> 个器件，<b style={greenText}>0</b> 个在降额表中有对应项，<b style={redText}>0</b> 个未在降额表覆盖</span>
              <span>降额表缺项完整性：降额表中 <b>{missingSummary.componentCount}</b> 个器件，<b style={redText}>{missingSummary.missingCount}</b> 个存在缺项，<b style={redText}>{missingSummary.unmatchedCount}</b> 个未找到分类，<b style={greenText}>{missingSummary.completeCount}</b> 个完整</span>
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
              <span>共 <b>{resultRows.length}</b> 行 · <b style={greenText}>✔ {passCount(resultRows)} 通过</b> · <b style={redText}>✕ {problemCount(resultRows)} 问题</b></span>
              <span style={hintTextStyle}>可直接点击单元格编辑判定内容</span>
            </div>
            <EditableTable
              columns={RESULT_COLUMNS}
              emptyText={resultSourcePath || "暂无校验结果数据"}
              getValue={getResultValue}
              onChange={updateResultCell}
              rows={resultRows}
              selectColumns={{ 判定结果: ["符合", "不符合"] }}
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
              <span>根据步骤2当前确认结果生成：共 <b>{finalRows.length}</b> 行 · <b style={greenText}>{passCount(finalRows)} 通过</b> · <b style={redText}>{problemCount(finalRows)} 问题</b></span>
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
    </div>
  )
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
      <table style={{ borderCollapse: "collapse", minWidth: Math.max(980, columns.reduce((total, column) => total + column.width, 76)), tableLayout: "fixed", width: "100%" }}>
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
                const comparison = getComparisonValue(row, column.key)
                const options = selectColumns[column.key]
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
                        value={options.includes(value) ? value : value === "符合" ? "符合" : "不符合"}
                        onChange={event => onChange?.(rowIndex, column.key, event.target.value)}
                        style={{
                          ...selectCellStyle,
                          color: value === "符合" ? HUD_GREEN : HUD_RED,
                        }}
                      >
                        {options.map(option => <option key={option} value={option} style={optionStyle}>{option}</option>)}
                      </select>
                    ) : readOnly ? (
                      <div style={{
                        ...readOnlyCellStyle,
                        color: isWarning && value && value !== "符合" ? HUD_RED : HUD_TEXT,
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
                          color: isWarning && value && value !== "符合" ? HUD_RED : HUD_TEXT,
                          fontWeight: isWarning ? 700 : 600,
                          minHeight: value.length > 28 ? 46 : 34,
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
    zIndex: header ? 5 : 3,
  }
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
          <span style={{ ...comparisonValueStyle, color: tableTone === "bad" ? HUD_RED : HUD_TEXT }}>{tableValue || "-"}</span>
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
          value={tableValue}
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
const HUD_PAGE_TOP = "var(--derating-page-top)"
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
  "--derating-bg": "#06111d",
  "--derating-control-bg": "rgba(2, 8, 16, 0.72)",
  "--derating-cyan": "#17e7ff",
  "--derating-dim": "rgba(234, 247, 255, 0.42)",
  "--derating-green": "#38f8b7",
  "--derating-input-bg": "rgba(2, 8, 16, 0.16)",
  "--derating-label-bg": "transparent",
  "--derating-line": "rgba(23, 231, 255, 0.18)",
  "--derating-line-soft": "rgba(23, 231, 255, 0.1)",
  "--derating-muted": "rgba(234, 247, 255, 0.62)",
  "--derating-option-bg": "#06111d",
  "--derating-page-top": "rgba(2, 8, 16, 0.96)",
  "--derating-panel": "rgba(4, 18, 32, 0.82)",
  "--derating-panel-soft": "rgba(7, 24, 40, 0.74)",
  "--derating-primary-bg": "linear-gradient(90deg, rgba(0, 168, 255, 0.48), rgba(23, 231, 255, 0.22))",
  "--derating-primary-border": "rgba(23, 231, 255, 0.62)",
  "--derating-primary-shadow": "0 0 18px rgba(0, 168, 255, 0.16)",
  "--derating-primary-text": "#f4fbff",
  "--derating-red": "#ff7b8c",
  "--derating-scrollbar": "rgba(23, 231, 255, 0.42)",
  "--derating-section-shadow": "inset 0 0 22px rgba(0, 168, 255, 0.06)",
  "--derating-sticky-shadow": "rgba(0, 0, 0, 0.28)",
  "--derating-table-bg": "rgba(2, 8, 16, 0.64)",
  "--derating-table-cell": "rgba(3, 13, 24, 0.96)",
  "--derating-table-header": "rgba(10, 35, 56, 0.98)",
  "--derating-table-header-text": "rgba(234, 247, 255, 0.72)",
  "--derating-text": "#eaf7ff",
} satisfies DeratingThemeVars

const lightThemeVars = {
  "--derating-bg": "#f6f8fb",
  "--derating-control-bg": "#ffffff",
  "--derating-cyan": "#0066cc",
  "--derating-dim": "#7b8794",
  "--derating-green": "#0f7f56",
  "--derating-input-bg": "rgba(255, 255, 255, 0.86)",
  "--derating-label-bg": "#f3f7fb",
  "--derating-line": "rgba(35, 82, 124, 0.16)",
  "--derating-line-soft": "rgba(35, 82, 124, 0.1)",
  "--derating-muted": "#596574",
  "--derating-option-bg": "#ffffff",
  "--derating-page-top": "#fbfcfe",
  "--derating-panel": "rgba(255, 255, 255, 0.92)",
  "--derating-panel-soft": "rgba(248, 251, 255, 0.92)",
  "--derating-primary-bg": "#0066cc",
  "--derating-primary-border": "#0066cc",
  "--derating-primary-shadow": "0 8px 18px rgba(0, 102, 204, 0.18)",
  "--derating-primary-text": "#ffffff",
  "--derating-red": "#b42318",
  "--derating-scrollbar": "rgba(0, 102, 204, 0.28)",
  "--derating-section-shadow": "0 12px 32px rgba(18, 34, 51, 0.06)",
  "--derating-sticky-shadow": "rgba(18, 34, 51, 0.12)",
  "--derating-table-bg": "#ffffff",
  "--derating-table-cell": "#ffffff",
  "--derating-table-header": "#eef6ff",
  "--derating-table-header-text": "#344054",
  "--derating-text": "#1f2937",
} satisfies DeratingThemeVars

const greenText = { color: HUD_GREEN }
const redText = { color: HUD_RED }
const mutedTextStyle = { color: HUD_MUTED } satisfies CSSProperties
const hintTextStyle = { color: HUD_CYAN, fontWeight: 800 } satisfies CSSProperties
const statusTextStyle = { color: HUD_MUTED, marginLeft: "auto" } satisfies CSSProperties

const pageStyle = {
  background: `linear-gradient(180deg, ${HUD_PAGE_TOP} 0%, ${HUD_BG} 100%)`,
  color: HUD_TEXT,
  height: "100%",
  overflow: "auto",
  padding: "16px",
} satisfies CSSProperties

const topbarStyle = {
  alignItems: "center",
  borderBottom: `1px solid ${HUD_LINE}`,
  display: "flex",
  gap: 10,
  minHeight: 44,
  paddingBottom: 12,
  flexWrap: "wrap",
} satisfies CSSProperties

const tabsStyle = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  marginTop: 14,
} satisfies CSSProperties

function tabButtonStyle(active: boolean): CSSProperties {
  return {
    background: active ? HUD_PRIMARY_BG : HUD_CONTROL_BG,
    border: `1px solid ${active ? HUD_PRIMARY_BORDER : HUD_LINE}`,
    borderRadius: 6,
    boxShadow: active ? HUD_PRIMARY_SHADOW : "none",
    color: active ? HUD_PRIMARY_TEXT : HUD_TEXT,
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 800,
    height: 34,
    padding: "0 12px",
  }
}

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
  background: HUD_CONTROL_BG,
  border: `1px solid ${HUD_LINE}`,
  borderRadius: 6,
  boxSizing: "border-box",
  font: "inherit",
  fontWeight: 800,
  height: 32,
  margin: 6,
  outline: "none",
  padding: "0 8px",
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

const emptyCellStyle = {
  color: HUD_DIM,
  padding: 24,
  textAlign: "center",
} satisfies CSSProperties

const optionStyle = {
  background: HUD_OPTION_BG,
  color: HUD_TEXT,
} satisfies CSSProperties
