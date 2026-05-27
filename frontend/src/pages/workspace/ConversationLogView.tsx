import { MarkdownText } from "../../components/outputMarkdown"

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function getEventItem(event: unknown) {
  return isRecord(event) && isRecord(event.item) ? event.item : null
}

function getItemText(item: Record<string, unknown>) {
  return typeof item.text === "string" ? item.text : ""
}

function getCommandPreview(command: string) {
  return command.replace(/\s+/gu, " ").trim()
}

function ConversationSessionView({ session }: { session: Record<string, unknown> }) {
  const turns = Array.isArray(session.turns) ? session.turns : []
  return (
    <>
      {turns.map((turn, turnIndex) => {
        const value = isRecord(turn) ? turn : {}
        const prompt = typeof value.userPrompt === "string" ? value.userPrompt : ""
        const events = Array.isArray(value.events) ? value.events : []
        return (
          <div className="wa-conversation-turn" key={typeof value.id === "string" ? value.id : `turn-${turnIndex}`}>
            {prompt && <div className="wa-conversation-user">{prompt}</div>}
            {events.map((event, eventIndex) => {
              const item = getEventItem(event)
              if (!item) return null
              if (item.type === "agent_message") {
                const text = getItemText(item).trim()
                if (!text) return null
                return (
                  <div className="wa-conversation-agent" key={`${turnIndex}-${eventIndex}`}>
                    <div className="wa-conversation-agent-head">
                      <span className="wa-conversation-agent-icon">AI</span>
                      <strong>AI Agent</strong>
                    </div>
                    <MarkdownText text={text} />
                  </div>
                )
              }
              if (item.type === "command_execution" && typeof item.command === "string") {
                const status = typeof item.status === "string" ? item.status : "completed"
                const exitCode = typeof item.exit_code === "number" ? item.exit_code : null
                return (
                  <div className="wa-conversation-shell" key={`${turnIndex}-${eventIndex}`}>
                    <span>› SHELL</span>
                    <code title={item.command}>{getCommandPreview(item.command)}</code>
                    <small className={exitCode === 0 ? "ok" : exitCode === null ? "" : "bad"}>
                      {exitCode === null ? status : `exit ${exitCode}`}
                    </small>
                  </div>
                )
              }
              return null
            })}
          </div>
        )
      })}
    </>
  )
}

export function ConversationLogView({ session }: { session: Record<string, unknown> }) {
  const sessions = Array.isArray(session.sessions)
    ? session.sessions.filter(isRecord)
    : [session]
  return (
    <div className="wa-conversation-log">
      {sessions.map((item, index) => (
        <section className="wa-conversation-session" key={typeof item.id === "string" ? item.id : `session-${index}`}>
          {sessions.length > 1 && (
            <div className="wa-conversation-session-head">
              <strong>{typeof item.title === "string" ? item.title : `Session ${index + 1}`}</strong>
              <span>{Array.isArray(item.turns) ? `${item.turns.length} turns` : "0 turns"}</span>
            </div>
          )}
          <ConversationSessionView session={item} />
        </section>
      ))}
    </div>
  )
}
