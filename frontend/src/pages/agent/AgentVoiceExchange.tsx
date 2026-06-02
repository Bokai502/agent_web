import type { AgentSpeechState, RecorderState } from './types'

type AgentInputMode = 'voice' | 'text'

type AgentVoiceExchangeProps = {
  agentSpeechError: string
  agentSpeechState: AgentSpeechState
  error: string
  inputMode: AgentInputMode
  state: RecorderState
  text: string
  visibleAgentResponse: string
}

export function AgentVoiceExchange({
  agentSpeechError,
  agentSpeechState,
  error,
  inputMode,
  state,
  text,
  visibleAgentResponse,
}: AgentVoiceExchangeProps) {
  const displayError = error || agentSpeechError
  if (!displayError && !text && !visibleAgentResponse && agentSpeechState !== 'synthesizing') return null
  const exchangeTitle = displayError
    ? '处理失败'
    : visibleAgentResponse
      ? inputMode === 'text' ? '文字对话' : '语音对话'
      : inputMode === 'text' ? '文字输入' : '语音识别'

  return (
    <aside className="agent-voice-exchange" aria-label={inputMode === 'text' ? '文字对话结果' : '语音对话结果'}>
      <header>
        <strong>{exchangeTitle}</strong>
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
