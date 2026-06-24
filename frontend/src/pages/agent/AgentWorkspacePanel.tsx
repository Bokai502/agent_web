import { useState, type ComponentProps } from 'react'
import type { TFunction } from 'i18next'
import { GncConfigEditor } from '../../../gnc_config/GncConfigEditor'
import GncFlowEditor from '../../../gnc_flow/App'
import '../../../gnc_flow/index.css'
import { ExecutionFlow } from '../../components/execution-flow/ExecutionFlow'
import MagicRings from '../../components/MagicRings'
import { BomStagePanel } from '../workspace/BomStagePanel'
import { CatchSupportingTableEditor } from '../workspace/CatchSupportingTableEditor'
import { CurrentWorkspaceCard } from '../workspace/CurrentWorkspaceCard'
import { GncDashboardPanel } from '../workspace/GncDashboardPanel'
import { getWorkspaceDisplayName, usesCatchSupportingTable } from '../workspace/workspaceVersion'
import { ComplianceCheckInputConfigEditor } from './ComplianceCheckInputConfigEditor'
import type { AgentToolView, AgentWorkspaceView, WorkspaceFilePreview } from './types'
import { AgentFilesView } from './files/AgentFilesView'
import type { GeneratedFileTreeEntry } from '../workspace/GeneratedFilesTreeCard'
import { useLoadSimulationGuiData } from '../workspace/useLoadSimulationGuiData'

type CurrentWorkspaceCardProps = ComponentProps<typeof CurrentWorkspaceCard>
type BomStagePanelProps = ComponentProps<typeof BomStagePanel>
type AgentFilesViewProps = ComponentProps<typeof AgentFilesView>

type AgentWorkspacePanelProps = {
  activeContext: AgentFilesViewProps['activeContext'] & {
    versionDir?: string | null
    versionId?: string | null
    workspaceName?: string | null
  }
  activeManifestVersion: CurrentWorkspaceCardProps['activeManifestVersion']
  activeTool: AgentToolView
  activeView: AgentWorkspaceView | null
  apiBase?: string
  bomInfo: BomStagePanelProps['bomInfo']
  bomLoading: boolean
  branchManifest: CurrentWorkspaceCardProps['branchManifest']
  cancelDeleteVersion: CurrentWorkspaceCardProps['onCancelDeleteVersion']
  checkoutVersion: CurrentWorkspaceCardProps['onCheckoutVersion']
  confirmDeleteVersion: CurrentWorkspaceCardProps['onConfirmDeleteVersion']
  createChildBranch: CurrentWorkspaceCardProps['onCreateChildBranch']
  createInitialVersion: CurrentWorkspaceCardProps['onCreateInitialVersion']
  createVersionFromInput: CurrentWorkspaceCardProps['onCreateVersionFromInput']
  handleSelectFile: (entry: GeneratedFileTreeEntry) => void
  manifestLoading: boolean
  selectedBom: BomStagePanelProps['selectedBom']
  selectedFileError: string
  selectedFileLoading: boolean
  selectedFilePath: string
  selectedFilePreview: WorkspaceFilePreview | null
  setActiveTool: (tool: AgentToolView) => void
  setSelectedBomId: BomStagePanelProps['onSelectBom']
  requestDeleteVersion: CurrentWorkspaceCardProps['onRequestDeleteVersion']
  refreshWorkspaceViews?: () => void
  theme: 'dark' | 'light'
  showComplianceCheckConfig: boolean
  showGncConfig: boolean
  showModelPreview: boolean
  switchActiveWorkspace: CurrentWorkspaceCardProps['onSelectWorkspace']
  t: TFunction
  toolUrls: Partial<Record<AgentToolView, string>>
  versionAction: CurrentWorkspaceCardProps['versionAction']
  versionDeleteTarget: CurrentWorkspaceCardProps['versionDeleteTarget']
  versionError: CurrentWorkspaceCardProps['versionError']
  viewerHref: string
  workspaceChanging: boolean
  workspaceItems: CurrentWorkspaceCardProps['workspaceItems']
  workspaceRefreshNonce?: number
}

function getWorkspacePanelTitle(activeView: AgentWorkspaceView | null, showComplianceCheckConfig: boolean, showGncConfig: boolean) {
  if (activeView === 'workspace') return '当前任务'
  if (activeView === 'bom' && showComplianceCheckConfig) return '配置文件'
  if (activeView === 'bom') return showGncConfig ? 'GNC 配置' : '配置文件'
  if (activeView === 'model') return '结果预览'
  if (activeView === 'tools') return showGncConfig ? 'GNC 工具' : '仿真工具'
  if (activeView === 'log') return '工作区文件'
  return '语音对话'
}

