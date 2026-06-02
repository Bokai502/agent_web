import type { WorkflowLoopProgressEntry } from '../workspace/progressUtils'

type AgentProgressRailProps = {
  className?: string
  onClose?: () => void
  progressUpdatedAt: string
  title: string
  workflowLoopProgressEntries: WorkflowLoopProgressEntry[]
}

export function AgentProgressRail({ className = 'agent-right-rail', onClose, progressUpdatedAt, title, workflowLoopProgressEntries }: AgentProgressRailProps) {
  return (
    <aside className={className}>
      <section>
        <header>
          <strong>{title}</strong>
          <span>{progressUpdatedAt}</span>
          {onClose ? (
            <button type="button" className="agent-progress-close" aria-label="关闭进度面板" onClick={onClose}>
              x
            </button>
          ) : null}
        </header>
        {workflowLoopProgressEntries.map(item => (
          <div className={`agent-task-row is-${item.status}`} key={item.key}>
            <span>{item.label}</span>
            <small>{item.percent}%</small>
            <em>{item.statusLabel}</em>
            <i style={{ inlineSize: `${item.percent}%` }} />
          </div>
        ))}
      </section>
    </aside>
  )
}
