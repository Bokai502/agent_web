import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { joinApiPath } from '../app/apiBase'
import { getGncToolUrl, getRemoteToolUrl } from '../app/runtimeConfig'
import { useBomInfo } from '../hooks/useBomInfo'
import { useWorkspaceAppState } from '../hooks/useWorkspaceAppState'
import { formatProgressUpdatedAt, type WorkflowProgressVariant } from './workspace/progressUtils'
import { useWorkspaceRuntimeData } from './workspace/useWorkspaceRuntimeData'
import { useWorkspaceVersionState } from './workspace/useWorkspaceVersionState'
import { getWorkspaceDisplayName, isThermalCadWorkspace } from './workspace/workspaceVersion'
import { getVisibleWorkspaceSessionState } from './workspace/workspaceSessionVisibility'
import { AgentProgressRail } from './agent/AgentProgressRail'
import { AgentConversationPopover } from './agent/AgentConversationPopover'
import { AgentRecorderControl } from './agent/AgentRecorderControl'
import { AgentSideNav } from './agent/AgentSideNav'
import { AgentTopbar, type RemoteToolPortSummary } from './agent/AgentTopbar'
import { AgentWorkspacePanel } from './agent/AgentWorkspacePanel'
import { cancelManagedCodex, getLatestManagedCodexStatus, summarizeManagedCodex, type ManagedModelBackend } from './agent/managedRun'
import {
  AGENT_HOME_PATH,
  NAV_ITEMS,
  NAV_VIEWS,
  WORKSPACE_GEOMETRY_AFTER_GLB_PATH,
} from './agent/constants'
import type {
  AgentToolView,
  AgentWorkspaceView,
  ViewerComponentMessage,
} from './agent/types'
import { useAgentSpeech } from './agent/useAgentSpeech'
import { getRecorderStatusText, useAgentRecorder } from './agent/useAgentRecorder'
import { useLatestManagedStatus } from './agent/useLatestManagedStatus'
import { useManagedAgentRun } from './agent/useManagedAgentRun'
import { useWorkspaceFilePreview } from './agent/useWorkspaceFilePreview'
import './AgentPage.css'

type AgentInputMode = 'voice' | 'text'
type AgentTheme = 'dark' | 'light'

const AGENT_THEME_STORAGE_KEY = 'agent-theme'

