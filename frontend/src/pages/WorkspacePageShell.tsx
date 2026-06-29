import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { joinApiPath } from "../app/apiBase"
import { getRemoteToolUrl } from "../app/runtimeConfig"
import { APP_NAVIGATION_EVENT } from "../app/sessionUtils"
import { useBomInfo } from "../hooks/useBomInfo"
import { useWorkspaceAppState } from "../hooks/useWorkspaceAppState"
import type { CodexInputItem } from "../types"
import { summarizeManagedCodex } from "./agent/managedRun"
import { useAgentSpeech } from "./agent/useAgentSpeech"
import { BomInspectorCard } from "./workspace/BomInspectorCard"
import { CurrentWorkspaceCard } from "./workspace/CurrentWorkspaceCard"
import { DeleteSessionDialog } from "./workspace/DeleteSessionDialog"
import { ProgressCard } from "./workspace/ProgressCard"
import { RunLogPanel } from "./workspace/RunLogPanel"
import { WorkspaceLeftPanel } from "./workspace/WorkspaceLeftPanel"
import { WorkspaceStagePanel } from "./workspace/WorkspaceStagePanel"
import { WorkspaceTopbar } from "./workspace/WorkspaceTopbar"
import { getVisibleWorkspaceSessionState } from "./workspace/workspaceSessionVisibility"
import {
  fetchWorkspaceManifest,
  getActiveVersion,
  isThermalCadWorkspace,
  resolveWorkspaceVersionContext,
} from "./workspace/workspaceVersion"
import type { WorkflowProgressVariant } from "./workspace/progressUtils"
import type { RunLogEntry } from "./workspace/runLogUtils"
import { useWorkspaceRuntimeData } from "./workspace/useWorkspaceRuntimeData"
import { useWorkspaceVersionState } from "./workspace/useWorkspaceVersionState"
import "./workspace/WorkspaceSessionPage.css"

const WORKSPACE_HOME_PATH = "/workspace"
const WORKSPACE_GEOMETRY_AFTER_GLB_PATH = "01_cad/geometry_after.glb"
const WORKSPACE_PANEL_PARAM_VALUES = ["bom", "log", "model", "cad", "paraview", "comsol"] as const

type ViewerComponentMessage = {
  componentId?: unknown
  semanticName?: unknown
  type?: unknown
}

type ActivePanel = "bom" | "log" | "model" | "cad" | "paraview" | "comsol"

function getInitialWorkspacePanel(showModel: boolean): ActivePanel {
  if (typeof window === "undefined") return showModel ? "model" : "log"
  const panel = new URLSearchParams(window.location.search).get("panel")
  if (WORKSPACE_PANEL_PARAM_VALUES.some(value => value === panel)) return panel as ActivePanel
  return showModel ? "model" : "log"
}

function isComplianceCheckWorkspaceContext(context: {
  versionDir?: string | null
  workspaceId?: string | null
  workspaceKey?: string | null
  workspaceName?: string | null
}) {
  const marker = [
    context.workspaceName,
    context.workspaceId,
    context.workspaceKey,
    context.versionDir,
  ].filter(Boolean).join("\n").toLowerCase()
  return /derating|降额/u.test(marker)
}

export interface WorkspacePageShellProps {
  apiBase?: string
  homePath?: string
  inspectorExtra?: ReactNode
  modelViewerUrl?: string
  progressVariant?: WorkflowProgressVariant
  showBom?: boolean
  showModel?: boolean
  showTools?: boolean
}

interface WorkspaceAppleContentProps {
  apiBase?: string
  inspectorExtra?: ReactNode
  modelViewerUrl?: string
  progressVariant?: WorkflowProgressVariant
  showBom?: boolean
  showModel?: boolean
  showTools?: boolean
  state: ReturnType<typeof useWorkspaceAppState>
}

