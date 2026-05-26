import { useCallback, useEffect, useMemo, useState } from "react"
import {
  branchWorkspaceVersion,
  buildVersionTree,
  checkoutWorkspaceVersion,
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
  const [versionError, setVersionError] = useState("")
  const [versionListOpen, setVersionListOpen] = useState(false)
  const [workspaceListOpen, setWorkspaceListOpen] = useState(false)

  const activeContext = resolveWorkspaceVersionContext({
    branchManifest,
    fallbackWorkspaceName,
    workspaces,
  })
  const activeManifestVersion = useMemo(() => getActiveVersion(branchManifest), [branchManifest])
  const versionTreeRoots = useMemo(() => buildVersionTree(branchManifest), [branchManifest])
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
        refreshManifest()
      })
      .catch(err => setVersionError(err instanceof Error ? err.message : "版本切换失败"))
      .finally(() => setVersionAction(null))
  }, [activeContext.manifestRoot, activeContext.workspaceId, apiBase, onRefreshWorkspaceViews, onReloadSessions, refreshManifest, versionWorkspaceKey])

  const branchVersion = useCallback((baseVersionId: string, label: string) => {
    if ((!versionWorkspaceKey && !activeContext.workspaceId && !activeContext.manifestRoot) || !baseVersionId) return
    setVersionAction("branch")
    setVersionError("")
    branchWorkspaceVersion({
      baseVersionId,
      label,
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
        setVersionListOpen(true)
      })
      .catch(err => setVersionError(err instanceof Error ? err.message : "版本创建失败"))
      .finally(() => setVersionAction(null))
  }, [activeContext.manifestRoot, activeContext.workspaceId, apiBase, onRefreshWorkspaceViews, onReloadSessions, refreshManifest, versionWorkspaceKey])

  const createChildBranch = useCallback((baseVersionId?: string) => {
    if (!baseVersionId) return
    branchVersion(baseVersionId, "界面创建的子版本")
  }, [branchVersion])

  const createSiblingBranch = useCallback(() => {
    const parentVersionId = activeManifestVersion?.parentVersionId
    if (!parentVersionId) return
    branchVersion(parentVersionId, "界面创建的同级版本")
  }, [activeManifestVersion?.parentVersionId, branchVersion])

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
    checkoutVersion,
    createChildBranch,
    createSiblingBranch,
    manifestLoading,
    refreshManifest,
    setBranchManifest,
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
    workspacesLoaded,
  }
}
