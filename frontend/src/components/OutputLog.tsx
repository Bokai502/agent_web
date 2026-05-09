import { memo, useEffect, useMemo, useRef, useState } from "react"
import type { AskUserItem, ThreadEvent, ThreadItem, Turn } from "../types"
import { MarkdownText } from "./outputMarkdown"
import { getEventErrorMessage, shouldSuppressEvent } from "../utils/codexEventFilter"

interface Props {
  turns: Turn[]
  currentPrompt: string
  currentEvents: ThreadEvent[]
  running: boolean
  pendingAskUser: AskUserItem | null
  onSubmitAskUser: (answer: string) => void
  onStopAskUser: () => void
}

interface ItemState {
  item: ThreadItem
  done: boolean
}

// ── 从 events 中提取 item 状态表 ───────────────────────────────
function buildItemStates(events: ThreadEvent[]): { order: string[]; map: Map<string, ItemState> } {
  const map = new Map<string, ItemState>()
  const order: string[] = []
  for (const ev of events) {
    if (ev.type === "item.started" || ev.type === "item.updated") {
      if (!map.has(ev.item.id)) order.push(ev.item.id)
      map.set(ev.item.id, { item: ev.item, done: false })
    } else if (ev.type === "item.completed") {
      if (!map.has(ev.item.id)) order.push(ev.item.id)
      map.set(ev.item.id, { item: ev.item, done: true })
    }
  }
  return { order, map }
}

// ── 光标 ───────────────────────────────────────────────────────
function Cursor() {
  return (
    <span style={{
      display: "inline-block", width: 2, height: 16,
      background: "var(--text)", verticalAlign: "text-bottom",
      marginLeft: 2, borderRadius: 1,
      animation: "blink 1s step-end infinite",
    }} />
  )
}

// ── AI Agent 头像 ────────────────────────────────────────────────────
function AIIcon() {
  return (
    <img src="/logo_1.png" style={{ width: 28, height: "auto", flexShrink: 0 }} />
  )
}

// ── 用户消息 ───────────────────────────────────────────────────
function UserMessage({ text }: { text: string }) {
  return (
    <div style={{
      animation: "fadeIn 0.18s ease forwards",
      paddingBottom: 24, display: "flex", justifyContent: "flex-end",
    }}>
      <div style={{
        maxWidth: "75%",
        background: "var(--bg-3)",
        borderRadius: "18px 18px 4px 18px",
        padding: "10px 16px",
        fontSize: 15, lineHeight: "1.65", color: "var(--text)",
        whiteSpace: "pre-wrap", wordBreak: "break-word",
      }}>
        {text}
      </div>
    </div>
  )
}

// ── Agent 消息（直接显示流式文本，打字机效果由 SSE 流本身提供）──
function LiveAgentMessage({ text, done }: { text: string; done: boolean }) {
  return (
    <div style={{ animation: "fadeIn 0.18s ease forwards", paddingBottom: 24 }}>
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
        <AIIcon />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 14, fontWeight: 600, marginBottom: 6,
            color: done ? "var(--text)" : "var(--text-2)",
            transition: "color 0.3s",
          }}>AI Agent</div>
          <div style={{ fontSize: 15, lineHeight: "1.78", color: "var(--text)" }}>
            <MarkdownText text={text} />
            {!done && <Cursor />}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Agent 消息（静态，用于历史轮）─────────────────────────────
function StaticAgentMessage({ text }: { text: string }) {
  return (
    <div style={{ paddingBottom: 24 }}>
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
        <AIIcon />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, color: "var(--text)" }}>AI Agent</div>
          <div style={{ fontSize: 15, lineHeight: "1.78", color: "var(--text)" }}>
            <MarkdownText text={text} />
          </div>
        </div>
      </div>
    </div>
  )
}

