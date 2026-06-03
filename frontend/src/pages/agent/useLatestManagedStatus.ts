import { useEffect, useState } from 'react'
import { getLatestManagedCodexStatus, type ManagedRunStatusResponse } from './managedRun'
import type { WorkspaceContextQuery } from './types'

export function useLatestManagedStatus({
  activeContext,
  managedVoiceRunning,
}: {
  activeContext: WorkspaceContextQuery
  managedVoiceRunning: boolean
}) {
  const [latestManagedStatus, setLatestManagedStatus] = useState<ManagedRunStatusResponse | null>(null)

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

  return {
    latestManagedStatus,
    setLatestManagedStatus,
  }
}
