import { useCallback, useEffect, useRef, useState } from 'react'
import { joinApiPath } from '../../app/apiBase'
import { DEFAULT_LANGUAGE, TARGET_SAMPLE_RATE } from './constants'
import type { RecorderState } from './types'
import { encodeWav, getAudioContextConstructor } from './audioUtils'

type UseAgentRecorderOptions = {
  clearAgentSpeechDisplay: () => void
  runCodex: (transcript: string) => Promise<void>
  running: boolean
}

export function getRecorderStatusText(state: RecorderState, running: boolean) {
  if (running) return '大模型正在思考'
  if (state === 'recording') return '正在聆听，点击结束'
  if (state === 'transcribing') return '正在将语音转成文字'
  if (state === 'thinking') return '大模型正在思考'
  if (state === 'done') return '已完成，可继续说'
  if (state === 'error') return '语音输入遇到问题'
  return '点击开始语音输入'
}

export function useAgentRecorder({ clearAgentSpeechDisplay, runCodex, running }: UseAgentRecorderOptions) {
  const [state, setState] = useState<RecorderState>('idle')
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const audioContextRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const samplesRef = useRef<Float32Array[]>([])
  const sampleRateRef = useRef(TARGET_SAMPLE_RATE)

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const resetAudioGraph = useCallback(() => {
    if (processorRef.current) processorRef.current.onaudioprocess = null
    processorRef.current?.disconnect()
    processorRef.current = null
    sourceRef.current?.disconnect()
    sourceRef.current = null
    void audioContextRef.current?.close()
    audioContextRef.current = null
    stopStream()
  }, [stopStream])

  useEffect(() => resetAudioGraph, [resetAudioGraph])

  useEffect(() => {
    if (state === 'thinking' && !running) {
      setState('done')
    }
  }, [running, state])

  const uploadAudio = useCallback(async (blob: Blob) => {
    setState('transcribing')
    setError('')
    clearAgentSpeechDisplay()

    const response = await fetch(joinApiPath(undefined, '/whisper/transcribe'), {
      method: 'POST',
      headers: {
        'Content-Type': blob.type || 'application/octet-stream',
        'X-Whisper-Language': DEFAULT_LANGUAGE,
      },
      body: blob,
    })

    const payload = await response.json().catch(() => ({})) as {
      error?: string
      text?: string
    }
    if (!response.ok) {
      throw new Error(payload.error || '语音识别失败')
    }

    const transcript = payload.text?.trim() || '没有识别到文字'
    setText(transcript)

    if (!payload.text?.trim()) {
      setState('done')
      return
    }

    setState('thinking')
    await runCodex(transcript)
  }, [clearAgentSpeechDisplay, runCodex])

  const startRecording = useCallback(async () => {
    const AudioContextConstructor = getAudioContextConstructor()

    if (!window.isSecureContext) {
      setError('Chrome 需要使用 localhost 或 HTTPS 才能打开麦克风')
      setState('error')
      return
    }

    if (!navigator.mediaDevices?.getUserMedia || !AudioContextConstructor) {
      setError('当前浏览器不支持录音，请使用新版 Chrome 并允许麦克风权限')
      setState('error')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const audioContext = new AudioContextConstructor()
      const source = audioContext.createMediaStreamSource(stream)
      const processor = audioContext.createScriptProcessor(4096, 1, 1)

      streamRef.current = stream
      audioContextRef.current = audioContext
      processorRef.current = processor
      sourceRef.current = source
      samplesRef.current = []
      sampleRateRef.current = audioContext.sampleRate

      processor.onaudioprocess = (event) => {
        samplesRef.current.push(new Float32Array(event.inputBuffer.getChannelData(0)))
      }

      source.connect(processor)
      processor.connect(audioContext.destination)

      setText('')
      setError('')
      clearAgentSpeechDisplay()
      setState('recording')
    } catch (err) {
      resetAudioGraph()
      setError(err instanceof Error ? err.message : '无法打开麦克风')
      setState('error')
    }
  }, [clearAgentSpeechDisplay, resetAudioGraph])

  const stopRecording = useCallback(() => {
    const chunks = samplesRef.current
    const sampleCount = chunks.reduce((total, chunk) => total + chunk.length, 0)
    const mergedSamples = new Float32Array(sampleCount)
    let offset = 0

    for (const chunk of chunks) {
      mergedSamples.set(chunk, offset)
      offset += chunk.length
    }

    resetAudioGraph()
    samplesRef.current = []

    if (mergedSamples.length === 0) {
      setError('没有录到声音')
      setState('error')
      return
    }

    const blob = encodeWav(mergedSamples, sampleRateRef.current)
    void uploadAudio(blob).catch((err) => {
      setError(err instanceof Error ? err.message : '语音识别失败')
      setState('error')
    })
  }, [resetAudioGraph, uploadAudio])

  const setRecorderError = useCallback((message: string) => {
    setError(message)
    setState('error')
  }, [])

  return {
    error,
    setRecorderError,
    startRecording,
    state,
    stopRecording,
    text,
  }
}
