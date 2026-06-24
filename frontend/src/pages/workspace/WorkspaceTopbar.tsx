import type { TFunction } from "i18next"
import type { WorkspaceSessionStatus } from "./workspaceSessionVisibility"

type ActivePanel = "bom" | "log" | "model" | "cad" | "paraview" | "comsol"

type WorkspaceTopbarProps = {
  activePanel: ActivePanel
  activeSessionMatchesWorkspace: boolean
  stopSummaryPending?: boolean
  onStopAndSummarize?: () => void
  onReturnHome: () => void
  onSelectPanel: (panel: ActivePanel) => void
  showBom: boolean
  showModel: boolean
  showTools: boolean
  sessionStatus: WorkspaceSessionStatus
  t: TFunction
  visibleRunning: boolean
}

export function WorkspaceTopbar({
  activePanel,
  activeSessionMatchesWorkspace,
  stopSummaryPending = false,
  onStopAndSummarize,
  onReturnHome,
  onSelectPanel,
  showBom,
  showModel,
  showTools,
  sessionStatus,
  t,
  visibleRunning,
}: WorkspaceTopbarProps) {
  return (
    <header className="wa-topbar">
      <div className="wa-topbar-inner">
        <div className="wa-nav-left">
          <button type="button" className="wa-back-button" aria-label={t("workspace.backAria")} onClick={onReturnHome}>
            <span>‹</span>
            <span>{t("common.home")}</span>
          </button>
        </div>
        <div className="wa-tabs" aria-label={t("workspace.tabsAria")}>
          {showBom && (
            <button
              type="button"
              className={activePanel === "bom" ? "active" : undefined}
              onClick={() => onSelectPanel("bom")}
            >
              BOM
            </button>
          )}
          <button
            type="button"
            className={activePanel === "log" ? "active" : undefined}
            onClick={() => onSelectPanel("log")}
          >
            {t("workspace.tabs.log")}
          </button>
          {showModel && (
            <button
              type="button"
              className={activePanel === "model" ? "active" : undefined}
              onClick={() => onSelectPanel("model")}
            >
              {t("workspace.tabs.model")}
            </button>
          )}
          {showTools && (
            <div className="wa-tool-menu">
              <button type="button">{t("workspace.tabs.tools")} ▾</button>
              <div className="wa-tool-panel" role="menu" aria-label={t("workspace.toolsAria")}>
                <button type="button" onClick={() => onSelectPanel("cad")}>
                  CAD <span>CAD</span>
                </button>
                <button type="button" onClick={() => onSelectPanel("paraview")}>
                  ParaView <span>VNC</span>
                </button>
                <button type="button" onClick={() => onSelectPanel("comsol")}>
                  COMSOL <span>VNC</span>
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="wa-status-group">
          {activeSessionMatchesWorkspace && !visibleRunning && onStopAndSummarize && (
            <button
              type="button"
              className="wa-stop-summary-button"
              disabled={stopSummaryPending}
              onClick={onStopAndSummarize}
              title="停止当前 Codex 进程并生成语音总结"
            >
              <span aria-hidden="true" />
              {stopSummaryPending ? "总结中" : "停止"}
            </button>
          )}
          <div className="wa-status-pill">
            <span className="wa-status-dot" />
            {t(`workspace.status.${sessionStatus}`)}
          </div>
        </div>
      </div>
    </header>
  )
}
