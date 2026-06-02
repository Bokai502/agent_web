import { useCallback, useEffect, useState } from 'react'
import { joinApiPath } from '../../app/apiBase'
import type { GeneratedFileTreeEntry } from '../workspace/GeneratedFilesTreeCard'
import type { WorkspaceContextQuery, WorkspaceFilePreview } from './types'
import { buildWorkspaceFileQuery } from './workspaceFileUtils'

export function useWorkspaceFilePreview(activeContext: WorkspaceContextQuery) {
  const [selectedFilePath, setSelectedFilePath] = useState('')
  const [selectedFilePreview, setSelectedFilePreview] = useState<WorkspaceFilePreview | null>(null)
  const [selectedFileLoading, setSelectedFileLoading] = useState(false)
  const [selectedFileError, setSelectedFileError] = useState('')

  useEffect(() => {
    setSelectedFilePath('')
    setSelectedFilePreview(null)
    setSelectedFileError('')
    setSelectedFileLoading(false)
  }, [activeContext.versionDir, activeContext.versionId, activeContext.workspaceId])

  const handleSelectFile = useCallback((entry: GeneratedFileTreeEntry) => {
    setSelectedFilePath(entry.relativePath)
    setSelectedFilePreview(null)
    setSelectedFileError('')
    setSelectedFileLoading(true)

    const query = buildWorkspaceFileQuery(activeContext, entry.relativePath)
    if (!query) {
      setSelectedFileLoading(false)
      setSelectedFileError('当前工作区未就绪')
      return
    }

    void fetch(`${joinApiPath(undefined, '/workspace/files/content')}${query}`, { cache: 'no-store' })
      .then(async response => {
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(typeof payload.error === 'string' ? payload.error : '文件读取失败')
        }
        setSelectedFilePreview(payload as WorkspaceFilePreview)
      })
      .catch(err => {
        setSelectedFileError(err instanceof Error ? err.message : '文件读取失败')
      })
      .finally(() => {
        setSelectedFileLoading(false)
      })
  }, [activeContext])

  return {
    handleSelectFile,
    selectedFileError,
    selectedFileLoading,
    selectedFilePath,
    selectedFilePreview,
  }
}
