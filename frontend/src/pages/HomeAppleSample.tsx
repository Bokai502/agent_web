import { useEffect, useState } from "react"
import { AppleTaskComposer } from "../components/AppleTaskComposer"
import { SessionModelPreview } from "../components/SessionModelPreview"
import { useWorkspaceAppState } from "../hooks/useWorkspaceAppState"
import type { Session } from "../types"
import { WorkspaceAppleContent } from "./WorkspaceAppleSample"

const DEFAULT_HOME_PATH = "/home"
const LEGACY_THUMBNAIL_CACHE_PREFIX = "codex:model-preview-image:v3:"
const LEGACY_SAMPLE_THUMBNAIL_CACHE_PREFIX = "codex:model-preview-image:v5:sample:"
const SAMPLE_THUMBNAIL_CACHE_PREFIX = "codex:model-preview-image:v6:sample:"
const SAMPLE_THUMBNAIL_PIXEL_RATIO = 1.5
const SAMPLE_THUMBNAIL_QUALITY = 0.92
type SampleThumbnailVariant = "featured" | "card"

const SAMPLE_STYLE = `
.apple-sample {
  min-height: 100vh;
  overflow-x: hidden;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(245, 245, 247, 0.8) 36%, #f5f5f7),
    radial-gradient(circle at 50% 130px, rgba(120, 177, 255, 0.18), transparent 34%);
  color: #1d1d1f;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif;
}
.apple-sample button,
.apple-sample textarea { font: inherit; }
.apple-sample-topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  height: 48px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.04);
  background: rgba(251, 251, 253, 0.78);
  backdrop-filter: saturate(180%) blur(22px);
}
.apple-sample-topbar-inner,
.apple-sample-shell {
  width: min(1180px, calc(100vw - 40px));
  margin: 0 auto;
}
.apple-sample-topbar-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 100%;
}
.apple-sample-brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: #2b2b2d;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0;
}
.apple-sample-brand img {
  width: 22px;
  height: 22px;
  object-fit: contain;
}
.apple-sample-nav {
  display: flex;
  align-items: center;
  gap: 28px;
  color: #4f4f53;
  font-size: 12px;
}
.apple-sample-nav span { white-space: nowrap; }
.apple-sample-hero {
  display: grid;
  place-items: center;
  min-height: 660px;
  padding: 74px 0 58px;
  text-align: center;
}
.apple-sample-eyebrow {
  margin-bottom: 15px;
  color: #86868b;
  font-size: 17px;
  font-weight: 600;
}
.apple-sample-hero h1 {
  max-width: 900px;
  margin: 0 auto;
  font-size: clamp(46px, 7vw, 92px);
  font-weight: 700;
  letter-spacing: 0;
  line-height: 1.02;
}
.apple-sample-hero p {
  max-width: 680px;
  margin: 22px auto 0;
  color: #56565b;
  font-size: clamp(19px, 2.2vw, 26px);
  line-height: 1.38;
}
.apple-sample-composer {
  width: min(820px, 100%);
  margin: 42px auto 0;
}
.apple-sample-metrics {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 18px;
  margin-top: 48px;
}
.apple-sample-metric {
  min-height: 112px;
  padding: 24px;
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.62);
  text-align: left;
}
.apple-sample-metric strong {
  display: block;
  color: #1d1d1f;
  font-size: 30px;
  font-weight: 600;
  line-height: 1;
}
.apple-sample-metric span {
  display: block;
  margin-top: 10px;
  color: #6e6e73;
  font-size: 14px;
  line-height: 1.45;
}
.apple-sample-history {
  padding: 18px 0 80px;
}
.apple-sample-section-head {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 24px;
  padding-top: 34px;
  border-top: 1px solid rgba(0, 0, 0, 0.08);
}
.apple-sample-section-head h2 {
  margin: 0;
  font-size: clamp(30px, 4vw, 52px);
  font-weight: 700;
  letter-spacing: 0;
  line-height: 1.08;
}
.apple-sample-section-head p {
  max-width: 430px;
  margin: 10px 0 0;
  color: #6e6e73;
  font-size: 17px;
  line-height: 1.45;
}
.apple-sample-count {
  display: inline-flex;
  align-items: center;
  height: 38px;
  padding: 0 15px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.72);
  color: #56565b;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}
.apple-sample-history-grid {
  display: grid;
  grid-template-columns: 1.15fr 0.85fr 0.85fr;
  gap: 18px;
  margin-top: 30px;
}
.apple-sample-session {
  position: relative;
  min-height: 260px;
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.82);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.07);
}
.apple-sample-session.featured {
  min-height: 540px;
  grid-row: span 2;
}
.apple-sample-session-action {
  display: flex;
  width: 100%;
  height: 100%;
  flex-direction: column;
  border: 0;
  background: transparent;
  padding: 0;
  text-align: left;
  cursor: pointer;
}
.apple-sample-preview {
  position: relative;
  aspect-ratio: 360 / 150;
  height: auto;
  flex-shrink: 0;
  overflow: hidden;
  background:
    linear-gradient(130deg, rgba(255, 255, 255, 0.92), rgba(255, 255, 255, 0.32)),
    radial-gradient(circle at 28% 36%, rgba(0, 113, 227, 0.46), transparent 22%),
    radial-gradient(circle at 66% 42%, rgba(44, 205, 121, 0.28), transparent 21%),
    linear-gradient(145deg, #dce5ef, #f8f8fb);
}
.featured .apple-sample-preview {
  aspect-ratio: 560 / 340;
  height: auto;
  background:
    radial-gradient(circle at 50% 42%, rgba(255, 255, 255, 0.92), transparent 22%),
    radial-gradient(circle at 35% 35%, rgba(0, 113, 227, 0.48), transparent 24%),
    radial-gradient(circle at 72% 54%, rgba(255, 149, 0, 0.28), transparent 22%),
    linear-gradient(160deg, #d7e2f1, #f5f5f7 58%, #ffffff);
}
.apple-sample-preview img {
  position: absolute;
  left: 50%;
  top: 50%;
  width: calc(100% - 28px);
  height: calc(100% - 24px);
  transform: translate(-50%, -50%);
  border-radius: 16px;
  object-fit: contain;
  background: transparent;
  box-shadow: 0 12px 28px rgba(28, 44, 78, 0.12);
}
.featured .apple-sample-preview img {
  width: calc(100% - 42px);
  height: calc(100% - 38px);
  border-radius: 18px;
}
.apple-sample-preview > div {
  position: absolute;
  inset: 0;
  min-height: 0;
}
.apple-sample-session-body {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  padding: 22px 24px 24px;
}
.apple-sample-status {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: #6e6e73;
  font-size: 12px;
  font-weight: 600;
}
.apple-sample-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.apple-sample-session h3 {
  margin: 12px 0 0;
  color: #1d1d1f;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 0;
  line-height: 1.2;
  overflow-wrap: anywhere;
}
.apple-sample-session p {
  margin: 10px 0 0;
  color: #6e6e73;
  font-size: 14px;
  line-height: 1.48;
  overflow-wrap: anywhere;
}
.apple-sample-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: auto;
  padding-top: 18px;
}
.apple-sample-meta span {
  padding: 7px 10px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.045);
  color: #55555a;
  font-size: 12px;
  font-weight: 600;
}
.apple-sample-delete {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 2;
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.72);
  color: #6e6e73;
  opacity: 0;
  transition: opacity 160ms ease;
}
.apple-sample-session:hover .apple-sample-delete { opacity: 1; }
.apple-sample-timeline {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1px;
  margin-top: 18px;
  overflow: hidden;
  border-radius: 16px;
  background: rgba(0, 0, 0, 0.06);
}
.apple-sample-timeline span {
  padding: 12px 8px;
  background: rgba(255, 255, 255, 0.68);
  color: #55555a;
  font-size: 12px;
  font-weight: 600;
  text-align: center;
}
.apple-sample-empty {
  max-width: 640px;
  margin: 32px auto 0;
  padding: 48px 24px;
  border: 1px dashed rgba(0, 0, 0, 0.12);
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.7);
  color: #6e6e73;
  text-align: center;
}
.apple-sample-empty strong {
  display: block;
  color: #1d1d1f;
  font-size: 20px;
}
.apple-sample-empty span {
  display: block;
  margin-top: 8px;
  font-size: 15px;
  line-height: 1.8;
}
@media (max-width: 860px) {
  .apple-sample-topbar-inner,
  .apple-sample-shell {
    width: min(100vw - 28px, 680px);
  }
  .apple-sample-nav { display: none; }
  .apple-sample-hero {
    min-height: auto;
    padding: 56px 0 46px;
  }
  .apple-sample-hero h1 {
    font-size: clamp(42px, 12vw, 64px);
  }
  .apple-sample-metrics,
  .apple-sample-history-grid {
    grid-template-columns: 1fr;
  }
  .apple-sample-section-head {
    align-items: flex-start;
    flex-direction: column;
  }
  .apple-sample-session.featured {
    min-height: 430px;
    grid-row: auto;
  }
}
`

