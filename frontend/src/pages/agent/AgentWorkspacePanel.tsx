import type { ComponentProps } from 'react'
import type { TFunction } from 'i18next'
import MagicRings from '../../components/MagicRings'
import { BomStagePanel } from '../workspace/BomStagePanel'
import { CurrentWorkspaceCard } from '../workspace/CurrentWorkspaceCard'
import { GeneratedFilesTreeCard, type GeneratedFileTreeEntry } from '../workspace/GeneratedFilesTreeCard'
import { LogStagePanel } from '../workspace/LogStagePanel'
import type { AgentToolView, AgentWorkspaceView, WorkspaceFilePreview } from './types'
import { WorkspaceFilePreviewPanel } from './WorkspaceFilePreviewPanel'

type CurrentWorkspaceCardProps = ComponentProps<typeof CurrentWorkspaceCard>
type BomStagePanelProps = ComponentProps<typeof BomStagePanel>
type LogStagePanelProps = ComponentProps<typeof LogStagePanel>
type GeneratedFilesTreeCardProps = ComponentProps<typeof GeneratedFilesTreeCard>

type AgentWorkspacePanelProps = {
  activeContext: GeneratedFilesTreeCardProps['activeContext'] & {
    versionDir?: string | null
    versionId?: string | null
    workspaceName?: string | null
  }
  activeManifestVersion: CurrentWorkspaceCardProps['activeManifestVersion']
  activeTool: AgentToolView
  activeView: AgentWorkspaceView | null
  bomInfo: BomStagePanelProps['bomInfo']
  bomLoading: boolean
  branchManifest: CurrentWorkspaceCardProps['branchManifest']
  checkoutVersion: CurrentWorkspaceCardProps['onCheckoutVersion']
  createChildBranch: CurrentWorkspaceCardProps['onCreateChildBranch']
  createSiblingBranch: CurrentWorkspaceCardProps['onCreateSiblingBranch']
  handleSelectFile: (entry: GeneratedFileTreeEntry) => void
  logEntries: LogStagePanelProps['logEntries']
  manifestLoading: boolean
  selectedBom: BomStagePanelProps['selectedBom']
  selectedFileError: string
  selectedFileLoading: boolean
  selectedFilePath: string
  selectedFilePreview: WorkspaceFilePreview | null
  selectedLog: LogStagePanelProps['selectedLog']
  setActiveTool: (tool: AgentToolView) => void
  setSelectedBomId: BomStagePanelProps['onSelectBom']
  setVersionListOpen: CurrentWorkspaceCardProps['onToggleVersionList']
  setWorkspaceListOpen: CurrentWorkspaceCardProps['onToggleWorkspaceList']
  switchActiveWorkspace: CurrentWorkspaceCardProps['onSelectWorkspace']
  t: TFunction
  toolUrls: Record<AgentToolView, string>
  versionAction: CurrentWorkspaceCardProps['versionAction']
  versionError: CurrentWorkspaceCardProps['versionError']
  versionListOpen: boolean
  versionTreeRoots: CurrentWorkspaceCardProps['versionTreeRoots']
  viewerHref: string
  workspaceChanging: boolean
  workspaceItems: CurrentWorkspaceCardProps['workspaceItems']
  workspaceListOpen: boolean
  workspaceRefreshNonce?: number
}

function getWorkspacePanelTitle(activeView: AgentWorkspaceView | null) {
  if (activeView === 'workspace') return '当前工作区'
  if (activeView === 'bom') return 'BOM'
  if (activeView === 'model') return '模型'
  if (activeView === 'tools') return '工具'
  if (activeView === 'log') return '文件'
  return '语音对话'
}

