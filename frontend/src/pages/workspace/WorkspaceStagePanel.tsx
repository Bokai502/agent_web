import type { TFunction } from "i18next"
import type { BomComponent, BomInfo } from "../../components/bomData"
import { BomStagePanel } from "./BomStagePanel"
import { CatchSupportingTableEditor } from "./CatchSupportingTableEditor"
import { LogStagePanel } from "./LogStagePanel"
import { useLoadSimulationGuiData } from "./useLoadSimulationGuiData"
import type { RunLogEntry } from "./runLogUtils"
import { type WorkspaceVersionContext, usesCatchSupportingTable } from "./workspaceVersion"

type ActivePanel = "bom" | "log" | "model" | "cad" | "paraview" | "comsol"

type ActiveTool = {
  label: string
  subtitle: string
  title: string
  url: string
} | null

type WorkspaceStagePanelProps = {
  activePanel: ActivePanel
  activeContext: WorkspaceVersionContext
  activeTool: ActiveTool
  apiBase?: string
  bomInfo: BomInfo
  bomLoading: boolean
  cadHref: string
  hasModelPreview: boolean
  logEntries: RunLogEntry[]
  onOpenExternalWindow: (url: string) => void
  onRefreshWorkspaceViews?: () => void
  onSelectBom: (componentId: string) => void
  selectedBom?: BomComponent
  selectedLog: RunLogEntry | null
  showBom: boolean
  showModel: boolean
  showTools: boolean
  stageSubtitle: string
  stageTitle: string
  t: TFunction
  viewerHref: string
  visibleRunning: boolean
  visibleTurnsCount: number
}

export function WorkspaceStagePanel({
  activePanel,
  activeContext,
  activeTool,
  apiBase,
  bomInfo,
  bomLoading,
  cadHref,
  hasModelPreview,
  logEntries,
  onOpenExternalWindow,
  onRefreshWorkspaceViews,
  onSelectBom,
  selectedBom,
  selectedLog,
  showBom,
  showModel,
  showTools,
  stageSubtitle,
  stageTitle,
  t,
  viewerHref,
  visibleRunning,
  visibleTurnsCount,
}: WorkspaceStagePanelProps) {
  const simulationLoad = useLoadSimulationGuiData(apiBase, activeContext)
  const canLoadSimulationData = showTools && (activePanel === "paraview" || activePanel === "comsol")

  return (
    <section className="wa-panel wa-stage">
      <div className="wa-panel-header">
        <div className="wa-panel-title">
          <strong>{stageTitle}</strong>
          <span>{stageSubtitle}</span>
        </div>
      </div>
      <div className="wa-stage-body">
        {((showTools && activeTool) || (showModel && activePanel === "model" && hasModelPreview)) && (
          <div className="wa-stage-toolbar">
            {canLoadSimulationData && (
              <>
                <button
                  type="button"
                  className="wa-status-pill"
                  disabled={simulationLoad.pending || !activeContext.versionDir}
                  title={simulationLoad.status || "加载当前版本 native.vtu 和 work.mph 到 ParaView/COMSOL"}
                  onClick={simulationLoad.load}
                >
                  {simulationLoad.pending ? "加载中" : "加载数据"}
                </button>
                {simulationLoad.status && <span className="wa-tool-load-status">{simulationLoad.status}</span>}
              </>
            )}
            <button
              type="button"
              className="wa-status-pill"
              onClick={() => {
                if (activePanel === "model") onOpenExternalWindow(viewerHref)
                if (activeTool) onOpenExternalWindow(activeTool.url)
              }}
            >
              {activePanel === "model" ? t("workspace.stage.openModelViewer") : activeTool?.label}
            </button>
          </div>
        )}
        {showModel && activePanel === "model" ? (
          hasModelPreview ? (
            <iframe className="wa-viewer" title={t("workspace.stage.modelTitle")} src={viewerHref} />
          ) : (
            <div className="wa-stage-empty">
              <div className="wa-stage-empty-inner">
                <strong>{t("workspace.stage.waitModelTitle")}</strong>
                <span>{t("workspace.stage.waitModelDescription")}</span>
              </div>
            </div>
          )
        ) : activePanel === "bom" && showBom && usesCatchSupportingTable(activeContext) ? (
          <CatchSupportingTableEditor
            activeContext={activeContext}
            apiBase={apiBase}
            onSaved={onRefreshWorkspaceViews}
          />
        ) : activePanel === "bom" && showBom ? (
          <BomStagePanel
            bomInfo={bomInfo}
            bomLoading={bomLoading}
            onSelectBom={onSelectBom}
            selectedBom={selectedBom}
            t={t}
          />
        ) : activePanel === "log" || !showTools ? (
          <LogStagePanel logEntries={logEntries} selectedLog={selectedLog} t={t} />
        ) : (
          <iframe
            className="wa-viewer"
            title={activeTool?.label ?? t("workspace.stage.remoteToolTitle")}
            src={activeTool?.url ?? cadHref}
          />
        )}
      </div>
      <div className={`wa-stage-footer${showBom ? "" : " compact"}`}>
        {showBom && (
          <div>
            <strong>{bomInfo.totalRecords || "-"}</strong>
            <span>{t("workspace.footer.bomComponents")}</span>
          </div>
        )}
        <div>
          <strong>{visibleTurnsCount}</strong>
          <span>{t("workspace.footer.turns")}</span>
        </div>
        <div>
          <strong>{visibleRunning ? t("workspace.status.run") : t("workspace.status.idle")}</strong>
          <span>{t("workspace.footer.currentStatus")}</span>
        </div>
      </div>
    </section>
  )
}
