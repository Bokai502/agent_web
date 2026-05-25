import type { ModelVariant, ResolvedModel, ViewerModelSource } from "./types"

export function buildViewerModelSource(variant: ModelVariant): ViewerModelSource | null {
  const params = new URLSearchParams(window.location.search)
  const sessionId = params.get("sessionId")?.trim() ?? ""
  const runId = params.get("runId")?.trim() ?? ""
  const glbPath = params.get("glbPath")?.trim() ?? ""
  const versionId = params.get("versionId")?.trim() ?? ""
  const workspaceDir = params.get("workspaceDir")?.trim() ?? ""
  const workspaceId = params.get("workspaceId")?.trim() ?? ""

  const query = new URLSearchParams()
  if (sessionId) query.set("sessionId", sessionId)
  if (runId) query.set("runId", runId)
  if (glbPath) query.set("glbPath", glbPath)
  if (workspaceId) query.set("workspaceId", workspaceId)
  if (versionId) query.set("versionId", versionId)
  if (workspaceDir) query.set("workspaceDir", workspaceDir)
  query.set("variant", variant)

  return {
    autoRefresh: runId.length === 0,
    lookupUrl: `/api/workspace/model?${query.toString()}`,
    variant,
  }
}

export function getModelVariantFromUrl(): ModelVariant {
  const params = new URLSearchParams(window.location.search)
  return params.get("variant") === "replaced" ? "replaced" : "original"
}

export function getVariantDisplayName(variant: ModelVariant) {
  return variant === "replaced" ? "geometry_after_replaced.glb" : "geometry_after.glb"
}

export function getModelVersion(resolvedModel: ResolvedModel) {
  return resolvedModel.version ??
    [
      resolvedModel.runId ?? "unknown-run",
      resolvedModel.updatedAt ?? "unknown-update",
      resolvedModel.glbPath,
    ].join(":")
}

export async function fetchResolvedModel(source: ViewerModelSource, signal: AbortSignal) {
  const response = await fetch(source.lookupUrl, { signal, cache: "no-store" })
  if (!response.ok) {
    return null
  }
  return response.json() as Promise<ResolvedModel>
}

export function getModelDisplayName(resolvedModel: ResolvedModel | null) {
  if (!resolvedModel) return "geometry_after.glb"
  if (resolvedModel.documentName?.trim()) return resolvedModel.documentName

  const normalizedPath = resolvedModel.glbPath.replace(/\\/gu, "/")
  return normalizedPath.split("/").pop() || "geometry_after.glb"
}