export function WorkspaceAppleContent({ apiBase, inspectorExtra, modelViewerUrl, progressVariant = "thermal", showBom = true, showModel = true, showTools = true, state }: WorkspaceAppleContentProps) {
  const { i18n, t } = useTranslation()
  const {
    activeSessionId,
    currentEvents,
    currentPrompt,
    handleClearActiveSession,
    handleDelete,
    handleNew,
    handleSelectWorkspaceSession,
    handleStopAskUser,
    handleSubmit,
    isMobile: _isMobile,
    pendingAskUser,
    reloadSessions,
    running,
    runningWorkspace,
    sessionsLoaded,
    sortedSessions,
    turns,
    abort,
  } = state
  const [workspaceRefreshNonce, setWorkspaceRefreshNonce] = useState(0)
  const [selectedBomId, setSelectedBomId] = useState("")
  const [activePanel, setActivePanel] = useState<ActivePanel>(() => getInitialWorkspacePanel(showModel))
  const [progressRefreshNonce, setProgressRefreshNonce] = useState(0)
  const [selectedLogId, setSelectedLogId] = useState("")
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null)
  const [deleteError, setDeleteError] = useState("")
  const [deletePending, setDeletePending] = useState(false)
  const [stopSummaryPending, setStopSummaryPending] = useState(false)
  const { speakText } = useAgentSpeech()

  const activeSession = sortedSessions.find(session => session.id === activeSessionId)
  const remoteToolHost = typeof window !== "undefined" ? window.location.hostname : "localhost"
  const sessionWorkspaceSignature = useMemo(
    () => sortedSessions.map(session => [
      session.id,
      session.workspaceId ?? "",
      session.versionId ?? "",
      session.workspaceDir ?? "",
      session.createdAt,
      session.turns.length,
      session.turns.at(-1)?.events.length ?? 0,
      session.turns.at(-1)?.events.at(-1)?.type ?? "",
    ].join(":")).join("|"),
    [sortedSessions],
  )
  const refreshWorkspaceViews = useCallback(() => {
    setSelectedBomId("")
    setSelectedLogId("")
    setWorkspaceRefreshNonce(value => value + 1)
    setProgressRefreshNonce(value => value + 1)
  }, [])
  const reloadSessionsQuietly = useCallback(() => {
    reloadSessions().catch(() => {})
  }, [reloadSessions])
  const {
    activeContext,
    activeManifestVersion,
    branchManifest,
    cancelDeleteVersion,
    checkoutVersion,
    confirmDeleteVersion,
    createChildBranch,
    createInitialVersion,
    createVersionFromInput,
    manifestLoading,
    requestDeleteVersion,
    setBranchManifest,
    switchActiveWorkspace,
    versionAction,
    versionDeleteTarget,
    versionError,
    workspaceChanging,
    workspaceItems,
    workspaces,
    workspacesLoaded,
  } = useWorkspaceVersionState({
    apiBase,
    fallbackWorkspaceName: t("workspace.noWorkspace"),
    manifestRefreshKey: activeSessionId,
    onRefreshWorkspaceViews: refreshWorkspaceViews,
    onReloadSessions: reloadSessionsQuietly,
    workspaceRefreshNonce,
  })
  const { bomInfo, loading: bomLoading } = useBomInfo(workspaceRefreshNonce, {
    apiBase,
    enabled: showBom && !!activeContext.versionDir,
    versionDir: activeContext.versionDir,
    versionId: activeContext.versionId,
    workspaceId: activeContext.workspaceId,
  })
  const selectedBom = bomInfo.components.find(component => component.componentId === selectedBomId) ?? bomInfo.components[0]
  const {
    activeSessionMatchesWorkspace,
    sessionStatus,
    visibleCurrentEvents,
    visibleCurrentPrompt,
    visiblePendingAskUser,
    visibleRunning,
    visibleTurns,
  } = getVisibleWorkspaceSessionState({
    activeContext,
    activeSession,
    currentEvents,
    currentPrompt,
    pendingAskUser,
    running,
    runningWorkspace,
    turns,
  })
  const {
    logEntries,
    progressData,
    resetProgressData,
    workflowLoopProgressEntries,
    workflowProgressSummary,
  } = useWorkspaceRuntimeData({
    activeContext,
    apiBase,
    progressRefreshNonce,
    progressVariant,
    running,
    t,
    visibleCurrentEvents,
    visibleTurns,
    workspaceRefreshNonce,
    sessionId: activeSessionId,
  })
  const selectedLog = logEntries.find(entry => entry.id === selectedLogId) ?? logEntries[0] ?? null
  const externalModelViewerUrl = modelViewerUrl?.trim() ?? ""
  const canUseDefaultModelPreview = isThermalCadWorkspace(activeContext)
  const effectiveShowModel = showModel && (!!externalModelViewerUrl || canUseDefaultModelPreview)
  const hasModelPreview = effectiveShowModel && (!!externalModelViewerUrl || !!activeContext.versionDir)
  const viewerHref = useMemo(() => {
    if (externalModelViewerUrl) return externalModelViewerUrl
    if (!canUseDefaultModelPreview) return ""
    const params = new URLSearchParams()
    params.set("glbPath", WORKSPACE_GEOMETRY_AFTER_GLB_PATH)
    if (activeContext.workspaceKey) params.set("workspaceKey", activeContext.workspaceKey)
    if (activeContext.workspaceId) params.set("workspaceId", activeContext.workspaceId)
    if (activeContext.versionId) params.set("versionId", activeContext.versionId)
    if (activeContext.versionDir) params.set("workspaceDir", activeContext.versionDir)
    if (isComplianceCheckWorkspaceContext(activeContext)) {
      params.set("mode", "derating")
      params.set("lockMode", "derating")
    }
    if (workspaceRefreshNonce > 0) params.set("workspaceVersion", String(workspaceRefreshNonce))
    const query = params.toString()
    return query ? `/viewer?${query}` : "/viewer"
  }, [activeContext, canUseDefaultModelPreview, externalModelViewerUrl, progressVariant, workspaceRefreshNonce])
  const cadHref = getRemoteToolUrl("cad", remoteToolHost)
  const paraviewHref = getRemoteToolUrl("paraview", remoteToolHost)
  const comsolHref = getRemoteToolUrl("comsol", remoteToolHost)
  const visibleActivePanel: ActivePanel = activePanel === "model" && !effectiveShowModel ? "log" : activePanel
  const activeTool = visibleActivePanel === "cad"
    ? { label: "CAD", subtitle: t("workspace.tools.cadSubtitle"), title: t("workspace.tools.cadTitle"), url: cadHref }
    : visibleActivePanel === "paraview"
      ? { label: "ParaView", subtitle: t("workspace.tools.paraviewSubtitle"), title: t("workspace.tools.paraviewTitle"), url: paraviewHref }
      : visibleActivePanel === "comsol"
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
    resetProgressData()
    setProgressRefreshNonce(value => value + 1)
    const submitWithContext = (context: typeof activeContext) => {
      handleSubmit(input, enabledSkills, {
        workspaceDir: context.versionDir,
        workspaceId: context.workspaceId,
        workspaceName: context.workspaceName,
        versionId: context.versionId,
      })
    }

    if (!activeContext.versionDir && activeContext.manifestRoot) {
      fetchWorkspaceManifest({
        initialize: true,
        apiBase,
        manifestRoot: activeContext.manifestRoot,
        sourceWorkspaceDir: activeContext.initialSourceWorkspaceDir,
        workspaceId: activeContext.workspaceId,
        workspaceKey: activeContext.workspaceKey,
      })
        .then(data => {
          if (!data) {
            submitWithContext(activeContext)
            return
          }
          const activeVersion = getActiveVersion(data)
          const initializedContext = activeVersion?.workspaceDir
            ? {
              ...activeContext,
              manifestRoot: data.rootDir ?? activeContext.manifestRoot,
              manifestSessionId: data.sessionId ?? activeContext.manifestSessionId,
              versionDir: activeVersion.workspaceDir,
              versionId: activeVersion.id ?? null,
              workspaceId: data.workspaceId ?? activeContext.workspaceId,
              workspaceKey: data.workspaceId ?? activeContext.workspaceKey,
              workspaceRoot: data.rootDir ?? activeContext.workspaceRoot,
            }
            : resolveWorkspaceVersionContext({
              branchManifest: data,
              fallbackWorkspaceName: activeContext.workspaceName,
              workspaces,
            })
          setBranchManifest(data)
          refreshWorkspaceViews()
          submitWithContext(initializedContext)
        })
        .catch(() => submitWithContext(activeContext))
      window.setTimeout(() => setProgressRefreshNonce(value => value + 1), 150)
      return
    }

    submitWithContext(activeContext)
    window.setTimeout(() => setProgressRefreshNonce(value => value + 1), 150)
  }, [activeContext, handleSubmit, refreshWorkspaceViews, resetProgressData, workspaces])

  const handleStopAndSummarize = useCallback(async () => {
    if (!activeSessionId || stopSummaryPending) return
    setStopSummaryPending(true)
    abort(activeSessionId)
    try {
      const result = await summarizeManagedCodex({
        apiBase,
        input: "请总结当前或刚才停止的 Agent 任务已经完成的进度和结果。",
        sessionId: activeSessionId,
        threadId: activeSession?.threadId ?? null,
        workspace: {
          workspaceDir: activeContext.versionDir,
          workspaceId: activeContext.workspaceId,
          workspaceName: activeContext.workspaceName,
          versionId: activeContext.versionId,
        },
      })
      const speechText = result.spokenSummary || result.summary || "任务已停止，当前进度已总结。"
      void speakText(speechText, `workspace-stop-summary:${activeSessionId}:${Date.now()}`)
      reloadSessionsQuietly()
      setProgressRefreshNonce(value => value + 1)
    } catch {
      void speakText("任务已停止，但总结生成失败。", `workspace-stop-summary-error:${activeSessionId}:${Date.now()}`)
    } finally {
      setStopSummaryPending(false)
    }
  }, [abort, activeContext.versionDir, activeContext.versionId, activeContext.workspaceId, activeContext.workspaceName, activeSession?.threadId, activeSessionId, apiBase, reloadSessionsQuietly, speakText, stopSummaryPending])

  const handleSelectLog = useCallback((entry: RunLogEntry) => {
    setSelectedLogId(entry.id)
    setActivePanel("log")
  }, [])

  const handleReturnHome = useCallback(() => {
    window.history.pushState(null, "", "/home")
    window.dispatchEvent(new Event(APP_NAVIGATION_EVENT))
  }, [])

  const handleSelectWorkspace = useCallback((name: string) => {
    if (name === activeContext.workspaceName) return

    switchActiveWorkspace(name).then(() => {
      handleNew()
    })
  }, [activeContext.workspaceName, handleNew, switchActiveWorkspace])

  const currentWorkspaceCard = (
    <CurrentWorkspaceCard
      activeManifestVersion={activeManifestVersion}
      branchManifest={branchManifest}
      currentWorkspaceName={activeContext.workspaceName}
      manifestLoading={manifestLoading}
      onCheckoutVersion={checkoutVersion}
      onCancelDeleteVersion={cancelDeleteVersion}
      onConfirmDeleteVersion={confirmDeleteVersion}
      onCreateChildBranch={createChildBranch}
      onCreateInitialVersion={createInitialVersion}
      onCreateVersionFromInput={createVersionFromInput}
      onRequestDeleteVersion={requestDeleteVersion}
      onSelectWorkspace={handleSelectWorkspace}
      versionAction={versionAction}
      versionDeleteTarget={versionDeleteTarget}
      versionError={versionError}
      workspaceChanging={workspaceChanging}
      workspaceItems={workspaceItems}
    />
  )
  const progressCard = (
    <ProgressCard
      entries={workflowLoopProgressEntries}
      language={i18n.language}
      progressData={progressData}
      summary={workflowProgressSummary}
      t={t}
    />
  )

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
    resetProgressData()
  }, [activeSessionId, resetProgressData])

  useEffect(() => {
    resetProgressData()
    setSelectedLogId("")
    setProgressRefreshNonce(value => value + 1)
  }, [activeContext.versionDir, activeContext.versionId, resetProgressData])

  useEffect(() => {
    if (!sessionsLoaded) return
    if (!workspacesLoaded) return
    if (manifestLoading) return
    if (!activeContext.versionDir && !activeContext.versionId) {
      if (workspaceItems.length === 0) handleClearActiveSession()
      return
    }
    if (!activeContext.versionDir && (!activeContext.workspaceId || !activeContext.versionId)) return
    handleSelectWorkspaceSession({
      workspaceDir: activeContext.versionDir,
      workspaceId: activeContext.workspaceId,
      workspaceName: activeContext.workspaceName,
      versionId: activeContext.versionId,
    })
  }, [activeContext.versionDir, activeContext.versionId, activeContext.workspaceId, activeContext.workspaceName, handleClearActiveSession, handleSelectWorkspaceSession, manifestLoading, sessionWorkspaceSignature, sessionsLoaded, workspaceItems.length, workspacesLoaded])

  useEffect(() => {
    if (selectedLogId && logEntries.some(entry => entry.id === selectedLogId)) return
    setSelectedLogId(logEntries[0]?.id ?? "")
  }, [logEntries, selectedLogId])

  useEffect(() => {
    if (!showBom && activePanel === "bom") setActivePanel(effectiveShowModel ? "model" : "log")
  }, [activePanel, effectiveShowModel, showBom])

  useEffect(() => {
    if (!effectiveShowModel && activePanel === "model") setActivePanel("log")
  }, [activePanel, effectiveShowModel])

  useEffect(() => {
    if (!showTools && (activePanel === "cad" || activePanel === "paraview" || activePanel === "comsol")) setActivePanel("log")
  }, [activePanel, showTools])

  useEffect(() => {
    if (!showTools) return

    fetch(joinApiPath(apiBase, "/remote-tools/ensure-desktops"), { method: "POST" })
      .then(response => {
        if (!response.ok) {
          console.warn("Failed to ensure remote desktop mappings", response.status)
        }
      })
      .catch(error => {
        console.warn("Failed to ensure remote desktop mappings", error)
      })
  }, [apiBase, showTools])

  const stageTitle = visibleActivePanel === "model"
    ? t("workspace.stage.modelTitle")
    : visibleActivePanel === "bom" && showBom
      ? t("workspace.stage.bomTitle")
      : visibleActivePanel === "log"
        ? t("workspace.stage.logTitle")
        : activeTool?.title ?? t("workspace.stage.toolTitle")
  const stageSubtitle = visibleActivePanel === "model"
    ? hasModelPreview ? t("workspace.stage.currentModel") : t("workspace.stage.waitingModel")
    : visibleActivePanel === "bom" && showBom
      ? bomLoading ? t("workspace.stage.loadingBom") : t("workspace.stage.components", { count: bomInfo.totalRecords })
      : visibleActivePanel === "log"
        ? selectedLog ? selectedLog.title : t("workspace.stage.waitingLog")
        : activeTool?.subtitle ?? t("workspace.stage.remoteTool")

  return (
    <div className="workspace-apple">
      <WorkspaceTopbar
        activePanel={visibleActivePanel}
        activeSessionMatchesWorkspace={activeSessionMatchesWorkspace}
        onStopAndSummarize={activeSessionId ? handleStopAndSummarize : undefined}
        onReturnHome={handleReturnHome}
        onSelectPanel={setActivePanel}
        showBom={showBom}
        showModel={effectiveShowModel}
        showTools={showTools}
        sessionStatus={sessionStatus}
        stopSummaryPending={stopSummaryPending}
        t={t}
        visibleRunning={visibleRunning}
      />

      {deleteTarget && (
        <DeleteSessionDialog
          deleteError={deleteError}
          deletePending={deletePending}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={async () => {
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
          target={deleteTarget}
          t={t}
        />
      )}

      <main className="wa-workspace">
        <WorkspaceLeftPanel
          abort={abort}
          activeSessionId={activeSessionId}
          activeSessionTitle={activeSession?.title}
          apiBase={apiBase}
          currentEvents={visibleCurrentEvents}
          currentPrompt={visibleCurrentPrompt}
          logEntries={logEntries}
          onSelectLog={handleSelectLog}
          onStopAskUser={handleStopAskUser}
          onSubmit={submitAndRefreshProgress}
          onSubmitAskUser={answer => submitAndRefreshProgress(answer)}
          pendingAskUser={visiblePendingAskUser}
          selectedLogId={selectedLogId}
          showRunLog={false}
          t={t}
          topContent={currentWorkspaceCard}
          turns={visibleTurns}
          visibleRunning={visibleRunning}
        />

        <WorkspaceStagePanel
          activePanel={visibleActivePanel}
          activeContext={activeContext}
          activeTool={activeTool}
          apiBase={apiBase}
          bomInfo={bomInfo}
          bomLoading={bomLoading}
          cadHref={cadHref}
          hasModelPreview={hasModelPreview}
          logEntries={logEntries}
          onOpenExternalWindow={openExternalWindow}
          onRefreshWorkspaceViews={refreshWorkspaceViews}
          onSelectBom={setSelectedBomId}
          selectedBom={selectedBom}
          selectedLog={selectedLog}
          showBom={showBom}
          showModel={effectiveShowModel}
          showTools={showTools}
          stageSubtitle={stageSubtitle}
          stageTitle={stageTitle}
          t={t}
          viewerHref={viewerHref}
          visibleRunning={visibleRunning}
          visibleTurnsCount={visibleTurns.length}
        />

        <aside className="wa-panel wa-inspector">
          <div className="wa-inspector-content workspace-right-layout">
            {progressCard}

            <RunLogPanel
              entries={logEntries}
              onSelect={handleSelectLog}
              selectedLogId={selectedLogId}
              variant="info"
            />

            {showBom && (
              <BomInspectorCard
                bomInfo={bomInfo}
                bomLoading={bomLoading}
                components={orderedBomComponents}
                onOpenBom={componentId => {
                  setSelectedBomId(componentId)
                  setActivePanel("bom")
                }}
                selectedBomId={selectedBomId}
                t={t}
              />
            )}
            {inspectorExtra}

          </div>
        </aside>
      </main>
    </div>
  )
}

export default function WorkspacePageShell({ apiBase, homePath = WORKSPACE_HOME_PATH, inspectorExtra, modelViewerUrl, progressVariant = "thermal", showBom = true, showModel = true, showTools = true }: WorkspacePageShellProps) {
  const state = useWorkspaceAppState({ apiBase, homePath })
  return (
    <WorkspaceAppleContent
      key={`${apiBase ?? ""}:${homePath}`}
      apiBase={apiBase}
      inspectorExtra={inspectorExtra}
      modelViewerUrl={modelViewerUrl}
      progressVariant={progressVariant}
      showBom={showBom}
      showModel={showModel}
      showTools={showTools}
      state={state}
    />
  )
}
