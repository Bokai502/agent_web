import { useRef, useCallback } from "react"
import type { CodexInputItem, ThreadEvent } from "../types"

export function useCodexStream() {
  const abortRef = useRef<AbortController | null>(null)

  const run = useCallback(async (
    promptOrInput: string | CodexInputItem[],
    sessionId: string,
    threadId: string | null,
    turnId: string,
    enabledSkills: string[],
    onEvent: (event: ThreadEvent) => void,
    onDone: () => void
  ) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    // 防止 onDone 被调用两次（turn.completed 提前触发 + finally 兜底）
    let doneCalled = false
    const callDoneOnce = () => {
      if (!doneCalled) {
        doneCalled = true
        onDone()
      }
    }

    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(typeof promptOrInput === "string" ? { prompt: promptOrInput } : { input: promptOrInput }),
          sessionId,
          threadId,
          turnId,
          enabledSkills,
        }),
        signal: controller.signal,
      })

      if (!res.body) throw new Error("No response body")

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const event: ThreadEvent = JSON.parse(line.slice(6))
              onEvent(event)

              // turn.completed / turn.failed 表示这轮逻辑上已结束，
              // 不必等待 HTTP 连接关闭再通知上层
              if (event.type === "turn.completed" || event.type === "turn.failed") {
                callDoneOnce()
              }
            } catch {
              // ignore malformed lines
            }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        onEvent({ type: "error", message: String(err) })
      }
    } finally {
      // 兜底：如果没有收到 turn.completed（网络中断等），仍然结束
      callDoneOnce()
    }
  }, [])

  const abort = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  return { run, abort }
}
