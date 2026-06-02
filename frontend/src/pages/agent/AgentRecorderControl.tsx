import type { KeyboardEvent } from 'react'
import type { AgentWorkspaceView, RecorderState } from './types'

type AgentInputMode = 'voice' | 'text'

type AgentRecorderControlProps = {
  activeView: AgentWorkspaceView | null
  busy: boolean
  disabled: boolean
  inputMode: AgentInputMode
  onButtonClick: () => void
  onTextChange: (value: string) => void
  onTextSubmit: () => void
  recorderStatusText: string
  state: RecorderState
  textInputDisabled: boolean
  textInputValue: string
}

export function AgentRecorderControl({
  activeView,
  busy,
  disabled,
  inputMode,
  onButtonClick,
  onTextChange,
  onTextSubmit,
  recorderStatusText,
  state,
  textInputDisabled,
  textInputValue,
}: AgentRecorderControlProps) {
  const handleTextKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    onTextSubmit()
  }

  if (inputMode === 'text') {
    return (
      <section className={`agent-panel agent-panel--text ${activeView ? 'is-docked' : 'is-centered'}`}>
        <div className="agent-text-composer">
          <textarea
            aria-label="文字输入"
            disabled={textInputDisabled}
            onChange={event => onTextChange(event.target.value)}
            onKeyDown={handleTextKeyDown}
            placeholder="输入任务目标..."
            rows={2}
            value={textInputValue}
          />
          <button
            type="button"
            disabled={textInputDisabled || textInputValue.trim().length === 0}
            onClick={onTextSubmit}
          >
            发送
          </button>
        </div>
        <small className="agent-recorder-status">{recorderStatusText}</small>
      </section>
    )
  }

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
