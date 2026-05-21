import { useEffect, useState } from "react"
import { EMPTY_BOM_INFO, parseBomInfo, type BomInfo } from "../components/bomData"

export function useBomInfo(refreshKey = 0, workspaceDir?: string | null) {
  const [bomInfo, setBomInfo] = useState<BomInfo>(EMPTY_BOM_INFO)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (import.meta.env.MODE === "test") {
      setLoading(false)
      return
    }

    const controller = new AbortController()
    setLoading(true)

    const query = workspaceDir ? `?${new URLSearchParams({ workspaceDir }).toString()}` : ""
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
  }, [refreshKey, workspaceDir])

  return { bomInfo, loading }
}
