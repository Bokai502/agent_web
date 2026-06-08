import { joinApiPath } from '../../../app/apiBase'
import type { WorkspaceContextQuery } from '../types'
import { buildWorkspaceFilesQuery } from './workspaceFilesApi'

export type WorkspaceUploadedFile = {
  mimeType: string
  name: string
  path: string
  relativePath: string
  size: number
}

export type WorkspaceUploadResponse = {
  files: WorkspaceUploadedFile[]
  targetDir: string
  versionId?: string | null
  workspaceDir: string
  workspaceId?: string | null
}

async function getUploadErrorMessage(response: Response) {
  const payload = await response.json().catch(() => null) as { error?: unknown; message?: unknown } | null
  if (typeof payload?.error === 'string') return payload.error
  if (typeof payload?.message === 'string') return payload.message
  return `上传失败：${response.status}`
}

export async function uploadWorkspaceFiles({
  apiBase,
  context,
  files,
  targetDir = '00_inputs',
}: {
  apiBase?: string
  context: WorkspaceContextQuery
  files: File[]
  targetDir?: string
}) {
  if (files.length === 0) throw new Error('请选择要上传的文件')
  const query = buildWorkspaceFilesQuery(context, { targetDir })
  if (!query) throw new Error('当前工作区未就绪')

  const formData = new FormData()
  for (const file of files) {
    formData.append('files', file, file.name)
  }

  const response = await fetch(`${joinApiPath(apiBase, '/workspace/files/upload')}${query}`, {
    method: 'POST',
    body: formData,
  })
  if (!response.ok) throw new Error(await getUploadErrorMessage(response))
  return response.json() as Promise<WorkspaceUploadResponse>
}
