import { useCallback, useEffect, useMemo, useState } from "react"
import { AppleTaskComposer } from "../components/AppleTaskComposer"
import { OutputLog } from "../components/OutputLog"
import { createImageUrl } from "../components/bomData"
import { useBomInfo } from "../hooks/useBomInfo"
import { useWorkspaceAppState } from "../hooks/useWorkspaceAppState"
import type { CodexInputItem } from "../types"

const WORKSPACE_HOME_PATH = "/workspace"

type ViewerComponentMessage = {
  componentId?: unknown
  type?: unknown
}

type FreecadProgressResponse = {
  exists?: boolean
  data?: unknown
  source_path?: string | null
  source_version?: string | null
  updated_at?: string | null
}

type ProgressEntry = {
  fileNames: string[]
  key: string
  label: string
  percent: number
}

type ActivePanel = "bom" | "model" | "freecad" | "paraview" | "comsol"

const STYLE = `
.workspace-apple {
  min-height: 100vh;
  overflow: hidden;
  background:
    radial-gradient(circle at 52% 0%, rgba(120, 177, 255, 0.18), transparent 34%),
    linear-gradient(180deg, #fbfbfd 0%, #f5f5f7 46%, #f1f1f3 100%);
  color: #1d1d1f;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif;
}
.workspace-apple button,
.workspace-apple textarea { font: inherit; }
.wa-topbar {
  position: relative;
  z-index: 100;
  height: 52px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  background: rgba(251, 251, 253, 0.78);
  backdrop-filter: blur(24px) saturate(180%);
}
.wa-topbar-inner {
  position: relative;
  display: flex;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: space-between;
}
.wa-nav-left {
  display: inline-flex;
  align-items: center;
  gap: 14px;
}
.wa-back-button {
  display: inline-flex;
  height: 36px;
  align-items: center;
  gap: 9px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.72);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.82), 0 8px 20px rgba(0, 0, 0, 0.06);
  color: #3f3f44;
  cursor: pointer;
  padding: 0 13px 0 8px;
  font-size: 12px;
  font-weight: 700;
}
.wa-back-button:hover { background: rgba(255, 255, 255, 0.9); color: #1d1d1f; }
.wa-back-button span:first-child {
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border-radius: 50%;
  background: #1d1d1f;
  color: white;
  font-size: 15px;
  line-height: 1;
}
.wa-tabs {
  position: absolute;
  left: 50%;
  display: inline-flex;
  transform: translateX(-50%);
  overflow: visible;
  border: 1px solid rgba(0, 0, 0, 0.07);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.66);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
}
.wa-tabs button {
  height: 34px;
  min-width: 86px;
  border: 0;
  background: transparent;
  color: #5d5d62;
  font-size: 12px;
  font-weight: 650;
}
.wa-tabs button.active { background: #1d1d1f; color: white; border-radius: 999px; }
.wa-tool-menu { position: relative; }
.wa-tool-panel {
  position: absolute;
  left: 50%;
  top: calc(100% + 8px);
  z-index: 200;
  display: none;
  min-width: 170px;
  transform: translateX(-50%);
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.14);
  backdrop-filter: blur(24px) saturate(180%);
  padding: 6px;
}
.wa-tool-menu:hover .wa-tool-panel,
.wa-tool-menu:focus-within .wa-tool-panel { display: grid; gap: 4px; }
.wa-tool-panel a,
.wa-tool-panel button {
  display: flex;
  width: 100%;
  height: 38px;
  align-items: center;
  justify-content: space-between;
  border: 0;
  border-radius: 12px;
  background: transparent;
  padding: 0 11px;
  color: #1d1d1f;
  font-size: 13px;
  font-weight: 650;
  text-decoration: none;
}
.wa-tool-panel a:hover,
.wa-tool-panel button:hover { background: rgba(0, 0, 0, 0.045); }
.wa-tool-panel span { color: #8d8d92; font-size: 11px; }
.wa-status-pill {
  display: inline-flex;
  height: 34px;
  align-items: center;
  gap: 8px;
  border: 1px solid rgba(0, 0, 0, 0.07);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.7);
  padding: 0 13px;
  color: #56565b;
  font-size: 12px;
  font-weight: 650;
}
button.wa-status-pill {
  font-family: inherit;
}
button.wa-status-pill:not(:disabled) { cursor: pointer; }
button.wa-status-pill:not(:disabled):hover { background: rgba(255, 255, 255, 0.92); }
button.wa-status-pill:disabled { cursor: default; opacity: 0.72; }
.wa-status-dot { width: 8px; height: 8px; border-radius: 50%; background: #0f7f56; }
.wa-workspace {
  display: grid;
  grid-template-columns: clamp(310px, 24vw, 390px) minmax(520px, 1fr) clamp(300px, 22vw, 360px);
  gap: 10px;
  width: calc(100vw - 20px);
  height: calc(100vh - 64px);
  margin: 6px auto;
}
.wa-panel {
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.76);
  box-shadow: 0 22px 70px rgba(0, 0, 0, 0.08);
  backdrop-filter: blur(28px) saturate(180%);
}
.wa-panel-header {
  display: flex;
  min-height: 58px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  padding: 0 20px;
}
.wa-panel-title { min-width: 0; }
.wa-panel-title strong {
  display: block;
  overflow: hidden;
  color: #1d1d1f;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wa-panel-title span { display: block; margin-top: 3px; color: #86868b; font-size: 12px; }
.wa-chat {
  display: flex;
  min-height: 0;
  flex-direction: column;
  --bg: transparent;
  --bg-2: rgba(255, 255, 255, 0.72);
  --bg-3: rgba(0, 0, 0, 0.055);
  --border: rgba(0, 0, 0, 0.07);
  --border-2: rgba(0, 0, 0, 0.1);
  --text: #1d1d1f;
  --text-2: #5d5d62;
  --text-3: #86868b;
  --green: #0f7f56;
  --red: #d94b3d;
  --amber: #b85f00;
  --blue: #0071e3;
  --code-bg: rgba(0, 0, 0, 0.045);
  --code-header: rgba(0, 0, 0, 0.045);
  --code-text: #1d1d1f;
  --code-dim: #6e6e73;
  --content-width: 100%;
  --content-px: 18px;
}
.wa-log {
  display: flex;
  min-height: 0;
  flex: 1;
  overflow: hidden;
}
.wa-composer {
  flex-shrink: 0;
  overflow: visible;
  border-top: 1px solid rgba(0, 0, 0, 0.05);
  background: rgba(255, 255, 255, 0.52);
  padding: 10px 12px 12px;
  --content-width: 100%;
  --content-px: 0px;
}
.wa-stage { display: flex; min-width: 0; min-height: 0; flex-direction: column; }
.wa-stage-body {
  position: relative;
  min-height: 0;
  flex: 1;
  overflow: hidden;
  background:
    radial-gradient(circle at 50% 20%, rgba(140, 184, 255, 0.24), transparent 26%),
    linear-gradient(180deg, #f8f8fb 0%, #eceff4 100%);
}
.wa-viewer {
  width: 100%;
  height: 100%;
  border: 0;
  background: transparent;
}
.wa-bom-stage {
  width: 100%;
  height: 100%;
  overflow: auto;
  padding: 72px 24px 24px;
}
.wa-bom-stage-inner {
  max-width: 980px;
  margin: 0 auto;
}
.wa-bom-stage h2 {
  margin: 0;
  font-size: 42px;
  line-height: 1.05;
}
.wa-bom-stage p {
  margin: 10px 0 0;
  color: #6e6e73;
  font-size: 15px;
  line-height: 1.5;
}
.wa-bom-stage-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
  margin-top: 24px;
}
.wa-bom-detail {
  display: grid;
  grid-template-columns: minmax(240px, 360px) minmax(0, 1fr);
  gap: 16px;
  margin-top: 24px;
}
.wa-bom-detail-card {
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.72);
  padding: 18px;
}
.wa-bom-detail-card img {
  display: block;
  max-width: 100%;
  max-height: 220px;
  margin: 0 auto;
  object-fit: contain;
}
.wa-bom-detail-card h3 {
  margin: 0;
  font-size: 22px;
  line-height: 1.2;
}
.wa-bom-detail-fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
  margin-top: 16px;
}
.wa-bom-field {
  border-radius: 14px;
  background: rgba(0, 0, 0, 0.035);
  padding: 11px 12px;
}
.wa-bom-field span {
  display: block;
  color: #86868b;
  font-size: 11px;
  font-weight: 650;
}
.wa-bom-field strong {
  display: block;
  margin-top: 4px;
  color: #1d1d1f;
  font-size: 13px;
  line-height: 1.35;
}
.wa-bom-stage-grid button {
  min-height: 96px;
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.72);
  padding: 15px;
  text-align: left;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.05);
}
.wa-bom-stage-grid button.selected {
  border-color: rgba(0, 113, 227, 0.32);
  box-shadow: 0 18px 44px rgba(0, 113, 227, 0.12);
}
.wa-bom-stage-grid strong {
  display: block;
  margin-top: 8px;
  color: #1d1d1f;
  font-size: 14px;
}
.wa-bom-stage-grid small {
  display: block;
  margin-top: 5px;
  color: #86868b;
  font-size: 12px;
}
.wa-stage-toolbar {
  position: absolute;
  right: 18px;
  top: 18px;
  z-index: 2;
}
.wa-stage-footer {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  border-top: 1px solid rgba(0, 0, 0, 0.05);
  background: rgba(0, 0, 0, 0.06);
}
.wa-stage-footer div { min-height: 82px; background: rgba(255, 255, 255, 0.68); padding: 16px 18px; }
.wa-stage-footer strong { display: block; font-size: 22px; line-height: 1; }
.wa-stage-footer span { display: block; margin-top: 8px; color: #6e6e73; font-size: 12px; font-weight: 600; }
.wa-inspector { display: flex; min-height: 0; flex-direction: column; }
.wa-inspector-content { min-height: 0; overflow-y: auto; padding: 16px; }
.wa-info-card {
  margin-bottom: 14px;
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.66);
  padding: 16px;
}
.wa-info-card h3 { margin: 0; font-size: 16px; line-height: 1.2; }
.wa-info-card p { margin: 9px 0 0; color: #6e6e73; font-size: 13px; line-height: 1.5; }
.wa-progress { display: grid; gap: 10px; margin-top: 14px; }
.wa-progress-item {
  display: grid;
  grid-template-columns: 76px 1fr auto;
  align-items: center;
  gap: 10px;
  color: #5d5d62;
  font-size: 12px;
  font-weight: 650;
}
.wa-progress-files {
  grid-column: 2 / 4;
  margin-top: -4px;
  overflow: hidden;
  color: #8d8d92;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wa-bar { height: 8px; overflow: hidden; border-radius: 999px; background: rgba(0, 0, 0, 0.06); }
.wa-bar span { display: block; height: 100%; border-radius: inherit; background: #1d1d1f; }
.wa-files, .wa-bom-list { display: grid; gap: 9px; margin-top: 14px; }
.wa-file, .wa-bom-row {
  display: block;
  gap: 8px;
  align-items: center;
  min-height: 44px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.035);
  padding: 7px 8px;
  color: #55555a;
  font-size: 12px;
  font-weight: 650;
  text-align: left;
}
.wa-bom-row.selected {
  border: 1px solid rgba(0, 113, 227, 0.32);
  background: rgba(0, 113, 227, 0.08);
  box-shadow: 0 10px 26px rgba(0, 113, 227, 0.1);
}
.wa-file small, .wa-bom-row small { color: #8d8d92; font-size: 11px; }
.wa-bom-row-top {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  gap: 6px;
  align-items: center;
}
.wa-bom-row strong {
  display: block;
  overflow: hidden;
  color: #1d1d1f;
  font-size: 12px;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wa-bom-id { color: #55555a; font: 700 11px/1 "SF Mono", Consolas, monospace; }
@media (max-width: 1100px) {
  .workspace-apple { overflow: auto; }
  .wa-tabs { display: none; }
  .wa-workspace {
    grid-template-columns: 1fr;
    width: min(100vw - 20px, 760px);
    height: auto;
    padding-bottom: 20px;
  }
  .wa-panel { min-height: 420px; }
  .wa-stage-body { min-height: 520px; }
  .wa-bom-detail { grid-template-columns: 1fr; }
}
`

