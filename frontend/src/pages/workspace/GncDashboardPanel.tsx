import { useEffect, useState } from "react"
import { getGncTelemetryMaxBytes, getGncTelemetryPaths } from "../../app/runtimeConfig"
import { fetchWorkspaceTextFile } from "../agent/files/workspaceFilesApi"
import { GncTelemetryCharts, parseTelemetryCsv, type TelemetryRow } from "./GncTelemetryCharts"
import type { WorkspaceVersionContext } from "./workspaceVersion"

type GncDashboardPanelProps = {
  activeContext: WorkspaceVersionContext
  apiBase?: string
}

export function GncDashboardPanel({ activeContext, apiBase }: GncDashboardPanelProps) {
  const [scRows, setScRows] = useState<TelemetryRow[]>([])
  const [modeRows, setModeRows] = useState<TelemetryRow[]>([])
  const [wheelRows, setWheelRows] = useState<TelemetryRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const versionDir = activeContext.versionDir
  const versionId = activeContext.versionId
  const workspaceId = activeContext.workspaceId

  useEffect(() => {
    let cancelled = false
    setScRows([])
    setModeRows([])
    setWheelRows([])
    setError("")
    if (!versionDir) return

    const context = { versionDir, versionId, workspaceId }
    const telemetryPaths = getGncTelemetryPaths()
    const telemetryMaxBytes = getGncTelemetryMaxBytes()
    setLoading(true)
    Promise.all([
      fetchWorkspaceTextFile({ apiBase, context, maxBytes: telemetryMaxBytes, relativePath: telemetryPaths.sc }),
      fetchWorkspaceTextFile({ apiBase, context, maxBytes: telemetryMaxBytes, relativePath: telemetryPaths.mode }),
      fetchWorkspaceTextFile({ apiBase, context, maxBytes: telemetryMaxBytes, relativePath: telemetryPaths.wheel }),
    ])
      .then(([sc, mode, wheel]) => {
        if (cancelled) return
        setScRows(parseTelemetryCsv(sc.content ?? ""))
        setModeRows(parseTelemetryCsv(mode.content ?? ""))
        setWheelRows(parseTelemetryCsv(wheel.content ?? ""))
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : "GNC 遥测读取失败")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [apiBase, versionDir, versionId, workspaceId])

  if (!versionDir) {
    return (
      <div className="gnc-dashboard-stage">
        <div className="wa-stage-empty">
          <div className="wa-stage-empty-inner">
            <strong>等待选择 GNC 工作区</strong>
            <span>选择工作区版本后，GNC 遥测曲线会显示在这里。</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="gnc-dashboard-stage">
      {error && <div className="gnc-dashboard-error">{error}</div>}
      {loading && <div className="gnc-dashboard-loading">读取遥测数据...</div>}
      {!error && !loading && <GncTelemetryCharts modeRows={modeRows} scRows={scRows} wheelRows={wheelRows} />}
    </div>
  )
}
