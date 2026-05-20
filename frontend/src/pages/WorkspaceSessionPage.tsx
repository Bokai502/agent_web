import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { AppleTaskComposer } from "../components/AppleTaskComposer"
import { APP_NAVIGATION_EVENT, formatSessionTime } from "../app/sessionUtils"
import { createImageUrl } from "../components/bomData"
import { useBomInfo } from "../hooks/useBomInfo"
import { useWorkspaceAppState } from "../hooks/useWorkspaceAppState"
import type { CodexInputItem, Session } from "../types"
import { AgentUnderstandingPanel } from "./workspace/AgentUnderstandingPanel"
import { RunLogPanel } from "./workspace/RunLogPanel"
import {
  formatProgressUpdatedAt,
  getProgressEntries,
  getWorkflowProgressEntries,
  type FreecadProgressResponse,
} from "./workspace/progressUtils"
import {
  formatStageLogTime,
  getDisplayLogEntries,
  getRunLogEntries,
  type RunLogEntry,
  type StageLogEntry,
} from "./workspace/runLogUtils"
import "./workspace/WorkspaceSessionPage.css"

const WORKSPACE_HOME_PATH = "/workspace"
const WORKSPACE_GEOMETRY_AFTER_GLB_PATH = "02_geometry_edit/geometry_after.glb"

type ViewerComponentMessage = {
  componentId?: unknown
  semanticName?: unknown
  type?: unknown
}

type FreecadWorkspaceItem = {
  missing?: string[]
  name: string
  path: string
  valid: boolean
}

type FreecadWorkspacesResponse = {
  current?: string | null
  currentName?: string | null
  effective?: string | null
  envOverride?: boolean
  items?: FreecadWorkspaceItem[]
  root?: string
}

type WorkspaceSessionGroup = FreecadWorkspaceItem & {
  sessions: Session[]
}

const UNASSIGNED_WORKSPACE_NAME = "__unassigned__"

type ActivePanel = "bom" | "log" | "model" | "freecad" | "paraview" | "comsol"

function formatBomValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-"
  if (Array.isArray(value)) return value.length > 0 ? value.join(" x ") : "-"
  return String(value)
}

function getPresentBomText(value: string) {
  return value && value !== "-" ? value : ""
}

function getBomDisplayName(component: { model: string; name: string; nameCn: string }) {
  return getPresentBomText(component.nameCn) || getPresentBomText(component.name) || getPresentBomText(component.model)
}

function getBomPrimaryName(component: { model: string; name: string; nameCn: string; semanticName: string }) {
  return getPresentBomText(component.semanticName) || getBomDisplayName(component) || getPresentBomText(component.model)
}

interface WorkspaceSessionPageProps {
  homePath?: string
}

interface WorkspaceAppleContentProps {
  state: ReturnType<typeof useWorkspaceAppState>
}

