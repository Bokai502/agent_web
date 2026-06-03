import { joinApiPath } from '../../../app/apiBase'
import type { WorkspaceContextQuery } from '../types'

export type WorkspaceFileTreeEntry = {
  mtimeMs: number
  name: string
  relativePath: string
  size?: number
  type: 'directory' | 'file'
}

export type WorkspaceFileTreeResponse = {
  entries?: WorkspaceFileTreeEntry[]
  relativePath?: string
  truncated?: boolean
  workspaceDir?: string
}

export type WorkspaceFileContentResponse = {
  content?: string
  contentBase64?: string
  encoding?: string
  mimeType?: string
  mtimeMs?: number
  name?: string
  previewable?: boolean
  reason?: string
  relativePath?: string
  size?: number
  type?: string
}

export type WorkspaceTextChunkResponse = {
  complete?: boolean
  contentBase64?: string
  encoding?: 'base64'
  mimeType?: string
  mtimeMs?: number
  name?: string
  nextOffset?: number
  offset?: number
  relativePath?: string
  size?: number
  type?: 'text-chunk'
}

type WorkspaceFileQueryOptions = {
  length?: number
  maxBytes?: number
  offset?: number
  relativePath?: string
}

export function buildWorkspaceFilesQuery(context: WorkspaceContextQuery, options: WorkspaceFileQueryOptions = {}) {
  if (!context.versionDir) return ''
  const params = new URLSearchParams({ workspaceDir: context.versionDir })
  if (context.workspaceId) params.set('workspaceId', context.workspaceId)
  if (context.versionId) params.set('versionId', context.versionId)
  if (options.relativePath) params.set('relativePath', options.relativePath)
  if (options.maxBytes) params.set('maxBytes', String(options.maxBytes))
  if (options.offset !== undefined) params.set('offset', String(options.offset))
  if (options.length !== undefined) params.set('length', String(options.length))
  return `?${params.toString()}`
}

export async function fetchWorkspaceFileTree({
  apiBase,
  context,
  relativePath = '',
}: {
  apiBase?: string
  context: WorkspaceContextQuery
  relativePath?: string
}) {
  const query = buildWorkspaceFilesQuery(context, { relativePath })
  if (!query) throw new Error('当前工作区未就绪')
  const response = await fetch(`${joinApiPath(apiBase, '/workspace/files/tree')}${query}`, { cache: 'no-store' })
  if (!response.ok) throw new Error('文件列表读取失败')
  return response.json() as Promise<WorkspaceFileTreeResponse>
}

export async function fetchWorkspaceArchive({
  apiBase,
  context,
}: {
  apiBase?: string
  context: WorkspaceContextQuery
}) {
  const query = buildWorkspaceFilesQuery(context)
  if (!query) throw new Error('当前工作区未就绪')
  const response = await fetch(`${joinApiPath(apiBase, '/workspace/files/archive')}${query}`, { cache: 'no-store' })
  if (!response.ok) throw new Error('文件打包下载失败')
  return response.blob()
}

export async function fetchWorkspaceFileContent({
  apiBase,
  context,
  relativePath,
}: {
  apiBase?: string
  context: WorkspaceContextQuery
  relativePath: string
}) {
  const query = buildWorkspaceFilesQuery(context, { relativePath })
  if (!query) throw new Error('当前工作区未就绪')
  const response = await fetch(`${joinApiPath(apiBase, '/workspace/files/content')}${query}`, { cache: 'no-store' })
  if (!response.ok) throw new Error('文件内容读取失败')
  return response.json() as Promise<WorkspaceFileContentResponse>
}

export async function fetchWorkspaceTextFile({
  apiBase,
  context,
  maxBytes,
  relativePath,
}: {
  apiBase?: string
  context: WorkspaceContextQuery
  maxBytes?: number
  relativePath: string
}) {
  const query = buildWorkspaceFilesQuery(context, { maxBytes, relativePath })
  if (!query) throw new Error('当前工作区未就绪')
  const response = await fetch(`${joinApiPath(apiBase, '/workspace/files/text')}${query}`, { cache: 'no-store' })
  if (!response.ok) throw new Error('文件内容读取失败')
  return response.json() as Promise<WorkspaceFileContentResponse>
}

export async function fetchWorkspaceTextChunk({
  apiBase,
  context,
  length,
  offset,
  relativePath,
}: {
  apiBase?: string
  context: WorkspaceContextQuery
  length?: number
  offset: number
  relativePath: string
}) {
  const query = buildWorkspaceFilesQuery(context, { length, offset, relativePath })
  if (!query) throw new Error('当前工作区未就绪')
  const response = await fetch(`${joinApiPath(apiBase, '/workspace/files/text-chunk')}${query}`, { cache: 'no-store' })
  if (!response.ok) throw new Error('文件分块读取失败')
  return response.json() as Promise<WorkspaceTextChunkResponse>
}

export function workspaceArchiveFileName(context: WorkspaceContextQuery) {
  return `${context.versionId || context.workspaceId || 'workspace'}.zip`
}

export function downloadBlob(blob: Blob, fileName: string) {
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(objectUrl)
}
