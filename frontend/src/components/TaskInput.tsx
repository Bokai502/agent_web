import { useState, useRef, useEffect } from "react"
import type { CodexInputItem } from "../types"

interface AttachedFile {
  name: string
  inputItem: CodexInputItem
}

interface AtMenuState {
  atIndex: number   // @ 在 value 中的位置
  query: string     // @ 后面已输入的过滤文本
}

interface Skill {
  name: string
  description: string
}

interface Props {
  onSubmit: (input: string | CodexInputItem[], enabledSkills: string[]) => void
  onAbort: () => void
  disabled: boolean
  tone?: "default" | "hero" | "landing"
}

function isImageFile(file: File) {
  return ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)
}

function readFileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? "")
      resolve(result.includes(",") ? result.slice(result.indexOf(",") + 1) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error("failed to read file"))
    reader.readAsDataURL(file)
  })
}

async function uploadImageInput(file: File): Promise<CodexInputItem> {
  const response = await fetch("/api/run/input-files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: file.name,
      mimeType: file.type,
      dataBase64: await readFileAsBase64(file),
    }),
  })
  if (!response.ok) throw new Error("failed to upload image")
  return response.json() as Promise<CodexInputItem>
}

export function TaskInput({ onSubmit, onAbort, disabled, tone = "default" }: Props) {
  const [value, setValue] = useState("")
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [atMenu, setAtMenu] = useState<AtMenuState | null>(null)
  const [skills, setSkills] = useState<Skill[]>([])
  const [selectedSkills, setSelectedSkills] = useState<string[]>([])
  const [menuHover, setMenuHover] = useState<number>(0)

  // 启动时拉取 skill 列表
  useEffect(() => {
    fetch("/api/skills")
      .then(r => r.ok ? r.json() : [])
      .then(data => { if (Array.isArray(data)) setSkills(data) })
      .catch(() => { /* 后端不可用时静默 */ })
  }, [])

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  // 保存触发 @ 菜单时的光标位置，供图片选中后替换
  const pendingAtIndexRef = useRef<number | null>(null)

  useEffect(() => {
    if (!disabled) textareaRef.current?.focus()
  }, [disabled])

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = Math.min(el.scrollHeight, 180) + "px"
  }, [value])

  // 点击外部关闭 @ 菜单
  useEffect(() => {
    if (!atMenu) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setAtMenu(null)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [atMenu])

  // 从光标往前找最近的 @，返回其索引；@ 前面必须是字符串开头或空白字符；@ 到光标之间不能有空白
  const findAtTrigger = (text: string, cursor: number): { atIndex: number; query: string } | null => {
    for (let i = cursor - 1; i >= 0; i--) {
      const ch = text[i]
      if (ch === "@") {
        const before = i === 0 ? " " : text[i - 1]
        if (/\s/.test(before)) {
          return { atIndex: i, query: text.slice(i + 1, cursor) }
        }
        return null
      }
      if (/\s/.test(ch)) return null
    }
    return null
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newVal = e.target.value
    setValue(newVal)

    const cursor = e.target.selectionStart ?? newVal.length
    const trigger = findAtTrigger(newVal, cursor)

    if (trigger) {
      setAtMenu({ atIndex: trigger.atIndex, query: trigger.query })
      setMenuHover(0)
      pendingAtIndexRef.current = trigger.atIndex
    } else {
      setAtMenu(null)
    }
  }

  // 根据 @ 查询文本过滤可用菜单项（Add file + 未选中的 skill）
  const menuItems = (() => {
    const q = (atMenu?.query ?? "").toLowerCase()
    type Item =
      | { kind: "file"; label: string; hint: string }
      | { kind: "skill"; label: string; hint: string; name: string }
    const items: Item[] = []
    if (!q || "add image".includes(q) || "image".includes(q) || "图片".includes(q)) {
      items.push({ kind: "file", label: "添加图片", hint: "@image" })
    }
    for (const s of skills) {
      if (selectedSkills.includes(s.name)) continue
      if (!q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)) {
        items.push({ kind: "skill", label: s.name, hint: s.description, name: s.name })
      }
    }
    return items
  })()

  // 确保 hover index 在有效范围内
  useEffect(() => {
    if (menuHover >= menuItems.length) setMenuHover(0)
  }, [menuItems.length, menuHover])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (atMenu && menuItems.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setMenuHover(i => (i + 1) % menuItems.length)
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setMenuHover(i => (i - 1 + menuItems.length) % menuItems.length)
        return
      }
      if (e.key === "Tab") {
        e.preventDefault()
        selectMenuItem(menuHover)
        return
      }
    }

    if (e.key === "Escape" && atMenu) {
      e.preventDefault()
      setAtMenu(null)
      return
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      if (atMenu && menuItems.length > 0) {
        selectMenuItem(menuHover)
        return
      }
      if ((value.trim() || attachedFiles.length > 0 || selectedSkills.length > 0) && !disabled) {
        doSubmit()
      }
    }
  }

  const selectMenuItem = (idx: number) => {
    const item = menuItems[idx]
    if (!item) return
    if (item.kind === "file") {
      triggerFilePicker()
    } else {
      addSkill(item.name)
    }
  }

  const addSkill = (name: string) => {
    setSelectedSkills(prev => prev.includes(name) ? prev : [...prev, name])
    // 从输入文本中删掉 @query 整段
    if (atMenu) {
      const { atIndex, query } = atMenu
      setValue(prev => prev.slice(0, atIndex) + prev.slice(atIndex + 1 + query.length))
    }
    setAtMenu(null)
    pendingAtIndexRef.current = null
    textareaRef.current?.focus()
  }

  const removeSkill = (name: string) => {
    setSelectedSkills(prev => prev.filter(n => n !== name))
  }

  // ── @ file picker ──────────────────────────────────────────────────

  const triggerFilePicker = () => {
    setAtMenu(null)
    fileInputRef.current?.click()
  }

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    const newAttachments: AttachedFile[] = []
    for (const file of Array.from(files)) {
      try {
        if (isImageFile(file)) {
          newAttachments.push({ name: file.name, inputItem: await uploadImageInput(file) })
        }
      } catch {
        // 跳过无法读取的图片
      }
    }
    setAttachedFiles(prev => [...prev, ...newAttachments])

    // 把 @ + 过滤查询文本一起从输入框中删除
    if (pendingAtIndexRef.current !== null) {
      const idx = pendingAtIndexRef.current
      const queryLen = atMenu?.query.length ?? 0
      setValue(prev => prev.slice(0, idx) + prev.slice(idx + 1 + queryLen))
      pendingAtIndexRef.current = null
    }

    // 重置 file input，允许重复选择同一图片
    e.target.value = ""
    textareaRef.current?.focus()
  }

  const removeFile = (name: string) => {
    setAttachedFiles(prev => prev.filter(f => f.name !== name))
  }

  // ── submit ─────────────────────────────────────────────────────────

  const doSubmit = () => {
    const inputItems: CodexInputItem[] = []
    if (value.trim()) inputItems.push({ type: "text", text: value.trim() })
    for (const f of attachedFiles) {
      inputItems.push(f.inputItem)
    }

    if (inputItems.length === 0 && selectedSkills.length === 0) return

    onSubmit(inputItems.length === 1 && inputItems[0].type === "text" ? inputItems[0].text : inputItems, selectedSkills)
    setValue("")
    setAttachedFiles([])
    setSelectedSkills([])
  }

  const handleAction = () => {
    if (disabled) {
      onAbort()
    } else {
      doSubmit()
    }
  }

  const canSend = value.trim().length > 0 || attachedFiles.length > 0 || selectedSkills.length > 0
  const isHero = tone === "hero"
  const isLanding = tone === "landing"
  const isAccentTone = isHero || isLanding
  const hasComposerItems = selectedSkills.length > 0 || attachedFiles.length > 0

  return (
    <div
      ref={containerRef}
      className={[
        "relative w-full flex-shrink-0",
        isAccentTone
          ? "bg-transparent px-0 pb-0 pt-0"
          : "bg-[var(--bg)] px-[var(--content-px)] pb-5 pt-3",
      ].join(" ")}
    >
      <div className={isAccentTone ? "mx-auto w-full max-w-full" : "mx-auto w-full max-w-[var(--content-width)]"}>

        {/* ── 已选 skill chips ── */}
        {!isLanding && selectedSkills.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {selectedSkills.map(name => (
              <div
                key={`skill:${name}`}
                className={[
                  "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] text-[var(--text-2)]",
                  isAccentTone
                    ? "border-[rgba(88,71,50,0.10)] bg-[rgba(255,255,255,0.88)] shadow-[0_6px_16px_rgba(65,49,31,0.04)]"
                    : "border-[var(--border-2)] bg-[var(--bg-3)]",
                ].join(" ")}
              >
                <svg width="11" height="11" viewBox="0 0 14 14" fill="none"
                  style={{ flexShrink: 0, opacity: 0.7 }}>
                  <path d="M7 1.5l1.7 3.6 3.8.5-2.8 2.7.7 3.7L7 10.3l-3.4 1.7.7-3.7L1.5 5.6l3.8-.5L7 1.5z"
                    stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
                </svg>
                <span>{name}</span>
                <button
                  onClick={() => removeSkill(name)}
                  className="flex flex-shrink-0 items-center bg-none p-0 text-[var(--text-3)]"
                  title="移除技能"
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M2 2l6 6M8 2l-6 6"
                      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ── 已附加的图片 chips ── */}
        {!isLanding && attachedFiles.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachedFiles.map(f => (
              <div
                key={f.name}
                className={[
                  "flex max-w-[220px] items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] text-[var(--text-2)]",
                  isAccentTone
                    ? "border-[rgba(88,71,50,0.10)] bg-[rgba(255,255,255,0.88)] shadow-[0_6px_16px_rgba(65,49,31,0.04)]"
                    : "border-[var(--border-2)] bg-[var(--bg-3)]",
                ].join(" ")}
              >
                <svg width="11" height="11" viewBox="0 0 14 14" fill="none"
                  style={{ flexShrink: 0, opacity: 0.7 }}>
                  <rect x="1" y="3" width="12" height="9" rx="1.5"
                    stroke="currentColor" strokeWidth="1.4"/>
                  <path d="M1 6h12" stroke="currentColor" strokeWidth="1.4"/>
                  <path d="M4 1l1.5 2h3L10 1" stroke="currentColor"
                    strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                  {f.name}
                </span>
                <button
                  onClick={() => removeFile(f.name)}
                  className="flex flex-shrink-0 items-center bg-none p-0 text-[var(--text-3)]"
                  title="移除图片"
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M2 2l6 6M8 2l-6 6"
                      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ── 输入框（相对定位容器，用于承载 @ 菜单）── */}
        <div className="relative">

        {/* ── @ 触发菜单：锚定在输入框正上方，左对齐 ── */}
        {atMenu && menuItems.length > 0 && (
          <div className="absolute inset-x-0 bottom-[calc(100%+8px)] z-[100] max-h-[260px] overflow-y-auto rounded-[14px] border border-[var(--border-2)] bg-[var(--bg-2)] p-1 shadow-[0_14px_28px_rgba(38,32,25,0.16)]">
            {menuItems.map((item, idx) => {
              const active = idx === menuHover
              return (
                <button
                  key={item.kind === "skill" ? `skill:${item.name}` : "file"}
                  onMouseDown={e => { e.preventDefault(); selectMenuItem(idx) }}
                  onMouseEnter={() => setMenuHover(idx)}
                  className={`flex w-full items-center gap-2 rounded-[10px] border-none px-3 py-2 text-left text-[13px] text-[var(--text)] ${active ? "bg-[var(--bg-3)]" : "bg-transparent"}`}
                >
                  {item.kind === "file" ? (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <rect x="1" y="3" width="12" height="9" rx="1.5"
                        stroke="currentColor" strokeWidth="1.3"/>
                      <path d="M1 6h12" stroke="currentColor" strokeWidth="1.3"/>
                      <path d="M4 1l1.5 2h3L10 1" stroke="currentColor"
                        strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M7 1.5l1.7 3.6 3.8.5-2.8 2.7.7 3.7L7 10.3l-3.4 1.7.7-3.7L1.5 5.6l3.8-.5L7 1.5z"
                        stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                    </svg>
                  )}
                  <span className="flex-shrink-0 overflow-hidden text-ellipsis whitespace-nowrap">
                    {item.label}
                  </span>
                  <span className="ml-auto max-w-[240px] overflow-hidden text-ellipsis whitespace-nowrap text-[11px] opacity-50">
                    {item.hint}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {isLanding ? (
          <div className="w-full overflow-hidden rounded-[28px] border border-black/[0.08] bg-white/80 shadow-[0_34px_80px_rgba(0,0,0,0.12),inset_0_1px_0_rgba(255,255,255,0.92)] backdrop-blur-2xl">
            <div className="relative px-6 pb-4 pt-7 sm:px-[30px] sm:pt-7">
              <textarea
                ref={textareaRef}
                className="home-composer-textarea"
                value={value}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                disabled={disabled}
                placeholder="输入设计目标、约束条件或要生成的结构方案..."
                rows={1}
                style={{
                  width: "100%",
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  resize: "none",
                  fontFamily: "var(--font)",
                  fontSize: 18,
                  lineHeight: "1.55",
                  color: "#1d1d1f",
                  padding: 0,
                  minHeight: 126,
                  maxHeight: 180,
                  overflowY: "auto",
                }}
              />
            </div>

            <div className="flex items-center justify-between gap-4 border-t border-black/[0.05] px-6 py-4 sm:px-6">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-[13px] text-[#8d8d92]">
                {hasComposerItems ? (
                  <>
                    {selectedSkills.map(name => (
                      <div
                        key={`landing-skill:${name}`}
                        className="flex h-[34px] max-w-[180px] items-center gap-1.5 rounded-full border border-black/[0.08] bg-white/85 px-3 text-[13px] text-[#55555a] shadow-[0_1px_2px_rgba(0,0,0,0.03)]"
                      >
                        <svg width="11" height="11" viewBox="0 0 14 14" fill="none" className="flex-shrink-0 opacity-70">
                          <path d="M7 1.5l1.7 3.6 3.8.5-2.8 2.7.7 3.7L7 10.3l-3.4 1.7.7-3.7L1.5 5.6l3.8-.5L7 1.5z"
                            stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
                        </svg>
                        <span className="truncate">{name}</span>
                        <button
                          onClick={() => removeSkill(name)}
                          className="flex flex-shrink-0 items-center bg-none p-0 text-[#9aa0aa]"
                          title="移除技能"
                        >
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                            <path d="M2 2l6 6M8 2l-6 6"
                              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                          </svg>
                        </button>
                      </div>
                    ))}

                    {attachedFiles.map(f => (
                      <div
                        key={`landing-file:${f.name}`}
                        className="flex h-[34px] max-w-[200px] items-center gap-1.5 rounded-full border border-black/[0.08] bg-white/85 px-3 text-[13px] text-[#55555a] shadow-[0_1px_2px_rgba(0,0,0,0.03)]"
                      >
                        <svg width="11" height="11" viewBox="0 0 14 14" fill="none" className="flex-shrink-0 opacity-70">
                          <rect x="1" y="3" width="12" height="9" rx="1.5"
                            stroke="currentColor" strokeWidth="1.4"/>
                          <path d="M1 6h12" stroke="currentColor" strokeWidth="1.4"/>
                          <path d="M4 1l1.5 2h3L10 1" stroke="currentColor"
                            strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        <span className="truncate">{f.name}</span>
                        <button
                          onClick={() => removeFile(f.name)}
                          className="flex flex-shrink-0 items-center bg-none p-0 text-[#9aa0aa]"
                          title="移除图片"
                        >
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                            <path d="M2 2l6 6M8 2l-6 6"
                              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                          </svg>
                        </button>
                      </div>
                    ))}
                  </>
                ) : (
                  <>
                    <span className="grid h-[34px] w-[34px] flex-shrink-0 place-items-center rounded-full border border-black/[0.08] bg-white/85 text-[15px] leading-none">
                      @
                    </span>
                    <span className="truncate">Skill 或图片</span>
                  </>
                )}
              </div>

              <button
                onClick={handleAction}
                disabled={!disabled && !canSend}
                aria-label={disabled ? "停止生成" : "发送任务"}
                className={[
                  "ml-2 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border shadow-[0_2px_6px_rgba(0,0,0,0.10)] transition-[background,opacity,transform] active:scale-95",
                  disabled || canSend ? "cursor-pointer" : "cursor-default",
                  disabled || canSend
                    ? "border-[#202123] bg-[#202123] opacity-100"
                    : "border-[#d7d7d4] bg-[#e9e9e6] opacity-70",
                ].join(" ")}
              >
                {disabled ? (
                  <div style={{ width: 10, height: 10, background: "#fff", borderRadius: 2 }} />
                ) : (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        ) : (
          <div
            className={[
              "flex items-end gap-2 border px-[14px] py-3 transition-[border-color,box-shadow]",
              isHero
                ? "rounded-[20px] border-[rgba(88,71,50,0.10)] bg-[rgba(255,255,255,0.9)] shadow-[0_12px_24px_rgba(38,26,17,0.07)] backdrop-blur-[10px]"
                : "rounded-[14px] border-[var(--border-2)] bg-[var(--bg)] shadow-[0_0_0_1px_rgba(0,0,0,0.04),0_2px_12px_rgba(0,0,0,0.06)]",
            ].join(" ")}
          >
            <textarea
              ref={textareaRef}
              value={value}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              disabled={disabled}
              placeholder={isHero ? "描述你的下一个工作区任务..." : "发送给 AI...（输入 @ 可添加 Skill 或图片）"}
              rows={1}
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                outline: "none",
                resize: "none",
                fontFamily: "var(--font)",
                fontSize: 15,
                lineHeight: "1.6",
                color: "var(--text)",
                padding: 0,
                minHeight: 24,
                maxHeight: 180,
                overflowY: "auto",
              }}
            />

            <button
              onClick={handleAction}
              disabled={!disabled && !canSend}
              aria-label={disabled ? "停止生成" : "发送任务"}
              className={[
                "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] border-none transition-[background,opacity]",
                disabled || canSend ? "cursor-pointer" : "cursor-default",
                disabled || canSend ? "bg-[#171310] opacity-100" : "bg-[var(--bg-3)] opacity-35",
              ].join(" ")}
            >
              {disabled ? (
                <div style={{ width: 10, height: 10, background: "#fff", borderRadius: 2 }} />
              ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5"
                    stroke="white" strokeWidth="1.8"
                    strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          </div>
        )}
        </div>

        {/* Hint */}
        {!isLanding && (
          <p className={`mt-2 text-center text-[12px] ${isHero ? "text-[var(--text-3)]" : "text-[var(--text-3)]"}`}>
            {disabled
              ? "AI 正在处理，点击方块可停止"
              : "Enter 发送 · Shift+Enter 换行 · @ Skill 或图片"}
          </p>
        )}
      </div>

      {/* 隐藏的 file input，支持多图片选择 */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        style={{ display: "none" }}
        onChange={handleFileSelected}
      />
    </div>
  )
}
