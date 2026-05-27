import { useTranslation } from "react-i18next"
import type { RunLogEntry } from "./runLogUtils"
import { getStatusIcon } from "./runLogUtils"

type RunLogPanelProps = {
  entries: RunLogEntry[]
  variant?: "left" | "info"
  onSelect: (entry: RunLogEntry) => void
  selectedLogId: string
}

export function RunLogPanel({
  entries,
  onSelect,
  selectedLogId,
  variant = "left",
}: RunLogPanelProps) {
  const { t } = useTranslation()
  const content = (
    <>
      <div className="wa-left-section-header">
        <div>
          <strong>{t("workspace.logs.title")}</strong>
          <span>{entries.length > 0 ? t("workspace.logs.count", { count: entries.length }) : t("workspace.logs.noRuns")}</span>
        </div>
      </div>
      <div className="wa-run-feed">
        {entries.length === 0 ? (
          <div className="wa-left-empty">{t("workspace.logs.empty")}</div>
        ) : (
          entries.map(entry => (
            <button
              type="button"
              className={`wa-run-card${entry.id === selectedLogId ? " selected" : ""}`}
              key={entry.id}
              onClick={() => onSelect(entry)}
            >
              <span className={`wa-run-status-icon ${entry.status.toLowerCase()}`} title={entry.status}>
                {getStatusIcon(entry.status)}
              </span>
              <div className="wa-run-main">
                <div className="wa-run-title" title={entry.title}>{entry.title}</div>
                <div className="wa-run-detail" title={entry.detail}>{entry.detail}</div>
              </div>
            </button>
          ))
        )}
      </div>
    </>
  )
  if (variant === "info") {
    return <section className="wa-info-card wa-run-info-card">{content}</section>
  }
  return (
    <section className="wa-left-section">
      {content}
    </section>
  )
}
