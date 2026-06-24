import type { ReactNode } from "react"
import type { TFunction } from "i18next"
import { AppleTaskComposer } from "../../components/AppleTaskComposer"
import type { AskUserItem, CodexInputItem, ThreadEvent, Turn } from "../../types"
import { AgentUnderstandingPanel } from "./AgentUnderstandingPanel"
import { RunLogPanel } from "./RunLogPanel"
import type { RunLogEntry } from "./runLogUtils"

type WorkspaceLeftPanelProps = {
  abort: () => void
  activeSessionId: string | null
  activeSessionTitle?: string
  apiBase?: string
  currentEvents: ThreadEvent[]
  currentPrompt: string
  logEntries: RunLogEntry[]
  onSelectLog: (entry: RunLogEntry) => void
  onStopAskUser: () => void
  onSubmit: (input: string | CodexInputItem[], enabledSkills?: string[]) => void
  onSubmitAskUser: (answer: string) => void
  pendingAskUser: AskUserItem | null
  selectedLogId: string
  showRunLog?: boolean
  t: TFunction
  topContent?: ReactNode
  turns: Turn[]
  visibleRunning: boolean
}

export function WorkspaceLeftPanel({
  abort,
  activeSessionId,
  activeSessionTitle,
  apiBase,
  currentEvents,
  currentPrompt,
  logEntries,
  onSelectLog,
  onStopAskUser,
  onSubmit,
  onSubmitAskUser,
  pendingAskUser,
  selectedLogId,
  showRunLog = true,
  t,
  topContent,
  turns,
  visibleRunning,
}: WorkspaceLeftPanelProps) {
  return (
    <aside className="wa-panel wa-chat wa-left-stack">
      {topContent}
      <section className="wa-left-section wa-left-input">
        <div className="wa-left-section-header">
          <div>
            <strong>{t("workspace.input.title")}</strong>
            <span>{activeSessionTitle ? `当前会话：${activeSessionTitle}` : activeSessionId ? t("workspace.input.session", { id: activeSessionId }) : t("workspace.input.newTask")}</span>
          </div>
        </div>
        <div className="wa-left-input-body">
          {pendingAskUser ? (
            <div className="wa-left-pending">{t("workspace.input.pending")}</div>
          ) : (
            <AppleTaskComposer
              apiBase={apiBase}
              compact
              enableTools
              onSubmit={onSubmit}
              onAbort={abort}
              running={visibleRunning}
              placeholder={t("composer.compactPlaceholder")}
            />
          )}
        </div>
      </section>

      <AgentUnderstandingPanel
        currentEvents={currentEvents}
        currentPrompt={currentPrompt}
        onSubmitAskUser={onSubmitAskUser}
        onStopAskUser={onStopAskUser}
        pendingAskUser={pendingAskUser}
        turns={turns}
      />

      {showRunLog && <RunLogPanel entries={logEntries} onSelect={onSelectLog} selectedLogId={selectedLogId} />}
    </aside>
  )
}
