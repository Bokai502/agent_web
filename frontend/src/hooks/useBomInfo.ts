import { useEffect, useState } from "react"
import { joinApiPath } from "../app/apiBase"
import { EMPTY_BOM_INFO, parseBomInfo, type BomInfo } from "../components/bomData"

export type BomWorkspaceContext = {
  apiBase?: string
  enabled?: boolean
  versionDir?: string | null
  versionId?: string | null
  workspaceId?: string | null
}

export function useBomInfo(refreshKey = 0, workspace?: BomWorkspaceContext | string | null, refreshIntervalMs = 3000) {
  const [bomInfo, setBomInfo] = useState<BomInfo>(EMPTY_BOM_INFO)
  const [loading, setLoading] = useState(true)
  const workspaceDir = typeof workspace === "string" ? workspace : workspace?.versionDir
  const workspaceId = typeof workspace === "string" ? null : workspace?.workspaceId
  const versionId = typeof workspace === "string" ? null : workspace?.versionId
  const apiBase = typeof workspace === "string" ? undefined : workspace?.apiBase
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
    let inFlight = false
    setLoading(true)

    const params = new URLSearchParams()
    if (workspaceDir) params.set("workspaceDir", workspaceDir)
    if (workspaceId) params.set("workspaceId", workspaceId)
    if (versionId) params.set("versionId", versionId)
    const query = params.size > 0 ? `?${params.toString()}` : ""

    const loadBom = (showLoading = false) => {
      if (inFlight || controller.signal.aborted) return
      inFlight = true
      if (showLoading) setLoading(true)
      fetch(`${joinApiPath(apiBase, "/workspace/bom")}${query}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(response => response.ok ? response.json() : null)
        .then(data => {
          setBomInfo(data ? parseBomInfo(data) : EMPTY_BOM_INFO)
        })
        .catch(() => {
          if (!controller.signal.aborted) setBomInfo(EMPTY_BOM_INFO)
        })
        .finally(() => {
          inFlight = false
          if (!controller.signal.aborted) setLoading(false)
        })
    }

    loadBom(true)
    const intervalId = refreshIntervalMs > 0
      ? window.setInterval(() => loadBom(false), refreshIntervalMs)
      : null

    return () => {
      controller.abort()
      if (intervalId !== null) window.clearInterval(intervalId)
    }
  }, [apiBase, enabled, refreshIntervalMs, refreshKey, versionId, workspaceDir, workspaceId])

  return { bomInfo, loading }
}
