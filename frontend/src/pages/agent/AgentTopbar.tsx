import { useEffect, useState } from 'react'
import type { WorkspaceSessionStatus } from '../workspace/workspaceSessionVisibility'

type AgentInputMode = 'voice' | 'text'

export type RemoteToolPortStatus = {
  ok: boolean
  tool: 'freecad' | 'paraview' | 'comsol'
  label: string
  host: string
  port: number
  latencyMs: number | null
  message: string
}

export type RemoteToolPortSummary = {
  ok: boolean
  checkedAt: string
  timeoutMs: number
  ports: RemoteToolPortStatus[]
}

type AgentTopbarProps = {
  conversationOpen: boolean
  dataSourceLabel: string
  inputMode: AgentInputMode
  onInputModeChange: (nextMode: AgentInputMode) => void
  onConversationToggle: () => void
  portStatus: RemoteToolPortSummary | null
  portStatusError: string
  portStatusLoading: boolean
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
  dataSourceLabel,
  inputMode,
  onInputModeChange,
  onConversationToggle,
  portStatus,
  portStatusError,
  portStatusLoading,
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
  const [portPanelOpen, setPortPanelOpen] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const showStopButton = sessionStatus === 'running'
  const healthyPorts = portStatus?.ports.filter(port => port.ok).length ?? 0
  const totalPorts = portStatus?.ports.length ?? 0
  const portVariant = portStatusError
    ? 'bad'
    : portStatus?.ok
      ? 'ok'
      : portStatusLoading && !portStatus
        ? 'checking'
        : 'bad'
  const realtimeLabel = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const portDetailLabel = portStatusError
    ? '端口不可用'
    : portStatus
      ? portStatus.ok ? '远程端口正常' : `端口异常 ${healthyPorts}/${totalPorts}`
      : '检测端口中'
  const checkedAtLabel = portStatus?.checkedAt
    ? `${new Date(portStatus.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })} 检测`
    : '等待检测'

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(intervalId)
  }, [])

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
      <div className="agent-topbar-port-status">
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
        <button
          type="button"
          className={`agent-port-card is-${portVariant} ${portPanelOpen ? 'is-open' : ''}`}
          aria-expanded={portPanelOpen}
          aria-haspopup="dialog"
          onClick={() => setPortPanelOpen(open => !open)}
        >
          <span className="agent-port-icon" aria-hidden="true" />
          <div>
            <strong>{realtimeLabel}</strong>
            <span>{portDetailLabel}</span>
          </div>
        </button>
        {portPanelOpen ? (
          <div className="agent-port-popover" role="dialog" aria-label="远程窗口端口状态">
            <header>
              <strong>远程窗口端口</strong>
              <span>{checkedAtLabel}</span>
            </header>
            {portStatusError ? (
              <p className="agent-port-error">{portStatusError}</p>
            ) : portStatus?.ports.length ? (
              <div className="agent-port-list">
                {portStatus.ports.map(port => (
                  <div className={`agent-port-row ${port.ok ? 'ok' : 'bad'}`} key={port.tool}>
                    <span className="agent-port-row-dot" />
                    <div>
                      <strong>{port.label}</strong>
                      <small>{port.host}:{port.port}</small>
                    </div>
                    <em>{port.ok ? '正常' : '异常'}</em>
                    <code>{port.ok && port.latencyMs !== null ? `${port.latencyMs}ms` : port.message}</code>
                  </div>
                ))}
              </div>
            ) : (
              <p>正在检测 FreeCAD、ParaView、COMSOL 端口...</p>
            )}
          </div>
        ) : null}
      </div>
    </header>
  )
}
