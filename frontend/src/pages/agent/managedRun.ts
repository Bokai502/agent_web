import { joinApiPath } from '../../app/apiBase'
import type { CodexInputItem } from '../../types'

export type ManagedRunWorkspace = {
  workspaceDir?: string | null
  workspaceId?: string | null
  workspaceName?: string | null
  versionId?: string | null
}

export type ManagedRunResponse = {
  artifacts?: Array<{ exists: boolean; kind: string; path: string }>
  error?: string
  issues?: string[]
  managedRunId?: string
  routing?: {
    selectedSkills?: string[]
    skillScopes: string[]
  }
  sessionId?: string
  spokenSummary?: string
  status?: 'completed' | 'failed' | 'cancelled' | 'partial'
  summary?: string
  threadId?: string | null
  turnId?: string
  workspaceDir?: string | null
  workspaceId?: string | null
}

export type ManagedStartResponse = {
  error?: string
  managedRunId?: string
  routing?: {
    selectedSkills?: string[]
    skillScopes: string[]
  }
  sessionId: string
  spokenSummary?: string
  status: 'started'
  summary?: string
  threadId?: string | null
  turnId: string
  workspaceDir?: string | null
  workspaceId?: string | null
}

export type ManagedDispatchResponse = ManagedStartResponse | ManagedRunResponse

export type ManagedRunStatusResponse = {
  error?: string
  managedRunId: string
  routing?: {
    selectedSkills?: string[]
    skillScopes: string[]
  }
  sessionId: string
  spokenSummary?: string
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'partial'
  summary?: string
  threadId?: string | null
  turnId: string
  workspaceDir?: string | null
  workspaceId?: string | null
}

export type ManagedLatestStatusResponse = ManagedRunStatusResponse | { status: 'none' }

export type ManagedRunEvent =
  | { type: 'accepted'; managedRunId: string; inputType: 'text' | 'voice'; requestId?: string }
  | { type: 'routing'; managedRunId: string; routing: { selectedSkills?: string[]; skillScopes: string[] } }
  | { type: 'started'; managedRunId: string; status: ManagedRunStatusResponse }
  | { type: 'status'; managedRunId: string; status: ManagedRunStatusResponse }
  | { type: 'final'; managedRunId: string; status: ManagedRunStatusResponse }
  | { type: 'failed'; managedRunId: string; status: ManagedRunStatusResponse }

type ManagedRunRequest = {
  apiBase?: string
  enabledSkills?: string[]
  input: string | CodexInputItem[]
  inputType?: 'text' | 'voice'
  sessionId?: string | null
  threadId?: string | null
  turnId?: string | null
  workspace?: ManagedRunWorkspace
}

async function getResponseErrorMessage(response: Response) {
  const payload = await response.json().catch(() => ({})) as { error?: unknown; message?: unknown }
  if (typeof payload.error === 'string') return payload.error
  if (typeof payload.message === 'string') return payload.message
  return `请求失败：${response.status}`
}

async function postManagedRun<TResponse>(path: string, {
  apiBase,
  enabledSkills = [],
  input,
  inputType,
  sessionId,
  threadId,
  turnId,
  workspace,
}: ManagedRunRequest) {
  const response = await fetch(joinApiPath(apiBase, path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(typeof input === 'string' ? { prompt: input } : { input }),
      enabledSkills,
      ...(inputType ? { inputType } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(threadId ? { threadId } : {}),
      ...(turnId ? { turnId } : {}),
      workspaceDir: workspace?.workspaceDir ?? null,
      workspaceId: workspace?.workspaceId ?? null,
      workspaceName: workspace?.workspaceName ?? null,
      versionId: workspace?.versionId ?? null,
    }),
  })

  if (!response.ok) throw new Error(await getResponseErrorMessage(response))
  return response.json() as Promise<TResponse>
}

export async function dispatchManagedCodex(request: ManagedRunRequest) {
  return postManagedRun<ManagedDispatchResponse>('/run/managed/dispatch', request)
}

export async function summarizeManagedCodex(request: ManagedRunRequest) {
  return postManagedRun<ManagedRunResponse>('/run/managed/summarize', request)
}

export async function getManagedCodexStatus(managedRunId: string, apiBase?: string) {
  const response = await fetch(joinApiPath(apiBase, `/run/managed/status/${encodeURIComponent(managedRunId)}`), {
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(await getResponseErrorMessage(response))
  return response.json() as Promise<ManagedRunStatusResponse>
}

export async function getLatestManagedCodexStatus({
  apiBase,
  versionId,
  workspaceDir,
  workspaceId,
}: {
  apiBase?: string
  versionId?: string | null
  workspaceDir?: string | null
  workspaceId?: string | null
}) {
  const params = new URLSearchParams()
  if (workspaceDir) params.set('workspaceDir', workspaceDir)
  if (workspaceId) params.set('workspaceId', workspaceId)
  if (versionId) params.set('versionId', versionId)
  const suffix = params.toString()
  const response = await fetch(joinApiPath(apiBase, `/run/managed/latest${suffix ? `?${suffix}` : ''}`), {
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(await getResponseErrorMessage(response))
  return response.json() as Promise<ManagedLatestStatusResponse>
}

export async function cancelManagedCodex(managedRunId: string, apiBase?: string) {
  const response = await fetch(joinApiPath(apiBase, `/run/managed/cancel/${encodeURIComponent(managedRunId)}`), {
    method: 'POST',
  })
  if (!response.ok) throw new Error(await getResponseErrorMessage(response))
  return response.json() as Promise<ManagedRunStatusResponse>
}

export function subscribeManagedCodexStatus(
  managedRunId: string,
  onStatus: (status: ManagedRunStatusResponse) => void,
  onError?: (error: Event) => void,
  apiBase?: string,
  onEvent?: (event: ManagedRunEvent) => void,
) {
  const eventSource = new EventSource(joinApiPath(apiBase, `/run/managed/events/${encodeURIComponent(managedRunId)}`))
  const handleEvent = (event: MessageEvent<string>) => {
    const message = event as MessageEvent<string>
    try {
      const payload = JSON.parse(message.data) as ManagedRunEvent
      onEvent?.(payload)
      if ('status' in payload) onStatus(payload.status)
    } catch {
      // Ignore malformed event payloads; the status endpoint remains a fallback.
    }
  }
  for (const eventName of ['accepted', 'routing', 'started', 'status', 'final', 'failed']) {
    eventSource.addEventListener(eventName, event => handleEvent(event as MessageEvent<string>))
  }
  eventSource.onerror = (event) => {
    onError?.(event)
  }
  return () => eventSource.close()
}