function ReasoningCard({ text, done }: {
  text: string; done: boolean
}) {
  return (
    <div style={{ paddingBottom: 16, paddingLeft: 42 }}>
      <div style={{
        border: "1px solid var(--border)", borderRadius: 8,
        overflow: "hidden", background: "var(--bg-2)",
      }}>
        <div style={{
          width: "100%", display: "flex", alignItems: "center", gap: 8,
          padding: "9px 14px", background: "transparent", border: "none",
          borderBottom: "1px solid var(--border)", textAlign: "left",
        }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-2)" }}>Thinking</span>
          {!done && (
            <span style={{ fontSize: 12, color: "var(--text-3)", animation: "blink 1.2s step-end infinite" }}>
              •••
            </span>
          )}
        </div>
        <div style={{
          padding: "10px 14px",
          fontSize: 13,
          lineHeight: "1.7",
          color: "var(--text-2)",
          fontStyle: "italic",
        }}>
          <MarkdownText text={text} tone="muted" />
          {!done && <Cursor />}
        </div>
      </div>
    </div>
  )
}

// ── 命令块（通用）─────────────────────────────────────────────
function CommandBlock({ item, done }: {
  item: Extract<ThreadItem, { type: "command_execution" }>
  done: boolean
}) {
  const [open, setOpen] = useState(false)
  const failed = item.exit_code != null && item.exit_code !== 0
  const hasOutput = !!item.aggregated_output
  const commandLines = item.command.split("\n")
  const summaryLine = commandLines[0] ?? ""
  const extraCommand = commandLines.slice(1).join("\n")
  const hasExtraCommand = extraCommand.length > 0
  const canExpand = hasOutput || hasExtraCommand
  return (
    <div style={{ paddingBottom: 14, paddingLeft: 42 }}>
      <div style={{ borderRadius: 8, overflow: "hidden", background: "var(--code-bg)", border: "1px solid var(--border)", fontSize: 13 }}>
        <button onClick={() => canExpand && setOpen(o => !o)} style={{
          width: "100%", display: "flex", alignItems: "flex-start", gap: 8,
          padding: "8px 14px", background: "var(--code-header)",
          border: "none",
          borderBottomWidth: open ? 1 : 0,
          borderBottomStyle: "solid",
          borderBottomColor: "var(--border)",
          cursor: canExpand ? "pointer" : "default", textAlign: "left",
        }}>
          <span style={{ fontSize: 13, color: "var(--code-dim)", width: 10, flexShrink: 0, lineHeight: 1.5, paddingTop: 1 }}>
            {canExpand ? (open ? "▾" : "▸") : ""}
          </span>
          <span style={{ fontFamily: "var(--mono)", color: "var(--code-dim)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", lineHeight: 1.5, paddingTop: 2 }}>shell</span>
          <span
            title={item.command}
            style={{
              fontFamily: "var(--mono)",
              color: "var(--code-text)",
              flex: 1,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              lineHeight: 1.5,
            }}
          >
            {summaryLine}
          </span>
          {!done && (
            <span style={{ fontSize: 11, color: "var(--amber)", fontFamily: "var(--mono)", animation: "pulse 1.2s ease-in-out infinite", lineHeight: 1.5, paddingTop: 2 }}>running</span>
          )}
          {item.exit_code != null && (
            <span style={{ fontSize: 11, fontFamily: "var(--mono)", color: failed ? "#dc2626" : "#059669", lineHeight: 1.5, paddingTop: 2 }}>
              {`exit ${item.exit_code}`}
            </span>
          )}
        </button>
        {open && canExpand && (
          <div>
            {hasExtraCommand && (
              <pre style={{
                margin: 0,
                padding: "12px 14px",
                fontFamily: "var(--mono)",
                fontSize: "12.5px",
                lineHeight: "1.65",
                color: "var(--code-text)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                borderBottom: hasOutput ? "1px solid var(--border)" : "none",
              }}>
                {extraCommand}
              </pre>
            )}
            {hasOutput && (
              <pre style={{
                margin: 0, padding: "12px 14px",
                fontFamily: "var(--mono)", fontSize: "12.5px", lineHeight: "1.65",
                color: failed ? "#b91c1c" : "var(--code-text)",
                whiteSpace: "pre-wrap", wordBreak: "break-all",
                maxHeight: 300, overflowY: "auto",
              }}>
                {item.aggregated_output}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── 文件变更 ───────────────────────────────────────────────────
function FileChanges({ item }: { item: Extract<ThreadItem, { type: "file_change" }> }) {
  if (!item.changes?.length) return null
  return (
    <div style={{ paddingBottom: 14, paddingLeft: 42 }}>
      <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", background: "var(--bg-2)" }}>
        <div style={{ padding: "7px 14px", fontSize: 12, fontWeight: 600, color: "var(--text-2)", borderBottom: "1px solid var(--border)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          File changes
        </div>
        <div style={{ padding: "8px 14px" }}>
          {item.changes.map((c, i) => {
            const color = c.kind === "add" ? "var(--green)" : c.kind === "delete" ? "var(--red)" : "var(--blue)"
            const sym   = c.kind === "add" ? "+" : c.kind === "delete" ? "−" : "~"
            return (
              <div key={i} style={{ display: "flex", gap: 10, padding: "2px 0", fontFamily: "var(--mono)", fontSize: 13 }}>
                <span style={{ color, fontWeight: 700, width: 12, textAlign: "center", flexShrink: 0 }}>{sym}</span>
                <span style={{ color: "var(--text-2)" }}>{c.path}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Web Search ─────────────────────────────────────────────────
function WebSearch({ query }: { query: string }) {
  return (
    <div style={{ paddingBottom: 12, paddingLeft: 42, display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-2)" }}>
      <span>🔍</span>
      Searching <em style={{ fontStyle: "normal", color: "var(--text)" }}>"{query}"</em>
    </div>
  )
}

function AskUserAnswerCard({
  askUser,
  disabled,
  onSubmit,
  onStop,
}: {
  askUser: AskUserItem
  disabled: boolean
  onSubmit: (answer: string) => void
  onStop: () => void
}) {
  const hasOptions = askUser.options.length > 0
  const [customOpen, setCustomOpen] = useState(!hasOptions)
  const [customValue, setCustomValue] = useState("")
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setCustomOpen(askUser.options.length === 0)
    setCustomValue("")
    setFocusedIndex(-1)
  }, [askUser.id, askUser.options.length])

  const submitAnswer = (answer: string) => {
    const trimmed = answer.trim()
    if (!trimmed || disabled) return
    onSubmit(trimmed)
  }

  const handleOptionKeyDown = (e: React.KeyboardEvent, i: number) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault()
      const next = (i + 1) % askUser.options.length
      setFocusedIndex(next)
      optionRefs.current[next]?.focus()
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault()
      const prev = (i - 1 + askUser.options.length) % askUser.options.length
      setFocusedIndex(prev)
      optionRefs.current[prev]?.focus()
    }
  }

  return (
    <div style={{ paddingBottom: 24, animation: "fadeIn 0.18s ease forwards" }}>
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
        <AIIcon />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            fontSize: 14, fontWeight: 600, marginBottom: 6, color: "var(--text)",
          }}>
            AI
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              fontSize: 11, fontWeight: 500, color: "var(--amber)",
              padding: "2px 8px", borderRadius: 999,
              background: "rgba(245, 158, 11, 0.1)",
              border: "1px solid rgba(245, 158, 11, 0.25)",
            }}>
              <span style={{
                width: 5, height: 5, borderRadius: "50%", background: "var(--amber)",
                animation: "pulse 1.4s ease-in-out infinite",
              }} />
              等待你的回答
            </span>
          </div>

          <div style={{
            border: "1px solid var(--border)",
            background: "var(--bg-2)",
            borderRadius: 12,
            padding: "14px 16px",
          }}>
            <div style={{
              fontSize: 15,
              lineHeight: "1.7",
              color: "var(--text)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}>
              {askUser.question}
            </div>

            {hasOptions && (
              <>
                <div style={{
                  display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14,
                }}>
                  {askUser.options.map((option, i) => (
                    <button
                      key={option}
                      ref={el => { optionRefs.current[i] = el }}
                      onClick={() => submitAnswer(option)}
                      onKeyDown={e => handleOptionKeyDown(e, i)}
                      onFocus={() => setFocusedIndex(i)}
                      disabled={disabled}
                      style={{
                        padding: "8px 14px",
                        borderRadius: 999,
                        border: `1px solid ${focusedIndex === i ? "var(--text)" : "var(--border-2)"}`,
                        background: "var(--bg)",
                        color: "var(--text)",
                        cursor: disabled ? "default" : "pointer",
                        fontSize: 13,
                        lineHeight: 1.3,
                        opacity: disabled ? 0.5 : 1,
                        transition: "background 0.15s, border-color 0.15s",
                      }}
                      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = "var(--bg-3)" }}
                      onMouseLeave={e => { e.currentTarget.style.background = "var(--bg)" }}
                    >
                      {option}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 10 }}>
                  点击选项直接发送
                </div>
              </>
            )}

            <div style={{ marginTop: hasOptions ? 14 : 10 }}>
              {hasOptions && !customOpen && (
                <button
                  onClick={() => {
                    setCustomOpen(true)
                    setTimeout(() => textareaRef.current?.focus(), 0)
                  }}
                  disabled={disabled}
                  style={{
                    background: "transparent", border: "none",
                    padding: 0, cursor: disabled ? "default" : "pointer",
                    fontSize: 13, color: "var(--text-2)",
                    textDecoration: "underline",
                    textUnderlineOffset: 3,
                  }}
                >
                  ✏️ 自定义回答
                </button>
              )}

              {customOpen && (
                <div style={{
                  display: "flex", gap: 8, alignItems: "flex-end",
                }}>
                  <textarea
                    ref={textareaRef}
                    value={customValue}
                    onChange={e => setCustomValue(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault()
                        submitAnswer(customValue)
                      }
                    }}
                    disabled={disabled}
                    placeholder={hasOptions ? "或者输入自定义回答…" : "输入你的回答…"}
                    rows={1}
                    style={{
                      flex: 1,
                      resize: "none",
                      minHeight: 40,
                      maxHeight: 160,
                      borderRadius: 10,
                      border: "1px solid var(--border)",
                      background: "var(--bg)",
                      padding: "10px 12px",
                      fontFamily: "var(--font)",
                      fontSize: 14,
                      lineHeight: "1.6",
                      color: "var(--text)",
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                  <button
                    onClick={() => submitAnswer(customValue)}
                    disabled={disabled || !customValue.trim()}
                    style={{
                      padding: "10px 16px",
                      borderRadius: 10,
                      border: "none",
                      background: (disabled || !customValue.trim()) ? "var(--bg-3)" : "var(--text)",
                      color: (disabled || !customValue.trim()) ? "var(--text-3)" : "var(--bg)",
                      cursor: (disabled || !customValue.trim()) ? "default" : "pointer",
                      fontSize: 13,
                      fontWeight: 600,
                      flexShrink: 0,
                      transition: "background 0.15s",
                    }}
                  >
                    发送
                  </button>
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
                <button
                  onClick={onStop}
                  disabled={disabled}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: "1px solid var(--border-2)",
                    background: "transparent",
                    color: "var(--text-2)",
                    cursor: disabled ? "default" : "pointer",
                    fontSize: 13,
                    fontWeight: 500,
                    opacity: disabled ? 0.5 : 1,
                  }}
                >
                  停止对话
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── 当前轮 item（带动画）──────────────────────────────────────
function LiveItemView({ state }: { state: ItemState }) {
  const { item, done } = state
  if (item.type === "agent_message")     return <LiveAgentMessage text={item.text} done={done} />
  if (item.type === "reasoning") {
    return <ReasoningCard text={item.text} done={done} />
  }
  if (item.type === "command_execution") return <CommandBlock item={item} done={done} />
  if (item.type === "file_change")       return <FileChanges item={item} />
  if (item.type === "web_search")        return <WebSearch query={item.query} />
  return null
}

// ── 历史轮 item（静态）────────────────────────────────────────
function StaticItemView({ item }: { item: ThreadItem }) {
  if (item.type === "agent_message")     return <StaticAgentMessage text={item.text} />
  if (item.type === "reasoning") {
    return <ReasoningCard text={item.text} done />
  }
  if (item.type === "command_execution") return <CommandBlock item={item} done />
  if (item.type === "file_change")       return <FileChanges item={item} />
  if (item.type === "web_search")        return <WebSearch query={item.query} />
  return null
}

// ── 历史轮完整渲染（memo：历史 turn 不变则跳过重渲染）──────────
const HistoryTurn = memo(function HistoryTurn({ turn }: { turn: Turn }) {
  const { order, map } = useMemo(() => buildItemStates(turn.events), [turn.events])
  return (
    <>
      <UserMessage text={turn.userPrompt} />
      {order.map(id => {
        const state = map.get(id)!
        return <StaticItemView key={id} item={state.item} />
      })}
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        margin: "4px 0 24px", opacity: 0.3,
      }}>
        <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
      </div>
    </>
  )
})

// ── 主组件 ────────────────────────────────────────────────────
export function OutputLog({ turns, currentPrompt, currentEvents, running, pendingAskUser, onSubmitAskUser, onStopAskUser }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)
  // RAF ref：确保每帧最多触发一次滚动，避免密集事件流造成滚动抖动
  const scrollRafRef = useRef<number | null>(null)
  // Dev render counter
  const renderCountRef = useRef(0)

  if (import.meta.env.DEV) {
    renderCountRef.current += 1
    console.log(`[OutputLog] render #${renderCountRef.current}  events=${currentEvents.length}  turns=${turns.length}`)
  }

  useEffect(() => {
    if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current)
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null
      bottomRef.current?.scrollIntoView({ behavior: "smooth" })
    })
  }, [turns.length, currentEvents.length, pendingAskUser?.id])

  // useMemo：仅在 currentEvents 引用变化（批量 flush 后）时重新计算
  const { order, map } = useMemo(() => {
    const t0 = performance.now()
    const result = buildItemStates(currentEvents)
    if (import.meta.env.DEV) {
      const ms = (performance.now() - t0).toFixed(2)
      if (Number(ms) > 1) console.log(`[buildItemStates] ${ms}ms for ${currentEvents.length} events`)
    }
    return result
  }, [currentEvents])

  const isTurnStarted = currentEvents.some(ev => ev.type === "turn.started")
  const isDone        = currentEvents.some(ev => ev.type === "turn.completed")
  const errorEv       = currentEvents.find(ev =>
    (ev.type === "turn.failed" || ev.type === "error" || ev.type === "thread_error") &&
    !shouldSuppressEvent(ev)
  )
  const isEmpty       = turns.length === 0 && !currentPrompt && !running

  return (
    <div style={{ flex: 1, minHeight: 0, width: "100%", overflowY: "auto", background: "var(--bg)" }}>
      <div style={{
        maxWidth: "var(--content-width)",
        margin: "0 auto",
        padding: "32px var(--content-px) 8px",
      }}>

        {/* 空状态 */}
        {isEmpty && (
          <div style={{
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            minHeight: "50vh", gap: 12, textAlign: "center",
          }}>
            <img src="/logo_1.png" style={{ width: 80, height: "auto", marginBottom: 4 }} />
            <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>
              How can I help you today?
            </div>
          </div>
        )}

        {/* 历史轮次 */}
        {turns.map(turn => (
          <HistoryTurn key={turn.id} turn={turn} />
        ))}

        {pendingAskUser && !running && (
          <AskUserAnswerCard
            askUser={pendingAskUser}
            disabled={running}
            onSubmit={onSubmitAskUser}
            onStop={onStopAskUser}
          />
        )}

        {/* 当前轮用户消息 */}
        {currentPrompt && <UserMessage text={currentPrompt} />}

        {/* 初始化点动画 */}
        {isTurnStarted && !isDone && order.length === 0 && (
          <div style={{
            display: "flex", alignItems: "center", gap: 14,
            animation: "fadeIn 0.18s ease forwards", paddingBottom: 24,
          }}>
            <AIIcon />
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  width: 5, height: 5, borderRadius: "50%",
                  background: "var(--text-3)",
                  animation: `pulse 1.2s ease-in-out ${i * 0.18}s infinite`,
                }} />
              ))}
            </div>
          </div>
        )}

        {/* 当前轮动态 items */}
        {order.map(id => (
          <LiveItemView key={id} state={map.get(id)!} />
        ))}

        {/* 错误 */}
        {errorEv && (
          <div style={{
            animation: "fadeIn 0.18s ease forwards",
            display: "flex", gap: 10, alignItems: "flex-start",
            padding: "12px 16px",
            background: "#fef2f2", border: "1px solid #fecaca",
            borderRadius: 8, color: "var(--red)",
            fontSize: 14, lineHeight: "1.6",
          }}>
            <span>⚠</span>
            <span>
              {getEventErrorMessage(errorEv) ?? "Unknown error"}
            </span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  )
}