export function AgentWorkspacePanel({
  activeContext,
  activeManifestVersion,
  activeTool,
  activeView,
  apiBase,
  bomInfo,
  bomLoading,
  branchManifest,
  cancelDeleteVersion,
  checkoutVersion,
  confirmDeleteVersion,
  createChildBranch,
  createInitialVersion,
  createVersionFromInput,
  handleSelectFile,
  manifestLoading,
  selectedBom,
  selectedFileError,
  selectedFileLoading,
  selectedFilePath,
  selectedFilePreview,
  setActiveTool,
  setSelectedBomId,
  requestDeleteVersion,
  refreshWorkspaceViews,
  theme,
  showComplianceCheckConfig,
  showGncConfig,
  showModelPreview,
  switchActiveWorkspace,
  t,
  toolUrls,
  versionAction,
  versionDeleteTarget,
  versionError,
  viewerHref,
  workspaceChanging,
  workspaceItems,
  workspaceRefreshNonce = 0,
}: AgentWorkspacePanelProps) {
  const [thermalConfigTab, setThermalConfigTab] = useState<'catch-table' | 'execution-flow'>('catch-table')
  const [gncConfigTab, setGncConfigTab] = useState<'files' | 'flow'>('files')
  const simulationLoad = useLoadSimulationGuiData(apiBase, activeContext)
  const panelClassName = [
    'agent-workspace-panel',
    activeView ? 'is-open' : 'is-collapsed',
    activeView ? `is-${activeView}-view` : '',
  ].filter(Boolean).join(' ')
  const showThermalConfigTabs = activeView === 'bom' && !showComplianceCheckConfig && !showGncConfig
  const showGncConfigTabs = activeView === 'bom' && showGncConfig
  const toolTabs: AgentToolView[] = showGncConfig
    ? ['gnc-dashboard', 'gnc']
    : ['cad', 'paraview', 'comsol']
  const toolLabel = (tool: AgentToolView) => {
    if (tool === 'cad') return 'CAD'
    if (tool === 'paraview') return 'ParaView'
    if (tool === 'comsol') return 'COMSOL'
    if (tool === 'gnc-dashboard') return 'GNC 看板'
    return 'GNC'
  }
  const thermalConfigContent = usesCatchSupportingTable(activeContext) ? (
    <CatchSupportingTableEditor
      activeContext={activeContext}
      apiBase={apiBase}
      onSaved={refreshWorkspaceViews}
    />
  ) : (
    <BomStagePanel
      bomInfo={bomInfo}
      bomLoading={bomLoading}
      onSelectBom={setSelectedBomId}
      selectedBom={selectedBom}
      t={t}
    />
  )
  const executionFlowContent = (
    <ExecutionFlow
      className="execution-flow-embedded"
      height="100%"
      showThemeSwitch={false}
      theme={theme}
      versionId={activeContext.versionId ?? undefined}
      workspaceDir={activeContext.versionDir ?? undefined}
      workspaceId={activeContext.workspaceId ?? undefined}
    />
  )
  const canLoadSimulationData = activeView === 'tools' && (activeTool === 'paraview' || activeTool === 'comsol')

  return (
    <section className={panelClassName}>
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
          <strong>{getWorkspacePanelTitle(activeView, showComplianceCheckConfig, showGncConfig)}</strong>
          <span>{activeView ? `${getWorkspaceDisplayName(activeContext.workspaceName)}${activeContext.versionId ? ` · ${activeContext.versionId}` : ''}` : '选择左侧模块展开当前任务'}</span>
        </div>
        {showThermalConfigTabs && (
          <div className="agent-tool-tabs">
            <button
              type="button"
              className={thermalConfigTab === 'catch-table' ? 'active' : undefined}
              onClick={() => setThermalConfigTab('catch-table')}
            >
              整星配套表
            </button>
            <button
              type="button"
              className={thermalConfigTab === 'execution-flow' ? 'active' : undefined}
              onClick={() => setThermalConfigTab('execution-flow')}
            >
              智能体执行流程
            </button>
          </div>
        )}
        {showGncConfigTabs && (
          <div className="agent-tool-tabs">
            <button
              type="button"
              className={gncConfigTab === 'files' ? 'active' : undefined}
              onClick={() => setGncConfigTab('files')}
            >
              GNC 配置文件
            </button>
            <button
              type="button"
              className={gncConfigTab === 'flow' ? 'active' : undefined}
              onClick={() => setGncConfigTab('flow')}
            >
              GNC 流程图编辑器
            </button>
          </div>
        )}
        {activeView === 'tools' && (
          <div className="agent-tool-tabs">
            {toolTabs.map(tool => (
              <button
                key={tool}
                type="button"
                className={activeTool === tool ? 'active' : undefined}
                onClick={() => setActiveTool(tool)}
              >
                {toolLabel(tool)}
              </button>
            ))}
          </div>
        )}
        {canLoadSimulationData && (
          <div className="agent-tool-actions">
            <button
              type="button"
              className="agent-tool-load-button"
              disabled={simulationLoad.pending || !activeContext.versionDir}
              title={simulationLoad.status || '加载当前版本 native.vtu 和 work.mph 到 ParaView/COMSOL'}
              onClick={simulationLoad.load}
            >
              {simulationLoad.pending ? '加载中' : '加载数据'}
            </button>
            {simulationLoad.status && <span>{simulationLoad.status}</span>}
          </div>
        )}
      </div>
      <div className="agent-workspace-body">
        {!activeView ? (
          <div className="agent-empty-state">当前任务已收回，点击左侧模块重新展开</div>
        ) : activeView === 'workspace' ? (
          <CurrentWorkspaceCard
            activeManifestVersion={activeManifestVersion}
            branchManifest={branchManifest}
            currentWorkspaceName={activeContext.workspaceName ?? '当前任务'}
            manifestLoading={manifestLoading}
            onCheckoutVersion={checkoutVersion}
            onCancelDeleteVersion={cancelDeleteVersion}
            onConfirmDeleteVersion={confirmDeleteVersion}
            onCreateChildBranch={createChildBranch}
            onCreateInitialVersion={createInitialVersion}
            onCreateVersionFromInput={createVersionFromInput}
            onRequestDeleteVersion={requestDeleteVersion}
            onSelectWorkspace={switchActiveWorkspace}
            versionAction={versionAction}
            versionDeleteTarget={versionDeleteTarget}
            versionError={versionError}
            workspaceChanging={workspaceChanging}
            workspaceItems={workspaceItems}
          />
        ) : activeView === 'bom' && showComplianceCheckConfig ? (
          <ComplianceCheckInputConfigEditor activeContext={activeContext} />
        ) : activeView === 'bom' && showGncConfig ? (
          <div className="agent-gnc-config-panel">
            {gncConfigTab === 'files' ? (
              <GncConfigEditor activeContext={activeContext} />
            ) : (
              <GncFlowEditor activeContext={activeContext} />
            )}
          </div>
        ) : activeView === 'bom' ? (
          <div className="agent-thermal-config">
            <div className="agent-thermal-tab-panel">
              {thermalConfigTab === 'catch-table' ? thermalConfigContent : executionFlowContent}
            </div>
          </div>
        ) : activeView === 'model' && showModelPreview ? (
          activeContext.versionDir ? (
            <iframe className="agent-embed-frame" title="结果预览" src={viewerHref} />
          ) : (
            <div className="agent-empty-state">等待当前任务生成结果预览</div>
          )
        ) : activeView === 'model' ? (
          <div className="agent-empty-state">当前任务没有 3D 结果预览</div>
        ) : activeView === 'tools' && activeTool === 'gnc-dashboard' && showGncConfig ? (
          <GncDashboardPanel activeContext={activeContext} />
        ) : activeView === 'tools' ? (
          toolUrls[activeTool] ? (
            <iframe className="agent-embed-frame" title={activeTool} src={toolUrls[activeTool]} />
          ) : (
            <div className="agent-empty-state">当前仿真工具没有可打开的远程窗口</div>
          )
        ) : (
          <AgentFilesView
            activeContext={activeContext}
            handleSelectFile={handleSelectFile}
            selectedFileError={selectedFileError}
            selectedFileLoading={selectedFileLoading}
            selectedFilePath={selectedFilePath}
            selectedFilePreview={selectedFilePreview}
            workspaceRefreshNonce={workspaceRefreshNonce}
          />
        )}
      </div>
    </section>
  )
}
