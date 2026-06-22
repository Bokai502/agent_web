import { useCallback, useEffect, useMemo, useState } from "react"
import {
  branchWorkspaceVersion,
  checkoutWorkspaceVersion,
  deleteWorkspaceVersion,
  fetchWorkspaces,
  fetchWorkspaceManifest,
  getActiveVersion,
  getVersionWorkspaceKey,
  resolveWorkspaceVersionContext,
  switchWorkspace as switchWorkspaceRequest,
  type VersionAction,
  type WorkspaceManifestSummary,
  type WorkspacesResponse,
} from "./workspaceVersion"

type UseWorkspaceVersionStateArgs = {
  apiBase?: string
  fallbackWorkspaceName: string
  manifestRefreshKey?: unknown
  onRefreshWorkspaceViews: () => void
  onReloadSessions: () => void
  workspaceRefreshNonce: number
}

export function useWorkspaceVersionState({
  apiBase,
  fallbackWorkspaceName,
  manifestRefreshKey,
  onRefreshWorkspaceViews,
  onReloadSessions,
  workspaceRefreshNonce,
}: UseWorkspaceVersionStateArgs) {
  const [workspaces, setWorkspaces] = useState<WorkspacesResponse | null>(null)
  const [workspacesLoaded, setWorkspacesLoaded] = useState(false)
  const [workspaceChanging, setWorkspaceChanging] = useState(false)
  const [branchManifest, setBranchManifest] = useState<WorkspaceManifestSummary | null>(null)
  const [manifestLoading, setManifestLoading] = useState(false)
  const [manifestRefreshNonce, setManifestRefreshNonce] = useState(0)
  const [versionAction, setVersionAction] = useState<VersionAction | null>(null)
  const [versionDeleteTarget, setVersionDeleteTarget] = useState<string | null>(null)
  const [versionError, setVersionError] = useState("")

  const activeContext = resolveWorkspaceVersionContext({
    branchManifest,
    fallbackWorkspaceName,
    workspaces,
  })
  const activeManifestVersion = useMemo(() => getActiveVersion(branchManifest), [branchManifest])
  const workspaceItems = workspaces?.items ?? []

  const refreshManifest = useCallback(() => {
    setVersionError("")
    setManifestRefreshNonce(value => value + 1)
  }, [])

  const versionWorkspaceKey = activeContext.workspaceKey ?? getVersionWorkspaceKey(branchManifest, activeContext.workspaceName)

  const checkoutVersion = useCallback((versionId: string) => {
    if (!versionWorkspaceKey && !activeContext.workspaceId && !activeContext.manifestRoot) return
    setVersionAction("checkout")
    setVersionError("")
    checkoutWorkspaceVersion({
      versionId,
      apiBase,
      workspaceKey: versionWorkspaceKey,
      workspaceId: activeContext.workspaceId,
      workspaceDir: activeContext.manifestRoot,
    })
      .then(data => {
        setBranchManifest(data)
        onReloadSessions()
        onRefreshWorkspaceViews()
      })
      .catch(err => setVersionError(err instanceof Error ? err.message : "版本切换失败"))
      .finally(() => setVersionAction(null))
  }, [activeContext.manifestRoot, activeContext.workspaceId, apiBase, onRefreshWorkspaceViews, onReloadSessions, refreshManifest, versionWorkspaceKey])

  const branchVersion = useCallback((
    baseVersionId: string,
    label: string,
    parentVersionId?: string | null,
    sourceWorkspaceDir?: string | null,
    sourceWorkspaceName?: string | null,
  ) => {
    if ((!versionWorkspaceKey && !activeContext.workspaceId && !activeContext.manifestRoot) || !baseVersionId) return
    setVersionAction("branch")
    setVersionError("")
    branchWorkspaceVersion({
      baseVersionId,
      label,
      parentVersionId,
      sourceWorkspaceDir,
      sourceWorkspaceName,
      apiBase,
      workspaceKey: versionWorkspaceKey,
      workspaceId: activeContext.workspaceId,
      workspaceDir: activeContext.manifestRoot,
    })
      .then(data => {
        if (data.manifest) setBranchManifest(data.manifest)
        onReloadSessions()
        onRefreshWorkspaceViews()
        refreshManifest()
      })
      .catch(err => setVersionError(err instanceof Error ? err.message : "版本创建失败"))
      .finally(() => setVersionAction(null))
  }, [activeContext.manifestRoot, activeContext.workspaceId, apiBase, onRefreshWorkspaceViews, onReloadSessions, refreshManifest, versionWorkspaceKey])

  const createChildBranch = useCallback((baseVersionId?: string) => {
    if (!baseVersionId) return
    branchVersion(baseVersionId, "界面创建的子版本")
  }, [branchVersion])

  const createVersionFromInput = useCallback((baseVersionId?: string) => {
    const baseVersion = baseVersionId
      ? branchManifest?.versions?.find(version => version.id === baseVersionId)
      : branchManifest?.versions?.find(version => !!version.id && !version.parentVersionId) ?? branchManifest?.versions?.[0]
    if (!baseVersion?.id || !activeContext.initialSourceWorkspaceDir) return
    branchVersion(baseVersion.id, "界面从输入数据创建版本", null, activeContext.initialSourceWorkspaceDir, activeContext.workspaceName)
  }, [activeContext.initialSourceWorkspaceDir, activeContext.workspaceName, branchManifest?.versions, branchVersion])

  const createInitialVersion = useCallback(() => {
    const manifestRoot = activeContext.manifestRoot
    if ((!versionWorkspaceKey && !activeContext.workspaceId && !manifestRoot) || !manifestRoot || versionAction !== null) return
    setVersionAction("branch")
    setVersionError("")
    fetchWorkspaceManifest({
      initialize: true,
      apiBase,
      workspaceKey: versionWorkspaceKey,
      workspaceId: activeContext.workspaceId,
      manifestRoot,
      sourceWorkspaceDir: activeContext.initialSourceWorkspaceDir,
    })
      .then(data => {
        if (data) setBranchManifest(data)
        onReloadSessions()
        onRefreshWorkspaceViews()
        refreshManifest()
      })
      .catch(err => setVersionError(err instanceof Error ? err.message : "版本创建失败"))
      .finally(() => setVersionAction(null))
  }, [activeContext.initialSourceWorkspaceDir, activeContext.manifestRoot, activeContext.workspaceId, apiBase, onRefreshWorkspaceViews, onReloadSessions, refreshManifest, versionAction, versionWorkspaceKey])

  const requestDeleteVersion = useCallback((versionId: string) => {
    if (!versionId || versionAction !== null) return
    setVersionError("")
    setVersionDeleteTarget(versionId)
  }, [versionAction])

  const cancelDeleteVersion = useCallback(() => {
    if (versionAction === "delete") return
    setVersionDeleteTarget(null)
    setVersionError("")
  }, [versionAction])

  const confirmDeleteVersion = useCallback(() => {
    const versionId = versionDeleteTarget
    if ((!versionWorkspaceKey && !activeContext.workspaceId && !activeContext.manifestRoot) || !versionId) return Promise.resolve()
    setVersionAction("delete")
    setVersionError("")
    return deleteWorkspaceVersion({
      versionId,
      apiBase,
      workspaceKey: versionWorkspaceKey,
      workspaceId: activeContext.workspaceId,
      workspaceDir: activeContext.manifestRoot,
    })
      .then(data => {
        if (data.manifest) setBranchManifest(data.manifest)
        setVersionDeleteTarget(null)
        onReloadSessions()
        onRefreshWorkspaceViews()
        refreshManifest()
      })
      .catch(err => {
        setVersionError(err instanceof Error ? err.message : "版本删除失败")
      })
      .finally(() => setVersionAction(null))
  }, [activeContext.manifestRoot, activeContext.workspaceId, apiBase, onRefreshWorkspaceViews, onReloadSessions, refreshManifest, versionDeleteTarget, versionWorkspaceKey])

  const switchActiveWorkspace = useCallback((name: string) => {
    setWorkspaceChanging(true)
    setBranchManifest(null)
    return switchWorkspaceRequest(name, apiBase)
      .then(() => {
        onReloadSessions()
        onRefreshWorkspaceViews()
        refreshManifest()
      })
      .catch(() => {
        // Keep the previous workspace visible if the switch is rejected.
      })
      .finally(() => setWorkspaceChanging(false))
  }, [apiBase, onRefreshWorkspaceViews, onReloadSessions, refreshManifest])

  useEffect(() => {
    let cancelled = false
    setWorkspacesLoaded(false)
    const loadWorkspaces = () => {
      fetchWorkspaces(apiBase)
        .then(data => {
          if (!cancelled) setWorkspaces(data)
        })
        .catch(() => {
          if (!cancelled) setWorkspaces(null)
        })
        .finally(() => {
          if (!cancelled) setWorkspacesLoaded(true)
        })
    }

    loadWorkspaces()
    return () => {
      cancelled = true
    }
  }, [apiBase, workspaceRefreshNonce])

  useEffect(() => {
    if (!activeContext.manifestRoot) {
      setBranchManifest(null)
      return
    }

    let cancelled = false
    setManifestLoading(true)
    fetchWorkspaceManifest({
      workspaceKey: activeContext.workspaceKey,
      workspaceId: activeContext.workspaceId,
      manifestRoot: activeContext.manifestRoot,
      sourceWorkspaceDir: activeContext.sourceWorkspaceDir,
      apiBase,
    })
      .then(data => {
        if (!cancelled) setBranchManifest(data)
      })
      .catch(() => {
        if (!cancelled) setBranchManifest(null)
      })
      .finally(() => {
        if (!cancelled) setManifestLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [activeContext.manifestRoot, activeContext.sourceWorkspaceDir, activeContext.workspaceId, activeContext.workspaceKey, apiBase, manifestRefreshKey, manifestRefreshNonce, workspaceRefreshNonce])

  return {
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
    refreshManifest,
    setBranchManifest,
    switchActiveWorkspace,
    requestDeleteVersion,
    versionAction,
    versionDeleteTarget,
    versionError,
    workspaceChanging,
    workspaceItems,
    workspaces,
    workspacesLoaded,
  }
}
