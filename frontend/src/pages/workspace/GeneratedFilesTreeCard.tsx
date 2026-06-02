import { useCallback, useEffect, useMemo, useState } from "react"
import { joinApiPath } from "../../app/apiBase"
import type { WorkspaceVersionContext } from "./workspaceVersion"

type FileTreeEntry = {
  mtimeMs: number
  name: string
  relativePath: string
  size?: number
  type: "directory" | "file"
}

export type GeneratedFileTreeEntry = FileTreeEntry

type FileTreeResponse = {
  entries?: FileTreeEntry[]
  relativePath?: string
  truncated?: boolean
  workspaceDir?: string
}

type GeneratedFilesTreeCardProps = {
  activeContext: WorkspaceVersionContext
  apiBase?: string
  onSelectFile?: (entry: GeneratedFileTreeEntry) => void
  selectedFilePath?: string
}

const ROOT_PATH = ""

function formatWorkspacePath(value?: string | null) {
  if (!value) return "等待工作区"
  const parts = value.split(/[\\/]/u).filter(Boolean)
  return parts.slice(-4).join("/")
}

function buildWorkspaceQuery(context: Pick<WorkspaceVersionContext, "versionDir" | "versionId" | "workspaceId">, relativePath: string) {
  if (!context.versionDir) return ""
  const params = new URLSearchParams({
    workspaceDir: context.versionDir,
  })
  if (context.workspaceId) params.set("workspaceId", context.workspaceId)
  if (context.versionId) params.set("versionId", context.versionId)
  if (relativePath) params.set("relativePath", relativePath)
  return `?${params.toString()}`
}

export function GeneratedFilesTreeCard({ activeContext, apiBase, onSelectFile, selectedFilePath }: GeneratedFilesTreeCardProps) {
  const versionDir = activeContext.versionDir
  const workspaceId = activeContext.workspaceId
  const versionId = activeContext.versionId
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set())
  const [entriesByPath, setEntriesByPath] = useState<Record<string, FileTreeEntry[]>>({})
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(() => new Set())
  const [error, setError] = useState("")
  const workspaceKey = `${versionDir ?? ""}:${workspaceId ?? ""}:${versionId ?? ""}`
  const rootEntries = entriesByPath[ROOT_PATH] ?? []
  const isRootLoading = loadingPaths.has(ROOT_PATH)

  const loadPath = useCallback(async (relativePath: string) => {
    if (!versionDir) return
    setError("")
    setLoadingPaths(prev => new Set(prev).add(relativePath))
    try {
      const response = await fetch(`${joinApiPath(apiBase, "/workspace/files/tree")}${buildWorkspaceQuery({ versionDir, versionId, workspaceId }, relativePath)}`, { cache: "no-store" })
      if (!response.ok) throw new Error("文件列表读取失败")
      const data = await response.json() as FileTreeResponse
      setEntriesByPath(prev => ({
        ...prev,
        [relativePath]: Array.isArray(data.entries) ? data.entries : [],
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : "文件列表读取失败")
    } finally {
      setLoadingPaths(prev => {
        const next = new Set(prev)
        next.delete(relativePath)
        return next
      })
    }
  }, [apiBase, versionDir, versionId, workspaceId])

  const refreshVisible = useCallback(() => {
    if (!versionDir) return
    const paths = [ROOT_PATH, ...expandedPaths]
    paths.forEach(path => {
      void loadPath(path)
    })
  }, [expandedPaths, loadPath, versionDir])

  const toggleDirectory = useCallback((relativePath: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev)
      if (next.has(relativePath)) {
        next.delete(relativePath)
        return next
      }
      next.add(relativePath)
      return next
    })
    void loadPath(relativePath)
  }, [loadPath])

  useEffect(() => {
    setExpandedPaths(new Set())
    setEntriesByPath({})
    setLoadingPaths(new Set())
    setError("")
  }, [workspaceKey])

  useEffect(() => {
    if (!versionDir) return
    void loadPath(ROOT_PATH)
  }, [loadPath, versionDir])

  const titlePath = useMemo(() => formatWorkspacePath(versionDir), [versionDir])

  const renderEntries = (entries: FileTreeEntry[], depth = 0) => entries.map(entry => {
    const isDirectory = entry.type === "directory"
    const isExpanded = expandedPaths.has(entry.relativePath)
    const children = entriesByPath[entry.relativePath] ?? []
    const isLoading = loadingPaths.has(entry.relativePath)
    return (
      <div className="wa-file-tree-node" key={entry.relativePath}>
        <button
          type="button"
          className={`wa-file-tree-row${isDirectory ? " is-directory" : " is-file"}${selectedFilePath === entry.relativePath ? " selected" : ""}`}
          disabled={!isDirectory && !onSelectFile}
          onClick={() => {
            if (isDirectory) {
              toggleDirectory(entry.relativePath)
              return
            }
            onSelectFile?.(entry)
          }}
          style={{ paddingLeft: `${10 + depth * 14}px` }}
          title={entry.relativePath}
        >
          <span className="wa-file-tree-icon">{isDirectory ? (isExpanded ? "▾" : "▸") : "·"}</span>
          <span className="wa-file-tree-name">{entry.name}</span>
          {isLoading && <small>刷新中</small>}
        </button>
        {isDirectory && isExpanded && (
          <div className="wa-file-tree-children">
            {children.length > 0 ? renderEntries(children, depth + 1) : (
              <div className="wa-file-tree-empty" style={{ paddingLeft: `${28 + depth * 14}px` }}>
                {isLoading ? "读取中..." : "空目录"}
              </div>
            )}
          </div>
        )}
      </div>
    )
  })

  return (
    <section className="wa-info-card wa-file-tree-card">
      <div className="wa-file-tree-head">
        <div>
          <h3>生成文件</h3>
          <p title={versionDir ?? undefined}>{titlePath}</p>
        </div>
        <div className="wa-file-tree-actions">
          <button type="button" onClick={refreshVisible} disabled={!versionDir || isRootLoading}>刷新</button>
        </div>
      </div>
      <div className="wa-file-tree-body">
        {error && <div className="wa-file-tree-error">{error}</div>}
        {isRootLoading && rootEntries.length === 0 ? (
          <div className="wa-file-tree-empty">读取中...</div>
        ) : rootEntries.length > 0 ? (
          renderEntries(rootEntries)
        ) : (
          <div className="wa-file-tree-empty">暂无文件</div>
        )}
      </div>
    </section>
  )
}
