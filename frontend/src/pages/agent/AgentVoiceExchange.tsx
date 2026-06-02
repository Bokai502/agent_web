import type { AgentSpeechState, RecorderState } from './types'

type AgentVoiceExchangeProps = {
  agentSpeechError: string
  agentSpeechState: AgentSpeechState
  error: string
  state: RecorderState
  text: string
  visibleAgentResponse: string
}

export function AgentVoiceExchange({
  agentSpeechError,
  agentSpeechState,
  error,
  state,
  text,
  visibleAgentResponse,
}: AgentVoiceExchangeProps) {
  const displayError = error || agentSpeechError
  if (!displayError && !text && !visibleAgentResponse && agentSpeechState !== 'synthesizing') return null

  return (
    <aside className="agent-voice-exchange" aria-label="语音对话结果">
      <header>
        <strong>{displayError ? '语音处理失败' : visibleAgentResponse ? '语音对话' : '语音识别'}</strong>
        <span>{agentSpeechState === 'synthesizing' ? 'tts' : state}</span>
      </header>
      <div className="agent-voice-exchange-body">
        {displayError ? (
          <p className="is-error">{displayError}</p>
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
  )
}
