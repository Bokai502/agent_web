import type { AgentWorkspaceView, RecorderState } from './types'

type AgentRecorderControlProps = {
  activeView: AgentWorkspaceView | null
  busy: boolean
  disabled: boolean
  onButtonClick: () => void
  recorderStatusText: string
  state: RecorderState
}

export function AgentRecorderControl({
  activeView,
  busy,
  disabled,
  onButtonClick,
  recorderStatusText,
  state,
}: AgentRecorderControlProps) {
  return (
    <section className={`agent-panel ${activeView ? 'is-docked' : 'is-centered'}`}>
      <span className="agent-wave left" aria-hidden="true" />
      <button
        className={`agent-record-button ${state === 'recording' ? 'is-recording' : ''} ${busy ? 'is-busy' : ''}`}
        type="button"
        onClick={onButtonClick}
        disabled={disabled}
      >
        <span className={`agent-record-icon ${busy ? 'is-pause' : ''}`} aria-hidden="true" />
      </button>
      <span className="agent-wave right" aria-hidden="true" />
      <small className="agent-recorder-status">{recorderStatusText}</small>
    </section>
  )
}
