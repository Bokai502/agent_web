import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import {
  fetchWorkspaceManifest,
  getActiveVersion,
  resolveWorkspaceVersionContext,
  type WorkspaceManifestSummary,
  type WorkspaceVersionContext,
  type WorkspacesResponse,
} from '../workspace/workspaceVersion'
import {
  dispatchManagedCodex,
  getManagedCodexStatus,
  subscribeManagedCodexStatus,
  summarizeManagedCodex,
  type ManagedModelBackend,
  type ManagedRunStatusResponse,
} from './managedRun'

type AgentInputMode = 'voice' | 'text'

type SessionLike = {
  id: string
}

type ManagedAgentRunOptions = {
  activeContext: WorkspaceVersionContext
  modelBackend: ManagedModelBackend
  refreshWorkspaceViews: () => void
  resetProgressDataRef: MutableRefObject<(() => void) | null>
  setBranchManifest: (manifest: WorkspaceManifestSummary | null) => void
  setProgressRefreshNonce: (updater: (value: number) => number) => void
  showSpeechText: (text: string) => void
  speakText: (text: string, speechId?: string) => void | Promise<void>
  periodicSummarySpeechBusy?: boolean
  workspaces: WorkspacesResponse | null
  workspaceAppState: {
    handleSelect: (sessionId: string) => void
    reloadSessions: () => Promise<SessionLike[]>
  }
}

const PERIODIC_PROGRESS_SUMMARY_INTERVAL_MS = 60_000

function workspaceSpeechKey(context: WorkspaceVersionContext) {
  return [
    context.versionDir,
    context.workspaceId,
    context.versionId,
  ].filter(Boolean).join(':')
}

export function useManagedAgentRun({
  activeContext,
  modelBackend,
  refreshWorkspaceViews,
  resetProgressDataRef,
  setBranchManifest,
  setProgressRefreshNonce,
  showSpeechText,
  speakText,
  periodicSummarySpeechBusy = false,
  workspaces,
  workspaceAppState,
}: ManagedAgentRunOptions) {
  const [managedVoiceRunning, setManagedVoiceRunning] = useState(false)
  const managedPollTokenRef = useRef(0)
  const managedWatchCleanupRef = useRef<(() => void) | null>(null)
  const periodicSummarySpeechBusyRef = useRef(periodicSummarySpeechBusy)
  const activeWorkspaceSpeechKey = workspaceSpeechKey(activeContext)
  const activeWorkspaceSpeechKeyRef = useRef(activeWorkspaceSpeechKey)

  useEffect(() => {
    activeWorkspaceSpeechKeyRef.current = activeWorkspaceSpeechKey
  }, [activeWorkspaceSpeechKey])

  useEffect(() => {
    periodicSummarySpeechBusyRef.current = periodicSummarySpeechBusy
  }, [periodicSummarySpeechBusy])

  const invalidateManagedRun = useCallback(() => {
    managedPollTokenRef.current += 1
    managedWatchCleanupRef.current?.()
    managedWatchCleanupRef.current = null
    setManagedVoiceRunning(false)
  }, [])

  useEffect(() => () => {
    managedWatchCleanupRef.current?.()
    managedWatchCleanupRef.current = null
  }, [])

  const runCodex = useCallback(async (transcript: string, inputType: AgentInputMode = 'voice') => {
    const runWorkspaceKey = activeWorkspaceSpeechKeyRef.current
    const isCurrentWorkspaceRun = () => activeWorkspaceSpeechKeyRef.current === runWorkspaceKey
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
      if (!isCurrentWorkspaceRun()) return
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

    const watchManagedCompletion = (
      managedRunId: string,
      startedTurnId: string,
      token: number,
      context: WorkspaceVersionContext,
      sessionId?: string | null,
      threadId?: string | null,
    ) => {
      let closed = false
      let fallbackTimer: number | null = null
      let periodicSummaryTimer: number | null = null
      let periodicSummaryInFlight = false
      let lastPeriodicSummary = ''
      const close = () => {
        if (closed) return
        closed = true
        if (fallbackTimer !== null) window.clearTimeout(fallbackTimer)
        if (periodicSummaryTimer !== null) window.clearInterval(periodicSummaryTimer)
        unsubscribe()
        if (managedWatchCleanupRef.current === close) managedWatchCleanupRef.current = null
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
      const summarizeWithoutBlockingRun = async () => {
        if (closed || managedPollTokenRef.current !== token || !isCurrentWorkspaceRun()) return
        if (periodicSummaryInFlight || periodicSummarySpeechBusyRef.current) return
        periodicSummaryInFlight = true
        try {
          const result = await summarizeManagedCodex({
            input: '请用一句中文简短总结当前 Codex pipeline 的实时进度，适合语音播报，不要 Markdown。',
            modelBackend,
            sessionId,
            threadId,
            workspace: {
              workspaceDir: context.versionDir,
              workspaceId: context.workspaceId,
              workspaceName: context.workspaceName,
              versionId: context.versionId,
            },
          })
          if (closed || managedPollTokenRef.current !== token || !isCurrentWorkspaceRun()) return
          if (result.status !== 'partial') return
          if (periodicSummarySpeechBusyRef.current) return
          const speechText = (result.spokenSummary || result.summary || '').trim()
          if (!speechText || speechText === lastPeriodicSummary) return
          lastPeriodicSummary = speechText
          void speakText(speechText, `${managedRunId}:periodic:${Date.now()}`)
        } catch {
          // Periodic summaries are best-effort and must never interrupt the running pipeline.
        } finally {
          periodicSummaryInFlight = false
        }
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
      periodicSummaryTimer = window.setInterval(() => {
        void summarizeWithoutBlockingRun()
      }, PERIODIC_PROGRESS_SUMMARY_INTERVAL_MS)
      managedWatchCleanupRef.current?.()
      managedWatchCleanupRef.current = close
    }

    const runManagedWithContext = async (context: WorkspaceVersionContext) => {
      const result = await dispatchManagedCodex({
        input: transcript,
        inputType,
        modelBackend,
        workspace: {
          workspaceDir: context.versionDir,
          workspaceId: context.workspaceId,
          workspaceName: context.workspaceName,
          versionId: context.versionId,
        },
      })
      if (!isCurrentWorkspaceRun()) return
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
        watchManagedCompletion(result.managedRunId, result.turnId, pollToken, context, result.sessionId, result.threadId)
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
            sourceWorkspaceDir: activeContext.initialSourceWorkspaceDir,
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
          setBranchManifest(data)
          refreshWorkspaceViews()
          await runManagedWithContext(initializedContext)
        } catch {
          await runManagedWithContext(activeContext)
        }
        return
      }

      await runManagedWithContext(activeContext)
    } finally {
      if (!backgroundRunStarted && isCurrentWorkspaceRun()) setManagedVoiceRunning(false)
    }
  }, [activeContext, refreshWorkspaceViews, resetProgressDataRef, setBranchManifest, setProgressRefreshNonce, showSpeechText, speakText, workspaceAppState, workspaces])

  return {
    activeWorkspaceSpeechKey,
    invalidateManagedRun,
    managedVoiceRunning,
    runCodex,
    setManagedVoiceRunning,
  }
}
