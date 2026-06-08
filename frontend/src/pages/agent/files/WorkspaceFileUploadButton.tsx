import { useRef, useState, type ChangeEvent } from 'react'
import type { WorkspaceContextQuery } from '../types'
import { uploadWorkspaceFiles, type WorkspaceUploadResponse } from './workspaceUploadApi'

type WorkspaceFileUploadButtonProps = {
  activeContext: WorkspaceContextQuery
  apiBase?: string
  disabled?: boolean
  onUploaded?: (response: WorkspaceUploadResponse) => void | Promise<void>
  targetDir?: string
}

export function WorkspaceFileUploadButton({
  activeContext,
  apiBase,
  disabled = false,
  onUploaded,
  targetDir = '00_inputs',
}: WorkspaceFileUploadButtonProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  const handleChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (selectedFiles.length === 0) return

    setUploading(true)
    setError('')
    try {
      const response = await uploadWorkspaceFiles({
        apiBase,
        context: activeContext,
        files: selectedFiles,
        targetDir,
      })
      await onUploaded?.(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : '文件上传失败')
    } finally {
      setUploading(false)
    }
  }

  return (
    <span className="wa-file-upload-control">
      <input
        aria-label="上传文件到工作区"
        className="wa-file-upload-input"
        disabled={disabled || uploading}
        multiple
        onChange={handleChange}
        ref={inputRef}
        type="file"
      />
      <button
        type="button"
        className="wa-file-tree-upload"
        disabled={disabled || uploading}
        onClick={() => inputRef.current?.click()}
        title={`上传到 ${targetDir}`}
      >
        {uploading ? '上传中' : '上传'}
      </button>
      {error ? <span className="wa-file-upload-error" title={error}>{error}</span> : null}
    </span>
  )
}
