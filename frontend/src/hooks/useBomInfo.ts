import { useEffect, useState } from "react"
import { EMPTY_BOM_INFO, parseBomInfo, type BomInfo } from "../components/bomData"

export function useBomInfo(refreshKey = 0) {
  const [bomInfo, setBomInfo] = useState<BomInfo>(EMPTY_BOM_INFO)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (import.meta.env.MODE === "test") {
      setLoading(false)
      return
    }

    const controller = new AbortController()
    setLoading(true)

    fetch("/api/freecad/bom", {
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
  }, [refreshKey])

  return { bomInfo, loading }
}
