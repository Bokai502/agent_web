import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { MarkdownText } from "../../components/outputMarkdown"
import type { AskUserItem, ThreadEvent, Turn } from "../../types"
import { buildAgentSummaries } from "./runLogUtils"

type AgentUnderstandingPanelProps = {
  currentEvents: ThreadEvent[]
  currentPrompt: string
  onSubmitAskUser: (answer: string) => void
  onStopAskUser: () => void
  pendingAskUser: AskUserItem | null
  turns: Turn[]
}

export function AgentUnderstandingPanel({
  currentEvents,
  currentPrompt,
  onSubmitAskUser,
  onStopAskUser,
  pendingAskUser,
  turns,
}: AgentUnderstandingPanelProps) {
  const { t } = useTranslation()
  const summaries = useMemo(() => buildAgentSummaries(turns, currentPrompt, currentEvents), [currentEvents, currentPrompt, turns])
  const visibleSummaries = useMemo(() => [...summaries].reverse(), [summaries])

  return (
    <section className="wa-left-section">
      <div className="wa-left-section-header">
        <div>
          <strong>{t("workspace.agent.title")}</strong>
          <span>{summaries.length > 0 ? t("workspace.agent.turns", { count: summaries.length }) : t("workspace.agent.waiting")}</span>
        </div>
      </div>
      <div className="wa-agent-feed">
        {visibleSummaries.length === 0 ? (
          <div className="wa-left-empty">{t("workspace.agent.empty")}</div>
        ) : visibleSummaries.map(summary => (
          <article className="wa-agent-card" key={summary.id}>
            <div className="wa-agent-meta">
              <span>{t("workspace.agent.turnNumber", { count: summary.turnNumber })}</span>
              {summary.isCurrent && <em>{t("workspace.agent.latest")}</em>}
            </div>
            {summary.prompt && <div className="wa-agent-prompt">{t("workspace.agent.userPrompt", { prompt: summary.prompt })}</div>}
            {summary.answer ? (
              <div className="wa-agent-answer"><MarkdownText text={summary.answer} /></div>
            ) : (
              <div className="wa-agent-answer">{t("workspace.agent.generating")}</div>
            )}
            {summary.reasoning && (
              <details className="wa-agent-thinking">
                <summary>{t("workspace.agent.reasoning")}</summary>
                <MarkdownText text={summary.reasoning} tone="muted" />
              </details>
            )}
          </article>
        ))}
        {pendingAskUser && (
          <article className="wa-agent-card">
            <div className="wa-agent-prompt">{t("workspace.agent.needsConfirmation", { question: pendingAskUser.question })}</div>
            <div className="wa-ask-user">
              {pendingAskUser.options.map(option => (
                <button type="button" key={option} onClick={() => onSubmitAskUser(option)}>{option}</button>
              ))}
              <button type="button" onClick={onStopAskUser}>{t("workspace.agent.stop")}</button>
            </div>
          </article>
        )}
      </div>
    </section>
  )
}
