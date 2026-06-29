import { useEffect, useState } from 'react'
import { APP_NAVIGATION_EVENT } from '../../app/sessionUtils'
import type { WorkspaceSessionStatus } from '../workspace/workspaceSessionVisibility'

type AgentInputMode = 'voice' | 'text'
type AgentModelBackend = 'openai' | 'chatModel'
type AgentTheme = 'dark' | 'light'

type AuthMe = {
  userId: string
}

function formatCheckedAt(value?: string) {
  if (!value) return ''
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return value
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false })
}

function formatInterfaceDetail(item: InterfaceCheckResult) {
  const duration = Number.isFinite(item.durationMs) ? `${item.durationMs}ms` : ''
  const status = item.status ? `HTTP ${item.status}` : ''
  const message = item.ok ? item.message : item.error || item.message
  return [item.target, status, duration, message].filter(Boolean).join(' · ')
}

export type InterfaceCheckResult = {
  ok: boolean
  group: string
  name: string
  target: string
  required: boolean
  skipped: boolean
  durationMs: number
  message: string
  error?: string
  status?: number
  bytes?: number
}

export type RemoteToolPortSummary = {
  ok: boolean
  checkedAt: string
  cacheTtlMs?: number
  results: InterfaceCheckResult[]
  requiredFailureCount: number
  optionalFailureCount: number
  skippedCount: number
}