function getFileNames(turns: ReturnType<typeof useWorkspaceAppState>["turns"], currentEvents: ReturnType<typeof useWorkspaceAppState>["currentEvents"]) {
  const names = new Set<string>()
  const allEvents = [...turns.flatMap(turn => turn.events), ...currentEvents]
  for (const event of allEvents) {
    if (event.type !== "item.completed" || event.item.type !== "file_change") continue
    for (const change of event.item.changes) names.add(change.path)
  }
  return [...names].slice(0, 5)
}

function formatBomValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-"
  if (Array.isArray(value)) return value.length > 0 ? value.join(" x ") : "-"
  return String(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function progressLabel(key: string) {
  const normalized = key.toLowerCase().replace(/[\s_-]+/gu, "")
  const labels: Record<string, string> = {
    layoutcompletionpercent: "布局完成",
    layout: "布局",
    layoutpercent: "布局",
    topology: "拓扑",
    bom: "BOM",
    geometry: "几何",
    modeling: "建模",
    modelingpercent: "建模",
    model: "建模",
    build: "建模",
    assembly: "装配",
    replacement: "替换",
    export: "导出",
    exportfilepercent: "文件导出",
    exportpercent: "导出",
    glb: "GLB",
    step: "STEP",
    preview: "预览",
    simulation: "仿真",
    analysis: "分析",
  }
  return labels[normalized] ?? key
}

function getDisplayFileName(pathValue: string) {
  const normalized = pathValue.replace(/\\/gu, "/")
  return normalized.split("/").pop() || pathValue
}

function isGlbFilePath(pathValue: string) {
  return /\.glb$/iu.test(pathValue.trim())
}

function getViewerGlbPath(filePaths: string[]) {
  return filePaths.find(isGlbFilePath) ?? null
}

function normalizePercent(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  const percent = value <= 1 && value >= 0 ? value * 100 : value
  return Math.max(0, Math.min(100, Math.round(percent)))
}

function getProgressEntries(data: unknown): ProgressEntry[] {
  const progressData = isRecord(data) && isRecord(data.progress_percentages)
    ? data.progress_percentages
    : isRecord(data) && isRecord(data.progress)
      ? data.progress
      : data
  const entries: ProgressEntry[] = []
  const outputFilesByKey = getProgressOutputFilesByKey(data)

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
        label: typeof item.label === "string" ? item.label : progressLabel(key),
        percent,
      })
    })
    return entries
  }

  if (!isRecord(progressData)) return entries
  for (const [key, value] of Object.entries(progressData)) {
    if (["files", "key_files", "artifacts", "outputs", "output_files", "progress", "progress_percentages", "updated_at", "tool", "success"].includes(key)) continue
    const percent = normalizePercent(value)
    if (percent === null) continue
    entries.push({
      fileNames: outputFilesByKey.get(key) ?? [],
      key,
      label: progressLabel(key),
      percent,
    })
  }
  return entries
}

