import { useCallback, useEffect, useMemo, useState } from "react"
import type { CSSProperties } from "react"

type JsonRow = Record<string, unknown>

type DeratingPayload = {
  components?: JsonRow[]
  rows?: JsonRow[]
  source_relative_path?: string
  summary?: Record<string, unknown>
}

type DeratingMissingItemsPanelProps = {
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
  { key: "允许值判定组合", label: "允许值 ▸ AI判定", width: 160 },
  { key: "实际值判定组合", label: "实际值 ▸ AI判定", width: 160 },
  { key: "降额因子判定组合", label: "降额因子_规定 ▸ AI判定", width: 190 },
  { key: "实际降额因子判定组合", label: "实际降额因子 ▸ AI判定", width: 190 },
  { key: "判定结果", label: "判定结果", width: 142 },
  { key: "综合判定详情", label: "综合判定详情", width: 260 },
] as const

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

function csvEscape(value: unknown) {
  const text = asText(value)
  return /[",\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text
}

function issueText(row: JsonRow) {
  const issues = Array.isArray(row["问题"]) ? row["问题"] : []
  return issues.map(asText).filter(Boolean).join("；")
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
  const [missingRows, setMissingRows] = useState<JsonRow[]>([])
  const [resultRows, setResultRows] = useState<JsonRow[]>([])
  const [finalRows, setFinalRows] = useState<JsonRow[]>([])
  const [missingSourcePath, setMissingSourcePath] = useState("")
  const [resultSourcePath, setResultSourcePath] = useState("")
  const [status, setStatus] = useState("加载中...")
  const [savingResults, setSavingResults] = useState(false)
  const [finalGenerated, setFinalGenerated] = useState(false)
  const query = useMemo(() => buildWorkspaceQuery(props), [props.versionId, props.workspaceDir, props.workspaceId])

  const loadAll = useCallback(() => {
    setStatus("加载中...")
    Promise.allSettled([
      fetch(`/api/workspace/derating/missing-items${query}`, { cache: "no-store" }).then(async response => {
        const data = await response.json().catch(() => null) as DeratingPayload | { error?: string } | null
        if (!response.ok) throw new Error(data && "error" in data && data.error ? data.error : "缺项 JSON 不可用")
        return data as DeratingPayload
      }),
      fetch(`/api/workspace/derating/check-result${query}`, { cache: "no-store" }).then(async response => {
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

  const confirmAndGenerateFinal = () => {
    setSavingResults(true)
    fetch(`/api/workspace/derating/check-result${query}`, {
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

  return (
    <div style={pageStyle}>
      <div style={topbarStyle}>
        <strong>降额检查</strong>
        <span>降额清单：</span>
        <select style={selectStyle} disabled><option>{resultSourcePath || "input_check_result.json"}</option></select>
        <span>元器件清单：</span>
        <select style={selectStyle} disabled><option>{missingSourcePath || "input_mapping_completeness.json"}</option></select>
        <button type="button" onClick={loadAll} style={toolbarButtonStyle}>重新开始</button>
        <span style={{ color: "#6b7280", marginLeft: "auto" }}>{status}</span>
      </div>

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
              <span style={{ color: "#2563eb", fontWeight: 700 }}>可直接点击单元格编辑判定内容</span>
            </div>
            <EditableTable
              columns={RESULT_COLUMNS}
              emptyText={resultSourcePath || "暂无校验结果数据"}
              getValue={getResultValue}
              onChange={updateResultCell}
              rows={resultRows}
              selectColumns={{ 判定结果: ["符合", "不符合"] }}
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
              <span style={{ color: "#6b7280" }}>{finalGenerated ? "已生成降额总表，可下载 CSV。" : "点击步骤2“确认并生成降额总表”后生成。"}</span>
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
    </div>
  )
}

function EditableTable({
  columns,
  emptyText,
  getValue,
  onChange,
  readOnly = false,
  rows,
  selectColumns = {},
}: {
  columns: readonly { key: string; label: string; width: number }[]
  emptyText: string
  getValue: (row: JsonRow, key: string) => unknown
  onChange?: (rowIndex: number, key: string, value: string) => void
  readOnly?: boolean
  rows: JsonRow[]
  selectColumns?: Record<string, string[]>
}) {
  return (
    <div style={tableWrapStyle}>
      <table style={{ borderCollapse: "collapse", minWidth: Math.max(980, columns.reduce((total, column) => total + column.width, 76)), tableLayout: "fixed", width: "100%" }}>
        <thead>
          <tr>
            {columns.map(column => (
              <th key={column.key} style={{ ...headerCellStyle, width: column.width }}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`${asText(row["元器件名称"])}-${rowIndex}`}>
              {columns.map(column => {
                const value = asText(getValue(row, column.key))
                const isWarning = column.key.includes("判定") || column.key === "missing_standard_parameters"
                const options = selectColumns[column.key]
                return (
                  <td key={column.key} style={bodyCellStyle}>
                    {options ? (
                      <select
                        value={options.includes(value) ? value : value === "符合" ? "符合" : "不符合"}
                        onChange={event => onChange?.(rowIndex, column.key, event.target.value)}
                        style={{
                          ...selectCellStyle,
                          color: value === "符合" ? "#059669" : "#ef4444",
                        }}
                      >
                        {options.map(option => <option key={option} value={option}>{option}</option>)}
                      </select>
                    ) : readOnly ? (
                      <div style={{
                        ...readOnlyCellStyle,
                        color: isWarning && value && value !== "符合" ? "#ef4444" : "#111827",
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
                          color: isWarning && value && value !== "符合" ? "#ef4444" : "#111827",
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
              <td colSpan={columns.length} style={{ color: "#6b7280", padding: 24, textAlign: "center" }}>
                {emptyText}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  )
}

function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

const greenText = { color: "#059669" }
const redText = { color: "#ef4444" }

const pageStyle = {
  background: "#f5f6f8",
  color: "#111827",
  height: "100%",
  overflow: "auto",
  padding: "16px",
} satisfies CSSProperties

const topbarStyle = {
  alignItems: "center",
  borderBottom: "1px solid #d9dde4",
  display: "flex",
  gap: 10,
  minHeight: 44,
  paddingBottom: 12,
} satisfies CSSProperties

const selectStyle = {
  background: "#eef0f3",
  border: "1px solid #d1d5db",
  borderRadius: 4,
  color: "#6b7280",
  height: 28,
  minWidth: 260,
  padding: "0 8px",
} satisfies CSSProperties

const sectionStyle = {
  background: "#fff",
  border: "1px solid #d9dde4",
  marginTop: 14,
} satisfies CSSProperties

const summaryStyle = {
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 800,
  padding: "12px 14px",
} satisfies CSSProperties

const sectionBodyStyle = {
  background: "#f3f4f6",
  borderTop: "1px solid #d9dde4",
  padding: "12px 14px",
} satisfies CSSProperties

const metricsStyle = {
  display: "grid",
  fontSize: 13,
  gap: 5,
  lineHeight: 1.45,
  marginBottom: 10,
} satisfies CSSProperties

const tableWrapStyle = {
  background: "#fff",
  border: "1px solid #d9dde4",
  maxHeight: 360,
  minHeight: 0,
  overflow: "auto",
} satisfies CSSProperties

const actionsStyle = {
  display: "flex",
  gap: 10,
  justifyContent: "flex-end",
  paddingTop: 10,
} satisfies CSSProperties

const toolbarButtonStyle = {
  background: "#ffffff",
  border: "1px solid #cfd6e1",
  borderRadius: 4,
  color: "#111827",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 700,
  height: 32,
  padding: "0 12px",
} satisfies CSSProperties

const primaryButtonStyle = {
  ...toolbarButtonStyle,
  background: "#0b63ce",
  border: "1px solid #0b63ce",
  color: "#ffffff",
} satisfies CSSProperties

const headerCellStyle = {
  background: "#eef0f3",
  border: "1px solid #d9dde4",
  color: "#6b7280",
  fontSize: 12,
  fontWeight: 700,
  padding: "9px 8px",
  textAlign: "left",
} satisfies CSSProperties

const bodyCellStyle = {
  border: "1px solid #e1e5ea",
  fontSize: 12,
  padding: 0,
  verticalAlign: "top",
} satisfies CSSProperties

const cellInputStyle = {
  background: "transparent",
  border: 0,
  boxSizing: "border-box",
  color: "#111827",
  display: "block",
  font: "inherit",
  lineHeight: 1.45,
  outline: "none",
  padding: "8px",
  resize: "vertical",
  width: "100%",
} satisfies CSSProperties

const readOnlyCellStyle = {
  boxSizing: "border-box",
  lineHeight: 1.45,
  minHeight: 34,
  padding: "8px",
  whiteSpace: "pre-wrap",
  width: "100%",
  wordBreak: "break-word",
} satisfies CSSProperties

const selectCellStyle = {
  background: "#ffffff",
  border: "1px solid #d1d5db",
  borderRadius: 4,
  boxSizing: "border-box",
  font: "inherit",
  fontWeight: 800,
  height: 32,
  margin: 6,
  outline: "none",
  padding: "0 8px",
  width: "calc(100% - 12px)",
} satisfies CSSProperties
