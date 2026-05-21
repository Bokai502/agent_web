export type VersionStatus = "draft" | "active" | "archived" | "failed"

export interface VersionRecord {
  id: string
  parentVersionId: string | null
  label?: string
  status: VersionStatus
  workspaceDir: string
  createdAt: string
  updatedAt: string
}

export interface WorkspaceManifest {
  schemaVersion: "1.0"
  workspaceId: string
  sessionId: string
  rootDir: string
  activeVersionId: string | null
  versions: VersionRecord[]
  createdAt: string
  updatedAt: string
}
