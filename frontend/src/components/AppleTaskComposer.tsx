import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { joinApiPath } from "../app/apiBase"
import type { CodexInputItem } from "../types"

interface AttachedFile {
  name: string
  inputItem: CodexInputItem
}

interface AppleTaskComposerProps {
  apiBase?: string
  compact?: boolean
  enableTools?: boolean
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

async function uploadImageInput(file: File, apiBase?: string): Promise<CodexInputItem> {
  const response = await fetch(joinApiPath(apiBase, "/run/input-files"), {
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
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.82);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9);
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
  min-height: 42px;
  max-height: 92px;
  padding: 10px 12px 6px;
  font-size: 13px;
  line-height: 1.42;
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
  gap: 6px;
  padding: 6px 8px 8px;
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
  height: 24px;
  padding: 0 8px;
  font-size: 11px;
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
  width: 30px;
  height: 30px;
}
.apple-task-composer-send:disabled {
  cursor: default;
  opacity: 0.35;
}
`

export function AppleTaskComposer({
  apiBase,
  compact = false,
  enableTools = true,
  onAbort,
  onSubmit,
  placeholder,
  running,
}: AppleTaskComposerProps) {
  const { t } = useTranslation()
  const [value, setValue] = useState("")
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [selectedSkills, setSelectedSkills] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

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

    const enabledSkills = enableTools ? selectedSkills : []
    if (inputItems.length === 0 && enabledSkills.length === 0) return
    onSubmit(inputItems.length === 1 && inputItems[0].type === "text" ? inputItems[0].text : inputItems, enabledSkills)
    setValue("")
    setAttachedFiles([])
    setSelectedSkills([])
  }

  return (
    <div className={`apple-task-composer${compact ? " compact" : ""}`} aria-label={t("composer.ariaLabel")}>
      <style>{STYLE}</style>
      <textarea
        value={value}
        onChange={event => setValue(event.target.value)}
        onKeyDown={event => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault()
            submit()
          }
        }}
        disabled={running}
        placeholder={placeholder ?? t("composer.placeholder")}
      />
      <div className="apple-task-composer-footer">
        {enableTools && (
          <div className="apple-task-composer-tools">
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
          </div>
        )}
        <button
          type="button"
          className="apple-task-composer-send"
          aria-label={running ? t("composer.stop") : t("composer.send")}
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
                nextFiles.push({ name: file.name, inputItem: await uploadImageInput(file, apiBase) })
              }
            } catch {
              // Skip unreadable files.
            }
          }
          setAttachedFiles(previous => [...previous, ...nextFiles])
          event.target.value = ""
        }}
      />
    </div>
  )
}