function getProgressOutputFilesByKey(data: unknown) {
  const files = new Map<string, string[]>()
  if (!isRecord(data) || !isRecord(data.output_files)) return files
  const showFinalOutputs = data.success === true

  for (const [key, value] of Object.entries(data.output_files)) {
    if (!showFinalOutputs && ["step", "glb", "replaced_step", "replaced_glb"].includes(key)) continue
    const names: string[] = []
    if (typeof value === "string") {
      names.push(getDisplayFileName(value))
    } else if (isRecord(value)) {
      if (value.exists !== true) continue
      const pathValue = value.path ?? value.file ?? value.name
      if (typeof pathValue === "string") names.push(getDisplayFileName(pathValue))
    }

    if (names.length === 0) continue
    files.set(key, names)
    if (key === "step" || key === "glb") {
      const exportNames = files.get("export_file_percent") ?? []
      files.set("export_file_percent", [...exportNames, ...names])
    }
  }

  return files
}

function getProgressFiles(data: unknown) {
  if (!isRecord(data)) return []
  const candidates = [data.files, data.key_files, data.artifacts, data.outputs, data.output_files]
  const paths = new Set<string>()
  const showFinalOutputs = data.success === true

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
        if (!showFinalOutputs && ["step", "glb", "replaced_step", "replaced_glb"].includes(key)) continue
        if (typeof value === "string") paths.add(value)
        if (isRecord(value)) {
          if (value.exists !== true) continue
          const pathValue = value.path ?? value.file ?? value.name
          if (typeof pathValue === "string") paths.add(pathValue)
        }
      }
    }
  }

  return [...paths].slice(0, 6)
}

