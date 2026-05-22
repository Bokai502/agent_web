import { useEffect, useState } from "react"
import { EMPTY_BOM_INFO, parseBomInfo, type BomInfo } from "../components/bomData"

export type BomWorkspaceContext = {
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

  useEffect(() => {
    if (import.meta.env.MODE === "test") {
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
        if (data) setBomInfo(parseBomInfo(data))
      })
      .catch(() => {
        // Keep the empty BOM state when the runtime file is unavailable.
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [refreshKey, versionId, workspaceDir, workspaceId])

  return { bomInfo, loading }
}
