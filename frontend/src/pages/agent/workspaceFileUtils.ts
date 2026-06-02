import {
  CONVERSATION_HISTORY_RELATIVE_PATH,
  CONVERSATION_PREVIEW_EVENT_LIMIT,
  CONVERSATION_PREVIEW_SESSION_LIMIT,
  CONVERSATION_PREVIEW_TURN_LIMIT,
} from './constants'
import type { WorkspaceContextQuery, WorkspaceFilePreview } from './types'

export function buildWorkspaceQuery(activeContext: WorkspaceContextQuery) {
  if (!activeContext.versionDir) return ''
  return `?${new URLSearchParams({
    workspaceDir: activeContext.versionDir,
    ...(activeContext.workspaceId ? { workspaceId: activeContext.workspaceId } : {}),
    ...(activeContext.versionId ? { versionId: activeContext.versionId } : {}),
  }).toString()}`
}

export function buildWorkspaceFileQuery(activeContext: WorkspaceContextQuery, relativePath: string) {
  if (!activeContext.versionDir) return ''
  return `?${new URLSearchParams({
    workspaceDir: activeContext.versionDir,
    relativePath,
    ...(activeContext.workspaceId ? { workspaceId: activeContext.workspaceId } : {}),
    ...(activeContext.versionId ? { versionId: activeContext.versionId } : {}),
  }).toString()}`
}

export function isMarkdownFile(file: WorkspaceFilePreview) {
  return file.type === 'text' && (file.mimeType === 'text/markdown' || file.name.toLowerCase().endsWith('.md'))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function limitConversationSession(session: Record<string, unknown>) {
  const turns = Array.isArray(session.turns)
    ? session.turns.filter(isRecord).slice(-CONVERSATION_PREVIEW_TURN_LIMIT).map(turn => ({
        ...turn,
        events: Array.isArray(turn.events)
          ? turn.events.slice(-CONVERSATION_PREVIEW_EVENT_LIMIT)
          : [],
      }))
    : []
  return {
    ...session,
    turns,
  }
}

export function getConversationHistoryContent(file: WorkspaceFilePreview) {
  if (file.type !== 'text' || file.relativePath !== CONVERSATION_HISTORY_RELATIVE_PATH) return null
  try {
    const parsed = JSON.parse(file.content) as unknown
    if (Array.isArray(parsed)) {
      return {
        sessions: parsed
          .filter(isRecord)
          .slice(-CONVERSATION_PREVIEW_SESSION_LIMIT)
          .map(limitConversationSession),
      }
    }
    if (!isRecord(parsed)) return null
    if (Array.isArray(parsed.sessions)) {
      return {
        ...parsed,
        sessions: parsed.sessions
          .filter(isRecord)
          .slice(-CONVERSATION_PREVIEW_SESSION_LIMIT)
          .map(limitConversationSession),
      }
    }
    return limitConversationSession(parsed)
  } catch {
    return null
  }
}

export function normalizeSpeechText(text: string) {
  return text.replace(/_/gu, ' ')
}
