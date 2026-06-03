import type { ComponentProps } from 'react'
import { GeneratedFilesTreeCard, type GeneratedFileTreeEntry } from '../../workspace/GeneratedFilesTreeCard'
import type { WorkspaceFilePreview } from '../types'
import { WorkspaceFilePreviewPanel } from '../WorkspaceFilePreviewPanel'

type AgentFilesViewProps = {
  activeContext: ComponentProps<typeof GeneratedFilesTreeCard>['activeContext']
  handleSelectFile: (entry: GeneratedFileTreeEntry) => void
  selectedFileError: string
  selectedFileLoading: boolean
  selectedFilePath: string
  selectedFilePreview: WorkspaceFilePreview | null
  workspaceRefreshNonce?: number
}

export function AgentFilesView({
  activeContext,
  handleSelectFile,
  selectedFileError,
  selectedFileLoading,
  selectedFilePath,
  selectedFilePreview,
  workspaceRefreshNonce = 0,
}: AgentFilesViewProps) {
  return (
    <div className="agent-file-stage">
      <aside className="agent-file-tree-pane">
        <GeneratedFilesTreeCard
          activeContext={activeContext}
          onSelectFile={handleSelectFile}
          refreshNonce={workspaceRefreshNonce}
          selectedFilePath={selectedFilePath}
        />
      </aside>
      <div className="agent-file-log-pane">
        {selectedFilePath ? (
          <WorkspaceFilePreviewPanel
            error={selectedFileError}
            file={selectedFilePreview}
            loading={selectedFileLoading}
            selectedPath={selectedFilePath}
          />
        ) : null}
      </div>
    </div>
  )
}