function formatSessionTime(createdAt: number) {
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return "最近"

  const today = new Date()
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const dayDiff = Math.round((startOfToday - startOfDate) / 86400000)

  if (dayDiff === 0) {
    return `今天 ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`
  }
  if (dayDiff === 1) {
    return `昨天 ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`
  }
  return date.toLocaleDateString("zh-CN", { month: "long", day: "numeric" })
}

function getSessionStage(session: Session) {
  const events = session.turns.flatMap(turn => turn.events)
  const hasAskUser = events.some(event => (
    event.type === "item.started" ||
    event.type === "item.updated" ||
    event.type === "item.completed"
  ) && event.item.type === "ask_user")
  const hasWork = events.some(event => (
    event.type === "item.started" ||
    event.type === "item.updated" ||
    event.type === "item.completed"
  ) && (event.item.type === "command_execution" || event.item.type === "file_change"))

  if (hasAskUser && !session.dismissedAskUserId) {
    return { label: "待确认", dotClass: "bg-[#b85f00]" }
  }
  if (hasWork) {
    return { label: "已完成", dotClass: "bg-[#0f7f56]" }
  }
  return { label: "已保存", dotClass: "bg-[#0071e3]" }
}

function getSessionSummary(session: Session) {
  const latestTurn = session.turns.at(-1)
  if (!latestTurn) return "打开会话，继续完善设计目标、约束条件和输出结果。"

  const finalResponse = latestTurn.events.findLast(event => event.type === "turn.completed")
  if (finalResponse?.type === "turn.completed" && finalResponse.turn?.finalResponse?.trim()) {
    return finalResponse.turn.finalResponse.trim()
  }

  return latestTurn.userPrompt.trim() || "打开会话，继续完善设计目标、约束条件和输出结果。"
}

