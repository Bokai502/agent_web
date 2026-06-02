import type { TFunction } from "i18next"
import { APP_NAVIGATION_EVENT } from "../../app/sessionUtils"

type ActivePanel = "bom" | "log" | "model" | "cad" | "paraview" | "comsol" | "gnc-config"

type WorkspaceTopbarProps = {
  activePanel: ActivePanel
  activeSessionMatchesWorkspace: boolean
  stopSummaryPending?: boolean
  enableGncConfig?: boolean
  onStopAndSummarize?: () => void
  onReturnHome: () => void
  onSelectPanel: (panel: ActivePanel) => void
  showBom: boolean
  showModel: boolean
  showTools: boolean
  t: TFunction
  visibleRunning: boolean
}

export function WorkspaceTopbar({
  activePanel,
  activeSessionMatchesWorkspace,
  stopSummaryPending = false,
  enableGncConfig = false,
  onStopAndSummarize,
  onReturnHome,
  onSelectPanel,
  showBom,
  showModel,
  showTools,
  t,
  visibleRunning,
}: WorkspaceTopbarProps) {
  const navigateTo = (path: string) => {
    window.history.pushState(null, "", path)
    window.dispatchEvent(new Event(APP_NAVIGATION_EVENT))
  }

  return (
    <header className="wa-topbar">
      <div className="wa-topbar-inner">
        <div className="wa-nav-left">
          <button type="button" className="wa-back-button" aria-label={t("workspace.backAria")} onClick={onReturnHome}>
            <span>‹</span>
            <span>{t("common.home")}</span>
          </button>
          <button type="button" className="wa-route-button" onClick={() => navigateTo("/workspace")}>
            卫星热设计
          </button>
          <button type="button" className="wa-route-button" onClick={() => navigateTo("/gnc-workspace")}>
            卫星姿轨控
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
          {enableGncConfig && (
            <button
              type="button"
              className={activePanel === "gnc-config" ? "active" : undefined}
              onClick={() => onSelectPanel("gnc-config")}
            >
              配置文件
            </button>
          )}
          {showTools && !enableGncConfig && (
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
            {visibleRunning ? t("workspace.status.running") : activeSessionMatchesWorkspace ? t("workspace.status.loaded") : t("workspace.status.waiting")}
          </div>
        </div>
      </div>
    </header>
  )
}
