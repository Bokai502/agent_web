import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { joinApiPath } from '../app/apiBase'
import { useBomInfo } from '../hooks/useBomInfo'
import { useWorkspaceAppState } from '../hooks/useWorkspaceAppState'
import { formatProgressUpdatedAt, type WorkflowProgressVariant } from './workspace/progressUtils'
import { useWorkspaceRuntimeData } from './workspace/useWorkspaceRuntimeData'
import { useWorkspaceVersionState } from './workspace/useWorkspaceVersionState'
import {
  fetchWorkspaceManifest,
  getActiveVersion,
  resolveWorkspaceVersionContext,
} from './workspace/workspaceVersion'
import { getVisibleWorkspaceSessionState } from './workspace/workspaceSessionVisibility'
import { AgentProgressRail } from './agent/AgentProgressRail'
import { AgentConversationPopover } from './agent/AgentConversationPopover'
import { AgentRecorderControl } from './agent/AgentRecorderControl'
import { AgentSideNav } from './agent/AgentSideNav'
import { AgentTopbar } from './agent/AgentTopbar'
import { AgentVoiceExchange } from './agent/AgentVoiceExchange'
import { AgentWorkspacePanel } from './agent/AgentWorkspacePanel'
import { cancelManagedCodex, dispatchManagedCodex, getLatestManagedCodexStatus, getManagedCodexStatus, subscribeManagedCodexStatus, summarizeManagedCodex, type ManagedRunStatusResponse } from './agent/managedRun'
import {
  AGENT_HOME_PATH,
  NAV_ITEMS,
  NAV_VIEWS,
  NOVNC_URL_PARAMS,
  WORKSPACE_GEOMETRY_AFTER_GLB_PATH,
} from './agent/constants'
import type {
  AgentToolView,
  AgentWorkspaceView,
  ViewerComponentMessage,
} from './agent/types'
import { useAgentSpeech } from './agent/useAgentSpeech'
import { getRecorderStatusText, useAgentRecorder } from './agent/useAgentRecorder'
import { useWorkspaceFilePreview } from './agent/useWorkspaceFilePreview'
import './AgentPage.css'

type AgentInputMode = 'voice' | 'text'

