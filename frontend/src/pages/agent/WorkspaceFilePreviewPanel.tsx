import { MarkdownText } from '../../components/outputMarkdown'
import { ConversationLogView } from '../workspace/ConversationLogView'
import { ShikiCodePreview } from './ShikiCodePreview'
import type { WorkspaceFilePreview } from './types'
import { getConversationHistoryContent, isMarkdownFile } from './workspaceFileUtils'

type WorkspaceFilePreviewPanelProps = {
  error: string
  file: WorkspaceFilePreview | null
  loading: boolean
  selectedPath: string
}

export function WorkspaceFilePreviewPanel({ error, file, loading, selectedPath }: WorkspaceFilePreviewPanelProps) {
  if (!selectedPath) {
    return (
      <div className="agent-file-preview is-empty">
        <strong>选择左侧文件</strong>
        <span>点击文件树中的文件后会在这里预览。</span>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="agent-file-preview is-empty">
        <strong>读取文件中</strong>
        <span>{selectedPath}</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="agent-file-preview is-empty is-error">
        <strong>文件读取失败</strong>
        <span>{error}</span>
      </div>
    )
  }

  if (!file) return null
  const conversationHistory = getConversationHistoryContent(file)

  return (
    <section className="agent-file-preview">
      <header>
        <div>
          <strong>{file.name}</strong>
          <span>{file.relativePath}</span>
        </div>
        <small>{file.mimeType}</small>
      </header>
      <div className="agent-file-preview-body">
        {conversationHistory ? (
          <ConversationLogView session={conversationHistory} />
        ) : file.type === 'image' ? (
          <img alt={file.name} src={`data:${file.mimeType};base64,${file.contentBase64}`} />
        ) : file.type === 'text' ? (
          isMarkdownFile(file) ? (
            <div className="wa-log-markdown only-content">
              <MarkdownText text={file.content} />
            </div>
          ) : (
            <ShikiCodePreview code={file.content} fileName={file.name} mimeType={file.mimeType} />
          )
        ) : (
          <div className="agent-file-preview-unavailable">
            <strong>该文件暂不支持预览</strong>
            <span>{file.reason ?? 'binary file preview is not supported'}</span>
          </div>
        )}
      </div>
    </section>
  )
}
