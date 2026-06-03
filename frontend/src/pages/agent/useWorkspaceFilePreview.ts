import { useCallback, useEffect, useState } from 'react'
import { joinApiPath } from '../../app/apiBase'
import { fetchWorkspaceTextChunk } from './files/workspaceFilesApi'
import type { GeneratedFileTreeEntry } from '../workspace/GeneratedFilesTreeCard'
import type { WorkspaceContextQuery, WorkspaceFilePreview } from './types'
import { buildWorkspaceFileQuery } from './workspaceFileUtils'

const CHUNK_TEXT_EXT_RE = /\.(?:cfg|csv|ini|json|log|md|py|txt|xml|ya?ml|42)$/iu
const TEXT_CHUNK_BYTES = 512 * 1024
const MAX_PREVIEW_CHUNKS = 64

function isChunkableTextFile(entry: GeneratedFileTreeEntry) {
  return entry.type === 'file' && CHUNK_TEXT_EXT_RE.test(entry.name)
}

function mimeTypeForTextFile(fileName: string) {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.json')) return 'application/json'
  if (lower.endsWith('.md')) return 'text/markdown'
  return 'text/plain'
}

function decodeBase64Bytes(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

async function fetchChunkedTextPreview(activeContext: WorkspaceContextQuery, entry: GeneratedFileTreeEntry): Promise<WorkspaceFilePreview> {
  const decoder = new TextDecoder('utf-8')
  const chunks: string[] = []
  let offset = 0
  let size = entry.size ?? 0
  let mtimeMs = entry.mtimeMs
  for (let index = 0; index < MAX_PREVIEW_CHUNKS; index += 1) {
    const chunk = await fetchWorkspaceTextChunk({
      context: activeContext,
      length: TEXT_CHUNK_BYTES,
      offset,
      relativePath: entry.relativePath,
    })
    if (typeof chunk.size === 'number') size = chunk.size
    if (typeof chunk.mtimeMs === 'number') mtimeMs = chunk.mtimeMs
    if (chunk.contentBase64) {
      chunks.push(decoder.decode(decodeBase64Bytes(chunk.contentBase64), { stream: !chunk.complete }))
    }
    offset = typeof chunk.nextOffset === 'number' ? chunk.nextOffset : offset + TEXT_CHUNK_BYTES
    if (chunk.complete) {
      chunks.push(decoder.decode())
      return {
        content: chunks.join(''),
        encoding: 'utf-8',
        mimeType: chunk.mimeType ?? mimeTypeForTextFile(entry.name),
        mtimeMs,
        name: chunk.name ?? entry.name,
        relativePath: entry.relativePath,
        size,
        type: 'text',
      }
    }
  }
  chunks.push(decoder.decode())
  return {
    content: `${chunks.join('')}\n\n... 文件过大，预览已截断 ...`,
    encoding: 'utf-8',
    mimeType: mimeTypeForTextFile(entry.name),
    mtimeMs,
    name: entry.name,
    relativePath: entry.relativePath,
    size,
    type: 'text',
  }
}

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
        if (payload?.type === 'binary' && payload?.reason === 'file too large for preview' && isChunkableTextFile(entry)) {
          setSelectedFilePreview(await fetchChunkedTextPreview(activeContext, entry))
          return
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