function formatProgressUpdatedAt(progressData: FreecadProgressResponse | null) {
  const rawUpdatedAt = progressData?.updated_at ??
    (isRecord(progressData?.data) && typeof progressData.data.updated_at === "string"
      ? progressData.data.updated_at
      : null)
  if (!rawUpdatedAt) return "等待更新"

  const parsed = new Date(rawUpdatedAt)
  if (Number.isNaN(parsed.getTime())) return rawUpdatedAt
  return parsed.toLocaleString()
}

interface WorkspaceSessionPageProps {
  homePath?: string
}

interface WorkspaceAppleContentProps {
  state: ReturnType<typeof useWorkspaceAppState>
}

export function WorkspaceAppleContent({ state }: WorkspaceAppleContentProps) {
  const {
    activeSessionId,
    currentEvents,
    currentPrompt,
    handleDelete: _handleDelete,
    handleNew,
    handleStopAskUser,
    handleSubmit,
    isMobile: _isMobile,
    pendingAskUser,
    running,
    sortedSessions,
    turns,
    abort,
  } = state
  const { bomInfo, loading: bomLoading } = useBomInfo()
  const [selectedBomId, setSelectedBomId] = useState("")
  const [activePanel, setActivePanel] = useState<ActivePanel>("model")
  const [progressData, setProgressData] = useState<FreecadProgressResponse | null>(null)
  const [progressRefreshNonce, setProgressRefreshNonce] = useState(0)

  const activeSession = sortedSessions.find(session => session.id === activeSessionId)
  const selectedBom = bomInfo.components.find(component => component.componentId === selectedBomId) ?? bomInfo.components[0]
  const fileNames = useMemo(() => getFileNames(turns, currentEvents), [turns, currentEvents])
  const progressEntries = useMemo(() => getProgressEntries(progressData?.data), [progressData])
  const progressFiles = useMemo(() => getProgressFiles(progressData?.data), [progressData])
  const hasProgressData = progressEntries.length > 0 || progressData?.exists === true
  const displayedFileNames = progressFiles.length > 0 ? progressFiles : fileNames
  const previewGlbPath = useMemo(() => getViewerGlbPath(displayedFileNames), [displayedFileNames])
  const viewerHref = useMemo(() => {
    const params = new URLSearchParams()
    if (activeSessionId) params.set("sessionId", activeSessionId)
    if (previewGlbPath) params.set("glbPath", previewGlbPath)
    const query = params.toString()
    return query ? `/viewer?${query}` : "/viewer"
  }, [activeSessionId, previewGlbPath])
  const freecadHref = "http://10.110.10.11:7080/vnc.html?autoconnect=true&resize=scale&path=websockify"
  const paraviewHref = "http://10.110.10.11:6081/vnc.html?autoconnect=true&resize=scale&path=websockify"
  const comsolHref = "http://10.110.10.11:6082/vnc.html?autoconnect=true&resize=scale&path=websockify"
  const activeTool = activePanel === "freecad"
    ? { label: "FreeCAD", subtitle: "远程 FreeCAD 会话", title: "FreeCAD 工作台", url: freecadHref }
    : activePanel === "paraview"
      ? { label: "ParaView", subtitle: "远程 ParaView 会话", title: "ParaView 工作台", url: paraviewHref }
      : activePanel === "comsol"
        ? { label: "COMSOL", subtitle: "远程 COMSOL 会话", title: "COMSOL 工作台", url: comsolHref }
        : null
  const orderedBomComponents = useMemo(() => {
    if (!selectedBomId) return bomInfo.components
    return [...bomInfo.components].sort((left, right) => {
      if (left.componentId === selectedBomId) return -1
      if (right.componentId === selectedBomId) return 1
      return 0
    })
  }, [bomInfo.components, selectedBomId])

  const submitAndRefreshProgress = useCallback((input: string | CodexInputItem[], enabledSkills?: string[]) => {
    setProgressData(null)
    setProgressRefreshNonce(value => value + 1)
    handleSubmit(input, enabledSkills)
    window.setTimeout(() => setProgressRefreshNonce(value => value + 1), 150)
  }, [handleSubmit])

  const openExternalWindow = useCallback((url: string) => {
    window.open(url, "_blank", "noopener,noreferrer")
  }, [])

  useEffect(() => {
    const handleViewerMessage = (event: MessageEvent<ViewerComponentMessage>) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type !== "viewer3d:component-selected") return
      if (typeof event.data.componentId !== "string") return
      setSelectedBomId(event.data.componentId)
    }

    window.addEventListener("message", handleViewerMessage)
    return () => window.removeEventListener("message", handleViewerMessage)
  }, [])

  useEffect(() => {
    setProgressData(null)
  }, [activeSessionId])

  useEffect(() => {
    let cancelled = false

    const loadProgress = () => {
      const query = activeSessionId
        ? `?${new URLSearchParams({ sessionId: activeSessionId }).toString()}`
        : ""
      fetch(`/api/freecad/progress${query}`, { cache: "no-store" })
        .then(response => response.ok ? response.json() as Promise<FreecadProgressResponse> : null)
        .then(data => {
          if (!cancelled) setProgressData(data)
        })
        .catch(() => {
          if (!cancelled) setProgressData(null)
        })
    }

    loadProgress()
    const intervalId = window.setInterval(loadProgress, running ? 500 : 3000)
    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [activeSessionId, progressRefreshNonce, running])

  const stageTitle = activePanel === "model"
    ? "3D 模型预览"
    : activePanel === "bom"
      ? "BOM 清单"
      : activeTool?.title ?? "工具工作台"
  const stageSubtitle = activePanel === "model"
    ? activeSessionId ? "当前会话模型" : "等待会话模型"
    : activePanel === "bom"
      ? bomLoading ? "正在加载 BOM 数据" : `${bomInfo.totalRecords} 个组件`
      : activeTool?.subtitle ?? "远程工具会话"

  return (
    <div className="workspace-apple">
      <style>{STYLE}</style>
      <header className="wa-topbar">
        <div className="wa-topbar-inner">
          <div className="wa-nav-left">
            <button type="button" className="wa-back-button" aria-label="返回主页" onClick={handleNew}>
              <span>‹</span>
              <span>工作台首页</span>
            </button>
          </div>
          <div className="wa-tabs" aria-label="工作区标签">
            <button
              type="button"
              className={activePanel === "bom" ? "active" : undefined}
              onClick={() => setActivePanel("bom")}
            >
              BOM
            </button>
            <button
              type="button"
              className={activePanel === "model" ? "active" : undefined}
              onClick={() => setActivePanel("model")}
            >
              模型
            </button>
            <div className="wa-tool-menu">
              <button type="button">工具 ▾</button>
              <div className="wa-tool-panel" role="menu" aria-label="工具列表">
                <button
                  type="button"
                  onClick={() => setActivePanel("freecad")}
                >
                  FreeCAD <span>CAD</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActivePanel("paraview")}
                >
                  ParaView <span>VNC</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActivePanel("comsol")}
                >
                  COMSOL <span>VNC</span>
                </button>
              </div>
            </div>
          </div>
          <div className="wa-status-pill">
            <span className="wa-status-dot" />
            {running ? "运行中" : activeSession ? "已加载会话" : "等待会话"}
          </div>
        </div>
      </header>

      <main className="wa-workspace">
        <aside className="wa-panel wa-chat">
          <div className="wa-panel-header">
            <div className="wa-panel-title">
              <strong>{activeSession?.title || "选择或开始一个会话"}</strong>
              <span>{activeSessionId ? `会话 ${activeSessionId}` : "暂无活动会话"}</span>
            </div>
          </div>

          <div className="wa-log">
            <OutputLog
              turns={turns}
              currentPrompt={currentPrompt}
              currentEvents={currentEvents}
              running={running}
              pendingAskUser={pendingAskUser}
              onSubmitAskUser={answer => submitAndRefreshProgress(answer)}
              onStopAskUser={handleStopAskUser}
            />
          </div>

          <div className="wa-composer">
            {!pendingAskUser && (
              <AppleTaskComposer
                compact
                onSubmit={submitAndRefreshProgress}
                onAbort={abort}
                running={running}
                placeholder="继续描述设计目标、修改要求或输入 @ 添加 Skill 或文件..."
              />
            )}
          </div>
        </aside>

        <section className="wa-panel wa-stage">
          <div className="wa-panel-header">
            <div className="wa-panel-title">
              <strong>{stageTitle}</strong>
              <span>{stageSubtitle}</span>
            </div>
          </div>
          <div className="wa-stage-body">
            <div className="wa-stage-toolbar">
              <button
                type="button"
                className="wa-status-pill"
                onClick={() => {
                  if (activePanel === "model") openExternalWindow(viewerHref)
                  if (activeTool) openExternalWindow(activeTool.url)
                }}
                disabled={activePanel === "bom"}
              >
                {activePanel === "model" ? "3D Viewer" : activePanel === "bom" ? "BOM" : activeTool?.label}
              </button>
            </div>
            {activePanel === "model" ? (
              <iframe className="wa-viewer" title="3D 模型预览" src={viewerHref} />
            ) : activePanel === "bom" ? (
              <div className="wa-bom-stage">
                <div className="wa-bom-stage-inner">
                  <h2>BOM 清单</h2>
                  <p>{bomLoading ? "正在加载 BOM 数据..." : `当前 BOM 共 ${bomInfo.totalRecords} 个组件。`}</p>
                  {selectedBom ? (
                    <div className="wa-bom-detail">
                      <div className="wa-bom-detail-card">
                        {selectedBom.imageExists && selectedBom.imagePath ? (
                          <img
                            alt={selectedBom.nameCn || selectedBom.name}
                            src={createImageUrl(selectedBom.imagePath) ?? ""}
                          />
                        ) : (
                          <div className="wa-file">
                            <span>暂无组件图片</span>
                            <small>-</small>
                          </div>
                        )}
                      </div>
                      <div className="wa-bom-detail-card">
                        <h3>{selectedBom.componentId} · {selectedBom.nameCn || selectedBom.name || selectedBom.model}</h3>
                        <p>{selectedBom.description}</p>
                        <div className="wa-bom-detail-fields">
                          {[
                            ["组件编号", selectedBom.componentId],
                            ["语义名", selectedBom.semanticName],
                            ["型号", selectedBom.model],
                            ["数量", selectedBom.quantity],
                            ["分系统", selectedBom.subsystem],
                            ["类型", selectedBom.kind],
                            ["类别", selectedBom.category],
                            ["尺寸", selectedBom.dimensions || selectedBom.sizeMm],
                            ["质量", selectedBom.massKg === null ? "-" : `${selectedBom.massKg} kg`],
                            ["功耗", selectedBom.powerW === null ? "-" : `${selectedBom.powerW} W`],
                            ["材料", selectedBom.material],
                            ["安装面", selectedBom.mountFace],
                            ["来源", selectedBom.source],
                            ...Object.entries(selectedBom.thermal).map(([label, value]) => [`热参数 · ${label}`, value]),
                          ].map(([label, value]) => (
                            <div className="wa-bom-field" key={String(label)}>
                              <span>{String(label)}</span>
                              <strong>{formatBomValue(value)}</strong>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="wa-bom-stage-grid">
                      {bomInfo.components.slice(0, 12).map(component => (
                        <button
                          type="button"
                          key={component.componentId}
                          onClick={() => setSelectedBomId(component.componentId)}
                        >
                          <span className="wa-bom-id">{component.componentId}</span>
                          <strong>{component.nameCn || component.name || component.model}</strong>
                          <small>{component.subsystem || component.kind || "组件"} · x{component.quantity}</small>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <iframe
                className="wa-viewer"
                title={activeTool?.label ?? "远程工具"}
                src={activeTool?.url ?? freecadHref}
              />
            )}
          </div>
          <div className="wa-stage-footer">
            <div>
              <strong>{bomInfo.totalRecords || "-"}</strong>
              <span>BOM 组件</span>
            </div>
            <div>
              <strong>{turns.length}</strong>
              <span>历史轮次</span>
            </div>
            <div>
              <strong>{running ? "RUN" : "IDLE"}</strong>
              <span>当前状态</span>
            </div>
          </div>
        </section>

        <aside className="wa-panel wa-inspector">
          <div className="wa-panel-header">
            <div className="wa-panel-title">
              <strong>产物与 BOM</strong>
              <span>当前会话沉淀的关键输出</span>
            </div>
          </div>
          <div className="wa-inspector-content">
            <section className="wa-info-card">
              <h3>工作流进度</h3>
              <p>更新时间：{formatProgressUpdatedAt(progressData)}</p>
              {hasProgressData ? (
                <div className="wa-progress">
                  {(progressEntries.length > 0 ? progressEntries : [
                    { fileNames: [], key: "layout", label: "布局", percent: 0 },
                    { fileNames: [], key: "modeling", label: "建模", percent: 0 },
                    { fileNames: [], key: "export", label: "导出", percent: 0 },
                  ]).map(item => (
                    <div className="wa-progress-item" key={item.key}>
                      <span>{item.label}</span>
                      <div className="wa-bar"><span style={{ width: `${item.percent}%` }} /></div>
                      <span>{`${item.percent}%`}</span>
                      {item.fileNames.length > 0 && (
                        <div className="wa-progress-files" title={item.fileNames.join(", ")}>
                          {item.fileNames.join(" · ")}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="wa-file">
                  <span>等待进度更新</span>
                </div>
              )}
            </section>

            <section className="wa-info-card">
              <h3>BOM List</h3>
              <p>{bomLoading ? "正在加载 BOM 数据..." : `共 ${bomInfo.totalRecords} 个组件，点击可同步选择。`}</p>
              <div className="wa-bom-list">
                {(orderedBomComponents.length > 0 ? orderedBomComponents : []).map(component => (
                  <button
                    type="button"
                    className={`wa-bom-row${component.componentId === selectedBomId ? " selected" : ""}`}
                    key={component.componentId}
                    onClick={() => {
                      setSelectedBomId(component.componentId)
                      setActivePanel("bom")
                    }}
                  >
                    <span className="wa-bom-row-top">
                      <span className="wa-bom-id">{component.componentId}</span>
                      <strong>{component.nameCn || component.name || component.model}</strong>
                      <small>x{component.quantity}</small>
                    </span>
                  </button>
                ))}
                {bomInfo.components.length === 0 && (
                  <div className="wa-file">
                    <span>暂无 BOM 数据</span>
                    <small>-</small>
                  </div>
                )}
              </div>
            </section>

          </div>
        </aside>
      </main>
    </div>
  )
}

export default function WorkspaceSessionPage({ homePath = WORKSPACE_HOME_PATH }: WorkspaceSessionPageProps) {
  const state = useWorkspaceAppState({ homePath })
  return <WorkspaceAppleContent state={state} />
}