export function WorkspaceAppleContent({ state }: WorkspaceAppleContentProps) {
  const { i18n, t } = useTranslation()
  const {
    activeSessionId,
    currentEvents,
    currentPrompt,
    handleDelete,
    handleAssignSessionWorkspace,
    handleNew,
    handleSelect,
    handleStopAskUser,
    handleSubmit,
    isMobile: _isMobile,
    pendingAskUser,
    running,
    sortedSessions,
    turns,
    abort,
  } = state
  const [workspaceRefreshNonce, setWorkspaceRefreshNonce] = useState(0)
  const { bomInfo, loading: bomLoading } = useBomInfo(workspaceRefreshNonce)
  const [selectedBomId, setSelectedBomId] = useState("")
  const [activePanel, setActivePanel] = useState<ActivePanel>("model")
  const [progressData, setProgressData] = useState<FreecadProgressResponse | null>(null)
  const [progressRefreshNonce, setProgressRefreshNonce] = useState(0)
  const [selectedLogId, setSelectedLogId] = useState("")
  const [stageLogs, setStageLogs] = useState<StageLogEntry[]>([])
  const [workspaces, setWorkspaces] = useState<FreecadWorkspacesResponse | null>(null)
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [workspaceChanging, setWorkspaceChanging] = useState(false)
  const [hoveredWorkspaceName, setHoveredWorkspaceName] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null)
  const [deleteError, setDeleteError] = useState("")
  const [deletePending, setDeletePending] = useState(false)

  const activeSession = sortedSessions.find(session => session.id === activeSessionId)
  const workspaceItems = workspaces?.items ?? []
  const currentWorkspaceName = workspaces?.currentName ?? workspaces?.effective?.split(/[\\/]/u).pop() ?? t("workspace.noWorkspace")
  const currentWorkspaceDir = workspaces?.current ?? workspaces?.effective ?? null
  const unassignedWorkspaceItem = useMemo<FreecadWorkspaceItem>(() => ({
    missing: [],
    name: UNASSIGNED_WORKSPACE_NAME,
    path: currentWorkspaceDir ?? "",
    valid: true,
  }), [currentWorkspaceDir])
  const menuWorkspaceItems = useMemo(() => {
    const unassignedCount = sortedSessions.filter(session => !session.workspaceName && !session.workspaceDir).length
    return unassignedCount > 0 ? [...workspaceItems, unassignedWorkspaceItem] : workspaceItems
  }, [sortedSessions, unassignedWorkspaceItem, workspaceItems])
  const hoveredWorkspace = menuWorkspaceItems.find(item => item.name === hoveredWorkspaceName) ??
    menuWorkspaceItems.find(item => item.name === currentWorkspaceName) ??
    menuWorkspaceItems[0] ??
    null
  const getWorkspaceSessionCount = useCallback((workspace: FreecadWorkspaceItem) => {
    return sortedSessions.filter(session => {
      if (workspace.name === UNASSIGNED_WORKSPACE_NAME) return !session.workspaceName && !session.workspaceDir
      if (session.workspaceDir && workspace.path) return session.workspaceDir === workspace.path
      return session.workspaceName === workspace.name
    }).length
  }, [sortedSessions])
  const sessionsByWorkspace = useMemo<WorkspaceSessionGroup[]>(() => menuWorkspaceItems.map(item => ({
    ...item,
    sessions: sortedSessions.filter(session => {
      if (item.name === UNASSIGNED_WORKSPACE_NAME) return !session.workspaceName && !session.workspaceDir
      if (session.workspaceDir && item.path) return session.workspaceDir === item.path
      return session.workspaceName === item.name
    }),
  })), [menuWorkspaceItems, sortedSessions])
  const hoveredWorkspaceSessions = sessionsByWorkspace.find(item => item.name === hoveredWorkspace?.name)?.sessions ?? []
  const selectedBom = bomInfo.components.find(component => component.componentId === selectedBomId) ?? bomInfo.components[0]
  const progressEntries = useMemo(() => getProgressEntries(progressData?.data, t), [progressData, t])
  const workflowProgressEntries = useMemo(() => getWorkflowProgressEntries(progressEntries, t), [progressEntries, t])
  const runLogEntries = useMemo(() => getRunLogEntries(turns, currentEvents, t), [currentEvents, t, turns])
  const logEntries = useMemo(() => getDisplayLogEntries(stageLogs, runLogEntries), [runLogEntries, stageLogs])
  const selectedLog = logEntries.find(entry => entry.id === selectedLogId) ?? logEntries[0] ?? null
  const viewerHref = useMemo(() => {
    const params = new URLSearchParams()
    if (activeSessionId) params.set("sessionId", activeSessionId)
    params.set("glbPath", WORKSPACE_GEOMETRY_AFTER_GLB_PATH)
    if (workspaceRefreshNonce > 0) params.set("workspaceVersion", String(workspaceRefreshNonce))
    const query = params.toString()
    return query ? `/viewer?${query}` : "/viewer"
  }, [activeSessionId, workspaceRefreshNonce])
  const freecadHref = "http://10.110.10.11:7080/vnc.html?autoconnect=true&resize=scale&path=websockify"
  const paraviewHref = "http://10.110.10.11:6081/vnc.html?autoconnect=true&resize=scale&path=websockify"
  const comsolHref = "http://10.110.10.11:6082/vnc.html?autoconnect=true&resize=scale&path=websockify"
  const activeTool = activePanel === "freecad"
    ? { label: "FreeCAD", subtitle: t("workspace.tools.freecadSubtitle"), title: t("workspace.tools.freecadTitle"), url: freecadHref }
    : activePanel === "paraview"
      ? { label: "ParaView", subtitle: t("workspace.tools.paraviewSubtitle"), title: t("workspace.tools.paraviewTitle"), url: paraviewHref }
      : activePanel === "comsol"
        ? { label: "COMSOL", subtitle: t("workspace.tools.comsolSubtitle"), title: t("workspace.tools.comsolTitle"), url: comsolHref }
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
    handleSubmit(input, enabledSkills, {
      workspaceDir: currentWorkspaceDir,
      workspaceName: currentWorkspaceName,
    })
    window.setTimeout(() => setProgressRefreshNonce(value => value + 1), 150)
  }, [currentWorkspaceDir, currentWorkspaceName, handleSubmit])

  const handleSelectLog = useCallback((entry: RunLogEntry) => {
    setSelectedLogId(entry.id)
    setActivePanel("log")
  }, [])

  const handleReturnHome = useCallback(() => {
    window.history.pushState(null, "", "/home")
    window.dispatchEvent(new Event(APP_NAVIGATION_EVENT))
  }, [])

  const refreshWorkspaceViews = useCallback(() => {
    setSelectedBomId("")
    setSelectedLogId("")
    setProgressData(null)
    setWorkspaceRefreshNonce(value => value + 1)
    setProgressRefreshNonce(value => value + 1)
  }, [])

  const switchWorkspace = useCallback((name: string) => {
    setWorkspaceChanging(true)
    return fetch("/api/freecad/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    })
      .then(response => {
        if (!response.ok) throw new Error("workspace switch failed")
        return response.json() as Promise<unknown>
      })
      .then(() => {
        refreshWorkspaceViews()
      })
      .catch(() => {
        // Keep the previous workspace visible if the switch is rejected.
      })
      .finally(() => setWorkspaceChanging(false))
  }, [refreshWorkspaceViews])

  const handleSelectWorkspace = useCallback((name: string) => {
    if (name === currentWorkspaceName) {
      setHoveredWorkspaceName(name)
      return
    }

    switchWorkspace(name).then(() => {
      handleNew()
      setWorkspaceOpen(false)
    })
  }, [currentWorkspaceName, handleNew, switchWorkspace])

  const handleSelectWorkspaceHistory = useCallback((session: Session, workspace: FreecadWorkspaceItem) => {
    const targetWorkspaceName = workspace.name === UNASSIGNED_WORKSPACE_NAME ? currentWorkspaceName : workspace.name
    const targetWorkspaceDir = workspace.name === UNASSIGNED_WORKSPACE_NAME ? currentWorkspaceDir : workspace.path

    if (targetWorkspaceName && targetWorkspaceName !== t("workspace.noWorkspace")) {
      handleAssignSessionWorkspace(session.id, {
        workspaceDir: targetWorkspaceDir,
        workspaceName: targetWorkspaceName,
      })
    }

    const finishSelection = () => {
      handleSelect(session.id)
      setWorkspaceOpen(false)
    }

    if (workspace.name === UNASSIGNED_WORKSPACE_NAME || targetWorkspaceName === currentWorkspaceName) {
      finishSelection()
      return
    }

    switchWorkspace(targetWorkspaceName).then(finishSelection)
  }, [currentWorkspaceDir, currentWorkspaceName, handleAssignSessionWorkspace, handleSelect, switchWorkspace])

  const openExternalWindow = useCallback((url: string) => {
    window.open(url, "_blank", "noopener,noreferrer")
  }, [])

  useEffect(() => {
    const handleViewerMessage = (event: MessageEvent<ViewerComponentMessage>) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type !== "viewer3d:component-selected") return
      if (typeof event.data.componentId !== "string") return
      const semanticName = typeof event.data.semanticName === "string" ? event.data.semanticName : ""
      const matchedComponent = bomInfo.components.find(component =>
        component.componentId === event.data.componentId ||
        (!!semanticName && component.semanticName === semanticName),
      )
      setSelectedBomId(matchedComponent?.componentId ?? event.data.componentId)
    }

    window.addEventListener("message", handleViewerMessage)
    return () => window.removeEventListener("message", handleViewerMessage)
  }, [bomInfo.components])

  useEffect(() => {
    setProgressData(null)
  }, [activeSessionId])

  useEffect(() => {
    let cancelled = false
    const loadWorkspaces = () => {
      fetch("/api/freecad/workspaces", { cache: "no-store" })
        .then(response => response.ok ? response.json() as Promise<FreecadWorkspacesResponse> : null)
        .then(data => {
          if (!cancelled) setWorkspaces(data)
        })
        .catch(() => {
          if (!cancelled) setWorkspaces(null)
        })
    }

    loadWorkspaces()
    return () => {
      cancelled = true
    }
  }, [workspaceRefreshNonce])

  useEffect(() => {
    let cancelled = false

    const loadProgress = () => {
      if (!activeSessionId) {
        setProgressData(null)
        return
      }
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
  }, [activeSessionId, progressRefreshNonce, running, workspaceRefreshNonce])

  useEffect(() => {
    let cancelled = false
    const loadStageLogs = () => {
      fetch("/api/logs/stages", { cache: "no-store" })
        .then(response => response.ok ? response.json() as Promise<StageLogEntry[]> : [])
        .then(data => {
          if (!cancelled) setStageLogs(Array.isArray(data) ? data : [])
        })
        .catch(() => {
          if (!cancelled) setStageLogs([])
        })
    }

    loadStageLogs()
    const intervalId = window.setInterval(loadStageLogs, 3000)
    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [workspaceRefreshNonce])

  useEffect(() => {
    if (selectedLogId && logEntries.some(entry => entry.id === selectedLogId)) return
    setSelectedLogId(logEntries[0]?.id ?? "")
  }, [logEntries, selectedLogId])

  const stageTitle = activePanel === "model"
    ? t("workspace.stage.modelTitle")
    : activePanel === "bom"
      ? t("workspace.stage.bomTitle")
      : activePanel === "log"
        ? t("workspace.stage.logTitle")
      : activeTool?.title ?? t("workspace.stage.toolTitle")
  const stageSubtitle = activePanel === "model"
    ? activeSessionId ? t("workspace.stage.currentModel") : t("workspace.stage.waitingModel")
    : activePanel === "bom"
      ? bomLoading ? t("workspace.stage.loadingBom") : t("workspace.stage.components", { count: bomInfo.totalRecords })
      : activePanel === "log"
        ? selectedLog ? selectedLog.title : t("workspace.stage.waitingLog")
      : activeTool?.subtitle ?? t("workspace.stage.remoteTool")

  return (
    <div className="workspace-apple">
      <header className="wa-topbar">
        <div className="wa-topbar-inner">
          <div className="wa-nav-left">
            <button type="button" className="wa-back-button" aria-label={t("workspace.backAria")} onClick={handleReturnHome}>
              <span>‹</span>
              <span>{t("common.home")}</span>
            </button>
            <div className="wa-workspace-menu">
              <button
                type="button"
                className="wa-workspace-button"
                aria-expanded={workspaceOpen}
                disabled={workspaceChanging}
                onClick={() => setWorkspaceOpen(open => !open)}
                title={workspaces?.effective ?? workspaces?.current ?? undefined}
              >
                <span>{t("workspace.workspacePrefix", { name: currentWorkspaceName })}</span>
                <span>▾</span>
              </button>
              {workspaceOpen && (
                <div className="wa-workspace-dropdown">
                  <div className="wa-workspace-list">
                    {menuWorkspaceItems.length === 0 ? (
                      <div className="wa-left-empty">{t("workspace.noWorkspaces")}</div>
                    ) : (
                      menuWorkspaceItems.map(item => (
                        <button
                          type="button"
                          className={`wa-workspace-item${item.name === currentWorkspaceName ? " active" : ""}`}
                          disabled={item.name !== UNASSIGNED_WORKSPACE_NAME && workspaceChanging}
                          key={item.name}
                          title={item.name === UNASSIGNED_WORKSPACE_NAME ? t("workspace.unassignedHistory") : item.name}
                          onClick={() => {
                            if (item.name !== UNASSIGNED_WORKSPACE_NAME) handleSelectWorkspace(item.name)
                          }}
                          onFocus={() => setHoveredWorkspaceName(item.name)}
                          onMouseEnter={() => setHoveredWorkspaceName(item.name)}
                        >
                          <strong>{item.name === UNASSIGNED_WORKSPACE_NAME ? t("workspace.unassignedHistory") : item.name}</strong>
                          <span>{t("workspace.historyCount", { count: getWorkspaceSessionCount(item) })}</span>
                        </button>
                      ))
                    )}
                  </div>
                  <div className="wa-workspace-history">
                    <div className="wa-workspace-history-title">
                      {hoveredWorkspace ? t("workspace.workspaceHistoryTitle", { name: hoveredWorkspace.name === UNASSIGNED_WORKSPACE_NAME ? t("workspace.unassigned") : hoveredWorkspace.name }) : t("workspace.historyRecords")}
                    </div>
                    {hoveredWorkspace && hoveredWorkspaceSessions.length > 0 ? (
                      hoveredWorkspaceSessions.slice(0, 12).map(session => (
                        <div
                          className={`wa-workspace-session${session.id === activeSessionId ? " active" : ""}`}
                          key={session.id}
                          onClick={() => handleSelectWorkspaceHistory(session, hoveredWorkspace)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" && event.key !== " ") return
                            event.preventDefault()
                            handleSelectWorkspaceHistory(session, hoveredWorkspace)
                          }}
                        >
                          <span className="wa-workspace-session-main">
                            <strong>{session.turns[0]?.userPrompt || session.title || t("common.unnamedSession")}</strong>
                            <span>{formatSessionTime(session.createdAt)}</span>
                          </span>
                          <button
                            type="button"
                            className="wa-workspace-session-delete"
                            aria-label={t("home.deleteConversation")}
                            title={t("home.deleteConversation")}
                            onClick={(event) => {
                              event.stopPropagation()
                              const title = session.turns[0]?.userPrompt || session.title || t("common.unnamedSession")
                              setDeleteError("")
                              setDeleteTarget({ id: session.id, title })
                            }}
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M9 5h6" />
                              <path d="M10 5l1-2h2l1 2" />
                              <path d="M5 7h14" />
                              <path d="M7 7l1 14h8l1-14" />
                              <path d="M10 11v6" />
                              <path d="M14 11v6" />
                            </svg>
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="wa-left-empty">{t("workspace.noHistory")}</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="wa-tabs" aria-label={t("workspace.tabsAria")}>
            <button
              type="button"
              className={activePanel === "bom" ? "active" : undefined}
              onClick={() => setActivePanel("bom")}
            >
              BOM
            </button>
            <button
              type="button"
              className={activePanel === "log" ? "active" : undefined}
              onClick={() => setActivePanel("log")}
            >
              {t("workspace.tabs.log")}
            </button>
            <button
              type="button"
              className={activePanel === "model" ? "active" : undefined}
              onClick={() => setActivePanel("model")}
            >
              {t("workspace.tabs.model")}
            </button>
            <div className="wa-tool-menu">
              <button type="button">{t("workspace.tabs.tools")} ▾</button>
              <div className="wa-tool-panel" role="menu" aria-label={t("workspace.toolsAria")}>
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
            {running ? t("workspace.status.running") : activeSession ? t("workspace.status.loaded") : t("workspace.status.waiting")}
          </div>
        </div>
      </header>

      {deleteTarget && (
        <div className="wa-delete-dialog-backdrop" role="presentation" onClick={() => !deletePending && setDeleteTarget(null)}>
          <section
            aria-labelledby="wa-delete-dialog-title"
            aria-modal="true"
            className="wa-delete-dialog"
            role="dialog"
            onClick={event => event.stopPropagation()}
          >
            <div className="wa-delete-dialog-body">
              <div className="wa-delete-dialog-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 5h6" />
                  <path d="M10 5l1-2h2l1 2" />
                  <path d="M5 7h14" />
                  <path d="M7 7l1 14h8l1-14" />
                  <path d="M10 11v6" />
                  <path d="M14 11v6" />
                </svg>
              </div>
              <h3 id="wa-delete-dialog-title">{t("home.deleteDialogTitle")}</h3>
              <p>{t("home.deleteDialogDescription", { title: deleteTarget.title })}</p>
              {deleteError && <span className="wa-delete-dialog-error">{deleteError}</span>}
            </div>
            <div className="wa-delete-dialog-actions">
              <button type="button" className="wa-delete-dialog-cancel" disabled={deletePending} onClick={() => setDeleteTarget(null)}>
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="wa-delete-dialog-danger"
                disabled={deletePending}
                onClick={async () => {
                  setDeletePending(true)
                  setDeleteError("")
                  try {
                    await handleDelete(deleteTarget.id)
                    setDeleteTarget(null)
                  } catch {
                    setDeleteError(t("home.deleteFailed"))
                  } finally {
                    setDeletePending(false)
                  }
                }}
              >
                {deletePending ? t("common.deleting") : t("common.delete")}
              </button>
            </div>
          </section>
        </div>
      )}

      <main className="wa-workspace">
        <aside className="wa-panel wa-chat wa-left-stack">
          <section className="wa-left-section wa-left-input">
            <div className="wa-left-section-header">
              <div>
                <strong>{t("workspace.input.title")}</strong>
                <span>{activeSession?.title || (activeSessionId ? t("workspace.input.session", { id: activeSessionId }) : t("workspace.input.newTask"))}</span>
              </div>
            </div>
            <div className="wa-left-input-body">
              {pendingAskUser ? (
                <div className="wa-left-pending">{t("workspace.input.pending")}</div>
              ) : (
                <AppleTaskComposer
                  compact
                  enableTools={false}
                  onSubmit={submitAndRefreshProgress}
                  onAbort={abort}
                  running={running}
                  placeholder={t("composer.compactPlaceholder")}
                />
              )}
            </div>
          </section>

          <AgentUnderstandingPanel
            currentEvents={currentEvents}
            currentPrompt={currentPrompt}
            onSubmitAskUser={answer => submitAndRefreshProgress(answer)}
            onStopAskUser={handleStopAskUser}
            pendingAskUser={pendingAskUser}
            turns={turns}
          />

          <RunLogPanel entries={logEntries} onSelect={handleSelectLog} selectedLogId={selectedLogId} />
        </aside>

        <section className="wa-panel wa-stage">
          <div className="wa-panel-header">
            <div className="wa-panel-title">
              <strong>{stageTitle}</strong>
              <span>{stageSubtitle}</span>
            </div>
          </div>
          <div className="wa-stage-body">
            {(activeTool || (activePanel === "model" && activeSessionId)) && (
              <div className="wa-stage-toolbar">
                <button
                  type="button"
                  className="wa-status-pill"
                  onClick={() => {
                    if (activePanel === "model") openExternalWindow(viewerHref)
                    if (activeTool) openExternalWindow(activeTool.url)
                  }}
                >
                  {activePanel === "model" ? "3D Viewer" : activeTool?.label}
                </button>
              </div>
            )}
            {activePanel === "model" ? (
              activeSessionId ? (
                <iframe className="wa-viewer" title={t("workspace.stage.modelTitle")} src={viewerHref} />
              ) : (
                <div className="wa-stage-empty">
                  <div className="wa-stage-empty-inner">
                    <strong>{t("workspace.stage.waitModelTitle")}</strong>
                    <span>{t("workspace.stage.waitModelDescription")}</span>
                  </div>
                </div>
              )
            ) : activePanel === "bom" ? (
              <div className="wa-bom-stage">
                <div className="wa-bom-stage-inner">
                  <h2>{t("workspace.stage.bomTitle")}</h2>
                  <p>{bomLoading ? `${t("workspace.stage.loadingBom")}...` : t("workspace.stage.bomSummary", { count: bomInfo.totalRecords })}</p>
                  {selectedBom ? (
                    <div className="wa-bom-detail">
                      <div className="wa-bom-detail-card">
                        {selectedBom.imageExists && selectedBom.imagePath ? (
                          <img
                            alt={getBomDisplayName(selectedBom)}
                            src={createImageUrl(selectedBom.imagePath) ?? ""}
                          />
                        ) : (
                          <div className="wa-file">
                            <span>{t("workspace.stage.noComponentImage")}</span>
                            <small>-</small>
                          </div>
                        )}
                      </div>
                      <div className="wa-bom-detail-card">
                        <h3>{selectedBom.componentId} · {getBomPrimaryName(selectedBom)}</h3>
                        <p>{selectedBom.description}</p>
                        <div className="wa-bom-detail-fields">
                          {[
                            [t("workspace.bomFields.componentId"), selectedBom.componentId],
                            [t("workspace.bomFields.semanticName"), selectedBom.semanticName],
                            [t("workspace.bomFields.model"), selectedBom.model],
                            [t("workspace.bomFields.quantity"), selectedBom.quantity],
                            [t("workspace.bomFields.subsystem"), selectedBom.subsystem],
                            [t("workspace.bomFields.kind"), selectedBom.kind],
                            [t("workspace.bomFields.category"), selectedBom.category],
                            [t("workspace.bomFields.dimensions"), selectedBom.dimensions || selectedBom.sizeMm],
                            [t("workspace.bomFields.mass"), selectedBom.massKg === null ? "-" : `${selectedBom.massKg} kg`],
                            [t("workspace.bomFields.power"), selectedBom.powerW === null ? "-" : `${selectedBom.powerW} W`],
                            [t("workspace.bomFields.material"), selectedBom.material],
                            [t("workspace.bomFields.mountFace"), selectedBom.mountFace],
                            [t("workspace.bomFields.source"), selectedBom.source],
                            ...Object.entries(selectedBom.thermal).map(([label, value]) => [t("workspace.bomFields.thermal", { label }), value]),
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
                          <strong>{getBomPrimaryName(component)}</strong>
                          <small>{component.subsystem || component.kind || t("common.component")} · x{component.quantity}</small>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : activePanel === "log" ? (
              <div className="wa-log-stage">
                <div className="wa-log-stage-inner">
                  <h2>{t("workspace.stage.logTitle")}</h2>
                  <p>{logEntries.length > 0 ? t("workspace.stage.logSummary", { count: logEntries.length }) : t("workspace.stage.noLogData")}</p>
                  {selectedLog ? (
                    <div className="wa-log-detail-card">
                      <h3>{selectedLog.title}</h3>
                      <p>{selectedLog.detail}</p>
                      <div className="wa-log-detail-grid">
                        {[
                          [t("workspace.logFields.status"), selectedLog.status],
                          [t("workspace.logFields.type"), selectedLog.type],
                          [t("workspace.logFields.time"), selectedLog.time ? formatStageLogTime(selectedLog.time) : "-"],
                          [t("workspace.logFields.source"), selectedLog.source ?? "-"],
                          ["ID", selectedLog.id],
                          ...Object.entries(selectedLog.fields ?? {}),
                        ].map(([label, value]) => (
                          <div className="wa-log-detail-field" key={label}>
                            <span>{label}</span>
                            <strong>{value}</strong>
                          </div>
                        ))}
                      </div>
                      {selectedLog.raw !== undefined && (
                        <pre className="wa-log-raw">{JSON.stringify(selectedLog.raw, null, 2)}</pre>
                      )}
                    </div>
                  ) : (
                    <div className="wa-log-detail-card">
                      <h3>{t("workspace.stage.logEmptyTitle")}</h3>
                      <p>{t("workspace.stage.logEmptyDescription")}</p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <iframe
                className="wa-viewer"
                title={activeTool?.label ?? t("workspace.stage.remoteToolTitle")}
                src={activeTool?.url ?? freecadHref}
              />
            )}
          </div>
          <div className="wa-stage-footer">
            <div>
              <strong>{bomInfo.totalRecords || "-"}</strong>
              <span>{t("workspace.footer.bomComponents")}</span>
            </div>
            <div>
              <strong>{turns.length}</strong>
              <span>{t("workspace.footer.turns")}</span>
            </div>
            <div>
              <strong>{running ? t("workspace.status.run") : t("workspace.status.idle")}</strong>
              <span>{t("workspace.footer.currentStatus")}</span>
            </div>
          </div>
        </section>

        <aside className="wa-panel wa-inspector">
          <div className="wa-panel-header">
            <div className="wa-panel-title">
              <strong>{t("workspace.inspector.title")}</strong>
              <span>{t("workspace.inspector.subtitle")}</span>
            </div>
          </div>
          <div className="wa-inspector-content">
            <section className="wa-info-card">
              <h3>{t("workspace.inspector.progressTitle")}</h3>
              <p>{t("workspace.inspector.updatedAt", { time: formatProgressUpdatedAt(progressData, i18n.language, t) })}</p>
              <div className="wa-progress">
                {workflowProgressEntries.map(item => (
                    <div className="wa-progress-item" key={item.key}>
                      <span>{item.label}</span>
                      <div className="wa-bar"><span style={{ width: `${item.percent}%` }} /></div>
                      <span>{`${item.percent}%`}</span>
                    </div>
                ))}
              </div>
            </section>

            <section className="wa-info-card">
              <h3>{t("workspace.inspector.bomTitle")}</h3>
              <p>{bomLoading ? `${t("workspace.stage.loadingBom")}...` : t("workspace.inspector.bomSummary", { count: bomInfo.totalRecords })}</p>
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
                      <strong title={getBomPrimaryName(component)}>{getBomPrimaryName(component)}</strong>
                      <small>x{component.quantity}</small>
                    </span>
                  </button>
                ))}
                {bomInfo.components.length === 0 && (
                  <div className="wa-file">
                    <span>{t("workspace.inspector.noBomData")}</span>
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
