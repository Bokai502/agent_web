import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
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
  const [textDialogOpen, setTextDialogOpen] = useState(false)
  const robotTrackRef = useRef<HTMLElement | null>(null)
  const handleTextKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    onTextSubmit()
    setTextDialogOpen(false)
  }
  const handleRobotClick = () => {
    if (busy) {
      onButtonClick()
      return
    }
    if (inputMode === 'text') {
      setTextDialogOpen(open => {
        if (!open) resetRobotTransform()
        return !open
      })
      return
    }
    if (inputMode !== 'voice') return
    onButtonClick()
  }
  const handleTextSubmitClick = () => {
    onTextSubmit()
    setTextDialogOpen(false)
  }
  const handleRobotPointerMove = (event: PointerEvent<HTMLElement>) => {
    const track = robotTrackRef.current
    if (!track) return
    if (textDialogOpen) {
      resetRobotTransform()
      return
    }
    const bounds = track.getBoundingClientRect()
    const x = ((event.clientX - bounds.left) / bounds.width - 0.5) * 2
    const y = ((event.clientY - bounds.top) / bounds.height - 0.5) * 2
    track.style.setProperty('--robot-shift-x', `${(x * 44).toFixed(2)}px`)
    track.style.setProperty('--robot-shift-y', `${(y * 34).toFixed(2)}px`)
    track.style.setProperty('--robot-rotate-x', `${(-y * 20).toFixed(2)}deg`)
    track.style.setProperty('--robot-rotate-y', `${(x * 20).toFixed(2)}deg`)
    track.style.setProperty('--robot-chat-rotate-x', `${(-y * 12).toFixed(2)}deg`)
    track.style.setProperty('--robot-chat-rotate-y', `${(x * 10).toFixed(2)}deg`)
  }
  const resetRobotTransform = () => {
    const track = robotTrackRef.current
    if (!track) return
    track.style.setProperty('--robot-shift-x', '0px')
    track.style.setProperty('--robot-shift-y', '0px')
    track.style.setProperty('--robot-rotate-x', '0deg')
    track.style.setProperty('--robot-rotate-y', '0deg')
    track.style.setProperty('--robot-chat-rotate-x', '0deg')
    track.style.setProperty('--robot-chat-rotate-y', '0deg')
  }
  const handleRobotPointerLeave = () => resetRobotTransform()

  return (
    <section
      className={`agent-panel agent-panel--robot ${activeView ? 'is-docked' : 'is-centered'} ${inputMode === 'text' ? 'is-text-mode' : 'is-voice-mode'} ${textDialogOpen ? 'is-chat-open' : ''}`}
      onPointerLeave={handleRobotPointerLeave}
      onPointerMove={handleRobotPointerMove}
      ref={robotTrackRef}
    >
      <button
        aria-label={inputMode === 'text' ? '打开文字对话' : recorderStatusText}
        className={`agent-robot-button ${state === 'recording' ? 'is-recording' : ''} ${busy ? 'is-busy' : ''}`}
        type="button"
        onClick={handleRobotClick}
        disabled={inputMode === 'voice' ? disabled : false}
      >
        <span className="agent-robot-card" aria-hidden="true">
          <span className="agent-robot-blur">
            <span className="agent-robot-balls">
              <span className="agent-robot-ball is-rose" />
              <span className="agent-robot-ball is-violet" />
              <span className="agent-robot-ball is-green" />
              <span className="agent-robot-ball is-cyan" />
            </span>
          </span>
          <span className="agent-robot-face">
            <span className="agent-robot-eyes">
              <span className="agent-robot-eye" />
              <span className="agent-robot-eye" />
            </span>
            <span className="agent-robot-smile">
              <svg fill="none" viewBox="0 0 24 24">
                <path
                  d="M8.28386 16.2843C8.9917 15.7665 9.8765 14.731 12 14.731C14.1235 14.731 15.0083 15.7665 15.7161 16.2843C17.8397 17.8376 18.7542 16.4845 18.9014 15.7665C19.4323 13.1777 17.6627 11.1066 17.3088 10.5888C16.3844 9.23666 14.1235 8 12 8C9.87648 8 7.61556 9.23666 6.69122 10.5888C6.33728 11.1066 4.56771 13.1777 5.09858 15.7665C5.24582 16.4845 6.16034 17.8376 8.28386 16.2843Z"
                  fill="currentColor"
                />
              </svg>
              <svg fill="none" viewBox="0 0 24 24">
                <path
                  d="M8.28386 16.2843C8.9917 15.7665 9.8765 14.731 12 14.731C14.1235 14.731 15.0083 15.7665 15.7161 16.2843C17.8397 17.8376 18.7542 16.4845 18.9014 15.7665C19.4323 13.1777 17.6627 11.1066 17.3088 10.5888C16.3844 9.23666 14.1235 8 12 8C9.87648 8 7.61556 9.23666 6.69122 10.5888C6.33728 11.1066 4.56771 13.1777 5.09858 15.7665C5.24582 16.4845 6.16034 17.8376 8.28386 16.2843Z"
                  fill="currentColor"
                />
              </svg>
            </span>
          </span>
        </span>
      </button>
      {inputMode === 'text' && textDialogOpen ? (
        <div className="agent-robot-chat">
          <textarea
            aria-label="文字输入"
            autoFocus
            disabled={textInputDisabled}
            onChange={event => onTextChange(event.target.value)}
            onKeyDown={handleTextKeyDown}
            placeholder="输入任务目标..."
            rows={3}
            value={textInputValue}
          />
          <button
            type="button"
            disabled={textInputDisabled || textInputValue.trim().length === 0}
            onClick={handleTextSubmitClick}
          >
            发送
          </button>
        </div>
      ) : null}
      <small className="agent-recorder-status">{recorderStatusText}</small>
    </section>
  )
}
