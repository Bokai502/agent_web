import { useCallback, useEffect, useMemo, useState } from "react"
import { joinApiPath } from "../../app/apiBase"
import "./CatchSupportingTableEditor.css"
import { HeatfluxSelector } from "./HeatfluxSelector"
import type { WorkspaceVersionContext } from "./workspaceVersion"

const COLUMNS = ["产品名称", "重量（Kg）", "包络尺寸（mm）", "稳态功耗（W）", "峰值功耗（W）", "工作温度（℃）", "配套单位"] as const
const RESULT_COLUMNS = ["热仿真温度（℃）"] as const
const TARGET_MASS_KG = 44

type CatchTableColumn = typeof COLUMNS[number]
type CatchResultColumn = typeof RESULT_COLUMNS[number]
type CatchTableRow = {
  id?: string
  row?: number
} & Partial<Record<CatchTableColumn, string | number | null>> & Partial<Record<CatchResultColumn, string | number | null>> & {
  "热仿真温度平均（℃）"?: number | null
  "热仿真温度最低（℃）"?: number | null
  "热仿真温度最高（℃）"?: number | null
  "热仿真温度状态"?: "in_range" | "high" | "low" | "missing" | "no_range"
  "热仿真温度组件ID"?: string | null
  "热仿真温度样本数"?: number | null
}

type CatchTableResponse = {
  generation?: {
    component_count?: number
    output_dir?: string
  }
  rows?: CatchTableRow[]
  source_path?: string
  source_version?: string
  table?: {
    rows?: CatchTableRow[]
  }
}

type CatchSupportingTableEditorProps = {
  activeContext: WorkspaceVersionContext
  apiBase?: string
  onSaved?: () => void
}

type RowView = {
  baseline?: CatchTableRow
  changed: boolean
  index: number
  row: CatchTableRow
  subsystem: string
  subsystemRow: boolean
}

function buildQuery(activeContext: WorkspaceVersionContext) {
  const params = new URLSearchParams()
  if (activeContext.versionDir) params.set("workspaceDir", activeContext.versionDir)
  if (activeContext.workspaceId) params.set("workspaceId", activeContext.workspaceId)
  if (activeContext.versionId) params.set("versionId", activeContext.versionId)
  const query = params.toString()
  return query ? `?${query}` : ""
}

function normalizeRows(rows: CatchTableRow[]) {
  return rows
    .filter(row => !isSummaryRow(row))
    .map((row, index) => ({ ...row, id: row.id ?? `r${row.row ?? index + 1}` }))
}

function isSubsystemRow(row: CatchTableRow) {
  const name = String(row["产品名称"] ?? "")
  return name.endsWith("分系统")
}

function isSummaryRow(row: CatchTableRow) {
  const name = String(row["产品名称"] ?? "").trim()
  const size = String(row["包络尺寸（mm）"] ?? "").trim()
  return name === "整星质量" || name === "整星" || (!name && size === "整星") || (name === "整星质量" && size === "平台")
}

function rowSearchText(row: CatchTableRow) {
  return COLUMNS.map(column => row[column] == null ? "" : String(row[column])).join(" ").toLowerCase()
}

function toNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value !== "string") return 0
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function cellValue(row: CatchTableRow | undefined, column: CatchTableColumn) {
  const value = row?.[column]
  return value == null ? "" : String(value)
}

function resultCellValue(row: CatchTableRow | undefined, column: CatchResultColumn) {
  const value = row?.[column]
  return value == null || value === "" ? "无结果" : String(value)
}

function isCellChanged(row: CatchTableRow, baseline: CatchTableRow | undefined, column: CatchTableColumn) {
  return cellValue(row, column) !== cellValue(baseline, column)
}

function isRowChanged(row: CatchTableRow, baseline: CatchTableRow | undefined) {
  if (!baseline) return true
  return COLUMNS.some(column => isCellChanged(row, baseline, column))
}

function rowKey(row: CatchTableRow) {
  return row.id ? String(row.id) : row.row == null ? "" : `r${row.row}`
}