function getInitialAgentTheme(): AgentTheme {
  if (typeof window === 'undefined') return 'dark'
  return window.localStorage.getItem(AGENT_THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark'
}

export default function AgentPage() {
  const { t } = useTranslation()
  const [agentTheme, setAgentTheme] = useState<AgentTheme>(() => getInitialAgentTheme())
  const [activeView, setActiveView] = useState<AgentWorkspaceView | null>(null)
  const [activeTool, setActiveTool] = useState<AgentToolView>('cad')
  const [conversationPanelOpen, setConversationPanelOpen] = useState(false)
  const [progressPanelOpen, setProgressPanelOpen] = useState(false)
  const [workspaceRefreshNonce, setWorkspaceRefreshNonce] = useState(0)
  const [progressRefreshNonce, setProgressRefreshNonce] = useState(0)
  const [inputMode, setInputMode] = useState<AgentInputMode>('text')
  const [modelBackend, setModelBackend] = useState<ManagedModelBackend>('chatModel')
  const [textInput, setTextInput] = useState('')
  const [textInputDisplay, setTextInputDisplay] = useState('')
  const [managedRunError, setManagedRunError] = useState('')
  const [stopSummaryPending, setStopSummaryPending] = useState(false)
  const [remoteToolPortStatus, setRemoteToolPortStatus] = useState<RemoteToolPortSummary | null>(null)
  const [remoteToolPortError, setRemoteToolPortError] = useState('')
  const [remoteToolPortLoading, setRemoteToolPortLoading] = useState(false)
  const [selectedBomId, setSelectedBomId] = useState('')
  const resetProgressDataRef = useRef<(() => void) | null>(null)
  const remoteToolHost = typeof window !== 'undefined' ? window.location.hostname : 'localhost'
  const workspaceAppState = useWorkspaceAppState({ homePath: AGENT_HOME_PATH })

  const refreshWorkspaceViews = useCallback(() => {
    setSelectedBomId('')
    setWorkspaceRefreshNonce(value => value + 1)
    setProgressRefreshNonce(value => value + 1)
  }, [])
  const versionState = useWorkspaceVersionState({
    fallbackWorkspaceName: '当前任务',
    onRefreshWorkspaceViews: refreshWorkspaceViews,
    onReloadSessions: () => {},
    workspaceRefreshNonce,
  })
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
    switchActiveWorkspace,
    versionAction,
    versionDeleteTarget,
    versionError,
    workspaceChanging,
    workspaceItems,
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
  const toolUrls = useMemo(() => ({
    cad: getRemoteToolUrl('cad', remoteToolHost),
    paraview: getRemoteToolUrl('paraview', remoteToolHost),
    comsol: getRemoteToolUrl('comsol', remoteToolHost),
    gnc: getGncToolUrl(),
  }), [remoteToolHost])
  const refreshRemoteToolPortStatus = useCallback((options?: { force?: boolean }) => {
    setRemoteToolPortLoading(true)
    const suffix = options?.force ? '?force=1' : ''
    return fetch(joinApiPath(undefined, `/remote-tools/interface-status${suffix}`), { cache: 'no-store' })
      .then(async response => {
        const data = await response.json().catch(() => null) as RemoteToolPortSummary | null
        if (!data || !Array.isArray(data.results)) {
          throw new Error('接口状态响应格式异常')
        }
        setRemoteToolPortStatus(data)
        setRemoteToolPortError('')
      })
      .catch(error => {
        setRemoteToolPortError(error instanceof Error ? error.message : '接口状态获取失败')
      })
      .finally(() => {
        setRemoteToolPortLoading(false)
      })
  }, [])
  const progressVariant = useMemo<WorkflowProgressVariant>(() => {
    const marker = [
      activeContext.workspaceName,
      activeContext.workspaceId,
      activeContext.workspaceKey,
      activeContext.versionDir,
    ].filter(Boolean).join("\n").toLowerCase()
    if (/derating|降额/.test(marker)) return "check"
    if (/gnc|aignc|adcs|region/.test(marker)) return "gnc"
    return "thermal"
  }, [activeContext.versionDir, activeContext.workspaceId, activeContext.workspaceKey, activeContext.workspaceName])
  const lockViewerToComplianceCheck = useMemo(() => {
    const marker = [
      activeContext.workspaceName,
      activeContext.workspaceId,
      activeContext.workspaceKey,
      activeContext.versionDir,
    ].filter(Boolean).join("\n").toLowerCase()
    return /derating|降额/.test(marker)
  }, [activeContext.versionDir, activeContext.workspaceId, activeContext.workspaceKey, activeContext.workspaceName])
  const canUseDefaultModelPreview = isThermalCadWorkspace(activeContext)
  const showModelPreview = canUseDefaultModelPreview || lockViewerToComplianceCheck
  const viewerHref = useMemo(() => {
    if (!showModelPreview) return ''
    const params = new URLSearchParams()
    if (canUseDefaultModelPreview) params.set('glbPath', WORKSPACE_GEOMETRY_AFTER_GLB_PATH)
    params.set('theme', agentTheme)
    if (activeContext.workspaceKey) params.set('workspaceKey', activeContext.workspaceKey)
    if (activeContext.workspaceId) params.set('workspaceId', activeContext.workspaceId)
    if (activeContext.versionId) params.set('versionId', activeContext.versionId)
    if (activeContext.versionDir) params.set('workspaceDir', activeContext.versionDir)
    if (lockViewerToComplianceCheck) {
      params.set('mode', 'derating')
      params.set('lockMode', 'derating')
    }
    if (workspaceRefreshNonce > 0) params.set('workspaceVersion', String(workspaceRefreshNonce))
    return `/viewer?${params.toString()}`
  }, [activeContext.versionDir, activeContext.versionId, activeContext.workspaceId, activeContext.workspaceKey, agentTheme, canUseDefaultModelPreview, lockViewerToComplianceCheck, showModelPreview, workspaceRefreshNonce])
  const showGncConfig = progressVariant === "gnc"
  const navItems = useMemo(() => {
    if (progressVariant === 'check') {
      return NAV_ITEMS
        .filter(item => item.href !== '#tools')
        .map(item => item.href === '#bom' ? { ...item, label: '配置文件', meta: 'Config' } : item)
    }
    if (!showGncConfig) {
      return NAV_ITEMS
        .filter(item => showModelPreview || item.href !== '#model')
        .map(item => item.href === '#bom' ? { ...item, label: '配置文件', meta: 'Config' } : item)
    }
    return NAV_ITEMS
      .filter(item => item.href !== '#model')
      .map(item => (
        item.href === '#bom'
          ? { ...item, label: 'GNC 配置', meta: 'Config' }
          : item
      ))
  }, [progressVariant, showGncConfig, showModelPreview])
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
  const {
    activeWorkspaceSpeechKey,
    invalidateManagedRun,
    managedVoiceRunning,
    runCodex,
    setManagedVoiceRunning,
  } = useManagedAgentRun({
    activeContext,
    modelBackend,
    refreshWorkspaceViews,
    resetProgressDataRef,
    setBranchManifest: versionState.setBranchManifest,
    setProgressRefreshNonce,
    showRunError: setManagedRunError,
    showSpeechText,
    speakText,
    periodicSummarySpeechBusy: agentSpeechPlaying || agentSpeechState === 'synthesizing',
    workspaceAppState,
    workspaces,
  })
  const {
    latestManagedStatus,
    setLatestManagedStatus,
  } = useLatestManagedStatus({ activeContext, managedVoiceRunning })
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
            modelBackend,
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
  }, [activeContext.versionDir, activeContext.versionId, activeContext.workspaceId, activeContext.workspaceName, activeSession?.threadId, latestManagedStatus, modelBackend, refreshWorkspaceViews, showSpeechText, speakText, stopSummaryPending, workspaceAppState])
  const {
    cancelRecording,
    clearRecorderDisplay,
    error,
    startRecording,
    state,
    stopRecording,
    text,
  } = useAgentRecorder({
    clearAgentSpeechDisplay: () => {
      setManagedRunError('')
      clearAgentSpeechDisplay()
    },
    runCodex,
    running: visibleRunning || workspaceAppState.running || managedVoiceRunning,
  })
  const conversationLogSessionId = latestManagedStatus?.status === 'running'
    ? latestManagedStatus.sessionId
    : workspaceAppState.runningSessionId ?? workspaceAppState.activeSessionId
  const {
    conversationLogs,
    progressData,
    resetProgressData,
    workflowLoopProgressEntries,
    workflowProgressSummary,
  } = useWorkspaceRuntimeData({
    activeContext,
    enableConversationLogs: conversationPanelOpen,
    enableConversationLogRefresh: conversationPanelOpen && (visibleRunning || managedVoiceRunning || latestManagedStatus?.status === 'running'),
    enableRunLogEntries: false,
    enableStageLogs: false,
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
  const recorderStatusText = getRecorderStatusText(
    state,
    visibleRunning || managedVoiceRunning,
    agentSpeechPlaying || agentSpeechState === 'synthesizing',
  )

  useEffect(() => {
    invalidateManagedRun()
    clearAgentSpeechDisplay()
    clearRecorderDisplay()
    setTextInput('')
    setTextInputDisplay('')
    setLatestManagedStatus(null)
  }, [activeWorkspaceSpeechKey, clearAgentSpeechDisplay, clearRecorderDisplay, invalidateManagedRun, setLatestManagedStatus])

  useEffect(() => {
    resetProgressData()
  }, [activeContext.versionDir, activeContext.versionId, resetProgressData])

  useEffect(() => {
    refreshRemoteToolPortStatus().catch(() => {})
  }, [refreshRemoteToolPortStatus])

  useEffect(() => {
    if (state === 'done') {
      setProgressRefreshNonce(value => value + 1)
    }
  }, [state])

  useEffect(() => {
    if (activeView !== 'tools') return
    if (showGncConfig) return
    if (progressVariant === 'check') return

    fetch(joinApiPath(undefined, '/remote-tools/ensure-desktops'), { method: 'POST' })
      .then(response => {
        if (!response.ok) {
          console.warn('Failed to ensure remote desktop mappings', response.status)
        }
      })
      .catch(error => {
        console.warn('Failed to ensure remote desktop mappings', error)
      })
  }, [activeView, progressVariant, showGncConfig])

  useEffect(() => {
    if (progressVariant === 'check' && activeTool !== 'cad') setActiveTool('cad')
    if (showGncConfig && activeTool !== 'gnc' && activeTool !== 'gnc-dashboard') setActiveTool('gnc-dashboard')
    if (!showGncConfig && (activeTool === 'gnc' || activeTool === 'gnc-dashboard')) setActiveTool('cad')
  }, [activeTool, progressVariant, showGncConfig])

  useEffect(() => {
    if (!activeView) return
    if (navItems.some(item => item.href === `#${activeView}`)) return
    setActiveView('workspace')
  }, [activeView, navItems])

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
    if (state === 'recording') cancelRecording()
    if (agentSpeechPlaying || agentSpeechState === 'synthesizing') stopAgentSpeechPlayback()
    clearAgentSpeechDisplay()
    clearRecorderDisplay()
    setManagedRunError('')
    setTextInputDisplay('')
    setInputMode(nextMode)
  }, [agentSpeechPlaying, agentSpeechState, cancelRecording, clearAgentSpeechDisplay, clearRecorderDisplay, inputMode, state, stopAgentSpeechPlayback])

  const handleNavSelect = useCallback((item: (typeof NAV_ITEMS)[number], _index: number, event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    const nextView = NAV_VIEWS.find(view => item.href === `#${view}`) ?? 'workspace'
    setActiveView(current => current === nextView ? null : nextView)
  }, [])
  const visibleActiveView = activeView === 'model' && !showModelPreview ? 'workspace' : activeView
  const activeNavIndex = visibleActiveView ? navItems.findIndex(item => item.href === `#${visibleActiveView}`) : -1
  const progressUpdatedAt = formatProgressUpdatedAt(progressData, navigator.language || 'zh-CN', t)
  const progressPercent = workflowProgressSummary.percentage
  const progressStatusLabel = workflowProgressSummary.statusLabel || progressUpdatedAt
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
    setManagedRunError('')
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
  const dataSourceLabel = activeContext.workspaceName
    ? getWorkspaceDisplayName(activeContext.workspaceName)
    : activeContext.workspaceKey || activeContext.workspaceId || '未选择数据源'
  const versionLabel = activeContext.versionId || '未选择版本'
  const agentPageClassName = [
    'agent-page',
    `is-${agentTheme}-theme`,
    showGncConfig ? 'is-gnc-agent' : '',
    progressVariant === 'thermal' ? 'is-thermal-agent' : '',
    progressVariant === 'check' ? 'is-derating-agent' : '',
    activeView ? 'has-workspace-view' : '',
    conversationPanelOpen ? 'has-left-floating-panel' : '',
    progressPanelOpen ? 'has-right-floating-panel' : '',
    conversationPanelOpen || progressPanelOpen ? 'has-floating-panel' : '',
  ].filter(Boolean).join(' ')

  const handleAgentThemeChange = useCallback((nextTheme: AgentTheme) => {
    setAgentTheme(nextTheme)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(AGENT_THEME_STORAGE_KEY, nextTheme)
    }
  }, [])

  return (
    <main className={agentPageClassName}>
      <AgentTopbar
        conversationOpen={conversationPanelOpen}
        dataSourceLabel={dataSourceLabel}
        agentTheme={agentTheme}
        inputMode={inputMode}
        modelBackend={modelBackend}
        onAgentThemeChange={handleAgentThemeChange}
        onInputModeChange={handleInputModeChange}
        onModelBackendChange={setModelBackend}
        onConversationToggle={() => setConversationPanelOpen(open => !open)}
        portStatus={remoteToolPortStatus}
        portStatusError={remoteToolPortError}
        portStatusLoading={remoteToolPortLoading}
        onPortStatusRefresh={() => refreshRemoteToolPortStatus({ force: true })}
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
          activeView={visibleActiveView}
          apiBase={undefined}
          bomInfo={bomInfo}
          bomLoading={bomLoading}
          branchManifest={branchManifest}
          cancelDeleteVersion={cancelDeleteVersion}
          checkoutVersion={checkoutVersion}
          confirmDeleteVersion={confirmDeleteVersion}
          createChildBranch={createChildBranch}
          createInitialVersion={createInitialVersion}
          createVersionFromInput={createVersionFromInput}
          handleSelectFile={handleSelectFile}
          manifestLoading={manifestLoading}
          selectedBom={selectedBom}
          selectedFileError={selectedFileError}
          selectedFileLoading={selectedFileLoading}
          selectedFilePath={selectedFilePath}
          selectedFilePreview={selectedFilePreview}
          setActiveTool={setActiveTool}
          setSelectedBomId={setSelectedBomId}
          requestDeleteVersion={requestDeleteVersion}
          refreshWorkspaceViews={refreshWorkspaceViews}
          theme={agentTheme}
          showGncConfig={showGncConfig}
          showComplianceCheckConfig={progressVariant === 'check'}
          showModelPreview={showModelPreview}
          switchActiveWorkspace={switchActiveWorkspace}
          t={t}
          toolUrls={toolUrls}
          versionAction={versionAction}
          versionDeleteTarget={versionDeleteTarget}
          versionError={versionError}
          viewerHref={viewerHref}
          workspaceChanging={workspaceChanging}
          workspaceItems={workspaceItems}
          workspaceRefreshNonce={workspaceRefreshNonce}
        />

        <AgentRecorderControl
          activeView={activeView}
          agentSpeechError={agentSpeechError}
          agentSpeechState={agentSpeechState}
          busy={recordButtonBusy}
          disabled={recordButtonDisabled}
          error={error || managedRunError}
          inputMode={inputMode}
          onButtonClick={handleButtonClick}
          onTextChange={setTextInput}
          onTextSubmit={handleTextSubmit}
          recorderStatusText={inputMode === 'text' ? textRecorderStatusText : recorderStatusText}
          state={state}
          text={inputMode === 'text' ? textInputDisplay : text}
          textInputDisabled={textComposerBusy}
          textInputValue={textInput}
          visibleAgentResponse={visibleAgentResponse}
        />
      </section>
    </main>
  )
}
