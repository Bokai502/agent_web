export type VersionStatus = "draft" | "active" | "archived" | "committed" | "failed"

export interface VersionRecord {
  id: string
  parentVersionId: string | null
  [key: string]: unknown
  group?: string
  label?: string
  status: VersionStatus
  workspaceDir: string
  createdAt: string
  updatedAt: string
}

export type RunStatus = "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled"

export interface RunRecord {
  id: string
  [key: string]: unknown
  baseVersionId?: string | null
  createdAt: string
  inputs?: unknown
  kind?: string
  outputVersionId?: string | null
  retryOfRunId?: string | null
  sessionId?: string | null
  skillNames?: string[]
  status: RunStatus
  threadId?: string | null
  turnId?: string | null
  updatedAt: string
  versionId?: string | null
  workspaceId: string
}

export interface ArtifactRecord {
  id: string
  [key: string]: unknown
  createdAt: string
  kind: string
  path: string
  updatedAt: string
  versionId?: string | null
  workspaceId: string
}

export interface CheckpointRecord {
  id: string
  [key: string]: unknown
  artifactIds?: string[]
  createdAt: string
  kind: string
  runId?: string | null
  stateRefs?: string[]
  status?: string
  updatedAt: string
  versionId?: string | null
  workspaceId: string
}

export interface ScoreRecord {
  id: string
  [key: string]: unknown
  createdAt: string
  metric: string
  runId?: string | null
  updatedAt: string
  value: number
  versionId?: string | null
  workspaceId: string
}

export interface WorkspaceManifest {
  schemaVersion: "1.0"
  workspaceId: string
  group?: string
  sessionId: string
  rootDir: string
  activeVersionId: string | null
  versions: VersionRecord[]
  artifacts: ArtifactRecord[]
  checkpoints: CheckpointRecord[]
  createdAt: string
  runs: RunRecord[]
  scores: ScoreRecord[]
  updatedAt: string
}
