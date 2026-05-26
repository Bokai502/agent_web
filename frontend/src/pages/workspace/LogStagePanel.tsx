import type { TFunction } from "i18next"
import { MarkdownText } from "../../components/outputMarkdown"
import { ConversationLogView } from "./ConversationLogView"
import { formatStageLogTime, type RunLogEntry } from "./runLogUtils"

function getLogMarkdown(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  return value.format === "markdown" && typeof value.content === "string" ? value.content : null
}

function getConversationContent(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  return value.format === "conversation" && value.content && typeof value.content === "object"
    ? value.content as Record<string, unknown>
    : null
}

type LogStagePanelProps = {
  logEntries: RunLogEntry[]
  selectedLog: RunLogEntry | null
  t: TFunction
}

export function LogStagePanel({ logEntries, selectedLog, t }: LogStagePanelProps) {
  return (
    <div className="wa-log-stage">
      <div className="wa-log-stage-inner">
        <h2>{t("workspace.stage.logTitle")}</h2>
        <p>{logEntries.length > 0 ? t("workspace.stage.logSummary", { count: logEntries.length }) : t("workspace.stage.noLogData")}</p>
        {selectedLog ? (
          <div className="wa-log-detail-card">
            {getLogMarkdown(selectedLog.raw) ? (
              <div className="wa-log-markdown only-content">
                <MarkdownText text={getLogMarkdown(selectedLog.raw) ?? ""} />
              </div>
            ) : getConversationContent(selectedLog.raw) ? (
              <ConversationLogView session={getConversationContent(selectedLog.raw) ?? {}} />
            ) : selectedLog.raw !== undefined ? (
              <pre className="wa-log-raw only-content">{JSON.stringify(selectedLog.raw, null, 2)}</pre>
            ) : (
              <>
                <h3>{selectedLog.title}</h3>
                <p>{selectedLog.detail}</p>
                <div className="wa-log-detail-grid">
                  {[
                    [t("workspace.logFields.status"), selectedLog.status],
                    [t("workspace.logFields.type"), selectedLog.type],
                    [t("workspace.logFields.time"), selectedLog.time ? formatStageLogTime(selectedLog.time) : "-"],
                    [t("workspace.logFields.source"), selectedLog.source ?? "-"],
                    ["ID", selectedLog.id],
                    ...Object.entries(selectedLog.fields ?? {}),
                  ].map(([label, value]) => (
                    <div className="wa-log-detail-field" key={label}>
                      <span>{label}</span>
                      <strong>{value}</strong>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="wa-log-detail-card">
            <h3>{t("workspace.stage.logEmptyTitle")}</h3>
            <p>{t("workspace.stage.logEmptyDescription")}</p>
          </div>
        )}
      </div>
    </div>
  )
}