function findLatestCacheValue(prefix: string) {
  try {
    const keys: string[] = []
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (key?.startsWith(prefix)) keys.push(key)
    }

    const cacheKey = keys.sort().at(-1)
    return cacheKey ? localStorage.getItem(cacheKey) : null
  } catch {
    return null
  }
}

function getVariantSize(variant: SampleThumbnailVariant) {
  return variant === "featured"
    ? { height: 340, width: 560 }
    : { height: 150, width: 360 }
}

function getVariantCacheSize(variant: SampleThumbnailVariant) {
  const size = getVariantSize(variant)
  return {
    height: Math.round(size.height * SAMPLE_THUMBNAIL_PIXEL_RATIO),
    width: Math.round(size.width * SAMPLE_THUMBNAIL_PIXEL_RATIO),
  }
}

function createSampleThumbnailVariant(sourceDataUrl: string, variant: SampleThumbnailVariant) {
  const displaySize = getVariantSize(variant)
  const { width, height } = getVariantCacheSize(variant)
  return new Promise<string | null>((resolve) => {
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement("canvas")
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext("2d")
      if (!ctx) {
        resolve(null)
        return
      }

      ctx.fillStyle = "#050914"
      ctx.fillRect(0, 0, width, height)

      const scaleRatio = width / displaySize.width
      const innerWidth = displaySize.width * 0.98 * scaleRatio
      const innerHeight = displaySize.height * (variant === "featured" ? 0.9 : 0.88) * scaleRatio
      const scale = Math.min(
        innerWidth / image.naturalWidth,
        innerHeight / image.naturalHeight,
      )
      const drawWidth = image.naturalWidth * scale
      const drawHeight = image.naturalHeight * scale
      const drawX = (width - drawWidth) / 2
      const drawY = (height - drawHeight) / 2
      ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight)

      try {
        resolve(canvas.toDataURL("image/png", SAMPLE_THUMBNAIL_QUALITY))
      } catch {
        resolve(null)
      }
    }
    image.onerror = () => resolve(null)
    image.src = sourceDataUrl
  })
}

