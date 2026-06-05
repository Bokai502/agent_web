import { useCallback, useEffect, useState } from "react"
import {
  downloadBlob,
  fetchWorkspaceArchive,
  fetchWorkspaceFileTree,
  type WorkspaceFileTreeEntry,
  workspaceArchiveFileName,
} from "../agent/files/workspaceFilesApi"
import type { WorkspaceVersionContext } from "./workspaceVersion"

export type GeneratedFileTreeEntry = WorkspaceFileTreeEntry

type GeneratedFilesTreeCardProps = {
  activeContext: WorkspaceVersionContext
  apiBase?: string
  onSelectFile?: (entry: GeneratedFileTreeEntry) => void
  refreshNonce?: number
  selectedFilePath?: string
}

const ROOT_PATH = ""

export function GeneratedFilesTreeCard({ activeContext, apiBase, onSelectFile, refreshNonce = 0, selectedFilePath }: GeneratedFilesTreeCardProps) {
  const versionDir = activeContext.versionDir
  const workspaceId = activeContext.workspaceId
  const versionId = activeContext.versionId
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set())
  const [entriesByPath, setEntriesByPath] = useState<Record<string, WorkspaceFileTreeEntry[]>>({})
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(() => new Set())
  const [error, setError] = useState("")
  const [downloading, setDownloading] = useState(false)
  const workspaceKey = `${versionDir ?? ""}:${workspaceId ?? ""}:${versionId ?? ""}`
  const rootEntries = entriesByPath[ROOT_PATH] ?? []
  const isRootLoading = loadingPaths.has(ROOT_PATH)

  const loadPath = useCallback(async (relativePath: string) => {
    if (!versionDir) return
    setError("")
    setLoadingPaths(prev => new Set(prev).add(relativePath))
    try {
      const data = await fetchWorkspaceFileTree({ apiBase, context: activeContext, relativePath })
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
  }, [activeContext, apiBase, versionDir])

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

  const downloadWorkspaceArchive = useCallback(async () => {
    if (!versionDir || downloading) return
    setDownloading(true)
    setError("")
    try {
      const blob = await fetchWorkspaceArchive({ apiBase, context: activeContext })
      downloadBlob(blob, workspaceArchiveFileName(activeContext))
    } catch (err) {
      setError(err instanceof Error ? err.message : "文件打包下载失败")
    } finally {
      setDownloading(false)
    }
  }, [activeContext, apiBase, downloading, versionDir])

  useEffect(() => {
    setExpandedPaths(new Set())
    setEntriesByPath({})
    setLoadingPaths(new Set())
    setError("")
  }, [workspaceKey])

  useEffect(() => {
    if (!versionDir) return
    void loadPath(ROOT_PATH)
  }, [loadPath, refreshNonce, versionDir])

  const renderEntries = (entries: WorkspaceFileTreeEntry[], depth = 0) => entries.map(entry => {
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
          <h3>运行结果</h3>
        </div>
        <button
          type="button"
          className="wa-file-tree-download"
          disabled={!versionDir || downloading}
          onClick={downloadWorkspaceArchive}
          title="下载全部运行结果"
        >
          {downloading ? "打包中" : "下载"}
        </button>
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
