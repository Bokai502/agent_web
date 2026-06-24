import { useState } from "react"
import { joinApiPath } from "../../app/apiBase"

type WorkspaceLike = {
  versionDir?: string | null
  versionId?: string | null
  workspaceId?: string | null
}

export function useLoadSimulationGuiData(apiBase: string | undefined, activeContext: WorkspaceLike) {
  const [pending, setPending] = useState(false)
  const [status, setStatus] = useState("")

  const load = async () => {
    if (pending) return
    setPending(true)
    setStatus("")
    try {
      const response = await fetch(joinApiPath(apiBase, "/remote-tools/load-simulation-data"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceDir: activeContext.versionDir,
          workspaceId: activeContext.workspaceId,
          versionId: activeContext.versionId,
        }),
      })
      const data = await response.json().catch(() => null) as { error?: string; ok?: boolean } | null
      if (!response.ok || !data?.ok) throw new Error(data?.error ?? `加载失败：${response.status}`)
      setStatus("已加载")
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "加载失败")
    } finally {
      setPending(false)
    }
  }

  return { load, pending, status }
}
