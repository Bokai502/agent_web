import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import type { AgentSpeechState, AgentWorkspaceView, RecorderState } from './types'

type AgentInputMode = 'voice' | 'text'

type AgentRecorderControlProps = {
  activeView: AgentWorkspaceView | null
  agentSpeechError: string
  agentSpeechState: AgentSpeechState
  busy: boolean
  disabled: boolean
  error: string
  inputMode: AgentInputMode
  onButtonClick: () => void
  onTextChange: (value: string) => void
  onTextSubmit: () => void
  recorderStatusText: string
  state: RecorderState
  text: string
  textInputDisabled: boolean
  textInputValue: string
  visibleAgentResponse: string
}

const DOCKED_ROBOT_DRAG_THRESHOLD = 6
const DOCKED_ROBOT_MARGIN = 12
const STATUS_HINT_DURATION_MS = 3200

function getBubbleTextSegments(value: string) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) return []
  return normalized.includes(' ') ? normalized.split(' ') : [normalized]
}

type DockedRobotPosition = {
  left: number
  top: number
}

export function AgentRecorderControl({
  activeView,
  agentSpeechError,
  agentSpeechState,
  busy,
  disabled,
  error,
  inputMode,
  onButtonClick,
  onTextChange,
  onTextSubmit,
  recorderStatusText,
  state,
  text,
  textInputDisabled,
  textInputValue,
  visibleAgentResponse,
}: AgentRecorderControlProps) {
  const [textDialogOpen, setTextDialogOpen] = useState(false)
  const [dockedPosition, setDockedPosition] = useState<DockedRobotPosition | null>(null)
  const [statusHintText, setStatusHintText] = useState('')
  const robotTrackRef = useRef<HTMLElement | null>(null)
  const dockedPositionRef = useRef<DockedRobotPosition | null>(null)
  const dragRef = useRef<{
    buttonStarted: boolean
    dragging: boolean
    offsetX: number
    offsetY: number
    pointerId: number
    startX: number
    startY: number
  } | null>(null)
  const canDragDockedRobot = Boolean(activeView)
  const showPersistentStatus = (
    state === 'recording' ||
    state === 'transcribing' ||
    state === 'thinking' ||
    agentSpeechState === 'synthesizing' ||
    busy
  )

  const handleTextKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    onTextSubmit()
    setTextDialogOpen(false)
  }
  const triggerRobotAction = () => {
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
  const handleRobotButtonClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.detail !== 0) return
    triggerRobotAction()
  }
  const handleTextSubmitClick = () => {
    onTextSubmit()
    setTextDialogOpen(false)
  }
  const handleRobotPointerMove = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (drag?.pointerId === event.pointerId) {
      if (!canDragDockedRobot) return
      const distanceX = event.clientX - drag.startX
      const distanceY = event.clientY - drag.startY
      if (!drag.dragging && Math.hypot(distanceX, distanceY) >= DOCKED_ROBOT_DRAG_THRESHOLD) {
        drag.dragging = true
        resetRobotTransform()
      }
      if (drag.dragging) {
        const nextPosition = clampDockedRobotPosition(
          {
            left: event.clientX - drag.offsetX,
            top: event.clientY - drag.offsetY,
          },
          activeView,
        )
        dockedPositionRef.current = nextPosition
        setDockedPosition(nextPosition)
      }
      return
    }
    const track = robotTrackRef.current
    if (!track) return
    if (textDialogOpen) {
      resetRobotTransform()
      return
    }
    const bounds = track.getBoundingClientRect()
    const x = ((event.clientX - bounds.left) / bounds.width - 0.5) * 2
    const y = ((event.clientY - bounds.top) / bounds.height - 0.5) * 2
    const shiftScale = activeView ? 0.46 : 1
    const rotateScale = activeView ? 0.58 : 1
    track.style.setProperty('--robot-shift-x', `${(x * 18 * shiftScale).toFixed(2)}px`)
    track.style.setProperty('--robot-shift-y', `${(y * 14 * shiftScale).toFixed(2)}px`)
    track.style.setProperty('--robot-rotate-x', `${(-y * 8 * rotateScale).toFixed(2)}deg`)
    track.style.setProperty('--robot-rotate-y', `${(x * 8 * rotateScale).toFixed(2)}deg`)
    track.style.setProperty('--robot-chat-rotate-x', `${(-y * 5 * rotateScale).toFixed(2)}deg`)
    track.style.setProperty('--robot-chat-rotate-y', `${(x * 5 * rotateScale).toFixed(2)}deg`)
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
  const handleDockedPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement
    if (target.closest('.agent-robot-chat, .agent-robot-bubble-stack')) return
    const track = robotTrackRef.current
    if (!track) return
    const bounds = track.getBoundingClientRect()
    dragRef.current = {
      buttonStarted: Boolean(target.closest('.agent-robot-button')),
      dragging: false,
      offsetX: event.clientX - bounds.left,
      offsetY: event.clientY - bounds.top,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    }
    if (canDragDockedRobot || target.closest('.agent-robot-button')) {
      event.currentTarget.setPointerCapture(event.pointerId)
    }
  }
  const handleDockedPointerUp = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    dragRef.current = null
    if (!drag.dragging && drag.buttonStarted) triggerRobotAction()
  }
  const handleDockedPointerCancel = (event: PointerEvent<HTMLElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    dragRef.current = null
  }
  const robotStyle: CSSProperties | undefined = canDragDockedRobot && dockedPosition
    ? { left: dockedPosition.left, top: dockedPosition.top }
    : undefined
  const displayError = error || agentSpeechError
  const agentBubbleText = displayError ||
    (agentSpeechState === 'synthesizing' ? '正在生成语音...' : visibleAgentResponse)
  const userBubbleText = text.trim()
  const bubbleText = agentBubbleText || userBubbleText || statusHintText
  const bubbleLabel = agentBubbleText
    ? (displayError ? '状态' : 'AI AGENT')
    : userBubbleText
      ? '用户'
      : '状态'
  const bubbleTextSegments = getBubbleTextSegments(bubbleText)

  useEffect(() => {
    if (agentBubbleText || userBubbleText || showPersistentStatus || textDialogOpen) {
      setStatusHintText('')
      return
    }
    setStatusHintText(recorderStatusText)
    const timeoutId = window.setTimeout(() => setStatusHintText(''), STATUS_HINT_DURATION_MS)
    return () => window.clearTimeout(timeoutId)
  }, [agentBubbleText, recorderStatusText, showPersistentStatus, textDialogOpen, userBubbleText])

  return (
    <section
      className={`agent-panel agent-panel--robot ${activeView ? 'is-docked' : 'is-centered'} ${inputMode === 'text' ? 'is-text-mode' : 'is-voice-mode'} ${textDialogOpen ? 'is-chat-open' : ''} ${canDragDockedRobot && dockedPosition ? 'is-user-positioned' : ''}`}
      onPointerCancel={handleDockedPointerCancel}
      onPointerDown={handleDockedPointerDown}
      onPointerLeave={handleRobotPointerLeave}
      onPointerMove={handleRobotPointerMove}
      onPointerUp={handleDockedPointerUp}
      ref={robotTrackRef}
      style={robotStyle}
    >
      <div className="agent-robot-anchor">
        {bubbleText ? (
          <div className="agent-robot-bubble-stack" aria-live="polite">
            <article className={`agent-robot-bubble is-agent${displayError ? ' is-error' : ''}`}>
              <p className="agent-robot-bubble-text">
                <span className="agent-robot-bubble-label" style={{ '--i': 0 } as CSSProperties}>{bubbleLabel}</span>
                {bubbleTextSegments.map((segment, index) => (
                  <span key={`${segment}-${index}`} style={{ '--i': index + 1 } as CSSProperties}>{segment}</span>
                ))}
              </p>
            </article>
          </div>
        ) : null}
        <button
          aria-label={inputMode === 'text' ? '打开文字对话' : recorderStatusText}
          className={`agent-robot-button ${state === 'recording' ? 'is-recording' : ''} ${busy ? 'is-busy' : ''}`}
          type="button"
          onClick={handleRobotButtonClick}
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
      </div>
      {showPersistentStatus ? (
        <small className="agent-recorder-status">{recorderStatusText}</small>
      ) : null}
    </section>
  )
}

function clampDockedRobotPosition(
  position: DockedRobotPosition,
  activeView: AgentWorkspaceView | null,
): DockedRobotPosition {
  const width = Math.min(window.innerWidth, document.documentElement.clientWidth || window.innerWidth)
  const height = Math.min(window.innerHeight, document.documentElement.clientHeight || window.innerHeight)
  const panelWidth = activeView ? 74 : 132
  const panelHeight = activeView ? 148 : 320
  return {
    left: Math.max(DOCKED_ROBOT_MARGIN, Math.min(position.left, width - DOCKED_ROBOT_MARGIN - panelWidth)),
    top: Math.max(DOCKED_ROBOT_MARGIN, Math.min(position.top, height - DOCKED_ROBOT_MARGIN - panelHeight)),
  }
}
