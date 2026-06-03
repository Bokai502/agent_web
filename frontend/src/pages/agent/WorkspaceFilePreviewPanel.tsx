import { MarkdownText } from '../../components/outputMarkdown'
import { ConversationLogView } from '../workspace/ConversationLogView'
import { ShikiCodePreview } from './ShikiCodePreview'
import type { WorkspaceContextQuery, WorkspaceFilePreview } from './types'
import { getConversationHistoryContent, isMarkdownFile } from './workspaceFileUtils'

type WorkspaceFilePreviewPanelProps = {
  activeContext: WorkspaceContextQuery
  error: string
  file: WorkspaceFilePreview | null
  loading: boolean
  selectedPath: string
}

const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|svg)(?:[?#].*)?$/iu

export function normalizeWorkspacePath(path: string) {
  const isAbsolute = path.startsWith('/')
  const parts: string[] = []
  for (const part of path.replace(/\\/gu, '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return `${isAbsolute ? '/' : ''}${parts.join('/')}`
}

export function createMarkdownImageResolver(activeContext: WorkspaceContextQuery, file: WorkspaceFilePreview) {
  return (src: string) => {
    if (!src || src.startsWith('/api/') || src.startsWith('data:') || /^[a-z][a-z0-9+.-]*:/iu.test(src)) return src
    if (!IMAGE_EXT_RE.test(src)) return src
    if (!activeContext.versionDir || file.type !== 'text') return src
    const cleanSrc = src.split(/[?#]/u, 1)[0] ?? src
    const baseDir = file.relativePath.split('/').slice(0, -1).join('/')
    const relativePath = normalizeWorkspacePath(`${baseDir}/${decodeURIComponent(cleanSrc)}`)
    const fullPath = normalizeWorkspacePath(`${activeContext.versionDir}/${relativePath}`)
    return `/api/image?path=${encodeURIComponent(fullPath)}`
  }
}

function normalizeMarkdownPreview(text: string) {
  return text.replace(/<br\s*\/?>/giu, '\n')
}

export function WorkspaceFilePreviewPanel({ activeContext, error, file, loading, selectedPath }: WorkspaceFilePreviewPanelProps) {
  if (!selectedPath) {
    return null
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
              <MarkdownText imageSrcResolver={createMarkdownImageResolver(activeContext, file)} text={normalizeMarkdownPreview(file.content)} />
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