async function readOrCreateSampleThumbnail(sessionId: string, variant: SampleThumbnailVariant) {
  const variantPrefix = `${SAMPLE_THUMBNAIL_CACHE_PREFIX}${sessionId}:${variant}:`
  const variantCache = findLatestCacheValue(variantPrefix)
  if (variantCache) return variantCache

  const legacyVariantCache = findLatestCacheValue(`${LEGACY_SAMPLE_THUMBNAIL_CACHE_PREFIX}${sessionId}:${variant}:`)
  const legacyCache = findLatestCacheValue(`${LEGACY_THUMBNAIL_CACHE_PREFIX}${sessionId}:`)
  const sourceCache = legacyCache ?? legacyVariantCache
  if (!sourceCache) return null

  const generated = await createSampleThumbnailVariant(sourceCache, variant)
  if (!generated) return sourceCache

  try {
    const key = `${variantPrefix}${Date.now()}`
    localStorage.setItem(key, generated)
  } catch {
    // Ignore storage quota errors.
  }
  return generated
}

function CachedSessionPreview({
  allowGenerate,
  sessionId,
  variant,
}: {
  allowGenerate: boolean
  sessionId: string
  variant: SampleThumbnailVariant
}) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    readOrCreateSampleThumbnail(sessionId, variant).then(dataUrl => {
      if (!cancelled) setThumbnailUrl(dataUrl)
    })

    const handleStorage = (event: StorageEvent) => {
      if (
        event.key?.startsWith(`${SAMPLE_THUMBNAIL_CACHE_PREFIX}${sessionId}:${variant}:`) ||
        event.key?.startsWith(`${LEGACY_SAMPLE_THUMBNAIL_CACHE_PREFIX}${sessionId}:${variant}:`) ||
        event.key?.startsWith(`${LEGACY_THUMBNAIL_CACHE_PREFIX}${sessionId}:`)
      ) {
        readOrCreateSampleThumbnail(sessionId, variant).then(dataUrl => {
          if (!cancelled) setThumbnailUrl(dataUrl)
        })
      }
    }

    window.addEventListener("storage", handleStorage)
    return () => {
      cancelled = true
      window.removeEventListener("storage", handleStorage)
    }
  }, [sessionId, variant])

  return thumbnailUrl ? (
    <img src={thumbnailUrl} alt="" />
  ) : allowGenerate ? (
    <SessionModelPreview sessionId={sessionId} />
  ) : (
    null
  )
}

interface SampleSessionCardProps {
  featured?: boolean
  previewPriority?: boolean
  session: Session
  onSelect: () => void
  onDelete: () => void
}

function SampleSessionCard({
  featured = false,
  previewPriority = false,
  session,
  onSelect,
  onDelete,
}: SampleSessionCardProps) {
  const title = session.title.trim() || "未命名项目"
  const stage = getSessionStage(session)
  const summary = getSessionSummary(session)
  const producedCount = session.turns.reduce((total, turn) => {
    return total + turn.events.filter(event => (
      event.type === "item.completed" &&
      event.item.type === "file_change"
    )).length
  }, 0)

  return (
    <article className={`apple-sample-session${featured ? " featured" : ""}`}>
      <button
        type="button"
        aria-label="删除对话"
        onClick={(event) => {
          event.stopPropagation()
          onDelete()
        }}
        className="apple-sample-delete"
      >
        ×
      </button>

      <button type="button" onClick={onSelect} className="apple-sample-session-action">
        <div className="apple-sample-preview">
          <CachedSessionPreview
            allowGenerate={featured || previewPriority}
            sessionId={session.id}
            variant={featured ? "featured" : "card"}
          />
        </div>

        <div className="apple-sample-session-body">
          <div className="apple-sample-status">
            <span className={`apple-sample-dot ${stage.dotClass}`} />
            <span>{stage.label} · {formatSessionTime(session.createdAt)}</span>
          </div>

          <h3>{title}</h3>

          <p>{summary}</p>

          {featured && (
            <div className="apple-sample-timeline">
              {["布局", "建模", "仿真", "分析"].map(label => (
                <span key={label}>{label}</span>
              ))}
            </div>
          )}

          <div className="apple-sample-meta">
            <span>{session.turns.length || 1} 轮对话</span>
            {featured && <span>{producedCount > 0 ? `${producedCount} 次文件更新` : "工作会话"}</span>}
          </div>
        </div>
      </button>
    </article>
  )
}

