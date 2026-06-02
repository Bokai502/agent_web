import { ConversationLogView } from '../workspace/ConversationLogView'
import type { ConversationLogEntry } from '../workspace/runLogUtils'

type AgentConversationPopoverProps = {
  conversationLogs: ConversationLogEntry[]
  onClose: () => void
  title: string
}

export function AgentConversationPopover({
  conversationLogs,
  onClose,
  title,
}: AgentConversationPopoverProps) {
  const conversationEntry = conversationLogs[0] ?? null
  const historyContent = conversationEntry?.raw && typeof conversationEntry.raw === 'object'
    ? conversationEntry.raw as Record<string, unknown>
    : null

  return (
    <aside className="agent-conversation-popover" role="dialog" aria-label={title}>
      <header>
        <div>
          <strong>{title}</strong>
          <span>{conversationEntry?.detail ?? 'logs/conversation-history.json'}</span>
        </div>
        <button type="button" aria-label="关闭历史对话" onClick={onClose}>x</button>
      </header>
      {historyContent ? (
        <ConversationLogView session={historyContent} />
      ) : (
        <div className="agent-conversation-empty">未找到 logs/conversation-history.json 历史对话</div>
      )}
    </aside>
  )
}
