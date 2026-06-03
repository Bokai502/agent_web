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
  type ManagedRunStatusResponse,
} from './managedRun'

type AgentInputMode = 'voice' | 'text'

type SessionLike = {
  id: string
}

type ManagedAgentRunOptions = {
  activeContext: WorkspaceVersionContext
  refreshWorkspaceViews: () => void
  resetProgressDataRef: MutableRefObject<(() => void) | null>
  setBranchManifest: (manifest: WorkspaceManifestSummary | null) => void
  setProgressRefreshNonce: (updater: (value: number) => number) => void
  showSpeechText: (text: string) => void
  speakText: (text: string, speechId?: string) => void | Promise<void>
  workspaces: WorkspacesResponse | null
  workspaceAppState: {
    handleSelect: (sessionId: string) => void
    reloadSessions: () => Promise<SessionLike[]>
  }
}

function workspaceSpeechKey(context: WorkspaceVersionContext) {
  return [
    context.versionDir,
    context.workspaceId,
    context.versionId,
  ].filter(Boolean).join(':')
}

export function useManagedAgentRun({
  activeContext,
  refreshWorkspaceViews,
  resetProgressDataRef,
  setBranchManifest,
  setProgressRefreshNonce,
  showSpeechText,
  speakText,
  workspaces,
  workspaceAppState,
}: ManagedAgentRunOptions) {
  const [managedVoiceRunning, setManagedVoiceRunning] = useState(false)
  const managedPollTokenRef = useRef(0)
  const activeWorkspaceSpeechKey = workspaceSpeechKey(activeContext)
  const activeWorkspaceSpeechKeyRef = useRef(activeWorkspaceSpeechKey)

  useEffect(() => {
    activeWorkspaceSpeechKeyRef.current = activeWorkspaceSpeechKey
  }, [activeWorkspaceSpeechKey])

  const invalidateManagedRun = useCallback(() => {
    managedPollTokenRef.current += 1
    setManagedVoiceRunning(false)
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

    const runManagedWithContext = async (context: WorkspaceVersionContext) => {
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