type AgentTopbarProps = {
  agentTheme: AgentTheme
  conversationOpen: boolean
  dataSourceLabel: string
  inputMode: AgentInputMode
  modelBackend: AgentModelBackend
  onAgentThemeChange: (nextTheme: AgentTheme) => void
  onInputModeChange: (nextMode: AgentInputMode) => void
  onModelBackendChange: (nextBackend: AgentModelBackend) => void
  onConversationToggle: () => void
  portStatus: RemoteToolPortSummary | null
  portStatusError: string
  portStatusLoading: boolean
  onPortStatusRefresh: () => void
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
  agentTheme,
  conversationOpen,
  dataSourceLabel,
  inputMode,
  modelBackend,
  onAgentThemeChange,
  onInputModeChange,
  onModelBackendChange,
  onConversationToggle,
  portStatus,
  portStatusError,
  portStatusLoading,
  onPortStatusRefresh,
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
  const [loggingOut, setLoggingOut] = useState(false)
  const [userId, setUserId] = useState('default')
  const showStopButton = sessionStatus === 'running'
  const portVariant = portStatusError
    ? 'bad'
    : portStatus?.ok
      ? 'ok'
      : portStatusLoading && !portStatus
        ? 'checking'
        : 'bad'
  const failedChecks = portStatus?.results.filter(item => !item.ok) ?? []
  const skippedChecks = portStatus?.results.filter(item => item.skipped) ?? []
  const showInterfaceStatus = Boolean(portStatusError || failedChecks.length)
  const checkedAtLabel = formatCheckedAt(portStatus?.checkedAt)
  const initials = userId.trim().slice(0, 1).toUpperCase() || 'U'
  const inputModeLabel = inputMode === 'voice' ? '语音输入' : '文字输入'
  const totalChecks = portStatus?.results.length ?? 0

  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/me', { cache: 'no-store' })
      .then(async response => response.ok ? await response.json() as AuthMe : null)
      .then(data => {
        if (!data || cancelled) return
        setUserId(data.userId)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const handleLogout = async () => {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch {
      // Continue navigation even if the logout request fails.
    } finally {
      setPortPanelOpen(false)
      setLoggingOut(false)
      window.history.pushState(null, '', '/home')
      window.dispatchEvent(new Event(APP_NAVIGATION_EVENT))
    }
  }

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
              title="停止当前 Agent pipeline 并生成语音总结"
            >
              <span aria-hidden="true" />
              {stopSummaryPending ? '总结中' : '停止'}
            </button>
          ) : null}
        </div>
      </div>
      <div className="agent-topbar-port-status">
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
        <button
          type="button"
          className={`agent-port-card is-${portVariant} ${portPanelOpen ? 'is-open' : ''}`}
          title={`${inputModeLabel}，点击打开状态与设置`}
          aria-expanded={portPanelOpen}
          aria-haspopup="dialog"
          onClick={() => setPortPanelOpen(open => !open)}
        >
          <span className="agent-port-user-initial" aria-hidden="true">{initials}</span>
          <span
            className={`agent-input-mode-icon ${inputMode === 'text' ? 'is-muted' : 'is-live'}`}
            aria-label={inputModeLabel}
            role="img"
          >
            <span className="agent-input-muted-slash" aria-hidden="true" />
          </span>
        </button>
        {portPanelOpen ? (
          <div className="agent-port-popover" role="dialog" aria-label="状态与设置">
            <header className="agent-account-menu-header">
              <span className="agent-user-avatar" aria-hidden="true">{initials}</span>
              <div>
                <strong>{userId}</strong>
              </div>
            </header>
            <section className="agent-port-settings-section">
              <div className="agent-port-mode-row">
                <span>输入方式</span>
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
              </div>
              <div className="agent-port-mode-row">
                <span>模型</span>
                <div className="agent-input-mode-switch" role="group" aria-label="模型">
                  <button
                    type="button"
                    className={modelBackend === 'openai' ? 'is-active' : ''}
                    aria-pressed={modelBackend === 'openai'}
                    onClick={() => onModelBackendChange('openai')}
                  >
                    OpenAI
                  </button>
                  <button
                    type="button"
                    className={modelBackend === 'chatModel' ? 'is-active' : ''}
                    aria-pressed={modelBackend === 'chatModel'}
                    onClick={() => onModelBackendChange('chatModel')}
                  >
                    内网模型
                  </button>
                </div>
              </div>
              <div className="agent-port-mode-row">
                <span>主题</span>
                <div className="agent-input-mode-switch" role="group" aria-label="主题">
                  <button
                    type="button"
                    className={agentTheme === 'dark' ? 'is-active' : ''}
                    aria-pressed={agentTheme === 'dark'}
                    onClick={() => onAgentThemeChange('dark')}
                  >
                    深色
                  </button>
                  <button
                    type="button"
                    className={agentTheme === 'light' ? 'is-active' : ''}
                    aria-pressed={agentTheme === 'light'}
                    onClick={() => onAgentThemeChange('light')}
                  >
                    浅色
                  </button>
                </div>
              </div>
            </section>
            <button type="button" className="agent-account-logout-row" disabled={loggingOut} onClick={handleLogout}>
              <span aria-hidden="true">↪</span>
              {loggingOut ? '退出中' : '退出登录'}
            </button>
            {showInterfaceStatus ? (
              <>
                <section className="agent-interface-section">
                  <div className="agent-interface-summary">
                    <div>
                      <strong>{portStatusError || !portStatus?.ok ? '接口异常' : '接口检测'}</strong>
                      <span>
                        {portStatus
                          ? `${totalChecks} 项 · 异常 ${failedChecks.length}${skippedChecks.length ? ` · 跳过 ${skippedChecks.length}` : ''}${checkedAtLabel ? ` · ${checkedAtLabel}` : ''}`
                          : portStatusLoading
                            ? '正在统一检测功能接口'
                            : '等待检测结果'}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="agent-interface-refresh"
                      disabled={portStatusLoading}
                      onClick={onPortStatusRefresh}
                    >
                      {portStatusLoading ? '检测中' : '重新检测'}
                    </button>
                  </div>
                </section>
                {portStatusError ? (
                  <p className="agent-port-error">{portStatusError}</p>
                ) : (
                  <>
                    <div className="agent-port-list">
                      {failedChecks.map(item => (
                        <div className={`agent-port-row ${item.ok ? 'ok' : 'bad'}`} key={`${item.group}:${item.name}:${item.target}`}>
                          <span className="agent-port-row-dot" />
                          <div>
                            <strong>{item.name}</strong>
                            <span>{formatInterfaceDetail(item)}</span>
                          </div>
                          <em>{item.required ? '异常' : '警告'}</em>
                        </div>
                      ))}
                    </div>
                    <p className="agent-port-check-note is-bad">
                      {`检测到 ${failedChecks.length} 个功能接口异常`}
                      {checkedAtLabel ? ` · ${checkedAtLabel}` : ''}
                    </p>
                  </>
                )}
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </header>
  )
}
