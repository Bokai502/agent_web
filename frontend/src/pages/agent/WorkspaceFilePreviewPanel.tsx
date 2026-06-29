import { useEffect, useMemo, useRef, useState } from 'react'
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
const DOCX_EXT_RE = /\.docx$/iu
const XLSX_EXT_RE = /\.xlsx$/iu
const WORKSPACE_ROOT_RELATIVE_RE = /^(?:00_inputs|01_cad|02_sim|logs|reports|check_outputs)\//u
const STANDALONE_IMAGE_PATH_RE = /^(\s*)(?:[-*+]\s+)?`?((?:\/|\.{1,2}\/|(?:00_inputs|01_cad|02_sim|logs|reports|check_outputs)\/)[^`\n]+\.(?:png|jpe?g|gif|webp|svg)(?:[?#][^`\n]*)?)`?\s*$/iu
const MAX_EXCEL_SHEETS = 4
const MAX_EXCEL_ROWS = 200
const MAX_EXCEL_COLUMNS = 50

type BinaryWorkspaceFilePreview = WorkspaceFilePreview & { contentBase64: string }

type ExcelSheetPreview = {
  name: string
  rows: string[][]
  truncated: boolean
}

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
    const decodedSrc = decodeURIComponent(cleanSrc)
    const baseDir = file.relativePath.split('/').slice(0, -1).join('/')
    const relativePath = WORKSPACE_ROOT_RELATIVE_RE.test(decodedSrc)
      ? normalizeWorkspacePath(decodedSrc)
      : normalizeWorkspacePath(`${baseDir}/${decodedSrc}`)
    const fullPath = decodedSrc.startsWith('/')
      ? normalizeWorkspacePath(decodedSrc)
      : normalizeWorkspacePath(`${activeContext.versionDir}/${relativePath}`)
    return `/api/image?path=${encodeURIComponent(fullPath)}`
  }
}

export function normalizeMarkdownPreview(text: string) {
  return text
    .replace(/<br\s*\/?>/giu, '\n')
    .split('\n')
    .map(line => line.replace(STANDALONE_IMAGE_PATH_RE, (_match, indent: string, imagePath: string) => {
      const label = imagePath.split('/').pop() ?? imagePath
      return `${indent}![${label}](${imagePath})`
    }))
    .join('\n')
}

function decodeBase64Bytes(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function cellValueToString(value: unknown): string {
  if (value === null || typeof value === 'undefined') return ''
  if (value instanceof Date) return value.toLocaleString()
  if (typeof value === 'object') {
    const richValue = value as { formula?: unknown, result?: unknown, richText?: Array<{ text?: unknown }>, text?: unknown }
    if (Array.isArray(richValue.richText)) return richValue.richText.map(part => String(part.text ?? '')).join('')
    if (typeof richValue.text !== 'undefined') return String(richValue.text)
    if (typeof richValue.result !== 'undefined') return String(richValue.result)
    if (typeof richValue.formula !== 'undefined') return `=${richValue.formula}`
  }
  return String(value)
}

function OfficePreviewUnavailable({ reason }: { reason: string }) {
  return (
    <div className="agent-file-preview-unavailable">
      <strong>文件预览失败</strong>
      <span>{reason}</span>
    </div>
  )
}

function DocxPreview({ file }: { file: BinaryWorkspaceFilePreview }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let disposed = false
    const container = containerRef.current
    if (!container) return
    container.replaceChildren()
    setError('')

    void import('docx-preview')
      .then(({ renderAsync }) => renderAsync(decodeBase64Bytes(file.contentBase64).buffer, container))
      .catch(err => {
        if (!disposed) setError(err instanceof Error ? err.message : '无法解析 Word 文档')
      })

    return () => {
      disposed = true
      container.replaceChildren()
    }
  }, [file.contentBase64])

  if (error) return <OfficePreviewUnavailable reason={error} />
  return <div className="agent-docx-preview" ref={containerRef} />
}

function XlsxPreview({ file }: { file: BinaryWorkspaceFilePreview }) {
  const [error, setError] = useState('')
  const [sheets, setSheets] = useState<ExcelSheetPreview[]>([])

  useEffect(() => {
    let disposed = false
    setError('')
    setSheets([])

    void import('read-excel-file/browser')
      .then(async ({ default: readXlsxFile }) => {
        const workbook = await readXlsxFile(new Blob([decodeBase64Bytes(file.contentBase64)]))
        const nextSheets = workbook.slice(0, MAX_EXCEL_SHEETS).map(sheet => {
          const rowLimit = Math.min(sheet.data.length, MAX_EXCEL_ROWS)
          const columnCount = sheet.data.reduce((max, row) => Math.max(max, row.length), 0)
          const columnLimit = Math.min(columnCount, MAX_EXCEL_COLUMNS)
          const rows = sheet.data.slice(0, rowLimit).map(row => (
            Array.from({ length: columnLimit }, (_value, index) => cellValueToString(row[index]))
          ))

          return {
            name: sheet.sheet,
            rows,
            truncated: sheet.data.length > rowLimit || columnCount > columnLimit,
          }
        })

        if (!disposed) setSheets(nextSheets)
      })
      .catch(err => {
        if (!disposed) setError(err instanceof Error ? err.message : '无法解析 Excel 文件')
      })

    return () => {
      disposed = true
    }
  }, [file.contentBase64])

  const visibleSheets = useMemo(() => sheets.filter(sheet => sheet.rows.length > 0), [sheets])

  if (error) return <OfficePreviewUnavailable reason={error} />
  if (sheets.length === 0) {
    return (
      <div className="agent-file-preview-unavailable">
        <strong>解析 Excel 中</strong>
        <span>{file.name}</span>
      </div>
    )
  }
  if (visibleSheets.length === 0) {
    return (
      <div className="agent-file-preview-unavailable">
        <strong>空工作簿</strong>
        <span>没有可显示的单元格内容</span>
      </div>
    )
  }

  return (
    <div className="agent-xlsx-preview">
      {visibleSheets.map(sheet => (
        <section className="agent-xlsx-sheet" key={sheet.name}>
          <header>
            <strong>{sheet.name}</strong>
            {sheet.truncated ? <small>已截断显示</small> : null}
          </header>
          <div className="agent-xlsx-table-wrap">
            <table>
              <tbody>
                {sheet.rows.map((row, rowIndex) => (
                  <tr key={`${sheet.name}-${rowIndex}`}>
                    {row.map((cell, cellIndex) => (
                      <td key={`${sheet.name}-${rowIndex}-${cellIndex}`}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  )
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
        ) : file.type === 'binary' && file.contentBase64 && DOCX_EXT_RE.test(file.name) ? (
          <DocxPreview file={file as BinaryWorkspaceFilePreview} />
        ) : file.type === 'binary' && file.contentBase64 && XLSX_EXT_RE.test(file.name) ? (
          <XlsxPreview file={file as BinaryWorkspaceFilePreview} />
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
