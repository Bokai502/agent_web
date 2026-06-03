import type { WorkspaceSessionStatus } from '../workspace/workspaceSessionVisibility'

type AgentInputMode = 'voice' | 'text'

type AgentTopbarProps = {
  conversationOpen: boolean
  currentDate: string
  currentTime: string
  dataSourceLabel: string
  inputMode: AgentInputMode
  onInputModeChange: (nextMode: AgentInputMode) => void
  onConversationToggle: () => void
  onProgressToggle: () => void
  onStopAndSummarize: () => void
  progressOpen: boolean
  progressPercent: number
  progressStatusLabel: string
  progressTitle: string
  sessionStatus: WorkspaceSessionStatus
  sessionStatusLabel: string
  stopSummaryPending: boolean
  versionLabel: string
}

export function AgentTopbar({
  conversationOpen,
  currentDate,
  currentTime,
  dataSourceLabel,
  inputMode,
  onInputModeChange,
  onConversationToggle,
  onProgressToggle,
  onStopAndSummarize,
  progressOpen,
  progressPercent,
  progressStatusLabel,
  progressTitle,
  sessionStatus,
  sessionStatusLabel,
  stopSummaryPending,
  versionLabel,
}: AgentTopbarProps) {
  const showStopButton = sessionStatus === 'running'

  return (
    <header className="agent-hud-topbar">
      <div className="agent-brand">
        <img src="/logo_1.png" alt="SATLAB" className="agent-brand-logo" />
      </div>
      <div className="agent-topbar-status">
        <div className={`agent-session-control ${showStopButton ? 'has-stop' : ''}`}>
          <button
            type="button"
            className={`agent-status-pill agent-status-pill--session agent-session-pill is-${sessionStatus} ${conversationOpen ? 'is-open' : ''}`}
            aria-expanded={conversationOpen}
            aria-haspopup="dialog"
            onClick={onConversationToggle}
          >
            <span className="agent-session-status">
              <span className="agent-session-dot" />
              <span className="agent-session-label">{sessionStatusLabel}</span>
            </span>
            <span className="agent-session-copy">
              <span className="agent-session-source">{dataSourceLabel}</span>
              <span className="agent-session-version">· {versionLabel}</span>
            </span>
          </button>
          {showStopButton ? (
            <button
              type="button"
              className="agent-stop-summary-button agent-stop-summary-button--topbar"
              disabled={stopSummaryPending}
              onClick={onStopAndSummarize}
              title="停止当前 Codex pipeline 并生成语音总结"
            >
              <span aria-hidden="true" />
              {stopSummaryPending ? '总结中' : '停止'}
            </button>
          ) : null}
        </div>
        <button
          type="button"
          className={`agent-status-pill agent-status-pill--progress agent-progress-pill ${progressOpen ? 'is-open' : ''}`}
          aria-expanded={progressOpen}
          aria-haspopup="dialog"
          onClick={onProgressToggle}
        >
          <span className="agent-progress-orbit" aria-hidden="true" />
          <span className="agent-progress-copy">
            <strong>{progressTitle}</strong>
            <small>{progressStatusLabel}</small>
          </span>
          <span className="agent-progress-value">{progressPercent}%</span>
        </button>
      </div>
      <div className="agent-topbar-clock">
        <div className="agent-input-mode-switch" role="group" aria-label="输入方式">
          <button
            type="button"
            className={inputMode === 'voice' ? 'is-active' : ''}
            aria-pressed={inputMode === 'voice'}
            onClick={() => onInputModeChange('voice')}
          >
            语音
          </button>
          <button
            type="button"
            className={inputMode === 'text' ? 'is-active' : ''}
            aria-pressed={inputMode === 'text'}
            onClick={() => onInputModeChange('text')}
          >
            文字
          </button>
        </div>
        <div className="agent-clock-card">
          <span className="agent-clock-icon" aria-hidden="true" />
          <div>
            <strong>{currentTime}</strong>
            <span>{currentDate}</span>
          </div>
        </div>
      </div>
    </header>
  )
}
