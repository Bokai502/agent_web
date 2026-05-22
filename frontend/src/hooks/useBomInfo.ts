import { useEffect, useState } from "react"
import { EMPTY_BOM_INFO, parseBomInfo, type BomInfo } from "../components/bomData"

export type BomWorkspaceContext = {
  enabled?: boolean
  versionDir?: string | null
  versionId?: string | null
  workspaceId?: string | null
}

export function useBomInfo(refreshKey = 0, workspace?: BomWorkspaceContext | string | null) {
  const [bomInfo, setBomInfo] = useState<BomInfo>(EMPTY_BOM_INFO)
  const [loading, setLoading] = useState(true)
  const workspaceDir = typeof workspace === "string" ? workspace : workspace?.versionDir
  const workspaceId = typeof workspace === "string" ? null : workspace?.workspaceId
  const versionId = typeof workspace === "string" ? null : workspace?.versionId
  const enabled = typeof workspace === "string" ? !!workspace : workspace?.enabled ?? !!workspaceDir

  useEffect(() => {
    if (import.meta.env.MODE === "test") {
      setLoading(false)
      return
    }
    if (!enabled) {
      setBomInfo(EMPTY_BOM_INFO)
      setLoading(false)
      return
    }

    const controller = new AbortController()
    setLoading(true)

    const params = new URLSearchParams()
    if (workspaceDir) params.set("workspaceDir", workspaceDir)
    if (workspaceId) params.set("workspaceId", workspaceId)
    if (versionId) params.set("versionId", versionId)
    const query = params.size > 0 ? `?${params.toString()}` : ""
    fetch(`/api/freecad/bom${query}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(response => response.ok ? response.json() : null)
      .then(data => {
        setBomInfo(data ? parseBomInfo(data) : EMPTY_BOM_INFO)
      })
      .catch(() => {
        setBomInfo(EMPTY_BOM_INFO)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [enabled, refreshKey, versionId, workspaceDir, workspaceId])

  return { bomInfo, loading }
}
