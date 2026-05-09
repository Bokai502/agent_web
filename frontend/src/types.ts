// 镜像 @openai/codex-sdk 的 ThreadEvent 结构（点号命名）

export interface AgentMessageItem {
  id: string
  type: "agent_message"
  text: string
}

export interface ReasoningItem {
  id: string
  type: "reasoning"
  text: string
}

export interface CommandExecutionItem {
  id: string
  type: "command_execution"
  command: string
  aggregated_output: string
  exit_code?: number | null
  status: "in_progress" | "completed" | "failed"
}

export interface FileUpdateChange {
  path: string
  kind: "add" | "delete" | "update"
}

export interface FileChangeItem {
  id: string
  type: "file_change"
  changes: FileUpdateChange[]
  status: "completed" | "failed"
}

export interface WebSearchItem {
  id: string
  type: "web_search"
  query: string
}

export interface McpToolCallItem {
  id: string
  type: "mcp_tool_call"
  server: string
  tool: string
  arguments: unknown
  result?: {
    content: unknown[]
    structured_content: unknown
  }
  error?: { message: string }
  status: "in_progress" | "completed" | "failed"
}

export interface TodoItem {
  text: string
  completed: boolean
}

export interface TodoListItem {
  id: string
  type: "todo_list"
  items: TodoItem[]
}

export interface ErrorItem {
  id: string
  type: "error"
  message: string
}

export interface AskUserItem {
  id: string
  type: "ask_user"
  question: string
  options: string[]
}

export type ThreadItem =
  | AgentMessageItem
  | ReasoningItem
  | CommandExecutionItem
  | FileChangeItem
  | McpToolCallItem
  | WebSearchItem
  | TodoListItem
  | ErrorItem
  | AskUserItem

export interface Usage {
  input_tokens: number
  cached_input_tokens: number
  output_tokens: number
  reasoning_output_tokens: number
}

export type CodexInputItem =
  | { type: "text"; text: string }
  | { type: "local_image"; path: string }

// 一轮完整对话
export interface Turn {
  id: string           // 稳定唯一 ID，用作 React key
  userPrompt: string
  events: ThreadEvent[]
}

// 一个会话（对应 Codex 的一个 thread）
export interface Session {
  id: string            // 本地唯一 ID
  title: string         // 首条用户消息（截断）
  threadId: string | null  // Codex SDK thread_id，用于 resumeThread
  turns: Turn[]
  createdAt: number     // 时间戳
  dismissedAskUserId?: string | null
  workspaceDir?: string | null
  workspaceName?: string | null
}

// 注意：SDK 使用点号命名，如 "item.started" 而非 "item_started"
export type ThreadEvent =
  | { type: "thread.started"; thread_id: string }
  | { type: "turn.started" }
  | { type: "turn.completed"; usage: Usage }
  | { type: "turn.failed"; error: { message: string } }
  | { type: "item.started"; item: ThreadItem }
  | { type: "item.updated"; item: ThreadItem }
  | { type: "item.completed"; item: ThreadItem }
  | { type: "thread_error"; error: { message: string } }
  | { type: "error"; message: string }
