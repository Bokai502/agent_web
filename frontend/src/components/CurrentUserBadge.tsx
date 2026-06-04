import { useEffect, useRef, useState } from "react"
import { APP_NAVIGATION_EVENT } from "../app/sessionUtils"

type AuthMe = {
  userId: string
}

export function CurrentUserBadge() {
  const menuRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [userId, setUserId] = useState("default")

  useEffect(() => {
    let cancelled = false
    fetch("/api/auth/me", { cache: "no-store" })
      .then(async response => response.ok ? await response.json() as AuthMe : null)
      .then(data => {
        if (!data || cancelled) return
        setUserId(data.userId)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    window.addEventListener("pointerdown", handlePointerDown)
    window.addEventListener("keydown", handleKeyDown)
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown)
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [open])

  const handleLogout = async () => {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      await fetch("/api/auth/logout", { method: "POST" })
    } catch {
      // Navigate home even if the request fails; the next login can overwrite the cookie.
    } finally {
      setOpen(false)
      setLoggingOut(false)
      window.history.pushState(null, "", "/home")
      window.dispatchEvent(new Event(APP_NAVIGATION_EVENT))
    }
  }

  const initials = userId.trim().slice(0, 1).toUpperCase() || "U"

  return (
    <div className="agent-user-menu" ref={menuRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className={`agent-user-badge ${open ? "is-open" : ""}`}
        onClick={() => setOpen(value => !value)}
        title={`当前用户：${userId}`}
        type="button"
      >
        <span className="agent-user-avatar" aria-hidden="true">{initials}</span>
        <span className="agent-user-name">{userId}</span>
      </button>
      {open ? (
        <div className="agent-user-popover" role="menu" aria-label="用户菜单">
          <header>
            <span className="agent-user-avatar" aria-hidden="true">{initials}</span>
            <div>
              <strong>{userId}</strong>
              <small>当前用户</small>
            </div>
          </header>
          <button disabled={loggingOut} onClick={handleLogout} role="menuitem" type="button">
            {loggingOut ? "退出中" : "退出登录"}
          </button>
        </div>
      ) : null}
    </div>
  )
}
