import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { joinApiPath } from '../app/apiBase'
import MagicRings from '../components/MagicRings'
import { useBomInfo } from '../hooks/useBomInfo'
import { useWorkspaceAppState } from '../hooks/useWorkspaceAppState'
import { BomStagePanel } from './workspace/BomStagePanel'
import { CurrentWorkspaceCard } from './workspace/CurrentWorkspaceCard'
import { LogStagePanel } from './workspace/LogStagePanel'
import { formatProgressUpdatedAt } from './workspace/progressUtils'
import { RunLogPanel } from './workspace/RunLogPanel'
import { useWorkspaceRuntimeData } from './workspace/useWorkspaceRuntimeData'
import { useWorkspaceVersionState } from './workspace/useWorkspaceVersionState'
import {
  fetchWorkspaceManifest,
  getActiveVersion,
  resolveWorkspaceVersionContext,
} from './workspace/workspaceVersion'
import { getVisibleWorkspaceSessionState } from './workspace/workspaceSessionVisibility'
import './WhisperPage.css'

type RecorderState = 'idle' | 'recording' | 'transcribing' | 'thinking' | 'done' | 'error'
type AgentSpeechState = 'idle' | 'synthesizing' | 'ready' | 'error'
type WhisperWorkspaceView = 'workspace' | 'bom' | 'model' | 'tools' | 'log'
type WhisperToolView = 'cad' | 'paraview' | 'comsol'

const TARGET_SAMPLE_RATE = 16000
const DEFAULT_LANGUAGE = 'zh-en'
const NAV_ITEMS = [
  { label: '工作区', href: '#workspace', meta: 'Source' },
  { label: 'BOM', href: '#bom', meta: 'Parts' },
  { label: '模型', href: '#model', meta: 'Viewer' },
  { label: '工具', href: '#tools', meta: 'Remote' },
  { label: '日志', href: '#log', meta: 'Activity' },
]
const NAV_VIEWS: WhisperWorkspaceView[] = ['workspace', 'bom', 'model', 'tools', 'log']
const WORKSPACE_GEOMETRY_AFTER_GLB_PATH = '02_geometry_edit/geometry_after.glb'
const NOVNC_URL_PARAMS = 'vnc.html?autoconnect=true&resize=scale&path=websockify'
const WHISPER_HOME_PATH = '/whisper'
type BrowserAudioContext = typeof AudioContext

function getRecorderStatusText(state: RecorderState, running: boolean) {
  if (running) return '大模型正在思考'
  if (state === 'recording') return '正在聆听，点击结束'
  if (state === 'transcribing') return '正在将语音转成文字'
  if (state === 'thinking') return '大模型正在思考'
  if (state === 'done') return '已完成，可继续说'
  if (state === 'error') return '语音输入遇到问题'
  return '点击开始语音输入'
}

function getAudioContextConstructor(): BrowserAudioContext | null {
  return window.AudioContext ?? null
}

function floatTo16BitPcm(samples: Float32Array) {
  const output = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.max(-1, Math.min(1, samples[i]))
    output[i] = value < 0 ? value * 0x8000 : value * 0x7fff
  }
  return output
}

function resampleTo16Khz(samples: Float32Array, sourceSampleRate: number) {
  if (sourceSampleRate === TARGET_SAMPLE_RATE) return samples

  const ratio = sourceSampleRate / TARGET_SAMPLE_RATE
  const outputLength = Math.max(1, Math.round(samples.length / ratio))
  const output = new Float32Array(outputLength)

  for (let i = 0; i < outputLength; i += 1) {
    const sourceIndex = i * ratio
    const left = Math.floor(sourceIndex)
    const right = Math.min(left + 1, samples.length - 1)
    const weight = sourceIndex - left
    output[i] = samples[left] * (1 - weight) + samples[right] * weight
  }

  return output
}

