import { useCallback, useEffect, useRef, useState } from 'react'
import { joinApiPath } from '../../app/apiBase'
import type { AgentSpeechState } from './types'

function normalizeSpeechText(text: string) {
  return text.replace(/_/gu, ' ').trim()
}

const TASK_ACCEPTED_SPEECH_TEXT = '当前任务已接收，正在分析。'
const TASK_ACCEPTED_AUDIO_PATH = '/agent/audio/task-accepted'

export function useAgentSpeech({ onError }: { onError?: (message: string) => void } = {}) {
  const [visibleAgentResponse, setVisibleAgentResponse] = useState('')
  const [agentSpeechState, setAgentSpeechState] = useState<AgentSpeechState>('idle')
  const [agentSpeechPlaying, setAgentSpeechPlaying] = useState(false)
  const [agentSpeechError, setAgentSpeechError] = useState('')
  const agentAudioRef = useRef<HTMLAudioElement | null>(null)
  const agentAudioUrlRef = useRef('')
  const activeSpeechIdRef = useRef('')
  const speechAbortRef = useRef<AbortController | null>(null)

  const releaseAudio = useCallback(() => {
    speechAbortRef.current?.abort()
    speechAbortRef.current = null
    const audio = agentAudioRef.current
    if (audio) {
      audio.onended = null
      audio.onpause = null
      audio.src = ''
      audio.pause()
      audio.load()
      agentAudioRef.current = null
    }
    if (agentAudioUrlRef.current) {
      URL.revokeObjectURL(agentAudioUrlRef.current)
      agentAudioUrlRef.current = ''
    }
    setAgentSpeechPlaying(false)
  }, [])

  useEffect(() => releaseAudio, [releaseAudio])

  const clearAgentSpeechDisplay = useCallback(() => {
    activeSpeechIdRef.current = ''
    releaseAudio()
    setVisibleAgentResponse('')
    setAgentSpeechError('')
    setAgentSpeechState('idle')
  }, [releaseAudio])

  const stopAgentSpeechPlayback = useCallback(() => {
    releaseAudio()
    if (agentSpeechState === 'synthesizing') setAgentSpeechState('idle')
  }, [agentSpeechState, releaseAudio])

  const showSpeechText = useCallback((text: string) => {
    const agentText = normalizeSpeechText(text)
    if (!agentText) return
    activeSpeechIdRef.current = ''
    releaseAudio()
    setVisibleAgentResponse(agentText)
    setAgentSpeechError('')
    setAgentSpeechState('ready')
  }, [releaseAudio])

  const speakText = useCallback(async (text: string, speechId = `${Date.now()}`) => {
    const agentText = normalizeSpeechText(text)
    if (!agentText) return

    activeSpeechIdRef.current = speechId
    releaseAudio()
    setVisibleAgentResponse('')
    setAgentSpeechError('')
    setAgentSpeechState('synthesizing')

    try {
      const controller = new AbortController()
      speechAbortRef.current = controller
      const usePregeneratedAudio = agentText === TASK_ACCEPTED_SPEECH_TEXT
      let response = usePregeneratedAudio
        ? await fetch(joinApiPath(undefined, TASK_ACCEPTED_AUDIO_PATH), {
          cache: 'force-cache',
          signal: controller.signal,
        })
        : null
      if (!response?.ok) {
        response = await fetch(joinApiPath(undefined, '/cosyvoice/tts-stream'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: agentText }),
          signal: controller.signal,
        })
      }

      if (activeSpeechIdRef.current !== speechId) return
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(payload.error || 'AI AGENT 语音生成失败')
      }

      const audioBlob = await response.blob()
      if (activeSpeechIdRef.current !== speechId) return
      if (speechAbortRef.current === controller) speechAbortRef.current = null

      if (audioBlob.size > 0) {
        const audioUrl = URL.createObjectURL(audioBlob)
        agentAudioUrlRef.current = audioUrl
        const audio = new Audio(audioUrl)
        agentAudioRef.current = audio
        audio.onended = () => setAgentSpeechPlaying(false)
        audio.onpause = () => setAgentSpeechPlaying(false)
        void audio.play()
          .then(() => setAgentSpeechPlaying(true))
          .catch(() => setAgentSpeechPlaying(false))
      }

      setVisibleAgentResponse(agentText)
      setAgentSpeechError('')
      setAgentSpeechState('ready')
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      if (activeSpeechIdRef.current !== speechId) return
      const message = err instanceof Error ? err.message : 'AI AGENT 语音生成失败'
      setVisibleAgentResponse(agentText)
      setAgentSpeechError(message)
      setAgentSpeechState('error')
      setAgentSpeechPlaying(false)
      onError?.(message)
    }
  }, [onError, releaseAudio])

  return {
    agentSpeechError,
    agentSpeechPlaying,
    agentSpeechState,
    clearAgentSpeechDisplay,
    showSpeechText,
    speakText,
    stopAgentSpeechPlayback,
    visibleAgentResponse,
  }
}
