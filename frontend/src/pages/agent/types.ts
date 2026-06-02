export type RecorderState = 'idle' | 'recording' | 'transcribing' | 'thinking' | 'done' | 'error'

export type AgentSpeechState = 'idle' | 'synthesizing' | 'ready' | 'error'

export type AgentMessage = {
  createdAt: number | null
  id: string
  itemId: string
  role: 'assistant'
  sequence: number
  sessionId: string
  status: 'final'
  text: string
  turnId: string
}

export type AgentWorkspaceView = 'workspace' | 'bom' | 'model' | 'tools' | 'log'

export type AgentToolView = 'cad' | 'paraview' | 'comsol' | 'gnc'

export type ViewerComponentMessage = {
  componentId?: unknown
  semanticName?: unknown
  type?: unknown
}

export type WorkspaceContextQuery = {
  versionDir?: string | null
  versionId?: string | null
  workspaceId?: string | null
}

export type WorkspaceFilePreview =
  | {
      content: string
      encoding: 'utf-8'
      mimeType: string
      mtimeMs: number
      name: string
      relativePath: string
      size: number
      type: 'text'
    }
  | {
      contentBase64: string
      encoding: 'base64'
      mimeType: string
      mtimeMs: number
      name: string
      relativePath: string
      size: number
      type: 'image'
    }
  | {
      mimeType: string
      mtimeMs: number
      name: string
      previewable?: false
      reason?: string
      relativePath: string
      size: number
      type: 'binary'
    }