function encodeWav(samples: Float32Array, sourceSampleRate: number) {
  const resampled = resampleTo16Khz(samples, sourceSampleRate)
  const pcm = floatTo16BitPcm(resampled)
  const buffer = new ArrayBuffer(44 + pcm.byteLength)
  const view = new DataView(buffer)

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i))
    }
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + pcm.byteLength, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, TARGET_SAMPLE_RATE, true)
  view.setUint32(28, TARGET_SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(36, 'data')
  view.setUint32(40, pcm.byteLength, true)

  for (let i = 0; i < pcm.length; i += 1) {
    view.setInt16(44 + i * 2, pcm[i], true)
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

function buildWorkspaceQuery(
  activeContext: {
    versionDir?: string | null
    versionId?: string | null
    workspaceId?: string | null
  },
) {
  if (!activeContext.versionDir) return ''
  return `?${new URLSearchParams({
    workspaceDir: activeContext.versionDir,
    ...(activeContext.workspaceId ? { workspaceId: activeContext.workspaceId } : {}),
    ...(activeContext.versionId ? { versionId: activeContext.versionId } : {}),
  }).toString()}`
}

export default function WhisperPage() {
  const { t } = useTranslation()
  const [state, setState] = useState<RecorderState>('idle')
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [activeView, setActiveView] = useState<WhisperWorkspaceView | null>(null)
  const [activeTool, setActiveTool] = useState<WhisperToolView>('cad')
  const [workspaceRefreshNonce, setWorkspaceRefreshNonce] = useState(0)
  const [progressRefreshNonce, setProgressRefreshNonce] = useState(0)
  const [selectedBomId, setSelectedBomId] = useState('')
  const [selectedLogId, setSelectedLogId] = useState('')
  const [visibleAgentResponse, setVisibleAgentResponse] = useState('')
  const [agentSpeechState, setAgentSpeechState] = useState<AgentSpeechState>('idle')
  const [latestConversationText, setLatestConversationText] = useState('')
  const [latestConversationTextId, setLatestConversationTextId] = useState('')
  const conversationBaselineRef = useRef('')
  const audioContextRef = useRef<AudioContext | null>(null)
  const agentAudioRef = useRef<HTMLAudioElement | null>(null)
  const agentAudioUrlRef = useRef('')
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const samplesRef = useRef<Float32Array[]>([])
  const sampleRateRef = useRef(TARGET_SAMPLE_RATE)
  const synthesizedAgentTextRef = useRef('')
  const remoteToolHost = typeof window !== 'undefined' ? window.location.hostname : 'localhost'
  const workspaceAppState = useWorkspaceAppState({ homePath: WHISPER_HOME_PATH })

  const refreshWorkspaceViews = useCallback(() => {
    setSelectedBomId('')
    setSelectedLogId('')
    setWorkspaceRefreshNonce(value => value + 1)
    setProgressRefreshNonce(value => value + 1)
  }, [])
  const versionState = useWorkspaceVersionState({
    fallbackWorkspaceName: '当前工作区',
    onRefreshWorkspaceViews: refreshWorkspaceViews,
    onReloadSessions: () => {},
    workspaceRefreshNonce,
  })
  const {
    activeContext,
    activeManifestVersion,
    branchManifest,
    checkoutVersion,
    createChildBranch,
    createSiblingBranch,
    manifestLoading,
    setVersionListOpen,
    setWorkspaceListOpen,
    switchActiveWorkspace,
    versionAction,
    versionError,
    versionListOpen,
    versionTreeRoots,
    workspaceChanging,
    workspaceItems,
    workspaceListOpen,
    workspaces,
  } = versionState
  const { bomInfo, loading: bomLoading } = useBomInfo(workspaceRefreshNonce, {
    enabled: !!activeContext.versionDir,
    versionDir: activeContext.versionDir,
    versionId: activeContext.versionId,
    workspaceId: activeContext.workspaceId,
  })
  const selectedBom = bomInfo.components.find(component => component.componentId === selectedBomId) ?? bomInfo.components[0]
  const activeSession = workspaceAppState.sortedSessions.find(session => session.id === workspaceAppState.activeSessionId)
  const {
    activeSessionMatchesWorkspace,
    visibleCurrentEvents,
    visibleRunning,
    visibleTurns,
  } = getVisibleWorkspaceSessionState({
    activeContext,
    activeSession,
    currentEvents: workspaceAppState.currentEvents,
    currentPrompt: workspaceAppState.currentPrompt,
    pendingAskUser: workspaceAppState.pendingAskUser,
    running: workspaceAppState.running,
    runningWorkspace: workspaceAppState.runningWorkspace,
    turns: workspaceAppState.turns,
  })
  const {
    logEntries,
    progressData,
    resetProgressData,
    workflowLoopProgressEntries,
  } = useWorkspaceRuntimeData({
    activeContext,
    progressRefreshNonce,
    progressVariant: 'thermal',
    running: visibleRunning || state === 'thinking' || state === 'transcribing',
    t,
    visibleCurrentEvents,
    visibleTurns,
    workspaceRefreshNonce,
    sessionId: workspaceAppState.activeSessionId,
  })
  const selectedLog = logEntries.find(entry => entry.id === selectedLogId) ?? logEntries[0] ?? null
  const recorderStatusText = getRecorderStatusText(state, visibleRunning)
  const viewerHref = useMemo(() => {
    const params = new URLSearchParams()
    params.set('glbPath', WORKSPACE_GEOMETRY_AFTER_GLB_PATH)
    if (activeContext.workspaceKey) params.set('workspaceKey', activeContext.workspaceKey)
    if (activeContext.workspaceId) params.set('workspaceId', activeContext.workspaceId)
    if (activeContext.versionId) params.set('versionId', activeContext.versionId)
    if (activeContext.versionDir) params.set('workspaceDir', activeContext.versionDir)
    if (workspaceRefreshNonce > 0) params.set('workspaceVersion', String(workspaceRefreshNonce))
    return `/viewer?${params.toString()}`
  }, [activeContext.versionDir, activeContext.versionId, activeContext.workspaceId, activeContext.workspaceKey, workspaceRefreshNonce])
  const toolUrls = useMemo(() => ({
    cad: `http://${remoteToolHost}:6080/${NOVNC_URL_PARAMS}`,
    paraview: `http://${remoteToolHost}:6081/${NOVNC_URL_PARAMS}`,
    comsol: `http://${remoteToolHost}:6082/${NOVNC_URL_PARAMS}`,
  }), [remoteToolHost])

  useEffect(() => {
    resetProgressData()
  }, [activeContext.versionDir, activeContext.versionId, resetProgressData])

  useEffect(() => {
    return () => {
      agentAudioRef.current?.pause()
      agentAudioRef.current = null
      if (agentAudioUrlRef.current) {
        URL.revokeObjectURL(agentAudioUrlRef.current)
        agentAudioUrlRef.current = ''
      }
    }
  }, [])

  useEffect(() => {
    if (state === 'thinking' && !workspaceAppState.running && !visibleRunning) {
      setState('done')
      setProgressRefreshNonce(value => value + 1)
    }
  }, [state, visibleRunning, workspaceAppState.running])

  useEffect(() => {
    conversationBaselineRef.current = ''
    setLatestConversationText('')
    setLatestConversationTextId('')
    synthesizedAgentTextRef.current = ''
    setVisibleAgentResponse('')
    setAgentSpeechState('idle')
  }, [activeContext.versionDir, activeContext.versionId, activeContext.workspaceId])

  useEffect(() => {
    let cancelled = false

    const loadLatestConversationText = () => {
      if (!activeContext.versionDir) {
        conversationBaselineRef.current = ''
        setLatestConversationText('')
        setLatestConversationTextId('')
        return
      }

      fetch(`${joinApiPath(undefined, '/logs/conversation/latest')}${buildWorkspaceQuery(activeContext)}`, { cache: 'no-store' })
        .then(response => response.ok ? response.json() : null)
        .then((payload: { id?: string; text?: string | null } | null) => {
          if (cancelled) return
          const nextText = typeof payload?.text === 'string' ? payload.text.trim() : ''
          const nextId = typeof payload?.id === 'string' ? payload.id : nextText
          if (!nextText) return

          if (!conversationBaselineRef.current) {
            conversationBaselineRef.current = nextId
            return
          }

          if (conversationBaselineRef.current === nextId) return
          conversationBaselineRef.current = nextId
          setLatestConversationTextId(nextId)
          setLatestConversationText(nextText)
        })
        .catch(() => undefined)
    }

    loadLatestConversationText()
    const intervalId = window.setInterval(loadLatestConversationText, visibleRunning || workspaceAppState.running ? 1000 : 3000)
    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [activeContext.versionDir, activeContext.versionId, activeContext.workspaceId, visibleRunning, workspaceAppState.running])

  useEffect(() => {
    const agentText = latestConversationText.trim()

    if (!agentText) {
      synthesizedAgentTextRef.current = ''
      setVisibleAgentResponse('')
      setAgentSpeechState('idle')
      return
    }

    if (visibleAgentResponse === agentText || synthesizedAgentTextRef.current === latestConversationTextId) return

    const controller = new AbortController()
    setVisibleAgentResponse('')
    setAgentSpeechState('synthesizing')

    const synthesizeAgentSpeech = async () => {
      const response = await fetch(joinApiPath(undefined, '/cosyvoice/tts-stream'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: agentText }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(payload.error || 'AI AGENT 语音生成失败')
      }

      const audioBlob = await response.blob()
      if (audioBlob.size > 0) {
        agentAudioRef.current?.pause()
        if (agentAudioUrlRef.current) {
          URL.revokeObjectURL(agentAudioUrlRef.current)
        }
        const audioUrl = URL.createObjectURL(audioBlob)
        agentAudioUrlRef.current = audioUrl
        const audio = new Audio(audioUrl)
        agentAudioRef.current = audio
        void audio.play().catch(() => undefined)
      }

      synthesizedAgentTextRef.current = latestConversationTextId
      setVisibleAgentResponse(agentText)
      setAgentSpeechState('ready')
    }

    void synthesizeAgentSpeech().catch((err) => {
      if (controller.signal.aborted) return
      setVisibleAgentResponse('')
      setAgentSpeechState('error')
      setError(err instanceof Error ? err.message : 'AI AGENT 语音生成失败')
      setState('error')
    })

    return () => controller.abort()
  }, [latestConversationText, latestConversationTextId, visibleAgentResponse])

  useEffect(() => {
    if (selectedLogId && logEntries.some(entry => entry.id === selectedLogId)) return
    setSelectedLogId(logEntries[0]?.id ?? '')
  }, [logEntries, selectedLogId])

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const resetAudioGraph = useCallback(() => {
    processorRef.current?.disconnect()
    processorRef.current = null
    void audioContextRef.current?.close()
    audioContextRef.current = null
    stopStream()
  }, [stopStream])

  const runCodex = useCallback(async (transcript: string) => {
    resetProgressData()
    setProgressRefreshNonce(value => value + 1)

    const submitWithContext = (context: typeof activeContext) => {
      workspaceAppState.handleSubmit(transcript, [], {
        workspaceDir: context.versionDir,
        workspaceId: context.workspaceId,
        workspaceName: context.workspaceName,
        versionId: context.versionId,
      })
    }

    if (!activeContext.versionDir && activeContext.manifestRoot) {
      fetchWorkspaceManifest({
        initialize: true,
        manifestRoot: activeContext.manifestRoot,
        sourceWorkspaceDir: activeContext.sourceWorkspaceDir,
        workspaceId: activeContext.workspaceId,
        workspaceKey: activeContext.workspaceKey,
      })
        .then(data => {
          if (!data) {
            submitWithContext(activeContext)
            return
          }
          const activeVersion = getActiveVersion(data)
          const initializedContext = activeVersion?.workspaceDir
            ? {
              ...activeContext,
              manifestRoot: data.rootDir ?? activeContext.manifestRoot,
              manifestSessionId: data.sessionId ?? activeContext.manifestSessionId,
              versionDir: activeVersion.workspaceDir,
              versionId: activeVersion.id ?? null,
              workspaceId: data.workspaceId ?? activeContext.workspaceId,
              workspaceKey: data.workspaceId ?? activeContext.workspaceKey,
              workspaceRoot: data.rootDir ?? activeContext.workspaceRoot,
            }
            : resolveWorkspaceVersionContext({
              branchManifest: data,
              fallbackWorkspaceName: activeContext.workspaceName,
              workspaces,
            })
          versionState.setBranchManifest(data)
          refreshWorkspaceViews()
          submitWithContext(initializedContext)
        })
        .catch(() => submitWithContext(activeContext))
      window.setTimeout(() => setProgressRefreshNonce(value => value + 1), 150)
      return
    }

    submitWithContext(activeContext)
    window.setTimeout(() => setProgressRefreshNonce(value => value + 1), 150)
  }, [activeContext, refreshWorkspaceViews, resetProgressData, versionState, workspaceAppState, workspaces])

  const uploadAudio = useCallback(async (blob: Blob) => {
    setState('transcribing')
    setError('')

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
  }, [runCodex])

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
      samplesRef.current = []
      sampleRateRef.current = audioContext.sampleRate

      processor.onaudioprocess = (event) => {
        samplesRef.current.push(new Float32Array(event.inputBuffer.getChannelData(0)))
      }

      source.connect(processor)
      processor.connect(audioContext.destination)

      setText('')
      setError('')
      setState('recording')
    } catch (err) {
      resetAudioGraph()
      setError(err instanceof Error ? err.message : '无法打开麦克风')
      setState('error')
    }
  }, [resetAudioGraph])

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

  const handleButtonClick = useCallback(() => {
    if (state === 'recording') {
      stopRecording()
    } else if (state !== 'transcribing' && state !== 'thinking') {
      void startRecording()
    }
  }, [startRecording, state, stopRecording])

  const handleNavSelect = useCallback((_item: (typeof NAV_ITEMS)[number], index: number, event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    const nextView = NAV_VIEWS[index] ?? 'model'
    setActiveView(current => current === nextView ? null : nextView)
  }, [])
  const activeNavIndex = activeView ? NAV_VIEWS.indexOf(activeView) : -1
  const currentTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const currentDate = new Date().toLocaleDateString([], { month: 'short', day: '2-digit', year: 'numeric' })
  const progressUpdatedAt = formatProgressUpdatedAt(progressData, navigator.language || 'zh-CN', t)
  const sessionStatusLabel = visibleRunning
    ? t('workspace.status.running')
    : activeSessionMatchesWorkspace
      ? t('workspace.status.loaded')
      : t('workspace.status.waiting')

  return (
    <main className="whisper-page">
      <header className="whisper-hud-topbar">
        <div className="whisper-brand">
          <span className="whisper-brand-orbit" />
          <strong>AI ASSISTANT</strong>
        </div>
        <div className="whisper-topbar-status">
          <span className={`whisper-session-pill ${visibleRunning ? 'is-running' : activeSessionMatchesWorkspace ? 'is-loaded' : 'is-waiting'}`}>
            <span className="whisper-session-dot" />
            {sessionStatusLabel}
          </span>
        </div>
      </header>

      <section className="whisper-stage" aria-live="polite">
        <nav className="whisper-side-nav" aria-label="Whisper workspace views">
          {NAV_ITEMS.map((item, index) => (
            <a
              key={item.href}
              className={activeNavIndex === index ? 'active' : undefined}
              href={item.href}
              onClick={event => handleNavSelect(item, index, event)}
            >
              <span>{item.label}</span>
              <small>{item.meta}</small>
            </a>
          ))}
        </nav>
        <section className={`whisper-workspace-panel ${activeView ? 'is-open' : 'is-collapsed'}`}>
          {!activeView && (
            <>
              <MagicRings
                color="#558ef7"
                colorTwo="#6366F1"
                ringCount={6}
                speed={1}
                attenuation={10}
                lineThickness={2}
                baseRadius={0.35}
                radiusStep={0.1}
                scaleRate={0.1}
                opacity={1}
                blur={0}
                noiseAmount={0.1}
                rotation={0}
                ringGap={1.5}
                fadeIn={0.7}
                fadeOut={0.5}
                followMouse={false}
                mouseInfluence={0.2}
                hoverScale={1.2}
                parallax={0.05}
                clickBurst={false}
              />
              <span className="whisper-collapsed-wave" />
            </>
          )}
          <div className="whisper-workspace-header">
            <div>
              <strong>
                {activeView === 'workspace' ? '当前工作区' : activeView === 'bom' ? 'BOM' : activeView === 'model' ? '模型' : activeView === 'tools' ? '工具' : activeView === 'log' ? '日志' : '语音对话'}
              </strong>
              <span>{activeView ? `${activeContext.workspaceName}${activeContext.versionId ? ` · ${activeContext.versionId}` : ''}` : '选择左侧功能展开工作区'}</span>
            </div>
            {activeView === 'tools' && (
              <div className="whisper-tool-tabs">
                {(['cad', 'paraview', 'comsol'] as const).map(tool => (
                  <button
                    key={tool}
                    type="button"
                    className={activeTool === tool ? 'active' : undefined}
                    onClick={() => setActiveTool(tool)}
                  >
                    {tool === 'cad' ? 'CAD' : tool === 'paraview' ? 'ParaView' : 'COMSOL'}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="whisper-workspace-body">
            {!activeView ? (
              <div className="whisper-empty-state">工作区已收回，点击左侧功能重新展开</div>
            ) : activeView === 'workspace' ? (
              <div className="whisper-workspace-card-stage">
                <CurrentWorkspaceCard
                  activeManifestVersion={activeManifestVersion}
                  branchManifest={branchManifest}
                  currentWorkspaceName={activeContext.workspaceName}
                  manifestLoading={manifestLoading}
                  onCheckoutVersion={checkoutVersion}
                  onCreateChildBranch={createChildBranch}
                  onCreateSiblingBranch={createSiblingBranch}
                  onSelectWorkspace={switchActiveWorkspace}
                  onToggleVersionList={() => setVersionListOpen(open => !open)}
                  onToggleWorkspaceList={() => setWorkspaceListOpen(open => !open)}
                  versionAction={versionAction}
                  versionError={versionError}
                  versionListOpen={versionListOpen}
                  versionTreeRoots={versionTreeRoots}
                  workspaceChanging={workspaceChanging}
                  workspaceItems={workspaceItems}
                  workspaceListOpen={workspaceListOpen}
                />
              </div>
            ) : activeView === 'bom' ? (
              <BomStagePanel
                bomInfo={bomInfo}
                bomLoading={bomLoading}
                onSelectBom={setSelectedBomId}
                selectedBom={selectedBom}
                t={t}
              />
            ) : activeView === 'model' ? (
              activeContext.versionDir ? (
                <iframe className="whisper-embed-frame" title="模型" src={viewerHref} />
              ) : (
                <div className="whisper-empty-state">等待当前工作区生成模型</div>
              )
            ) : activeView === 'tools' ? (
              <iframe className="whisper-embed-frame" title={activeTool} src={toolUrls[activeTool]} />
            ) : (
              <LogStagePanel logEntries={logEntries} selectedLog={selectedLog} t={t} />
            )}
          </div>
        </section>

        <aside className="whisper-right-rail">
          <section className="whisper-info-stream">
            <header>
              <strong>INFORMATION STREAM</strong>
              <span>...</span>
            </header>
            <div className="whisper-clock-card">
              <span className="whisper-clock-icon" aria-hidden="true" />
              <div>
                <strong>{currentTime}</strong>
                <span>{currentDate}</span>
              </div>
            </div>
          </section>
          <section>
            <header>
              <strong>{t('workspace.inspector.progressTitle')}</strong>
              <span>{progressUpdatedAt}</span>
            </header>
            {workflowLoopProgressEntries.map(item => (
              <div className={`whisper-task-row is-${item.status}`} key={item.key}>
                <span>{item.label}</span>
                <small>{item.percent}%</small>
                <em>{item.statusLabel}</em>
                <i style={{ inlineSize: `${item.percent}%` }} />
              </div>
            ))}
          </section>
          <RunLogPanel
            entries={logEntries}
            maxEntries={12}
            onSelect={(entry) => {
              setSelectedLogId(entry.id)
              setActiveView('log')
            }}
            selectedLogId={selectedLog?.id ?? ''}
            variant="info"
          />
        </aside>

        {(error || text || visibleAgentResponse || agentSpeechState === 'synthesizing') && (
          <aside className="whisper-voice-exchange" aria-label="语音对话结果">
            <header>
              <strong>{error ? '语音处理失败' : visibleAgentResponse ? '语音对话' : '语音识别'}</strong>
              <span>{agentSpeechState === 'synthesizing' ? 'tts' : state}</span>
            </header>
            <div className="whisper-voice-exchange-body">
              {error ? (
                <p className="is-error">{error}</p>
              ) : (
                <>
                  {text && (
                    <article className="is-user">
                      <span>用户</span>
                      <p>{text}</p>
                    </article>
                  )}
                  {agentSpeechState === 'synthesizing' && (
                    <article className="is-agent">
                      <span>AI AGENT</span>
                      <p>正在生成语音...</p>
                    </article>
                  )}
                  {visibleAgentResponse && (
                    <article className="is-agent">
                      <span>AI AGENT</span>
                      <p>{visibleAgentResponse}</p>
                    </article>
                  )}
                </>
              )}
            </div>
          </aside>
        )}

        <section className={`whisper-panel ${activeView ? 'is-docked' : 'is-centered'}`}>
          <span className="whisper-wave left" aria-hidden="true" />
          <button
            className={`whisper-record-button ${state === 'recording' ? 'is-recording' : ''}`}
            type="button"
            onClick={handleButtonClick}
            disabled={state === 'transcribing' || state === 'thinking' || visibleRunning}
          >
            <span className="whisper-record-icon" aria-hidden="true" />
          </button>
          <span className="whisper-wave right" aria-hidden="true" />
          <small className="whisper-recorder-status">{recorderStatusText}</small>
        </section>
      </section>
    </main>
  )
}