export default function AgentPage() {
  const { t } = useTranslation()
  const [activeView, setActiveView] = useState<AgentWorkspaceView | null>(null)
  const [activeTool, setActiveTool] = useState<AgentToolView>('cad')
  const [conversationPanelOpen, setConversationPanelOpen] = useState(false)
  const [progressPanelOpen, setProgressPanelOpen] = useState(false)
  const [workspaceRefreshNonce, setWorkspaceRefreshNonce] = useState(0)
  const [progressRefreshNonce, setProgressRefreshNonce] = useState(0)
  const [inputMode, setInputMode] = useState<AgentInputMode>('voice')
  const [textInput, setTextInput] = useState('')
  const [textInputDisplay, setTextInputDisplay] = useState('')
  const [managedVoiceRunning, setManagedVoiceRunning] = useState(false)
  const [latestManagedStatus, setLatestManagedStatus] = useState<ManagedRunStatusResponse | null>(null)
  const [stopSummaryPending, setStopSummaryPending] = useState(false)
  const [selectedBomId, setSelectedBomId] = useState('')
  const [selectedLogId, setSelectedLogId] = useState('')
  const managedPollTokenRef = useRef(0)
  const resetProgressDataRef = useRef<(() => void) | null>(null)
  const remoteToolHost = typeof window !== 'undefined' ? window.location.hostname : 'localhost'
  const workspaceAppState = useWorkspaceAppState({ homePath: AGENT_HOME_PATH })

  const refreshWorkspaceViews = useCallback(() => {
    setSelectedBomId('')
    setSelectedLogId('')
    setWorkspaceRefreshNonce(value => value + 1)
    setProgressRefreshNonce(value => value + 1)
  }, [])
  const versionState = useWorkspaceVersionState({
    fallbackWorkspaceName: '当前工作区',
    onRefreshWorkspaceViews: refreshWorkspaceViews,
    onReloadSessions: () => {},
    workspaceRefreshNonce,
  })
  const {
    activeContext,
    activeManifestVersion,
    branchManifest,
    checkoutVersion,
    createChildBranch,
    createSiblingBranch,
    manifestLoading,
    setVersionListOpen,
    setWorkspaceListOpen,
    switchActiveWorkspace,
    versionAction,
    versionError,
    versionListOpen,
    versionTreeRoots,
    workspaceChanging,
    workspaceItems,
    workspaceListOpen,
    workspaces,
  } = versionState
  const { bomInfo, loading: bomLoading } = useBomInfo(workspaceRefreshNonce, {
    enabled: !!activeContext.versionDir,
    versionDir: activeContext.versionDir,
    versionId: activeContext.versionId,
    workspaceId: activeContext.workspaceId,
  })
  const selectedBom = bomInfo.components.find(component => component.componentId === selectedBomId) ?? bomInfo.components[0]
  const activeSession = workspaceAppState.sortedSessions.find(session => session.id === workspaceAppState.activeSessionId)
  const {
    sessionStatus,
    visibleCurrentEvents,
    visibleRunning,
    visibleTurns,
  } = getVisibleWorkspaceSessionState({
    activeContext,
    activeSession,
    currentEvents: workspaceAppState.currentEvents,
    currentPrompt: workspaceAppState.currentPrompt,
    pendingAskUser: workspaceAppState.pendingAskUser,
    running: workspaceAppState.running,
    runningWorkspace: workspaceAppState.runningWorkspace,
    turns: workspaceAppState.turns,
  })
  const viewerHref = useMemo(() => {
    const params = new URLSearchParams()
    params.set('glbPath', WORKSPACE_GEOMETRY_AFTER_GLB_PATH)
    if (activeContext.workspaceKey) params.set('workspaceKey', activeContext.workspaceKey)
    if (activeContext.workspaceId) params.set('workspaceId', activeContext.workspaceId)
    if (activeContext.versionId) params.set('versionId', activeContext.versionId)
    if (activeContext.versionDir) params.set('workspaceDir', activeContext.versionDir)
    if (workspaceRefreshNonce > 0) params.set('workspaceVersion', String(workspaceRefreshNonce))
    return `/viewer?${params.toString()}`
  }, [activeContext.versionDir, activeContext.versionId, activeContext.workspaceId, activeContext.workspaceKey, workspaceRefreshNonce])
  const toolUrls = useMemo(() => ({
    cad: `http://${remoteToolHost}:6080/${NOVNC_URL_PARAMS}`,
    paraview: `http://${remoteToolHost}:6081/${NOVNC_URL_PARAMS}`,
    comsol: `http://${remoteToolHost}:6082/${NOVNC_URL_PARAMS}`,
    gnc: 'http://10.110.10.11:8765/',
  }), [remoteToolHost])
  const progressVariant = useMemo<WorkflowProgressVariant>(() => {
    const marker = [
      activeContext.workspaceId,
      activeContext.workspaceKey,
      activeContext.versionDir,
    ].filter(Boolean).join("\n").toLowerCase()
    if (/derating|降额|check/.test(marker)) return "check"
    if (/gnc|aignc|adcs|region/.test(marker)) return "gnc"
    return "thermal"
  }, [activeContext.versionDir, activeContext.workspaceId, activeContext.workspaceKey])
  const showGncConfig = progressVariant === "gnc"
  const navItems = useMemo(() => {
    if (!showGncConfig) return NAV_ITEMS
    return NAV_ITEMS.map(item => (
      item.href === '#bom'
        ? { ...item, label: '配置文件', meta: 'Config' }
        : item
    ))
  }, [showGncConfig])
  const {
    handleSelectFile,
    selectedFileError,
    selectedFileLoading,
    selectedFilePath,
    selectedFilePreview,
  } = useWorkspaceFilePreview(activeContext)
  const {
    agentSpeechError,
    agentSpeechPlaying,
    agentSpeechState,
    clearAgentSpeechDisplay,
    showSpeechText,
    speakText,
    stopAgentSpeechPlayback,
    visibleAgentResponse,
  } = useAgentSpeech()

  const runCodex = useCallback(async (transcript: string, inputType: AgentInputMode = 'voice') => {
    resetProgressDataRef.current?.()
    setProgressRefreshNonce(value => value + 1)
    setManagedVoiceRunning(true)
    let backgroundRunStarted = false

    const handleManagedCompletion = async (
      managedRunId: string,
      startedTurnId: string,
      token: number,
      status: ManagedRunStatusResponse,
    ) => {
      if (managedPollTokenRef.current !== token) return
      if (status.status === 'running') return

      setManagedVoiceRunning(false)
      const reloadedSessions = await workspaceAppState.reloadSessions()
      const sessionId = status.sessionId
      if (sessionId && reloadedSessions.some(session => session.id === sessionId)) {
        workspaceAppState.handleSelect(sessionId)
      }
      setProgressRefreshNonce(value => value + 1)
      refreshWorkspaceViews()

      const speechText = status.spokenSummary || status.summary || (
        status.status === 'failed' ? '任务执行失败，请查看详情。' : '任务已完成。'
      )
      showSpeechText(speechText)
      void speakText(speechText, `${managedRunId}:finished:${startedTurnId}`)
    }

    const watchManagedCompletion = (managedRunId: string, startedTurnId: string, token: number) => {
      let closed = false
      let fallbackTimer: number | null = null
      const close = () => {
        closed = true
        if (fallbackTimer !== null) window.clearTimeout(fallbackTimer)
        unsubscribe()
      }
      const scheduleFallback = () => {
        if (fallbackTimer !== null) return
        fallbackTimer = window.setTimeout(async () => {
          fallbackTimer = null
          if (closed || managedPollTokenRef.current !== token) return
          const status = await getManagedCodexStatus(managedRunId).catch(() => null)
          if (!status || status.status === 'running') {
            scheduleFallback()
            return
          }
          close()
          void handleManagedCompletion(managedRunId, startedTurnId, token, status)
        }, 5000)
      }
      const unsubscribe = subscribeManagedCodexStatus(
        managedRunId,
        (status) => {
          if (closed || managedPollTokenRef.current !== token) return
          if (status.status === 'running') return
          close()
          void handleManagedCompletion(managedRunId, startedTurnId, token, status)
        },
        () => {
          if (!closed) scheduleFallback()
        },
      )
    }

    const runManagedWithContext = async (context: typeof activeContext) => {
      const result = await dispatchManagedCodex({
        input: transcript,
        inputType,
        workspace: {
          workspaceDir: context.versionDir,
          workspaceId: context.workspaceId,
          workspaceName: context.workspaceName,
          versionId: context.versionId,
        },
      })
      const reloadedSessions = await workspaceAppState.reloadSessions()
      const sessionId = result.sessionId
      if (sessionId && reloadedSessions.some(session => session.id === sessionId)) {
        workspaceAppState.handleSelect(sessionId)
      }
      setProgressRefreshNonce(value => value + 1)
      if (result.status === 'started') refreshWorkspaceViews()
      const speechText = result.spokenSummary || result.summary || (result.status === 'started' ? '任务已开始。' : '当前任务正在处理中。')
      showSpeechText(speechText)
      void speakText(speechText, result.managedRunId ?? result.turnId ?? transcript)
      if (result.status === 'started' && result.managedRunId) {
        backgroundRunStarted = true
        const pollToken = managedPollTokenRef.current + 1
        managedPollTokenRef.current = pollToken
        watchManagedCompletion(result.managedRunId, result.turnId, pollToken)
      } else {
        setManagedVoiceRunning(false)
      }
    }

    try {
      if (!activeContext.versionDir && activeContext.manifestRoot) {
        try {
          const data = await fetchWorkspaceManifest({
            initialize: true,
            manifestRoot: activeContext.manifestRoot,
            sourceWorkspaceDir: activeContext.sourceWorkspaceDir,
            workspaceId: activeContext.workspaceId,
            workspaceKey: activeContext.workspaceKey,
          })
          if (!data) {
            await runManagedWithContext(activeContext)
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
          versionState.setBranchManifest(data)
          refreshWorkspaceViews()
          await runManagedWithContext(initializedContext)
        } catch {
          await runManagedWithContext(activeContext)
        }
        return
      }

      await runManagedWithContext(activeContext)
    } finally {
      if (!backgroundRunStarted) setManagedVoiceRunning(false)
    }
  }, [activeContext, refreshWorkspaceViews, showSpeechText, speakText, versionState, workspaceAppState, workspaces])

  const handleStopAndSummarize = useCallback(async () => {
    if (stopSummaryPending) return
    let stoppedSessionId = workspaceAppState.runningSessionId ?? workspaceAppState.activeSessionId ?? null
    setStopSummaryPending(true)
    try {
      const refreshedStatus = latestManagedStatus?.status === 'running'
        ? latestManagedStatus
        : await getLatestManagedCodexStatus({
            versionId: activeContext.versionId,
            workspaceDir: activeContext.versionDir,
            workspaceId: activeContext.workspaceId,
          }).catch(() => null)
      const runningManagedStatus = refreshedStatus?.status === 'running' ? refreshedStatus : null
      if (refreshedStatus && refreshedStatus.status !== 'none') setLatestManagedStatus(refreshedStatus)
      const sessionId = runningManagedStatus?.sessionId ?? workspaceAppState.runningSessionId ?? workspaceAppState.activeSessionId
      const threadId = runningManagedStatus?.threadId ?? activeSession?.threadId ?? null
      stoppedSessionId = sessionId

      workspaceAppState.abort(sessionId)
      const result = runningManagedStatus?.managedRunId
        ? await cancelManagedCodex(runningManagedStatus.managedRunId)
        : await summarizeManagedCodex({
            input: '请总结当前或刚才停止的 Codex 任务已经完成的进度和结果。',
            sessionId,
            threadId,
            workspace: {
              workspaceDir: activeContext.versionDir,
              workspaceId: activeContext.workspaceId,
              workspaceName: activeContext.workspaceName,
              versionId: activeContext.versionId,
            },
          })
      const speechText = result.spokenSummary || result.summary || '任务已停止，当前进度已总结。'
      showSpeechText(speechText)
      void speakText(speechText, `agent-stop-summary:${sessionId ?? 'workspace'}:${Date.now()}`)
      await workspaceAppState.reloadSessions().catch(() => null)
      const latestStatus = await getLatestManagedCodexStatus({
        versionId: activeContext.versionId,
        workspaceDir: activeContext.versionDir,
        workspaceId: activeContext.workspaceId,
      }).catch(() => null)
      setLatestManagedStatus(latestStatus && latestStatus.status !== 'none' ? latestStatus : null)
      setManagedVoiceRunning(false)
      setProgressRefreshNonce(value => value + 1)
      refreshWorkspaceViews()
    } catch {
      const fallback = '任务已停止，但总结生成失败。'
      showSpeechText(fallback)
      void speakText(fallback, `agent-stop-summary-error:${stoppedSessionId ?? 'workspace'}:${Date.now()}`)
    } finally {
      setStopSummaryPending(false)
    }
  }, [activeContext.versionDir, activeContext.versionId, activeContext.workspaceId, activeContext.workspaceName, activeSession?.threadId, latestManagedStatus, refreshWorkspaceViews, showSpeechText, speakText, stopSummaryPending, workspaceAppState])
  const {
    error,
    startRecording,
    state,
    stopRecording,
    text,
  } = useAgentRecorder({
    clearAgentSpeechDisplay,
    runCodex,
    running: visibleRunning || workspaceAppState.running || managedVoiceRunning,
  })
  const conversationLogSessionId = latestManagedStatus?.status === 'running'
    ? latestManagedStatus.sessionId
    : workspaceAppState.runningSessionId ?? workspaceAppState.activeSessionId
  const {
    conversationLogs,
    logEntries,
    progressData,
    resetProgressData,
    workflowLoopProgressEntries,
  } = useWorkspaceRuntimeData({
    activeContext,
    enableConversationLogs: conversationPanelOpen,
    enableConversationLogRefresh: conversationPanelOpen && (visibleRunning || managedVoiceRunning || latestManagedStatus?.status === 'running'),
    enableRunLogEntries: activeView === 'log',
    enableStageLogs: activeView === 'log',
    progressRefreshNonce,
    progressVariant,
    running: visibleRunning || managedVoiceRunning || state === 'transcribing',
    t,
    visibleCurrentEvents,
    visibleTurns,
    workspaceRefreshNonce,
    sessionId: conversationLogSessionId,
  })
  resetProgressDataRef.current = resetProgressData
  const selectedLog = logEntries.find(entry => entry.id === selectedLogId) ?? logEntries[0] ?? null
  const recorderStatusText = getRecorderStatusText(state, visibleRunning || managedVoiceRunning)

  useEffect(() => {
    resetProgressData()
  }, [activeContext.versionDir, activeContext.versionId, resetProgressData])

  useEffect(() => {
    if (state === 'done') {
      setProgressRefreshNonce(value => value + 1)
    }
  }, [state])

  useEffect(() => {
    let cancelled = false
    const loadLatestManagedStatus = async () => {
      if (!activeContext.versionDir && !activeContext.workspaceId && !activeContext.versionId) {
        setLatestManagedStatus(null)
        return
      }
      const status = await getLatestManagedCodexStatus({
        versionId: activeContext.versionId,
        workspaceDir: activeContext.versionDir,
        workspaceId: activeContext.workspaceId,
      }).catch(() => null)
      if (cancelled) return
      if (!status || status.status === 'none') {
        setLatestManagedStatus(null)
        return
      }
      setLatestManagedStatus(status)
    }

    void loadLatestManagedStatus()
    const intervalId = window.setInterval(loadLatestManagedStatus, latestManagedStatus?.status === 'running' || managedVoiceRunning ? 1500 : 5000)
    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [activeContext.versionDir, activeContext.versionId, activeContext.workspaceId, latestManagedStatus?.status, managedVoiceRunning])

  useEffect(() => {
    if (activeView !== 'tools') return

    fetch(joinApiPath(undefined, '/remote-tools/ensure-desktops'), { method: 'POST' })
      .then(response => {
        if (!response.ok) {
          console.warn('Failed to ensure remote desktop mappings', response.status)
        }
      })
      .catch(error => {
        console.warn('Failed to ensure remote desktop mappings', error)
      })
  }, [activeView])

  useEffect(() => {
    if (selectedLogId && logEntries.some(entry => entry.id === selectedLogId)) return
    setSelectedLogId(logEntries[0]?.id ?? '')
  }, [logEntries, selectedLogId])

  useEffect(() => {
    const handleViewerMessage = (event: MessageEvent<ViewerComponentMessage>) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type !== 'viewer3d:component-selected') return
      if (typeof event.data.componentId !== 'string') return
      const semanticName = typeof event.data.semanticName === 'string' ? event.data.semanticName : ''
      const matchedComponent = bomInfo.components.find(component =>
        component.componentId === event.data.componentId ||
        (!!semanticName && component.semanticName === semanticName),
      )
      setSelectedBomId(matchedComponent?.componentId ?? event.data.componentId)
    }

    window.addEventListener('message', handleViewerMessage)
    return () => window.removeEventListener('message', handleViewerMessage)
  }, [bomInfo.components])

  const handleButtonClick = useCallback(() => {
    if (agentSpeechPlaying || agentSpeechState === 'synthesizing') {
      stopAgentSpeechPlayback()
      return
    }
    if (state === 'recording') {
      stopRecording()
    } else if (state !== 'transcribing') {
      void startRecording()
    }
  }, [agentSpeechPlaying, agentSpeechState, startRecording, state, stopAgentSpeechPlayback, stopRecording])

  const handleInputModeChange = useCallback((nextMode: AgentInputMode) => {
    if (nextMode === inputMode) return
    if (state === 'recording') stopRecording()
    if (agentSpeechPlaying || agentSpeechState === 'synthesizing') stopAgentSpeechPlayback()
    clearAgentSpeechDisplay()
    setInputMode(nextMode)
  }, [agentSpeechPlaying, agentSpeechState, clearAgentSpeechDisplay, inputMode, state, stopAgentSpeechPlayback, stopRecording])

  const handleNavSelect = useCallback((_item: (typeof NAV_ITEMS)[number], index: number, event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    const nextView = NAV_VIEWS[index] ?? 'model'
    setActiveView(current => current === nextView ? null : nextView)
  }, [])
  const activeNavIndex = activeView ? NAV_VIEWS.indexOf(activeView) : -1
  const currentTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const currentDate = new Date().toLocaleDateString([], { month: 'short', day: '2-digit', year: 'numeric' })
  const progressUpdatedAt = formatProgressUpdatedAt(progressData, navigator.language || 'zh-CN', t)
  const progressPercent = workflowLoopProgressEntries.length > 0
    ? Math.round(workflowLoopProgressEntries.reduce((total, item) => total + item.percent, 0) / workflowLoopProgressEntries.length)
    : 0
  const activeProgressEntry = workflowLoopProgressEntries.find(item => item.status === 'running')
    ?? workflowLoopProgressEntries.find(item => item.status === 'failed')
    ?? workflowLoopProgressEntries.find(item => item.percent < 100)
    ?? workflowLoopProgressEntries[workflowLoopProgressEntries.length - 1]
  const progressStatusLabel = activeProgressEntry
    ? `${activeProgressEntry.label} · ${activeProgressEntry.statusLabel}`
    : progressUpdatedAt
  const recordButtonBusy = agentSpeechState === 'synthesizing' || agentSpeechPlaying
  const recordButtonDisabled = state === 'transcribing'
  const textComposerBusy = recordButtonBusy || state === 'transcribing'
  const textRecorderStatusText = textComposerBusy
    ? recorderStatusText
    : '文字输入模式，提交后继续语音播报'
  const handleTextSubmit = useCallback(() => {
    const prompt = textInput.trim()
    if (!prompt || textComposerBusy) return
    clearAgentSpeechDisplay()
    setTextInput('')
    setTextInputDisplay(prompt)
    void runCodex(prompt, 'text')
  }, [clearAgentSpeechDisplay, runCodex, textComposerBusy, textInput])
  const displayedSessionStatus = managedVoiceRunning || latestManagedStatus?.status === 'running'
    ? 'running'
    : latestManagedStatus?.status === 'completed' || latestManagedStatus?.status === 'partial'
      ? 'completed'
      : latestManagedStatus?.status === 'failed' || latestManagedStatus?.status === 'cancelled'
        ? 'failed'
        : sessionStatus
  const sessionStatusLabel = t(`workspace.status.${displayedSessionStatus}`)
  const dataSourceLabel = activeContext.workspaceName || activeContext.workspaceKey || activeContext.workspaceId || '未选择数据源'
  const versionLabel = activeContext.versionId || '未选择版本'
  const agentPageClassName = [
    'agent-page',
    activeView ? 'has-workspace-view' : '',
    conversationPanelOpen ? 'has-left-floating-panel' : '',
    progressPanelOpen ? 'has-right-floating-panel' : '',
    conversationPanelOpen || progressPanelOpen ? 'has-floating-panel' : '',
  ].filter(Boolean).join(' ')

  return (
    <main className={agentPageClassName}>
      <AgentTopbar
        conversationOpen={conversationPanelOpen}
        currentDate={currentDate}
        currentTime={currentTime}
        dataSourceLabel={dataSourceLabel}
        inputMode={inputMode}
        onInputModeChange={handleInputModeChange}
        onConversationToggle={() => setConversationPanelOpen(open => !open)}
        onProgressToggle={() => setProgressPanelOpen(open => !open)}
        onStopAndSummarize={handleStopAndSummarize}
        progressOpen={progressPanelOpen}
        progressPercent={progressPercent}
        progressStatusLabel={progressStatusLabel}
        progressTitle={t('workspace.inspector.progressTitle')}
        sessionStatus={displayedSessionStatus}
        sessionStatusLabel={sessionStatusLabel}
        stopSummaryPending={stopSummaryPending}
        versionLabel={versionLabel}
      />
      {conversationPanelOpen ? (
        <AgentConversationPopover
          conversationLogs={conversationLogs}
          onClose={() => setConversationPanelOpen(false)}
          title="历史对话"
        />
      ) : null}
      {progressPanelOpen ? (
        <AgentProgressRail
          className="agent-progress-popover"
          onClose={() => setProgressPanelOpen(false)}
          progressUpdatedAt={progressUpdatedAt}
          title={t('workspace.inspector.progressTitle')}
          workflowLoopProgressEntries={workflowLoopProgressEntries}
        />
      ) : null}
      <section className="agent-stage" aria-live="polite">
        <AgentSideNav activeNavIndex={activeNavIndex} navItems={navItems} onNavSelect={handleNavSelect} />
        <AgentWorkspacePanel
          activeContext={activeContext}
          activeManifestVersion={activeManifestVersion}
          activeTool={activeTool}
          activeView={activeView}
          bomInfo={bomInfo}
          bomLoading={bomLoading}
          branchManifest={branchManifest}
          checkoutVersion={checkoutVersion}
          createChildBranch={createChildBranch}
          createSiblingBranch={createSiblingBranch}
          handleSelectFile={handleSelectFile}
          logEntries={logEntries}
          manifestLoading={manifestLoading}
          selectedBom={selectedBom}
          selectedFileError={selectedFileError}
          selectedFileLoading={selectedFileLoading}
          selectedFilePath={selectedFilePath}
          selectedFilePreview={selectedFilePreview}
          selectedLog={selectedLog}
          setActiveTool={setActiveTool}
          setSelectedBomId={setSelectedBomId}
          setVersionListOpen={() => setVersionListOpen(open => !open)}
          setWorkspaceListOpen={() => setWorkspaceListOpen(open => !open)}
          showGncConfig={showGncConfig}
          switchActiveWorkspace={switchActiveWorkspace}
          t={t}
          toolUrls={toolUrls}
          versionAction={versionAction}
          versionError={versionError}
          versionListOpen={versionListOpen}
          versionTreeRoots={versionTreeRoots}
          viewerHref={viewerHref}
          workspaceChanging={workspaceChanging}
          workspaceItems={workspaceItems}
          workspaceListOpen={workspaceListOpen}
          workspaceRefreshNonce={workspaceRefreshNonce}
        />

        <AgentVoiceExchange
          agentSpeechError={agentSpeechError}
          agentSpeechState={agentSpeechState}
          error={error}
          inputMode={inputMode}
          state={state}
          text={inputMode === 'text' ? textInputDisplay : text}
          visibleAgentResponse={visibleAgentResponse}
        />

        <AgentRecorderControl
          activeView={activeView}
          busy={recordButtonBusy}
          disabled={recordButtonDisabled}
          inputMode={inputMode}
          onButtonClick={handleButtonClick}
          onTextChange={setTextInput}
          onTextSubmit={handleTextSubmit}
          recorderStatusText={inputMode === 'text' ? textRecorderStatusText : recorderStatusText}
          state={state}
          textInputDisabled={textComposerBusy}
          textInputValue={textInput}
        />
      </section>
    </main>
  )
}