interface HomeAppleSampleProps {
  homePath?: string
}

export default function HomeAppleSample({ homePath = DEFAULT_HOME_PATH }: HomeAppleSampleProps) {
  const workspaceState = useWorkspaceAppState({ homePath })
  const {
    activeSessionId,
    handleDelete,
    handleSelect,
    handleSubmit,
    isMobile,
    running,
    sortedSessions,
    abort,
  } = workspaceState

  if (activeSessionId) {
    return <WorkspaceAppleContent state={workspaceState} />
  }

  const visibleSessions = sortedSessions.slice(0, isMobile ? 4 : 5)

  return (
    <div className="apple-sample">
      <style>{SAMPLE_STYLE}</style>

      <header className="apple-sample-topbar">
        <div className="apple-sample-topbar-inner">
          <div className="apple-sample-brand">
            <img src="/logo_1.png" alt="" />
            <span>AI 设计工作台</span>
          </div>
          <nav aria-label="样例导航" className="apple-sample-nav">
            <span>结构方案</span>
            <span>仿真结果</span>
            <span>历史对话</span>
            <span>组件库</span>
          </nav>
        </div>
      </header>

      <main className="apple-sample-shell">
        <section className="apple-sample-hero" aria-labelledby="apple-sample-hero-title">
          <div>
            <div className="apple-sample-eyebrow">面向工程设计的智能工作流</div>
            <h1 id="apple-sample-hero-title">
              把想法变成可查看、可复用的结构方案。
            </h1>
            <p>
              描述目标、上传约束文件、启用专业技能。系统会自动创建会话，并把布局、模型、仿真和分析结果沉淀成清晰的工作记录。
            </p>

            <div className="apple-sample-composer">
              <AppleTaskComposer onSubmit={handleSubmit} onAbort={abort} running={running} />
            </div>

            <div className="apple-sample-metrics" aria-label="工作台概览">
              <div className="apple-sample-metric">
                <strong>{sortedSessions.length}</strong>
                <span>条已保存会话，可继续生成、编辑与验证。</span>
              </div>
              <div className="apple-sample-metric">
                <strong>4</strong>
                <span>类工作空间：模型、日志、物料与分析。</span>
              </div>
              <div className="apple-sample-metric">
                <strong>12</strong>
                <span>个专业技能，可在输入框中快速启用。</span>
              </div>
            </div>
          </div>
        </section>

        <section className="apple-sample-history" aria-labelledby="apple-sample-history-title">
          <div className="apple-sample-section-head">
            <div>
              <h2 id="apple-sample-history-title">最近的历史对话</h2>
              <p>用更高的信息密度展示会话状态、阶段进度和关键产物，便于快速回到上一次工作。</p>
            </div>
            <span className="apple-sample-count">已保存 {sortedSessions.length} 条</span>
          </div>

          {visibleSessions.length === 0 ? (
            <div className="apple-sample-empty">
              <strong>暂无保存的对话</strong>
              <span>先从上方输入你的第一条任务，系统会自动为你创建新的工作会话。</span>
            </div>
          ) : (
            <div className="apple-sample-history-grid">
              {visibleSessions.map((session, index) => (
                <SampleSessionCard
                  key={session.id}
                  session={session}
                  featured={!isMobile && index === 0}
                  previewPriority={index < 3}
                  onSelect={() => handleSelect(session.id)}
                  onDelete={() => handleDelete(session.id)}
                />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