function getStatusTone(status: string) {
  return /失败|异常|错误|error/i.test(status) ? "bad" : /保存|加载|已|完成/.test(status) ? "ok" : "neutral"
}

function formatNumber(value: number, digits = 2) {
  if (!Number.isFinite(value)) return "-"
  return value.toFixed(digits).replace(/\.?0+$/u, "")
}

function findInsertIndex(rowViews: RowView[], subsystem: string) {
  if (subsystem === "全部") return rowViews.length
  let insertIndex = rowViews.length
  for (const view of rowViews) {
    if (view.subsystem === subsystem) insertIndex = view.index + 1
    if (insertIndex !== rowViews.length && view.subsystem !== subsystem) break
  }
  return insertIndex
}

function temperatureCellClass(row: CatchTableRow) {
  const status = row["热仿真温度状态"] ?? "missing"
  return `catch-temperature-cell is-${status}`
}

export function CatchSupportingTableEditor({ activeContext, apiBase, onSaved }: CatchSupportingTableEditorProps) {
  const [rows, setRows] = useState<CatchTableRow[]>([])
  const [baselineRows, setBaselineRows] = useState<CatchTableRow[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState("准备读取 CATCH 整星配套表")
  const [search, setSearch] = useState("")
  const [subsystemFilter, setSubsystemFilter] = useState("全部")
  const [changedOnly, setChangedOnly] = useState(false)

  const query = useMemo(() => buildQuery(activeContext), [activeContext.versionDir, activeContext.versionId, activeContext.workspaceId])
  const baselineByKey = useMemo(() => new Map(baselineRows.map(row => [rowKey(row), row])), [baselineRows])

  const loadTable = useCallback(() => {
    if (!activeContext.versionDir) return
    setLoading(true)
    setStatus("正在读取 CATCH 整星配套表")
    fetch(`${joinApiPath(apiBase, "/workspace/catch-supporting-table")}${query}`, { cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? "读取 CATCH 配套表失败")
        return response.json() as Promise<CatchTableResponse>
      })
      .then(data => {
        const nextRows = normalizeRows(data.rows ?? [])
        setRows(nextRows)
        setBaselineRows(nextRows)
        setStatus("配套表已加载")
      })
      .catch(error => setStatus(error instanceof Error ? error.message : "读取 CATCH 配套表失败"))
      .finally(() => setLoading(false))
  }, [activeContext.versionDir, apiBase, query])

  useEffect(() => {
    loadTable()
  }, [loadTable])

  const rowViews = useMemo<RowView[]>(() => {
    let currentSubsystem = "未分组"
    return rows.map((row, index) => {
      const subsystemRow = isSubsystemRow(row)
      const baseline = baselineByKey.get(rowKey(row))
      if (subsystemRow) currentSubsystem = String(row["产品名称"] ?? "未分组")
      return {
        baseline,
        changed: isRowChanged(row, baseline),
        index,
        row,
        subsystem: currentSubsystem,
        subsystemRow,
      }
    })
  }, [baselineByKey, rows])

  const subsystemOptions = useMemo(() => {
    const options = new Set<string>()
    rowViews.forEach(view => options.add(view.subsystem))
    return ["全部", ...Array.from(options)]
  }, [rowViews])

  const totals = useMemo(() => {
    const componentRows = rowViews.filter(view => !view.subsystemRow && view.row["产品名称"])
    return {
      changed: rowViews.filter(view => view.changed).length,
      count: componentRows.length,
      mass: componentRows.reduce((sum, view) => sum + toNumber(view.row["重量（Kg）"]), 0),
      peakPower: componentRows.reduce((sum, view) => sum + toNumber(view.row["峰值功耗（W）"]), 0),
      steadyPower: componentRows.reduce((sum, view) => sum + toNumber(view.row["稳态功耗（W）"]), 0),
    }
  }, [rowViews])

  const visibleRows = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()
    return rowViews.filter(view => {
      if (subsystemFilter !== "全部" && view.subsystem !== subsystemFilter) return false
      if (changedOnly && !view.changed) return false
      if (normalizedSearch && !rowSearchText(view.row).includes(normalizedSearch)) return false
      return true
    })
  }, [changedOnly, rowViews, search, subsystemFilter])

  const statusTone = getStatusTone(status)
  const dirty = totals.changed > 0
  const massDelta = totals.mass - TARGET_MASS_KG

  const updateCell = (rowIndex: number, column: CatchTableColumn, value: string) => {
    setRows(previous => previous.map((row, index) => index === rowIndex ? { ...row, [column]: value } : row))
  }

  const addRowToSubsystem = (subsystem: string) => {
    const nextRow: CatchTableRow = {
      id: `new-${Date.now()}`,
      "产品名称": "新器件",
      "重量（Kg）": 0,
      "包络尺寸（mm）": "",
      "稳态功耗（W）": 0,
      "峰值功耗（W）": 0,
      "工作温度（℃）": "",
      "配套单位": "CATCH",
      "热仿真温度状态": "missing",
    }
    const insertIndex = findInsertIndex(rowViews, subsystem)
    setRows(previous => [
      ...previous.slice(0, insertIndex),
      nextRow,
      ...previous.slice(insertIndex),
    ])
    if (search) setSearch("")
    if (changedOnly) setChangedOnly(false)
    setStatus("已新增一行")
  }

  const deleteRow = (rowIndex: number) => {
    setRows(previous => previous.filter((_, index) => index !== rowIndex))
    setStatus("已删除一行")
  }

  const save = () => {
    if (!activeContext.versionDir) return
    setSaving(true)
    setStatus(dirty ? "正在保存并刷新 00_inputs" : "正在重新生成 00_inputs")
    fetch(`${joinApiPath(apiBase, "/workspace/catch-supporting-table")}${query}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: rows.filter(row => !isSummaryRow(row)) }),
    })
      .then(async response => {
        if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? "保存 CATCH 配套表失败")
        return response.json() as Promise<CatchTableResponse>
      })
      .then(data => {
        const nextRows = normalizeRows(data.table?.rows ?? data.rows ?? rows)
        setRows(nextRows)
        setBaselineRows(nextRows)
        const componentCount = data.generation?.component_count
        setStatus(componentCount == null
          ? "已刷新当前工作区 00_inputs"
          : `已刷新当前工作区 00_inputs：${componentCount} 个组件`)
        onSaved?.()
      })
      .catch(error => setStatus(error instanceof Error ? error.message : "保存 CATCH 配套表失败"))
      .finally(() => setSaving(false))
  }

  if (loading && rows.length === 0) {
    return (
      <div className="catch-config-shell">
        <div className={`catch-config-empty is-${statusTone}`}>{status}</div>
      </div>
    )
  }

  return (
    <div className="catch-config-shell">
      <div className="catch-config-top">
        <div className="catch-config-title">
          <span>CATCH 热仿真输入</span>
          <strong>整星配套表</strong>
        </div>
        <div className="catch-config-actions">
          <button type="button" onClick={loadTable} disabled={loading || saving}>重新读取</button>
          <button type="button" className="primary" onClick={save} disabled={loading || saving || rows.length === 0}>
            {saving ? "刷新中" : dirty ? "保存并刷新" : "重新生成 00_inputs"}
          </button>
        </div>
      </div>

      <HeatfluxSelector activeContext={activeContext} apiBase={apiBase} />

      <div className="catch-config-summary">
        <div className="catch-config-stat">
          <span>器件数量</span>
          <strong>{totals.count}</strong>
        </div>
        <div className={`catch-config-stat ${Math.abs(massDelta) > 0.01 ? "is-warn" : ""}`}>
          <span>总质量</span>
          <strong>{formatNumber(totals.mass, 3)} kg</strong>
        </div>
        <div className="catch-config-stat">
          <span>稳态/峰值功耗</span>
          <strong>{formatNumber(totals.steadyPower)} / {formatNumber(totals.peakPower)} W</strong>
        </div>
        <div className="catch-config-stat">
          <span>未保存变更</span>
          <strong>{totals.changed}</strong>
        </div>
        <div className={`catch-config-status is-${statusTone}`}>{dirty ? `${status} · 有未保存变更` : status}</div>
      </div>

      <div className="catch-config-workbench">
        <section className="catch-config-card catch-config-filters">
          <div className="catch-config-card-head">
            <div>
              <strong>筛选</strong>
              <span>{visibleRows.length}/{rows.length} 行</span>
            </div>
          </div>
          <div className="catch-filter-grid">
            <label>
              <span>搜索</span>
              <input value={search} onChange={event => setSearch(event.target.value)} placeholder="名称、尺寸、单位" />
            </label>
            <label>
              <span>分系统</span>
              <select value={subsystemFilter} onChange={event => setSubsystemFilter(event.target.value)}>
                {subsystemOptions.map(option => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className="catch-toggle-row">
              <input type="checkbox" checked={changedOnly} onChange={event => setChangedOnly(event.target.checked)} />
              <span>只看改动</span>
            </label>
          </div>
        </section>

        <section className="catch-config-card catch-table-card">
          <div className="catch-config-card-head">
            <div>
              <strong>组件清单</strong>
              <span>质量目标 {TARGET_MASS_KG} kg，偏差 {formatNumber(massDelta, 3)} kg</span>
            </div>
            <div className={dirty ? "catch-unsaved-pill is-dirty" : "catch-unsaved-pill"}>{dirty ? "未保存" : "已同步"}</div>
          </div>
          <div className="catch-table-scroll">
            <table className="catch-grid-table">
              <thead>
                <tr>
                  <th>分系统</th>
                  {COLUMNS.map(column => <th key={column}>{column}</th>)}
                  {RESULT_COLUMNS.map(column => <th key={column}>{column}</th>)}
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map(view => {
                  const rowClassName = [view.subsystemRow ? "is-subsystem" : "", view.changed ? "is-changed" : ""].filter(Boolean).join(" ")
                  const subsystemLabel = view.subsystemRow ? view.subsystem : view.subsystem.replace(/分系统$/u, "")
                  return (
                    <tr key={`${view.row.id ?? view.index}-${view.index}`} className={rowClassName}>
                      <td className="catch-subsystem-cell">{subsystemLabel}</td>
                      {view.subsystemRow ? (
                        <td className="catch-subsystem-spacer-cell" colSpan={COLUMNS.length + RESULT_COLUMNS.length} aria-label={subsystemLabel} />
                      ) : (
                        <>
                          {COLUMNS.map(column => (
                            <td key={column} className={isCellChanged(view.row, view.baseline, column) ? "is-cell-changed" : undefined}>
                              <input
                                value={cellValue(view.row, column)}
                                onChange={event => updateCell(view.index, column, event.target.value)}
                                aria-label={`${column}-${view.index + 1}`}
                              />
                            </td>
                          ))}
                          {RESULT_COLUMNS.map(column => (
                            <td key={column} className={temperatureCellClass(view.row)}>
                              <span title={`组件 ${view.row["热仿真温度组件ID"] ?? "-"}，样本 ${view.row["热仿真温度样本数"] ?? 0}`}>
                                {resultCellValue(view.row, column)}
                              </span>
                            </td>
                          ))}
                        </>
                      )}
                      <td>
                        {view.subsystemRow ? (
                        <button
                          type="button"
                          className="catch-row-add"
                          onClick={() => addRowToSubsystem(view.subsystem)}
                          disabled={saving}
                        >
                          新增
                        </button>
                        ) : (
                          <button type="button" className="catch-row-delete" onClick={() => deleteRow(view.index)} disabled={saving}>删除</button>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {visibleRows.length === 0 ? (
                  <tr>
                    <td className="catch-table-empty" colSpan={COLUMNS.length + RESULT_COLUMNS.length + 2}>没有匹配的行</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}
