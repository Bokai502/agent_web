import type { TFunction } from "i18next"
import { formatProgressUpdatedAt, type WorkflowLoopProgressEntry, type WorkflowProgressSummary, type WorkspaceProgressResponse } from "./progressUtils"

type ProgressCardProps = {
  entries: WorkflowLoopProgressEntry[]
  language: string
  progressData: WorkspaceProgressResponse | null
  summary?: WorkflowProgressSummary
  t: TFunction
}

export function ProgressCard({ entries, language, progressData, summary, t }: ProgressCardProps) {
  return (
    <section className="wa-info-card">
      <h3>{t("workspace.inspector.progressTitle")}</h3>
      <p>{t("workspace.inspector.updatedAt", { time: formatProgressUpdatedAt(progressData, language, t) })}</p>
      {summary ? (
        <div className={`wa-progress-summary is-${summary.status}`}>
          <strong>{summary.percentage}%</strong>
          <span>{summary.statusLabel}</span>
          <small>{summary.completed}/{summary.total}</small>
        </div>
      ) : null}
      <div className="wa-progress">
        {entries.map(item => (
          <div className={`wa-progress-item wa-progress-loop is-${item.status}`} key={item.key}>
            <span className="wa-progress-loop-main">
              <span>{item.label}</span>
              <small>{item.statusLabel}</small>
            </span>
            <div className="wa-bar"><span style={{ width: `${item.percent}%` }} /></div>
            <span>{`${item.percent}%`}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
