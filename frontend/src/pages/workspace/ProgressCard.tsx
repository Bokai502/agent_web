import type { TFunction } from "i18next"
import { formatProgressUpdatedAt, type WorkflowLoopProgressEntry, type WorkspaceProgressResponse } from "./progressUtils"

type ProgressCardProps = {
  entries: WorkflowLoopProgressEntry[]
  language: string
  progressData: WorkspaceProgressResponse | null
  t: TFunction
}

export function ProgressCard({ entries, language, progressData, t }: ProgressCardProps) {
  return (
    <section className="wa-info-card">
      <h3>{t("workspace.inspector.progressTitle")}</h3>
      <p>{t("workspace.inspector.updatedAt", { time: formatProgressUpdatedAt(progressData, language, t) })}</p>
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
