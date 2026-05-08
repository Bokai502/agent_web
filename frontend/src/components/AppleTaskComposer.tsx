import { useEffect, useRef, useState } from "react"
import type { CodexInputItem } from "../types"

interface AttachedFile {
  name: string
  inputItem: CodexInputItem
}

interface Skill {
  name: string
  description: string
}

interface AtMenuState {
  atIndex: number
  query: string
}

interface AppleTaskComposerProps {
  compact?: boolean
  onAbort: () => void
  onSubmit: (input: string | CodexInputItem[], enabledSkills?: string[]) => void
  placeholder?: string
  running: boolean
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

const STYLE = `
.apple-task-composer {
  position: relative;
  width: 100%;
  overflow: visible;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.78);
  box-shadow:
    0 34px 80px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(28px) saturate(180%);
  color: #1d1d1f;
  text-align: left;
}
.apple-task-composer.compact {
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.82);
  box-shadow:
    0 14px 34px rgba(0, 0, 0, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
}
.apple-task-composer textarea {
  display: block;
  width: 100%;
  min-height: 126px;
  padding: 28px 30px 16px;
  border: 0;
  outline: 0;
  resize: none;
  background: transparent;
  color: #1d1d1f;
  font: inherit;
  font-size: 18px;
  line-height: 1.55;
}
.apple-task-composer.compact textarea {
  min-height: 58px;
  max-height: 132px;
  padding: 14px 16px 8px;
  font-size: 14px;
  line-height: 1.48;
}
.apple-task-composer textarea::placeholder { color: #8d8d92; }
.apple-task-composer-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 16px 18px 18px 24px;
  border-top: 1px solid rgba(0, 0, 0, 0.05);
}
.apple-task-composer.compact .apple-task-composer-footer {
  gap: 10px;
  padding: 9px 10px 10px 12px;
}
.apple-task-composer-tools {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  gap: 9px;
}
.apple-task-composer.compact .apple-task-composer-tools { gap: 6px; }
.apple-task-composer-pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 34px;
  padding: 0 13px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.86);
  color: #55555a;
  font-size: 13px;
  white-space: nowrap;
}
.apple-task-composer.compact .apple-task-composer-pill {
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
}
.apple-task-composer-pill button {
  margin-left: 2px;
  border: 0;
  background: transparent;
  color: #8d8d92;
  cursor: pointer;
}
.apple-task-composer-tool-button {
  cursor: pointer;
}
.apple-task-composer-send {
  display: grid;
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: #1d1d1f;
  color: white;
  cursor: pointer;
}
.apple-task-composer.compact .apple-task-composer-send {
  width: 36px;
  height: 36px;
}
.apple-task-composer-send:disabled {
  cursor: default;
  opacity: 0.35;
}
.apple-task-composer-menu {
  position: absolute;
  left: 24px;
  right: 24px;
  top: calc(100% + 10px);
  z-index: 160;
  max-height: 310px;
  overflow-y: auto;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.16);
  backdrop-filter: blur(24px) saturate(180%);
  padding: 8px;
}
.apple-task-composer.compact .apple-task-composer-menu {
  left: 10px;
  right: 10px;
  top: auto;
  bottom: calc(100% + 8px);
  max-height: 240px;
  border-radius: 16px;
}
.apple-task-composer-menu button {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 12px;
  border: 0;
  border-radius: 14px;
  background: transparent;
  padding: 11px 12px;
  color: #1d1d1f;
  text-align: left;
  cursor: pointer;
}
.apple-task-composer-menu button:hover,
.apple-task-composer-menu button.active {
  background: rgba(0, 0, 0, 0.045);
}
.apple-task-composer-icon {
  display: grid;
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 10px;
  background: rgba(0, 113, 227, 0.1);
  color: #0071e3;
  font-size: 14px;
  font-weight: 700;
}
.apple-task-composer-text {
  display: flex;
  min-width: 0;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 2px;
}
.apple-task-composer-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
}
.apple-task-composer-hint {
  min-width: 0;
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #8d8d92;
  font-size: 12px;
}
`

export function AppleTaskComposer({
  compact = false,
  onAbort,
  onSubmit,
  placeholder = "例如：设计一个遥感小卫星内部布局，约束热源远离载荷舱，并生成可查看模型...",
  running,
}: AppleTaskComposerProps) {
  const [value, setValue] = useState("")
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [selectedSkills, setSelectedSkills] = useState<string[]>([])
  const [atMenu, setAtMenu] = useState<AtMenuState | null>(null)
  const [menuHover, setMenuHover] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingAtMenuRef = useRef<AtMenuState | null>(null)

  useEffect(() => {
    fetch("/api/skills")
      .then(response => response.ok ? response.json() : [])
      .then(data => {
        if (!Array.isArray(data)) return
        const nextSkills = data as Skill[]
        const hasFreecad = nextSkills.some(skill => skill.name.toLowerCase() === "freecad")
        setSkills(hasFreecad
          ? nextSkills
          : [
              { name: "freecad", description: "FreeCAD workflow for CAD assembly generation, component moves, and STEP/GLB outputs." },
              ...nextSkills,
            ])
      })
      .catch(() => {
        setSkills([
          { name: "freecad", description: "FreeCAD workflow for CAD assembly generation, component moves, and STEP/GLB outputs." },
        ])
      })
  }, [])

  const findAtTrigger = (text: string, cursor: number): AtMenuState | null => {
    for (let index = cursor - 1; index >= 0; index -= 1) {
      const char = text[index]
      if (char === "@") {
        const before = index === 0 ? " " : text[index - 1]
        if (/\s/.test(before)) return { atIndex: index, query: text.slice(index + 1, cursor) }
        return null
      }
      if (/\s/.test(char)) return null
    }
    return null
  }

  const menuItems = (() => {
    const query = (atMenu?.query ?? "").toLowerCase()
    type MenuItem =
      | { kind: "file"; label: string; hint: string }
      | { kind: "skill"; label: string; hint: string; name: string }

    const items: MenuItem[] = []
    if (!query || "add image".includes(query) || "image".includes(query) || "图片".includes(query)) {
      items.push({ kind: "file", label: "添加图片", hint: "@image" })
    }
    for (const skill of skills) {
      if (selectedSkills.includes(skill.name)) continue
      if (!query || skill.name.toLowerCase().includes(query) || skill.description.toLowerCase().includes(query)) {
        items.push({ kind: "skill", label: skill.name, hint: skill.description, name: skill.name })
      }
    }
    return items
  })()

  useEffect(() => {
    if (menuHover >= menuItems.length) setMenuHover(0)
  }, [menuHover, menuItems.length])

  const removeAtQuery = () => {
    const menu = pendingAtMenuRef.current ?? atMenu
    if (!menu) return
    setValue(previous => previous.slice(0, menu.atIndex) + previous.slice(menu.atIndex + 1 + menu.query.length))
    pendingAtMenuRef.current = null
    setAtMenu(null)
  }

  const selectMenuItem = (index: number) => {
    const item = menuItems[index]
    if (!item) return
    if (item.kind === "file") {
      pendingAtMenuRef.current = atMenu
      setAtMenu(null)
      fileInputRef.current?.click()
      return
    }
    setSelectedSkills(previous => previous.includes(item.name) ? previous : [...previous, item.name])
    removeAtQuery()
  }

  const canSend = value.trim().length > 0 || attachedFiles.length > 0 || selectedSkills.length > 0

  const submit = () => {
    if (running) {
      onAbort()
      return
    }
    const inputItems: CodexInputItem[] = []
    if (value.trim()) inputItems.push({ type: "text", text: value.trim() })
    for (const file of attachedFiles) {
      inputItems.push(file.inputItem)
    }

    if (inputItems.length === 0 && selectedSkills.length === 0) return
    onSubmit(inputItems.length === 1 && inputItems[0].type === "text" ? inputItems[0].text : inputItems, selectedSkills)
    setValue("")
    setAttachedFiles([])
    setSelectedSkills([])
    setAtMenu(null)
  }

  return (
    <div className={`apple-task-composer${compact ? " compact" : ""}`} aria-label="任务输入">
      <style>{STYLE}</style>
      {atMenu && menuItems.length > 0 && (
        <div className="apple-task-composer-menu">
          {menuItems.map((item, index) => (
            <button
              key={item.kind === "skill" ? `skill:${item.name}` : "file"}
              type="button"
              className={index === menuHover ? "active" : undefined}
              onMouseEnter={() => setMenuHover(index)}
              onMouseDown={event => {
                event.preventDefault()
                selectMenuItem(index)
              }}
            >
              <span className="apple-task-composer-icon">{item.kind === "file" ? "+" : "S"}</span>
              <span className="apple-task-composer-text">
                <span className="apple-task-composer-label">{item.label}</span>
                <span className="apple-task-composer-hint">{item.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      <textarea
        value={value}
        onChange={event => {
          const nextValue = event.target.value
          setValue(nextValue)
          const cursor = event.target.selectionStart ?? nextValue.length
          setAtMenu(findAtTrigger(nextValue, cursor))
          setMenuHover(0)
        }}
        onKeyDown={event => {
          if (atMenu && menuItems.length > 0) {
            if (event.key === "ArrowDown") {
              event.preventDefault()
              setMenuHover(index => (index + 1) % menuItems.length)
              return
            }
            if (event.key === "ArrowUp") {
              event.preventDefault()
              setMenuHover(index => (index - 1 + menuItems.length) % menuItems.length)
              return
            }
            if (event.key === "Tab") {
              event.preventDefault()
              selectMenuItem(menuHover)
              return
            }
          }
          if (event.key === "Escape" && atMenu) {
            event.preventDefault()
            setAtMenu(null)
            return
          }
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault()
            if (atMenu && menuItems.length > 0) {
              selectMenuItem(menuHover)
              return
            }
            submit()
          }
        }}
        disabled={running}
        placeholder={placeholder}
      />
      <div className="apple-task-composer-footer">
        <div className="apple-task-composer-tools">
          {selectedSkills.length === 0 && attachedFiles.length === 0 ? (
            <>
              <button
                type="button"
                className="apple-task-composer-pill apple-task-composer-tool-button"
                onClick={() => setAtMenu({ atIndex: value.length, query: "" })}
              >
                @ Skill 或图片
              </button>
            </>
          ) : (
            <>
              {selectedSkills.map(skill => (
                <span key={`skill:${skill}`} className="apple-task-composer-pill">
                  {skill}
                  <button type="button" onClick={() => setSelectedSkills(previous => previous.filter(item => item !== skill))}>x</button>
                </span>
              ))}
              {attachedFiles.map(file => (
                <span key={`file:${file.name}`} className="apple-task-composer-pill">
                  {file.name}
                  <button type="button" onClick={() => setAttachedFiles(previous => previous.filter(item => item.name !== file.name))}>x</button>
                </span>
              ))}
            </>
          )}
        </div>
        <button
          type="button"
          className="apple-task-composer-send"
          aria-label={running ? "停止生成" : "发送任务"}
          disabled={!running && !canSend}
          onClick={submit}
        >
          {running ? (
            <span style={{ width: 12, height: 12, borderRadius: 2, background: "white" }} />
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 13V3M8 3 3.8 7.2M8 3l4.2 4.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        style={{ display: "none" }}
        onChange={async event => {
          const files = event.target.files
          if (!files) return
          const nextFiles: AttachedFile[] = []
          for (const file of Array.from(files)) {
            try {
              if (isImageFile(file)) {
                nextFiles.push({ name: file.name, inputItem: await uploadImageInput(file) })
              }
            } catch {
              // Skip unreadable files.
            }
          }
          setAttachedFiles(previous => [...previous, ...nextFiles])
          removeAtQuery()
          event.target.value = ""
        }}
      />
    </div>
  )
}