export function AgentWorkspacePanel({
  activeContext,
  activeManifestVersion,
  activeTool,
  activeView,
  bomInfo,
  bomLoading,
  branchManifest,
  checkoutVersion,
  createChildBranch,
  createSiblingBranch,
  handleSelectFile,
  logEntries,
  manifestLoading,
  selectedBom,
  selectedFileError,
  selectedFileLoading,
  selectedFilePath,
  selectedFilePreview,
  selectedLog,
  setActiveTool,
  setSelectedBomId,
  setVersionListOpen,
  setWorkspaceListOpen,
  switchActiveWorkspace,
  t,
  toolUrls,
  versionAction,
  versionError,
  versionListOpen,
  versionTreeRoots,
  viewerHref,
  workspaceChanging,
  workspaceItems,
  workspaceListOpen,
  workspaceRefreshNonce = 0,
}: AgentWorkspacePanelProps) {
  return (
    <section className={`agent-workspace-panel ${activeView ? 'is-open' : 'is-collapsed'}`}>
      {!activeView && (
        <>
          <MagicRings
            color="#558ef7"
            colorTwo="#6366F1"
            ringCount={6}
            speed={1}
            attenuation={10}
            lineThickness={2}
            baseRadius={0.35}
            radiusStep={0.1}
            scaleRate={0.1}
            opacity={1}
            blur={0}
            noiseAmount={0.1}
            rotation={0}
            ringGap={1.5}
            fadeIn={0.7}
            fadeOut={0.5}
            followMouse={false}
            mouseInfluence={0.2}
            hoverScale={1.2}
            parallax={0.05}
            clickBurst={false}
          />
          <span className="agent-collapsed-wave" />
        </>
      )}
      <div className="agent-workspace-header">
        <div>
          <strong>{getWorkspacePanelTitle(activeView)}</strong>
          <span>{activeView ? `${activeContext.workspaceName}${activeContext.versionId ? ` · ${activeContext.versionId}` : ''}` : '选择左侧功能展开工作区'}</span>
        </div>
        {activeView === 'tools' && (
          <div className="agent-tool-tabs">
            {(['cad', 'paraview', 'comsol', 'gnc'] as const).map(tool => (
              <button
                key={tool}
                type="button"
                className={activeTool === tool ? 'active' : undefined}
                onClick={() => setActiveTool(tool)}
              >
                {tool === 'cad' ? 'CAD' : tool === 'paraview' ? 'ParaView' : tool === 'comsol' ? 'COMSOL' : 'GNC'}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="agent-workspace-body">
        {!activeView ? (
          <div className="agent-empty-state">工作区已收回，点击左侧功能重新展开</div>
        ) : activeView === 'workspace' ? (
          <div className="agent-workspace-card-stage">
            <CurrentWorkspaceCard
              activeManifestVersion={activeManifestVersion}
              branchManifest={branchManifest}
              currentWorkspaceName={activeContext.workspaceName ?? '当前工作区'}
              manifestLoading={manifestLoading}
              onCheckoutVersion={checkoutVersion}
              onCreateChildBranch={createChildBranch}
              onCreateSiblingBranch={createSiblingBranch}
              onSelectWorkspace={switchActiveWorkspace}
              onToggleVersionList={setVersionListOpen}
              onToggleWorkspaceList={setWorkspaceListOpen}
              versionAction={versionAction}
              versionError={versionError}
              versionListOpen={versionListOpen}
              versionTreeRoots={versionTreeRoots}
              workspaceChanging={workspaceChanging}
              workspaceItems={workspaceItems}
              workspaceListOpen={workspaceListOpen}
            />
          </div>
        ) : activeView === 'bom' ? (
          <BomStagePanel
            bomInfo={bomInfo}
            bomLoading={bomLoading}
            onSelectBom={setSelectedBomId}
            selectedBom={selectedBom}
            t={t}
          />
        ) : activeView === 'model' ? (
          activeContext.versionDir ? (
            <iframe className="agent-embed-frame" title="模型" src={viewerHref} />
          ) : (
            <div className="agent-empty-state">等待当前工作区生成模型</div>
          )
        ) : activeView === 'tools' ? (
          <iframe className="agent-embed-frame" title={activeTool} src={toolUrls[activeTool]} />
        ) : (
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
              ) : (
                <LogStagePanel logEntries={logEntries} selectedLog={selectedLog} t={t} />
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
