type AgentTopbarProps = {
  activeSessionMatchesWorkspace: boolean
  conversationOpen: boolean
  currentDate: string
  currentTime: string
  dataSourceLabel: string
  onConversationToggle: () => void
  onProgressToggle: () => void
  progressOpen: boolean
  progressPercent: number
  progressStatusLabel: string
  progressTitle: string
  sessionStatusLabel: string
  versionLabel: string
  visibleRunning: boolean
}

export function AgentTopbar({
  activeSessionMatchesWorkspace,
  conversationOpen,
  currentDate,
  currentTime,
  dataSourceLabel,
  onConversationToggle,
  onProgressToggle,
  progressOpen,
  progressPercent,
  progressStatusLabel,
  progressTitle,
  sessionStatusLabel,
  versionLabel,
  visibleRunning,
}: AgentTopbarProps) {
  return (
    <header className="agent-hud-topbar">
      <div className="agent-brand">
        <img src="/logo_1.png" alt="SATLAB" className="agent-brand-logo" />
      </div>
      <div className="agent-topbar-status">
        <button
          type="button"
          className={`agent-status-pill agent-status-pill--session agent-session-pill ${visibleRunning ? 'is-running' : activeSessionMatchesWorkspace ? 'is-loaded' : 'is-waiting'} ${conversationOpen ? 'is-open' : ''}`}
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
